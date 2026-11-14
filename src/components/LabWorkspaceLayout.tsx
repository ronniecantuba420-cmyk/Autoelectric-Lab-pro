import React, {
  Component,
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  AlertTriangle,
  Eye,
  GripHorizontal,
  Mic,
  Volume2,
  VolumeX,
} from "lucide-react";
import type {
  BenchComponent,
  EcuPin,
  FaultType,
  InjectedFault,
  MultimeterState,
  PowerSupplyState,
  WireConnection,
} from "../types/ecu";
import type { CircuitSolution } from "../utils/circuitSolver";
import type {
  SavedBenchSession,
  SavedDiagnosticLog,
} from "../services/benchStorageService";
import { playModuleActivationSound } from "../utils/audioFeedback";
import { ECUDiagnosticView } from "./ECUDiagnosticView";
import {
  FLOATING_OPACITY_LEVELS,
  FloatingLabNavigator,
} from "./FloatingLabNavigator";
import type { FloatingOpacityLevel } from "./FloatingLabNavigator";
import { InstrumentPanels } from "./InstrumentPanels";
import type { LabTab, MobileBenchPane, RackFilter } from "./LabTopNav";
import { WiringCanvas } from "./WiringCanvas";
import {
  UNIVERSAL_BRAND_KEY,
  getSelectedVehicleContext,
} from "../utils/vehicleEcuRegistry";
import type { RpmEmulatorState } from "../utils/vehicleEcuRegistry";

const Oscilloscope = lazy(() =>
  import("./Oscilloscope").then((m) => ({ default: m.Oscilloscope })),
);
const PinWaveformOscilloscope = lazy(() =>
  import("./PinWaveformOscilloscope").then((m) => ({
    default: m.PinWaveformOscilloscope,
  })),
);
const BinaryStateMonitor = lazy(() =>
  import("./BinaryStateMonitor").then((m) => ({
    default: m.BinaryStateMonitor,
  })),
);
const SchematicPcbScanner = lazy(() =>
  import("./SchematicPcbScanner").then((m) => ({
    default: m.SchematicPcbScanner,
  })),
);
const EcuConnectorPinouts = lazy(() =>
  import("./EcuConnectorPinouts").then((m) => ({
    default: m.EcuConnectorPinouts,
  })),
);
const EcuRepairKnowledgeBase = lazy(() =>
  import("./EcuRepairKnowledgeBase").then((m) => ({
    default: m.EcuRepairKnowledgeBase,
  })),
);
const ThreeBenchTwin = lazy(() =>
  import("./ThreeBenchTwin").then((m) => ({ default: m.ThreeBenchTwin })),
);

export type ProbeColor = "red" | "black";
export type ComponentStateUpdates = Record<string, number | boolean | string>;

/** Public App.tsx contract: existing callers do not need new props. */
export interface LabNavigationProps {
  activeTab: LabTab;
  onNavigateTab: (tab: LabTab) => void;
  rackFilter: RackFilter;
  onChangeRackFilter: (filter: RackFilter) => void;
  mobileBenchPane: MobileBenchPane;
  onChangeMobileBenchPane: (pane: MobileBenchPane) => void;
  showDiagnosticGuide: boolean;
  onSetShowDiagnosticGuide: (open: boolean) => void;
}
export interface LabSimulationProps {
  simulationSpeed: number;
  powerSupply: PowerSupplyState;
  onChangePowerSupply: React.Dispatch<React.SetStateAction<PowerSupplyState>>;
  multimeter: MultimeterState;
  onChangeMultimeter: React.Dispatch<React.SetStateAction<MultimeterState>>;
  circuitSolution: CircuitSolution;
  pins: EcuPin[];
  components: BenchComponent[];
  wires: WireConnection[];
  faults: InjectedFault[];
  selectedPinId: string | null;
  onSelectPin: (pinId: string | null) => void;
  hasCanFault: boolean;
  hasInjectorFault: boolean;
  selectedBrandKey?: string;
  selectedModelName?: string;
  selectedEcuProfileId?: string | null;
  onSelectVehicleEcu?: (
    brandKey: string,
    modelName: string,
    ecuProfileId: string | null,
  ) => void;
  rpmEmulator?: RpmEmulatorState;
  onChangeRpmEmulator?: React.Dispatch<React.SetStateAction<RpmEmulatorState>>;
}
export interface LabFaultCallbacks {
  onAddFault: (
    pinId: string,
    faultType: FaultType,
    description: string,
  ) => void;
  onRemoveFault: (pinId: string) => void;
  onClearAllFaults: () => void;
  onSearchDtc: (code: string, desc: string) => void;
}
export interface LabHarnessCallbacks {
  onAddWire: (
    sourcePinId: string,
    targetPinId: string,
    color?: string,
    label?: string,
  ) => void;
  onToggleCutWire: (wireId: string) => void;
  onDeleteWire: (wireId: string) => void;
  onAttachProbe: (color: ProbeColor, pinId: string, label: string) => void;
  onUpdateComponentState: (
    compId: string,
    updates: ComponentStateUpdates,
  ) => void;
}
export interface LabToolCallbacks {
  onOpenEcuPinouts: () => void;
  onOpenOfflineBot: (prompt?: string) => void;
  onOpenGroundedSearch: (query?: string, dtc?: string, ecu?: string) => void;
  onOpenCloudModal: () => void;
  onResetLab?: () => void;
}
export interface LabCloudDataProps {
  savedSessions: SavedBenchSession[];
  savedLogs: SavedDiagnosticLog[];
}
export interface LabWorkspaceLayoutProps
  extends
    LabNavigationProps,
    LabSimulationProps,
    LabFaultCallbacks,
    LabHarnessCallbacks,
    LabToolCallbacks,
    LabCloudDataProps {}

export type WorkspaceLayoutTier =
  | "COMPACT_MOBILE"
  | "TABLET_SPLIT"
  | "COMPACT_DESKTOP"
  | "WIDE_DESKTOP";

