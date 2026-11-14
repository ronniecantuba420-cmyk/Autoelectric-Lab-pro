import {
  EcuPin,
  InjectedFault,
  WireConnection,
  BenchComponent,
  MultimeterState,
  PowerSupplyState,
  DiagnosticTroubleCode,
} from '../../types/ecu';
import { CircuitNetwork, CircuitSolutionResult } from '../electrical/CircuitNetwork';
import { AutomotiveModels } from '../components/AutomotiveModels';
import { FaultManager } from '../faults/FaultManager';
import { SignalGenerator } from '../signals/SignalGenerator';

export const DEFAULT_ECU_PINS: EcuPin[] = [
  { id: 'ecu-pin-1', pinNumber: 1, label: 'KL31', name: 'Power Ground 1', category: 'ground', nominalVoltage: 0.0, internalResistance: 0.08, description: 'Chassis/Engine Ground Return' },
  { id: 'ecu-pin-2', pinNumber: 2, label: 'KL31_2', name: 'Power Ground 2', category: 'ground', nominalVoltage: 0.0, internalResistance: 0.08, description: 'Power Ground Secondary' },
  { id: 'ecu-pin-3', pinNumber: 3, label: 'KL30', name: 'Battery Constant +12V', category: 'power', nominalVoltage: 12.6, internalResistance: 0.2, description: 'Unswitched Battery Supply (+30)' },
  { id: 'ecu-pin-4', pinNumber: 4, label: 'KL15', name: 'Ignition Switch Input', category: 'power', nominalVoltage: 12.6, internalResistance: 1200, description: 'Switched Terminal 15 (+15)' },
  { id: 'ecu-pin-5', pinNumber: 5, label: 'VREF_5V', name: 'Sensor 5V Reference', category: 'reference', nominalVoltage: 5.0, internalResistance: 8.5, description: 'Regulated 5.00V Supply (Max 150mA)' },
  { id: 'ecu-pin-6', pinNumber: 6, label: 'SGND', name: 'Sensor Clean Ground', category: 'ground', nominalVoltage: 0.0, internalResistance: 0.35, description: 'Analog Ground Reference' },
  { id: 'ecu-pin-7', pinNumber: 7, label: 'TPS_SIG', name: 'Throttle Position Signal', category: 'sensor_in', nominalVoltage: 0.85, internalResistance: 47000, description: 'Analog ADC input 0.5V - 4.5V' },
  { id: 'ecu-pin-8', pinNumber: 8, label: 'MAP_SIG', name: 'Manifold Pressure Signal', category: 'sensor_in', nominalVoltage: 1.45, internalResistance: 47000, description: 'Pressure Transducer Input' },
  { id: 'ecu-pin-9', pinNumber: 9, label: 'ECT_SIG', name: 'Coolant Temp Signal', category: 'sensor_in', nominalVoltage: 1.95, internalResistance: 2200, description: 'Internal Pull-Up 2.2kΩ to 5V' },
  { id: 'ecu-pin-10', pinNumber: 10, label: 'INJ_1', name: 'Injector 1 Driver', category: 'actuator_out', nominalVoltage: 12.6, internalResistance: 0.15, description: 'Low-Side MOSFET Sink to GND' },
  { id: 'ecu-pin-11', pinNumber: 11, label: 'IGN_1', name: 'Ignition Coil 1 Trigger', category: 'actuator_out', nominalVoltage: 0.0, internalResistance: 100, description: '5V Logic Trigger / Smart Coil' },
  { id: 'ecu-pin-12', pinNumber: 12, label: 'MRELAY', name: 'Main Relay Control', category: 'actuator_out', nominalVoltage: 12.6, internalResistance: 0.2, description: 'Low-side Relay Pull-Down' },
  { id: 'ecu-pin-13', pinNumber: 13, label: 'CAN_H', name: 'High-Speed CAN High', category: 'communication', nominalVoltage: 2.5, internalResistance: 60, description: 'Recessive 2.5V, Dominant 3.5V' },
  { id: 'ecu-pin-14', pinNumber: 14, label: 'CAN_L', name: 'High-Speed CAN Low', category: 'communication', nominalVoltage: 2.5, internalResistance: 60, description: 'Recessive 2.5V, Dominant 1.5V' },
  { id: 'ecu-pin-15', pinNumber: 15, label: 'O2_SIG', name: 'Oxygen Sensor 1 Bank 1', category: 'sensor_in', nominalVoltage: 0.45, internalResistance: 100000, description: 'Zirconia Nernst Cell 0.1V - 0.9V' },
  { id: 'ecu-pin-16', pinNumber: 16, label: 'FP_RELAY', name: 'Fuel Pump Relay Driver', category: 'actuator_out', nominalVoltage: 12.6, internalResistance: 0.2, description: 'Low-Side Ground Switched' },
];

