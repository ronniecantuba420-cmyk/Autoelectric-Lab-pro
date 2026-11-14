import React, { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Eye, GripHorizontal, Mic, Volume2, VolumeX } from 'lucide-react';
import {
  BenchComponent,
  EcuPin,
  FaultType,
  InjectedFault,
  MultimeterState,
  PowerSupplyState,
  WireConnection,
} from '../types/ecu';
import { CircuitSolution } from '../utils/circuitSolver';
import { SavedBenchSession, SavedDiagnosticLog } from '../services/benchStorageService';
import { playModuleActivationSound } from '../utils/audioFeedback';
import { ECUDiagnosticView } from './ECUDiagnosticView';
import {
  FLOATING_OPACITY_LEVELS,
  FloatingLabNavigator,
  FloatingOpacityLevel,
} from './FloatingLabNavigator';
import { InstrumentPanels } from './InstrumentPanels';
import { LabTab, MobileBenchPane, RackFilter } from './LabTopNav';
import { WiringCanvas } from './WiringCanvas';
import {
  RpmEmulatorState,
  UNIVERSAL_BRAND_KEY,
  getSelectedVehicleContext,
} from '../utils/vehicleEcuRegistry';

const Oscilloscope = lazy(() =>
  import('./Oscilloscope').then((m) => ({ default: m.Oscilloscope }))
);
const PinWaveformOscilloscope = lazy(() =>
  import('./PinWaveformOscilloscope').then((m) => ({ default: m.PinWaveformOscilloscope }))
);
const SchematicPcbScanner = lazy(() =>
  import('./SchematicPcbScanner').then((m) => ({ default: m.SchematicPcbScanner }))
);
const EcuConnectorPinouts = lazy(() =>
  import('./EcuConnectorPinouts').then((m) => ({ default: m.EcuConnectorPinouts }))
);
const EcuRepairKnowledgeBase = lazy(() =>
  import('./EcuRepairKnowledgeBase').then((m) => ({ default: m.EcuRepairKnowledgeBase }))
);
const ThreeBenchTwin = lazy(() =>
  import('./ThreeBenchTwin').then((m) => ({ default: m.ThreeBenchTwin }))
);

/** Polarity identifier for virtual DMM test leads on the harness canvas and ECU pinout views. */
export type ProbeColor = 'red' | 'black';

/** Partial key-value state patch applied to interactive bench components (e.g., throttle angle, coolant temperature). */
export type ComponentStateUpdates = Record<string, number | boolean | string>;

/**
 * Navigation and responsive viewport state controlling which workbench modules are visible.
 */
export interface LabNavigationProps {
  /** Active top-level workbench view tab (`BENCH_LAB`, `WIRING_DIAGRAM`, `THREE_D_TWIN`, etc.). */
  activeTab: LabTab;
  /** Switches the active top-level workbench tab. */
  onNavigateTab: (tab: LabTab) => void;
  /** Filter applied to the left instrument rack (`ALL`, `DMM_POWER`, or `FAULT_MATRIX`). */
  rackFilter: RackFilter;
  /** Updates the active instrument rack filter tab. */
  onChangeRackFilter: (filter: RackFilter) => void;
  /** Active pane rendered below `lg` viewports on `BENCH_LAB` (`INSTRUMENTS`, `CANVAS`, or `GUIDE`). */
  mobileBenchPane: MobileBenchPane;
  /** Switches the visible pane in mobile/tablet viewports (`< lg`). */
  onChangeMobileBenchPane: (pane: MobileBenchPane) => void;
  /** Controls visibility of the 5-step ECU Diagnostic Guide side panel on desktop viewports. */
  showDiagnosticGuide: boolean;
  /** Opens or collapses the 5-step ECU Diagnostic Guide panel. */
  onSetShowDiagnosticGuide: (open: boolean) => void;
}

/**
 * Read-only MNA circuit state and controllable virtual instrument hardware props
 * passed down from the top-level simulation controller in `App.tsx`.
 */
export interface LabSimulationProps {
  /** Time-scale multiplier (`0.25` to `4.0`) for oscilloscope waveforms and animated signal pulses. */
  simulationSpeed: number;
  /** Programmable DC bench power supply settings (voltage, current limit, output state, preset). */
  powerSupply: PowerSupplyState;
  /** React state dispatcher updating `powerSupply` parameters. */
  onChangePowerSupply: React.Dispatch<React.SetStateAction<PowerSupplyState>>;
  /** Virtual DMM mode, lead placement, power, auto-range, and hold state. */
  multimeter: MultimeterState;
  /** React state dispatcher updating `multimeter` configuration. */
  onChangeMultimeter: React.Dispatch<React.SetStateAction<MultimeterState>>;
  /** Deterministic MNA solver output (`nodeVoltages`, `wireCurrentsMa`, `multimeterReading`, `activeDTCs`, supply load). */
  circuitSolution: CircuitSolution;
  /** Ordered array of 16 ECU connector pins (`EcuPin[]`) with nominal electrical parameters. */
  pins: EcuPin[];
  /** Physical bench peripherals (`BenchComponent[]`: TPS, MAP, ECT, O2, Injector, Coil, CAN node, etc.). */
  components: BenchComponent[];
  /** Active harness wires (`WireConnection[]`) linking ECU pins and bench component terminals. */
  wires: WireConnection[];
  /** Currently injected electrical faults (`InjectedFault[]`) evaluated by the MNA network and OBD-II engine. */
  faults: InjectedFault[];
  /** Currently inspected pin ID (`string | null`) synchronized across instruments, canvas, and diagnostic views. */
  selectedPinId: string | null;
  /** Selects or clears the active pin focus across workbench panes. */
  onSelectPin: (pinId: string | null) => void;
  /** True when a fault affects CAN_H or CAN_L communication lines (drives oscilloscope signal selection). */
  hasCanFault: boolean;
  /** True when an open/short/resistance fault affects the primary injector driver circuit. */
  hasInjectorFault: boolean;
  /** Selected vehicle brand key (`'universal-bench'`, `'toyota'`, `'honda'`, etc.) in the Bench Test panel. */
  selectedBrandKey?: string;
  /** Selected vehicle model label (e.g., `'Vios'`, `'Civic'`, `'Fortuner'`) paired with the ECU bench. */
  selectedModelName?: string;
  /** Selected OEM ECU profile ID matching `ECU_BRAND_PROFILES` or `null` for universal bench mode. */
  selectedEcuProfileId?: string | null;
  /** Updates selected Car Make, Model, and OEM ECU profile while synchronizing bench pinout labels. */
  onSelectVehicleEcu?: (brandKey: string, modelName: string, ecuProfileId: string | null) => void;
  /** Live CKP/RPM emulator state (`isActive`, `rpm`, `soundEnabled`) driving audio synthesis and crank waveforms. */
  rpmEmulator?: RpmEmulatorState;
  /** React state dispatcher updating live RPM emulator speed, activation, and sound settings. */
  onChangeRpmEmulator?: React.Dispatch<React.SetStateAction<RpmEmulatorState>>;
}