type Size = Readonly<{ width: number; height: number }>;
type Point = Readonly<{ x: number; y: number }>;
type ScopeMode = "CRT" | "RECHARTS_PIN" | "BINARY_MONITOR";
const VALID_LAB_TABS: readonly LabTab[] = [
  "BENCH_LAB",
  "WIRING_DIAGRAM",
  "THREE_D_TWIN",
  "ECU_PINOUT",
  "OSCILLOSCOPE",
  "PCB_SCANNER",
  "REPAIR_GUIDE",
];
const VALID_RACK_FILTERS: readonly RackFilter[] = [
  "ALL",
  "DMM_POWER",
  "FAULT_MATRIX",
];
const DEFAULT_PANE_ORDER: readonly MobileBenchPane[] = [
  "INSTRUMENTS",
  "CANVAS",
  "GUIDE",
];
const REQUIRED_CALLBACK_KEYS: readonly (keyof LabWorkspaceLayoutProps)[] = [
  "onNavigateTab",
  "onChangeRackFilter",
  "onChangeMobileBenchPane",
  "onSetShowDiagnosticGuide",
  "onChangePowerSupply",
  "onChangeMultimeter",
  "onSelectPin",
  "onAddFault",
  "onRemoveFault",
  "onClearAllFaults",
  "onSearchDtc",
  "onAddWire",
  "onToggleCutWire",
  "onDeleteWire",
  "onAttachProbe",
  "onUpdateComponentState",
  "onOpenEcuPinouts",
  "onOpenOfflineBot",
  "onOpenGroundedSearch",
  "onOpenCloudModal",
];
const OPTIONAL_CALLBACK_KEYS: readonly (keyof LabWorkspaceLayoutProps)[] = [
  "onResetLab",
  "onSelectVehicleEcu",
  "onChangeRpmEmulator",
];
const PANEL_LABELS: Record<MobileBenchPane, string> = {
  INSTRUMENTS: "Instruments",
  CANVAS: "Harness Canvas",
  GUIDE: "5-Step Guide",
};
const FAB_MARGIN = 8;
const DRAG_THRESHOLD = 6;
const LONG_PRESS_MS = 420;
const EMPTY_SESSIONS: SavedBenchSession[] = [];
const EMPTY_LOGS: SavedDiagnosticLog[] = [];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isFiniteNumber = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value);
const isFiniteRecord = (value: unknown): value is Record<string, number> =>
  isRecord(value) && Object.values(value).every(isFiniteNumber);

/** Checks the consumed hardware boundary; domain-specific nested schemas remain in their owners. */
function getHardwareErrors(props: Partial<LabWorkspaceLayoutProps>): string[] {
  const errors: string[] = [];
  const supply: unknown = props.powerSupply;
  if (!isRecord(supply)) errors.push('Prop "powerSupply" must be an object.');
  else {
    if (!isFiniteNumber(supply.voltageSetting) || supply.voltageSetting < 0)
      errors.push(
        'Prop "powerSupply.voltageSetting" must be finite and non-negative.',
      );
    if (!isFiniteNumber(supply.currentLimit) || supply.currentLimit < 0)
      errors.push(
        'Prop "powerSupply.currentLimit" must be finite and non-negative.',
      );
    if (typeof supply.isOutputEnabled !== "boolean")
      errors.push('Prop "powerSupply.isOutputEnabled" must be a boolean.');
  }
  const meter: unknown = props.multimeter;
  if (!isRecord(meter)) errors.push('Prop "multimeter" must be an object.');
  else {
    if (typeof meter.mode !== "string")
      errors.push('Prop "multimeter.mode" must be a string.');
    if (!isRecord(meter.redProbe) || !isRecord(meter.blackProbe))
      errors.push("Multimeter redProbe and blackProbe must be objects.");
  }
  const solution: unknown = props.circuitSolution;
  if (!isRecord(solution))
    errors.push('Prop "circuitSolution" must be an MNA snapshot.');
  else {
    for (const key of ["nodeVoltages", "wireCurrentsMa"]) {
      if (!isFiniteRecord(solution[key]))
        errors.push(
          `Prop "circuitSolution.${key}" must contain only finite numbers.`,
        );
    }
    if (!isRecord(solution.multimeterReading))
      errors.push(
        'Prop "circuitSolution.multimeterReading" must be an object.',
      );
    if (!Array.isArray(solution.activeDTCs))
      errors.push('Prop "circuitSolution.activeDTCs" must be an array.');
    if (!isFiniteNumber(solution.supplyCurrentDrawAmps))
      errors.push(
        'Prop "circuitSolution.supplyCurrentDrawAmps" must be finite.',
      );
  }
  for (const key of ["pins", "components", "wires", "faults"] as const) {
    const items: unknown = props[key];
    if (!Array.isArray(items)) errors.push(`Prop "${key}" must be an array.`);
    else if (!items.every(isRecord))
      errors.push(`Prop "${key}" must contain only objects.`);
  }
  if (
    Array.isArray(props.pins) &&
    !props.pins.every(
      (pin) =>
        isRecord(pin) &&
        typeof pin.id === "string" &&
        isFiniteNumber(pin.pinNumber),
    )
  )
    errors.push("Every pin must have a string id and finite pinNumber.");
  if (
    Array.isArray(props.components) &&
    !props.components.every(
      (component) =>
        isRecord(component) &&
        typeof component.id === "string" &&
        (component.state === undefined || isRecord(component.state)),
    )
  )
    errors.push(
      "Every component needs a string id and an object state when provided.",
    );
  for (const key of REQUIRED_CALLBACK_KEYS) {
    if (typeof props[key] !== "function")
      errors.push(`Callback prop "${key}" must be a function.`);
  }
  for (const key of OPTIONAL_CALLBACK_KEYS) {
    if (props[key] !== undefined && typeof props[key] !== "function")
      errors.push(
        `Optional callback "${key}" must be a function when provided.`,
      );
  }
  if (props.rpmEmulator !== undefined) {
    const rpm: unknown = props.rpmEmulator;
    if (
      !isRecord(rpm) ||
      typeof rpm.isActive !== "boolean" ||
      !isFiniteNumber(rpm.rpm) ||
      rpm.rpm < 0 ||
      typeof rpm.soundEnabled !== "boolean"
    )
      errors.push(
        "rpmEmulator requires boolean isActive/soundEnabled and finite non-negative rpm.",
      );
  }
  for (const key of [
    "showDiagnosticGuide",
    "hasCanFault",
    "hasInjectorFault",
  ] as const) {
    if (typeof props[key] !== "boolean")
      errors.push(`Prop "${key}" must be a boolean.`);
  }
  if (props.selectedPinId !== null && typeof props.selectedPinId !== "string")
    errors.push('Prop "selectedPinId" must be a string or null.');
  for (const key of ["selectedBrandKey", "selectedModelName"] as const) {
    if (props[key] !== undefined && typeof props[key] !== "string")
      errors.push(`Optional prop "${key}" must be a string.`);
  }
  if (
    props.selectedEcuProfileId !== undefined &&
    props.selectedEcuProfileId !== null &&
    typeof props.selectedEcuProfileId !== "string"
  )
    errors.push("selectedEcuProfileId must be a string, null, or undefined.");
  return errors;
}

