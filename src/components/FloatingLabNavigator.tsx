import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight,
  Bot,
  ChevronDown,
  ChevronUp,
  Eye,
  GripVertical,
  Mic,
  MicOff,
  Move,
  RotateCcw,
  Send,
  Volume2,
  VolumeX,
} from 'lucide-react';
import { SavedBenchSession, SavedDiagnosticLog } from '../services/benchStorageService';
import { LiveBenchContext, OfflineDiagnosticChatbot } from '../services/offlineChatbotEngine';
import { offlineVoiceAssistant, VoiceAssistantState } from '../services/offlineVoiceService';
import {
  EcuPin,
  InjectedFault,
  MultimeterState,
  PowerSupplyState,
  WireConnection,
} from '../types/ecu';
import { CircuitSolution } from '../utils/circuitSolver';
import { SelectedVehicleContext } from '../utils/vehicleEcuRegistry';
import { parseAndExecuteVoiceCommand } from '../utils/voiceCommandParser';
import { LabTab, MobileBenchPane } from './LabTopNav';

export type FloatingOpacityLevel = 0.25 | 0.5 | 0.75 | 1;

export const FLOATING_OPACITY_LEVELS: readonly FloatingOpacityLevel[] = [0.25, 0.5, 0.75, 1];

const PANE_LABELS: Record<MobileBenchPane, string> = {
  INSTRUMENTS: 'Instruments',
  CANVAS: 'Canvas',
  GUIDE: 'Guide',
};

export interface FloatingLabNavigatorProps {
  /** Measured `<main>` workspace dimensions from `ResizeObserver` for drag clamping. */
  containerSize: { width: number; height: number };
  activeTab: LabTab;
  mobileBenchPane: MobileBenchPane;
  paneOrder: MobileBenchPane[];
  isContainerMoveMode: boolean;
  onToggleContainerMoveMode: () => void;
  onMovePane: (pane: MobileBenchPane, direction: 'prev' | 'next') => void;
  onResetPaneOrder: () => void;
  onSelectMobilePane: (pane: MobileBenchPane) => void;
  onNavigateTab: (tab: LabTab) => void;
  powerSupply: PowerSupplyState;
  onChangePowerSupply: React.Dispatch<React.SetStateAction<PowerSupplyState>>;
  multimeter: MultimeterState;
  pins: EcuPin[];
  wires: WireConnection[];
  faults: InjectedFault[];
  circuitSolution: CircuitSolution;
  selectedPinId: string | null;
  onAttachProbe: (color: 'red' | 'black', pinId: string, label: string) => void;
  onClearAllFaults: () => void;
  onResetLab?: () => void;
  savedSessions: SavedBenchSession[];
  savedLogs: SavedDiagnosticLog[];
  vehicleContext?: SelectedVehicleContext;
  /** Controlled offline AI voice navigator enabled state managed by LabWorkspaceLayout. */
  voiceNavEnabled?: boolean;
  /** Controlled updater for offline AI voice navigator enabled state. */
  onVoiceNavEnabledChange?: (next: boolean) => void;
  /** Controlled opacity level shared with LabWorkspaceLayout's floating draggable voice button. */
  dockOpacity?: FloatingOpacityLevel;
  /** Controlled updater for floating opacity level. */
  onDockOpacityChange?: (next: FloatingOpacityLevel) => void;
}

