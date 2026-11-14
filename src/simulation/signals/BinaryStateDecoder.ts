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

export interface BinaryPinMetrics {
  dutyCyclePct: number;
  pulseWidthMs: number;
  periodMs: number;
  frequencyHz: number;
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

    let diagnosticSummary = '';
    if (!isPowerOn) {
      diagnosticSummary =
        'Bench PSU output is OFF. CAN transceiver unpowered — bus differential quiescent at 0.00V.';
    } else if (health === 'BUS_FAULT_COLLAPSED') {
      diagnosticSummary = `CAN frame traffic interrupted (${pinLabel} / companion fault). V_diff collapsed to ${vDiffMax.toFixed(2)}V (ISO 11898 requires ≥0.9V for Dominant 0).`;
    } else {
      diagnosticSummary = `ISO 11898 High-Speed CAN active: ${dominantPct.toFixed(1)}% Dominant (0) / ${recessivePct.toFixed(1)}% Recessive (1), V_diff peak ${vDiffMax.toFixed(2)}V, ${bitTransitions} bit edges.`;
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
        sofDetected: !busFaulted && sofBitIndex !== null,
        sofBitIndex,
        arbitrationIdHex,
        dlc,
        payloadHexBytes,
        bitTransitions,
      },
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
    diagnosticSummary,
  };
}