/** Navigation and saved-data issues that the workspace can safely normalize. */
function getRecoverableErrors(
  props: Partial<LabWorkspaceLayoutProps>,
): string[] {
  const errors: string[] = [];
  if (!props.activeTab || !VALID_LAB_TABS.includes(props.activeTab))
    errors.push(`Invalid "activeTab": received "${String(props.activeTab)}".`);
  if (!props.rackFilter || !VALID_RACK_FILTERS.includes(props.rackFilter))
    errors.push(
      `Invalid "rackFilter": received "${String(props.rackFilter)}".`,
    );
  if (
    !props.mobileBenchPane ||
    !DEFAULT_PANE_ORDER.includes(props.mobileBenchPane)
  )
    errors.push(
      `Invalid "mobileBenchPane": received "${String(props.mobileBenchPane)}".`,
    );
  if (!isFiniteNumber(props.simulationSpeed) || props.simulationSpeed <= 0)
    errors.push('Prop "simulationSpeed" must be a positive finite number.');
  for (const key of ["savedSessions", "savedLogs"] as const) {
    if (!Array.isArray(props[key]) || !props[key]?.every(isRecord))
      errors.push(`Prop "${key}" must be an array of objects.`);
  }
  return errors;
}

/** Returns boundary violations without throwing for malformed nested hardware data. */
export function validateLabWorkspaceProps(
  props: Partial<LabWorkspaceLayoutProps>,
): string[] {
  return [...getHardwareErrors(props), ...getRecoverableErrors(props)];
}

/** Shared by drag, keyboard movement, and resize correction. */
function clampPosition(point: Point, bounds: Size, element: Size): Point {
  // Reduce the margin when the container cannot fit the control; never produce negative coordinates.
  const availableX = Math.max(0, bounds.width - element.width);
  const availableY = Math.max(0, bounds.height - element.height);
  const minX = Math.min(FAB_MARGIN, availableX / 2);
  const minY = Math.min(FAB_MARGIN, availableY / 2);
  return {
    x: Math.min(Math.max(minX, point.x), Math.max(minX, availableX - minX)),
    y: Math.min(Math.max(minY, point.y), Math.max(minY, availableY - minY)),
  };
}

/** Observes the actual mounted node, including replacements after validation errors. */
function useWorkspaceSize(element: HTMLElement | null): Size {
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    if (!element) return;
    let frame: number | null = null;
    const measure = () => {
      frame = null;
      // clientWidth/clientHeight match the padding-box coordinates of absolute-positioned controls.
      const width = element.clientWidth;
      const height = element.clientHeight;
      setSize((previous) =>
        previous.width === width && previous.height === height
          ? previous
          : { width, height },
      );
    };
    const schedule = () => {
      if (frame === null) frame = window.requestAnimationFrame(measure);
    };
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(schedule);
    observer?.observe(element);
    window.addEventListener("resize", schedule);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", schedule);
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [element]);
  return size;
}

interface ModuleBoundaryProps {
  children: React.ReactNode;
  label: string;
  resetKey: string;
  onReturnToBench: () => void;
}
class ModuleErrorBoundary extends Component<
  ModuleBoundaryProps,
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error(
      `[LabWorkspaceLayout] ${this.props.label} failed:`,
      error,
      info,
    );
  }
  componentDidUpdate(previous: ModuleBoundaryProps) {
    if (previous.resetKey !== this.props.resetKey && this.state.failed)
      this.setState({ failed: false });
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <section
        role="alert"
        className="hud-panel rounded-xl border border-rose-500/40 p-4 min-w-0"
      >
        <h2 className="flex items-center gap-2 text-sm font-bold text-rose-300">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          {this.props.label} is unavailable
        </h2>
        <p className="mt-2 text-xs text-slate-300">
          The module could not load or render. Return to the bench, or reload to
          fetch application assets. Reloading may discard unsaved changes.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={this.props.onReturnToBench}
            className="rounded bg-cyan-500 px-3 py-2 text-xs font-bold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200"
          >
            Return to bench
          </button>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded border border-slate-600 px-3 py-2 text-xs text-slate-200 focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-200"
          >
            Reload application
          </button>
        </div>
      </section>
    );
  }
}
function LoadingPanel({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="hud-panel flex min-h-[180px] w-full flex-1 items-center justify-center gap-2 rounded-xl p-4 text-xs font-mono text-cyan-300"
    >
      <Activity
        className="h-4 w-4 motion-safe:animate-pulse"
        aria-hidden="true"
      />
      <span>Loading {label}…</span>
    </div>
  );
}
function LazyModule({
  children,
  label,
  resetKey,
  onReturnToBench,
}: ModuleBoundaryProps) {
  return (
    <ModuleErrorBoundary
      label={label}
      resetKey={resetKey}
      onReturnToBench={onReturnToBench}
    >
      <Suspense fallback={<LoadingPanel label={label} />}>{children}</Suspense>
    </ModuleErrorBoundary>
  );
}

interface FloatingVoiceControlProps {
  container: HTMLElement | null;
  containerSize: Size;
  active: boolean;
  opacity: FloatingOpacityLevel;
  announcement: string;
  onToggle: () => void;
  onCycleOpacity: () => void;
}
interface DragSession {
  pointerId: number;
  start: Point;
  origin: Point;
  moved: boolean;
  captureTarget: HTMLElement;
}

