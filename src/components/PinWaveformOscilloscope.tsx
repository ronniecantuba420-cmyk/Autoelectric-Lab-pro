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
import { Activity, AlertTriangle, Maximize2, Pause, Play, X } from 'lucide-react';
import { EcuPin, InjectedFault } from '../types/ecu';
import { SignalGenerator } from '../simulation/signals/SignalGenerator';

export interface PinWaveformOscilloscopeProps {
  /** Ordered array of 16 ECU connector pins. */
  pins: EcuPin[];
  /** Currently inspected ECU pin ID synchronized with WiringCanvas & FaultMatrix. */
  selectedPinId: string | null;
  /** Callback to switch active inspected ECU pin. */
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

const TIMEBASE_OPTIONS_MS = [10, 40, 100] as const;

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

  const activePin = useMemo(() => {
    return (
      pins.find((p) => p.id === selectedPinId) ||
      pins.find((p) => p.id === 'ecu-pin-7') ||
      pins[0]
    );
  }, [pins, selectedPinId]);

  const activeFault = useMemo(() => {
    if (!activePin) return undefined;
    return faults.find((f) => f.pinId === activePin.id);
  }, [faults, activePin]);

  const mnaVoltage = activePin ? nodeVoltages[activePin.id] ?? 0 : 0;

