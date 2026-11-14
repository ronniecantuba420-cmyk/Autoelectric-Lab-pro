import React, { useEffect, useMemo, useState } from 'react';
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  Activity,
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpDown,
  Binary,
  Download,
  GitCompare,
  Maximize2,
  Pause,
  Play,
  Ruler,
  X,
} from 'lucide-react';
import { EcuPin, InjectedFault } from '../types/ecu';
import { SignalGenerator } from '../simulation/signals/SignalGenerator';
import { BinaryStateMonitor } from './BinaryStateMonitor';

export interface PinWaveformOscilloscopeProps {
  /** Ordered array of 16 ECU connector pins. */
  pins: EcuPin[];
  /** Currently inspected ECU pin ID synchronized with WiringCanvas & FaultMatrix (drives CH1). */
  selectedPinId: string | null;
  /** Callback to switch active inspected ECU pin (CH1). */
  onSelectPin: (pinId: string) => void;
  /** Live MNA solver node voltages keyed by pin/node ID. */
  nodeVoltages: Record<string, number>;
  /** Currently injected electrical faults evaluated by MNA. */
  faults: InjectedFault[];
  /** Bench DC power supply output state. */
  isPowerOn: boolean;
  /** True if a fault affects CAN_H or CAN_L. */
  hasCanFault: boolean;
  /** True if a fault affects primary injector driver. */
  hasInjectorFault: boolean;
  /** True when bench injector pulse simulation is enabled. */
  isInjectorFiring: boolean;
  /** Active RPM from CKP/RPM emulator (or idle fallback when off). */
  rpm: number;
  /** Simulation speed multiplier (`0.25` to `4.0`). */
  simulationSpeed: number;
  /** Layout presentation mode: floating overlay panel or embedded tab view. */
  variant?: 'overlay' | 'embedded';
  /** Closes the overlay when `variant === 'overlay'`. */
  onClose?: () => void;
  /** Optional navigation callback to open the full Oscilloscope workspace tab. */
  onOpenFullScopeTab?: () => void;
}

const TIMEBASE_OPTIONS_MS = [10, 40, 100, 500] as const;

interface OscChartPoint {
  timeMs: number;
  voltage?: number;
  secondaryVoltage?: number;
  ch1?: number;
  ch2?: number;
  diff?: number;
  ch1Norm?: number;
  ch2Norm?: number;
  diffNorm?: number;
}

function getDefaultCompanionPinId(ch1PinId: string, pins: EcuPin[]): string {
  const pairMap: Record<string, string> = {
    'ecu-pin-13': 'ecu-pin-14', // CAN_H <-> CAN_L
    'ecu-pin-14': 'ecu-pin-13',
    'ecu-pin-10': 'ecu-pin-11', // INJ_1 <-> IGN_1
    'ecu-pin-11': 'ecu-pin-10',
    'ecu-pin-7': 'ecu-pin-8',   // TPS_SIG <-> MAP_SIG
    'ecu-pin-8': 'ecu-pin-7',
    'ecu-pin-3': 'ecu-pin-4',   // KL30 <-> KL15
    'ecu-pin-4': 'ecu-pin-3',
    'ecu-pin-5': 'ecu-pin-6',   // VREF_5V <-> SGND
    'ecu-pin-6': 'ecu-pin-5',
  };
  const preferred = pairMap[ch1PinId];
  if (preferred && pins.some((p) => p.id === preferred)) {
    return preferred;
  }
  const fallback = pins.find((p) => p.id !== ch1PinId && p.id === 'ecu-pin-11') ||
    pins.find((p) => p.id !== ch1PinId);
  return fallback?.id || ch1PinId;
}

function computeAxisDomain(signalKind: string, vMin: number, vMax: number): [number, number] {
  if (signalKind === 'INJECTOR_PWM' && vMax > 15) {
    return [-2, 70];
  }
  if (signalKind === 'CAN_DIFF' || signalKind === 'O2_LAMBDA') {
    return [0, Math.max(5, Math.ceil(vMax + 1))];
  }
  const low = vMin < 0 ? Math.floor(vMin - 1) : -0.5;
  const maxV = Math.max(6, Math.ceil((vMax + 1.5) / 2) * 2);
  return [low, Math.min(70, maxV)];
}

