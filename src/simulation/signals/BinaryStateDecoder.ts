import { FaultType } from '../../types/ecu';
import { SignalGenerator } from './SignalGenerator';

export type BinaryDetectedProtocol =
  | 'CAN_BUS'
  | 'PWM_ACTUATOR'
  | 'LOGIC_PULSE'
  | 'ANALOG_SWITCHING'
  | 'STATIC_LEVEL'
  | 'FAULT_OR_OFF';

export type BinaryPolarity = 'ACTIVE_HIGH' | 'ACTIVE_LOW' | 'DIFFERENTIAL';

export type CanBusHealth =
  | 'ACTIVE_500KBPS'
  | 'BUS_FAULT_COLLAPSED'
  | 'RECESSIVE_IDLE'
  | 'POWER_OFF';

export interface BinaryLogicSample {
  index: number;
  timeMs: number;
  voltage: number;
  secondaryVoltage?: number;
  diffVoltage?: number;
  logicState: 0 | 1;
  busState?: 'DOMINANT' | 'RECESSIVE' | 'FAULT';
  isFlyback?: boolean;
}

export interface CanFramePatternSummary {
  health: CanBusHealth;
  nominalBaudKbps: number;
  sampleRateLabel: string;
  vDiffMax: number;
  vDiffMin: number;
  dominantPct: number;
  recessivePct: number;
  sofDetected: boolean;
  sofBitIndex: number | null;
  arbitrationIdHex: string;
  dlc: number;
  payloadHexBytes: string[];
  bitTransitions: number;
}

export type SignalAnomalyCode =
  | 'INVALID_CAN_FRAMING'
  | 'CAN_SIGNAL_ATTENUATION'
  | 'CAN_DOMINANT_OVERLOAD'
  | 'PWM_SIGNAL_CLIPPING'
  | 'PWM_MISSING_PULSES'
  | 'PWM_FREQUENCY_DRIFT'
  | 'CAPTURE_WINDOW_SHORT'
  | 'O2_SIGNAL_FIXED'
  | 'PIN_HARD_FAULT'
  | 'DC_RAIL_CHATTER';

export type SignalAnomalySeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface SignalAnomalyNotification {
  id: string;
  code: SignalAnomalyCode;
  title: string;
  severity: SignalAnomalySeverity;
  detail: string;
  transitionFreqHz: number;
  expectedRangeLabel: string;
  observedLabel: string;
  recommendation: string;
}

export interface BinaryPinMetrics {
  dutyCyclePct: number;
  pulseWidthMs: number;
  periodMs: number;
  frequencyHz: number;
  transitionFreqHz: number;
  edgeCount: number;
  highThresholdV: number;
  lowThresholdV: number;
  vMin: number;
  vMax: number;
  flybackPeakV: number | null;
  currentLogicLevel: 0 | 1;
  activePolarity: BinaryPolarity;
}

export interface BinaryPinMonitorResult {
  pinId: string;
  pinLabel: string;
  pinNumber: number;
  detectedProtocol: BinaryDetectedProtocol;
  protocolBadge: string;
  windowMs: number;
  samples: BinaryLogicSample[];
  bitString: string;
  hexBytes: string[];
  metrics: BinaryPinMetrics;
  canFrameSummary: CanFramePatternSummary | null;
  anomalies: SignalAnomalyNotification[];
  diagnosticSummary: string;
}

export interface AnalyzePinBinaryStateParams {
  pinId: string;
  pinLabel: string;
  pinNumber: number;
  mnaNodeVoltage: number;
  companionMnaVoltage?: number;
  faultType?: FaultType | string;
  companionFaultType?: FaultType | string;
  isPowerOn: boolean;
  hasCanFault: boolean;
  hasInjectorFault: boolean;
  isInjectorFiring: boolean;
  rpm: number;
  tStartSec: number;
  windowMs?: number;
}

const DISPLAY_SLOT_COUNT = 48;
const CAN_BIT_PERIOD_SEC = 1.0 / 25000.0; // Matches SignalGenerator.getCanBusSignals scaled 25 kHz capture rate (40 µs/bit)

function isHardFault(faultType?: string): boolean {
  return (
    faultType === 'SHORT_TO_GND' ||
    faultType === 'SHORT_TO_VBAT' ||
    faultType === 'OPEN_CIRCUIT'
  );
}

function bitsToHexBytes(bits: Array<0 | 1>): string[] {
  const bytes: string[] = [];
  for (let i = 0; i + 7 < bits.length; i += 8) {
    let val = 0;
    for (let b = 0; b < 8; b++) {
      val = (val << 1) | bits[i + b];
    }
    bytes.push(`0x${val.toString(16).toUpperCase().padStart(2, '0')}`);
  }
  return bytes;
}