export const FloatingLabNavigator: React.FC<FloatingLabNavigatorProps> = ({
  containerSize,
  activeTab,
  mobileBenchPane,
  paneOrder,
  isContainerMoveMode,
  onToggleContainerMoveMode,
  onMovePane,
  onResetPaneOrder,
  onSelectMobilePane,
  onNavigateTab,
  powerSupply,
  onChangePowerSupply,
  multimeter,
  pins,
  wires,
  faults,
  circuitSolution,
  selectedPinId,
  onAttachProbe,
  onClearAllFaults,
  onResetLab,
  savedSessions,
  savedLogs,
  vehicleContext,
  voiceNavEnabled: controlledVoiceNavEnabled,
  onVoiceNavEnabledChange,
  dockOpacity: controlledDockOpacity,
  onDockOpacityChange,
}) => {
  const [internalVoiceNavEnabled, setInternalVoiceNavEnabled] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [internalDockOpacity, setInternalDockOpacity] = useState<FloatingOpacityLevel>(0.75);
  const [commandInput, setCommandInput] = useState('');

  const voiceNavEnabled = controlledVoiceNavEnabled ?? internalVoiceNavEnabled;
  const dockOpacity = controlledDockOpacity ?? internalDockOpacity;

  const setVoiceNavEnabled = useCallback(
    (updater: boolean | ((prev: boolean) => boolean)) => {
      const next =
        typeof updater === 'function' ? updater(voiceNavEnabled) : updater;
      if (onVoiceNavEnabledChange) {
        onVoiceNavEnabledChange(next);
      } else {
        setInternalVoiceNavEnabled(next);
      }
    },
    [onVoiceNavEnabledChange, voiceNavEnabled]
  );

  const setDockOpacity = useCallback(
    (next: FloatingOpacityLevel) => {
      if (onDockOpacityChange) {
        onDockOpacityChange(next);
      } else {
        setInternalDockOpacity(next);
      }
    },
    [onDockOpacityChange]
  );
  const [voiceResult, setVoiceResult] = useState<{
    title: string;
    detail: string;
    timestamp: number;
  } | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceAssistantState>(() =>
    offlineVoiceAssistant.getState()
  );

  // Draggable dock offset (x, y relative to `<main>`); null uses anchored bottom-right corner
  const [dockPos, setDockPos] = useState<{ x: number; y: number } | null>(null);
  const [isDraggingDock, setIsDraggingDock] = useState(false);
  const dockRef = useRef<HTMLDivElement>(null);

  const holdTimerRef = useRef<number | null>(null);
  const holdTriggeredRef = useRef(false);
  const pointerStartRef = useRef<{
    clientX: number;
    clientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  } | null>(null);

  // Lazy-build offline MiniSearch bot only once Voice Navigator is turned ON or drawer expanded
  const botEngine = useMemo(() => {
    if (!voiceNavEnabled && !isExpanded) return null;
    return new OfflineDiagnosticChatbot(savedLogs, savedSessions);
  }, [voiceNavEnabled, isExpanded, savedLogs, savedSessions]);

  // Subscribe to W3C Web Speech API controller when mounted
  useEffect(() => {
    const unsub = offlineVoiceAssistant.subscribe((next) => setVoiceState(next));
    return () => {
      unsub();
      offlineVoiceAssistant.stopListening();
      offlineVoiceAssistant.stopSpeaking();
    };
  }, []);

  // Re-clamp dragged dock whenever container dimensions shrink via ResizeObserver
  useEffect(() => {
    if (!dockPos || containerSize.width <= 0 || containerSize.height <= 0) return;
    const dockRect = dockRef.current?.getBoundingClientRect();
    const dockW = dockRect?.width ?? 280;
    const dockH = dockRect?.height ?? 64;
    const maxX = Math.max(8, containerSize.width - dockW - 8);
    const maxY = Math.max(8, containerSize.height - dockH - 8);
    const clampedX = Math.min(Math.max(8, dockPos.x), maxX);
    const clampedY = Math.min(Math.max(8, dockPos.y), maxY);
    if (clampedX !== dockPos.x || clampedY !== dockPos.y) {
      setDockPos({ x: clampedX, y: clampedY });
    }
  }, [containerSize.width, containerSize.height, dockPos]);

  const liveContext = useMemo<LiveBenchContext>(
    () => ({
      powerSupply,
      pins,
      wires,
      faults,
      activeDTCs: circuitSolution.activeDTCs,
      nodeVoltages: circuitSolution.nodeVoltages,
      supplyCurrentDrawAmps: circuitSolution.supplyCurrentDrawAmps,
      isSupplyCurrentTripped: circuitSolution.isSupplyCurrentTripped,
      multimeter,
      multimeterDisplay: circuitSolution.multimeterReading.display,
      multimeterUnit: circuitSolution.multimeterReading.unit,
      multimeterWarning: circuitSolution.multimeterReading.warningMessage,
      selectedPinId,
    }),
    [powerSupply, pins, wires, faults, circuitSolution, multimeter, selectedPinId]
  );

  const announceVoiceResult = useCallback(
    (title: string, detail: string, speakText?: string) => {
      setVoiceResult({ title, detail, timestamp: Date.now() });
      if (voiceNavEnabled) {
        offlineVoiceAssistant.speak(speakText ?? detail, true);
      }
    },
    [voiceNavEnabled]
  );

  // Automatic spoken + visual "Voice Result" whenever technician works in the lab while Voice Nav is ON
  const prevLabSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    const dtcCodes = circuitSolution.activeDTCs.map((d) => d.code).join(',');
    const signature = [
      activeTab,
      mobileBenchPane,
      powerSupply.isOutputEnabled ? '1' : '0',
      powerSupply.voltageSetting.toFixed(1),
      multimeter.mode,
      multimeter.redProbe.attachedToPinId || 'none',
      multimeter.blackProbe.attachedToPinId || 'none',
      faults.length,
      dtcCodes,
    ].join('|');

    if (!voiceNavEnabled) {
      prevLabSignatureRef.current = signature;
      return;
    }

    const prev = prevLabSignatureRef.current;
    prevLabSignatureRef.current = signature;
    if (!prev || prev === signature) return;

    const prevParts = prev.split('|');
    const [
      prevTab,
      prevPane,
      prevPwrOn,
      prevVolts,
      prevMode,
      prevRed,
      prevBlack,
      prevFaultCount,
      prevDtcs,
    ] = prevParts;

    // Prioritize highest-impact workshop event for Voice Result readout
    if (dtcCodes !== prevDtcs || String(faults.length) !== prevFaultCount) {
      if (circuitSolution.activeDTCs.length > 0) {
        const dtcMsg = `${circuitSolution.activeDTCs.length} Active DTC: ${circuitSolution.activeDTCs
          .map((d) => `${d.code} ${d.description}`)
          .join('; ')}`;
        announceVoiceResult(
          'Fault / DTC Alert',
          dtcMsg,
          `Fault detected. Active D T C ${circuitSolution.activeDTCs.map((d) => d.code).join(' and ')}.`
        );
      } else if (faults.length > 0) {
        const latestFault = faults[faults.length - 1];
        const msg = `${latestFault.description} (${latestFault.faultType}) · DMM ${circuitSolution.multimeterReading.display} ${circuitSolution.multimeterReading.unit} · 0 DTC`;
        announceVoiceResult(
          'Fault Injected',
          msg,
          `Fault injected: ${latestFault.description}. Multimeter reads ${circuitSolution.multimeterReading.display} ${circuitSolution.multimeterReading.unit}.`
        );
      } else {
        const msg = `Nominal recovery · 0 active DTCs · PSU drawing ${circuitSolution.supplyCurrentDrawAmps.toFixed(2)}A`;
        announceVoiceResult(
          'Nominal Recovery',
          msg,
          'All faults cleared. Nominal bench state restored.'
        );
      }
      return;
    }

    if (
      multimeter.redProbe.attachedToPinId !== prevRed ||
      multimeter.blackProbe.attachedToPinId !== prevBlack ||
      multimeter.mode !== prevMode
    ) {
      const targetLabel = multimeter.redProbe.attachedLabel || 'probe';
      const warning = circuitSolution.multimeterReading.warningMessage;
      const readingText = warning
        ? warning
        : `${targetLabel} (${multimeter.mode}): ${circuitSolution.multimeterReading.display} ${circuitSolution.multimeterReading.unit}`;
      announceVoiceResult(
        `DMM · ${multimeter.mode}`,
        readingText,
        warning
          ? `Multimeter warning. ${warning}`
          : `Probe on ${targetLabel}. Reading ${circuitSolution.multimeterReading.display} ${circuitSolution.multimeterReading.unit}.`
      );
      return;
    }

    if (
      (powerSupply.isOutputEnabled ? '1' : '0') !== prevPwrOn ||
      powerSupply.voltageSetting.toFixed(1) !== prevVolts
    ) {
      const msg = powerSupply.isOutputEnabled
        ? `PSU ON · ${powerSupply.voltageSetting.toFixed(1)}V · ${circuitSolution.supplyCurrentDrawAmps.toFixed(2)}A`
        : 'PSU Output OFF (Key-OFF)';
      announceVoiceResult(
        'Power Supply Updated',
        msg,
        powerSupply.isOutputEnabled
          ? `Power supply on at ${powerSupply.voltageSetting.toFixed(1)} volts, drawing ${circuitSolution.supplyCurrentDrawAmps.toFixed(2)} amps.`
          : 'Power supply output switched off.'
      );
      return;
    }

    if (activeTab !== prevTab || mobileBenchPane !== prevPane) {
      const viewLabel =
        activeTab === 'BENCH_LAB'
          ? `Bench Lab · ${PANE_LABELS[mobileBenchPane]}`
          : activeTab.replace(/_/g, ' ');
      announceVoiceResult('Workspace Navigation', viewLabel, `Focused ${viewLabel}.`);
    }
  }, [
    voiceNavEnabled,
    activeTab,
    mobileBenchPane,
    powerSupply.isOutputEnabled,
    powerSupply.voltageSetting,
    multimeter.mode,
    multimeter.redProbe.attachedToPinId,
    multimeter.redProbe.attachedLabel,
    multimeter.blackProbe.attachedToPinId,
    faults,
    circuitSolution.activeDTCs,
    circuitSolution.supplyCurrentDrawAmps,
    circuitSolution.multimeterReading.display,
    circuitSolution.multimeterReading.unit,
    circuitSolution.multimeterReading.warningMessage,
    announceVoiceResult,
  ]);

  // Automatic spoken Voice-Guide & OCR_VERIFY gating notice whenever selected vehicle changes
  const prevVehicleSigRef = useRef<string | null>(null);
  useEffect(() => {
    if (!vehicleContext) return;
    const sig = `${vehicleContext.brandKey}|${vehicleContext.modelName}|${vehicleContext.status}`;
    if (!voiceNavEnabled) {
      prevVehicleSigRef.current = sig;
      return;
    }
    const prev = prevVehicleSigRef.current;
    prevVehicleSigRef.current = sig;
    if (!prev || prev === sig) return;

    const title = `${vehicleContext.brandLabel} ${vehicleContext.modelName} · ${vehicleContext.status}`;
    const detail = vehicleContext.gateAlert || vehicleContext.controllerNote;
    const spoken =
      vehicleContext.spokenAlert ||
      `Selected ${vehicleContext.brandLabel} ${vehicleContext.modelName}. Status: ${vehicleContext.status}.`;
    announceVoiceResult(title, detail, spoken);
  }, [voiceNavEnabled, vehicleContext, announceVoiceResult]);

  const executeVoiceOrTextQuery = useCallback(
    (rawQuery: string) => {
      const trimmed = rawQuery.trim();
      if (!trimmed) return;

      // 1. Deterministic offline command parser
      const cmd = parseAndExecuteVoiceCommand(trimmed, pins, {
        setVoltage: (volts) =>
          onChangePowerSupply((prev) => ({
            ...prev,
            voltageSetting: volts,
            preset: 'CUSTOM',
          })),
        resetLab: () => {
          onResetLab?.();
        },
        attachProbeToPin: (pinId, label) => onAttachProbe('red', pinId, label),
        setPowerSupplyOutput: (enabled) =>
          onChangePowerSupply((prev) => ({ ...prev, isOutputEnabled: enabled })),
        switchTab: (tab) => onNavigateTab(tab),
        switchMobilePane: (pane) => onSelectMobilePane(pane),
        clearFaults: onClearAllFaults,
        readMeter: () => ({
          display: circuitSolution.multimeterReading.display,
          unit: circuitSolution.multimeterReading.unit,
          dtcCount: circuitSolution.activeDTCs.length,
          supplyVolts: powerSupply.voltageSetting,
          isPowerOn: powerSupply.isOutputEnabled,
          supplyAmps: circuitSolution.supplyCurrentDrawAmps,
        }),
      });

      if (cmd.matched) {
        announceVoiceResult(`Command: "${trimmed}"`, cmd.actionDescription, cmd.spokenReply);
        return;
      }

      // 2. Fallback to offline MiniSearch AI diagnostic engine
      const engine = botEngine ?? new OfflineDiagnosticChatbot(savedLogs, savedSessions);
      const reply = engine.ask(trimmed, liveContext);
      const cleanSummary = reply.answer
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .replace(/•\s*/g, '')
        .split('\n')
        .filter(Boolean)
        .slice(0, 2)
        .join(' · ');

      announceVoiceResult(`Offline AI: "${trimmed}"`, cleanSummary, reply.answer);
    },
    [
      pins,
      onChangePowerSupply,
      onResetLab,
      onAttachProbe,
      onNavigateTab,
      onSelectMobilePane,
      onClearAllFaults,
      circuitSolution.multimeterReading.display,
      circuitSolution.multimeterReading.unit,
      circuitSolution.activeDTCs.length,
      circuitSolution.supplyCurrentDrawAmps,
      powerSupply.voltageSetting,
      powerSupply.isOutputEnabled,
      announceVoiceResult,
      botEngine,
      savedLogs,
      savedSessions,
      liveContext,
    ]
  );

  // Sync speech recognition/synthesis lifecycle whenever voiceNavEnabled transitions (from FAB or dock switch)
  const prevVoiceNavEnabledRef = useRef(voiceNavEnabled);
  useEffect(() => {
    const wasEnabled = prevVoiceNavEnabledRef.current;
    prevVoiceNavEnabledRef.current = voiceNavEnabled;
    if (wasEnabled === voiceNavEnabled) return;

    if (voiceNavEnabled) {
      offlineVoiceAssistant.setAutoSpeak(true);
      const intro = `Voice Navigator ON · DMM ${circuitSolution.multimeterReading.display} ${circuitSolution.multimeterReading.unit} · ${circuitSolution.activeDTCs.length} DTC`;
      setVoiceResult({ title: 'Offline Voice Active', detail: intro, timestamp: Date.now() });
      offlineVoiceAssistant.speak(
        `Offline voice navigator active. Multimeter reads ${circuitSolution.multimeterReading.display} ${circuitSolution.multimeterReading.unit}.`,
        true
      );
    } else {
      offlineVoiceAssistant.stopListening();
      offlineVoiceAssistant.stopSpeaking();
    }
  }, [
    voiceNavEnabled,
    circuitSolution.multimeterReading.display,
    circuitSolution.multimeterReading.unit,
    circuitSolution.activeDTCs.length,
  ]);

  const handleToggleVoiceNav = () => {
    setVoiceNavEnabled((prev) => !prev);
  };

  const handleStartListening = () => {
    if (!voiceNavEnabled) {
      setVoiceNavEnabled(true);
      offlineVoiceAssistant.setAutoSpeak(true);
    }
    if (voiceState.isListening) {
      offlineVoiceAssistant.stopListening();
      return;
    }
    if (!voiceState.hasSpeechRecognition) {
      setIsExpanded(true);
      setVoiceResult({
        title: 'Mic Unavailable — Offline Command Box Open',
        detail: 'Use quick navigation chips or type a command (e.g. "Read meter", "Show canvas", "P0122").',
        timestamp: Date.now(),
      });
      return;
    }
    offlineVoiceAssistant.startListening((spokenText) => {
      executeVoiceOrTextQuery(spokenText);
    });
  };

  // Hold-press & drag gestures on the floating button
  const clearHoldTimer = () => {
    if (holdTimerRef.current !== null) {
      window.clearTimeout(holdTimerRef.current);
      holdTimerRef.current = null;
    }
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    e.currentTarget.setPointerCapture(e.pointerId);

    const dockRect = dockRef.current?.getBoundingClientRect();
    const parentRect = dockRef.current?.parentElement?.getBoundingClientRect();
    const originX = dockPos ? dockPos.x : Math.max(8, (dockRect?.left ?? 0) - (parentRect?.left ?? 0));
    const originY = dockPos ? dockPos.y : Math.max(8, (dockRect?.top ?? 0) - (parentRect?.top ?? 0));

    holdTriggeredRef.current = false;
    pointerStartRef.current = {
      clientX: e.clientX,
      clientY: e.clientY,
      originX,
      originY,
      moved: false,
    };

    clearHoldTimer();
    holdTimerRef.current = window.setTimeout(() => {
      if (pointerStartRef.current && !pointerStartRef.current.moved) {
        holdTriggeredRef.current = true;
        if (typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function') {
          navigator.vibrate(25);
        }
        onToggleContainerMoveMode();
      }
    }, 380);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const start = pointerStartRef.current;
    if (!start) return;

    const dx = e.clientX - start.clientX;
    const dy = e.clientY - start.clientY;
    if (!start.moved && Math.hypot(dx, dy) > 6) {
      start.moved = true;
      clearHoldTimer();
      setIsDraggingDock(true);
    }

    if (start.moved) {
      const dockRect = dockRef.current?.getBoundingClientRect();
      const dockW = dockRect?.width ?? 260;
      const dockH = dockRect?.height ?? 56;
      const maxX = Math.max(8, (containerSize.width || window.innerWidth) - dockW - 8);
      const maxY = Math.max(8, (containerSize.height || window.innerHeight) - dockH - 8);
      setDockPos({
        x: Math.min(Math.max(8, start.originX + dx), maxX),
        y: Math.min(Math.max(8, start.originY + dy), maxY),
      });
    }
  };

  const handlePointerUp = () => {
    clearHoldTimer();
    const wasMoved = pointerStartRef.current?.moved ?? false;
    pointerStartRef.current = null;
    setIsDraggingDock(false);

    if (!wasMoved && !holdTriggeredRef.current) {
      setIsExpanded((prev) => !prev);
    }
  };

  const handleCycleOpacity = () => {
    const idx = FLOATING_OPACITY_LEVELS.indexOf(dockOpacity);
    const next = FLOATING_OPACITY_LEVELS[(idx + 1) % FLOATING_OPACITY_LEVELS.length];
    setDockOpacity(next);
  };

  const handleSubmitCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!commandInput.trim()) return;
    executeVoiceOrTextQuery(commandInput);
    setCommandInput('');
  };

  const positionStyle: React.CSSProperties = dockPos
    ? { left: `${dockPos.x}px`, top: `${dockPos.y}px`, opacity: dockOpacity }
    : { right: '12px', bottom: '12px', opacity: dockOpacity };

  return (
    <div
      ref={dockRef}
      style={positionStyle}
      aria-label="Floating Lab Voice and Container Controls"
      className={`absolute z-30 flex flex-col items-end gap-1.5 max-w-[calc(100%-16px)] transition-opacity duration-150 hover:!opacity-100 focus-within:!opacity-100 ${
        isDraggingDock ? 'cursor-grabbing !opacity-100' : ''
      }`}
    >
      {/* Voice Result Live Toast Banner (shown when Voice Navigator is ON) */}
      {voiceNavEnabled && voiceResult && (
        <div
          role="status"
          aria-live="polite"
          className="w-[300px] sm:w-[340px] hud-panel border border-cyan-500/50 bg-slate-950/95 rounded-xl px-3 py-2 shadow-2xl backdrop-blur-md text-[11px]"
        >
          <div className="flex items-center justify-between gap-2 mb-0.5">
            <span className="font-mono font-bold text-cyan-300 flex items-center gap-1.5 truncate">
              <Volume2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
              {voiceResult.title}
            </span>
            <div className="flex items-center gap-1 shrink-0">
              {voiceState.isSpeaking && (
                <button
                  type="button"
                  onClick={() => offlineVoiceAssistant.stopSpeaking()}
                  className="px-1.5 py-0.5 rounded bg-rose-950/80 border border-rose-500/40 text-[9px] font-mono text-rose-200 hover:bg-rose-900/80"
                  title="Stop Speaking"
                >
                  Stop
                </button>
              )}
              <button
                type="button"
                onClick={() => setVoiceResult(null)}
                className="text-slate-400 hover:text-white font-mono text-[10px] px-1"
                aria-label="Dismiss voice result"
              >
                ×
              </button>
            </div>
          </div>
          <p className="text-slate-200 font-sans leading-snug line-clamp-3">{voiceResult.detail}</p>
        </div>
      )}

      {/* Expanded Quick Navigator, Container Reorder, Opacity & Offline AI Drawer */}
      {isExpanded && (
        <div
          aria-label="Quick Navigator Drawer"
          className="w-[305px] sm:w-[345px] hud-panel border border-cyan-500/40 bg-slate-950/95 rounded-xl p-2.5 shadow-2xl backdrop-blur-md space-y-2.5 text-[11px]"
        >
          {/* Container Move Mode & Quick Reorder */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-bold text-[10px] uppercase tracking-wider text-slate-300 flex items-center gap-1">
                <Move className="w-3 h-3 text-cyan-400" />
                Bench Containers
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onToggleContainerMoveMode}
                  aria-pressed={isContainerMoveMode}
                  className={`px-2 py-0.5 rounded font-mono text-[10px] border transition ${
                    isContainerMoveMode
                      ? 'bg-amber-500/20 border-amber-400/60 text-amber-200 font-bold'
                      : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
                  }`}
                >
                  {isContainerMoveMode ? 'Done Moving' : 'Move Mode'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    onResetPaneOrder();
                    setDockPos(null);
                  }}
                  className="p-1 rounded bg-slate-900 border border-slate-700 text-slate-400 hover:text-white"
                  title="Reset Container & Dock Positions"
                  aria-label="Reset container and floating button position"
                >
                  <RotateCcw className="w-3 h-3" />
                </button>
              </div>
            </div>

            <div className="grid grid-cols-3 gap-1">
              {paneOrder.map((pane, idx) => {
                const isSelected = activeTab === 'BENCH_LAB' && mobileBenchPane === pane;
                return (
                  <div
                    key={pane}
                    className={`rounded-lg border p-1 flex flex-col gap-1 ${
                      isSelected
                        ? 'bg-cyan-500/15 border-cyan-400/50'
                        : 'bg-slate-900/80 border-slate-800'
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => {
                        onNavigateTab('BENCH_LAB');
                        onSelectMobilePane(pane);
                      }}
                      className={`text-[10px] font-mono font-semibold truncate text-center py-0.5 rounded ${
                        isSelected ? 'text-cyan-200' : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      {PANE_LABELS[pane]}
                    </button>
                    {isContainerMoveMode && (
                      <div className="flex items-center justify-between gap-1">
                        <button
                          type="button"
                          disabled={idx === 0}
                          onClick={() => onMovePane(pane, 'prev')}
                          className="flex-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-amber-200 font-mono text-[10px]"
                          aria-label={`Move ${PANE_LABELS[pane]} earlier`}
                        >
                          ←
                        </button>
                        <button
                          type="button"
                          disabled={idx === paneOrder.length - 1}
                          onClick={() => onMovePane(pane, 'next')}
                          className="flex-1 py-0.5 rounded bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-amber-200 font-mono text-[10px]"
                          aria-label={`Move ${PANE_LABELS[pane]} later`}
                        >
                          →
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Opacity Level Selector */}
          <div className="flex items-center justify-between gap-2 border-t border-slate-800 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-slate-400 flex items-center gap-1">
              <Eye className="w-3 h-3 text-cyan-400" />
              Switch Opacity
            </span>
            <div className="flex items-center gap-1" role="group" aria-label="Floating switch opacity levels">
              {FLOATING_OPACITY_LEVELS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => setDockOpacity(level)}
                  aria-pressed={dockOpacity === level}
                  className={`px-1.5 py-0.5 rounded font-mono text-[10px] border transition ${
                    dockOpacity === level
                      ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                      : 'bg-slate-900 text-slate-300 border-slate-700 hover:text-white'
                  }`}
                >
                  {Math.round(level * 100)}%
                </button>
              ))}
            </div>
          </div>

          {/* Offline AI Voice Quick Actions & Command Input */}
          <div className="border-t border-slate-800 pt-2 space-y-1.5">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[10px] uppercase tracking-wider text-emerald-300 flex items-center gap-1">
                <Bot className="w-3 h-3" />
                Offline Voice AI
              </span>
              <button
                type="button"
                onClick={handleStartListening}
                className={`px-2 py-0.5 rounded-md font-mono text-[10px] flex items-center gap-1 border transition ${
                  voiceState.isListening
                    ? 'bg-rose-500/20 border-rose-400 text-rose-200 animate-pulse'
                    : 'bg-emerald-950/70 border-emerald-500/50 text-emerald-200 hover:bg-emerald-900/80'
                }`}
              >
                {voiceState.isListening ? <MicOff className="w-3 h-3" /> : <Mic className="w-3 h-3" />}
                {voiceState.isListening ? 'Listening...' : 'Speak Command'}
              </button>
            </div>

            <div className="flex flex-wrap gap-1">
              {[
                { label: 'Read Meter', cmd: 'Read meter' },
                { label: 'Diagnose Bench', cmd: 'Diagnose my current bench' },
                { label: 'Show Canvas', cmd: 'Show canvas' },
                { label: 'Oscilloscope', cmd: 'Open oscilloscope' },
              ].map((chip) => (
                <button
                  key={chip.label}
                  type="button"
                  onClick={() => {
                    if (!voiceNavEnabled) setVoiceNavEnabled(true);
                    executeVoiceOrTextQuery(chip.cmd);
                  }}
                  className="px-2 py-0.5 rounded-md bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-200 transition"
                >
                  {chip.label}
                </button>
              ))}
            </div>

            <form onSubmit={handleSubmitCommand} className="flex items-center gap-1">
              <input
                type="text"
                value={commandInput}
                onChange={(e) => setCommandInput(e.target.value)}
                placeholder='Offline voice cmd or DTC (e.g. "P0122")'
                aria-label="Offline voice command input"
                className="flex-1 min-w-0 bg-slate-900/90 border border-slate-700 focus:border-cyan-400 rounded-lg px-2 py-1 text-[11px] text-slate-100 placeholder:text-slate-500 focus:outline-none"
              />
              <button
                type="submit"
                className="p-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold shrink-0"
                aria-label="Execute offline voice command"
              >
                <Send className="w-3 h-3" />
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Compact Always-Accessible Floating Switch & Hold-Press Handle */}
      <div className="flex items-center gap-1 hud-panel border border-cyan-500/45 bg-slate-950/92 rounded-full p-1 shadow-xl backdrop-blur-md">
        {/* Hold-Press to Move Containers or Drag Floating Switch */}
        <button
          type="button"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
          aria-expanded={isExpanded}
          title="Tap for quick nav · Hold-press to toggle Container Move Mode · Drag to reposition"
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-mono font-bold transition select-none touch-none ${
            isContainerMoveMode
              ? 'bg-amber-500 text-slate-950 shadow-sm'
              : 'bg-slate-900 hover:bg-slate-800 text-cyan-200 border border-cyan-500/30'
          }`}
        >
          <GripVertical className="w-3.5 h-3.5 opacity-80" />
          <span>{isContainerMoveMode ? 'Move On' : 'Nav'}</span>
          {isExpanded ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>

        {/* Quick Mobile Container Cycle Button (< lg) */}
        <button
          type="button"
          onClick={() => {
            const curIdx = paneOrder.indexOf(mobileBenchPane);
            const nextPane = paneOrder[(curIdx + 1) % paneOrder.length];
            onNavigateTab('BENCH_LAB');
            onSelectMobilePane(nextPane);
          }}
          className="flex lg:hidden items-center gap-1 px-2 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-200"
          title="Quickly switch next mobile bench container"
          aria-label="Next bench container"
        >
          <ArrowLeftRight className="w-3 h-3 text-cyan-400" />
          <span>{PANE_LABELS[mobileBenchPane]}</span>
        </button>

        {/* Opacity Level Quick Toggle */}
        <button
          type="button"
          onClick={handleCycleOpacity}
          className="px-2 py-1.5 rounded-full bg-slate-900 hover:bg-slate-800 border border-slate-700 text-[10px] font-mono text-slate-300 tabular-nums"
          title="Cycle floating switch opacity (25% / 50% / 75% / 100%)"
          aria-label={`Floating switch opacity ${Math.round(dockOpacity * 100)}%`}
        >
          {Math.round(dockOpacity * 100)}%
        </button>

        {/* Offline Voice Navigator Power Switch */}
        <button
          type="button"
          role="switch"
          aria-checked={voiceNavEnabled}
          onClick={handleToggleVoiceNav}
          className={`flex items-center gap-1 px-2.5 py-1.5 rounded-full text-[11px] font-mono font-bold transition ${
            voiceNavEnabled
              ? 'bg-emerald-500 text-slate-950 shadow-sm'
              : 'bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-700'
          }`}
          title="Turn Offline AI Voice Navigator ON or OFF"
        >
          {voiceNavEnabled ? <Volume2 className="w-3.5 h-3.5" /> : <VolumeX className="w-3.5 h-3.5" />}
          <span>{voiceNavEnabled ? 'Voice ON' : 'Voice'}</span>
        </button>

        {/* Instant Mic Listen Button when Voice Navigator is ON */}
        {voiceNavEnabled && (
          <button
            type="button"
            onClick={handleStartListening}
            aria-label={voiceState.isListening ? 'Stop listening' : 'Listen for voice command'}
            className={`p-1.5 rounded-full transition ${
              voiceState.isListening
                ? 'bg-rose-500 text-white animate-pulse'
                : 'bg-cyan-500 hover:bg-cyan-400 text-slate-950'
            }`}
            title="Speak offline voice command"
          >
            {voiceState.isListening ? <MicOff className="w-3.5 h-3.5" /> : <Mic className="w-3.5 h-3.5" />}
          </button>
        )}
      </div>
    </div>
  );
};
