/**
 * SignalGenerator: Generates time-domain automotive waveforms driven by simulation parameters.
 * Eliminates artificial Math.random noise with reproducible physical signal synthesis.
 */

export class SignalGenerator {
  /**
   * Generates Crankshaft 60-2 VR (Variable Reluctance) sensor waveform.
   * @param t Time in seconds
   * @param rpm Engine rotational speed in RPM
   * @returns Instantaneous voltage in Volts
   */
  public static getCrankshaftVrSignal(t: number, rpm = 1200, isLost = false): number {
    if (isLost) return 0.0;
    const revsPerSec = rpm / 60.0;
    // 60 teeth per revolution (each tooth is 1/60th of a revolution)
    const teethPerSec = revsPerSec * 60.0;
    const currentToothCycle = (t * teethPerSec) % 60;

    // Missing 2 teeth (teeth 58 and 59 are absent for Top-Dead-Center cylinder 1 sync)
    if (currentToothCycle >= 58) {
      return 0.0;
    }

    // Peak VR amplitude scales with engine speed: e.g. 2.5V at 800 RPM, 6V at 2500 RPM
    const peakAmplitude = Math.min(18.0, 1.2 + (rpm / 1000.0) * 1.8);
    const toothPhase = (currentToothCycle % 1) * 2 * Math.PI;
    return peakAmplitude * Math.sin(toothPhase);
  }

  /**
   * Generates Camshaft Hall Effect sensor square sync pulse.
   * Runs at half crankshaft speed (4-stroke engine cycle), with configurable phase offset in degrees.
   */
  public static getCamshaftHallSignal(t: number, rpm = 1200, phaseOffsetDeg = 0): number {
    const camRevsPerSec = rpm / 120.0;
    // Shift in cam cycle (720° crank = 360° cam): normalized offset = phaseOffsetDeg / 360
    const normalizedShift = phaseOffsetDeg / 360.0;
    const rawPhase = (t * camRevsPerSec - normalizedShift) % 1.0;
    const camPhase = rawPhase < 0 ? rawPhase + 1.0 : rawPhase;
    // Single 5V pulse over 180° of camshaft rotation (0.5 duty cycle)
    return camPhase < 0.5 ? 5.0 : 0.0;
  }

  /**
   * Generates Fuel Injector low-side control voltage waveform with inductive flyback kick.
   * @param t Time in seconds
   * @param isFaulted If circuit has open/short fault
   * @param vBat Battery supply voltage (nominally 12.6V)
   * @param rpm Engine speed in RPM (scales 4-stroke firing cadence physically)
   */
  public static getInjectorWaveform(t: number, isFaulted = false, vBat = 12.6, rpm = 1200): number {
    if (isFaulted) return 0.0;

    // Firing interval: 1 cycle per 2 crank revolutions per cylinder scaled cleanly (20Hz at 1200 RPM)
    const firingHz = Math.max(4, rpm / 60.0);
    const cyclePeriod = 1.0 / firingHz;
    const tCycle = t % cyclePeriod;
    const pulseWidth = 0.0025; // 2.5ms injection dwell time

    if (tCycle < pulseWidth) {
      // MOSFET turns ON and grounds the injector: voltage drops to ~0.2V (Vce sat)
      return 0.2;
    } else if (tCycle < pulseWidth + 0.0004) {
      // MOSFET turns OFF: Inductor collapses, producing high-voltage flyback spike clamped at 65V
      const spikePhase = (tCycle - pulseWidth) / 0.0004;
      return 65.0 * Math.exp(-spikePhase * 3.5);
    } else {
      // Quiescent state: injector is held high at battery voltage through coil
      return vBat;
    }
  }

