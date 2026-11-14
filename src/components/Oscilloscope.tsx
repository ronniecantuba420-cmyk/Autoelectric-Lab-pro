import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeftRight, ArrowUpDown, GitCompare, Pause, Play } from 'lucide-react';
import { EcuPin, InjectedFault } from '../types/ecu';
import { SignalGenerator } from '../simulation/signals/SignalGenerator';

type ScopeSignalMode =
  | 'CAN_BUS'
  | 'INJECTOR_PWM'
  | 'CRANK_CKP'
  | 'O2_LAMBDA'
  | 'TPS_DC'
  | 'DUAL_PIN';

interface OscilloscopeProps {
  isPowerOn: boolean;
  selectedSignal: 'CAN_BUS' | 'INJECTOR_PWM' | 'CRANK_CKP' | 'TPS_DC' | 'O2_LAMBDA';
  hasCanFault: boolean;
  hasInjectorFault: boolean;
  simulationSpeed?: number;
  emulatorRpm?: number;
  isRpmEmulatorActive?: boolean;
  isInjectorFiring?: boolean;
  camPhaseOffsetDeg?: number;
  ckpSignalLost?: boolean;
  pins?: EcuPin[];
  nodeVoltages?: Record<string, number>;
  faults?: InjectedFault[];
  selectedPinId?: string | null;
  onSelectPin?: (pinId: string) => void;
}

function pickCompanionPinId(ch1Id: string, pins: EcuPin[]): string {
  const pairs: Record<string, string> = {
    'ecu-pin-13': 'ecu-pin-14',
    'ecu-pin-14': 'ecu-pin-13',
    'ecu-pin-10': 'ecu-pin-11',
    'ecu-pin-11': 'ecu-pin-10',
    'ecu-pin-7': 'ecu-pin-8',
    'ecu-pin-8': 'ecu-pin-7',
    'ecu-pin-3': 'ecu-pin-4',
    'ecu-pin-4': 'ecu-pin-3',
  };
  const preferred = pairs[ch1Id];
  if (preferred && pins.some((p) => p.id === preferred)) return preferred;
  return pins.find((p) => p.id !== ch1Id)?.id || ch1Id;
}