/** Pointer mechanics are isolated so every drag frame does not re-render the whole lab. */
function FloatingVoiceControl({
  container,
  containerSize,
  active,
  opacity,
  announcement,
  onToggle,
  onCycleOpacity,
}: FloatingVoiceControlProps) {
  const ref = useRef<HTMLDivElement>(null);
  const drag = useRef<DragSession | null>(null);
  const timer = useRef<number | null>(null);
  const suppressClick = useRef(false);
  const [position, setPosition] = useState<Point | null>(null);
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState("");
  const instructionsId = useId();

  const clearHold = useCallback(() => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
  }, []);
  const getGeometry = useCallback(() => {
    const element = ref.current;
    return {
      bounds: {
        width: container?.clientWidth || containerSize.width || 0,
        height: container?.clientHeight || containerSize.height || 0,
      },
      element: {
        width: element?.offsetWidth ?? 148,
        height: element?.offsetHeight ?? 48,
      },
      origin: {
        x: element?.offsetLeft ?? FAB_MARGIN,
        y: element?.offsetTop ?? FAB_MARGIN,
      },
    };
  }, [container, containerSize.width, containerSize.height]);

  // Observe the FAB too: active text, font loading, and breakpoints can change its dimensions.
  useEffect(() => {
    const node = ref.current;
    const reclamp = () => {
      const geometry = getGeometry();
      if (geometry.bounds.width <= 0 || geometry.bounds.height <= 0) return;
      setPosition((previous) => {
        if (!previous) return previous;
        const next = clampPosition(previous, geometry.bounds, geometry.element);
        return next.x === previous.x && next.y === previous.y ? previous : next;
      });
    };
    reclamp();
    const observer =
      node && typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(reclamp)
        : null;
    if (node) observer?.observe(node);
    return () => observer?.disconnect();
  }, [getGeometry, active]);

  const endInteraction = useCallback(
    (cancelled: boolean) => {
      clearHold();
      const current = drag.current;
      drag.current = null;
      if (cancelled) suppressClick.current = true;
      if (current) {
        try {
          if (current.captureTarget.hasPointerCapture(current.pointerId))
            current.captureTarget.releasePointerCapture(current.pointerId);
        } catch {
          /* A detached control may already have lost capture. */
        }
      }
      setDragging(false);
    },
    [clearHold],
  );

  useEffect(() => {
    const cancel = () => endInteraction(true);
    const onVisibility = () => {
      if (document.hidden) cancel();
    };
    window.addEventListener("blur", cancel);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("blur", cancel);
      document.removeEventListener("visibilitychange", onVisibility);
      clearHold();
      const current = drag.current;
      drag.current = null;
      if (current) {
        try {
          current.captureTarget.releasePointerCapture(current.pointerId);
        } catch {
          /* Detached. */
        }
      }
    };
  }, [clearHold, endInteraction]);

  const pointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.isPrimary || event.button !== 0 || drag.current) return;
    clearHold();
    suppressClick.current = false;
    setNotice("");
    const target =
      event.target instanceof Element ? event.target.closest("button") : null;
    // Capture on the originating button, not its parent, so normal button clicks retain their target.
    const captureTarget =
      target instanceof HTMLElement ? target : event.currentTarget;
    drag.current = {
      pointerId: event.pointerId,
      start: { x: event.clientX, y: event.clientY },
      origin: getGeometry().origin,
      moved: false,
      captureTarget,
    };
    try {
      captureTarget.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic events. */
    }
    timer.current = window.setTimeout(() => {
      timer.current = null;
      if (!drag.current || drag.current.moved) return;
      suppressClick.current = true;
      try {
        navigator.vibrate?.(20);
      } catch {
        /* Optional platform capability. */
      }
      onCycleOpacity();
    }, LONG_PRESS_MS);
  };
  const pointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current || current.pointerId !== event.pointerId) return;
    const dx = event.clientX - current.start.x;
    const dy = event.clientY - current.start.y;
    if (!current.moved && Math.hypot(dx, dy) > DRAG_THRESHOLD) {
      current.moved = true;
      suppressClick.current = true;
      clearHold();
      setDragging(true);
    }
    if (!current.moved) return;
    const geometry = getGeometry();
    // Convert viewport pointer deltas to local CSS coordinates for scaled host containers.
    const rect = container?.getBoundingClientRect();
    const scaleX =
      container && rect && container.offsetWidth > 0
        ? rect.width / container.offsetWidth
        : 1;
    const scaleY =
      container && rect && container.offsetHeight > 0
        ? rect.height / container.offsetHeight
        : 1;
    setPosition(
      clampPosition(
        {
          x: current.origin.x + dx / (scaleX || 1),
          y: current.origin.y + dy / (scaleY || 1),
        },
        geometry.bounds,
        geometry.element,
      ),
    );
  };
  const pointerEnd = (
    event: React.PointerEvent<HTMLDivElement>,
    cancelled: boolean,
  ) => {
    if (drag.current?.pointerId === event.pointerId) endInteraction(cancelled);
  };
  const keyDown = (event: React.KeyboardEvent<HTMLButtonElement>) => {
    const vectors: Record<string, Point> = {
      ArrowLeft: { x: -1, y: 0 },
      ArrowRight: { x: 1, y: 0 },
      ArrowUp: { x: 0, y: -1 },
      ArrowDown: { x: 0, y: 1 },
    };
    const vector = vectors[event.key];
    if (vector) {
      event.preventDefault();
      const geometry = getGeometry();
      const step = event.shiftKey ? 32 : 16;
      const next = clampPosition(
        {
          x: geometry.origin.x + vector.x * step,
          y: geometry.origin.y + vector.y * step,
        },
        geometry.bounds,
        geometry.element,
      );
      setPosition(next);
      setNotice(
        `Voice control moved to ${Math.round(next.x)}, ${Math.round(next.y)}.`,
      );
    } else if (event.key === "Home") {
      event.preventDefault();
      setPosition(null);
      setNotice("Voice control returned to its default position.");
    } else if (
      event.key.toLowerCase() === "o" &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.altKey
    ) {
      event.preventDefault();
      setNotice("");
      onCycleOpacity();
    } else if (event.key === "Escape") {
      endInteraction(true);
    }
  };
  const clickAllowed = (event: React.MouseEvent<HTMLButtonElement>) =>
    event.detail === 0 || !suppressClick.current;

  return (
    <div
      ref={ref}
      role="region"
      aria-label="Draggable offline AI voice assistant control"
      onPointerDown={pointerDown}
      onPointerMove={pointerMove}
      onPointerUp={(event) => pointerEnd(event, false)}
      onPointerCancel={(event) => pointerEnd(event, true)}
      onLostPointerCapture={(event) => pointerEnd(event, true)}
      style={
        position ? { left: position.x, top: position.y, opacity } : { opacity }
      }
      className={`absolute z-40 flex max-w-full items-center gap-1 rounded-full border p-1 shadow-2xl backdrop-blur-md touch-none select-none transition-opacity motion-reduce:transition-none hover:!opacity-100 focus-within:!opacity-100 ${
        position ? "" : "right-2.5 bottom-[68px] sm:bottom-3 sm:right-[236px]"
      } ${
        dragging
          ? "cursor-grabbing !opacity-100 border-cyan-300 bg-slate-900/95"
          : active
            ? "cursor-grab border-emerald-400/70 bg-slate-950/95"
            : "cursor-grab border-cyan-500/45 bg-slate-950/90"
      }`}
    >
      <span id={instructionsId} className="sr-only">
        Enter or Space activates the focused control. Arrow keys move; Shift
        increases the step. Home resets position. O cycles opacity. Drag to
        move, or hold to cycle opacity.
      </span>
      <span
        className="sr-only"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {notice || announcement}
      </span>
      <button
        type="button"
        data-testid="floating-voice-fab"
        aria-pressed={active}
        aria-label={`Offline AI voice assistant ${active ? "active" : "off"}`}
        aria-describedby={instructionsId}
        onKeyDown={keyDown}
        title="Toggle voice · Hold or Shift+Click for opacity · Drag or Arrow keys to move"
        onClick={(event) => {
          if (!clickAllowed(event)) return;
          setNotice("");
          if (event.shiftKey) onCycleOpacity();
          else onToggle();
        }}
        className={`flex min-h-[44px] min-w-[44px] items-center justify-center gap-1.5 rounded-full px-2.5 py-1.5 text-[11px] font-mono font-bold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
          active
            ? "bg-emerald-500 text-slate-950"
            : "border border-cyan-500/30 bg-slate-900 text-cyan-200 hover:bg-slate-800"
        }`}
      >
        <GripHorizontal
          className="hidden h-3.5 w-3.5 shrink-0 opacity-70 xs:inline"
          aria-hidden="true"
        />
        {active ? (
          <Volume2 className="h-4 w-4 shrink-0" aria-hidden="true" />
        ) : (
          <VolumeX className="h-4 w-4 shrink-0" aria-hidden="true" />
        )}
        <span className="whitespace-nowrap">
          {active ? "AI Voice ON" : "AI Voice"}
        </span>
        {active && (
          <Mic
            className="h-3 w-3 shrink-0 motion-safe:animate-pulse"
            aria-hidden="true"
          />
        )}
      </button>
      <button
        type="button"
        data-testid="floating-voice-opacity-btn"
        onKeyDown={keyDown}
        aria-label={`Cycle voice control opacity, currently ${Math.round(opacity * 100)} percent`}
        aria-describedby={instructionsId}
        title="Cycle floating voice control opacity"
        onClick={(event) => {
          if (clickAllowed(event)) {
            setNotice("");
            onCycleOpacity();
          }
        }}
        className="flex min-h-[44px] min-w-[44px] items-center justify-center gap-1 rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-[10px] font-mono font-semibold text-cyan-300 tabular-nums hover:bg-slate-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
      >
        <Eye className="h-3 w-3 shrink-0" aria-hidden="true" />
        <span>{Math.round(opacity * 100)}%</span>
      </button>
    </div>
  );
}

