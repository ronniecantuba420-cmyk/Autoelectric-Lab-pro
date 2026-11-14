let audioCtx: AudioContext | null = null;
let beepOscillator: OscillatorNode | null = null;
let gainNode: GainNode | null = null;

function getOrCreateAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const AudioContextClass =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  if (!AudioContextClass) return null;
  if (!audioCtx) {
    audioCtx = new AudioContextClass();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {
      // Autoplay guard: safely ignore until user gesture
    });
  }
  return audioCtx;
}

export function playContinuityBeep(shouldBeep: boolean) {
  if (typeof window === 'undefined') return;

  if (shouldBeep) {
    const ctx = getOrCreateAudioContext();
    if (ctx && !beepOscillator) {
      try {
        beepOscillator = ctx.createOscillator();
        gainNode = ctx.createGain();

        beepOscillator.type = 'sine';
        beepOscillator.frequency.setValueAtTime(2400, ctx.currentTime); // Standard 2.4 kHz multimeter piezo pitch
        gainNode.gain.setValueAtTime(0.08, ctx.currentTime); // Gentle volume

        beepOscillator.connect(gainNode);
        gainNode.connect(ctx.destination);
        beepOscillator.start();
      } catch {
        // Audio policy ignore
      }
    }
  } else {
    if (beepOscillator) {
      try {
        beepOscillator.stop();
        beepOscillator.disconnect();
      } catch {
        // Ignore
      }
      beepOscillator = null;
      gainNode = null;
    }
  }
}

export function playProbeTapSound() {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Subtle acoustic metallic contact chirp: 1600Hz decaying rapidly to 320Hz over 35ms
    osc.frequency.setValueAtTime(1600, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(320, ctx.currentTime + 0.035);
    gain.gain.setValueAtTime(0.05, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.035);

    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.035);
  } catch {
    // Audio policy ignore
  }
}

export function playHoldBeep(isEngaged: boolean) {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';

    if (isEngaged) {
      // Classic 2.4 kHz DMM piezo confirmation chirp when locking HOLD
      osc.frequency.setValueAtTime(2400, now);
      gain.gain.setValueAtTime(0.075, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.065);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.065);
    } else {
      // Lower 1.75 kHz brief chirp when releasing HOLD back to live tracking
      osc.frequency.setValueAtTime(1750, now);
      gain.gain.setValueAtTime(0.055, now);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.045);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now);
      osc.stop(now + 0.045);
    }
  } catch {
    // Audio policy ignore
  }
}

export type EmulatorModuleKind = 'rpm' | 'injector' | 'relay' | 'sensor';

/**
 * Plays a minimal, clean tactile confirmation sound when an emulator module turns ON or OFF.
 */
export function playModuleActivationSound(
  isActivating: boolean,
  moduleKind: EmulatorModuleKind = 'rpm'
) {
  if (typeof window === 'undefined') return;
  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    // 1. Micro switch/relay contact transient
    const clickOsc = ctx.createOscillator();
    const clickGain = ctx.createGain();
    clickOsc.type = 'triangle';
    clickOsc.frequency.setValueAtTime(isActivating ? 920 : 540, now);
    clickOsc.frequency.exponentialRampToValueAtTime(220, now + 0.018);
    clickGain.gain.setValueAtTime(0.028, now);
    clickGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.02);
    clickOsc.connect(clickGain);
    clickGain.connect(ctx.destination);
    clickOsc.start(now);
    clickOsc.stop(now + 0.022);

    // 2. Minimal module wake/sleep harmonic tone
    const baseHzMap: Record<EmulatorModuleKind, [number, number]> = {
      rpm: [520, 780],
      injector: [660, 990],
      relay: [440, 620],
      sensor: [580, 840],
    };
    const [lowHz, highHz] = baseHzMap[moduleKind];

    const toneOsc = ctx.createOscillator();
    const toneGain = ctx.createGain();
    toneOsc.type = 'sine';
    const startTime = now + 0.016;
    if (isActivating) {
      toneOsc.frequency.setValueAtTime(lowHz, startTime);
      toneOsc.frequency.exponentialRampToValueAtTime(highHz, startTime + 0.07);
      toneGain.gain.setValueAtTime(0.001, startTime);
      toneGain.gain.linearRampToValueAtTime(0.036, startTime + 0.014);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.095);
    } else {
      toneOsc.frequency.setValueAtTime(highHz * 0.8, startTime);
      toneOsc.frequency.exponentialRampToValueAtTime(lowHz * 0.72, startTime + 0.06);
      toneGain.gain.setValueAtTime(0.025, startTime);
      toneGain.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.075);
    }
    toneOsc.connect(toneGain);
    toneGain.connect(ctx.destination);
    toneOsc.start(startTime);
    toneOsc.stop(startTime + 0.1);
  } catch {
    // Audio policy ignore
  }
}