export const Oscilloscope: React.FC<OscilloscopeProps> = ({
  isPowerOn,
  selectedSignal,
  hasCanFault,
  hasInjectorFault,
  simulationSpeed = 1.0,
  emulatorRpm = 850,
  isRpmEmulatorActive = false,
  isInjectorFiring = true,
  camPhaseOffsetDeg = 0,
  ckpSignalLost = false,
  pins = [],
  nodeVoltages = {},
  faults = [],
  selectedPinId = null,
  onSelectPin,
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isRunning, setIsRunning] = useState(true);
  const [voltDiv, setVoltDiv] = useState(1.0);
  const [timeDiv, setTimeDiv] = useState(1.0);
  const [activeSignal, setActiveSignal] = useState<ScopeSignalMode>(selectedSignal);
  const [localCh1PinId, setLocalCh1PinId] = useState<string>('ecu-pin-10');
  const [ch2PinId, setCh2PinId] = useState<string>('ecu-pin-11');
  const [isAutoScale, setIsAutoScale] = useState(false);

  useEffect(() => {
    setActiveSignal((prev) => (prev === 'DUAL_PIN' ? prev : selectedSignal));
  }, [selectedSignal]);

  const effectiveCh1PinId = selectedPinId || localCh1PinId;

  const ch1Pin = useMemo(
    () => pins.find((p) => p.id === effectiveCh1PinId) || pins[0] || null,
    [pins, effectiveCh1PinId]
  );

  const ch2Pin = useMemo(() => {
    if (pins.length === 0) return null;
    return (
      pins.find((p) => p.id === ch2PinId) ||
      pins.find((p) => p.id === pickCompanionPinId(ch1Pin?.id || '', pins)) ||
      pins[0]
    );
  }, [pins, ch2PinId, ch1Pin]);

  const ch1FaultType = useMemo(
    () => (ch1Pin ? faults.find((f) => f.pinId === ch1Pin.id)?.faultType ?? 'NONE' : 'NONE'),
    [faults, ch1Pin]
  );

  const ch2FaultType = useMemo(
    () => (ch2Pin ? faults.find((f) => f.pinId === ch2Pin.id)?.faultType ?? 'NONE' : 'NONE'),
    [faults, ch2Pin]
  );

  const ch1MnaVoltage = ch1Pin ? nodeVoltages[ch1Pin.id] ?? ch1Pin.nominalVoltage : 0;
  const ch2MnaVoltage = ch2Pin ? nodeVoltages[ch2Pin.id] ?? ch2Pin.nominalVoltage : 0;

  const canHMnaV = nodeVoltages['ecu-pin-13'] ?? 2.5;
  const canLMnaV = nodeVoltages['ecu-pin-14'] ?? 2.5;
  const injMnaV = nodeVoltages['ecu-pin-10'] ?? 12.6;
  const o2MnaV = nodeVoltages['ecu-pin-15'] ?? 0.45;
  const tpsMnaV = nodeVoltages['ecu-pin-7'] ?? 0.85;

  const canPinFault = faults.find((f) => f.pinId === 'ecu-pin-13' || f.pinId === 'ecu-pin-14')?.faultType ?? 'NONE';
  const injPinFault = faults.find((f) => f.pinId === 'ecu-pin-10')?.faultType ?? 'NONE';
  const o2PinFault = faults.find((f) => f.pinId === 'ecu-pin-15')?.faultType ?? 'NONE';
  const isCanBusHealthy =
    isPowerOn &&
    !hasCanFault &&
    canHMnaV >= 0.3 &&
    canLMnaV >= 0.3 &&
    Math.abs(canHMnaV - canLMnaV) <= 3.0;

  const activeRpm = isRpmEmulatorActive ? emulatorRpm : 850;
  const dualWindowMs = Math.max(10, Math.round(40 / timeDiv));

  // Stationary telemetry snapshot for DUAL_PIN mode (no animation loop state churn)
  const dualTelemetry = useMemo(() => {
    if (activeSignal !== 'DUAL_PIN' || !ch1Pin || !ch2Pin) return null;
    return SignalGenerator.sampleDualPinWaveformSeries({
      ch1PinId: ch1Pin.id,
      ch1PinLabel: ch1Pin.label,
      ch1MnaVoltage,
      ch1FaultType,
      ch2PinId: ch2Pin.id,
      ch2PinLabel: ch2Pin.label,
      ch2MnaVoltage,
      ch2FaultType,
      isPowerOn,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm: activeRpm,
      tStartSec: 0,
      windowMs: dualWindowMs,
      sampleCount: 128,
    });
  }, [
    activeSignal,
    ch1Pin,
    ch2Pin,
    ch1MnaVoltage,
    ch1FaultType,
    ch2MnaVoltage,
    ch2FaultType,
    isPowerOn,
    hasCanFault,
    hasInjectorFault,
    isInjectorFiring,
    activeRpm,
    dualWindowMs,
  ]);

  // Live physical measurements anchored to MNA nodeVoltages & SignalGenerator
  let measuredVpp = '0.00 V';
  let measuredFreq = '0.0 Hz';
  let measuredDuty = '0.0 %';
  let measuredVrms = '0.00 V';

  if (activeSignal === 'DUAL_PIN' && dualTelemetry) {
    const f1 = dualTelemetry.ch1Stats.freqHz;
    measuredVpp = `${dualTelemetry.ch1Stats.vpp.toFixed(2)} / ${dualTelemetry.ch2Stats.vpp.toFixed(2)} V`;
    measuredFreq = f1 >= 1000 ? `${(f1 / 1000).toFixed(1)} kHz` : `${f1.toFixed(1)} Hz`;
    measuredDuty =
      dualTelemetry.correlationR !== null ? `r=${dualTelemetry.correlationR.toFixed(2)}` : 'DC/Flat';
    measuredVrms =
      dualTelemetry.phaseDiffDeg !== null ? `Δφ ${dualTelemetry.phaseDiffDeg.toFixed(1)}°` : `ΔV ${dualTelemetry.avgDiffV.toFixed(2)}V`;
  } else if (isPowerOn) {
    if (activeSignal === 'CAN_BUS') {
      const canAvgV = (canHMnaV + canLMnaV) / 2;
      measuredVpp = isCanBusHealthy ? '2.00 V' : '0.00 V';
      measuredFreq = isCanBusHealthy ? '500.0 kHz' : '0.0 kHz';
      measuredDuty = isCanBusHealthy ? '50.0 %' : '0.0 %';
      measuredVrms = `${canAvgV.toFixed(2)} V`;
    } else if (activeSignal === 'INJECTOR_PWM') {
      const injSeries = SignalGenerator.samplePinWaveformSeries({
        pinId: 'ecu-pin-10',
        pinLabel: 'INJ_1',
        mnaNodeVoltage: injMnaV,
        faultType: injPinFault,
        isPowerOn,
        hasCanFault,
        hasInjectorFault,
        isInjectorFiring,
        rpm: activeRpm,
        tStartSec: 0,
        windowMs: 160,
        sampleCount: 128,
      });
      measuredVpp = `${injSeries.vpp.toFixed(2)} V`;
      measuredFreq = injSeries.freqHz > 0 ? `${injSeries.freqHz.toFixed(1)} Hz` : '0.0 Hz';
      const dutyPct =
        injSeries.freqHz > 0 ? Math.min(45, (2.5 / (1000 / injSeries.freqHz)) * 100) : 0;
      measuredDuty = `${dutyPct.toFixed(1)} %`;
      measuredVrms = `${injSeries.vAvg.toFixed(2)} V`;
    } else if (activeSignal === 'CRANK_CKP') {
      if (ckpSignalLost) {
        measuredVpp = '0.00 V';
        measuredFreq = '0.00 kHz';
        measuredDuty = 'CKP LOST';
        measuredVrms = '0.00 V';
      } else {
        const crankFreqKhz = ((activeRpm / 60) * 60) / 1000;
        const vrPeak = Math.min(18.0, 1.2 + (activeRpm / 1000) * 1.8);
        measuredVpp = `${(vrPeak * 2).toFixed(2)} V`;
        measuredFreq = `${crankFreqKhz.toFixed(2)} kHz`;
        measuredDuty = `CMP ${camPhaseOffsetDeg > 0 ? '+' : ''}${camPhaseOffsetDeg}°`;
        measuredVrms = `${(vrPeak * 0.707).toFixed(2)} V`;
      }
    } else if (activeSignal === 'O2_LAMBDA') {
      const o2Series = SignalGenerator.samplePinWaveformSeries({
        pinId: 'ecu-pin-15',
        pinLabel: 'O2_SIG',
        mnaNodeVoltage: o2MnaV,
        faultType: o2PinFault,
        isPowerOn,
        hasCanFault,
        hasInjectorFault,
        isInjectorFiring,
        rpm: activeRpm,
        tStartSec: 0,
        windowMs: 1000,
        sampleCount: 64,
      });
      measuredVpp = `${o2Series.vpp.toFixed(2)} V`;
      measuredFreq = `${o2Series.freqHz.toFixed(2)} Hz`;
      measuredDuty = o2Series.freqHz > 0 ? '50.0 %' : '0.0 %';
      measuredVrms = `${o2Series.vAvg.toFixed(2)} V`;
    } else {
      measuredVpp = '0.00 V';
      measuredFreq = '0.0 Hz';
      measuredDuty = '100.0 %';
      measuredVrms = `${tpsMnaV.toFixed(2)} V`;
    }
  }

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animFrame = 0;
    let simTime = 0;
    let width = Math.max(1, Math.floor(container.clientWidth));
    let height = Math.max(1, Math.floor(container.clientHeight));
    let canHighBuf = new Float32Array(width);
    let canLowBuf = new Float32Array(width);

    const syncCanvasSize = () => {
      const rect = container.getBoundingClientRect();
      const targetWidth = Math.max(1, Math.floor(rect.width));
      const targetHeight = Math.max(1, Math.floor(rect.height));
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const pixelW = Math.floor(targetWidth * dpr);
      const pixelH = Math.floor(targetHeight * dpr);

      width = targetWidth;
      height = targetHeight;

      if (canvas.width !== pixelW || canvas.height !== pixelH) {
        canvas.width = pixelW;
        canvas.height = pixelH;
      }
      if (canHighBuf.length < width) {
        canHighBuf = new Float32Array(width);
        canLowBuf = new Float32Array(width);
      }
    };

    const drawFrame = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      // Dark oscilloscope phosphor CRT screen background
      ctx.fillStyle = '#030807';
      ctx.fillRect(0, 0, width, height);

      // Draw Reticle Grid
      ctx.strokeStyle = '#0a231f';
      ctx.lineWidth = 1;

      const numX = 10;
      const numY = 8;
      const stepX = width / numX;
      const stepY = height / numY;

      ctx.beginPath();
      for (let x = 0; x <= width; x += stepX) {
        ctx.moveTo(x, 0);
        ctx.lineTo(x, height);
      }
      for (let y = 0; y <= height; y += stepY) {
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
      }
      ctx.stroke();

      // Center crosshair axis
      ctx.strokeStyle = '#143c34';
      ctx.beginPath();
      ctx.moveTo(width / 2, 0);
      ctx.lineTo(width / 2, height);
      ctx.moveTo(0, height / 2);
      ctx.lineTo(width, height / 2);
      ctx.stroke();

      if (!isPowerOn) {
        ctx.fillStyle = '#10b98144';
        ctx.font = '12px monospace';
        ctx.fillText('[ CIRCUIT DE-ENERGIZED - ZERO SIGNAL VOLTAGE ]', width / 2 - 140, height / 2);
        ctx.restore();
        return;
      }

      if (isRunning) {
        simTime += 0.0004 * timeDiv * simulationSpeed;
      }

      ctx.lineWidth = 2.5;

      if (activeSignal === 'DUAL_PIN' && ch1Pin && ch2Pin) {
        const dual = SignalGenerator.sampleDualPinWaveformSeries({
          ch1PinId: ch1Pin.id,
          ch1PinLabel: ch1Pin.label,
          ch1MnaVoltage,
          ch1FaultType,
          ch2PinId: ch2Pin.id,
          ch2PinLabel: ch2Pin.label,
          ch2MnaVoltage,
          ch2FaultType,
          isPowerOn,
          hasCanFault,
          hasInjectorFault,
          isInjectorFiring,
          rpm: activeRpm,
          tStartSec: simTime,
          windowMs: dualWindowMs,
          sampleCount: 128,
          skipCorrelation: true,
        });

        const samples = dual.samples;
        const padTop = 34;
        const padBottom = 30;
        const usableH = Math.max(40, height - padTop - padBottom);

        if (isAutoScale) {
          // Shared normalized 0–100% viewport with 0%, 50%, and 100% guide lines
          ctx.save();
          ctx.strokeStyle = '#10b98133';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.font = '9px monospace';
          ctx.fillStyle = '#34d399cc';
          ctx.textAlign = 'right';
          [
            { pct: 100, label: '100%', offsetY: 10 },
            { pct: 50, label: '50%', offsetY: -4 },
            { pct: 0, label: '0%', offsetY: -4 },
          ].forEach(({ pct, label, offsetY }) => {
            const gy = padTop + (1 - pct / 100) * usableH;
            ctx.beginPath();
            ctx.moveTo(0, gy);
            ctx.lineTo(width, gy);
            ctx.stroke();
            ctx.fillText(label, width - 8, gy + offsetY);
          });
          ctx.restore();

          ctx.lineWidth = 2.25;
          // CH1 Normalized (Yellow) across shared full viewport
          ctx.strokeStyle = '#facc15';
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 5;
          ctx.beginPath();
          for (let i = 0; i < samples.length; i++) {
            const x = (i / Math.max(1, samples.length - 1)) * width;
            const y = padTop + (1 - samples[i].ch1Norm / 100) * usableH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // CH2 Normalized (Cyan) across exact same shared viewport
          ctx.strokeStyle = '#22d3ee';
          ctx.shadowColor = '#22d3ee';
          ctx.shadowBlur = 5;
          ctx.beginPath();
          for (let i = 0; i < samples.length; i++) {
            const x = (i / Math.max(1, samples.length - 1)) * width;
            const y = padTop + (1 - samples[i].ch2Norm / 100) * usableH;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        } else {
          const ch1BandMax = Math.max(5, dual.ch1Stats.vMax > 15 ? 68 : Math.ceil(dual.ch1Stats.vMax + 1));
          const ch2BandMax = Math.max(5, dual.ch2Stats.vMax > 15 ? 68 : Math.ceil(dual.ch2Stats.vMax + 1));
          const midY = padTop + usableH * 0.5;
          const halfBand = Math.max(18, usableH * 0.42);

          // Band separator for dual-pin CRT clarity
          ctx.strokeStyle = '#134e4a55';
          ctx.lineWidth = 1;
          ctx.setLineDash([4, 4]);
          ctx.beginPath();
          ctx.moveTo(0, midY);
          ctx.lineTo(width, midY);
          ctx.stroke();
          ctx.setLineDash([]);

          ctx.lineWidth = 2.25;
          // CH1 (Upper band, Yellow)
          ctx.strokeStyle = '#facc15';
          ctx.shadowColor = '#facc15';
          ctx.shadowBlur = 5;
          ctx.beginPath();
          for (let i = 0; i < samples.length; i++) {
            const x = (i / Math.max(1, samples.length - 1)) * width;
            const norm = Math.min(1.15, Math.max(-0.15, samples[i].ch1 / ch1BandMax));
            const y = midY - 6 - norm * halfBand * Math.min(1.3, voltDiv);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();

          // CH2 (Lower band, Cyan)
          ctx.strokeStyle = '#22d3ee';
          ctx.shadowColor = '#22d3ee';
          ctx.shadowBlur = 5;
          ctx.beginPath();
          for (let i = 0; i < samples.length; i++) {
            const x = (i / Math.max(1, samples.length - 1)) * width;
            const norm = Math.min(1.15, Math.max(-0.15, samples[i].ch2 / ch2BandMax));
            const y = height - padBottom - norm * halfBand * Math.min(1.3, voltDiv);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.stroke();
        }
      } else if (activeSignal === 'CAN_BUS') {
        const dt = 0.000008 / timeDiv;
        const halfH = height / 2;
        const scale = 38 * voltDiv;
        const canHardFault =
          !isCanBusHealthy ||
          canPinFault === 'SHORT_TO_GND' ||
          canPinFault === 'SHORT_TO_VBAT' ||
          canPinFault === 'OPEN_CIRCUIT';
        const mnaOffsetH = canHMnaV - 2.5;
        const mnaOffsetL = canLMnaV - 2.5;

        for (let x = 0; x < width; x++) {
          if (canHardFault) {
            canHighBuf[x] = halfH - (canHMnaV - 2.5) * scale - 20;
            canLowBuf[x] = halfH - (canLMnaV - 2.5) * scale + 20;
          } else {
            const sig = SignalGenerator.getCanBusSignals(simTime + x * dt, false);
            const vH = Math.max(0, sig.canHigh + mnaOffsetH);
            const vL = Math.max(0, sig.canLow + mnaOffsetL);
            canHighBuf[x] = halfH - (vH - 2.5) * scale - 20;
            canLowBuf[x] = halfH - (vL - 2.5) * scale + 20;
          }
        }

        // CH1 CAN_H Yellow
        ctx.strokeStyle = '#facc15';
        ctx.shadowColor = '#facc15';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          if (x === 0) ctx.moveTo(x, canHighBuf[x]);
          else ctx.lineTo(x, canHighBuf[x]);
        }
        ctx.stroke();

        // CH2 CAN_L Cyan
        ctx.strokeStyle = '#06b6d4';
        ctx.shadowColor = '#06b6d4';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          if (x === 0) ctx.moveTo(x, canLowBuf[x]);
          else ctx.lineTo(x, canLowBuf[x]);
        }
        ctx.stroke();
      } else if (activeSignal === 'INJECTOR_PWM') {
        const injHardFault =
          hasInjectorFault ||
          injPinFault === 'SHORT_TO_GND' ||
          injPinFault === 'SHORT_TO_VBAT' ||
          injPinFault === 'OPEN_CIRCUIT';
        ctx.strokeStyle = '#38bdf8';
        ctx.shadowColor = '#38bdf8';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const tPoint = simTime + (x * 0.00015 / timeDiv);
          const v =
            isInjectorFiring && !injHardFault
              ? SignalGenerator.getInjectorWaveform(tPoint, false, injMnaV, activeRpm)
              : injMnaV;
          const y = height - 30 - v * 2.6 * voltDiv;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (activeSignal === 'CRANK_CKP') {
        // CH1: Crankshaft 60-2 VR signal (upper band, Green)
        ctx.strokeStyle = ckpSignalLost ? '#f43f5e' : '#4ade80';
        ctx.shadowColor = ckpSignalLost ? '#f43f5e' : '#4ade80';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        const ckpCenterY = height * 0.38;
        for (let x = 0; x < width; x++) {
          const tPoint = simTime + (x * 0.00008 / timeDiv);
          const v = SignalGenerator.getCrankshaftVrSignal(tPoint, activeRpm, ckpSignalLost);
          const y = ckpCenterY - v * 8 * voltDiv;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();

        // CH2: Camshaft Hall 5V sync pulse (lower band, Cyan) with phase offset
        ctx.strokeStyle = '#22d3ee';
        ctx.shadowColor = '#22d3ee';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        const cmpBaseY = height * 0.80;
        for (let x = 0; x < width; x++) {
          const tPoint = simTime + (x * 0.00008 / timeDiv);
          const vCmp = SignalGenerator.getCamshaftHallSignal(tPoint, activeRpm, camPhaseOffsetDeg);
          const y = cmpBaseY - vCmp * 6 * voltDiv;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else if (activeSignal === 'O2_LAMBDA') {
        const o2HardFault =
          o2PinFault === 'SHORT_TO_GND' ||
          o2PinFault === 'SHORT_TO_VBAT' ||
          o2PinFault === 'OPEN_CIRCUIT';
        ctx.strokeStyle = '#f43f5e';
        ctx.shadowColor = '#f43f5e';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        for (let x = 0; x < width; x++) {
          const tPoint = simTime + (x * 0.002 / timeDiv);
          const v = o2HardFault
            ? o2MnaV
            : Math.min(1.1, Math.max(0.05, o2MnaV + 0.35 * Math.sin(tPoint * 2 * Math.PI * 1.25)));
          const y = height / 2 - (v - 0.5) * 100 * voltDiv;
          if (x === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        }
        ctx.stroke();
      } else {
        // TPS_DC analog level anchored strictly to live MNA node voltage on Pin 7
        ctx.strokeStyle = '#fbbf24';
        ctx.shadowColor = '#fbbf24';
        ctx.shadowBlur = 5;
        ctx.beginPath();
        const y = height - 35 - tpsMnaV * 28 * voltDiv;
        ctx.moveTo(0, y);
        ctx.lineTo(width, y);
        ctx.stroke();
      }

      ctx.restore();
    };

    const tick = () => {
      drawFrame();
      if (isPowerOn && isRunning && !document.hidden) {
        animFrame = requestAnimationFrame(tick);
      } else {
        animFrame = 0;
      }
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (animFrame) {
          cancelAnimationFrame(animFrame);
          animFrame = 0;
        }
      } else if (isPowerOn && isRunning && !animFrame) {
        animFrame = requestAnimationFrame(tick);
      }
    };

    const resizeObserver = new ResizeObserver(() => {
      syncCanvasSize();
      drawFrame();
    });
    resizeObserver.observe(container);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    syncCanvasSize();
    drawFrame();
    if (isPowerOn && isRunning && !document.hidden) {
      animFrame = requestAnimationFrame(tick);
    }

    return () => {
      if (animFrame) cancelAnimationFrame(animFrame);
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      // Release GPU backing texture on unmount
      canvas.width = 0;
      canvas.height = 0;
    };
  }, [
    isPowerOn,
    isRunning,
    activeSignal,
    hasCanFault,
    hasInjectorFault,
    timeDiv,
    voltDiv,
    simulationSpeed,
    activeRpm,
    isInjectorFiring,
    camPhaseOffsetDeg,
    ckpSignalLost,
    isCanBusHealthy,
    canPinFault,
    injPinFault,
    o2PinFault,
    canHMnaV,
    canLMnaV,
    injMnaV,
    o2MnaV,
    tpsMnaV,
    ch1Pin,
    ch2Pin,
    ch1MnaVoltage,
    ch2MnaVoltage,
    ch1FaultType,
    ch2FaultType,
    dualWindowMs,
    isAutoScale,
  ]);

  const handleSelectCh1Pin = (pinId: string) => {
    setLocalCh1PinId(pinId);
    onSelectPin?.(pinId);
  };

  const handleSwapDualPins = () => {
    if (!ch1Pin || !ch2Pin) return;
    const prev1 = ch1Pin.id;
    handleSelectCh1Pin(ch2Pin.id);
    setCh2PinId(prev1);
  };

  return (
    <div className="hud-panel rounded-xl p-2.5 sm:p-3.5 text-slate-100 flex flex-col gap-2.5 sm:gap-3 shrink-0">
      {/* Scope Header */}
      <div className="flex flex-wrap items-center justify-between border-b border-cyan-500/15 pb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-4 h-4 text-emerald-400 shrink-0" />
          <span className="text-xs sm:text-sm font-hud font-bold tracking-wider text-slate-100 uppercase truncate">
            Digital Storage Lab Oscilloscope
          </span>
          <span className="hidden sm:inline text-[10px] font-mono text-emerald-400 font-bold shrink-0">
            2-CH 50MS/s TRUE RMS
          </span>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={() => setIsRunning(!isRunning)}
            className={`px-2.5 py-1 text-[10px] font-mono rounded border flex items-center gap-1.5 font-semibold transition ${
              isRunning
                ? 'bg-emerald-950/80 border-emerald-700 text-emerald-300'
                : 'bg-amber-950/80 border-amber-700 text-amber-300'
            }`}
          >
            {isRunning ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
            <span>{isRunning ? 'RUNNING' : 'HOLD / STOP'}</span>
          </button>
        </div>
      </div>

      {/* Screen Canvas Container */}
      <div
        ref={containerRef}
        className="relative border-2 border-slate-800 rounded-lg overflow-hidden bg-[#030807] h-[195px] sm:h-[220px] w-full"
      >
        <canvas ref={canvasRef} className="w-full h-full block" />

        {/* Live HUD Waveform Annotations */}
        <div className="absolute top-2 left-2 right-2 flex flex-wrap gap-1.5 text-[9.5px] sm:text-[10px] font-mono pointer-events-none">
          {activeSignal === 'DUAL_PIN' && ch1Pin && ch2Pin ? (
            <>
              <span className="text-yellow-400 font-bold bg-slate-950/85 px-1.5 sm:px-2 py-0.5 rounded border border-yellow-500/40 truncate">
                CH1: #{ch1Pin.pinNumber} {ch1Pin.label} ({ch1MnaVoltage.toFixed(2)}V)
              </span>
              <span className="text-cyan-400 font-bold bg-slate-950/85 px-1.5 sm:px-2 py-0.5 rounded border border-cyan-500/40 truncate">
                CH2: #{ch2Pin.pinNumber} {ch2Pin.label} ({ch2MnaVoltage.toFixed(2)}V)
              </span>
              {dualTelemetry && (
                <span className="text-purple-300 font-bold bg-slate-950/85 px-1.5 sm:px-2 py-0.5 rounded border border-purple-500/40 truncate">
                  {dualTelemetry.correlationMode.replace('_', ' ')}
                  {dualTelemetry.timeLagMs !== null
                    ? ` · Δt ${dualTelemetry.timeLagMs >= 0 ? '+' : ''}${dualTelemetry.timeLagMs.toFixed(2)}ms`
                    : ''}
                </span>
              )}
            </>
          ) : (
            <>
              <span className="text-yellow-400 font-bold bg-slate-950/85 px-1.5 sm:px-2 py-0.5 rounded border border-yellow-500/40 truncate">
                {activeSignal === 'CAN_BUS'
                  ? `CH1: CAN_H (${canHMnaV.toFixed(2)}V)`
                  : activeSignal === 'INJECTOR_PWM'
                  ? `CH1: INJ_1 (${injMnaV.toFixed(2)}V)`
                  : activeSignal === 'CRANK_CKP'
                  ? `CH1: CKP 60-2 VR ${ckpSignalLost ? '(LOST · P0335)' : `(${activeRpm} RPM)`}`
                  : activeSignal === 'O2_LAMBDA'
                  ? `CH1: O2_SIG (${o2MnaV.toFixed(2)}V)`
                  : `CH1: TPS_SIG (${tpsMnaV.toFixed(2)}V)`}
              </span>
              {activeSignal === 'CAN_BUS' && (
                <span className="text-cyan-400 font-bold bg-slate-950/85 px-1.5 sm:px-2 py-0.5 rounded border border-cyan-500/40 truncate">
                  CH2: CAN_L ({canLMnaV.toFixed(2)}V · {isCanBusHealthy ? '2.0V Diff' : 'FAULT'})
                </span>
              )}
              {activeSignal === 'CRANK_CKP' && (
                <span
                  className={`font-bold bg-slate-950/85 px-1.5 sm:px-2 py-0.5 rounded border truncate ${
                    Math.abs(camPhaseOffsetDeg) > 15
                      ? 'text-rose-300 border-rose-500/50'
                      : 'text-cyan-400 border-cyan-500/40'
                  }`}
                >
                  CH2: CMP Hall ({camPhaseOffsetDeg > 0 ? '+' : ''}{camPhaseOffsetDeg}°{Math.abs(camPhaseOffsetDeg) > 15 ? ' · P0016' : ''})
                </span>
              )}
            </>
          )}
        </div>

        {/* Live On-Screen Telemetry Strip */}
        <div className="absolute bottom-1.5 left-1.5 right-1.5 flex flex-wrap items-center justify-between gap-x-2 gap-y-0.5 text-[9.5px] sm:text-[10px] font-mono text-slate-400 hud-well px-2 py-1 rounded pointer-events-none">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
            <span>Vpp: <strong className="text-cyan-300 font-mono tabular-nums">{measuredVpp}</strong></span>
            <span>Freq: <strong className="text-emerald-300 font-mono tabular-nums">{measuredFreq}</strong></span>
            <span>{activeSignal === 'DUAL_PIN' ? 'Corr:' : 'Duty:'} <strong className="text-amber-300 font-mono tabular-nums">{measuredDuty}</strong></span>
            <span>{activeSignal === 'DUAL_PIN' ? 'Phase:' : 'Vrms:'} <strong className="text-slate-200 font-mono tabular-nums">{measuredVrms}</strong></span>
          </div>
          <div className="hidden sm:block text-[9px] text-slate-500">
            {activeSignal === 'DUAL_PIN'
              ? isAutoScale
                ? `WIN: ${dualWindowMs}ms · AUTO-SCALE: 0–100% OVERLAY`
                : `WIN: ${dualWindowMs}ms · DUAL-PIN SYNC`
              : 'TRIGGER: AUTO EDGE ↑'}
          </div>
        </div>
      </div>

      {/* Dual-Pin Selector Bar (shown when Dual Pin A/B mode is active) */}
      {activeSignal === 'DUAL_PIN' && pins.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] font-mono bg-slate-950/80 border border-cyan-500/20 rounded-lg px-2.5 py-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1 text-yellow-300 font-semibold">
              <span>CH1 Pin:</span>
              <select
                aria-label="CRT Scope CH1 Pin"
                value={ch1Pin?.id || ''}
                onChange={(e) => handleSelectCh1Pin(e.target.value)}
                className="bg-slate-900 border border-yellow-500/40 rounded px-1.5 py-0.5 text-yellow-200 focus:outline-none cursor-pointer"
              >
                {pins.map((pin) => (
                  <option key={pin.id} value={pin.id}>
                    #{pin.pinNumber} {pin.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={handleSwapDualPins}
              aria-label="Swap CRT CH1 and CH2 pins"
              title="Swap CH1 and CH2 pins"
              className="p-1 rounded bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-300 hover:text-cyan-300"
            >
              <ArrowLeftRight className="w-3 h-3" />
            </button>

            <label className="flex items-center gap-1 text-cyan-300 font-semibold">
              <span>CH2 Pin:</span>
              <select
                aria-label="CRT Scope CH2 Pin"
                value={ch2Pin?.id || ''}
                onChange={(e) => setCh2PinId(e.target.value)}
                className="bg-slate-900 border border-cyan-500/40 rounded px-1.5 py-0.5 text-cyan-200 focus:outline-none cursor-pointer"
              >
                {pins.map((pin) => (
                  <option key={pin.id} value={pin.id}>
                    #{pin.pinNumber} {pin.label}
                  </option>
                ))}
              </select>
            </label>

            <button
              type="button"
              onClick={() => setIsAutoScale((prev) => !prev)}
              aria-pressed={isAutoScale}
              aria-label="Toggle CRT Auto-Scale normalized overlay"
              title="Normalize both channels to 0–100% in the same CRT viewport for direct phase & edge alignment"
              className={`px-2 py-0.5 rounded border text-[10px] font-bold flex items-center gap-1 transition ${
                isAutoScale
                  ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200'
                  : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-emerald-500/50'
              }`}
            >
              <ArrowUpDown className="w-3 h-3" />
              <span>Auto-Scale</span>
            </button>
          </div>
          {dualTelemetry && (
            <div className="flex flex-wrap items-center gap-2 text-slate-300 tabular-nums">
              {isAutoScale && (
                <span className="px-1.5 py-0.5 rounded border bg-emerald-950/85 border-emerald-500/45 text-emerald-300 text-[9px] font-bold">
                  AUTO-SCALE 0–100%
                  {dualTelemetry.autoScale.amplitudeRatio !== null
                    ? ` · ${dualTelemetry.autoScale.amplitudeRatio.toFixed(2)}×`
                    : ''}
                </span>
              )}
              <span>
                Avg ΔV:{' '}
                <strong className="text-amber-300">
                  {dualTelemetry.avgDiffV >= 0 ? '+' : ''}
                  {dualTelemetry.avgDiffV.toFixed(2)}V
                </strong>
              </span>
            </div>
          )}
        </div>
      )}

      {/* Control Bar & Channel Selector */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono pt-1 border-t border-cyan-500/15">
        <div className="flex items-center gap-1 overflow-x-auto scrollbar-none w-full sm:w-auto sm:flex-wrap pb-0.5">
          <span className="text-[10px] text-slate-400 uppercase whitespace-nowrap shrink-0 mr-0.5">CH:</span>
          {pins.length >= 2 && (
            <button
              onClick={() => setActiveSignal('DUAL_PIN')}
              className={`px-2 py-1 text-[10px] rounded border transition whitespace-nowrap shrink-0 flex items-center gap-1 ${
                activeSignal === 'DUAL_PIN'
                  ? 'bg-cyan-950/90 border-cyan-400 text-cyan-200 font-semibold'
                  : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
              }`}
            >
              <GitCompare className="w-3 h-3" />
              Dual Pin A/B
            </button>
          )}
          <button
            onClick={() => setActiveSignal('CAN_BUS')}
            className={`px-2 py-1 text-[10px] rounded border transition whitespace-nowrap shrink-0 ${
              activeSignal === 'CAN_BUS'
                ? 'bg-slate-800 border-yellow-400 text-yellow-300 font-semibold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            CAN High/Low
          </button>
          <button
            onClick={() => setActiveSignal('INJECTOR_PWM')}
            className={`px-2 py-1 text-[10px] rounded border transition whitespace-nowrap shrink-0 ${
              activeSignal === 'INJECTOR_PWM'
                ? 'bg-slate-800 border-cyan-400 text-cyan-300 font-semibold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Injector 1 PWM
          </button>
          <button
            onClick={() => setActiveSignal('CRANK_CKP')}
            className={`px-2 py-1 text-[10px] rounded border transition whitespace-nowrap shrink-0 ${
              activeSignal === 'CRANK_CKP'
                ? 'bg-slate-800 border-emerald-400 text-emerald-300 font-semibold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            Crank 60-2
          </button>
          <button
            onClick={() => setActiveSignal('O2_LAMBDA')}
            className={`px-2 py-1 text-[10px] rounded border transition whitespace-nowrap shrink-0 ${
              activeSignal === 'O2_LAMBDA'
                ? 'bg-slate-800 border-purple-400 text-purple-300 font-semibold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            O2 Lambda
          </button>
          <button
            onClick={() => setActiveSignal('TPS_DC')}
            className={`px-2 py-1 text-[10px] rounded border transition whitespace-nowrap shrink-0 ${
              activeSignal === 'TPS_DC'
                ? 'bg-slate-800 border-amber-400 text-amber-300 font-semibold'
                : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
            }`}
          >
            TPS DC
          </button>
        </div>

        {/* Scope Scale Controls */}
        <div className="flex items-center gap-2 sm:gap-3 text-[10px] text-slate-400 w-full sm:w-auto justify-between sm:justify-end">
          <div className="flex items-center gap-1.5 hud-well px-2 py-1 rounded">
            <span>V/DIV:</span>
            <button
              onClick={() => setVoltDiv(v => Math.max(0.5, v - 0.25))}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-bold"
            >
              -
            </button>
            <span className="font-semibold text-slate-200 tabular-nums">{voltDiv.toFixed(2)}x</span>
            <button
              onClick={() => setVoltDiv(v => Math.min(2.5, v + 0.25))}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-bold"
            >
              +
            </button>
          </div>

          <div className="flex items-center gap-1.5 hud-well px-2 py-1 rounded">
            <span>T/DIV:</span>
            <button
              onClick={() => setTimeDiv(t => Math.max(0.5, t - 0.25))}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-bold"
            >
              -
            </button>
            <span className="font-semibold text-slate-200 tabular-nums">{timeDiv.toFixed(2)}x</span>
            <button
              onClick={() => setTimeDiv(t => Math.min(2.0, t + 0.25))}
              className="px-1.5 py-0.5 bg-slate-800 hover:bg-slate-700 rounded text-slate-300 font-bold"
            >
              +
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