export const DEFAULT_BENCH_COMPONENTS: BenchComponent[] = [
  {
    id: 'comp-tps',
    name: 'Throttle Position Sensor (TPS)',
    type: 'sensor',
    x: 480,
    y: 60,
    pins: [
      { id: 'tps-vcc', label: '5V VCC', type: 'power', relativeX: 0, relativeY: 46 },
      { id: 'tps-sig', label: 'WIPER SIG', type: 'output', relativeX: 0, relativeY: 78 },
      { id: 'tps-gnd', label: 'GND', type: 'ground', relativeX: 0, relativeY: 110 },
    ],
    state: { throttleAnglePercent: 20 },
  },
  {
    id: 'comp-map',
    name: 'Manifold Pressure (MAP)',
    type: 'sensor',
    x: 480,
    y: 220,
    pins: [
      { id: 'map-vcc', label: '5V VCC', type: 'power', relativeX: 0, relativeY: 46 },
      { id: 'map-sig', label: 'PRESSURE SIG', type: 'output', relativeX: 0, relativeY: 78 },
      { id: 'map-gnd', label: 'GND', type: 'ground', relativeX: 0, relativeY: 110 },
    ],
    state: { pressureKpa: 42 },
  },
  {
    id: 'comp-ect',
    name: 'Coolant Temp Sensor (ECT)',
    type: 'sensor',
    x: 480,
    y: 380,
    pins: [
      { id: 'ect-sig', label: 'THERMISTOR +', type: 'input', relativeX: 0, relativeY: 46 },
      { id: 'ect-gnd', label: 'GND RETURN', type: 'ground', relativeX: 0, relativeY: 78 },
    ],
    state: { tempCelsius: 85 },
  },
  {
    id: 'comp-inj',
    name: 'Cylinder 1 Fuel Injector',
    type: 'actuator',
    x: 770,
    y: 60,
    pins: [
      { id: 'inj-vbat', label: '+12V BATTERY', type: 'power', relativeX: 0, relativeY: 46 },
      { id: 'inj-ctrl', label: 'ECU SINK CTRL', type: 'input', relativeX: 0, relativeY: 78 },
    ],
    state: { coilResistanceOhms: 12.5, isFiring: true },
  },
  {
    id: 'comp-relay',
    name: 'Main System Relay (ISO)',
    type: 'relay',
    x: 770,
    y: 210,
    pins: [
      { id: 'relay-30', label: 'PIN 30 (+12V IN)', type: 'power', relativeX: 0, relativeY: 46 },
      { id: 'relay-87', label: 'PIN 87 (LOAD OUT)', type: 'output', relativeX: 0, relativeY: 78 },
      { id: 'relay-86', label: 'PIN 86 (COIL +)', type: 'power', relativeX: 0, relativeY: 110 },
      { id: 'relay-85', label: 'PIN 85 (COIL -)', type: 'input', relativeX: 0, relativeY: 142 },
    ],
    state: { isLatched: true, coilResistanceOhms: 85 },
  },
  {
    id: 'comp-can',
    name: 'CAN Bus Terminator (120Ω)',
    type: 'bus_node',
    x: 770,
    y: 400,
    pins: [
      { id: 'can-term-h', label: 'CAN-H TERMINAL', type: 'input', relativeX: 0, relativeY: 46 },
      { id: 'can-term-l', label: 'CAN-L TERMINAL', type: 'input', relativeX: 0, relativeY: 78 },
    ],
    state: { terminatingResistanceOhms: 120 },
  },
];

export const DEFAULT_WIRES: WireConnection[] = [
  { id: 'wire-1', sourcePinId: 'ecu-pin-5', targetPinId: 'tps-vcc', color: '#eab308', label: '5V VREF -> TPS VCC', isCut: false, resistance: 0.05 },
  { id: 'wire-2', sourcePinId: 'ecu-pin-7', targetPinId: 'tps-sig', color: '#22c55e', label: 'TPS SIG -> ECU Pin 7', isCut: false, resistance: 0.05 },
  { id: 'wire-3', sourcePinId: 'ecu-pin-6', targetPinId: 'tps-gnd', color: '#78716c', label: 'TPS GND -> ECU SGND', isCut: false, resistance: 0.05 },

  { id: 'wire-4', sourcePinId: 'ecu-pin-5', targetPinId: 'map-vcc', color: '#eab308', label: '5V VREF -> MAP VCC', isCut: false, resistance: 0.05 },
  { id: 'wire-5', sourcePinId: 'ecu-pin-8', targetPinId: 'map-sig', color: '#06b6d4', label: 'MAP SIG -> ECU Pin 8', isCut: false, resistance: 0.05 },
  { id: 'wire-6', sourcePinId: 'ecu-pin-6', targetPinId: 'map-gnd', color: '#78716c', label: 'MAP GND -> ECU SGND', isCut: false, resistance: 0.05 },

  { id: 'wire-7', sourcePinId: 'ecu-pin-9', targetPinId: 'ect-sig', color: '#f97316', label: 'ECT SIG -> ECU Pin 9', isCut: false, resistance: 0.05 },
  { id: 'wire-8', sourcePinId: 'ecu-pin-6', targetPinId: 'ect-gnd', color: '#78716c', label: 'ECT GND -> ECU SGND', isCut: false, resistance: 0.05 },

  { id: 'wire-9', sourcePinId: 'ecu-pin-10', targetPinId: 'inj-ctrl', color: '#3b82f6', label: 'ECU INJ1 -> Injector Sink', isCut: false, resistance: 0.05 },

  { id: 'wire-10', sourcePinId: 'ecu-pin-13', targetPinId: 'can-term-h', color: '#6366f1', label: 'CAN_H -> Bus Terminator', isCut: false, resistance: 0.05 },
  { id: 'wire-11', sourcePinId: 'ecu-pin-14', targetPinId: 'can-term-l', color: '#a855f7', label: 'CAN_L -> Bus Terminator', isCut: false, resistance: 0.05 },
];

export interface CircuitSolution {
  nodeVoltages: Record<string, number>;
  nodeResistances: Record<string, number>;
  wireCurrentsMa: Record<string, number>;
  supplyCurrentDrawAmps: number;
  isSupplyCurrentTripped: boolean;
  activeDTCs: DiagnosticTroubleCode[];
  multimeterReading: {
    display: string;
    value: number;
    unit: string;
    isOverLimit: boolean;
    isWarning: boolean;
    warningMessage?: string;
    shouldBeep: boolean;
  };
}