/** Validation is outside the live workspace: malformed props cannot reach context derivation or children. */
export const LabWorkspaceLayout: React.FC<LabWorkspaceLayoutProps> = (
  props,
) => {
  const fatalErrors = getHardwareErrors(props);
  const errors = [...fatalErrors, ...getRecoverableErrors(props)];
  const signature = errors.join("\n");
  useEffect(() => {
    if (import.meta.env.DEV && signature)
      console.error(
        "[LabWorkspaceLayout] Runtime prop validation failed:\n" + signature,
      );
  }, [signature]);
  if (fatalErrors.length > 0) {
    return (
      <main className="relative flex min-h-0 flex-1 items-center justify-center overflow-auto p-3">
        <section
          role="alert"
          aria-label="Workspace configuration error"
          className="hud-panel max-h-full w-full max-w-lg overflow-auto rounded-xl border border-rose-500/50 p-4 text-xs text-rose-200"
        >
          <h2 className="text-sm font-bold uppercase tracking-wide text-rose-300">
            Workspace configuration error
          </h2>
          <p className="my-2 text-slate-300">
            Required hardware data or callbacks are missing or malformed.
          </p>
          <ul className="list-disc space-y-1 pl-4 font-mono">
            {fatalErrors.map((error) => (
              <li key={error}>{error}</li>
            ))}
          </ul>
        </section>
      </main>
    );
  }
  return <WorkspaceContent {...props} />;
};