  // Throttled 30 Hz live timebase advance when running and tab is visible
  useEffect(() => {
    if (!isRunning || !isPowerOn) return;

    let rafId = 0;
    let lastTick = performance.now();

    const step = (now: number) => {
      if (!document.hidden && now - lastTick >= 33) {
        const dtSec = Math.min(0.1, (now - lastTick) / 1000);
        lastTick = now;
        // Scale phase progression cleanly with simulationSpeed & timebase
        setSimTimeSec((prev) => prev + dtSec * Math.max(0.1, simulationSpeed) * 0.25);
      }
      rafId = requestAnimationFrame(step);
    };

    rafId = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafId);
  }, [isRunning, isPowerOn, simulationSpeed]);

  const waveform = useMemo(() => {
    if (!activePin) {
      return {
        samples: [],
        signalKind: 'DC_ANALOG',
        primaryLabel: 'Voltage (V)',
        secondaryLabel: undefined,
        vMin: 0,
        vMax: 0,
        vAvg: 0,
        vpp: 0,
        freqHz: 0,
      };
    }

    return SignalGenerator.samplePinWaveformSeries({
      pinId: activePin.id,
      pinLabel: activePin.label,
      mnaNodeVoltage: mnaVoltage,
      faultType: activeFault?.faultType ?? 'NONE',
      isPowerOn,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm,
      tStartSec: simTimeSec,
      windowMs,
      sampleCount: 64,
    });
  }, [
    activePin,
    mnaVoltage,
    activeFault?.faultType,
    isPowerOn,
    hasCanFault,
    hasInjectorFault,
    isInjectorFiring,
    rpm,
    simTimeSec,
    windowMs,
  ]);

  const yDomain: [number, number] = useMemo(() => {
    if (waveform.signalKind === 'INJECTOR_PWM' && waveform.vMax > 15) {
      return [-2, 70];
    }
    if (waveform.signalKind === 'CAN_DIFF' || waveform.signalKind === 'O2_LAMBDA') {
      return [0, Math.max(5, Math.ceil(waveform.vMax + 1))];
    }
    const maxV = Math.max(6, Math.ceil((waveform.vMax + 1.5) / 2) * 2);
    return [-0.5, Math.min(32, maxV)];
  }, [waveform.signalKind, waveform.vMax]);

  const isOverlay = variant === 'overlay';
  const chartHeightClass = isOverlay ? 'h-[168px] sm:h-[195px]' : 'h-[210px] sm:h-[250px]';

  const formatFreq = (hz: number) => {
    if (hz <= 0) return '0.0 Hz';
    if (hz >= 1000) return `${(hz / 1000).toFixed(1)} kHz`;
    return `${hz.toFixed(1)} Hz`;
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
              {activePin && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-cyan-950 border border-cyan-500/40 text-cyan-300">
                  Pin #{activePin.pinNumber} · {activePin.label}
                </span>
              )}
              {activeFault && activeFault.faultType !== 'NONE' && (
                <span className="px-1.5 py-0.5 text-[9px] font-bold rounded bg-rose-950 border border-rose-500/50 text-rose-300 flex items-center gap-1">
                  <AlertTriangle className="w-2.5 h-2.5" />
                  {activeFault.faultType}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <select
            aria-label="Select ECU Pin for Recharts Oscilloscope"
            value={activePin?.id || ''}
            onChange={(e) => onSelectPin(e.target.value)}
            className="bg-slate-950 border border-slate-700 hover:border-cyan-500/60 text-cyan-200 text-[10px] rounded px-1.5 py-1 focus:outline-none cursor-pointer max-w-[140px] sm:max-w-[180px]"
          >
            {pins.map((pin) => (
              <option key={pin.id} value={pin.id} className="bg-slate-950 text-slate-100">
                #{pin.pinNumber} {pin.label} ({(nodeVoltages[pin.id] ?? 0).toFixed(2)}V)
              </option>
            ))}
          </select>

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

      {/* Recharts Real-Time Waveform Plot */}
      <div className={`w-full ${chartHeightClass} rounded-lg border border-slate-800 bg-[#03080c] p-1.5 relative`}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={waveform.samples} margin={{ top: 8, right: 10, left: -18, bottom: 2 }}>
            <defs>
              <linearGradient id="pinScopeFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#22d3ee" stopOpacity={0.35} />
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
              domain={yDomain}
              tick={{ fill: '#94a3b8', fontSize: 10 }}
              tickFormatter={(v: number) => `${v}V`}
              stroke="#1e293b"
            />
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
              formatter={(value: unknown, name: unknown) => [
                `${Number(value ?? 0).toFixed(2)} V`,
                String(name ?? 'Voltage'),
              ]}
            />
            <ReferenceLine
              y={mnaVoltage}
              stroke="#fbbf24"
              strokeDasharray="4 4"
              strokeOpacity={0.55}
            />
            <Area
              type="monotone"
              dataKey="voltage"
              name={waveform.primaryLabel}
              stroke="#22d3ee"
              strokeWidth={2}
              fill="url(#pinScopeFill)"
              isAnimationActive={false}
              dot={false}
            />
            {waveform.secondaryLabel && (
              <Line
                type="monotone"
                dataKey="secondaryVoltage"
                name={waveform.secondaryLabel}
                stroke="#facc15"
                strokeWidth={1.75}
                isAnimationActive={false}
                dot={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {!isPowerOn && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-slate-950/55 rounded-lg">
            <span className="px-2.5 py-1 rounded bg-slate-900/90 border border-slate-700 text-[10px] text-amber-300 font-bold">
              PSU OUTPUT OFF · MNA NODE {mnaVoltage.toFixed(2)} V
            </span>
          </div>
        )}
      </div>

      {/* Live MNA Telemetry & Timebase Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] hud-well px-2.5 py-1.5 rounded-lg">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-slate-300 tabular-nums">
          <span>
            MNA: <strong className="text-amber-300">{mnaVoltage.toFixed(2)} V</strong>
          </span>
          <span>
            Vpp: <strong className="text-cyan-300">{waveform.vpp.toFixed(2)} V</strong>
          </span>
          <span>
            Range:{' '}
            <strong className="text-emerald-300">
              {waveform.vMin.toFixed(2)}–{waveform.vMax.toFixed(2)} V
            </strong>
          </span>
          <span>
            Freq: <strong className="text-purple-300">{formatFreq(waveform.freqHz)}</strong>
          </span>
        </div>

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
    </section>
  );
};