export interface SolveCircuitOptions {
  rpm?: number;
  isInjectorFiring?: boolean;
  hasCanFault?: boolean;
  hasInjectorFault?: boolean;
  camPhaseOffsetDeg?: number;
  ckpSignalLost?: boolean;
}

const NODE_TO_PIN_ID_MAP: Record<string, string> = {
  'tps-sig': 'ecu-pin-7',
  'map-sig': 'ecu-pin-8',
  'ect-sig': 'ecu-pin-9',
  'inj-ctrl': 'ecu-pin-10',
  'can-term-h': 'ecu-pin-13',
  'can-term-l': 'ecu-pin-14',
};

function mapNodeToSignalPinId(nodeId: string, pins: EcuPin[]): EcuPin | null {
  const norm = nodeId.toLowerCase();
  const direct = pins.find((p) => p.id === norm);
  if (direct) return direct;
  const mappedId = NODE_TO_PIN_ID_MAP[norm];
  if (mappedId) {
    return pins.find((p) => p.id === mappedId) ?? null;
  }
  return null;
}

function estimateWaveformMetrics(
  redNode: string,
  blackNode: string,
  pins: EcuPin[],
  nodeVoltages: Record<string, number>,
  faults: InjectedFault[],
  isPowerOn: boolean,
  simOptions: Required<SolveCircuitOptions>
): { acRms: number; freqHz: number } {
  const redPin = mapNodeToSignalPinId(redNode, pins);
  const blackPin = mapNodeToSignalPinId(blackNode, pins);
  const vRedDc = nodeVoltages[redNode] ?? 0;
  const vBlackDc = nodeVoltages[blackNode] ?? 0;

  if (!isPowerOn || (!redPin && !blackPin)) {
    return { acRms: 0, freqHz: 0 };
  }

  const sampleCount = 96;
  // Choose 160ms window for low-frequency pulse trains so AC RMS & edge counting capture multiple cycles cleanly
  const hasSlowSignal =
    redPin?.id === 'ecu-pin-10' ||
    redPin?.id === 'ecu-pin-11' ||
    redPin?.id === 'ecu-pin-15' ||
    blackPin?.id === 'ecu-pin-10' ||
    blackPin?.id === 'ecu-pin-11' ||
    blackPin?.id === 'ecu-pin-15';
  const windowMs = hasSlowSignal ? 160 : 20;

  const redFault = redPin ? faults.find((f) => f.pinId === redPin.id)?.faultType ?? 'NONE' : 'NONE';
  const blackFault = blackPin ? faults.find((f) => f.pinId === blackPin.id)?.faultType ?? 'NONE' : 'NONE';

  const sRed = redPin
    ? SignalGenerator.samplePinWaveformSeries({
        pinId: redPin.id,
        pinLabel: redPin.label,
        mnaNodeVoltage: vRedDc,
        faultType: redFault,
        isPowerOn,
        hasCanFault: simOptions.hasCanFault,
        hasInjectorFault: simOptions.hasInjectorFault,
        isInjectorFiring: simOptions.isInjectorFiring,
        rpm: simOptions.rpm,
        tStartSec: 0,
        windowMs,
        sampleCount,
      })
    : null;

  const sBlack = blackPin
    ? SignalGenerator.samplePinWaveformSeries({
        pinId: blackPin.id,
        pinLabel: blackPin.label,
        mnaNodeVoltage: vBlackDc,
        faultType: blackFault,
        isPowerOn,
        hasCanFault: simOptions.hasCanFault,
        hasInjectorFault: simOptions.hasInjectorFault,
        isInjectorFiring: simOptions.isInjectorFiring,
        rpm: simOptions.rpm,
        tStartSec: 0,
        windowMs,
        sampleCount,
      })
    : null;

  const diffSamples = new Array<number>(sampleCount);
  let meanDiff = 0;
  for (let i = 0; i < sampleCount; i++) {
    const vr = sRed ? sRed.samples[i]?.voltage ?? vRedDc : vRedDc;
    const vb = sBlack ? sBlack.samples[i]?.voltage ?? vBlackDc : vBlackDc;
    const d = vr - vb;
    diffSamples[i] = d;
    meanDiff += d;
  }
  meanDiff /= sampleCount;

  let sumSqAc = 0;
  for (let i = 0; i < sampleCount; i++) {
    const ac = diffSamples[i] - meanDiff;
    sumSqAc += ac * ac;
  }
  const acRms = Math.sqrt(sumSqAc / sampleCount);

  let freqHz = 0;
  if (acRms > 0.02) {
    const primaryFreq = sRed?.freqHz || sBlack?.freqHz || 0;
    freqHz = primaryFreq;
  }

  return { acRms, freqHz };
}