function bitsToUint(bits: Array<0 | 1>, start: number, len: number): number {
  let val = 0;
  for (let i = 0; i < len; i++) {
    const bit = bits[start + i] ?? 0;
    val = (val << 1) | bit;
  }
  return val;
}

function countTransitions(bits: Array<0 | 1>): number {
  let edges = 0;
  for (let i = 1; i < bits.length; i++) {
    if (bits[i] !== bits[i - 1]) edges++;
  }
  return edges;
}

/**
 * Pure deterministic decoder that converts MNA node voltages and SignalGenerator
 * physical waveforms into binary logic states, PWM duty/frequency metrics, and
 * ISO 11898 CAN bus frame pattern analysis.
 */
export function analyzePinBinaryState(
  params: AnalyzePinBinaryStateParams
): BinaryPinMonitorResult {
  const {
    pinId,
    pinLabel,
    pinNumber,
    mnaNodeVoltage,
    companionMnaVoltage,
    faultType = 'NONE',
    companionFaultType = 'NONE',
    isPowerOn,
    hasCanFault,
    hasInjectorFault,
    isInjectorFiring,
    rpm,
    tStartSec,
  } = params;

  const safeRpm = Math.max(300, rpm);
  const pinHardFault = isHardFault(faultType);
  const companionHardFault = isHardFault(companionFaultType);
  const isCanPin = pinId === 'ecu-pin-13' || pinId === 'ecu-pin-14';
  const isInjectorPin = pinId === 'ecu-pin-10';
  const isIgnitionPin = pinId === 'ecu-pin-11';
  const isO2Pin = pinId === 'ecu-pin-15';

  // =========================================================================
  // 1. ISO 11898 CAN BUS DIFFERENTIAL & FRAME PATTERN DECODING (CAN_H / CAN_L)
  // =========================================================================
  if (isCanPin) {
    const bitCount = DISPLAY_SLOT_COUNT; // 48 bits = 6 bytes
    const defaultWindowMs = Number(((bitCount - 1) * CAN_BIT_PERIOD_SEC * 1000).toFixed(2));
    const windowMs = params.windowMs ?? defaultWindowMs;
    // Sample strictly inside bit centers (+0.5 bitPeriod) when using bit-locked window
    const tLockedStart = tStartSec + CAN_BIT_PERIOD_SEC * 0.5;

    const canHId = 'ecu-pin-13';
    const canLId = 'ecu-pin-14';
    const canHMna =
      pinId === canHId ? mnaNodeVoltage : (companionMnaVoltage ?? mnaNodeVoltage);
    const canLMna =
      pinId === canLId ? mnaNodeVoltage : (companionMnaVoltage ?? mnaNodeVoltage);
    const canHFault = pinId === canHId ? faultType : companionFaultType;
    const canLFault = pinId === canLId ? faultType : companionFaultType;

    const seriesH = SignalGenerator.samplePinWaveformSeries({
      pinId: canHId,
      pinLabel: 'CAN_H',
      mnaNodeVoltage: canHMna,
      faultType: canHFault,
      isPowerOn,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm: safeRpm,
      tStartSec: tLockedStart,
      windowMs,
      sampleCount: bitCount,
    });

    const seriesL = SignalGenerator.samplePinWaveformSeries({
      pinId: canLId,
      pinLabel: 'CAN_L',
      mnaNodeVoltage: canLMna,
      faultType: canLFault,
      isPowerOn,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm: safeRpm,
      tStartSec: tLockedStart,
      windowMs,
      sampleCount: bitCount,
    });

    const busFaulted =
      !isPowerOn || hasCanFault || pinHardFault || companionHardFault;

    const samples: BinaryLogicSample[] = [];
    const isoBits: Array<0 | 1> = []; // ISO 11898: Dominant = 0, Recessive = 1
    let vMin = Infinity;
    let vMax = -Infinity;
    let vDiffMin = Infinity;
    let vDiffMax = -Infinity;
    let dominantCount = 0;

    for (let i = 0; i < bitCount; i++) {
      const sH = seriesH.samples[i];
      const sL = seriesL.samples[i];
      const vH = sH?.voltage ?? canHMna;
      const vL = sL?.voltage ?? canLMna;
      const vPrimary = pinId === canHId ? vH : vL;
      const vSecondary = pinId === canHId ? vL : vH;
      const diffV = Number((vH - vL).toFixed(3));

      vMin = Math.min(vMin, vPrimary);
      vMax = Math.max(vMax, vPrimary);
      vDiffMin = Math.min(vDiffMin, diffV);
      vDiffMax = Math.max(vDiffMax, diffV);

      // ISO 11898 threshold: V_diff >= 0.9V -> Dominant (logic 0); V_diff < 0.5V -> Recessive (logic 1)
      const isDominant = !busFaulted && diffV >= 0.9;
      const logicState: 0 | 1 = busFaulted
        ? pinHardFault && faultType === 'SHORT_TO_VBAT'
          ? 1
          : 0
        : isDominant
          ? 0
          : 1;
      const busState: 'DOMINANT' | 'RECESSIVE' | 'FAULT' = busFaulted
        ? 'FAULT'
        : isDominant
          ? 'DOMINANT'
          : 'RECESSIVE';

      if (isDominant) dominantCount++;
      isoBits.push(logicState);

      samples.push({
        index: i,
        timeMs: Number((sH?.timeMs ?? (i * windowMs) / (bitCount - 1)).toFixed(3)),
        voltage: vPrimary,
        secondaryVoltage: vSecondary,
        diffVoltage: diffV,
        logicState,
        busState,
      });
    }

    if (!Number.isFinite(vMin)) vMin = 0;
    if (!Number.isFinite(vMax)) vMax = 0;
    if (!Number.isFinite(vDiffMin)) vDiffMin = 0;
    if (!Number.isFinite(vDiffMax)) vDiffMax = 0;

    const bitTransitions = countTransitions(isoBits);
    const dominantPct = Number(((dominantCount / bitCount) * 100).toFixed(1));
    const recessivePct = Number((100 - dominantPct).toFixed(1));

    // Find Start-Of-Frame (SOF: Recessive 1 -> Dominant 0 transition)
    let sofBitIndex: number | null = null;
    for (let i = 1; i < isoBits.length - 12; i++) {
      if (isoBits[i - 1] === 1 && isoBits[i] === 0) {
        sofBitIndex = i;
        break;
      }
    }
    const frameStart = sofBitIndex !== null ? sofBitIndex + 1 : 0;
    const rawArbId = bitsToUint(isoBits, frameStart, 11);
    const arbitrationIdHex = `0x${rawArbId.toString(16).toUpperCase().padStart(3, '0')}`;
    const rawDlcBits = bitsToUint(isoBits, frameStart + 14, 4);
    const dlc = busFaulted ? 0 : Math.min(8, rawDlcBits & 0x7 || 4);
    const payloadStart = Math.min(isoBits.length - 16, frameStart + 18);
    const payloadHexBytes = bitsToHexBytes(isoBits.slice(payloadStart, payloadStart + 16));

    let health: CanBusHealth = 'ACTIVE_500KBPS';
    if (!isPowerOn) {
      health = 'POWER_OFF';
    } else if (hasCanFault || pinHardFault || companionHardFault || vDiffMax < 0.9) {
      health = dominantCount === 0 && !pinHardFault && !companionHardFault && !hasCanFault
        ? 'RECESSIVE_IDLE'
        : 'BUS_FAULT_COLLAPSED';
    }

    const detectedProtocol: BinaryDetectedProtocol =
      health === 'ACTIVE_500KBPS' ? 'CAN_BUS' : 'FAULT_OR_OFF';

    const bitString = isoBits.join('');
    const hexBytes = bitsToHexBytes(isoBits);
    const windowSecCan = Math.max(1e-4, windowMs / 1000);
    const canTransitionFreqHz = Number((bitTransitions / windowSecCan).toFixed(2));
    const sofDetected = !busFaulted && sofBitIndex !== null;

    const canAnomalies: SignalAnomalyNotification[] = [];
    if (isPowerOn) {
      if (
        busFaulted ||
        vDiffMax < 0.9 ||
        bitTransitions === 0 ||
        canTransitionFreqHz < 2200 ||
        !sofDetected
      ) {
        const reason = busFaulted || vDiffMax < 0.9
          ? `Differential swing collapsed (V_diff peak ${vDiffMax.toFixed(2)}V < 0.90V ISO 11898 threshold) with ${bitTransitions} edges.`
          : !sofDetected
            ? `No valid Start-of-Frame (1→0) boundary detected across ${bitCount} sampled bits (${canTransitionFreqHz.toFixed(0)} Hz transitions).`
            : `Binary transition frequency (${canTransitionFreqHz.toFixed(0)} Hz) fell below minimum active framing threshold (2.2 kHz).`;
        canAnomalies.push({
          id: `${pinId}-INVALID_CAN_FRAMING`,
          code: 'INVALID_CAN_FRAMING',
          title: 'Invalid CAN Framing',
          severity: 'CRITICAL',
          detail: reason,
          transitionFreqHz: canTransitionFreqHz,
          expectedRangeLabel: '3.0–24.0 kHz transitions · SOF + V_diff ≥ 0.90V',
          observedLabel: `${canTransitionFreqHz.toFixed(0)} Hz (${bitTransitions} edges) · V_diff ${vDiffMax.toFixed(2)}V`,
          recommendation:
            'Inspect CAN_H (#13) / CAN_L (#14) continuity, 60Ω dual termination, and short-to-GND/VBAT faults.',
        });
      } else {
        if (vDiffMax < 1.4) {
          canAnomalies.push({
            id: `${pinId}-CAN_SIGNAL_ATTENUATION`,
            code: 'CAN_SIGNAL_ATTENUATION',
            title: 'CAN Differential Attenuation',
            severity: 'WARNING',
            detail: `CAN differential amplitude attenuated to ${vDiffMax.toFixed(2)}V (nominal 2.00V), risking bit-sampling errors under EMI.`,
            transitionFreqHz: canTransitionFreqHz,
            expectedRangeLabel: '1.50–2.20V V_diff',
            observedLabel: `${vDiffMax.toFixed(2)}V V_diff @ ${canTransitionFreqHz.toFixed(0)} Hz`,
            recommendation: 'Check connector pin corrosion (+50Ω/+250Ω) or missing 120Ω termination resistor.',
          });
        }
        if (dominantPct > 75) {
          canAnomalies.push({
            id: `${pinId}-CAN_DOMINANT_OVERLOAD`,
            code: 'CAN_DOMINANT_OVERLOAD',
            title: 'CAN Bus Dominant Overload',
            severity: 'WARNING',
            detail: `Dominant state occupancy (${dominantPct.toFixed(1)}%) exceeds nominal frame arbitration balance, reducing edge density.`,
            transitionFreqHz: canTransitionFreqHz,
            expectedRangeLabel: '15–65% Dominant duty',
            observedLabel: `${dominantPct.toFixed(1)}% Dominant (${canTransitionFreqHz.toFixed(0)} Hz)`,
            recommendation: 'Verify transceiver TXD pin is not stuck dominant or flooding high-priority IDs.',
          });
        }
      }
    }

    let diagnosticSummary = '';
    if (!isPowerOn) {
      diagnosticSummary =
        'Bench PSU output is OFF. CAN transceiver unpowered — bus differential quiescent at 0.00V.';
    } else if (health === 'BUS_FAULT_COLLAPSED') {
      diagnosticSummary = `CAN frame traffic interrupted (${pinLabel} / companion fault). V_diff collapsed to ${vDiffMax.toFixed(2)}V (ISO 11898 requires ≥0.9V for Dominant 0).`;
    } else {
      diagnosticSummary = `ISO 11898 High-Speed CAN active: ${dominantPct.toFixed(1)}% Dominant (0) / ${recessivePct.toFixed(1)}% Recessive (1), V_diff peak ${vDiffMax.toFixed(2)}V, ${bitTransitions} bit edges (${(canTransitionFreqHz / 1000).toFixed(2)} kHz).`;
    }

    return {
      pinId,
      pinLabel,
      pinNumber,
      detectedProtocol,
      protocolBadge:
        detectedProtocol === 'CAN_BUS' ? 'CAN 2.0A/B FRAME' : 'CAN BUS FAULT / OFF',
      windowMs,
      samples,
      bitString,
      hexBytes,
      metrics: {
        dutyCyclePct: dominantPct,
        pulseWidthMs: Number((CAN_BIT_PERIOD_SEC * 1000).toFixed(3)),
        periodMs: Number((CAN_BIT_PERIOD_SEC * 2000).toFixed(3)),
        frequencyHz: detectedProtocol === 'CAN_BUS' ? 500000 : 0,
        transitionFreqHz: canTransitionFreqHz,
        edgeCount: bitTransitions,
        highThresholdV: 0.9,
        lowThresholdV: 0.5,
        vMin: Number(vMin.toFixed(3)),
        vMax: Number(vMax.toFixed(3)),
        flybackPeakV: null,
        currentLogicLevel: isoBits[isoBits.length - 1] ?? 1,
        activePolarity: 'DIFFERENTIAL',
      },
      canFrameSummary: {
        health,
        nominalBaudKbps: 500,
        sampleRateLabel: '25 kHz scope-locked (40 µs/bit)',
        vDiffMax: Number(vDiffMax.toFixed(3)),
        vDiffMin: Number(vDiffMin.toFixed(3)),
        dominantPct,
        recessivePct,
        sofDetected,
        sofBitIndex,
        arbitrationIdHex,
        dlc,
        payloadHexBytes,
        bitTransitions,
      },
      anomalies: canAnomalies,
      diagnosticSummary,
    };
  }

  // =========================================================================
  // 2. PWM / LOGIC PULSE / O2 SWITCHING / STATIC DC DECODING
  // =========================================================================
  const defaultWindowMs = isO2Pin ? 1000 : 100;
  const windowMs = params.windowMs ?? defaultWindowMs;
  // High-resolution raw sweep (dt <= 0.105 ms for 100 ms) prevents flyback masking 2.5 ms low dwell
  const rawSampleCount = 960;

  const rawSeries = SignalGenerator.samplePinWaveformSeries({
    pinId,
    pinLabel,
    mnaNodeVoltage,
    faultType,
    isPowerOn,
    hasCanFault,
    hasInjectorFault,
    isInjectorFiring,
    rpm: safeRpm,
    tStartSec,
    windowMs,
    sampleCount: rawSampleCount,
  });

  const rawSamples = rawSeries.samples;
  const nRaw = rawSamples.length;

  let activePolarity: BinaryPolarity = 'ACTIVE_HIGH';
  let highThresholdV = 2.5;
  let lowThresholdV = 2.0;

  if (isInjectorPin) {
    activePolarity = 'ACTIVE_LOW';
    lowThresholdV = 2.5;
    highThresholdV = Math.max(4.5, mnaNodeVoltage * 0.6);
  } else if (isIgnitionPin) {
    activePolarity = 'ACTIVE_HIGH';
    lowThresholdV = 1.5;
    highThresholdV = 2.5;
  } else if (isO2Pin) {
    activePolarity = 'ACTIVE_HIGH';
    lowThresholdV = 0.4;
    highThresholdV = 0.45;
  }

  const rawLogic: Array<0 | 1> = new Array(nRaw);
  let activeCount = 0;
  let flybackPeakV: number | null = null;

  for (let i = 0; i < nRaw; i++) {
    const v = rawSamples[i].voltage;
    let state: 0 | 1;
    if (activePolarity === 'ACTIVE_LOW') {
      // Active-Low MOSFET conduction pulls pin below 2.5V (logic 1 = energized)
      state = v <= lowThresholdV ? 1 : 0;
      if (v > mnaNodeVoltage + 3.0) {
        flybackPeakV = flybackPeakV === null ? v : Math.max(flybackPeakV, v);
      }
    } else {
      state = v >= highThresholdV ? 1 : 0;
    }
    rawLogic[i] = state;
  }

  // Reject transient sub-0.3ms crossings (e.g., decaying inductive flyback tail crossing 2.5V for <0.1ms)
  const dtRawMs = windowMs / Math.max(1, nRaw - 1);
  const minPulseSamples = Math.max(1, Math.round(0.3 / Math.max(0.05, dtRawMs)));
  if (minPulseSamples > 1) {
    let idx = 0;
    while (idx < nRaw) {
      const val = rawLogic[idx];
      let end = idx + 1;
      while (end < nRaw && rawLogic[end] === val) end++;
      const runLen = end - idx;
      if (val === 1 && runLen < minPulseSamples && idx > 0 && end < nRaw) {
        for (let k = idx; k < end; k++) rawLogic[k] = 0;
      }
      idx = end;
    }
  }

  activeCount = 0;
  for (let i = 0; i < nRaw; i++) {
    if (rawLogic[i] === 1) activeCount++;
  }

  const rawEdges = countTransitions(rawLogic);
  const dutyCyclePct = Number(((activeCount / Math.max(1, nRaw)) * 100).toFixed(1));

  // Measure pulse width and period from consecutive active segments in rawSamples
  const pulseWidthsMs: number[] = [];
  const risingTimesMs: number[] = [];
  let inPulse = false;
  let pulseStartMs = 0;

  for (let i = 0; i < nRaw; i++) {
    const tMs = rawSamples[i].timeMs;
    const bit = rawLogic[i];
    if (!inPulse && bit === 1 && i > 0 && rawLogic[i - 1] === 0) {
      inPulse = true;
      pulseStartMs = tMs;
      risingTimesMs.push(tMs);
    } else if (inPulse && bit === 0) {
      inPulse = false;
      pulseWidthsMs.push(Math.max(0, tMs - pulseStartMs));
    }
  }

  // Fallback for pulse starting before window edge
  if (pulseWidthsMs.length === 0 && activeCount > 0 && activeCount < nRaw) {
    let runLen = 0;
    for (let i = 0; i < nRaw; i++) {
      if (rawLogic[i] === 1) runLen++;
      else if (runLen > 0) {
        pulseWidthsMs.push((runLen * windowMs) / nRaw);
        runLen = 0;
      }
    }
    if (runLen > 0) pulseWidthsMs.push((runLen * windowMs) / nRaw);
  }

  const avgPulseWidthMs =
    pulseWidthsMs.length > 0
      ? Number(
          (
            pulseWidthsMs.reduce((acc, val) => acc + val, 0) / pulseWidthsMs.length
          ).toFixed(2)
        )
      : activeCount === nRaw
        ? windowMs
        : 0;

  let measuredPeriodMs = 0;
  if (risingTimesMs.length >= 2) {
    const spans: number[] = [];
    for (let i = 1; i < risingTimesMs.length; i++) {
      spans.push(risingTimesMs[i] - risingTimesMs[i - 1]);
    }
    measuredPeriodMs = Number(
      (spans.reduce((a, b) => a + b, 0) / spans.length).toFixed(2)
    );
  } else if (rawSeries.freqHz > 0) {
    measuredPeriodMs = Number((1000 / rawSeries.freqHz).toFixed(2));
  }

  const measuredFreqHz =
    measuredPeriodMs > 0
      ? Number((1000 / measuredPeriodMs).toFixed(2))
      : rawEdges >= 2
        ? rawSeries.freqHz
        : 0;

  // Downsample 960 -> 48 display slots while preserving narrow pulses (pulse-hold bucket)
  const bucketSize = Math.floor(nRaw / DISPLAY_SLOT_COUNT);
  const displaySamples: BinaryLogicSample[] = [];
  const displayBits: Array<0 | 1> = [];

  for (let slot = 0; slot < DISPLAY_SLOT_COUNT; slot++) {
    const startIdx = slot * bucketSize;
    const endIdx = slot === DISPLAY_SLOT_COUNT - 1 ? nRaw : (slot + 1) * bucketSize;

    let slotLogic: 0 | 1 = 0;
    let extremeV = rawSamples[startIdx]?.voltage ?? mnaNodeVoltage;
    let slotFlyback = false;

    for (let k = startIdx; k < endIdx; k++) {
      const v = rawSamples[k].voltage;
      if (rawLogic[k] === 1) slotLogic = 1;
      if (activePolarity === 'ACTIVE_LOW') {
        if (v > mnaNodeVoltage + 3.0) slotFlyback = true;
        if (slotLogic === 1) {
          extremeV = Math.min(extremeV, v);
        } else if (slotFlyback) {
          extremeV = Math.max(extremeV, v);
        }
      } else {
        if (slotLogic === 1) {
          extremeV = Math.max(extremeV, v);
        } else {
          extremeV = Math.min(extremeV, v);
        }
      }
    }

    displayBits.push(slotLogic);
    displaySamples.push({
      index: slot,
      timeMs: Number((slot * dtRawMs * bucketSize).toFixed(2)),
      voltage: Number(extremeV.toFixed(3)),
      logicState: slotLogic,
      isFlyback: slotFlyback || undefined,
    });
  }

  // Classify detected protocol strictly from MNA + physical waveform behavior
  let detectedProtocol: BinaryDetectedProtocol;
  let protocolBadge = 'STATIC DC LEVEL';
  let diagnosticSummary = '';

  if (!isPowerOn) {
    detectedProtocol = 'FAULT_OR_OFF';
    protocolBadge = 'PSU OUTPUT OFF';
    diagnosticSummary = `Power supply output disabled. Pin #${pinNumber} ${pinLabel} quiescent at ${mnaNodeVoltage.toFixed(2)}V.`;
  } else if (pinHardFault) {
    detectedProtocol = 'FAULT_OR_OFF';
    protocolBadge = `FAULT: ${faultType}`;
    diagnosticSummary = `Hard fault (${faultType}) active on #${pinNumber} ${pinLabel}. Logic switching halted at ${mnaNodeVoltage.toFixed(2)}V.`;
  } else if (isInjectorPin && hasInjectorFault) {
    detectedProtocol = 'FAULT_OR_OFF';
    protocolBadge = 'INJECTOR FAULT';
    diagnosticSummary = `Injector circuit fault prevents low-side MOSFET grounding pulses on #${pinNumber} INJ_1 (MNA ${mnaNodeVoltage.toFixed(2)}V).`;
  } else if (isInjectorPin && !isInjectorFiring) {
    detectedProtocol = 'STATIC_LEVEL';
    protocolBadge = 'DRIVER IDLE';
    diagnosticSummary = `Injector driver firing is paused. #${pinNumber} INJ_1 held steady at ${mnaNodeVoltage.toFixed(2)}V through coil pull-up.`;
  } else if (rawEdges >= 2 && isInjectorPin) {
    detectedProtocol = 'PWM_ACTUATOR';
    protocolBadge = 'PWM ACTIVE-LOW';
    diagnosticSummary = `Low-side injector PWM detected on #${pinNumber} INJ_1: ${dutyCyclePct.toFixed(1)}% duty, ${avgPulseWidthMs.toFixed(2)} ms dwell @ ${measuredFreqHz.toFixed(1)} Hz (${flybackPeakV ? `${flybackPeakV.toFixed(1)}V inductive flyback` : 'no spike captured'}).`;
  } else if (rawEdges >= 2 && isIgnitionPin) {
    detectedProtocol = 'LOGIC_PULSE';
    protocolBadge = '5V IGN TRIGGER';
    diagnosticSummary = `5V coil dwell trigger detected on #${pinNumber} IGN_1: ${dutyCyclePct.toFixed(1)}% duty, ${avgPulseWidthMs.toFixed(2)} ms pulse @ ${measuredFreqHz.toFixed(1)} Hz.`;
  } else if (rawEdges >= 1 && isO2Pin) {
    detectedProtocol = 'ANALOG_SWITCHING';
    protocolBadge = 'O2 NERNST SWITCH';
    diagnosticSummary = `Narrowband Zirconia O2 rich/lean switching across 0.45V threshold (${dutyCyclePct.toFixed(1)}% rich ratio).`;
  } else {
    detectedProtocol = 'STATIC_LEVEL';
    protocolBadge = rawLogic[0] === 1 ? 'STATIC HIGH (1)' : 'STATIC LOW (0)';
    diagnosticSummary = `Steady ${mnaNodeVoltage.toFixed(2)}V DC/analog rail on #${pinNumber} ${pinLabel} (0 logic transitions in ${windowMs} ms). Select INJ_1, IGN_1, CAN_H, CAN_L, or O2_SIG for active PWM/CAN decoding.`;
  }

  const transitionFreqHz = Number(
    (rawEdges / Math.max(1e-4, windowMs / 1000)).toFixed(2)
  );

  const anomalies: SignalAnomalyNotification[] = [];
  if (isPowerOn) {
    if (isInjectorPin || isIgnitionPin) {
      const expectedCycleHz = Math.max(4, safeRpm / 60);
      const expectedCyclePeriodMs = 1000 / expectedCycleHz;
      const expectedTransHz = Number((expectedCycleHz * 2).toFixed(1));
      const isDriverActive = isIgnitionPin || isInjectorFiring;

      if (isDriverActive) {
        const isRailClipped =
          pinHardFault ||
          (isInjectorPin && hasInjectorFault) ||
          dutyCyclePct >= 95 ||
          (dutyCyclePct === 0 && windowMs >= expectedCyclePeriodMs * 1.15) ||
          (isInjectorPin && rawSeries.vMax < 8.5) ||
          (isIgnitionPin && rawSeries.vMax < 3.5);

        if (isRailClipped) {
          const clipReason =
            pinHardFault || (isInjectorPin && hasInjectorFault)
              ? `PWM switching stopped (${transitionFreqHz.toFixed(1)} Hz transitions) due to ${pinHardFault ? faultType : 'injector circuit fault'} — output pinned at ${mnaNodeVoltage.toFixed(2)}V.`
              : dutyCyclePct >= 95
                ? `PWM duty saturated at ${dutyCyclePct.toFixed(1)}% with 0.0 Hz transitions — output clipped ON.`
                : rawEdges === 0
                  ? `Zero binary transitions (${transitionFreqHz.toFixed(1)} Hz) across ${windowMs}ms window (> 1 cycle @ ${expectedCyclePeriodMs.toFixed(1)}ms) — PWM clipped.`
                  : `Peak voltage amplitude (${rawSeries.vMax.toFixed(2)}V) is clipped below normal rail threshold despite active transitions.`;
          anomalies.push({
            id: `${pinId}-PWM_SIGNAL_CLIPPING`,
            code: 'PWM_SIGNAL_CLIPPING',
            title: 'PWM Signal Clipping',
            severity: 'CRITICAL',
            detail: clipReason,
            transitionFreqHz,
            expectedRangeLabel: `~${expectedTransHz.toFixed(1)} Hz transitions (${expectedCycleHz.toFixed(1)} Hz PWM)`,
            observedLabel: `${transitionFreqHz.toFixed(1)} Hz (${rawEdges} edges) · ${rawSeries.vMin.toFixed(2)}–${rawSeries.vMax.toFixed(2)}V`,
            recommendation: isInjectorPin
              ? 'Verify KL30 +12V coil supply, low-side MOSFET sink continuity, and series resistance on #10 INJ_1.'
              : 'Inspect ignition trigger driver output and check #11 IGN_1 for short-to-GND/VBAT or open harness.',
          });
        } else if (rawEdges === 0 && windowMs < expectedCyclePeriodMs * 1.15) {
          anomalies.push({
            id: `${pinId}-CAPTURE_WINDOW_SHORT`,
            code: 'CAPTURE_WINDOW_SHORT',
            title: 'Capture Window < 1 PWM Period',
            severity: 'INFO',
            detail: `Selected ${windowMs}ms window is shorter than 1 cycle (${expectedCyclePeriodMs.toFixed(1)}ms at ${safeRpm} RPM), so edges may fall outside frame.`,
            transitionFreqHz,
            expectedRangeLabel: `Window ≥ ${Math.ceil(expectedCyclePeriodMs * 1.2)}ms`,
            observedLabel: `${windowMs}ms window · ${rawEdges} edges`,
            recommendation: 'Switch Capture window to 100ms or 200ms to measure steady transition frequency.',
          });
        } else if (transitionFreqHz > expectedTransHz * 1.65 + 12) {
          anomalies.push({
            id: `${pinId}-PWM_FREQUENCY_DRIFT`,
            code: 'PWM_FREQUENCY_DRIFT',
            title: 'Excessive Transition Chatter',
            severity: 'WARNING',
            detail: `Measured binary transition rate (${transitionFreqHz.toFixed(1)} Hz) exceeds expected ${expectedTransHz.toFixed(1)} Hz cadence for ${safeRpm} RPM.`,
            transitionFreqHz,
            expectedRangeLabel: `~${expectedTransHz.toFixed(1)} Hz transitions`,
            observedLabel: `${transitionFreqHz.toFixed(1)} Hz (${rawEdges} edges)`,
            recommendation: 'Check for contact bounce, ground offset noise, or inductive ring crossing logic threshold.',
          });
        } else if (
          windowMs >= expectedCyclePeriodMs * 2.1 &&
          transitionFreqHz > 0 &&
          transitionFreqHz < expectedTransHz * 0.55
        ) {
          anomalies.push({
            id: `${pinId}-PWM_MISSING_PULSES`,
            code: 'PWM_MISSING_PULSES',
            title: 'PWM Pulse Dropout',
            severity: 'WARNING',
            detail: `Binary transition rate (${transitionFreqHz.toFixed(1)} Hz) is lower than expected ${expectedTransHz.toFixed(1)} Hz across ${windowMs}ms.`,
            transitionFreqHz,
            expectedRangeLabel: `~${expectedTransHz.toFixed(1)} Hz transitions`,
            observedLabel: `${transitionFreqHz.toFixed(1)} Hz (${rawEdges} edges)`,
            recommendation: 'Inspect CKP/CMP sync and intermittent harness open circuits.',
          });
        }
      }
    } else if (isO2Pin) {
      if (pinHardFault || rawEdges === 0) {
        anomalies.push({
          id: `${pinId}-O2_SIGNAL_FIXED`,
          code: 'O2_SIGNAL_FIXED',
          title: 'O2 Sensor Switching Stalled',
          severity: 'WARNING',
          detail: `No cross-stoichiometric (0.45V) binary transitions detected (${transitionFreqHz.toFixed(1)} Hz) on #15 O2_SIG.`,
          transitionFreqHz,
          expectedRangeLabel: '2.0–3.0 Hz transitions @ 1.25 Hz',
          observedLabel: `${transitionFreqHz.toFixed(1)} Hz (${rawEdges} edges) · ${mnaNodeVoltage.toFixed(2)}V`,
          recommendation: 'Check O2 sensor signal wire for short-to-GND/VBAT, open circuit, or sluggish sensor element.',
        });
      }
    } else {
      if (pinHardFault) {
        anomalies.push({
          id: `${pinId}-PIN_HARD_FAULT`,
          code: 'PIN_HARD_FAULT',
          title: `Pin Fault: ${faultType}`,
          severity: 'CRITICAL',
          detail: `Active fault (${faultType}) holding #${pinNumber} ${pinLabel} at ${mnaNodeVoltage.toFixed(2)}V.`,
          transitionFreqHz,
          expectedRangeLabel: 'Nominal MNA rail (0 Hz DC)',
          observedLabel: `${mnaNodeVoltage.toFixed(2)}V · ${faultType}`,
          recommendation: 'Clear or repair the injected harness/terminal fault to restore nominal ECU rail voltage.',
        });
      } else if (rawEdges >= 2) {
        anomalies.push({
          id: `${pinId}-DC_RAIL_CHATTER`,
          code: 'DC_RAIL_CHATTER',
          title: 'Unexpected DC Rail Transitions',
          severity: 'WARNING',
          detail: `Detected ${rawEdges} unexpected binary logic transitions (${transitionFreqHz.toFixed(1)} Hz) on steady DC pin #${pinNumber} ${pinLabel}.`,
          transitionFreqHz,
          expectedRangeLabel: '0.0 Hz (Steady DC)',
          observedLabel: `${transitionFreqHz.toFixed(1)} Hz (${rawEdges} edges)`,
          recommendation: 'Check power/ground integrity for intermittent contact or excessive voltage ripple.',
        });
      }
    }
  }

  return {
    pinId,
    pinLabel,
    pinNumber,
    detectedProtocol,
    protocolBadge,
    windowMs,
    samples: displaySamples,
    bitString: displayBits.join(''),
    hexBytes: bitsToHexBytes(displayBits),
    metrics: {
      dutyCyclePct,
      pulseWidthMs: avgPulseWidthMs,
      periodMs: measuredPeriodMs,
      frequencyHz: Number(measuredFreqHz.toFixed(2)),
      transitionFreqHz,
      edgeCount: rawEdges,
      highThresholdV: Number(highThresholdV.toFixed(2)),
      lowThresholdV: Number(lowThresholdV.toFixed(2)),
      vMin: Number(rawSeries.vMin.toFixed(3)),
      vMax: Number(rawSeries.vMax.toFixed(3)),
      flybackPeakV: flybackPeakV !== null ? Number(flybackPeakV.toFixed(1)) : null,
      currentLogicLevel: rawLogic[nRaw - 1] ?? 0,
      activePolarity,
    },
    canFrameSummary: null,
    anomalies,
    diagnosticSummary,
  };
}