export interface RpmAudioProfile {
  clampedRpm: number;
  normalizedRpm: number;
  carrierHz: number;
  harmonicHz: number;
  harmonicMix: number;
  firingRateHz: number;
  fmModHz: number;
  fmDeviationHz: number;
  harmonicFmDeviationHz: number;
  amRateHz: number;
  amDepth: number;
  filterCutoffHz: number;
  masterGain: number;
}

/**
 * Computes deterministic Web Audio FM synthesis parameters for a 4-stroke engine RPM state.
 * Pure math helper — safe in SSR/unit-test environments without requiring AudioContext.
 */
export function computeRpmAudioProfile(rpm: number): RpmAudioProfile {
  const safeRpm = Number.isFinite(rpm) ? rpm : 600;
  const clampedRpm = Math.min(7500, Math.max(400, safeRpm));
  const norm = Math.min(1, Math.max(0, (clampedRpm - 600) / (7000 - 600)));

  // 4-stroke, 4-cylinder firing cadence (2 combustion events per crankshaft revolution)
  const firingRateHz = (clampedRpm / 60) * 2;

  // Fundamental carrier & octave harmonic track RPM linearly for immediate pitch feedback
  const carrierHz = 44 + norm * 186; // 44 Hz idle -> 230 Hz at 7000 RPM
  const harmonicHz = carrierHz * 2; // 88 Hz idle -> 460 Hz at 7000 RPM
  const harmonicMix = 0.18 + norm * 0.18; // 0.18 -> 0.36

  // Dynamic Frequency Modulation (FM): sub-firing crank modulation creates engine-run texture
  const fmModHz = Math.max(9, firingRateHz * 0.5); // 10 Hz flutter at idle -> 116.7 Hz growl at redline
  const fmDeviationHz = 3.2 + Math.pow(norm, 1.05) * 18.8; // +/-3.2 Hz idle -> +/-22 Hz high RPM
  const harmonicFmDeviationHz = fmDeviationHz * 1.5;

  // Gentle synchronized amplitude cadence & brightness scaling (minimal, non-fatiguing bench volume)
  const amRateHz = Math.max(8, firingRateHz * 0.45);
  const amDepth = 0.18 + norm * 0.14; // 0.18 -> 0.32
  const filterCutoffHz = 190 + Math.pow(norm, 1.15) * 1310; // 190 Hz warm idle -> 1500 Hz upper RPM
  const masterGain = 0.008 + Math.pow(norm, 1.35) * 0.044; // 0.008 subtle idle -> 0.052 max

  return {
    clampedRpm,
    normalizedRpm: norm,
    carrierHz,
    harmonicHz,
    harmonicMix,
    firingRateHz,
    fmModHz,
    fmDeviationHz,
    harmonicFmDeviationHz,
    amRateHz,
    amDepth,
    filterCutoffHz,
    masterGain,
  };
}

interface RpmSynthNodes {
  carrierOsc: OscillatorNode;
  harmonicOsc: OscillatorNode;
  harmonicGain: GainNode;
  fmModOsc: OscillatorNode;
  fmDepthGain: GainNode;
  fmHarmonicDepthGain: GainNode;
  lfoOsc: OscillatorNode;
  lfoDepthGain: GainNode;
  pulseGain: GainNode;
  filter: BiquadFilterNode;
  masterGain: GainNode;
}

let rpmSynth: RpmSynthNodes | null = null;
let rpmStopTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Stops and releases all active RPM emulator Web Audio oscillators and modulation nodes.
 */
export function stopRpmEmulatorAudio() {
  if (rpmStopTimer) {
    clearTimeout(rpmStopTimer);
    rpmStopTimer = null;
  }
  if (!rpmSynth) return;
  const nodes = rpmSynth;
  rpmSynth = null;
  const oscs = [nodes.carrierOsc, nodes.harmonicOsc, nodes.fmModOsc, nodes.lfoOsc];
  for (const osc of oscs) {
    try {
      osc.stop();
    } catch {
      // Already stopped
    }
  }
  const allNodes: AudioNode[] = [
    nodes.carrierOsc,
    nodes.harmonicOsc,
    nodes.harmonicGain,
    nodes.fmModOsc,
    nodes.fmDepthGain,
    nodes.fmHarmonicDepthGain,
    nodes.lfoOsc,
    nodes.lfoDepthGain,
    nodes.pulseGain,
    nodes.filter,
    nodes.masterGain,
  ];
  for (const node of allNodes) {
    try {
      node.disconnect();
    } catch {
      // Already disconnected
    }
  }
}

/**
 * Updates the minimal Web Audio RPM emulator synth using dynamic Frequency Modulation (FM),
 * engine firing-order AM cadence, lowpass brightness, and smooth AudioParam scheduling.
 */
