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
  public static getCrankshaftVrSignal(t: number, rpm = 1200): number {
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
   * Runs at half crankshaft speed (4-stroke engine cycle).
   */
  public static getCamshaftHallSignal(t: number, rpm = 1200): number {
    const camRevsPerSec = rpm / 120.0;
    const camPhase = (t * camRevsPerSec) % 1.0;
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
        voltage = isInjectorFiring
          ? SignalGenerator.getInjectorWaveform(t, hasInjectorFault, mnaNodeVoltage, safeRpm)
          : mnaNodeVoltage;
      } else if (signalKind === 'IGNITION_TRIGGER') {
        const firingHz = Math.max(4, safeRpm / 60.0);
        const period = 1.0 / firingHz;
        const phase = t % period;
        // 3.0ms 5V logic ignition dwell trigger per firing cycle
        voltage = phase < 0.003 ? 5.0 : Math.max(0, mnaNodeVoltage);
      } else if (signalKind === 'O2_LAMBDA') {
        // Rich/lean zirconia switching around MNA node baseline
        const swing = 0.35 * Math.sin(t * 2 * Math.PI * 1.25);
        voltage = Math.min(1.1, Math.max(0.05, mnaNodeVoltage + swing));
      } else {
        // Steady MNA node voltage (KL30, KL15, VREF_5V, TPS_SIG, MAP_SIG, ECT_SIG, GND, Relays)
        // Add subtle physical ripple proportional to alternator/switching only on active 12V rails when running
        const hasRailRipple = (pinId === 'ecu-pin-3' || pinId === 'ecu-pin-4') && isInjectorFiring;
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
}