/**
 * Fault injection and DTC lookup callbacks bridged from the Fault Matrix and OBD monitor.
 */
export interface LabFaultCallbacks {
  /** Injects an open, short-to-ground, short-to-VBAT, or series resistance fault onto a target pin. */
  onAddFault: (pinId: string, faultType: FaultType, description: string) => void;
  /** Clears an active injected fault from the specified pin. */
  onRemoveFault: (pinId: string) => void;
  /** Restores all pins by removing every injected fault in one operation. */
  onClearAllFaults: () => void;
  /** Opens grounded OEM search pre-populated with a diagnostic trouble code and description. */
  onSearchDtc: (code: string, desc: string) => void;
}

/**
 * Interactive harness wiring, probe routing, and component actuation callbacks.
 */
export interface LabHarnessCallbacks {
  /** Connects a new harness wire between two terminal IDs with optional sheath color hex and label. */
  onAddWire: (sourcePinId: string, targetPinId: string, color?: string, label?: string) => void;
  /** Toggles an open-circuit cut state on an existing harness wire. */
  onToggleCutWire: (wireId: string) => void;
  /** Removes a harness wire permanently from the active bench topology. */
  onDeleteWire: (wireId: string) => void;
  /** Seats the red (`+`) or black (`COM`) virtual DMM probe onto a pin/terminal ID. */
  onAttachProbe: (color: ProbeColor, pinId: string, label: string) => void;
  /** Updates interactive sensor/actuator parameters (e.g., TPS throttle %, coolant temp °C). */
  onUpdateComponentState: (compId: string, updates: ComponentStateUpdates) => void;
}

/**
 * Secondary modal and reference library launch callbacks owned by `App.tsx`.
 */
export interface LabToolCallbacks {
  /** Navigates directly to the interactive ECU Connector Pinout Library tab. */
  onOpenEcuPinouts: () => void;
  /** Opens the local offline diagnostic assistant modal, optionally seeded with a prompt. */
  onOpenOfflineBot: (prompt?: string) => void;
  /** Opens live web grounded OEM search modal with optional query, DTC code, and ECU model. */
  onOpenGroundedSearch: (query?: string, dtc?: string, ecu?: string) => void;
  /** Opens the Saved Bench Workspaces & Diagnostic Logs cloud persistence modal. */
  onOpenCloudModal: () => void;
  /** Optional lab reset callback used by the floating offline voice navigator. */
  onResetLab?: () => void;
}

/**
 * Persisted workspace snapshots and diagnostic logs retrieved from local/Firestore storage.
 */
export interface LabCloudDataProps {
  /** User-saved bench configurations (`SavedBenchSession[]`) available in the Repair Knowledge Base. */
  savedSessions: SavedBenchSession[];
  /** Historical diagnostic logs (`SavedDiagnosticLog[]`) surfaced alongside live bench telemetry. */
  savedLogs: SavedDiagnosticLog[];
}

/**
 * Complete typed prop contract accepted by {@link LabWorkspaceLayout} from `App.tsx`.
 * Composes navigation state, deterministic MNA simulation telemetry, fault controls,
 * harness manipulation callbacks, modal launchers, and saved cloud datasets.
 */
export interface LabWorkspaceLayoutProps
  extends LabNavigationProps,
    LabSimulationProps,
    LabFaultCallbacks,
    LabHarnessCallbacks,
    LabToolCallbacks,
    LabCloudDataProps {}

const VALID_LAB_TABS: readonly LabTab[] = [
  'BENCH_LAB',
  'WIRING_DIAGRAM',
  'THREE_D_TWIN',
  'ECU_PINOUT',
  'OSCILLOSCOPE',
  'PCB_SCANNER',
  'REPAIR_GUIDE',
];

const VALID_RACK_FILTERS: readonly RackFilter[] = ['ALL', 'DMM_POWER', 'FAULT_MATRIX'];
const VALID_MOBILE_PANES: readonly MobileBenchPane[] = ['INSTRUMENTS', 'CANVAS', 'GUIDE'];
const DEFAULT_PANE_ORDER: readonly MobileBenchPane[] = ['INSTRUMENTS', 'CANVAS', 'GUIDE'];

export type WorkspaceLayoutTier =
  | 'COMPACT_MOBILE'
  | 'TABLET_SPLIT'
  | 'COMPACT_DESKTOP'
  | 'WIDE_DESKTOP';