/** Layout-only controller. Electrical behavior remains owned by App.tsx and the solver. */
function WorkspaceContent(props: LabWorkspaceLayoutProps) {
  const {
    onNavigateTab,
    onChangeRackFilter,
    onChangeMobileBenchPane,
    showDiagnosticGuide,
    onSetShowDiagnosticGuide,
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
  } = props;
  const activeTab = VALID_LAB_TABS.includes(props.activeTab)
    ? props.activeTab
    : "BENCH_LAB";
  const rackFilter = VALID_RACK_FILTERS.includes(props.rackFilter)
    ? props.rackFilter
    : "ALL";
  const mobileBenchPane = DEFAULT_PANE_ORDER.includes(props.mobileBenchPane)
    ? props.mobileBenchPane
    : "INSTRUMENTS";
  const simulationSpeed =
    isFiniteNumber(props.simulationSpeed) && props.simulationSpeed > 0
      ? props.simulationSpeed
      : 1;
  const safeSavedSessions = useMemo(
    () =>
      Array.isArray(props.savedSessions)
        ? props.savedSessions.filter(isRecord)
        : EMPTY_SESSIONS,
    [props.savedSessions],
  );
  const safeSavedLogs = useMemo(
    () =>
      Array.isArray(props.savedLogs)
        ? props.savedLogs.filter(isRecord)
        : EMPTY_LOGS,
    [props.savedLogs],
  );
  const [mainElement, setMainElement] = useState<HTMLElement | null>(null);
  const attachMain = useCallback((node: HTMLElement | null) => {
    setMainElement(node);
  }, []);
  const containerSize = useWorkspaceSize(mainElement);
  const [paneOrder, setPaneOrder] = useState<MobileBenchPane[]>(() => [
    ...DEFAULT_PANE_ORDER,
  ]);
  const [isContainerMoveMode, setIsContainerMoveMode] = useState(false);
  const [showPinScopeOverlay, setShowPinScopeOverlay] = useState(false);
  const [oscilloscopeViewMode, setOscilloscopeViewMode] =
    useState<ScopeMode>("CRT");
  const [isVoiceAssistantActive, setIsVoiceAssistantActive] = useState(false);
  const [voiceFloatingOpacity, setVoiceFloatingOpacity] =
    useState<FloatingOpacityLevel>(0.75);
  const [voiceAnnouncement, setVoiceAnnouncement] = useState("");
  const previousVoiceState = useRef(isVoiceAssistantActive);
  const previousOpacity = useRef(voiceFloatingOpacity);
  const generatedId = useId();
  const paneId = (pane: MobileBenchPane) =>
    `${generatedId}-${pane.toLowerCase()}`;
  const scopeOverlayId = `${generatedId}-scope-overlay`;
  const selectedPin = useMemo(
    () => pins.find((pin) => pin.id === selectedPinId) ?? pins[0],
    [pins, selectedPinId],
  );
  const isInjectorFiring = useMemo(() => {
    const injector = components.find(
      (component) => component.id === "comp-inj",
    );
    return Boolean(injector?.state?.isFiring ?? true);
  }, [components]);
  const activeScopeRpm = rpmEmulator?.isActive ? rpmEmulator.rpm : 850;
  const activeCamPhaseOffsetDeg = rpmEmulator?.camPhaseOffsetDeg ?? 0;
  const isCkpSignalLost = Boolean(rpmEmulator?.ckpSignalLost);
  const vehicleContext = useMemo(
    () =>
      getSelectedVehicleContext(
        selectedBrandKey || UNIVERSAL_BRAND_KEY,
        selectedModelName || "Generic 16-Pin Bench",
        selectedEcuProfileId ?? null,
      ),
    [selectedBrandKey, selectedModelName, selectedEcuProfileId],
  );
  const activeProfileLabel =
    vehicleContext.brandKey === UNIVERSAL_BRAND_KEY
      ? "Universal 16-Pin"
      : vehicleContext.modelName;
  const layoutTier: WorkspaceLayoutTier =
    containerSize.width < 768
      ? "COMPACT_MOBILE"
      : containerSize.width < 1024
        ? "TABLET_SPLIT"
        : containerSize.width < 1280
          ? "COMPACT_DESKTOP"
          : "WIDE_DESKTOP";
  const isCompactDesktop = layoutTier === "COMPACT_DESKTOP";
  const isShortContainer =
    containerSize.height > 0 && containerSize.height < 680;

  // Updaters are pure. Audio and announcements run only after committed state changes.
  const toggleVoice = useCallback((nextState?: boolean) => {
    setIsVoiceAssistantActive((previous) =>
      typeof nextState === "boolean" ? nextState : !previous,
    );
  }, []);
  const cycleOpacity = useCallback(() => {
    setVoiceFloatingOpacity((previous) => {
      const index = FLOATING_OPACITY_LEVELS.indexOf(previous);
      return (
        FLOATING_OPACITY_LEVELS[(index + 1) % FLOATING_OPACITY_LEVELS.length] ??
        0.75
      );
    });
  }, []);
  useEffect(() => {
    if (previousVoiceState.current === isVoiceAssistantActive) return;
    previousVoiceState.current = isVoiceAssistantActive;
    if (rpmEmulator?.soundEnabled !== false) {
      try {
        playModuleActivationSound(isVoiceAssistantActive, "sensor");
      } catch (error) {
        if (import.meta.env.DEV)
          console.warn("Activation audio unavailable:", error);
      }
    }
    setVoiceAnnouncement(
      isVoiceAssistantActive
        ? "Offline AI voice assistant activated."
        : "Offline AI voice assistant paused.",
    );
  }, [isVoiceAssistantActive, rpmEmulator?.soundEnabled]);
  useEffect(() => {
    if (previousOpacity.current === voiceFloatingOpacity) return;
    previousOpacity.current = voiceFloatingOpacity;
    setVoiceAnnouncement(
      `Voice control opacity set to ${Math.round(voiceFloatingOpacity * 100)} percent.`,
    );
  }, [voiceFloatingOpacity]);
  const movePane = useCallback(
    (pane: MobileBenchPane, direction: "prev" | "next") => {
      setPaneOrder((previous) => {
        const index = previous.indexOf(pane);
        const target = index + (direction === "prev" ? -1 : 1);
        if (index < 0 || target < 0 || target >= previous.length)
          return previous;
        const next = [...previous];
        [next[index], next[target]] = [next[target], next[index]];
        return next;
      });
    },
    [],
  );
  const resetPaneOrder = useCallback(
    () => setPaneOrder([...DEFAULT_PANE_ORDER]),
    [],
  );
  const selectMobilePane = useCallback(
    (pane: MobileBenchPane) => {
      if (pane === "GUIDE") onSetShowDiagnosticGuide(true);
      onChangeMobileBenchPane(pane);
    },
    [onSetShowDiagnosticGuide, onChangeMobileBenchPane],
  );
  const returnToBench = useCallback(() => {
    setShowPinScopeOverlay(false);
    onNavigateTab("BENCH_LAB");
  }, [onNavigateTab]);
  const closeGuide = useCallback(() => {
    onSetShowDiagnosticGuide(false);
    onChangeMobileBenchPane("INSTRUMENTS");
  }, [onSetShowDiagnosticGuide, onChangeMobileBenchPane]);
  const openFullScope = useCallback(() => {
    setShowPinScopeOverlay(false);
    setOscilloscopeViewMode("RECHARTS_PIN");
    onNavigateTab("OSCILLOSCOPE");
  }, [onNavigateTab]);
  const closePinOverlay = useCallback(() => setShowPinScopeOverlay(false), []);

  useEffect(() => {
    if (
      activeTab !== "BENCH_LAB" &&
      activeTab !== "WIRING_DIAGRAM" &&
      activeTab !== "OSCILLOSCOPE"
    ) {
      setShowPinScopeOverlay(false);
    }
  }, [activeTab]);

  // One prop contract for all harness instances: fixes the missing pinout action in scope split view.
  const canvasProps = useMemo(
    () => ({
      pins,
      wires,
      components,
      nodeVoltages: circuitSolution.nodeVoltages,
      selectedPinId,
      onSelectPin,
      onAddWire,
      onToggleCutWire,
      onDeleteWire,
      multimeter,
      onAttachProbe,
      onUpdateComponentState,
      isPowerOn: powerSupply.isOutputEnabled,
      onOpenEcuPinouts,
      simulationSpeed,
      ecuProfileLabel: activeProfileLabel,
      hasInjectorFault,
    }),
    [
      pins,
      wires,
      components,
      circuitSolution.nodeVoltages,
      selectedPinId,
      onSelectPin,
      onAddWire,
      onToggleCutWire,
      onDeleteWire,
      multimeter,
      onAttachProbe,
      onUpdateComponentState,
      powerSupply.isOutputEnabled,
      onOpenEcuPinouts,
      simulationSpeed,
      activeProfileLabel,
      hasInjectorFault,
    ],
  );
  const pinScopeProps = useMemo(
    () => ({
      pins,
      selectedPinId,
      onSelectPin,
      nodeVoltages: circuitSolution.nodeVoltages,
      faults,
      isPowerOn: powerSupply.isOutputEnabled,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm: activeScopeRpm,
      simulationSpeed,
    }),
    [
      pins,
      selectedPinId,
      onSelectPin,
      circuitSolution.nodeVoltages,
      faults,
      powerSupply.isOutputEnabled,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      activeScopeRpm,
      simulationSpeed,
    ],
  );
  const moveControls = (pane: MobileBenchPane) => {
    if (!isContainerMoveMode) return null;
    const index = paneOrder.indexOf(pane);
    return (
      <div
        role="group"
        aria-label={`Reorder ${PANEL_LABELS[pane]}`}
        className="flex shrink-0 items-center justify-between gap-2 rounded-lg border border-amber-400/50 bg-amber-500/15 px-2 py-1 text-[10px] font-mono text-amber-200"
      >
        <span className="truncate font-bold">
          Move: {PANEL_LABELS[pane]} (#{index + 1})
        </span>
        <div className="flex shrink-0 items-center gap-1">
          {(["prev", "next"] as const).map((direction) => (
            <button
              key={direction}
              type="button"
              onClick={() => movePane(pane, direction)}
              disabled={
                direction === "prev"
                  ? index === 0
                  : index === paneOrder.length - 1
              }
              aria-label={`Move ${PANEL_LABELS[pane]} ${direction === "prev" ? "earlier" : "later"}`}
              className="min-h-[32px] min-w-[32px] rounded border border-amber-500/40 bg-slate-900 px-2 disabled:opacity-30 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-300"
            >
              {direction === "prev" ? "←" : "→"}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setIsContainerMoveMode(false)}
            className="min-h-[32px] rounded bg-amber-500 px-2 font-bold text-slate-950 focus-visible:outline focus-visible:outline-2 focus-visible:outline-amber-200"
          >
            Done
          </button>
        </div>
      </div>
    );
  };
  const module = (label: string, content: React.ReactNode, suffix = "") => (
    <LazyModule
      label={label}
      resetKey={`${activeTab}:${suffix}`}
      onReturnToBench={returnToBench}
    >
      {content}
    </LazyModule>
  );
  const fullPaneClass = "flex-1 min-h-0 min-w-0 flex overflow-hidden w-full";
  const isEmbeddedPinScope =
    activeTab === "OSCILLOSCOPE" &&
    (oscilloscopeViewMode === "RECHARTS_PIN" ||
      oscilloscopeViewMode === "BINARY_MONITOR");

  return (
    <main
      ref={attachMain}
      data-layout-tier={layoutTier}
      data-container-size={`${containerSize.width}x${containerSize.height}`}
      aria-label="Virtual ECU laboratory workspace"
      className="relative flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-1.5 sm:gap-3 sm:p-3 lg:flex-row"
    >
      <ModuleErrorBoundary
        label="Workspace view"
        resetKey={activeTab}
        onReturnToBench={returnToBench}
      >
        {activeTab === "BENCH_LAB" && (
          <>
            <nav
              aria-label="Mobile workspace panes"
              className="hud-panel flex shrink-0 items-center gap-1 rounded-lg p-1 text-[11px] font-mono lg:hidden"
            >
              {paneOrder.map((pane) => (
                <button
                  key={pane}
                  type="button"
                  aria-pressed={mobileBenchPane === pane}
                  onClick={() => selectMobilePane(pane)}
                  className={`min-h-[44px] min-w-0 flex-1 truncate whitespace-nowrap rounded-md px-2 py-1.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 ${
                    mobileBenchPane === pane
                      ? "bg-cyan-500 font-bold text-slate-950 shadow-sm"
                      : "text-slate-300 hover:text-white"
                  }`}
                >
                  {pane === "INSTRUMENTS"
                    ? `Instruments (${circuitSolution.supplyCurrentDrawAmps.toFixed(1)}A)`
                    : pane === "GUIDE"
                      ? `5-Step Guide (${circuitSolution.activeDTCs.length} DTC)`
                      : "Harness Canvas"}
                </button>
              ))}
            </nav>
            {paneOrder.map((pane) => {
              if (pane === "INSTRUMENTS")
                return (
                  <React.Fragment key={pane}>
                    <InstrumentPanels
                      visibleOnMobile={mobileBenchPane === pane}
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
                      moveControls={moveControls(pane)}
                    />
                  </React.Fragment>
                );
              if (pane === "CANVAS")
                return (
                  <section
                    key={pane}
                    id={paneId(pane)}
                    aria-label="Harness wiring canvas"
                    className={`min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden ${mobileBenchPane === pane ? "flex" : "hidden lg:flex"}`}
                  >
                    {moveControls(pane)}
                    <WiringCanvas {...canvasProps} />
                  </section>
                );
              return (
                <React.Fragment key={pane}>
                  <ECUDiagnosticView
                    visibleOnMobile={mobileBenchPane === pane}
                    isOpen={showDiagnosticGuide || mobileBenchPane === pane}
                    onClose={closeGuide}
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
                    moveControls={moveControls(pane)}
                  />
                </React.Fragment>
              );
            })}
          </>
        )}
        {activeTab === "WIRING_DIAGRAM" && (
          <section
            aria-label="Expanded harness wiring canvas"
            className={`${fullPaneClass} flex-col`}
          >
            <WiringCanvas {...canvasProps} />
          </section>
        )}
        {activeTab === "THREE_D_TWIN" && (
          <section aria-label="3D ECU bench twin" className={fullPaneClass}>
            {module(
              "3D ECU Bench Twin",
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
              />,
            )}
          </section>
        )}
        {activeTab === "ECU_PINOUT" && (
          <section
            aria-label="ECU connector pinout library"
            className={fullPaneClass}
          >
            {module(
              "ECU Pinouts Library",
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
                    "",
                    model,
                  )
                }
              />,
            )}
          </section>
        )}
        {activeTab === "OSCILLOSCOPE" && (
          <section
            aria-label="Oscilloscope and harness split view"
            className="flex min-h-0 min-w-0 flex-1 flex-col gap-2.5 overflow-y-auto sm:gap-3 lg:overflow-hidden"
          >
            <div className="hud-panel flex shrink-0 flex-wrap items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-[10px] font-mono sm:text-xs">
              <span className="hidden font-bold uppercase tracking-wider text-slate-400 sm:inline">
                Oscilloscope display mode
              </span>
              <div
                role="group"
                aria-label="Oscilloscope display mode"
                className="flex w-full flex-wrap gap-1.5 sm:w-auto"
              >
                {(["CRT", "RECHARTS_PIN", "BINARY_MONITOR"] as const).map(
                  (mode) => (
                    <button
                      key={mode}
                      type="button"
                      aria-pressed={oscilloscopeViewMode === mode}
                      onClick={() => {
                        setOscilloscopeViewMode(mode);
                        if (mode !== "CRT") setShowPinScopeOverlay(false);
                      }}
                      className={`min-h-[44px] flex-1 rounded border px-2.5 py-1 font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:flex-none ${
                        oscilloscopeViewMode === mode
                          ? "border-cyan-400 bg-cyan-500/20 text-cyan-200"
                          : "border-slate-800 bg-slate-950 text-slate-400 hover:text-white"
                      }`}
                    >
                      {mode === "CRT"
                        ? "2-CH CRT Storage Scope"
                        : mode === "RECHARTS_PIN"
                          ? "Selected Pin Trace (Recharts)"
                          : "Binary State Monitor (PWM / CAN)"}
                    </button>
                  ),
                )}
              </div>
            </div>
            <div className="min-w-0 shrink-0">
              {module(
                "Oscilloscope",
                oscilloscopeViewMode === "CRT" ? (
                  <Oscilloscope
                    isPowerOn={powerSupply.isOutputEnabled}
                    selectedSignal={hasCanFault ? "CAN_BUS" : "INJECTOR_PWM"}
                    hasCanFault={hasCanFault}
                    hasInjectorFault={hasInjectorFault}
                    simulationSpeed={simulationSpeed}
                    emulatorRpm={rpmEmulator?.rpm}
                    isRpmEmulatorActive={rpmEmulator?.isActive}
                    isInjectorFiring={isInjectorFiring}
                    camPhaseOffsetDeg={activeCamPhaseOffsetDeg}
                    ckpSignalLost={isCkpSignalLost}
                    pins={pins}
                    nodeVoltages={circuitSolution.nodeVoltages}
                    faults={faults}
                    selectedPinId={selectedPinId}
                    onSelectPin={(pinId) => onSelectPin(pinId)}
                  />
                ) : oscilloscopeViewMode === "RECHARTS_PIN" ? (
                  <PinWaveformOscilloscope
                    variant="embedded"
                    {...pinScopeProps}
                  />
                ) : (
                  <BinaryStateMonitor variant="full" {...pinScopeProps} />
                ),
                oscilloscopeViewMode,
              )}
            </div>
            <section
              aria-label="Harness wiring canvas"
              className={`flex min-w-0 flex-1 flex-col overflow-hidden ${isShortContainer ? "min-h-[220px] sm:min-h-[260px]" : "min-h-[340px] sm:min-h-[360px]"}`}
            >
              <WiringCanvas {...canvasProps} />
            </section>
          </section>
        )}
        {activeTab === "PCB_SCANNER" && (
          <section aria-label="PCB schematic scanner" className={fullPaneClass}>
            {module(
              "PCB Scanner",
              <SchematicPcbScanner
                nodeVoltages={circuitSolution.nodeVoltages}
                supplyCurrentDrawAmps={circuitSolution.supplyCurrentDrawAmps}
                powerSupply={powerSupply}
                faults={faults}
                onOpenGroundedSearch={onOpenGroundedSearch}
                onOpenOfflineBot={onOpenOfflineBot}
                onOpenCloudModal={onOpenCloudModal}
              />,
            )}
          </section>
        )}
        {activeTab === "REPAIR_GUIDE" && (
          <section
            aria-label="ECU repair knowledge base"
            className={fullPaneClass}
          >
            {module(
              "Repair Knowledge Base",
              <EcuRepairKnowledgeBase
                savedSessions={safeSavedSessions}
                savedLogs={safeSavedLogs}
                liveActiveDtcs={circuitSolution.activeDTCs}
                onOpenSavedBenches={onOpenCloudModal}
              />,
            )}
          </section>
        )}
      </ModuleErrorBoundary>

      {!isEmbeddedPinScope &&
        (activeTab === "BENCH_LAB" || activeTab === "WIRING_DIAGRAM") && (
        <div className="pointer-events-none fixed bottom-[116px] left-2.5 z-30 flex max-w-[calc(100vw-1.25rem)] flex-col items-start gap-2 sm:absolute sm:bottom-3 sm:left-3">
          {showPinScopeOverlay && (
            <section
              id={scopeOverlayId}
              aria-label="Selected pin oscilloscope overlay"
              className="pointer-events-auto max-h-[70dvh] w-[min(460px,calc(100vw-1.25rem))] overflow-auto shadow-2xl"
            >
              {module(
                "Pin Oscilloscope",
                <PinWaveformOscilloscope
                  variant="overlay"
                  {...pinScopeProps}
                  onClose={closePinOverlay}
                  onOpenFullScopeTab={openFullScope}
                />,
                "overlay",
              )}
            </section>
          )}
          <button
            type="button"
            aria-expanded={showPinScopeOverlay}
            aria-controls={showPinScopeOverlay ? scopeOverlayId : undefined}
            aria-label="Toggle pin oscilloscope overlay"
            onClick={() => setShowPinScopeOverlay((previous) => !previous)}
            className={`pointer-events-auto flex min-h-[44px] items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] font-mono font-bold shadow-lg backdrop-blur-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 sm:text-[11px] ${
              showPinScopeOverlay
                ? "border-cyan-300 bg-cyan-500 text-slate-950"
                : "border-cyan-500/40 bg-slate-950/90 text-cyan-300 hover:bg-slate-900"
            }`}
          >
            <Activity className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Pin Scope</span>
            {selectedPin && (
              <span
                className={`hidden tabular-nums xs:inline ${showPinScopeOverlay ? "text-slate-900" : "text-amber-300"}`}
              >
                #{selectedPin.pinNumber} ·{" "}
                {(circuitSolution.nodeVoltages[selectedPin.id] ?? 0).toFixed(2)}
                V
              </span>
            )}
          </button>
        </div>
      )}
      <FloatingVoiceControl
        container={mainElement}
        containerSize={containerSize}
        active={isVoiceAssistantActive}
        opacity={voiceFloatingOpacity}
        announcement={voiceAnnouncement}
        onToggle={toggleVoice}
        onCycleOpacity={cycleOpacity}
      />
      <ModuleErrorBoundary
        label="Floating lab navigator"
        resetKey={activeTab}
        onReturnToBench={returnToBench}
      >
        <FloatingLabNavigator
          containerSize={containerSize}
          activeTab={activeTab}
          mobileBenchPane={mobileBenchPane}
          paneOrder={paneOrder}
          isContainerMoveMode={isContainerMoveMode}
          onToggleContainerMoveMode={() =>
            setIsContainerMoveMode((previous) => !previous)
          }
          onMovePane={movePane}
          onResetPaneOrder={resetPaneOrder}
          onSelectMobilePane={selectMobilePane}
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
          onVoiceNavEnabledChange={toggleVoice}
          dockOpacity={voiceFloatingOpacity}
          onDockOpacityChange={setVoiceFloatingOpacity}
        />
      </ModuleErrorBoundary>
    </main>
  );
}