function buildBenchNetwork(
  powerSupply: PowerSupplyState,
  faults: InjectedFault[],
  wires: WireConnection[],
  components: BenchComponent[],
  effectiveSupplyVolts: number,
  mapSupplyVolts: number
): CircuitNetwork {
  const net = new CircuitNetwork();
  const isPowerOn = powerSupply.isOutputEnabled && powerSupply.voltageSetting > 0.4;

  // 1. Stamp Laboratory Power Supply (with physical 0.02Ω lead/internal impedance)
  if (isPowerOn) {
    net.addVoltageSource('bench-vsource', 'bench-vbat', 'chassis-gnd', effectiveSupplyVolts, 0.02);
  } else {
    net.addResistor('bench-off-bleed', 'bench-vbat', 'chassis-gnd', 1e6);
  }

  // 2. Stamp ECU Ground & Power Rails with physical series terminal fault impedance
  const gnd1FaultR = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-1');
  const gnd2FaultR = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-2');
  const sgndFaultR = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-6');
  const kl30FaultR = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-3');
  const kl15FaultR = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-4');
  const mrelayFaultR = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-12');
  const fpRelayFaultR = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-16');

  // Pin 1 & Pin 2: Ground returns to Chassis Ground
  net.addResistor('ecu-gnd-1', 'ecu-pin-1', 'chassis-gnd', 0.08 + gnd1FaultR);
  net.addResistor('ecu-gnd-2', 'ecu-pin-2', 'chassis-gnd', 0.08 + gnd2FaultR);

  // Pin 3 (KL30) & Pin 4 (KL15): Fed from bench +12V supply with realistic ECU logic return to Pin 1 / Pin 2
  net.addResistor('ecu-kl30-feed', 'bench-vbat', 'ecu-pin-3', 0.2 + kl30FaultR);
  net.addResistor('ecu-kl15-feed', 'bench-vbat', 'ecu-pin-4', 0.2 + kl15FaultR);
  net.addResistor('ecu-kl30-load', 'ecu-pin-3', 'ecu-pin-1', 150.0);
  net.addResistor('ecu-kl15-load', 'ecu-pin-4', 'ecu-pin-2', 150.0);

  // Pin 6: Sensor clean ground plane (with series fault resistance if corroded/open)
  net.addResistor('ecu-sgnd-plane', 'ecu-pin-6', 'chassis-gnd', 0.35 + sgndFaultR);

  // Pin 5: Regulated +5.00V Sensor Reference Supply Rail (Internal LDO referenced to SGND)
  const vrefSeriesFault = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-5');
  if (isPowerOn && effectiveSupplyVolts >= 6.5) {
    net.addVoltageSource('ecu-vref-ldo', 'ecu-pin-5', 'ecu-pin-6', 5.0, 8.5 + vrefSeriesFault);
  } else if (isPowerOn && effectiveSupplyVolts > 1.5) {
    // LDO Dropout mode
    net.addVoltageSource(
      'ecu-vref-ldo',
      'ecu-pin-5',
      'ecu-pin-6',
      Math.max(0, effectiveSupplyVolts - 1.2),
      8.5 + vrefSeriesFault
    );
  } else {
    net.addResistor('ecu-vref-off', 'ecu-pin-5', 'ecu-pin-6', 4700 + vrefSeriesFault);
  }

  // Pin 9 (ECT ADC input with internal 2.2kΩ pull-up to +5V VREF)
  net.addResistor('ecu-ect-pullup', 'ecu-pin-5', 'ecu-pin-9', 2200);

  // Pin 7 & Pin 8 (ADC input buffers with 47kΩ internal impedance to sensor ground)
  net.addResistor('ecu-tps-adc', 'ecu-pin-7', 'ecu-pin-6', 47000);
  net.addResistor('ecu-map-adc', 'ecu-pin-8', 'ecu-pin-6', 47000);

  // Pin 13 & Pin 14: ECU High-Speed CAN Bus termination (120Ω between CAN-H and CAN-L)
  net.addResistor('ecu-can-termination', 'ecu-pin-13', 'ecu-pin-14', 120.0);
  // CAN Transceiver recessive biasing to 2.5V (collapses under deep supply brownout)
  if (isPowerOn && effectiveSupplyVolts >= 4.0) {
    net.addVoltageSource('can-h-bias', 'ecu-pin-13', 'chassis-gnd', 2.5, 60.0);
    net.addVoltageSource('can-l-bias', 'ecu-pin-14', 'chassis-gnd', 2.5, 60.0);
  } else {
    net.addResistor('can-h-off', 'ecu-pin-13', 'chassis-gnd', 10000);
    net.addResistor('can-l-off', 'ecu-pin-14', 'chassis-gnd', 10000);
  }

  // 3. Stamp Components into Network
  const tpsComp = components.find((c) => c.id === 'comp-tps');
  const angle = (tpsComp?.state?.throttleAnglePercent as number) ?? 20;
  // TPS potentiometer sits directly across tps-vcc and tps-gnd, so MNA inherently scales it ratiometrically
  const tpsModel = AutomotiveModels.calculateTps(angle, 5.0);
  net.addResistor('tps-upper', 'tps-vcc', 'tps-sig', tpsModel.rUpper);
  net.addResistor('tps-lower', 'tps-sig', 'tps-gnd', tpsModel.rLower);

  const ectComp = components.find((c) => c.id === 'comp-ect');
  const temp = (ectComp?.state?.tempCelsius as number) ?? 85;
  const ectModel = AutomotiveModels.calculateEct(temp, 5.0);
  net.addResistor('ect-ntc', 'ect-sig', 'ect-gnd', ectModel.resistanceOhms);

  const mapComp = components.find((c) => c.id === 'comp-map');
  const kpa = (mapComp?.state?.pressureKpa as number) ?? 42;
  const mapModel = AutomotiveModels.calculateMap(kpa, mapSupplyVolts);
  // Active MAP pressure transducer powered by map-vcc (which equals 0V if wire-4/VREF opens)
  net.addVoltageSource('map-transducer', 'map-sig', 'map-gnd', isPowerOn ? mapModel.voltage : 0.0, 150);
  net.addResistor('map-vcc-load', 'map-vcc', 'map-gnd', 3500);

  // Injector Solenoid (dynamic coil resistance from component state)
  const injComp = components.find((c) => c.id === 'comp-inj');
  const injCoilOhms = Math.max(0.5, Number(injComp?.state?.coilResistanceOhms ?? 12.5));
  net.addResistor('inj-vbat-feed', 'bench-vbat', 'inj-vbat', 0.1);
  net.addResistor('inj-coil', 'inj-vbat', 'inj-ctrl', injCoilOhms);
  net.addResistor('inj-lowside-driver', 'ecu-pin-10', 'ecu-pin-1', 10000);

  // Pin 11: Ignition Coil 1 Trigger (5V logic output resting at 0.0V low state in DC quiescent mode)
  net.addResistor('ecu-ign1-pd', 'ecu-pin-11', 'ecu-pin-1', 100);

  // Main System Relay & Pin 12 (dynamic coil resistance + latch state)
  const relayComp = components.find((c) => c.id === 'comp-relay');
  const relayCoilOhms = Math.max(10.0, Number(relayComp?.state?.coilResistanceOhms ?? 85.0));
  const relayLatched = Boolean(relayComp?.state?.isLatched ?? true);
  net.addResistor('relay-30-feed', 'bench-vbat', 'relay-30', 0.1);
  net.addResistor('relay-86-feed', 'bench-vbat', 'relay-86', 0.1);
  net.addResistor('relay-coil', 'relay-86', 'relay-85', relayCoilOhms);
  net.addResistor('relay-contacts', 'relay-30', 'relay-87', isPowerOn && relayLatched ? 0.05 : 1e9);
  net.addResistor('wire-mrelay', 'relay-85', 'ecu-pin-12', 0.05 + mrelayFaultR);
  net.addResistor('ecu-mrelay-off', 'ecu-pin-12', 'ecu-pin-2', 10000);

  // Pin 15: Oxygen Sensor 1 Bank 1 (0.45V ECU stoichiometric bias reference)
  const o2SeriesFault = FaultManager.getSeriesFaultOhms(faults, 'ecu-pin-15');
  if (isPowerOn && effectiveSupplyVolts >= 4.0) {
    net.addVoltageSource('ecu-o2-bias', 'ecu-pin-15', 'ecu-pin-6', 0.45, 10000 + o2SeriesFault);
  } else {
    net.addResistor('ecu-o2-off', 'ecu-pin-15', 'ecu-pin-6', 100000 + o2SeriesFault);
  }

  // Pin 16: Fuel Pump Relay Driver (Fed through 85Ω fuel pump relay coil from +12V)
  net.addResistor('fp-relay-coil', 'bench-vbat', 'ecu-pin-16', 85.0 + fpRelayFaultR);
  net.addResistor('ecu-fprelay-off', 'ecu-pin-16', 'ecu-pin-2', 10000);

  // Cluster CAN Terminator (dynamic terminating resistance from component state)
  const canComp = components.find((c) => c.id === 'comp-can');
  const canTermOhms = Math.max(10.0, Number(canComp?.state?.terminatingResistanceOhms ?? 120.0));
  net.addResistor('cluster-can-term', 'can-term-h', 'can-term-l', canTermOhms);

  // 4. Stamp Harness Wires (incorporating series pin faults at source/target terminals)
  for (const wire of wires) {
    if (wire.isCut) {
      net.addResistor(`wire-${wire.id}`, wire.sourcePinId, wire.targetPinId, 1e9);
    } else {
      const sourcePinFaultR = FaultManager.getSeriesFaultOhms(faults, wire.sourcePinId);
      const targetPinFaultR = FaultManager.getSeriesFaultOhms(faults, wire.targetPinId);
      const baseR = wire.resistance || 0.05;
      const effectiveR =
        sourcePinFaultR >= 1e9 || targetPinFaultR >= 1e9
          ? 1e9
          : baseR + sourcePinFaultR + targetPinFaultR;
      net.addResistor(`wire-${wire.id}`, wire.sourcePinId, wire.targetPinId, effectiveR);
    }
  }

  // 5. Apply Parallel Topological Shunt Faults (SHORT_TO_GND / SHORT_TO_VBAT)
  FaultManager.applyFaults(net, faults);

  return net;
}