const REQUIRED_CALLBACK_KEYS: readonly (keyof LabWorkspaceLayoutProps)[] = [
  'onNavigateTab',
  'onChangeRackFilter',
  'onChangeMobileBenchPane',
  'onSetShowDiagnosticGuide',
  'onChangePowerSupply',
  'onChangeMultimeter',
  'onSelectPin',
  'onAddFault',
  'onRemoveFault',
  'onClearAllFaults',
  'onSearchDtc',
  'onAddWire',
  'onToggleCutWire',
  'onDeleteWire',
  'onAttachProbe',
  'onUpdateComponentState',
  'onOpenEcuPinouts',
  'onOpenOfflineBot',
  'onOpenGroundedSearch',
  'onOpenCloudModal',
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isFiniteNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Validates all props passed to {@link LabWorkspaceLayout} at runtime.
 * Returns a list of human-readable contract violations (empty array when valid).
 */
export function validateLabWorkspaceProps(
  props: Partial<LabWorkspaceLayoutProps>
): string[] {
  const errors: string[] = [];

  if (!props.activeTab || !VALID_LAB_TABS.includes(props.activeTab)) {
    errors.push(`Invalid "activeTab": received "${String(props.activeTab)}".`);
  }
  if (!props.rackFilter || !VALID_RACK_FILTERS.includes(props.rackFilter)) {
    errors.push(`Invalid "rackFilter": received "${String(props.rackFilter)}".`);
  }
  if (!props.mobileBenchPane || !VALID_MOBILE_PANES.includes(props.mobileBenchPane)) {
    errors.push(`Invalid "mobileBenchPane": received "${String(props.mobileBenchPane)}".`);
  }

  if (!isFiniteNumber(props.simulationSpeed) || props.simulationSpeed <= 0) {
    errors.push(
      `Invalid "simulationSpeed": expected positive finite number, received "${String(
        props.simulationSpeed
      )}".`
    );
  }

  if (typeof props.showDiagnosticGuide !== 'boolean') {
    errors.push('Prop "showDiagnosticGuide" must be a boolean.');
  }
  if (typeof props.hasCanFault !== 'boolean') {
    errors.push('Prop "hasCanFault" must be a boolean.');
  }
  if (typeof props.hasInjectorFault !== 'boolean') {
    errors.push('Prop "hasInjectorFault" must be a boolean.');
  }
  if (props.selectedPinId !== null && typeof props.selectedPinId !== 'string') {
    errors.push('Prop "selectedPinId" must be a string or null.');
  }

  if (!isRecord(props.powerSupply)) {
    errors.push('Prop "powerSupply" must be an object.');
  } else {
    if (!isFiniteNumber(props.powerSupply.voltageSetting)) {
      errors.push('Prop "powerSupply.voltageSetting" must be a finite number.');
    }
    if (!isFiniteNumber(props.powerSupply.currentLimit)) {
      errors.push('Prop "powerSupply.currentLimit" must be a finite number.');
    }
    if (typeof props.powerSupply.isOutputEnabled !== 'boolean') {
      errors.push('Prop "powerSupply.isOutputEnabled" must be a boolean.');
    }
  }

  if (!isRecord(props.multimeter)) {
    errors.push('Prop "multimeter" must be an object.');
  } else {
    if (typeof props.multimeter.mode !== 'string') {
      errors.push('Prop "multimeter.mode" must be a string.');
    }
    if (!isRecord(props.multimeter.redProbe) || !isRecord(props.multimeter.blackProbe)) {
      errors.push('Props "multimeter.redProbe" and "multimeter.blackProbe" must be objects.');
    }
  }

  if (!isRecord(props.circuitSolution)) {
    errors.push('Prop "circuitSolution" must be an MNA solver snapshot object.');
  } else {
    if (!isRecord(props.circuitSolution.nodeVoltages)) {
      errors.push('Prop "circuitSolution.nodeVoltages" must be a record of node voltages.');
    }
    if (!isRecord(props.circuitSolution.wireCurrentsMa)) {
      errors.push('Prop "circuitSolution.wireCurrentsMa" must be a record of wire currents.');
    }
    if (!isRecord(props.circuitSolution.multimeterReading)) {
      errors.push('Prop "circuitSolution.multimeterReading" must be an object.');
    }
    if (!Array.isArray(props.circuitSolution.activeDTCs)) {
      errors.push('Prop "circuitSolution.activeDTCs" must be an array.');
    }
    if (!isFiniteNumber(props.circuitSolution.supplyCurrentDrawAmps)) {
      errors.push('Prop "circuitSolution.supplyCurrentDrawAmps" must be a finite number.');
    }
  }

  const arrayProps: readonly (keyof LabWorkspaceLayoutProps)[] = [
    'pins',
    'components',
    'wires',
    'faults',
    'savedSessions',
    'savedLogs',
  ];
  for (const key of arrayProps) {
    if (!Array.isArray(props[key])) {
      errors.push(`Prop "${key}" must be an array.`);
    }
  }

  for (const key of REQUIRED_CALLBACK_KEYS) {
    if (typeof props[key] !== 'function') {
      errors.push(`Callback prop "${key}" must be a function.`);
    }
  }

  if (props.rpmEmulator !== undefined) {
    if (!isRecord(props.rpmEmulator)) {
      errors.push('Prop "rpmEmulator" must be an object when provided.');
    } else {
      if (typeof props.rpmEmulator.isActive !== 'boolean') {
        errors.push('Prop "rpmEmulator.isActive" must be a boolean.');
      }
      if (!isFiniteNumber(props.rpmEmulator.rpm) || props.rpmEmulator.rpm < 0) {
        errors.push('Prop "rpmEmulator.rpm" must be a non-negative finite number.');
      }
      if (typeof props.rpmEmulator.soundEnabled !== 'boolean') {
        errors.push('Prop "rpmEmulator.soundEnabled" must be a boolean.');
      }
    }
  }

  return errors;
}

/**
 * Responsive flex-container workspace for the Virtual ECU Lab (`<main>`).
 *
 * Conditionally mounts `<InstrumentPanels />`, `<WiringCanvas />`, and `<ECUDiagnosticView />`
 * on the core `BENCH_LAB` view, or switches to expanded `WIRING_DIAGRAM`, `THREE_D_TWIN`,
 * `ECU_PINOUT`, `OSCILLOSCOPE` (split with harness canvas), `PCB_SCANNER`, or `REPAIR_GUIDE` views
 * based on `activeTab`. Contains zero physics or solver logic—all electrical telemetry is passed in
 * deterministically via `circuitSolution`. Includes runtime prop validation during development and
 * defensive fallback guards against malformed runtime structures.
 */
export const LabWorkspaceLayout: React.FC<LabWorkspaceLayoutProps> = (props) => {
  const {
    activeTab: rawActiveTab,
    onNavigateTab,
    rackFilter: rawRackFilter,
    onChangeRackFilter,
    mobileBenchPane: rawMobileBenchPane,
    onChangeMobileBenchPane,
    showDiagnosticGuide,
    onSetShowDiagnosticGuide,
    simulationSpeed: rawSimulationSpeed,
    powerSupply,
    onChangePowerSupply,
    multimeter,
    onChangeMultimeter,
    circuitSolution,
    pins,
    components,
    wires,
    faults,
    selectedPinId,
    onSelectPin,
    onAddFault,
    onRemoveFault,
    onClearAllFaults,
    onSearchDtc,
    onAddWire,
    onToggleCutWire,
    onDeleteWire,
    onAttachProbe,
    onUpdateComponentState,
    onOpenEcuPinouts,
    onOpenOfflineBot,
    onOpenGroundedSearch,
    onOpenCloudModal,
    onResetLab,
    hasCanFault,
    hasInjectorFault,
    selectedBrandKey,
    selectedModelName,
    selectedEcuProfileId,
    onSelectVehicleEcu,
    rpmEmulator,
    onChangeRpmEmulator,
    savedSessions,
    savedLogs,
  } = props;

  const isInjectorFiring = useMemo(() => {
    const inj = Array.isArray(components) ? components.find((c) => c.id === 'comp-inj') : undefined;
    return Boolean(inj?.state?.isFiring ?? true);
  }, [components]);

  const vehicleContext = useMemo(
    () =>
      getSelectedVehicleContext(
        selectedBrandKey || UNIVERSAL_BRAND_KEY,
        selectedModelName || 'Generic 16-Pin Bench',
        selectedEcuProfileId ?? null
      ),
    [selectedBrandKey, selectedModelName, selectedEcuProfileId]
  );

  const mainRef = useRef<HTMLElement>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [paneOrder, setPaneOrder] = useState<MobileBenchPane[]>(() => [...DEFAULT_PANE_ORDER]);
  const [isContainerMoveMode, setIsContainerMoveMode] = useState(false);
  const [showPinScopeOverlay, setShowPinScopeOverlay] = useState(false);
  const [oscilloscopeViewMode, setOscilloscopeViewMode] = useState<'CRT' | 'RECHARTS_PIN'>('CRT');

  // Unified Floating Offline AI Voice Assistant state & opacity shared with FloatingLabNavigator
  const [isVoiceAssistantActive, setIsVoiceAssistantActive] = useState(false);
  const [voiceFloatingOpacity, setVoiceFloatingOpacity] = useState<FloatingOpacityLevel>(0.75);
  const [voiceFabPos, setVoiceFabPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingVoiceFab, setIsDraggingVoiceFab] = useState(false);
  const [voiceFabAnnouncement, setVoiceFabAnnouncement] = useState('');
  const voiceFabRef = useRef<HTMLDivElement>(null);
  const voiceFabDragRef = useRef<{
    clientX: number;
    clientY: number;
    originX: number;
    originY: number;
    moved: boolean;
    longPressTriggered: boolean;
  } | null>(null);
  const voiceFabHoldTimerRef = useRef<number | null>(null);

  const selectedPin = useMemo(
    () => (Array.isArray(pins) ? pins.find((p) => p.id === selectedPinId) || pins[0] : undefined),
    [pins, selectedPinId]
  );
  const activeScopeRpm = rpmEmulator?.isActive ? rpmEmulator.rpm : 850;

  const validationErrors = useMemo(() => validateLabWorkspaceProps(props), [props]);

  useEffect(() => {
    if (import.meta.env.DEV && validationErrors.length > 0) {
      console.error('[LabWorkspaceLayout] Runtime prop validation failed:', validationErrors);
    }
  }, [validationErrors]);

  // Observe `<main>` container dimensions for responsive internal panel adaptation
  useEffect(() => {
    const el = mainRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;

    const updateSize = (width: number, height: number) => {
      const nextW = Math.round(width);
      const nextH = Math.round(height);
      setContainerSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH }
      );
    };

    const rect = el.getBoundingClientRect();
    updateSize(rect.width, rect.height);

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      updateSize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(el);

    return () => {
      observer.disconnect();
    };
  }, []);

  const layoutTier: WorkspaceLayoutTier = useMemo(() => {
    const w = containerSize.width;
    if (w > 0 && w < 768) return 'COMPACT_MOBILE';
    if (w >= 768 && w < 1024) return 'TABLET_SPLIT';
    if (w >= 1024 && w < 1280) return 'COMPACT_DESKTOP';
    return 'WIDE_DESKTOP';
  }, [containerSize.width]);

  const isCompactDesktop = layoutTier === 'COMPACT_DESKTOP';
  const isShortContainer = containerSize.height > 0 && containerSize.height < 680;

  const handleMovePane = useCallback((pane: MobileBenchPane, direction: 'prev' | 'next') => {
    setPaneOrder((prev) => {
      const idx = prev.indexOf(pane);
      if (idx === -1) return prev;
      const targetIdx = direction === 'prev' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
      return next;
    });
  }, []);

  const handleResetPaneOrder = useCallback(() => {
    setPaneOrder([...DEFAULT_PANE_ORDER]);
  }, []);

  // Re-clamp dragged voice FAB whenever ResizeObserver reports container shrinks
  useEffect(() => {
    if (!voiceFabPos || containerSize.width <= 0 || containerSize.height <= 0) return;
    const fabRect = voiceFabRef.current?.getBoundingClientRect();
    const fabW = fabRect?.width ?? 148;
    const fabH = fabRect?.height ?? 48;
    const maxX = Math.max(8, containerSize.width - fabW - 8);
    const maxY = Math.max(8, containerSize.height - fabH - 8);
    const clampedX = Math.min(Math.max(8, voiceFabPos.x), maxX);
    const clampedY = Math.min(Math.max(8, voiceFabPos.y), maxY);
    if (clampedX !== voiceFabPos.x || clampedY !== voiceFabPos.y) {
      setVoiceFabPos({ x: clampedX, y: clampedY });
    }
  }, [containerSize.width, containerSize.height, voiceFabPos]);

  // Clear hold-press timer on unmount
  useEffect(() => {
    return () => {
      if (voiceFabHoldTimerRef.current !== null) {
        window.clearTimeout(voiceFabHoldTimerRef.current);
      }
    };
  }, []);

  const handleToggleVoiceAssistantState = useCallback(
    (nextState?: boolean) => {
      setIsVoiceAssistantActive((prev) => {
        const next = typeof nextState === 'boolean' ? nextState : !prev;
        if (rpmEmulator?.soundEnabled !== false) {
          playModuleActivationSound(next, 'sensor');
        }
        setVoiceFabAnnouncement(
          next
            ? `Offline AI voice assistant activated at ${Math.round(voiceFloatingOpacity * 100)}% opacity.`
            : 'Offline AI voice assistant paused.'
        );
        return next;
      });
    },
    [rpmEmulator?.soundEnabled, voiceFloatingOpacity]
  );

  const handleCycleVoiceFloatingOpacity = useCallback(() => {
    setVoiceFloatingOpacity((prev) => {
      const idx = FLOATING_OPACITY_LEVELS.indexOf(prev);
      const next = FLOATING_OPACITY_LEVELS[(idx + 1) % FLOATING_OPACITY_LEVELS.length];
      setVoiceFabAnnouncement(
        `Offline AI voice assistant opacity set to ${Math.round(next * 100)}%.`
      );
      return next;
    });
  }, []);

  const clearVoiceFabHoldTimer = () => {
    if (voiceFabHoldTimerRef.current !== null) {
      window.clearTimeout(voiceFabHoldTimerRef.current);
      voiceFabHoldTimerRef.current = null;
    }
  };

  const handleVoiceFabPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const fabEl = voiceFabRef.current;
    if (!fabEl) return;

    const fabRect = fabEl.getBoundingClientRect();
    const parentRect = mainRef.current?.getBoundingClientRect();
    const originX = voiceFabPos
      ? voiceFabPos.x
      : Math.max(8, fabRect.left - (parentRect?.left ?? 0));
    const originY = voiceFabPos
      ? voiceFabPos.y
      : Math.max(8, fabRect.top - (parentRect?.top ?? 0));

    voiceFabDragRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      originX,
      originY,
      moved: false,
      longPressTriggered: false,
    };

    clearVoiceFabHoldTimer();
    voiceFabHoldTimerRef.current = window.setTimeout(() => {
      if (voiceFabDragRef.current && !voiceFabDragRef.current.moved) {
        voiceFabDragRef.current.longPressTriggered = true;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(20);
        }
        handleCycleVoiceFloatingOpacity();
      }
    }, 420);
  };

  const handleVoiceFabPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = voiceFabDragRef.current;
    if (!start) return;
    const dx = e.clientX - start.clientX;
    const dy = e.clientY - start.clientY;
    if (!start.moved && Math.hypot(dx, dy) > 6) {
      start.moved = true;
      clearVoiceFabHoldTimer();
      setIsDraggingVoiceFab(true);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic pointer events may not have active pointerId
      }
    }
    if (start.moved) {
      const fabRect = voiceFabRef.current?.getBoundingClientRect();
      const fabW = fabRect?.width ?? 148;
      const fabH = fabRect?.height ?? 48;
      const boundsW = containerSize.width || (typeof window !== 'undefined' ? window.innerWidth : 1024);
      const boundsH = containerSize.height || (typeof window !== 'undefined' ? window.innerHeight : 768);
      const maxX = Math.max(8, boundsW - fabW - 8);
      const maxY = Math.max(8, boundsH - fabH - 8);
      setVoiceFabPos({
        x: Math.min(Math.max(8, start.originX + dx), maxX),
        y: Math.min(Math.max(8, start.originY + dy), maxY),
      });
    }
  };

  const handleVoiceFabPointerUp = () => {
    clearVoiceFabHoldTimer();
    setIsDraggingVoiceFab(false);
    // Leave moved flag readable briefly during click event on child button, then clear asynchronously
    window.setTimeout(() => {
      voiceFabDragRef.current = null;
    }, 0);
  };

  const handleVoiceFabKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
    const step = e.shiftKey ? 32 : 16;
    if (
      e.key === 'ArrowLeft' ||
      e.key === 'ArrowRight' ||
      e.key === 'ArrowUp' ||
      e.key === 'ArrowDown'
    ) {
      e.preventDefault();
      const fabRect = voiceFabRef.current?.getBoundingClientRect();
      const parentRect = mainRef.current?.getBoundingClientRect();
      const curX = voiceFabPos
        ? voiceFabPos.x
        : Math.max(8, (fabRect?.left ?? 0) - (parentRect?.left ?? 0));
      const curY = voiceFabPos
        ? voiceFabPos.y
        : Math.max(8, (fabRect?.top ?? 0) - (parentRect?.top ?? 0));
      const fabW = fabRect?.width ?? 148;
      const fabH = fabRect?.height ?? 48;
      const boundsW = containerSize.width || (typeof window !== 'undefined' ? window.innerWidth : 1024);
      const boundsH = containerSize.height || (typeof window !== 'undefined' ? window.innerHeight : 768);
      const maxX = Math.max(8, boundsW - fabW - 8);
      const maxY = Math.max(8, boundsH - fabH - 8);
      const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
      const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
      setVoiceFabPos({
        x: Math.min(Math.max(8, curX + dx), maxX),
        y: Math.min(Math.max(8, curY + dy), maxY),
      });
      return;
    }

    if (e.key === 'Home') {
      e.preventDefault();
      setVoiceFabPos(null);
      setVoiceFabAnnouncement('Floating voice assistant button reset to default mobile position.');
      return;
    }

    if (e.key === 'o' || e.key === 'O') {
      e.preventDefault();
      handleCycleVoiceFloatingOpacity();
    }
  };

  const activeTab: LabTab = VALID_LAB_TABS.includes(rawActiveTab) ? rawActiveTab : 'BENCH_LAB';
  const rackFilter: RackFilter = VALID_RACK_FILTERS.includes(rawRackFilter) ? rawRackFilter : 'ALL';
  const mobileBenchPane: MobileBenchPane = VALID_MOBILE_PANES.includes(rawMobileBenchPane)
    ? rawMobileBenchPane
    : 'INSTRUMENTS';
  const simulationSpeed =
    isFiniteNumber(rawSimulationSpeed) && rawSimulationSpeed > 0 ? rawSimulationSpeed : 1.0;
  const safeSavedSessions = Array.isArray(savedSessions) ? savedSessions : [];
  const safeSavedLogs = Array.isArray(savedLogs) ? savedLogs : [];

  const hasValidCoreHardwareState =
    isRecord(powerSupply) &&
    isRecord(multimeter) &&
    isRecord(circuitSolution) &&
    isRecord(circuitSolution.nodeVoltages) &&
    isRecord(circuitSolution.wireCurrentsMa) &&
    Array.isArray(circuitSolution.activeDTCs) &&
    Array.isArray(pins) &&
    Array.isArray(components) &&
    Array.isArray(wires) &&
    Array.isArray(faults);

  if (!hasValidCoreHardwareState) {
    return (
      <main
        ref={mainRef}
        data-layout-tier={layoutTier}
        className="relative flex-1 min-h-0 overflow-hidden p-3 flex items-center justify-center"
      >
        <section
          role="alert"
          aria-label="Workspace Prop Validation Error"
          className="max-w-lg w-full hud-panel border border-rose-500/50 rounded-xl p-4 text-xs font-mono text-rose-200 space-y-2"
        >
          <h2 className="text-sm font-bold text-rose-400 uppercase tracking-wide">
            Workspace Configuration Error
          </h2>
          <p className="text-slate-300 font-sans">
            Required MNA solver or bench hardware props are missing or malformed.
          </p>
          {validationErrors.length > 0 && (
            <ul className="list-disc pl-4 space-y-1 text-[11px] text-rose-300">
              {validationErrors.map((err) => (
                <li key={err}>{err}</li>
              ))}
            </ul>
          )}
        </section>
      </main>
    );
  }

  const renderMoveControls = (pane: MobileBenchPane, title: string) => {
    if (!isContainerMoveMode) return null;
    const idx = paneOrder.indexOf(pane);
    return (
      <div className="flex items-center justify-between gap-2 px-2 py-1 rounded-lg bg-amber-500/15 border border-amber-400/50 text-[10px] font-mono text-amber-200 shrink-0">
        <span className="font-bold uppercase tracking-wide truncate">
          Move: {title} (#{idx + 1})
        </span>
        <div className="flex items-center gap-1 shrink-0">
          <button
            type="button"
            disabled={idx <= 0}
            onClick={() => handleMovePane(pane, 'prev')}
            className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-30 border border-amber-500/40"
            aria-label={`Move ${title} container earlier`}
          >
            ←
          </button>
          <button
            type="button"
            disabled={idx >= paneOrder.length - 1}
            onClick={() => handleMovePane(pane, 'next')}
            className="px-1.5 py-0.5 rounded bg-slate-900 hover:bg-slate-800 disabled:opacity-30 border border-amber-500/40"
            aria-label={`Move ${title} container later`}
          >
            →
          </button>
          <button
            type="button"
            onClick={() => setIsContainerMoveMode(false)}
            className="px-1.5 py-0.5 rounded bg-amber-500 text-slate-950 font-bold"
          >
            Done
          </button>
        </div>
      </div>
    );
  };

  return (
    <main
      ref={mainRef}
      data-layout-tier={layoutTier}
      data-container-size={`${containerSize.width}x${containerSize.height}`}
      className="relative flex-1 min-h-0 overflow-hidden p-1.5 sm:p-3 flex flex-col lg:flex-row gap-2 sm:gap-3"
    >
      {/* BENCH LAB: 3-Pane Workstation (<InstrumentPanels /> | <WiringCanvas /> | <ECUDiagnosticView />) */}
      {activeTab === 'BENCH_LAB' && (
        <>
          {/* Mobile Workspace Switcher (< lg) ordered by paneOrder */}
          <div className="flex lg:hidden items-center gap-1 hud-panel p-1 rounded-lg text-[11px] font-mono shrink-0">
            {paneOrder.map((pane) => {
              const isActive = mobileBenchPane === pane;
              const label =
                pane === 'INSTRUMENTS'
                  ? `Instruments (${circuitSolution.supplyCurrentDrawAmps.toFixed(1)}A)`
                  : pane === 'CANVAS'
                  ? 'Harness Canvas'
                  : `5-Step Guide (${circuitSolution.activeDTCs.length} DTC)`;
              return (
                <button
                  key={pane}
                  type="button"
                  onClick={() => {
                    if (pane === 'GUIDE') {
                      onSetShowDiagnosticGuide(true);
                    }
                    onChangeMobileBenchPane(pane);
                  }}
                  className={`flex-1 py-1.5 px-2 rounded-md text-center transition whitespace-nowrap truncate ${
                    isActive
                      ? 'bg-cyan-500 text-slate-950 font-bold shadow-sm'
                      : 'text-slate-300 hover:text-white'
                  }`}
                >
                  {label}
                </button>
              );
            })}
          </div>

          {paneOrder.map((pane) => {
            if (pane === 'INSTRUMENTS') {
              return (
                <InstrumentPanels
                  key="INSTRUMENTS"
                  visibleOnMobile={mobileBenchPane === 'INSTRUMENTS'}
                  rackFilter={rackFilter}
                  onChangeRackFilter={onChangeRackFilter}
                  powerSupply={powerSupply}
                  onChangePowerSupply={onChangePowerSupply}
                  multimeter={multimeter}
                  onChangeMultimeter={onChangeMultimeter}
                  circuitSolution={circuitSolution}
                  pins={pins}
                  components={components}
                  faults={faults}
                  selectedPinId={selectedPinId}
                  onSelectPin={onSelectPin}
                  onAddFault={onAddFault}
                  onRemoveFault={onRemoveFault}
                  onClearAllFaults={onClearAllFaults}
                  onSearchDtc={onSearchDtc}
                  selectedBrandKey={selectedBrandKey}
                  selectedModelName={selectedModelName}
                  selectedEcuProfileId={selectedEcuProfileId}
                  onSelectVehicleEcu={onSelectVehicleEcu}
                  onOpenEcuPinouts={onOpenEcuPinouts}
                  rpmEmulator={rpmEmulator}
                  onChangeRpmEmulator={onChangeRpmEmulator}
                  onUpdateComponentState={onUpdateComponentState}
                  compactWidth={isCompactDesktop}
                  isShortViewport={isShortContainer}
                  moveControls={renderMoveControls('INSTRUMENTS', 'Instruments')}
                />
              );
            }

            if (pane === 'CANVAS') {
              return (
                <section
                  key="CANVAS"
                  aria-label="Harness Wiring Canvas"
                  className={`flex-1 min-h-0 min-w-0 flex-col gap-1.5 overflow-hidden ${
                    mobileBenchPane === 'CANVAS' ? 'flex' : 'hidden lg:flex'
                  }`}
                >
                  {renderMoveControls('CANVAS', 'Harness Canvas')}
                  <WiringCanvas
                    pins={pins}
                    wires={wires}
                    components={components}
                    nodeVoltages={circuitSolution.nodeVoltages}
                    selectedPinId={selectedPinId}
                    onSelectPin={onSelectPin}
                    onAddWire={onAddWire}
                    onToggleCutWire={onToggleCutWire}
                    onDeleteWire={onDeleteWire}
                    multimeter={multimeter}
                    onAttachProbe={onAttachProbe}
                    onUpdateComponentState={onUpdateComponentState}
                    isPowerOn={powerSupply.isOutputEnabled}
                    onOpenEcuPinouts={onOpenEcuPinouts}
                    simulationSpeed={simulationSpeed}
                  />
                </section>
              );
            }

            return (
              <ECUDiagnosticView
                key="GUIDE"
                visibleOnMobile={mobileBenchPane === 'GUIDE'}
                isOpen={showDiagnosticGuide || mobileBenchPane === 'GUIDE'}
                onClose={() => {
                  onSetShowDiagnosticGuide(false);
                  onChangeMobileBenchPane('INSTRUMENTS');
                }}
                powerSupply={powerSupply}
                pins={pins}
                wires={wires}
                faults={faults}
                circuitSolution={circuitSolution}
                multimeter={multimeter}
                selectedPinId={selectedPinId}
                onSelectPin={onSelectPin}
                onNavigateTab={onNavigateTab}
                onOpenOfflineBot={onOpenOfflineBot}
                compactWidth={isCompactDesktop}
                isShortViewport={isShortContainer}
                moveControls={renderMoveControls('GUIDE', '5-Step Guide')}
              />
            );
          })}
        </>
      )}

      {/* EXPANDED WIRING DIAGRAM */}
      {activeTab === 'WIRING_DIAGRAM' && (
        <section
          aria-label="Harness Wiring Canvas"
          className="flex-1 min-h-0 min-w-0 flex flex-col overflow-hidden w-full gap-3"
        >
          <WiringCanvas
            pins={pins}
            wires={wires}
            components={components}
            nodeVoltages={circuitSolution.nodeVoltages}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            onAddWire={onAddWire}
            onToggleCutWire={onToggleCutWire}
            onDeleteWire={onDeleteWire}
            multimeter={multimeter}
            onAttachProbe={onAttachProbe}
            onUpdateComponentState={onUpdateComponentState}
            isPowerOn={powerSupply.isOutputEnabled}
            onOpenEcuPinouts={onOpenEcuPinouts}
            simulationSpeed={simulationSpeed}
          />
        </section>
      )}

      {/* 3D BENCH TWIN */}
      {activeTab === 'THREE_D_TWIN' && (
        <section aria-label="3D ECU Bench Twin" className="flex-1 min-h-0 min-w-0 flex overflow-hidden w-full">
          <Suspense
            fallback={
              <div className="flex-1 hud-panel rounded-xl flex items-center justify-center text-xs font-mono text-cyan-300">
                Initializing 3D ECU Bench Twin...
              </div>
            }
          >
            <ThreeBenchTwin
              pins={pins}
              wires={wires}
              components={components}
              faults={faults}
              activeDTCs={circuitSolution.activeDTCs}
              nodeVoltages={circuitSolution.nodeVoltages}
              wireCurrentsMa={circuitSolution.wireCurrentsMa}
              multimeter={multimeter}
              powerSupply={powerSupply}
              selectedPinId={selectedPinId}
              simulationSpeed={simulationSpeed}
              onSelectPin={onSelectPin}
              onAttachProbe={onAttachProbe}
              onUpdateComponentState={onUpdateComponentState}
              onOpenOfflineBot={onOpenOfflineBot}
              onOpenGroundedSearch={onOpenGroundedSearch}
            />
          </Suspense>
        </section>
      )}

      {/* ECU CONNECTOR PINOUTS */}
      {activeTab === 'ECU_PINOUT' && (
        <section aria-label="ECU Connector Pinout Library" className="flex-1 min-h-0 min-w-0 flex overflow-hidden w-full">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center text-xs font-mono text-cyan-300">
                Loading ECU Pinouts Library...
              </div>
            }
          >
            <EcuConnectorPinouts
              pins={pins}
              nodeVoltages={circuitSolution.nodeVoltages}
              selectedPinId={selectedPinId}
              onSelectPin={onSelectPin}
              multimeter={multimeter}
              onAttachProbe={onAttachProbe}
              powerSupply={powerSupply}
              externalBrandId={selectedEcuProfileId}
              onSearchLivePinout={(model) =>
                onOpenGroundedSearch(
                  `${model} ECU bench pinout wiring diagram KL30 KL15 KL31 K-Line CAN`,
                  '',
                  model
                )
              }
            />
          </Suspense>
        </section>
      )}

      {/* OSCILLOSCOPE + SPLIT WIRING CANVAS */}
      {activeTab === 'OSCILLOSCOPE' && (
        <section
          aria-label="Oscilloscope and Harness Split View"
          className="flex-1 min-h-0 min-w-0 flex flex-col gap-2.5 sm:gap-3 overflow-y-auto lg:overflow-hidden w-full"
        >
          <div className="flex items-center justify-between gap-2 hud-panel px-2.5 py-1.5 rounded-lg text-[10px] sm:text-xs font-mono shrink-0">
            <span className="text-slate-400 uppercase tracking-wider font-bold hidden sm:inline">
              Oscilloscope Display Mode
            </span>
            <div className="flex items-center gap-1.5 w-full sm:w-auto">
              <button
                type="button"
                onClick={() => setOscilloscopeViewMode('CRT')}
                className={`flex-1 sm:flex-none px-2.5 py-1 rounded border font-semibold transition ${
                  oscilloscopeViewMode === 'CRT'
                    ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                2-CH CRT Storage Scope
              </button>
              <button
                type="button"
                onClick={() => {
                  setOscilloscopeViewMode('RECHARTS_PIN');
                  setShowPinScopeOverlay(false);
                }}
                className={`flex-1 sm:flex-none px-2.5 py-1 rounded border font-semibold transition ${
                  oscilloscopeViewMode === 'RECHARTS_PIN'
                    ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                Selected Pin Trace (Recharts)
              </button>
            </div>
          </div>

          <Suspense
            fallback={
              <div className="h-[280px] hud-panel rounded-xl flex items-center justify-center text-xs font-mono text-cyan-300">
                Initializing Oscilloscope...
              </div>
            }
          >
            {oscilloscopeViewMode === 'CRT' ? (
              <Oscilloscope
                isPowerOn={powerSupply.isOutputEnabled}
                selectedSignal={hasCanFault ? 'CAN_BUS' : 'INJECTOR_PWM'}
                hasCanFault={hasCanFault}
                hasInjectorFault={hasInjectorFault}
                simulationSpeed={simulationSpeed}
                emulatorRpm={rpmEmulator?.rpm}
                isRpmEmulatorActive={rpmEmulator?.isActive}
                isInjectorFiring={isInjectorFiring}
              />
            ) : (
              <PinWaveformOscilloscope
                variant="embedded"
                pins={pins}
                selectedPinId={selectedPinId}
                onSelectPin={(pinId) => onSelectPin(pinId)}
                nodeVoltages={circuitSolution.nodeVoltages}
                faults={faults}
                isPowerOn={powerSupply.isOutputEnabled}
                hasCanFault={hasCanFault}
                hasInjectorFault={hasInjectorFault}
                isInjectorFiring={isInjectorFiring}
                rpm={activeScopeRpm}
                simulationSpeed={simulationSpeed}
              />
            )}
          </Suspense>
          <section
            aria-label="Harness Wiring Canvas"
            className={`flex-1 ${
              isShortContainer ? 'min-h-[220px] sm:min-h-[260px]' : 'min-h-[340px] sm:min-h-[360px]'
            } min-w-0 flex flex-col overflow-hidden`}
          >
            <WiringCanvas
              pins={pins}
              wires={wires}
              components={components}
              nodeVoltages={circuitSolution.nodeVoltages}
              selectedPinId={selectedPinId}
              onSelectPin={onSelectPin}
              onAddWire={onAddWire}
              onToggleCutWire={onToggleCutWire}
              onDeleteWire={onDeleteWire}
              multimeter={multimeter}
              onAttachProbe={onAttachProbe}
              onUpdateComponentState={onUpdateComponentState}
              isPowerOn={powerSupply.isOutputEnabled}
              simulationSpeed={simulationSpeed}
            />
          </section>
        </section>
      )}

      {/* PCB & AI SCHEMATIC SCANNER */}
      {activeTab === 'PCB_SCANNER' && (
        <section aria-label="PCB Schematic Scanner" className="flex-1 min-h-0 min-w-0 flex overflow-hidden w-full">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center text-xs font-mono text-cyan-300">
                Loading PCB Scanner...
              </div>
            }
          >
            <SchematicPcbScanner
              nodeVoltages={circuitSolution.nodeVoltages}
              supplyCurrentDrawAmps={circuitSolution.supplyCurrentDrawAmps}
              powerSupply={powerSupply}
              faults={faults}
              onOpenGroundedSearch={onOpenGroundedSearch}
              onOpenOfflineBot={onOpenOfflineBot}
              onOpenCloudModal={onOpenCloudModal}
            />
          </Suspense>
        </section>
      )}

      {/* ECU REPAIR KNOWLEDGE BASE */}
      {activeTab === 'REPAIR_GUIDE' && (
        <section aria-label="ECU Repair Knowledge Base" className="flex-1 min-h-0 min-w-0 flex overflow-hidden w-full">
          <Suspense
            fallback={
              <div className="flex-1 flex items-center justify-center text-xs font-mono text-cyan-300">
                Loading Repair Knowledge Base...
              </div>
            }
          >
            <EcuRepairKnowledgeBase
              savedSessions={safeSavedSessions}
              savedLogs={safeSavedLogs}
              liveActiveDtcs={circuitSolution.activeDTCs}
              onOpenSavedBenches={onOpenCloudModal}
            />
          </Suspense>
        </section>
      )}
      {/* Recharts Selected-Pin Oscilloscope Overlay + Quick Trigger Pill */}
      {!(activeTab === 'OSCILLOSCOPE' && oscilloscopeViewMode === 'RECHARTS_PIN') && (
        <div className="pointer-events-none fixed sm:absolute bottom-12 sm:bottom-3 left-2.5 sm:left-3 z-30 flex flex-col items-start gap-2 max-w-[calc(100vw-1.25rem)]">
          {showPinScopeOverlay && (
            <div className="pointer-events-auto w-[min(460px,calc(100vw-1.25rem))] shadow-2xl">
              <Suspense
                fallback={
                  <div className="h-[220px] hud-panel rounded-xl flex items-center justify-center text-xs font-mono text-cyan-300">
                    Loading Pin Oscilloscope...
                  </div>
                }
              >
                <PinWaveformOscilloscope
                  variant="overlay"
                  pins={pins}
                  selectedPinId={selectedPinId}
                  onSelectPin={(pinId) => onSelectPin(pinId)}
                  nodeVoltages={circuitSolution.nodeVoltages}
                  faults={faults}
                  isPowerOn={powerSupply.isOutputEnabled}
                  hasCanFault={hasCanFault}
                  hasInjectorFault={hasInjectorFault}
                  isInjectorFiring={isInjectorFiring}
                  rpm={activeScopeRpm}
                  simulationSpeed={simulationSpeed}
                  onClose={() => setShowPinScopeOverlay(false)}
                  onOpenFullScopeTab={() => {
                    onNavigateTab('OSCILLOSCOPE');
                    setOscilloscopeViewMode('RECHARTS_PIN');
                  }}
                />
              </Suspense>
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowPinScopeOverlay((prev) => !prev)}
            aria-expanded={showPinScopeOverlay}
            aria-label="Toggle Pin Oscilloscope Overlay"
            className={`pointer-events-auto flex items-center gap-1.5 px-2.5 py-1.5 rounded-full border text-[10px] sm:text-[11px] font-mono font-bold shadow-lg backdrop-blur-md transition ${
              showPinScopeOverlay
                ? 'bg-cyan-500 text-slate-950 border-cyan-300'
                : 'bg-slate-950/90 hover:bg-slate-900 text-cyan-300 border-cyan-500/40'
            }`}
          >
            <Activity className="w-3.5 h-3.5 shrink-0" />
            <span>Pin Scope</span>
            {selectedPin && (
              <span
                className={`hidden xs:inline tabular-nums ${
                  showPinScopeOverlay ? 'text-slate-900' : 'text-amber-300'
                }`}
              >
                #{selectedPin.pinNumber} ·{' '}
                {(circuitSolution.nodeVoltages[selectedPin.id] ?? 0).toFixed(2)}V
              </span>
            )}
          </button>
        </div>
      )}

      {/* Floating, Draggable Offline AI Voice Assistant Action Button (Mobile-First Accessibility) */}
      <div
        ref={voiceFabRef}
        role="region"
        aria-label="Draggable Offline AI Voice Assistant Action Control"
        onPointerDown={handleVoiceFabPointerDown}
        onPointerMove={handleVoiceFabPointerMove}
        onPointerUp={handleVoiceFabPointerUp}
        onPointerCancel={handleVoiceFabPointerUp}
        style={
          voiceFabPos
            ? { left: `${voiceFabPos.x}px`, top: `${voiceFabPos.y}px`, opacity: voiceFloatingOpacity }
            : { opacity: voiceFloatingOpacity }
        }
        className={`absolute z-30 flex items-center gap-1 rounded-full border p-1 shadow-2xl backdrop-blur-md touch-none select-none transition-opacity duration-150 hover:!opacity-100 focus-within:!opacity-100 ${
          voiceFabPos ? '' : 'right-2.5 sm:right-3 bottom-[68px] sm:bottom-[64px]'
        } ${
          isDraggingVoiceFab
            ? 'cursor-grabbing !opacity-100 border-cyan-300 bg-slate-900/95 scale-[1.03]'
            : isVoiceAssistantActive
            ? 'cursor-grab border-emerald-400/70 bg-slate-950/95'
            : 'cursor-grab border-cyan-500/45 bg-slate-950/90'
        }`}
      >
        <span className="sr-only" role="status" aria-live="polite">
          {voiceFabAnnouncement}
        </span>

        <button
          type="button"
          data-testid="floating-voice-fab"
          aria-pressed={isVoiceAssistantActive}
          aria-label={`Toggle offline AI voice assistant (${isVoiceAssistantActive ? 'Active' : 'Off'}). Drag or use arrow keys to move.`}
          title="Tap to toggle Offline AI Voice Assistant · Hold or Shift+Click for opacity · Drag or Arrow keys to move"
          onKeyDown={handleVoiceFabKeyDown}
          onClick={(e) => {
            if (voiceFabDragRef.current?.moved || voiceFabDragRef.current?.longPressTriggered) {
              return;
            }
            if (e.shiftKey) {
              handleCycleVoiceFloatingOpacity();
              return;
            }
            handleToggleVoiceAssistantState();
          }}
          className={`min-h-[44px] min-w-[44px] px-2.5 py-1.5 rounded-full flex items-center justify-center gap-1.5 text-[11px] font-mono font-bold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
            isVoiceAssistantActive
              ? 'bg-emerald-500 text-slate-950 shadow-sm'
              : 'bg-slate-900 hover:bg-slate-800 text-cyan-200 border border-cyan-500/30'
          }`}
        >
          <GripHorizontal className="w-3.5 h-3.5 opacity-70 shrink-0 hidden xs:inline" aria-hidden="true" />
          {isVoiceAssistantActive ? (
            <Volume2 className="w-4 h-4 shrink-0" aria-hidden="true" />
          ) : (
            <VolumeX className="w-4 h-4 shrink-0" aria-hidden="true" />
          )}
          <span className="whitespace-nowrap">
            {isVoiceAssistantActive ? 'AI Voice ON' : 'AI Voice'}
          </span>
          {isVoiceAssistantActive && (
            <Mic className="w-3 h-3 text-slate-950/85 animate-pulse shrink-0" aria-hidden="true" />
          )}
        </button>

        <button
          type="button"
          data-testid="floating-voice-opacity-btn"
          aria-label={`Toggle offline AI voice assistant opacity (currently ${Math.round(voiceFloatingOpacity * 100)}%)`}
          title="Cycle floating voice assistant opacity (25% / 50% / 75% / 100%)"
          onClick={() => {
            if (voiceFabDragRef.current?.moved || voiceFabDragRef.current?.longPressTriggered) {
              return;
            }
            handleCycleVoiceFloatingOpacity();
          }}
          className="min-h-[40px] min-w-[44px] px-2 py-1 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono font-semibold text-cyan-300 tabular-nums flex items-center justify-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
        >
          <Eye className="w-3 h-3 shrink-0" aria-hidden="true" />
          <span>{Math.round(voiceFloatingOpacity * 100)}%</span>
        </button>
      </div>

      {/* Floating Hold-Press Container Control, Opacity Selector & Offline Voice Navigator */}
      <FloatingLabNavigator
        containerSize={containerSize}
        activeTab={activeTab}
        mobileBenchPane={mobileBenchPane}
        paneOrder={paneOrder}
        isContainerMoveMode={isContainerMoveMode}
        onToggleContainerMoveMode={() => setIsContainerMoveMode((prev) => !prev)}
        onMovePane={handleMovePane}
        onResetPaneOrder={handleResetPaneOrder}
        onSelectMobilePane={(pane) => {
          if (pane === 'GUIDE') {
            onSetShowDiagnosticGuide(true);
          }
          onChangeMobileBenchPane(pane);
        }}
        onNavigateTab={onNavigateTab}
        powerSupply={powerSupply}
        onChangePowerSupply={onChangePowerSupply}
        multimeter={multimeter}
        pins={pins}
        wires={wires}
        faults={faults}
        circuitSolution={circuitSolution}
        selectedPinId={selectedPinId}
        onAttachProbe={onAttachProbe}
        onClearAllFaults={onClearAllFaults}
        onResetLab={onResetLab}
        savedSessions={safeSavedSessions}
        savedLogs={safeSavedLogs}
        vehicleContext={vehicleContext}
        voiceNavEnabled={isVoiceAssistantActive}
        onVoiceNavEnabledChange={handleToggleVoiceAssistantState}
        dockOpacity={voiceFloatingOpacity}
        onDockOpacityChange={setVoiceFloatingOpacity}
      />
    </main>
  );
};