export function updateRpmEmulatorAudio(
  isActive: boolean,
  rpm: number,
  isSoundEnabled = true
) {
  if (typeof window === 'undefined') return;

  if (!isActive || !isSoundEnabled || !Number.isFinite(rpm) || rpm <= 0) {
    if (rpmSynth && audioCtx) {
      try {
        const now = audioCtx.currentTime;
        rpmSynth.masterGain.gain.cancelScheduledValues(now);
        rpmSynth.masterGain.gain.setTargetAtTime(0.0001, now, 0.03);
        if (rpmStopTimer) clearTimeout(rpmStopTimer);
        rpmStopTimer = setTimeout(() => {
          stopRpmEmulatorAudio();
        }, 120);
      } catch {
        stopRpmEmulatorAudio();
      }
    } else {
      stopRpmEmulatorAudio();
    }
    return;
  }

  try {
    const ctx = getOrCreateAudioContext();
    if (!ctx) return;

    if (rpmStopTimer) {
      clearTimeout(rpmStopTimer);
      rpmStopTimer = null;
    }

    const profile = computeRpmAudioProfile(rpm);
    const pulseBaseGain = 1 - profile.amDepth;
    const now = ctx.currentTime;

    if (!rpmSynth) {
      const carrierOsc = ctx.createOscillator();
      const harmonicOsc = ctx.createOscillator();
      const harmonicGain = ctx.createGain();
      const fmModOsc = ctx.createOscillator();
      const fmDepthGain = ctx.createGain();
      const fmHarmonicDepthGain = ctx.createGain();
      const lfoOsc = ctx.createOscillator();
      const lfoDepthGain = ctx.createGain();
      const pulseGain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      const masterGain = ctx.createGain();

      carrierOsc.type = 'triangle';
      carrierOsc.frequency.setValueAtTime(profile.carrierHz, now);

      harmonicOsc.type = 'sine';
      harmonicOsc.frequency.setValueAtTime(profile.harmonicHz, now);
      harmonicGain.gain.setValueAtTime(profile.harmonicMix, now);

      // True dynamic Frequency Modulation routed into both carrier & harmonic frequency params
      fmModOsc.type = 'sine';
      fmModOsc.frequency.setValueAtTime(profile.fmModHz, now);
      fmDepthGain.gain.setValueAtTime(profile.fmDeviationHz, now);
      fmHarmonicDepthGain.gain.setValueAtTime(profile.harmonicFmDeviationHz, now);

      fmModOsc.connect(fmDepthGain);
      fmDepthGain.connect(carrierOsc.frequency);
      fmModOsc.connect(fmHarmonicDepthGain);
      fmHarmonicDepthGain.connect(harmonicOsc.frequency);

      // Subtle firing-pulse AM envelope
      lfoOsc.type = 'sine';
      lfoOsc.frequency.setValueAtTime(profile.amRateHz, now);
      lfoDepthGain.gain.setValueAtTime(profile.amDepth, now);
      pulseGain.gain.setValueAtTime(pulseBaseGain, now);

      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(profile.filterCutoffHz, now);
      filter.Q.setValueAtTime(1.35, now);

      masterGain.gain.setValueAtTime(0.0001, now);
      masterGain.gain.linearRampToValueAtTime(profile.masterGain, now + 0.08);

      carrierOsc.connect(filter);
      harmonicOsc.connect(harmonicGain);
      harmonicGain.connect(filter);

      filter.connect(pulseGain);
      lfoOsc.connect(lfoDepthGain);
      lfoDepthGain.connect(pulseGain.gain);

      pulseGain.connect(masterGain);
      masterGain.connect(ctx.destination);

      carrierOsc.start(now);
      harmonicOsc.start(now);
      fmModOsc.start(now);
      lfoOsc.start(now);

      rpmSynth = {
        carrierOsc,
        harmonicOsc,
        harmonicGain,
        fmModOsc,
        fmDepthGain,
        fmHarmonicDepthGain,
        lfoOsc,
        lfoDepthGain,
        pulseGain,
        filter,
        masterGain,
      };
    } else {
      const tc = 0.035;
      rpmSynth.carrierOsc.frequency.setTargetAtTime(profile.carrierHz, now, tc);
      rpmSynth.harmonicOsc.frequency.setTargetAtTime(profile.harmonicHz, now, tc);
      rpmSynth.harmonicGain.gain.setTargetAtTime(profile.harmonicMix, now, 0.045);

      rpmSynth.fmModOsc.frequency.setTargetAtTime(profile.fmModHz, now, tc);
      rpmSynth.fmDepthGain.gain.setTargetAtTime(profile.fmDeviationHz, now, tc);
      rpmSynth.fmHarmonicDepthGain.gain.setTargetAtTime(profile.harmonicFmDeviationHz, now, tc);

      rpmSynth.lfoOsc.frequency.setTargetAtTime(profile.amRateHz, now, tc);
      rpmSynth.lfoDepthGain.gain.setTargetAtTime(profile.amDepth, now, 0.045);
      rpmSynth.pulseGain.gain.setTargetAtTime(pulseBaseGain, now, 0.045);

      rpmSynth.filter.frequency.setTargetAtTime(profile.filterCutoffHz, now, 0.05);
      rpmSynth.masterGain.gain.cancelScheduledValues(now);
      rpmSynth.masterGain.gain.setTargetAtTime(profile.masterGain, now, 0.045);
    }
  } catch {
    // Audio policy ignore
  }
}