  /**
   * Generates High-Speed CAN Bus Differential Signals (ISO 11898 at 500 kbps).
   */
  public static getCanBusSignals(t: number, hasFault = false) {
    if (hasFault) {
      return { canHigh: 0.0, canLow: 0.0, differential: 0.0 };
    }

    // Packet burst generation: pseudo-random but deterministic based on time
    const bitPeriod = 1.0 / 25000.0; // Scaled for visible oscilloscope screen inspection
    const bitIndex = Math.floor(t / bitPeriod);
    const isDominant = ((bitIndex * 2654435761) & 0x7) < 3; // Deterministic pseudo-random bits

    if (isDominant) {
      return {
        canHigh: 3.5,
        canLow: 1.5,
        differential: 2.0,
      };
    } else {
      return {
        canHigh: 2.5,
        canLow: 2.5,
        differential: 0.0,
      };
    }
  }

  /**
   * Generates deterministic time-domain voltage samples for any of the 16 ECU connector pins,
   * strictly anchored to the live MNA-solved node voltage, active fault topology, PSU state,
   * and SignalGenerator physical waveforms.
   */
  public static samplePinWaveformSeries(params: {
    pinId: string;
    pinLabel: string;
    mnaNodeVoltage: number;
    faultType?: string;
    isPowerOn: boolean;
    hasCanFault: boolean;
    hasInjectorFault: boolean;
    isInjectorFiring: boolean;
    rpm: number;
    tStartSec: number;
    windowMs?: number;
    sampleCount?: number;
  }): {
    samples: Array<{ timeMs: number; voltage: number; secondaryVoltage?: number }>;
    signalKind: string;
    primaryLabel: string;
    secondaryLabel?: string;
    vMin: number;
    vMax: number;
    vAvg: number;
    vpp: number;
    freqHz: number;
  } {
    const {
      pinId,
      pinLabel,
      mnaNodeVoltage,
      faultType = 'NONE',
      isPowerOn,
      hasCanFault,
      hasInjectorFault,
      isInjectorFiring,
      rpm,
      tStartSec,
      windowMs = 40,
      sampleCount = 64,
    } = params;

    const safeRpm = Math.max(300, rpm);
    const windowSec = Math.max(0.002, windowMs / 1000);
    const dt = windowSec / Math.max(1, sampleCount - 1);
    const isHardPinFault =
      faultType === 'SHORT_TO_GND' || faultType === 'SHORT_TO_VBAT' || faultType === 'OPEN_CIRCUIT';

    let signalKind = 'DC_ANALOG';
    let primaryLabel = `${pinLabel} (V)`;
    let secondaryLabel: string | undefined;
    let freqHz = 0;

    if (pinId === 'ecu-pin-13' || pinId === 'ecu-pin-14') {
      signalKind = 'CAN_DIFF';
      primaryLabel = pinId === 'ecu-pin-13' ? 'CAN_H (V)' : 'CAN_L (V)';
      secondaryLabel = pinId === 'ecu-pin-13' ? 'CAN_L (V)' : 'CAN_H (V)';
      freqHz = isPowerOn && !hasCanFault && !isHardPinFault ? 500000 : 0;
    } else if (pinId === 'ecu-pin-10') {
      signalKind = 'INJECTOR_PWM';
      primaryLabel = 'INJ_1 Flyback / Sink (V)';
      freqHz = isPowerOn && isInjectorFiring && !hasInjectorFault && !isHardPinFault ? Math.max(4, safeRpm / 60) : 0;
    } else if (pinId === 'ecu-pin-11') {
      signalKind = 'IGNITION_TRIGGER';
      primaryLabel = 'IGN_1 Coil Trigger (V)';
      freqHz = isPowerOn && !isHardPinFault ? Math.max(4, safeRpm / 60) : 0;
    } else if (pinId === 'ecu-pin-15') {
      signalKind = 'O2_LAMBDA';
      primaryLabel = 'O2 Nernst Cell (V)';
      freqHz = isPowerOn && !isHardPinFault ? 1.25 : 0;
    }

    const samples: Array<{ timeMs: number; voltage: number; secondaryVoltage?: number }> = [];
    let vMin = Infinity;
    let vMax = -Infinity;
    let sum = 0;

    for (let i = 0; i < sampleCount; i++) {
      const t = tStartSec + i * dt;
      const timeMs = Number((i * dt * 1000).toFixed(2));
      let voltage = mnaNodeVoltage;
      let secondaryVoltage: number | undefined;

      if (!isPowerOn || isHardPinFault) {
        voltage = mnaNodeVoltage;
      } else if (signalKind === 'CAN_DIFF') {
        const canSig = SignalGenerator.getCanBusSignals(t, hasCanFault);
        // Anchor bus idle level around live MNA node voltage so corrosion/voltage shifts remain visible
        const mnaOffset = mnaNodeVoltage - 2.5;
        if (pinId === 'ecu-pin-13') {
          voltage = Math.max(0, canSig.canHigh + mnaOffset);
          secondaryVoltage = Math.max(0, canSig.canLow + mnaOffset);
        } else {
          voltage = Math.max(0, canSig.canLow + mnaOffset);
          secondaryVoltage = Math.max(0, canSig.canHigh + mnaOffset);
        }
      } else if (signalKind === 'INJECTOR_PWM') {
        if (!isInjectorFiring) {
          voltage = mnaNodeVoltage;
        } else if (dt > 0.00012) {
          // DSO Peak-Detect acquisition so narrow 0.4ms inductive flyback spikes are preserved across wide timebases
          const subSteps = 12;
          let peakSample = SignalGenerator.getInjectorWaveform(t, hasInjectorFault, mnaNodeVoltage, safeRpm);
          let bestDistFromBaseline = Math.abs(peakSample - mnaNodeVoltage);
          for (let s = 1; s < subSteps; s++) {
            const subT = t + (s / subSteps) * dt;
            const subV = SignalGenerator.getInjectorWaveform(subT, hasInjectorFault, mnaNodeVoltage, safeRpm);
            const dist = Math.abs(subV - mnaNodeVoltage);
            if (dist > bestDistFromBaseline) {
              bestDistFromBaseline = dist;
              peakSample = subV;
            }
          }
          voltage = peakSample;
        } else {
          voltage = SignalGenerator.getInjectorWaveform(t, hasInjectorFault, mnaNodeVoltage, safeRpm);
        }
      } else if (signalKind === 'IGNITION_TRIGGER') {
        const firingHz = Math.max(4, safeRpm / 60.0);
        const period = 1.0 / firingHz;
        // Compression-TDC ignition dwell occurs ~135° (0.375 cycle) after intake injection pulse
        const phase = (t + period * 0.625) % period;
        // 3.0ms 5V logic ignition dwell trigger per firing cycle
        voltage = phase < 0.003 ? 5.0 : Math.max(0, mnaNodeVoltage);
      } else if (signalKind === 'O2_LAMBDA') {
        // Rich/lean zirconia switching around MNA node baseline
        const swing = 0.35 * Math.sin(t * 2 * Math.PI * 1.25);
        voltage = Math.min(1.1, Math.max(0.05, mnaNodeVoltage + swing));
      } else {
        // Steady MNA node voltage (KL30, KL15, VREF_5V, TPS_SIG, MAP_SIG, ECT_SIG, GND, Relays)
        // Add subtle physical ripple proportional to alternator/switching only on active 12V rails when running
        const hasRailRipple =
          (pinId === 'ecu-pin-3' ||
            pinId === 'ecu-pin-4' ||
            pinId === 'ecu-pin-12' ||
            pinId === 'ecu-pin-16') &&
          isInjectorFiring;
        const ripple = hasRailRipple ? 0.03 * Math.sin(t * 2 * Math.PI * Math.max(20, (safeRpm / 60) * 3)) : 0;
        voltage = mnaNodeVoltage + ripple;
      }

      const roundedV = Number(voltage.toFixed(3));
      const roundedSec = secondaryVoltage !== undefined ? Number(secondaryVoltage.toFixed(3)) : undefined;

      vMin = Math.min(vMin, roundedV);
      vMax = Math.max(vMax, roundedV);
      sum += roundedV;

      samples.push(
        roundedSec !== undefined
          ? { timeMs, voltage: roundedV, secondaryVoltage: roundedSec }
          : { timeMs, voltage: roundedV }
      );
    }

    if (!Number.isFinite(vMin)) vMin = 0;
    if (!Number.isFinite(vMax)) vMax = 0;

    return {
      samples,
      signalKind,
      primaryLabel,
      secondaryLabel,
      vMin,
      vMax,
      vAvg: sum / Math.max(1, samples.length),
      vpp: Math.max(0, vMax - vMin),
      freqHz,
    };
  }