/**
 * solveCircuit: Solves the entire physical electrical lab using Modified Nodal Analysis (MNA).
 */
export function solveCircuit(
  powerSupply: PowerSupplyState,
  pins: EcuPin[],
  faults: InjectedFault[],
  wires: WireConnection[],
  components: BenchComponent[],
  multimeter: MultimeterState,
  simOptions: SolveCircuitOptions = {}
): CircuitSolution {
  const isPowerOn = powerSupply.isOutputEnabled && powerSupply.voltageSetting > 0.4;
  const vSet = isPowerOn ? powerSupply.voltageSetting : 0.0;

  // Pass 1: Solve at nominal PSU voltage & 5.0V MAP sensor excitation to obtain real load R_eq & map-vcc
  let effectiveSupplyVolts = vSet;
  let net = buildBenchNetwork(powerSupply, faults, wires, components, effectiveSupplyVolts, isPowerOn ? 5.0 : 0.0);
  let solution: CircuitSolutionResult = net.solve();

  // Check if PSU exceeds Constant-Current (C.C.) Limit -> compute linear foldback voltage
  const rawDrawAmps = solution.sourceCurrentDrawAmps;
  const isSupplyCurrentTripped = isPowerOn && rawDrawAmps > powerSupply.currentLimit;
  if (isSupplyCurrentTripped && rawDrawAmps > 1e-6) {
    const rLoadTotal = vSet / rawDrawAmps;
    effectiveSupplyVolts = Math.min(vSet, powerSupply.currentLimit * rLoadTotal);
  }

  // Check real solved MAP excitation across (map-vcc - map-gnd)
  const solvedMapVcc = isPowerOn
    ? Math.max(0, (solution.nodeVoltages['map-vcc'] ?? 0) - (solution.nodeVoltages['map-gnd'] ?? 0))
    : 0.0;

  // Pass 2: Re-solve if PSU folded back in C.C. mode or if MAP excitation deviates from 5.0V
  if (isPowerOn && (isSupplyCurrentTripped || Math.abs(solvedMapVcc - 5.0) > 0.05)) {
    const pass2MapVcc = isSupplyCurrentTripped
      ? solvedMapVcc * (vSet > 0 ? effectiveSupplyVolts / vSet : 0)
      : solvedMapVcc;
    net = buildBenchNetwork(powerSupply, faults, wires, components, effectiveSupplyVolts, pass2MapVcc);
    solution = net.solve();
  }

  const nodeVoltages = solution.nodeVoltages;
  const wireCurrentsMa: Record<string, number> = {};

  for (const wire of wires) {
    const iA = Math.abs(solution.branchCurrentsAmps[`wire-${wire.id}`] || 0);
    wireCurrentsMa[wire.id] = iA * 1000.0;
  }

  const supplyCurrentDraw = isSupplyCurrentTripped
    ? Math.min(solution.sourceCurrentDrawAmps, powerSupply.currentLimit)
    : solution.sourceCurrentDrawAmps;

  // Compute Node Resistances for UI
  const nodeResistances: Record<string, number> = {};
  for (const p of pins) {
    nodeResistances[p.id] = p.internalResistance;
  }

  const wire10 = wires.find((w) => w.id === 'wire-10');
  const wire11 = wires.find((w) => w.id === 'wire-11');
  const wire9 = wires.find((w) => w.id === 'wire-9');

  const resolvedSimOptions: Required<SolveCircuitOptions> = {
    rpm: simOptions.rpm ?? 850,
    isInjectorFiring: simOptions.isInjectorFiring ?? Boolean(components.find((c) => c.id === 'comp-inj')?.state?.isFiring ?? true),
    hasCanFault:
      simOptions.hasCanFault ??
      (faults.some((f) => f.pinId === 'ecu-pin-13' || f.pinId === 'ecu-pin-14') ||
        Boolean(wire10?.isCut) ||
        Boolean(wire11?.isCut) ||
        isSupplyCurrentTripped),
    hasInjectorFault:
      simOptions.hasInjectorFault ??
      (faults.some((f) => f.pinId === 'ecu-pin-10') ||
        Boolean(wire9?.isCut) ||
        isSupplyCurrentTripped),
    camPhaseOffsetDeg: simOptions.camPhaseOffsetDeg ?? 0,
    ckpSignalLost: simOptions.ckpSignalLost ?? false,
  };

  // 7. Calculate Real Multimeter Measurement
  const redNode = multimeter.redProbe.attachedToPinId?.toLowerCase() || null;
  const blackNode = multimeter.blackProbe.attachedToPinId?.toLowerCase() || null;

  let dmmDisplay = '0.00';
  let dmmVal = 0.0;
  let dmmUnit = 'V';
  let dmmOverLimit = false;
  let dmmWarning = false;
  let dmmWarningMsg = '';
  let dmmShouldBeep = false;

  if (!multimeter.isPowered) {
    dmmDisplay = 'OFF';
    dmmUnit = '';
  } else if (!redNode || !blackNode) {
    dmmDisplay = '---';
    dmmUnit = '';
  } else {
    const vRed = nodeVoltages[redNode] !== undefined ? nodeVoltages[redNode] : 0.0;
    const vBlack = nodeVoltages[blackNode] !== undefined ? nodeVoltages[blackNode] : 0.0;
    const deltaV = vRed - vBlack;
    const isLiveCircuit =
      isPowerOn && (Math.abs(deltaV) > 0.1 || Math.abs(vRed) > 0.3 || Math.abs(vBlack) > 0.3);

    switch (multimeter.mode) {
      case 'V_DC': {
        dmmVal = deltaV;
        const absV = Math.abs(deltaV);
        if (absV >= 1000) {
          dmmDisplay = (deltaV / 1000).toFixed(2);
          dmmUnit = 'kV DC';
        } else if (absV >= 1.0 || absV === 0) {
          dmmDisplay = deltaV.toFixed(2);
          dmmUnit = 'V DC';
        } else {
          dmmDisplay = (deltaV * 1000).toFixed(1);
          dmmUnit = 'mV DC';
        }
        break;
      }

      case 'V_AC': {
        const { acRms } = estimateWaveformMetrics(
          redNode,
          blackNode,
          pins,
          nodeVoltages,
          faults,
          isPowerOn,
          resolvedSimOptions
        );
        dmmVal = acRms;
        if (acRms >= 1000) {
          dmmDisplay = (acRms / 1000).toFixed(2);
          dmmUnit = 'kV AC';
        } else if (acRms >= 1.0 || acRms === 0) {
          dmmDisplay = acRms.toFixed(3);
          dmmUnit = 'V AC';
        } else {
          dmmDisplay = (acRms * 1000).toFixed(1);
          dmmUnit = 'mV AC';
        }
        break;
      }

      case 'RESISTANCE': {
        if (isLiveCircuit) {
          dmmWarning = true;
          dmmWarningMsg =
            'VOLTAGE DETECTED ON LIVE CIRCUIT! Turn bench power supply OFF for accurate Ohms measurement.';
          dmmDisplay = 'ERR';
          dmmUnit = 'Ω';
        } else {
          const rEq = net.calculateEquivalentResistance(redNode, blackNode);
          dmmVal = rEq;
          if (rEq >= 1e8 || !isFinite(rEq)) {
            dmmDisplay = 'O.L';
            dmmUnit = 'MΩ';
            dmmOverLimit = true;
          } else if (rEq >= 1e6) {
            dmmDisplay = (rEq / 1e6).toFixed(2);
            dmmUnit = 'MΩ';
          } else if (rEq >= 1000) {
            dmmDisplay = (rEq / 1000.0).toFixed(2);
            dmmUnit = 'kΩ';
          } else if (rEq >= 1.0 || rEq === 0) {
            dmmDisplay = rEq.toFixed(1);
            dmmUnit = 'Ω';
          } else {
            dmmDisplay = (rEq * 1000.0).toFixed(1);
            dmmUnit = 'mΩ';
          }
        }
        break;
      }

      case 'CONTINUITY': {
        if (isLiveCircuit) {
          dmmWarning = true;
          dmmWarningMsg =
            'LIVE VOLTAGE ON CONTINUITY PROBES! Power OFF bench supply before testing continuity.';
          dmmDisplay = 'ERR';
          dmmUnit = 'Ω';
        } else {
          const rCont = net.calculateEquivalentResistance(redNode, blackNode);
          dmmVal = rCont;
          if (rCont < 30.0) {
            dmmShouldBeep = true;
            if (rCont < 1.0 && rCont > 0) {
              dmmDisplay = (rCont * 1000).toFixed(0);
              dmmUnit = 'mΩ';
            } else {
              dmmDisplay = rCont.toFixed(1);
              dmmUnit = 'Ω';
            }
          } else if (rCont >= 1e6 || !isFinite(rCont)) {
            dmmDisplay = 'O.L';
            dmmUnit = 'Ω';
            dmmOverLimit = true;
          } else if (rCont >= 1000) {
            dmmDisplay = (rCont / 1000.0).toFixed(2);
            dmmUnit = 'kΩ';
          } else {
            dmmDisplay = rCont.toFixed(1);
            dmmUnit = 'Ω';
          }
        }
        break;
      }

      case 'DIODE': {
        if (isLiveCircuit) {
          dmmWarning = true;
          dmmWarningMsg =
            'LIVE VOLTAGE DETECTED! De-energize ECU before performing Diode Junction (-▷|-) test.';
          dmmDisplay = 'ERR';
          dmmUnit = 'V';
        } else {
          const rEq = net.calculateEquivalentResistance(redNode, blackNode);
          if (rEq < 50.0) {
            // Low-resistance continuity/coil path reads resistive drop under 1mA test current
            const mvDrop = rEq * 1.0; // I_test = 1 mA => V(mV) = R(Ω) * 1mA
            dmmVal = mvDrop / 1000;
            dmmDisplay = mvDrop.toFixed(1);
            dmmUnit = 'mV (SHORT)';
          } else if (isFinite(rEq) && rEq < 1e7) {
            // Silicon PN/ESD clamp junction drop (~0.62V) across valid ECU signal/power paths
            const vf = Math.min(0.78, Math.max(0.52, 0.58 + Math.log10(Math.max(10, rEq)) * 0.025));
            dmmVal = vf;
            dmmDisplay = vf.toFixed(3);
            dmmUnit = 'V';
          } else {
            dmmVal = Infinity;
            dmmDisplay = 'O.L';
            dmmUnit = 'V';
            dmmOverLimit = true;
          }
        }
        break;
      }

      case 'FREQUENCY': {
        const { freqHz } = estimateWaveformMetrics(
          redNode,
          blackNode,
          pins,
          nodeVoltages,
          faults,
          isPowerOn,
          resolvedSimOptions
        );
        dmmVal = freqHz;
        if (freqHz >= 1e6) {
          dmmDisplay = (freqHz / 1e6).toFixed(2);
          dmmUnit = 'MHz';
        } else if (freqHz >= 1000) {
          dmmDisplay = (freqHz / 1000.0).toFixed(1);
          dmmUnit = 'kHz';
        } else {
          dmmDisplay = freqHz.toFixed(1);
          dmmUnit = 'Hz';
        }
        break;
      }
    }
  }

  // 8. Generate Active OBD-II Diagnostic Trouble Codes (DTCs) from Actual Solved MNA Voltages & Topology
  const dtcs: DiagnosticTroubleCode[] = [];

  const tpsVoltage = nodeVoltages['ecu-pin-7'] ?? 0.85;
  if (isPowerOn && tpsVoltage < 0.20) {
    dtcs.push({
      code: 'P0122',
      system: 'Throttle Position Sensor',
      description: 'Throttle Position Sensor (G79) Circuit Low Input (Voltage < 0.20V)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-7'],
    });
  } else if (isPowerOn && tpsVoltage > 4.80) {
    dtcs.push({
      code: 'P0123',
      system: 'Throttle Position Sensor',
      description: 'Throttle Position Sensor (G79) Circuit High Input (Voltage > 4.80V)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-7'],
    });
  }

  const mapVoltage = nodeVoltages['ecu-pin-8'] ?? 1.45;
  if (isPowerOn && mapVoltage < 0.20) {
    dtcs.push({
      code: 'P0107',
      system: 'Manifold Absolute Pressure',
      description: 'MAP / Barometric Pressure Circuit Low Input (Voltage < 0.20V)',
      severity: 'WARNING',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-8'],
    });
  } else if (isPowerOn && mapVoltage > 4.80) {
    dtcs.push({
      code: 'P0108',
      system: 'Manifold Absolute Pressure',
      description: 'MAP / Barometric Pressure Circuit High Input (Voltage > 4.80V)',
      severity: 'WARNING',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-8'],
    });
  }

  const ectVoltage = nodeVoltages['ecu-pin-9'] ?? 1.95;
  if (isPowerOn && ectVoltage < 0.15) {
    dtcs.push({
      code: 'P0117',
      system: 'Engine Coolant Temperature',
      description: 'Coolant Temperature Sensor (G62) Circuit Low Input (Short to GND)',
      severity: 'WARNING',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-9'],
    });
  } else if (isPowerOn && ectVoltage > 4.85) {
    dtcs.push({
      code: 'P0118',
      system: 'Engine Coolant Temperature',
      description: 'Coolant Temperature Sensor (G62) Circuit High Input (Open Circuit)',
      severity: 'WARNING',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-9'],
    });
  }

  const o2Voltage = nodeVoltages['ecu-pin-15'] ?? 0.45;
  if (isPowerOn && o2Voltage < 0.05) {
    dtcs.push({
      code: 'P0131',
      system: 'Oxygen Sensor Bank 1',
      description: 'O2 Sensor Circuit Low Voltage (Short to GND / Sensor Bias Missing)',
      severity: 'WARNING',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-15'],
    });
  } else if (isPowerOn && o2Voltage > 1.10) {
    dtcs.push({
      code: 'P0132',
      system: 'Oxygen Sensor Bank 1',
      description: 'O2 Sensor Circuit High Voltage (Heater / +12V Shorted to Signal)',
      severity: 'WARNING',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-15'],
    });
  }

  const injVoltage = nodeVoltages['ecu-pin-10'] ?? 12.6;
  const injFaultObj = faults.find((f) => f.pinId === 'ecu-pin-10');
  if (isPowerOn && (injVoltage < 1.0 || injFaultObj?.faultType === 'OPEN_CIRCUIT' || wire9?.isCut)) {
    dtcs.push({
      code: 'P0201',
      system: 'Fuel Injection Driver',
      description: 'Cylinder 1 Injector Circuit Open / Driver Fault (No Coil Pull-Up at Pin 10)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-10'],
    });
  }

  const ignVoltage = nodeVoltages['ecu-pin-11'] ?? 0.0;
  const ignFaultObj = faults.find((f) => f.pinId === 'ecu-pin-11');
  if (isPowerOn && (ignVoltage > 5.5 || ignFaultObj?.faultType === 'OPEN_CIRCUIT')) {
    dtcs.push({
      code: 'P0351',
      system: 'Ignition Primary/Secondary',
      description: 'Ignition Coil "A" Primary/Secondary Circuit Malfunction (Pin 11)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-11'],
    });
  }

  const kl30Voltage = nodeVoltages['ecu-pin-3'] ?? 12.6;
  if (isPowerOn && kl30Voltage < 9.0) {
    dtcs.push({
      code: 'P0562',
      system: 'ECU System Voltage',
      description: 'System Voltage Low (KL30 < 9.0V — Supply Drop, Brownout, or C.C. Foldback)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-3'],
    });
  } else if (isPowerOn && kl30Voltage > 16.0) {
    dtcs.push({
      code: 'P0563',
      system: 'ECU System Voltage',
      description: 'System Voltage High (KL30 > 16.0V — Overvoltage Condition)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-3'],
    });
  }

  const canHVoltage = nodeVoltages['ecu-pin-13'] ?? 2.5;
  const canLVoltage = nodeVoltages['ecu-pin-14'] ?? 2.5;
  const canDifferential = Math.abs(canHVoltage - canLVoltage);
  const canTermResistance = net.calculateEquivalentResistance('can-term-h', 'can-term-l');
  const isCanTermDegraded = !isFinite(canTermResistance) || canTermResistance > 90.0;
  if (
    isPowerOn &&
    (canHVoltage < 0.3 ||
      canLVoltage < 0.3 ||
      canDifferential > 3.0 ||
      isCanTermDegraded ||
      resolvedSimOptions.hasCanFault)
  ) {
    dtcs.push({
      code: 'U0001',
      system: 'CAN Communication Network',
      description: 'High Speed CAN Communication Bus Malfunction (Bus shorted or terminated incorrectly)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-13', 'ecu-pin-14'],
    });
  }

  if (isPowerOn && resolvedSimOptions.ckpSignalLost) {
    dtcs.push({
      code: 'P0335',
      system: 'Crankshaft Position Sensor',
      description: 'Crankshaft Position Sensor "A" Circuit No Signal (CKP Dropout)',
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-10', 'ecu-pin-11'],
    });
  }

  if (isPowerOn && Math.abs(resolvedSimOptions.camPhaseOffsetDeg) > 15) {
    dtcs.push({
      code: 'P0016',
      system: 'CKP/CMP Correlation',
      description: `Crankshaft / Camshaft Position Correlation Bank 1 (${resolvedSimOptions.camPhaseOffsetDeg > 0 ? '+' : ''}${resolvedSimOptions.camPhaseOffsetDeg.toFixed(0)}° Phase Drift)`,
      severity: 'CRITICAL',
      status: 'ACTIVE',
      associatedPinIds: ['ecu-pin-10', 'ecu-pin-11'],
    });
  }

  return {
    nodeVoltages,
    nodeResistances,
    wireCurrentsMa,
    supplyCurrentDrawAmps: supplyCurrentDraw,
    isSupplyCurrentTripped,
    activeDTCs: dtcs,
    multimeterReading: {
      display: dmmDisplay,
      value: dmmVal,
      unit: dmmUnit,
      isOverLimit: dmmOverLimit,
      isWarning: dmmWarning,
      warningMessage: dmmWarningMsg,
      shouldBeep: dmmShouldBeep,
    },
  };
}