export const PinWaveformOscilloscope: React.FC<PinWaveformOscilloscopeProps> = ({
  pins,
  selectedPinId,
  onSelectPin,
  nodeVoltages,
  faults,
  isPowerOn,
  hasCanFault,
  hasInjectorFault,
  isInjectorFiring,
  rpm,
  simulationSpeed,
  variant = 'overlay',
  onClose,
  onOpenFullScopeTab,
}) => {
  const [isRunning, setIsRunning] = useState(true);
  const [windowMs, setWindowMs] = useState<number>(40);
  const [simTimeSec, setSimTimeSec] = useState<number>(0);
  const [ch2PinId, setCh2PinId] = useState<string | null>(null);
  const [showDiffTrace, setShowDiffTrace] = useState(false);
  const [isAutoScale, setIsAutoScale] = useState(false);
  const [axisScaleMode, setAxisScaleMode] = useState<'AUTO' | 'SHARED' | 'SPLIT'>('AUTO');
  const [showCursors, setShowCursors] = useState(false);
  const [showBinaryMonitor, setShowBinaryMonitor] = useState(false);
  const [cursorAMs, setCursorAMs] = useState<number>(10);
  const [cursorBMs, setCursorBMs] = useState<number>(30);

  useEffect(() => {
    setCursorAMs((prev) => Math.max(0, Math.min(windowMs, prev)));
    setCursorBMs((prev) => Math.max(0, Math.min(windowMs, prev > windowMs ? windowMs * 0.75 : prev)));
  }, [windowMs]);

  const ch1Pin = useMemo(() => {
    return (
      pins.find((p) => p.id === selectedPinId) ||
      pins.find((p) => p.id === 'ecu-pin-7') ||
      pins[0]
    );
  }, [pins, selectedPinId]);

  const ch2Pin = useMemo(() => {
    if (!ch2PinId) return null;
    return pins.find((p) => p.id === ch2PinId) || null;
  }, [pins, ch2PinId]);

  const isDualTrace = Boolean(ch1Pin && ch2Pin);

  const ch1Fault = useMemo(() => {
    if (!ch1Pin) return undefined;
    return faults.find((f) => f.pinId === ch1Pin.id);
  }, [faults, ch1Pin]);

  const ch2Fault = useMemo(() => {
    if (!ch2Pin) return undefined;
    return faults.find((f) => f.pinId === ch2Pin.id);
  }, [faults, ch2Pin]);

  const ch1MnaVoltage = ch1Pin ? nodeVoltages[ch1Pin.id] ?? 0 : 0;
  const ch2MnaVoltage = ch2Pin ? nodeVoltages[ch2Pin.id] ?? 0 : 0;

  // Throttled 30 Hz live timebase advance when running and tab is visible
  useEffect(() => {
    if (!isRunning || !isPowerOn) return;

    let rafId = 0;
    let lastTick = performance.now();

    const step = (now: number) => {
      if (!document.hidden && now - lastTick >= 33) {
        const dtSec = Math.min(0.1, (now - lastTick) / 1000);
        lastTick = now;
        setSimTimeSec((prev) => prev + dtSec * Math.max(0.1, simulationSpeed) * 0.25);
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isRunning, isPowerOn, simulationSpeed]);

  const singleWaveform = useMemo(() => {
    if (!ch1Pin || isDualTrace) return null;

    return SignalGenerator.samplePinWaveformSeries({
      pinId: ch1Pin.id,
      pinLabel: ch1Pin.label,
      mnaNodeVoltage: ch1MnaVoltage,
      faultType: ch1Fault?.faultType ?? 'NONE',
      isPowerOn,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm,
      tStartSec: simTimeSec,
      windowMs,
      sampleCount: 80,
    });
  }, [
    ch1Pin,
    isDualTrace,
    ch1MnaVoltage,
    ch1Fault?.faultType,
    isPowerOn,
    hasCanFault,
    hasInjectorFault,
    isInjectorFiring,
    rpm,
    simTimeSec,
    windowMs,
  ]);

  const dualWaveform = useMemo(() => {
    if (!ch1Pin || !ch2Pin) return null;

    return SignalGenerator.sampleDualPinWaveformSeries({
      ch1PinId: ch1Pin.id,
      ch1PinLabel: ch1Pin.label,
      ch1MnaVoltage,
      ch1FaultType: ch1Fault?.faultType ?? 'NONE',
      ch2PinId: ch2Pin.id,
      ch2PinLabel: ch2Pin.label,
      ch2MnaVoltage,
      ch2FaultType: ch2Fault?.faultType ?? 'NONE',
      isPowerOn,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm,
      tStartSec: simTimeSec,
      windowMs,
      sampleCount: 96,
    });
  }, [
    ch1Pin,
    ch2Pin,
    ch1MnaVoltage,
    ch1Fault?.faultType,
    ch2MnaVoltage,
    ch2Fault?.faultType,
    isPowerOn,
    hasCanFault,
    hasInjectorFault,
    isInjectorFiring,
    rpm,
    simTimeSec,
    windowMs,
  ]);

  const ch1Domain: [number, number] = useMemo(() => {
    if (dualWaveform) {
      if (axisScaleMode === 'SHARED') {
        const minBoth = Math.min(dualWaveform.ch1Stats.vMin, dualWaveform.ch2Stats.vMin);
        const maxBoth = Math.max(dualWaveform.ch1Stats.vMax, dualWaveform.ch2Stats.vMax);
        const combinedKind =
          dualWaveform.ch1Stats.signalKind === 'INJECTOR_PWM' ||
          dualWaveform.ch2Stats.signalKind === 'INJECTOR_PWM'
            ? 'INJECTOR_PWM'
            : dualWaveform.ch1Stats.signalKind;
        return computeAxisDomain(combinedKind, minBoth, maxBoth);
      }
      return computeAxisDomain(
        dualWaveform.ch1Stats.signalKind,
        dualWaveform.ch1Stats.vMin,
        dualWaveform.ch1Stats.vMax
      );
    }
    if (singleWaveform) {
      return computeAxisDomain(singleWaveform.signalKind, singleWaveform.vMin, singleWaveform.vMax);
    }
    return [-0.5, 6];
  }, [dualWaveform, singleWaveform, axisScaleMode]);

  const ch2Domain: [number, number] = useMemo(() => {
    if (!dualWaveform) return [-0.5, 6];
    return computeAxisDomain(
      dualWaveform.ch2Stats.signalKind,
      dualWaveform.ch2Stats.vMin,
      dualWaveform.ch2Stats.vMax
    );
  }, [dualWaveform]);

  const useSplitYAxis = useMemo(() => {
    if (!dualWaveform || isAutoScale) return false;
    if (axisScaleMode === 'SPLIT') return true;
    if (axisScaleMode === 'SHARED') return false;
    const span1 = Math.max(1, ch1Domain[1] - ch1Domain[0]);
    const span2 = Math.max(1, ch2Domain[1] - ch2Domain[0]);
    return Math.max(span1, span2) / Math.min(span1, span2) > 2.2;
  }, [dualWaveform, isAutoScale, axisScaleMode, ch1Domain, ch2Domain]);

  const effectiveCh1Domain: [number, number] = isAutoScale && dualWaveform ? [-6, 106] : ch1Domain;

  const isOverlay = variant === 'overlay';
  const chartHeightClass = isOverlay ? 'h-[175px] sm:h-[205px]' : 'h-[225px] sm:h-[265px]';

  const formatFreq = (hz: number) => {
    if (hz <= 0) return '0.0 Hz';
    if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
    return `${hz.toFixed(1)} Hz`;
  };

  const handleSelectCh1Pin = (nextId: string) => {
    onSelectPin(nextId);
    if (ch2PinId) {
      const involvesSlowPulse =
        nextId === 'ecu-pin-10' ||
        nextId === 'ecu-pin-11' ||
        ch2PinId === 'ecu-pin-10' ||
        ch2PinId === 'ecu-pin-11';
      if (involvesSlowPulse && rpm < 1500 && windowMs < 100) {
        setWindowMs(100);
      }
    }
  };

  const handleSelectCh2Pin = (nextId: string | null) => {
    setCh2PinId(nextId);
    if (!nextId) {
      setShowDiffTrace(false);
      setIsAutoScale(false);
      return;
    }
    const involvesSlowPulse =
      ch1Pin?.id === 'ecu-pin-10' ||
      ch1Pin?.id === 'ecu-pin-11' ||
      nextId === 'ecu-pin-10' ||
      nextId === 'ecu-pin-11';
    if (involvesSlowPulse && rpm < 1500 && windowMs < 100) {
      setWindowMs(100);
    }
  };

  const handleToggleDualTrace = () => {
    if (isDualTrace) {
      handleSelectCh2Pin(null);
    } else if (ch1Pin) {
      handleSelectCh2Pin(getDefaultCompanionPinId(ch1Pin.id, pins));
    }
  };

  const handleSwapChannels = () => {
    if (!ch1Pin || !ch2Pin) return;
    const prevCh1 = ch1Pin.id;
    onSelectPin(ch2Pin.id);
    setCh2PinId(prevCh1);
  };

  const correlationBadge = useMemo(() => {
    if (!dualWaveform) return null;
    switch (dualWaveform.correlationMode) {
      case 'ANTI_PHASE':
        return {
          label: '180° ANTI-PHASE',
          cls: 'bg-cyan-950/90 border-cyan-500/50 text-cyan-300',
        };
      case 'IN_PHASE':
        return {
          label: '0° IN-PHASE',
          cls: 'bg-emerald-950/90 border-emerald-500/50 text-emerald-300',
        };
      case 'PHASE_SHIFTED':
        return {
          label: 'PHASE CORRELATED',
          cls: 'bg-purple-950/90 border-purple-500/50 text-purple-300',
        };
      case 'UNCORRELATED':
        return {
          label: 'UNCORRELATED',
          cls: 'bg-amber-950/90 border-amber-500/50 text-amber-300',
        };
      default:
        return {
          label: 'DC / STATIC',
          cls: 'bg-slate-900 border-slate-700 text-slate-300',
        };
    }
  }, [dualWaveform]);

  const chartData: OscChartPoint[] = dualWaveform
    ? dualWaveform.samples
    : singleWaveform?.samples ?? [];

  const isSamePinSelected = Boolean(ch1Pin && ch2Pin && ch1Pin.id === ch2Pin.id);

  const cursorMetrics = useMemo(() => {
    if (!showCursors || chartData.length === 0) return null;
    const findNearest = (tMs: number): OscChartPoint => {
      let best = chartData[0];
      let bestDist = Math.abs(best.timeMs - tMs);
      for (let i = 1; i < chartData.length; i++) {
        const d = Math.abs(chartData[i].timeMs - tMs);
        if (d < bestDist) {
          bestDist = d;
          best = chartData[i];
        }
      }
      return best;
    };
    const ptA = findNearest(cursorAMs);
    const ptB = findNearest(cursorBMs);
    const dtMs = Math.abs(ptB.timeMs - ptA.timeMs);
    const invFreqHz = dtMs > 0.001 ? 1000 / dtMs : 0;
    const ch1A = dualWaveform ? ptA.ch1 ?? 0 : ptA.voltage ?? 0;
    const ch1B = dualWaveform ? ptB.ch1 ?? 0 : ptB.voltage ?? 0;
    const ch2A = dualWaveform ? ptA.ch2 ?? 0 : 0;
    const ch2B = dualWaveform ? ptB.ch2 ?? 0 : 0;
    return {
      tA: ptA.timeMs,
      tB: ptB.timeMs,
      dtMs,
      invFreqHz,
      ch1A,
      ch1B,
      ch1DeltaV: ch1B - ch1A,
      ch2A,
      ch2B,
      ch2DeltaV: ch2B - ch2A,
    };
  }, [showCursors, chartData, cursorAMs, cursorBMs, dualWaveform]);

  const handleExportCsv = () => {
    if (chartData.length === 0) return;
    const lines: string[] = [];
    if (dualWaveform) {
      lines.push(`timeMs,ch1_${ch1Pin?.label || 'CH1'}_V,ch2_${ch2Pin?.label || 'CH2'}_V,diff_V`);
      for (const pt of chartData) {
        lines.push(`${pt.timeMs},${(pt.ch1 ?? 0).toFixed(3)},${(pt.ch2 ?? 0).toFixed(3)},${(pt.diff ?? 0).toFixed(3)}`);
      }
    } else {
      lines.push(`timeMs,${ch1Pin?.label || 'CH1'}_V,secondary_V`);
      for (const pt of chartData) {
        lines.push(`${pt.timeMs},${(pt.voltage ?? 0).toFixed(3)},${pt.secondaryVoltage !== undefined ? pt.secondaryVoltage.toFixed(3) : ''}`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ecu-scope-${ch1Pin?.label || 'pin'}-${windowMs}ms.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section
      aria-label="Selected ECU Pin Recharts Oscilloscope"
      className={`hud-panel rounded-xl text-slate-100 flex flex-col gap-2 font-mono ${
        isOverlay
          ? 'p-2.5 sm:p-3 border border-cyan-500/50 bg-[#060d18]/95 backdrop-blur-md shadow-[0_14px_38px_rgba(2,6,23,0.88)]'
          : 'p-2.5 sm:p-3.5 shrink-0'
      }`}
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-cyan-500/20 pb-2">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h3 className="text-[11px] sm:text-xs font-hud font-bold uppercase tracking-wider text-slate-100 truncate">
                Recharts Pin Oscilloscope
              </h3>
              {ch1Pin && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300">
                  CH1 #{ch1Pin.pinNumber} {ch1Pin.label}
                </span>
              )}
              {ch2Pin && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-amber-950 border border-amber-500/40 text-amber-300">
                  CH2 #{ch2Pin.pinNumber} {ch2Pin.label}
                </span>
              )}
              {ch1Fault && ch1Fault.faultType !== 'NONE' && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-950 border border-rose-500/50 text-rose-300 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  CH1: {ch1Fault.faultType}
                </span>
              )}
              {ch2Fault && ch2Fault.faultType !== 'NONE' && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-950 border border-rose-500/50 text-rose-300 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  CH2: {ch2Fault.faultType}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleToggleDualTrace}
            aria-pressed={isDualTrace}
            aria-label="Toggle Dual-Trace Mode"
            title="Enable or disable simultaneous 2-pin Dual-Trace oscilloscope mode"
            className={`px-2 py-1 text-[10px] rounded border flex items-center gap-1 font-bold transition ${
              isDualTrace
                ? 'bg-amber-500/20 border-amber-400 text-amber-200'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-cyan-500/50'
            }`}
          >
            <GitCompare className="w-3 h-3" />
            <span>{isDualTrace ? '2-CH DUAL' : '1-CH'}</span>
          </button>

          <button
            type="button"
            onClick={() => setShowCursors((prev) => !prev)}
            aria-pressed={showCursors}
            aria-label="Toggle A/B Measurement Cursors"
            title="Show interactive A/B vertical cursors for Δt and ΔV measurements"
            className={`px-2 py-1 text-[10px] rounded border flex items-center gap-1 font-bold transition ${
              showCursors
                ? 'bg-fuchsia-500/20 border-fuchsia-400 text-fuchsia-200'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-fuchsia-500/50'
            }`}
          >
            <Ruler className="w-3 h-3" />
            <span>A/B</span>
          </button>

          <button
            type="button"
            onClick={() => setShowBinaryMonitor((prev) => !prev)}
            aria-pressed={showBinaryMonitor}
            aria-label="Toggle Binary State Logic Monitor"
            title="Detect and display PWM duty/edges and CAN bus binary frame patterns on the selected pin"
            className={`px-2 py-1 text-[10px] rounded border flex items-center gap-1 font-bold transition ${
              showBinaryMonitor
                ? 'bg-cyan-500/20 border-cyan-400 text-cyan-200'
                : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-cyan-500/50'
            }`}
          >
            <Binary className="w-3 h-3" />
            <span>BIN</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            aria-label="Export Waveform CSV Snapshot"
            title="Download current waveform samples as CSV"
            className="px-2 py-1 text-[10px] rounded border bg-slate-950 border-slate-700 hover:border-cyan-500/50 text-slate-300 hover:text-cyan-200 flex items-center gap-1 font-semibold transition"
          >
            <Download className="w-3 h-3" />
            <span className="hidden sm:inline">CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setIsRunning((prev) => !prev)}
            className={`px-2 py-1 text-[10px] rounded border flex items-center gap-1 font-semibold transition ${
              isRunning
                ? 'bg-emerald-950/80 border-emerald-600/70 text-emerald-300'
                : 'bg-amber-950/80 border-amber-600/70 text-amber-300'
            }`}
            title={isRunning ? 'Pause live waveform trace' : 'Resume live waveform trace'}
          >
            {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span className="hidden xs:inline">{isRunning ? 'RUN' : 'HOLD'}</span>
          </button>

          {isOverlay && onOpenFullScopeTab && (
            <button
              type="button"
              onClick={() => {
                onOpenFullScopeTab();
                onClose?.();
              }}
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-cyan-300 transition"
              title="Open Oscilloscope Workspace Tab"
              aria-label="Open Oscilloscope Workspace Tab"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          )}

          {isOverlay && onClose && (
            <button
              type="button"
              onClick={onClose}
              className="p-1 rounded bg-slate-900 hover:bg-rose-950 border border-slate-700 hover:border-rose-500/60 text-slate-300 hover:text-rose-200 transition"
              title="Close Pin Oscilloscope Overlay"
              aria-label="Close Pin Oscilloscope Overlay"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Dual-Channel Pin Selection & Scale Bar */}
      <div className="flex flex-wrap items-center justify-between gap-1.5 text-[10px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <label className="flex items-center gap-1 text-cyan-300 font-semibold">
            <span>CH1:</span>
            <select
              aria-label="Select ECU Pin for Recharts Oscilloscope"
              value={ch1Pin?.id || ''}
              onChange={(e) => handleSelectCh1Pin(e.target.value)}
              className="bg-slate-950 border border-cyan-500/40 hover:border-cyan-400 text-cyan-200 text-[10px] rounded px-1.5 py-1 focus:outline-none cursor-pointer max-w-[145px] sm:max-w-[175px]"
            >
              {pins.map((pin) => (
                <option key={pin.id} value={pin.id} className="bg-slate-950 text-slate-100">
                  #{pin.pinNumber} {pin.label} ({(nodeVoltages[pin.id] ?? 0).toFixed(2)}V)
                </option>
              ))}
            </select>
          </label>

          {isDualTrace && (
            <button
              type="button"
              onClick={handleSwapChannels}
              title="Swap CH1 and CH2 pins"
              aria-label="Swap CH1 and CH2 pins"
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-cyan-300 transition"
            >
              <ArrowLeftRight className="w-3 h-3" />
            </button>
          )}

          <label className="flex items-center gap-1 text-amber-300 font-semibold">
            <span>CH2:</span>
            <select
              aria-label="Select Second ECU Pin for Dual-Trace Oscilloscope"
              value={ch2Pin?.id || ''}
              onChange={(e) => {
                const next = e.target.value;
                handleSelectCh2Pin(next ? next : null);
              }}
              className={`bg-slate-950 border text-[10px] rounded px-1.5 py-1 focus:outline-none cursor-pointer max-w-[145px] sm:max-w-[175px] ${
                isDualTrace
                  ? 'border-amber-500/50 hover:border-amber-400 text-amber-200'
                  : 'border-slate-700 hover:border-amber-500/40 text-slate-400'
              }`}
            >
              <option value="" className="bg-slate-950 text-slate-400">
                Off (Single Trace)
              </option>
              {pins.map((pin) => (
                <option key={pin.id} value={pin.id} className="bg-slate-950 text-slate-100">
                  #{pin.pinNumber} {pin.label} ({(nodeVoltages[pin.id] ?? 0).toFixed(2)}V)
                </option>
              ))}
            </select>
          </label>
        </div>

        {isDualTrace && (
          <div className="flex flex-wrap items-center gap-1">
            <button
              type="button"
              onClick={() => setIsAutoScale((prev) => !prev)}
              aria-pressed={isAutoScale}
              aria-label="Toggle Auto-Scale normalized dual-trace viewport"
              title="Normalize both channels to 0–100% of their own amplitude span for easy phase & edge comparison"
              className={`px-1.5 py-0.5 rounded border text-[9.5px] font-bold flex items-center gap-1 transition ${
                isAutoScale
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-slate-950 border-slate-700 text-slate-300 hover:border-emerald-500/50'
              }`}
            >
              <ArrowUpDown className="w-2.5 h-2.5" />
              <span>Auto-Scale</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (isAutoScale) {
                  setIsAutoScale(false);
                } else {
                  setAxisScaleMode((prev) =>
                    prev === 'AUTO' ? 'SHARED' : prev === 'SHARED' ? 'SPLIT' : 'AUTO'
                  );
                }
              }}
              title="Cycle Y-axis voltage scale mode (Auto / Shared V / Split Y)"
              className="px-1.5 py-0.5 rounded border bg-slate-950 border-slate-700 hover:border-cyan-500/50 text-slate-300 text-[9.5px]"
            >
              Y:{' '}
              {isAutoScale
                ? '0–100% NORM'
                : axisScaleMode === 'AUTO'
                ? useSplitYAxis
                  ? 'AUTO (SPLIT)'
                  : 'AUTO (SHARED)'
                : axisScaleMode}
            </button>
            <button
              type="button"
              onClick={() => setShowDiffTrace((prev) => !prev)}
              aria-pressed={showDiffTrace}
              title="Overlay CH1 minus CH2 instantaneous differential waveform"
              className={`px-1.5 py-0.5 rounded border text-[9.5px] font-semibold transition ${
                showDiffTrace
                  ? 'bg-purple-500/20 border-purple-400 text-purple-200'
                  : 'bg-slate-950 border-slate-700 text-slate-400 hover:text-slate-200'
              }`}
            >
              CH1−CH2
            </button>
          </div>
        )}
      </div>

      {isSamePinSelected && ch1Pin && (
        <div
          role="status"
          className="px-2.5 py-1 rounded border border-amber-500/40 bg-amber-950/40 text-amber-200 text-[10px]"
        >
          CH1 and CH2 are probing the same pin (#{ch1Pin.pinNumber} {ch1Pin.label}) — choose a companion pin on CH2 for differential or phase comparison.
        </div>
      )}

      {/* Recharts Real-Time Waveform Plot */}
      <div className={`w-full ${chartHeightClass} rounded-lg border border-slate-800 bg-[#03080c] p-1.5 relative`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart
            data={chartData}
            margin={{ top: 8, right: useSplitYAxis ? 4 : 10, left: -18, bottom: 2 }}
          >
            <defs>
              <linearGradient id="pinScopeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.32} />
                <stop offset="95%" stopColor="#22d3ee" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="#0f293a" strokeDasharray="3 3" />
            <XAxis
              dataKey="timeMs"
              type="number"
              domain={[0, windowMs]}
              tick={{ fill: '#64748b', fontSize: 10 }}
              tickFormatter={(v: number) => `${v}ms`}
              stroke="#1e293b"
            />
            <YAxis
              yAxisId="ch1"
              domain={effectiveCh1Domain}
              tick={{ fill: isAutoScale && dualWaveform ? '#34d399' : '#22d3ee', fontSize: 10 }}
              tickFormatter={(v: number) => (isAutoScale && dualWaveform ? `${v}%` : `${v}V`)}
              stroke="#1e293b"
            />
            {useSplitYAxis && (
              <YAxis
                yAxisId="ch2"
                orientation="right"
                domain={ch2Domain}
                width={34}
                tick={{ fill: '#fbbf24', fontSize: 10 }}
                tickFormatter={(v: number) => `${v}V`}
                stroke="#1e293b"
              />
            )}
            <Tooltip
              isAnimationActive={false}
              contentStyle={{
                backgroundColor: '#020617',
                borderColor: '#0891b2',
                borderRadius: '0.5rem',
                fontSize: '11px',
                color: '#e2e8f0',
              }}
              labelFormatter={(label) => `t = ${label} ms`}
              formatter={(value: unknown, name: unknown, item: { payload?: OscChartPoint; dataKey?: unknown }) => {
                const labelStr = String(name ?? 'Voltage');
                if (isAutoScale && dualWaveform && item?.payload) {
                  const pct = Number(value ?? 0).toFixed(1);
                  const dk = typeof item.dataKey === 'string' ? item.dataKey : '';
                  const rawV =
                    dk === 'ch1Norm'
                      ? item.payload.ch1
                      : dk === 'ch2Norm'
                      ? item.payload.ch2
                      : dk === 'diffNorm'
                      ? item.payload.diff
                      : undefined;
                  if (rawV !== undefined) {
                    return [`${rawV.toFixed(2)} V (${pct}%)`, labelStr];
                  }
                  return [`${pct}%`, labelStr];
                }
                return [`${Number(value ?? 0).toFixed(2)} V`, labelStr];
              }}
            />
            <ReferenceLine
              yAxisId="ch1"
              y={isAutoScale && dualWaveform ? dualWaveform.autoScale.ch1MnaNorm : ch1MnaVoltage}
              stroke="#22d3ee"
              strokeDasharray="4 4"
              strokeOpacity={0.45}
            />
            {showCursors && (
              <>
                <ReferenceLine
                  yAxisId="ch1"
                  x={cursorAMs}
                  stroke="#f472b6"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  label={{ value: 'A', position: 'top', fill: '#f472b6', fontSize: 10 }}
                />
                <ReferenceLine
                  yAxisId="ch1"
                  x={cursorBMs}
                  stroke="#a78bfa"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  label={{ value: 'B', position: 'top', fill: '#a78bfa', fontSize: 10 }}
                />
              </>
            )}

            {dualWaveform ? (
              <>
                <Area
                  yAxisId="ch1"
                  type="monotone"
                  dataKey={isAutoScale ? 'ch1Norm' : 'ch1'}
                  name={`CH1 ${dualWaveform.ch1Label}`}
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#pinScopeFill)"
                  isAnimationActive={false}
                  dot={false}
                />
                <Line
                  yAxisId={useSplitYAxis ? 'ch2' : 'ch1'}
                  type="monotone"
                  dataKey={isAutoScale ? 'ch2Norm' : 'ch2'}
                  name={`CH2 ${dualWaveform.ch2Label}`}
                  stroke="#facc15"
                  strokeWidth={2}
                  isAnimationActive={false}
                  dot={false}
                />
                {showDiffTrace && (
                  <Line
                    yAxisId="ch1"
                    type="monotone"
                    dataKey={isAutoScale ? 'diffNorm' : 'diff'}
                    name="Diff (CH1 − CH2)"
                    stroke="#c084fc"
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    isAnimationActive={false}
                    dot={false}
                  />
                )}
              </>
            ) : (
              <>
                <Area
                  yAxisId="ch1"
                  type="monotone"
                  dataKey="voltage"
                  name={singleWaveform?.primaryLabel || 'Voltage (V)'}
                  stroke="#22d3ee"
                  strokeWidth={2}
                  fill="url(#pinScopeFill)"
                  isAnimationActive={false}
                  dot={false}
                />
                {singleWaveform?.secondaryLabel && (
                  <Line
                    yAxisId="ch1"
                    type="monotone"
                    dataKey="secondaryVoltage"
                    name={singleWaveform.secondaryLabel}
                    stroke="#facc15"
                    strokeWidth={1.75}
                    isAnimationActive={false}
                    dot={false}
                  />
                )}
              </>
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {!isPowerOn && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/55 rounded-lg">
            <span className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700 text-[10px] text-amber-300 font-bold">
              PSU OUTPUT OFF · CH1 {ch1MnaVoltage.toFixed(2)} V
              {ch2Pin ? ` · CH2 ${ch2MnaVoltage.toFixed(2)} V` : ''}
            </span>
          </div>
        )}
      </div>

      {/* Interactive A/B Cursors Readout & Controls */}
      {showCursors && cursorMetrics && (
        <div
          aria-label="A/B Cursor Measurements"
          className="flex flex-col gap-1.5 text-[10px] bg-slate-950/90 border border-fuchsia-500/35 px-2.5 py-1.5 rounded-lg tabular-nums"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-slate-300">
            <span className="text-fuchsia-300 font-bold">
              A: {cursorMetrics.tA.toFixed(1)}ms ({cursorMetrics.ch1A.toFixed(2)}V{dualWaveform ? ` / ${cursorMetrics.ch2A.toFixed(2)}V` : ''})
            </span>
            <span className="text-violet-300 font-bold">
              B: {cursorMetrics.tB.toFixed(1)}ms ({cursorMetrics.ch1B.toFixed(2)}V{dualWaveform ? ` / ${cursorMetrics.ch2B.toFixed(2)}V` : ''})
            </span>
            <span>
              Δt: <strong className="text-cyan-300">{cursorMetrics.dtMs.toFixed(2)} ms</strong>
              {cursorMetrics.invFreqHz > 0 ? ` (${cursorMetrics.invFreqHz >= 1000 ? `${(cursorMetrics.invFreqHz / 1000).toFixed(2)} kHz` : `${cursorMetrics.invFreqHz.toFixed(1)} Hz`})` : ''}
            </span>
            <span>
              CH1 ΔV: <strong className="text-amber-300">{cursorMetrics.ch1DeltaV >= 0 ? '+' : ''}{cursorMetrics.ch1DeltaV.toFixed(2)} V</strong>
            </span>
            {dualWaveform && (
              <span>
                CH2 ΔV: <strong className="text-amber-300">{cursorMetrics.ch2DeltaV >= 0 ? '+' : ''}{cursorMetrics.ch2DeltaV.toFixed(2)} V</strong>
              </span>
            )}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex items-center gap-1.5 text-fuchsia-300">
              <span className="shrink-0">Pos A:</span>
              <input
                type="range"
                aria-label="Cursor A Time Position (ms)"
                min={0}
                max={windowMs}
                step={Math.max(0.5, windowMs / 80)}
                value={cursorAMs}
                onChange={(e) => setCursorAMs(parseFloat(e.target.value))}
                className="w-full accent-fuchsia-400 h-1 bg-slate-800 rounded cursor-pointer"
              />
            </label>
            <label className="flex items-center gap-1.5 text-violet-300">
              <span className="shrink-0">Pos B:</span>
              <input
                type="range"
                aria-label="Cursor B Time Position (ms)"
                min={0}
                max={windowMs}
                step={Math.max(0.5, windowMs / 80)}
                value={cursorBMs}
                onChange={(e) => setCursorBMs(parseFloat(e.target.value))}
                className="w-full accent-violet-400 h-1 bg-slate-800 rounded cursor-pointer"
              />
            </label>
          </div>
        </div>
      )}

      {/* Correlation & Phase Analysis Strip (Dual-Trace Mode) */}
      {dualWaveform && correlationBadge && (
        <div
          aria-label="Dual-Trace Phase and Correlation Telemetry"
          className="flex flex-wrap items-center justify-between gap-2 text-[10px] bg-slate-950/85 border border-cyan-500/20 px-2.5 py-1.5 rounded-lg tabular-nums"
        >
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-300">
            <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold ${correlationBadge.cls}`}>
              {correlationBadge.label}
            </span>
            <span>
              Phase Δφ:{' '}
              <strong className="text-purple-300">
                {dualWaveform.phaseDiffDeg !== null ? `${dualWaveform.phaseDiffDeg.toFixed(1)}°` : 'N/A'}
              </strong>
            </span>
            <span>
              Lag Δt:{' '}
              <strong className="text-cyan-300">
                {dualWaveform.timeLagMs !== null
                  ? `${dualWaveform.timeLagMs >= 0 ? '+' : ''}${dualWaveform.timeLagMs.toFixed(2)} ms`
                  : 'N/A'}
              </strong>
            </span>
            <span>
              Corr r:{' '}
              <strong
                className={
                  dualWaveform.correlationR === null
                    ? 'text-slate-400'
                    : dualWaveform.correlationR >= 0.7
                    ? 'text-emerald-300'
                    : dualWaveform.correlationR <= -0.7
                    ? 'text-cyan-300'
                    : 'text-amber-300'
                }
              >
                {dualWaveform.correlationR !== null ? dualWaveform.correlationR.toFixed(3) : 'DC/Flat'}
              </strong>
            </span>
            <span>
              Avg ΔV:{' '}
              <strong className="text-amber-300">
                {dualWaveform.avgDiffV >= 0 ? '+' : ''}
                {dualWaveform.avgDiffV.toFixed(2)} V
              </strong>
            </span>
          </div>
          {isAutoScale && (
            <span
              data-testid="recharts-autoscale-badge"
              className="px-1.5 py-0.5 rounded border bg-emerald-950/85 border-emerald-500/45 text-emerald-300 text-[9px] font-bold"
            >
              AUTO-SCALE 0–100% · CH1 {dualWaveform.autoScale.ch1MinV.toFixed(1)}–{dualWaveform.autoScale.ch1MaxV.toFixed(1)}V · CH2 {dualWaveform.autoScale.ch2MinV.toFixed(1)}–{dualWaveform.autoScale.ch2MaxV.toFixed(1)}V
              {dualWaveform.autoScale.amplitudeRatio !== null ? ` · ${dualWaveform.autoScale.amplitudeRatio.toFixed(2)}×` : ''}
            </span>
          )}
        </div>
      )}

      {/* Live MNA Telemetry & Timebase Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] hud-well px-2.5 py-1.5 rounded-lg">
        {dualWaveform ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-300 tabular-nums">
            <span>
              <strong className="text-cyan-300">CH1:</strong> {ch1MnaVoltage.toFixed(2)}V · Vpp{' '}
              {dualWaveform.ch1Stats.vpp.toFixed(2)}V ({formatFreq(dualWaveform.ch1Stats.freqHz)})
            </span>
            <span>
              <strong className="text-amber-300">CH2:</strong> {ch2MnaVoltage.toFixed(2)}V · Vpp{' '}
              {dualWaveform.ch2Stats.vpp.toFixed(2)}V ({formatFreq(dualWaveform.ch2Stats.freqHz)})
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-300 tabular-nums">
            <span>
              MNA: <strong className="text-amber-300">{ch1MnaVoltage.toFixed(2)} V</strong>
            </span>
            <span>
              Vpp: <strong className="text-cyan-300">{(singleWaveform?.vpp ?? 0).toFixed(2)} V</strong>
            </span>
            <span>
              Range:{' '}
              <strong className="text-emerald-300">
                {(singleWaveform?.vMin ?? 0).toFixed(2)}–{(singleWaveform?.vMax ?? 0).toFixed(2)} V
              </strong>
            </span>
            <span>
              Freq: <strong className="text-purple-300">{formatFreq(singleWaveform?.freqHz ?? 0)}</strong>
            </span>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <span className="text-slate-500">WIN:</span>
          {TIMEBASE_OPTIONS_MS.map((ms) => (
            <button
              key={ms}
              type="button"
              onClick={() => setWindowMs(ms)}
              className={`px-1.5 py-0.5 rounded border transition ${
                windowMs === ms
                  ? 'bg-cyan-500 text-slate-950 border-cyan-400 font-bold'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
              }`}
            >
              {ms}ms
            </button>
          ))}
        </div>
      </div>

      {/* Inline Binary State Monitor Drawer (when toggled via BIN button) */}
      {showBinaryMonitor && (
        <BinaryStateMonitor
          variant="compact"
          pins={pins}
          selectedPinId={ch1Pin?.id ?? selectedPinId}
          onSelectPin={onSelectPin}
          nodeVoltages={nodeVoltages}
          faults={faults}
          isPowerOn={isPowerOn}
          hasCanFault={hasCanFault}
          hasInjectorFault={hasInjectorFault}
          isInjectorFiring={isInjectorFiring}
          rpm={rpm}
          simulationSpeed={simulationSpeed}
        />
      )}
    </section>
  );
};