  /**
   * Samples two ECU connector pins simultaneously on a synchronized timebase, computing
   * instantaneous differential voltage (`ch1 - ch2`), Pearson correlation (`r`), cross-correlation
   * time lag (`Δt` ms), and phase difference (`Δφ` deg) for dual-trace analysis.
   */
  public static sampleDualPinWaveformSeries(params: {
    ch1PinId: string;
    ch1PinLabel: string;
    ch1MnaVoltage: number;
    ch1FaultType?: string;
    ch2PinId: string;
    ch2PinLabel: string;
    ch2MnaVoltage: number;
    ch2FaultType?: string;
    isPowerOn: boolean;
    hasCanFault: boolean;
    hasInjectorFault: boolean;
    isInjectorFiring: boolean;
    rpm: number;
    tStartSec: number;
    windowMs?: number;
    sampleCount?: number;
    skipCorrelation?: boolean;
  }): {
    samples: Array<{
      timeMs: number;
      ch1: number;
      ch2: number;
      diff: number;
      ch1Norm: number;
      ch2Norm: number;
      diffNorm: number;
    }>;
    ch1Label: string;
    ch2Label: string;
    ch1Stats: {
      vMin: number;
      vMax: number;
      vAvg: number;
      vpp: number;
      freqHz: number;
      signalKind: string;
    };
    ch2Stats: {
      vMin: number;
      vMax: number;
      vAvg: number;
      vpp: number;
      freqHz: number;
      signalKind: string;
    };
    autoScale: {
      ch1MinV: number;
      ch1MaxV: number;
      ch1SpanV: number;
      ch2MinV: number;
      ch2MaxV: number;
      ch2SpanV: number;
      ch1IsFlat: boolean;
      ch2IsFlat: boolean;
      ch1MnaNorm: number;
      amplitudeRatio: number | null;
    };
    correlationR: number | null;
    phaseDiffDeg: number | null;
    timeLagMs: number | null;
    avgDiffV: number;
    correlationMode: 'ANTI_PHASE' | 'IN_PHASE' | 'PHASE_SHIFTED' | 'UNCORRELATED' | 'DC_STATIC';
  } {
    const windowMs = params.windowMs ?? 40;
    const sampleCount = params.sampleCount ?? 96;

    const s1 = SignalGenerator.samplePinWaveformSeries({
      pinId: params.ch1PinId,
      pinLabel: params.ch1PinLabel,
      mnaNodeVoltage: params.ch1MnaVoltage,
      faultType: params.ch1FaultType ?? 'NONE',
      isPowerOn: params.isPowerOn,
      hasCanFault: params.hasCanFault,
      hasInjectorFault: params.hasInjectorFault,
      isInjectorFiring: params.isInjectorFiring,
      rpm: params.rpm,
      tStartSec: params.tStartSec,
      windowMs,
      sampleCount,
    });

    const s2 = SignalGenerator.samplePinWaveformSeries({
      pinId: params.ch2PinId,
      pinLabel: params.ch2PinLabel,
      mnaNodeVoltage: params.ch2MnaVoltage,
      faultType: params.ch2FaultType ?? 'NONE',
      isPowerOn: params.isPowerOn,
      hasCanFault: params.hasCanFault,
      hasInjectorFault: params.hasInjectorFault,
      isInjectorFiring: params.isInjectorFiring,
      rpm: params.rpm,
      tStartSec: params.tStartSec,
      windowMs,
      sampleCount,
    });

    const FLAT_EPS = 1e-3; // 1 mV threshold to distinguish flat DC from active AC/PWM waveforms
    const clampPct = (pct: number): number => {
      if (!Number.isFinite(pct)) return 50.0;
      return Number(Math.max(0, Math.min(100, pct)).toFixed(2));
    };

    const ch1IsFlat = s1.vpp <= FLAT_EPS;
    const ch2IsFlat = s2.vpp <= FLAT_EPS;

    const n = Math.min(s1.samples.length, s2.samples.length);
    const rawSamples: Array<{ timeMs: number; ch1: number; ch2: number; diff: number }> = [];
    const a: number[] = new Array(n);
    const b: number[] = new Array(n);

    let sumA2 = 0;
    let sumB2 = 0;
    let sumAB = 0;
    let diffMin = Infinity;
    let diffMax = -Infinity;

    for (let i = 0; i < n; i++) {
      const v1 = s1.samples[i].voltage;
      const v2 = s2.samples[i].voltage;
      const diff = Number((v1 - v2).toFixed(3));
      if (diff < diffMin) diffMin = diff;
      if (diff > diffMax) diffMax = diff;

      rawSamples.push({
        timeMs: s1.samples[i].timeMs,
        ch1: v1,
        ch2: v2,
        diff,
      });
      const da = v1 - s1.vAvg;
      const db = v2 - s2.vAvg;
      a[i] = da;
      b[i] = db;
      sumA2 += da * da;
      sumB2 += db * db;
      sumAB += da * db;
    }

    if (!Number.isFinite(diffMin)) diffMin = 0;
    if (!Number.isFinite(diffMax)) diffMax = 0;
    const diffSpan = Math.max(0, diffMax - diffMin);
    const diffIsFlat = diffSpan <= FLAT_EPS;

    const samples = rawSamples.map((pt) => ({
      ...pt,
      ch1Norm: ch1IsFlat ? 50.0 : clampPct(((pt.ch1 - s1.vMin) / s1.vpp) * 100),
      ch2Norm: ch2IsFlat ? 50.0 : clampPct(((pt.ch2 - s2.vMin) / s2.vpp) * 100),
      diffNorm: diffIsFlat ? 50.0 : clampPct(((pt.diff - diffMin) / diffSpan) * 100),
    }));

    const ch1MnaNorm = ch1IsFlat
      ? 50.0
      : clampPct(((params.ch1MnaVoltage - s1.vMin) / s1.vpp) * 100);

    const amplitudeRatio =
      !ch1IsFlat && !ch2IsFlat
        ? Number((Math.max(s1.vpp, s2.vpp) / Math.min(s1.vpp, s2.vpp)).toFixed(2))
        : null;

    const avgDiffV = Number((s1.vAvg - s2.vAvg).toFixed(3));
    const denom = Math.sqrt(sumA2 * sumB2);

    let correlationR: number | null = null;
    let phaseDiffDeg: number | null = null;
    let timeLagMs: number | null = null;
    let correlationMode: 'ANTI_PHASE' | 'IN_PHASE' | 'PHASE_SHIFTED' | 'UNCORRELATED' | 'DC_STATIC' =
      'DC_STATIC';

    if (!params.skipCorrelation && denom > 1e-4 && n >= 8) {
      const rawR = Math.max(-1, Math.min(1, sumAB / denom));
      correlationR = Number(rawR.toFixed(3));

      if (rawR <= -0.85) {
        phaseDiffDeg = 180.0;
        timeLagMs = 0.0;
        correlationMode = 'ANTI_PHASE';
      } else {
        const dtMs = windowMs / Math.max(1, n - 1);
        const maxLag = Math.floor(n / 2);
        let bestLag = 0;
        let bestCorr = rawR;
        let bestAbsLag = 0;
        let bestAbsCorr = Math.abs(rawR);

        for (let lag = -maxLag; lag <= maxLag; lag++) {
          const iStart = Math.max(0, -lag);
          const iEnd = Math.min(n, n - lag);
          if (iEnd - iStart < Math.max(6, Math.floor(n / 3))) continue;

          let lAB = 0;
          let lA2 = 0;
          let lB2 = 0;
          for (let i = iStart; i < iEnd; i++) {
            const va = a[i];
            const vb = b[i + lag];
            lAB += va * vb;
            lA2 += va * va;
            lB2 += vb * vb;
          }
          const lDen = Math.sqrt(lA2 * lB2);
          if (lDen > 1e-5) {
            const c = lAB / lDen;
            if (c > bestCorr + 1e-4 || (Math.abs(c - bestCorr) <= 1e-4 && Math.abs(lag) < Math.abs(bestLag))) {
              bestCorr = c;
              bestLag = lag;
            }
            const absC = Math.abs(c);
            if (absC > bestAbsCorr + 1e-4 || (Math.abs(absC - bestAbsCorr) <= 1e-4 && Math.abs(lag) < Math.abs(bestAbsLag))) {
              bestAbsCorr = absC;
              bestAbsLag = lag;
            }
          }
        }

        const refFreqHz =
          s1.freqHz > 0 && s2.freqHz > 0
            ? Math.min(s1.freqHz, s2.freqHz)
            : s1.freqHz || s2.freqHz;

        const chosenCorr = bestCorr >= 0.45 ? bestCorr : bestAbsCorr;
        const chosenLag = bestCorr >= 0.45 ? bestLag : bestAbsLag;

        if (rawR >= 0.88 && Math.abs(bestLag) <= 1) {
          phaseDiffDeg = 0.0;
          timeLagMs = 0.0;
          correlationMode = 'IN_PHASE';
        } else if (chosenCorr >= 0.45) {
          timeLagMs = Number((chosenLag * dtMs).toFixed(2));
          if (refFreqHz > 0 && refFreqHz < 10000) {
            const periodMs = 1000 / refFreqHz;
            const rawDeg = ((chosenLag * dtMs) / periodMs) * 360;
            const wrapped = (((rawDeg % 360) + 540) % 360) - 180;
            phaseDiffDeg = Number(wrapped.toFixed(1));
          } else if (chosenLag === 0) {
            phaseDiffDeg = 0.0;
          }
          correlationMode =
            phaseDiffDeg !== null && Math.abs(phaseDiffDeg) < 10 ? 'IN_PHASE' : 'PHASE_SHIFTED';
        } else {
          correlationMode = 'UNCORRELATED';
        }
      }
    }

    return {
      samples,
      ch1Label: s1.primaryLabel,
      ch2Label: s2.primaryLabel,
      ch1Stats: {
        vMin: s1.vMin,
        vMax: s1.vMax,
        vAvg: s1.vAvg,
        vpp: s1.vpp,
        freqHz: s1.freqHz,
        signalKind: s1.signalKind,
      },
      ch2Stats: {
        vMin: s2.vMin,
        vMax: s2.vMax,
        vAvg: s2.vAvg,
        vpp: s2.vpp,
        freqHz: s2.freqHz,
        signalKind: s2.signalKind,
      },
      autoScale: {
        ch1MinV: Number(s1.vMin.toFixed(3)),
        ch1MaxV: Number(s1.vMax.toFixed(3)),
        ch1SpanV: Number(s1.vpp.toFixed(3)),
        ch2MinV: Number(s2.vMin.toFixed(3)),
        ch2MaxV: Number(s2.vMax.toFixed(3)),
        ch2SpanV: Number(s2.vpp.toFixed(3)),
        ch1IsFlat,
        ch2IsFlat,
        ch1MnaNorm,
        amplitudeRatio,
      },
      correlationR,
      phaseDiffDeg,
      timeLagMs,
      avgDiffV,
      correlationMode,
    };
  }
}
