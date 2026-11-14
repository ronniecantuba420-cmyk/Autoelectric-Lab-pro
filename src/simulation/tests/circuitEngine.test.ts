/**
 * Automated Verification Test Suite for AutoTech Virtual Lab Pro
 * Tests MNA Circuit Simulation Engine, Automotive Component Models,
 * Multimeter Thevenin Measurements, Power Supply, and Fault Injection.
 */

import { MatrixSolver } from '../engine/MatrixSolver';
import { CircuitNetwork } from '../electrical/CircuitNetwork';
import { AutomotiveModels } from '../components/AutomotiveModels';
import { FaultManager } from '../faults/FaultManager';
import { SignalGenerator } from '../signals/SignalGenerator';
import {
  solveCircuit,
  analyzePinBinaryState,
  DEFAULT_ECU_PINS,
  DEFAULT_BENCH_COMPONENTS,
  DEFAULT_WIRES,
} from '../../utils/circuitSolver';
import { InjectedFault, MultimeterState, PowerSupplyState } from '../../types/ecu';

interface TestResult {
  name: string;
  category: string;
  passed: boolean;
  expected: string;
  actual: string;
  error?: string;
}

const testResults: TestResult[] = [];

function assert(name: string, category: string, condition: boolean, expected: string, actual: string) {
  testResults.push({
    name,
    category,
    passed: condition,
    expected,
    actual,
  });
}

function assertCloseTo(
  name: string,
  category: string,
  actual: number,
  expected: number,
  tolerance = 0.05
) {
  const diff = Math.abs(actual - expected);
  const passed = diff <= tolerance;
  assert(
    name,
    category,
    passed,
    `${expected} ± ${tolerance}`,
    `${actual.toFixed(4)} (diff: ${diff.toFixed(4)})`
  );
}

// ==========================================
// TEST SUITE 1: Numerical Linear Solver (MNA)
// ==========================================
function testMatrixSolver() {
  // Test 1.1: 2x2 system
  // 2*v1 - 1*v2 = 5
  // -1*v1 + 3*v2 = 5
  // Solution: v1 = 4, v2 = 3
  const A = [
    [2, -1],
    [-1, 3],
  ];
  const b = [5, 5];
  const x = MatrixSolver.solve(A, b);

  assertCloseTo('MNA 2x2 Linear System Solve', 'Numerical Solver', x[0], 4.0, 0.001);
  assertCloseTo('MNA 2x2 Linear System Solve (v2)', 'Numerical Solver', x[1], 3.0, 0.001);

  // Test 1.2: Singular / Degenerate Matrix
  const A_sing = [
    [1, 1],
    [1, 1],
  ];
  const b_sing = [2, 2];
  const x_sing = MatrixSolver.solve(A_sing, b_sing);
  assert(
    'Singular Matrix Graceful Regularization',
    'Numerical Solver',
    x_sing.every(v => !isNaN(v) && isFinite(v)),
    'Finite non-NaN values',
    JSON.stringify(x_sing)
  );
}

// ==========================================
// TEST SUITE 2: Ohm's Law & Circuit Network
// ==========================================
function testOhmsLawAndNetwork() {
  const network = new CircuitNetwork();

  // Voltage source: 12.6V on node 'vbat'
  network.addVoltageSource('VS1', 'vbat', '0', 12.6, 0.02);

  // Load resistor: 10 ohms between 'vbat' and 'load_node'
  network.addResistor('load_node', '0', 10.0);
  network.addResistor('vbat', 'load_node', 0.05); // wire resistance

  const solution = network.solve();
  const vLoad = solution.nodeVoltages['load_node'] ?? 0;
  const currentDraw = solution.sourceCurrentDrawAmps;

  // Expected: 12.6 / (10 + 0.02 + 0.05) = 12.6 / 10.07 ≈ 1.2512 A
  // vLoad = 1.2512 * 10 = 12.512 V
  assertCloseTo("Ohm's Law V_Load", 'Electrical Network', vLoad, 12.512, 0.05);
  assertCloseTo("Ohm's Law Source Current", 'Electrical Network', currentDraw, 1.2512, 0.05);
}

// ==========================================
// TEST SUITE 3: Automotive Component Physics
// ==========================================
function testAutomotiveModels() {
  // 3.1: Dual TPS Transfer Function
  const tpsIdle = AutomotiveModels.calculateTps(0, 5.0);
  assertCloseTo('TPS Throttle 0% Track 1 (0.50V min)', 'Automotive Models', tpsIdle.track1Voltage, 0.50, 0.02);
  assertCloseTo('TPS Throttle 0% Track 2 (4.50V inverted)', 'Automotive Models', tpsIdle.track2Voltage, 4.50, 0.02);

  const tpsHalf = AutomotiveModels.calculateTps(50, 5.0);
  assertCloseTo('TPS Throttle 50% Track 1 (2.50V)', 'Automotive Models', tpsHalf.track1Voltage, 2.50, 0.02);

  const tpsWot = AutomotiveModels.calculateTps(100, 5.0);
  assertCloseTo('TPS Throttle 100% Track 1 (4.50V WOT)', 'Automotive Models', tpsWot.track1Voltage, 4.50, 0.02);
  assertCloseTo('TPS Throttle 100% Track 2 (0.50V WOT)', 'Automotive Models', tpsWot.track2Voltage, 0.50, 0.02);

  // 3.2: ECT Steinhart-Hart NTC Thermistor
  const rCold = AutomotiveModels.calculateEct(10).resistanceOhms; // 10°C
  const rNominal = AutomotiveModels.calculateEct(25).resistanceOhms; // 25°C
  const rHot = AutomotiveModels.calculateEct(85).resistanceOhms; // 85°C

  assert(
    'ECT NTC Negative Temperature Coefficient (R_cold > R_nominal > R_hot)',
    'Automotive Models',
    rCold > rNominal && rNominal > rHot,
    'Cold > Nominal > Hot',
    `Cold: ${rCold.toFixed(0)}Ω, Nom: ${rNominal.toFixed(0)}Ω, Hot: ${rHot.toFixed(0)}Ω`
  );
  assertCloseTo('ECT Thermistor 25°C Benchmark (2500Ω)', 'Automotive Models', rNominal, 2500, 1.0);

  // 3.3: CAN Bus Termination Resistance
  const canNominal = AutomotiveModels.calculateCanBus(true, true);
  assertCloseTo('CAN Bus Dual 120Ω Parallel Termination (60Ω)', 'Automotive Models', canNominal.busResistanceOhms, 60.0, 0.1);

  const canOpenTerm = AutomotiveModels.calculateCanBus(true, false);
  assertCloseTo('CAN Bus Single Term Open (120Ω Remaining)', 'Automotive Models', canOpenTerm.busResistanceOhms, 120.0, 0.1);

  // 3.4: Ratiometric TPS & MAP scaling at reduced VREF and 0V safety
  const tpsLowVref = AutomotiveModels.calculateTps(50, 2.5);
  assertCloseTo('TPS 50% at 2.5V VREF Scales Ratiometrically (1.25V)', 'Automotive Models', tpsLowVref.track1Voltage, 1.25, 0.02);
  const tpsZeroVref = AutomotiveModels.calculateTps(50, 0);
  assert(
    'TPS at 0V VREF Avoids NaN / Infinity',
    'Automotive Models',
    Number.isFinite(tpsZeroVref.track1Voltage) && Number.isFinite(tpsZeroVref.rLower) && tpsZeroVref.track1Voltage === 0,
    'Finite 0V output & valid resistor divider',
    `v=${tpsZeroVref.track1Voltage}, rLower=${tpsZeroVref.rLower}`
  );
  const mapLowVref = AutomotiveModels.calculateMap(100, 2.5);
  assertCloseTo('MAP 100kPa at 2.5V VREF Scales Ratiometrically (2.25V)', 'Automotive Models', mapLowVref.voltage, 2.25, 0.02);
}

// ==========================================
// TEST SUITE 4: Fault Injection & Diagnostics
// ==========================================
function testFaultInjection() {
  const basePins = DEFAULT_ECU_PINS;
  const baseComponents = DEFAULT_BENCH_COMPONENTS;
  const baseWires = DEFAULT_WIRES;

  const normalSupply: PowerSupplyState = {
    voltageSetting: 12.6,
    currentLimit: 5.0,
    isOutputEnabled: true,
    preset: '12V_BENCH',
  };

  const dmmVoltage: MultimeterState = {
    mode: 'V_DC',
    redProbe: { attachedToPinId: 'ecu-pin-7', attachedLabel: 'TPS_SIG (Pin 7)' },
    blackProbe: { attachedToPinId: 'chassis-gnd', attachedLabel: 'Chassis GND' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  };

  // Set TPS throttle component to 50% for 2.50V benchmark
  const testComponents = baseComponents.map(c =>
    c.id === 'comp-tps' ? { ...c, state: { ...c.state, throttleAnglePercent: 50 } } : c
  );

  // Normal TPS Voltage (2.50V at 50% throttle)
  const normSol = solveCircuit(normalSupply, basePins, [], baseWires, testComponents, dmmVoltage);
  assertCloseTo('Nominal TPS Sensor Output Voltage (2.50V at 50% throttle)', 'Fault Injection', normSol.multimeterReading.value, 2.50, 0.15);
  assert('Nominal State DTC Count == 0', 'Fault Injection', normSol.activeDTCs.length === 0, '0 DTCs', `${normSol.activeDTCs.length} DTCs`);

  // Fault 1: Short TPS to Ground
  const shortFault: InjectedFault[] = [
    { pinId: 'ecu-pin-7', faultType: 'SHORT_TO_GND', description: 'TPS signal wire pinched to metal ground', timestamp: Date.now() },
  ];
  const shortSol = solveCircuit(normalSupply, basePins, shortFault, baseWires, testComponents, dmmVoltage);
  assertCloseTo('TPS Short to GND Voltage (0.0V)', 'Fault Injection', shortSol.multimeterReading.value, 0.0, 0.05);
  assert('TPS Short to GND Generates P0122 DTC', 'Fault Injection', shortSol.activeDTCs.some(d => d.code === 'P0122'), 'Contains P0122', JSON.stringify(shortSol.activeDTCs.map(d => d.code)));

  // Fault 2: Short to Battery (+12.6V)
  const vbatFault: InjectedFault[] = [
    { pinId: 'ecu-pin-7', faultType: 'SHORT_TO_VBAT', description: 'Harness shorted to battery +12V', timestamp: Date.now() },
  ];
  const vbatSol = solveCircuit(normalSupply, basePins, vbatFault, baseWires, testComponents, dmmVoltage);
  assertCloseTo('TPS Short to VBAT Voltage (12.6V)', 'Fault Injection', vbatSol.multimeterReading.value, 12.6, 0.2);
  assert('TPS Short to VBAT Generates P0123 DTC', 'Fault Injection', vbatSol.activeDTCs.some(d => d.code === 'P0123'), 'Contains P0123', JSON.stringify(vbatSol.activeDTCs.map(d => d.code)));

  // Fault 3: High Resistance Corrosion (250Ω) on TPS Pin 7
  const corrodeFault: InjectedFault[] = [
    { pinId: 'ecu-pin-7', faultType: 'HIGH_RESISTANCE_250R', description: 'Corroded pin terminal (250Ω)', timestamp: Date.now() },
  ];
  const corrodeSol = solveCircuit(normalSupply, basePins, corrodeFault, baseWires, testComponents, dmmVoltage);
  assert(
    'Corrosion Introduces Measurable Voltage Attenuation',
    'Fault Injection',
    corrodeSol.multimeterReading.value < normSol.multimeterReading.value,
    '< nominal 2.5V',
    `${corrodeSol.multimeterReading.value.toFixed(3)}V (nominal: ${normSol.multimeterReading.value.toFixed(3)}V)`
  );

  // Fault 4: True Series Open Circuit on TPS Signal (Pin 7)
  const tpsOpenFault: InjectedFault[] = [
    { pinId: 'ecu-pin-7', faultType: 'OPEN_CIRCUIT', description: 'TPS Signal Wire Break', timestamp: Date.now() },
  ];
  const tpsOpenSol = solveCircuit(normalSupply, basePins, tpsOpenFault, baseWires, testComponents, dmmVoltage);
  assertCloseTo('TPS Pin 7 Open Circuit Isolates ADC Input (~0.0V)', 'Fault Injection', tpsOpenSol.nodeVoltages['ecu-pin-7'] ?? -1, 0.0, 0.05);
  assert('TPS Open Circuit Triggers P0122', 'Fault Injection', tpsOpenSol.activeDTCs.some(d => d.code === 'P0122'), 'Contains P0122', JSON.stringify(tpsOpenSol.activeDTCs.map(d => d.code)));

  // Fault 5: True Series Ground Corrosion (+50Ω) on KL31 Pin 1 causes genuine ground lift
  const gndCorrodeFault: InjectedFault[] = [
    { pinId: 'ecu-pin-1', faultType: 'HIGH_RESISTANCE_50R', description: 'Main Ground Fretting', timestamp: Date.now() },
  ];
  const gndCorrodeSol = solveCircuit(normalSupply, basePins, gndCorrodeFault, baseWires, testComponents, dmmVoltage);
  const pin1GroundLift = gndCorrodeSol.nodeVoltages['ecu-pin-1'] ?? 0;
  assert(
    'Ground Corrosion (+50Ω on Pin 1) Causes Real Ground Offset > 1.5V',
    'Fault Injection',
    pin1GroundLift > 1.5 && pin1GroundLift < 5.0,
    'Between 1.5V and 5.0V',
    `${pin1GroundLift.toFixed(3)}V`
  );

  // Fault 6: Injector 1 Open Circuit triggers P0201 and collapses Pin 10 voltage
  const injOpenFault: InjectedFault[] = [
    { pinId: 'ecu-pin-10', faultType: 'OPEN_CIRCUIT', description: 'Injector 1 Open Circuit', timestamp: Date.now() },
  ];
  const injOpenSol = solveCircuit(normalSupply, basePins, injOpenFault, baseWires, testComponents, dmmVoltage);
  assertCloseTo('Injector 1 Open Drops Pin 10 to 0.0V', 'Fault Injection', injOpenSol.nodeVoltages['ecu-pin-10'] ?? -1, 0.0, 0.05);
  assert('Injector 1 Open Logs P0201 DTC', 'Fault Injection', injOpenSol.activeDTCs.some(d => d.code === 'P0201'), 'Contains P0201', JSON.stringify(injOpenSol.activeDTCs.map(d => d.code)));

  // Fault 7: PSU Constant-Current (C.C.) Foldback Under Short to VBAT->GND & Low Supply P0562
  const lowLimSupply: PowerSupplyState = {
    voltageSetting: 12.6,
    currentLimit: 2.0,
    isOutputEnabled: true,
    preset: '12V_BENCH',
  };
  const kl30ShortFault: InjectedFault[] = [
    { pinId: 'ecu-pin-3', faultType: 'SHORT_TO_GND', description: 'KL30 Hard Short to GND', timestamp: Date.now() },
  ];
  const ccSol = solveCircuit(lowLimSupply, basePins, kl30ShortFault, baseWires, testComponents, dmmVoltage);
  assert(
    'PSU C.C. Foldback Collapses bench-vbat & Clamps Current <= Limit',
    'Fault Injection',
    ccSol.isSupplyCurrentTripped &&
      (ccSol.nodeVoltages['bench-vbat'] ?? 12) < 2.0 &&
      ccSol.supplyCurrentDrawAmps <= lowLimSupply.currentLimit + 0.05 &&
      ccSol.activeDTCs.some(d => d.code === 'P0562'),
    'Tripped=true, Vbat < 2.0V, I <= 2.0A, P0562',
    `tripped=${ccSol.isSupplyCurrentTripped}, vbat=${(ccSol.nodeVoltages['bench-vbat'] ?? 0).toFixed(2)}V, I=${ccSol.supplyCurrentDrawAmps.toFixed(2)}A, dtcs=${ccSol.activeDTCs.map(d => d.code).join(',')}`
  );
}

// ==========================================
// TEST SUITE 5: Virtual Multimeter & Measurements
// ==========================================
function testMultimeterModes() {
  // Key-OFF condition: power supply turned OFF for passive resistance diagnostics
  const offSupply: PowerSupplyState = {
    voltageSetting: 12.6,
    currentLimit: 5.0,
    isOutputEnabled: false,
    preset: '12V_BENCH',
  };

  // 5.1: Continuity / Resistance Mode on CAN Bus Termination (Key OFF)
  const dmmOhms: MultimeterState = {
    mode: 'RESISTANCE',
    redProbe: { attachedToPinId: 'ecu-pin-13', attachedLabel: 'CAN_H' },
    blackProbe: { attachedToPinId: 'ecu-pin-14', attachedLabel: 'CAN_L' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  };

  const ohmsSol = solveCircuit(offSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmOhms);
  assertCloseTo(
    'DMM Resistance Mode Measures CAN Bus Termination (60Ω Key-OFF)',
    'Digital Multimeter',
    ohmsSol.multimeterReading.value,
    60.0,
    2.0
  );

  // 5.2: Live Circuit Warning when measuring Ohms with Power ON
  const liveSupply: PowerSupplyState = {
    voltageSetting: 12.6,
    currentLimit: 5.0,
    isOutputEnabled: true,
    preset: '12V_BENCH',
  };
  const liveOhmsSol = solveCircuit(liveSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmOhms);
  assert(
    'DMM Ohms on Live Circuit Triggers Warning & Lockout',
    'Digital Multimeter',
    liveOhmsSol.multimeterReading.isWarning && liveOhmsSol.multimeterReading.display === 'ERR',
    'Warning ERR',
    `${liveOhmsSol.multimeterReading.display} (${liveOhmsSol.multimeterReading.warningMessage ?? 'OK'})`
  );

  // 5.3: Continuity Mode (Key-OFF valid & Live Circuit lockout)
  const dmmCont: MultimeterState = {
    mode: 'CONTINUITY',
    redProbe: { attachedToPinId: 'ecu-pin-1', attachedLabel: 'KL31 GND 1' },
    blackProbe: { attachedToPinId: 'ecu-pin-2', attachedLabel: 'KL31 GND 2' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  };
  const contSol = solveCircuit(offSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmCont);
  assert(
    'DMM Continuity Beeps on Common Grounds (<50Ω)',
    'Digital Multimeter',
    contSol.multimeterReading.shouldBeep || contSol.multimeterReading.value < 5.0,
    'Continuity BEEP',
    contSol.multimeterReading.display
  );

  const dmmContLive: MultimeterState = {
    ...dmmCont,
    redProbe: { attachedToPinId: 'ecu-pin-3', attachedLabel: 'KL30' },
  };
  const contLiveSol = solveCircuit(liveSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmContLive);
  assert(
    'DMM Continuity on Live 12V Rail Triggers Warning & Lockout',
    'Digital Multimeter',
    contLiveSol.multimeterReading.isWarning && contLiveSol.multimeterReading.display === 'ERR',
    'Warning ERR',
    contLiveSol.multimeterReading.display
  );

  // 5.4: DMM AC Voltage & Frequency on Active Injector Pin
  const dmmAcInj: MultimeterState = {
    mode: 'V_AC',
    redProbe: { attachedToPinId: 'ecu-pin-10', attachedLabel: 'INJ_1' },
    blackProbe: { attachedToPinId: 'chassis-gnd', attachedLabel: 'Chassis GND' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  };
  const acInjSol = solveCircuit(liveSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmAcInj, { rpm: 1200, isInjectorFiring: true });
  assert(
    'DMM V_AC Measures Real Non-Zero AC RMS on Firing Injector',
    'Digital Multimeter',
    acInjSol.multimeterReading.value > 1.0,
    '> 1.0V AC RMS',
    `${acInjSol.multimeterReading.display} ${acInjSol.multimeterReading.unit}`
  );

  const dmmFreqInj: MultimeterState = { ...dmmAcInj, mode: 'FREQUENCY' };
  const freqInjSol = solveCircuit(liveSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmFreqInj, { rpm: 1200, isInjectorFiring: true });
  assertCloseTo('DMM Frequency Mode Reads 20.0 Hz at 1200 RPM on INJ_1', 'Digital Multimeter', freqInjSol.multimeterReading.value, 20.0, 0.5);

  // 5.5: DMM Diode Mode Measures Valid PN Drop on ECU Pin & O.L on Disconnected Open Wire
  const dmmDiode: MultimeterState = {
    mode: 'DIODE',
    redProbe: { attachedToPinId: 'ecu-pin-7', attachedLabel: 'TPS_SIG' },
    blackProbe: { attachedToPinId: 'chassis-gnd', attachedLabel: 'Chassis GND' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  };
  const diodeSol = solveCircuit(offSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmDiode);
  assert(
    'DMM Diode Mode Reads Forward Junction Drop (~0.5–0.8V) Key-OFF',
    'Digital Multimeter',
    diodeSol.multimeterReading.value >= 0.5 && diodeSol.multimeterReading.value <= 0.85,
    '0.50V – 0.85V',
    `${diodeSol.multimeterReading.display} ${diodeSol.multimeterReading.unit}`
  );
}

// ==========================================
// TEST SUITE 6: Oscilloscope Physical Signals
// ==========================================
function testOscilloscopeSignals() {
  // 6.1: Crankshaft 60-2 Missing Tooth Pattern & Signal Loss
  const crankTooth1 = SignalGenerator.getCrankshaftVrSignal(0.001, 1200);
  const crankLost = SignalGenerator.getCrankshaftVrSignal(0.001, 1200, true);
  assert('Crankshaft VR Signal Generates Dynamic Sine Wave', 'Oscilloscope Engine', typeof crankTooth1 === 'number' && !isNaN(crankTooth1) && crankLost === 0, 'Valid Number & 0 when lost', `${crankTooth1} / lost=${crankLost}`);

  // 6.1b: Camshaft Hall Phase Shift + DTC P0016 / P0335
  const cmpNom = SignalGenerator.getCamshaftHallSignal(0.001, 1200, 0);
  const cmpShifted = SignalGenerator.getCamshaftHallSignal(0.001, 1200, 180);
  assert('Camshaft Hall 180° Phase Shift Inverts Sync Pulse', 'Oscilloscope Engine', cmpNom === 5.0 && cmpShifted === 0.0, '5V @ 0°, 0V @ 180°', `nom=${cmpNom}V, shift180=${cmpShifted}V`);

  const liveSupply: PowerSupplyState = {
    voltageSetting: 12.6,
    currentLimit: 5.0,
    isOutputEnabled: true,
    preset: '12V_BENCH',
  };
  const dmmDummy: MultimeterState = {
    mode: 'V_DC',
    redProbe: { attachedToPinId: 'ecu-pin-7', attachedLabel: 'TPS' },
    blackProbe: { attachedToPinId: 'chassis-gnd', attachedLabel: 'GND' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  };
  const ckpCmpFaultSol = solveCircuit(liveSupply, DEFAULT_ECU_PINS, [], DEFAULT_WIRES, DEFAULT_BENCH_COMPONENTS, dmmDummy, {
    rpm: 1200,
    camPhaseOffsetDeg: 22,
    ckpSignalLost: true,
  });
  assert(
    'CKP Signal Loss & >15° CMP Drift Log P0335 & P0016',
    'Oscilloscope Engine',
    ckpCmpFaultSol.activeDTCs.some(d => d.code === 'P0335') && ckpCmpFaultSol.activeDTCs.some(d => d.code === 'P0016'),
    'Contains P0335 & P0016',
    JSON.stringify(ckpCmpFaultSol.activeDTCs.map(d => d.code))
  );

  // 6.2: Injector Waveform 3-Phase Physical Profile
  // Phase 1: MOSFET Dwell Saturation (0.2V)
  const injDwell = SignalGenerator.getInjectorWaveform(0.001, false, 12.6);
  assertCloseTo('Injector MOSFET Ground Dwell Voltage (~0.2V)', 'Oscilloscope Engine', injDwell, 0.2, 0.05);

  // Phase 2: Inductive Flyback Kick (> 40V)
  const injFlyback = SignalGenerator.getInjectorWaveform(0.00255, false, 12.6);
  assert(
    'Injector Flyback Spike > 40V During De-energization',
    'Oscilloscope Engine',
    injFlyback > 40.0,
    '> 40V Kick',
    `${injFlyback.toFixed(1)}V`
  );

  // Phase 3: Quiescent VBat (12.6V)
  const injQuiescent = SignalGenerator.getInjectorWaveform(0.010, false, 12.6);
  assertCloseTo('Injector Quiescent Battery Voltage (12.6V)', 'Oscilloscope Engine', injQuiescent, 12.6, 0.1);

  // 6.3: Dual-Trace CAN_H vs CAN_L Anti-Phase Correlation (-1.0 / 180 deg)
  const dualCan = SignalGenerator.sampleDualPinWaveformSeries({
    ch1PinId: 'ecu-pin-13',
    ch1PinLabel: 'CAN_H',
    ch1MnaVoltage: 2.5,
    ch2PinId: 'ecu-pin-14',
    ch2PinLabel: 'CAN_L',
    ch2MnaVoltage: 2.5,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
    windowMs: 10,
    sampleCount: 96,
  });
  assert(
    'Dual-Trace CAN_H vs CAN_L Exhibits Anti-Phase (r <= -0.95, 180°)',
    'Oscilloscope Engine',
    dualCan.correlationMode === 'ANTI_PHASE' && dualCan.correlationR !== null && dualCan.correlationR <= -0.95 && dualCan.phaseDiffDeg === 180,
    'ANTI_PHASE, r <= -0.95, 180°',
    `${dualCan.correlationMode}, r=${dualCan.correlationR}, deg=${dualCan.phaseDiffDeg}`
  );

  // 6.4: Dual-Trace INJ_1 vs IGN_1 Phase Lag
  const dualTiming = SignalGenerator.sampleDualPinWaveformSeries({
    ch1PinId: 'ecu-pin-10',
    ch1PinLabel: 'INJ_1',
    ch1MnaVoltage: 12.6,
    ch2PinId: 'ecu-pin-11',
    ch2PinLabel: 'IGN_1',
    ch2MnaVoltage: 0.0,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
    windowMs: 50,
    sampleCount: 128,
  });
  assert(
    'Dual-Trace INJ_1 vs IGN_1 Captures Both Waveforms & Non-Zero Phase/Lag',
    'Oscilloscope Engine',
    dualTiming.ch1Stats.vpp > 40 && dualTiming.ch2Stats.vpp >= 4.9 && dualTiming.timeLagMs !== null && dualTiming.timeLagMs !== 0,
    'Vpp1>40V, Vpp2>=4.9V, non-zero lag',
    `Vpp1=${dualTiming.ch1Stats.vpp}, Vpp2=${dualTiming.ch2Stats.vpp}, lag=${dualTiming.timeLagMs}ms`
  );

  // 6.5: Dual-Trace KL30 vs KL15 In-Phase Ripple
  const dualPower = SignalGenerator.sampleDualPinWaveformSeries({
    ch1PinId: 'ecu-pin-3',
    ch1PinLabel: 'KL30',
    ch1MnaVoltage: 12.6,
    ch2PinId: 'ecu-pin-4',
    ch2PinLabel: 'KL15',
    ch2MnaVoltage: 12.6,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
    windowMs: 40,
    sampleCount: 96,
  });
  assert(
    'Dual-Trace KL30 vs KL15 In-Phase Supply Ripple (r >= 0.99, 0°)',
    'Oscilloscope Engine',
    dualPower.correlationMode === 'IN_PHASE' && dualPower.correlationR !== null && dualPower.correlationR >= 0.99 && dualPower.phaseDiffDeg === 0,
    'IN_PHASE, r >= 0.99, 0°',
    `${dualPower.correlationMode}, r=${dualPower.correlationR}, deg=${dualPower.phaseDiffDeg}`
  );

  // 6.6: Dual-Trace Short-to-GND Fault Collapses Correlation to DC_STATIC
  const dualFaulted = SignalGenerator.sampleDualPinWaveformSeries({
    ch1PinId: 'ecu-pin-7',
    ch1PinLabel: 'TPS_SIG',
    ch1MnaVoltage: 0.0,
    ch1FaultType: 'SHORT_TO_GND',
    ch2PinId: 'ecu-pin-8',
    ch2PinLabel: 'MAP_SIG',
    ch2MnaVoltage: 1.6,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
    windowMs: 10,
    sampleCount: 96,
  });
  assert(
    'Dual-Trace Faulted Pin Collapses Correlation to DC_STATIC',
    'Oscilloscope Engine',
    dualFaulted.correlationMode === 'DC_STATIC' && dualFaulted.correlationR === null && dualFaulted.avgDiffV === -1.6,
    'DC_STATIC, r=null, avgDiffV=-1.6',
    `${dualFaulted.correlationMode}, r=${dualFaulted.correlationR}, avgDiffV=${dualFaulted.avgDiffV}`
  );

  // 6.7: Auto-Scale Normalization Across Asymmetric Amplitudes (INJ_1 ~65V vs IGN_1 ~5V)
  const ch1NormsTiming = dualTiming.samples.map((s) => s.ch1Norm);
  const ch2NormsTiming = dualTiming.samples.map((s) => s.ch2Norm);
  const ch1NormMin = Math.min(...ch1NormsTiming);
  const ch1NormMax = Math.max(...ch1NormsTiming);
  const ch2NormMin = Math.min(...ch2NormsTiming);
  const ch2NormMax = Math.max(...ch2NormsTiming);
  assert(
    'Auto-Scale Normalizes Asymmetric INJ_1 (~65V) & IGN_1 (~5V) Both to [0, 100]% While Preserving Raw Vpp',
    'Oscilloscope Engine',
    ch1NormMin === 0 &&
      ch1NormMax === 100 &&
      ch2NormMin === 0 &&
      ch2NormMax === 100 &&
      dualTiming.autoScale.ch1SpanV > 40 &&
      dualTiming.autoScale.ch2SpanV >= 4.9 &&
      dualTiming.autoScale.amplitudeRatio !== null &&
      dualTiming.autoScale.amplitudeRatio > 5,
    'Both 0–100%, raw spans >40V & >=4.9V, ratio > 5×',
    `CH1=[${ch1NormMin},${ch1NormMax}]% (${dualTiming.autoScale.ch1SpanV}V), CH2=[${ch2NormMin},${ch2NormMax}]% (${dualTiming.autoScale.ch2SpanV}V), ratio=${dualTiming.autoScale.amplitudeRatio}x`
  );

  // 6.8: Auto-Scale Gracefully Handles Flat/Faulted DC Channel at 50% Midpoint Without NaN
  const dualFlatVsO2 = SignalGenerator.sampleDualPinWaveformSeries({
    ch1PinId: 'ecu-pin-7',
    ch1PinLabel: 'TPS_SIG',
    ch1MnaVoltage: 0.0,
    ch1FaultType: 'SHORT_TO_GND',
    ch2PinId: 'ecu-pin-15',
    ch2PinLabel: 'O2_SIG',
    ch2MnaVoltage: 0.45,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
    windowMs: 800,
    sampleCount: 96,
  });
  const flatCh1AllMid = dualFlatVsO2.samples.every(
    (s) => Number.isFinite(s.ch1Norm) && s.ch1Norm === 50.0 && Number.isFinite(s.ch2Norm) && Number.isFinite(s.diffNorm)
  );
  const o2MinNorm = Math.min(...dualFlatVsO2.samples.map((s) => s.ch2Norm));
  const o2MaxNorm = Math.max(...dualFlatVsO2.samples.map((s) => s.ch2Norm));
  assert(
    'Auto-Scale Maps Flat Short-to-GND Channel to 50% Midpoint & Active O2_SIG to [0, 100]%',
    'Oscilloscope Engine',
    flatCh1AllMid &&
      dualFlatVsO2.autoScale.ch1IsFlat === true &&
      dualFlatVsO2.autoScale.ch2IsFlat === false &&
      dualFlatVsO2.autoScale.amplitudeRatio === null &&
      o2MinNorm === 0 &&
      o2MaxNorm === 100,
    'CH1 flat=true @ 50%, CH2=[0, 100]%, ratio=null',
    `flatCh1AllMid=${flatCh1AllMid}, ch1IsFlat=${dualFlatVsO2.autoScale.ch1IsFlat}, o2Norm=[${o2MinNorm},${o2MaxNorm}]%, ratio=${dualFlatVsO2.autoScale.amplitudeRatio}`
  );
}

// ==========================================
// 7. BINARY STATE MONITOR (PWM & CAN DECODER) TESTS
// ==========================================
function testBinaryStateMonitor() {
  const healthyPsu: PowerSupplyState = {
    voltageSetting: 12.6,
    currentLimit: 5.0,
    isOutputEnabled: true,
    preset: '12V_BENCH',
  };
  const dmmDummy: MultimeterState = {
    mode: 'V_DC',
    redProbe: { attachedToPinId: 'ecu-pin-10', attachedLabel: 'INJ_1 (Pin 10)' },
    blackProbe: { attachedToPinId: 'chassis-gnd', attachedLabel: 'Chassis GND' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  };
  const baseSolution = solveCircuit(
    healthyPsu,
    DEFAULT_ECU_PINS,
    [],
    DEFAULT_WIRES,
    DEFAULT_BENCH_COMPONENTS,
    dmmDummy
  );

  // 7.1: INJ_1 PWM Detection & RPM-Proportional Duty Cycle Scaling
  const inj850 = analyzePinBinaryState({
    pinId: 'ecu-pin-10',
    pinLabel: 'INJ_1',
    pinNumber: 10,
    mnaNodeVoltage: baseSolution.nodeVoltages['ecu-pin-10'] ?? 12.6,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 850,
    tStartSec: 0.42,
    windowMs: 100,
  });
  const inj3000 = analyzePinBinaryState({
    pinId: 'ecu-pin-10',
    pinLabel: 'INJ_1',
    pinNumber: 10,
    mnaNodeVoltage: baseSolution.nodeVoltages['ecu-pin-10'] ?? 12.6,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 3000,
    tStartSec: 0.42,
    windowMs: 100,
  });

  assert(
    'INJ_1 Binary Monitor Detects Active-Low PWM & Physical RPM Duty Cycle Scaling',
    'Binary State Monitor',
    inj850.detectedProtocol === 'PWM_ACTUATOR' &&
      inj850.metrics.activePolarity === 'ACTIVE_LOW' &&
      inj850.metrics.edgeCount >= 2 &&
      inj850.metrics.pulseWidthMs >= 2.2 &&
      inj850.metrics.pulseWidthMs <= 2.8 &&
      Math.abs(inj850.metrics.frequencyHz - 850 / 60) <= 1.5 &&
      inj850.metrics.dutyCyclePct >= 2.0 &&
      inj850.metrics.dutyCyclePct <= 6.0 &&
      inj3000.metrics.dutyCyclePct >= inj850.metrics.dutyCyclePct * 2.2 &&
      inj3000.metrics.frequencyHz >= 45 &&
      (inj850.metrics.flybackPeakV ?? 0) > 25,
    'PWM_ACTUATOR, ~2.5ms pulse, ~14.2Hz & ~3.5% @ 850 RPM, ~50Hz & >10% @ 3000 RPM, flyback > 25V',
    `proto=${inj850.detectedProtocol}, pw=${inj850.metrics.pulseWidthMs}ms, f850=${inj850.metrics.frequencyHz}Hz, duty850=${inj850.metrics.dutyCyclePct}%, duty3000=${inj3000.metrics.dutyCyclePct}%, f3000=${inj3000.metrics.frequencyHz}Hz, flyback=${inj850.metrics.flybackPeakV}V`
  );

  // 7.2: IGN_1 5V Logic Dwell Trigger Detection
  const ign1200 = analyzePinBinaryState({
    pinId: 'ecu-pin-11',
    pinLabel: 'IGN_1',
    pinNumber: 11,
    mnaNodeVoltage: baseSolution.nodeVoltages['ecu-pin-11'] ?? 0,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
    windowMs: 120,
  });
  assert(
    'IGN_1 Binary Monitor Detects 5V Logic Coil Dwell Trigger',
    'Binary State Monitor',
    ign1200.detectedProtocol === 'LOGIC_PULSE' &&
      ign1200.metrics.activePolarity === 'ACTIVE_HIGH' &&
      ign1200.metrics.edgeCount >= 4 &&
      ign1200.metrics.pulseWidthMs >= 2.5 &&
      ign1200.metrics.pulseWidthMs <= 3.5 &&
      Math.abs(ign1200.metrics.frequencyHz - 20) <= 1.0,
    'LOGIC_PULSE, ~3.0ms pulse @ 20 Hz (1200 RPM)',
    `proto=${ign1200.detectedProtocol}, pw=${ign1200.metrics.pulseWidthMs}ms, f=${ign1200.metrics.frequencyHz}Hz, edges=${ign1200.metrics.edgeCount}`
  );

  // 7.3: CAN_H ISO 11898 Differential Frame Pattern Decoding
  const canHealthy = analyzePinBinaryState({
    pinId: 'ecu-pin-13',
    pinLabel: 'CAN_H',
    pinNumber: 13,
    mnaNodeVoltage: baseSolution.nodeVoltages['ecu-pin-13'] ?? 2.5,
    companionMnaVoltage: baseSolution.nodeVoltages['ecu-pin-14'] ?? 2.5,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
  });
  assert(
    'CAN_H Binary Monitor Decodes ISO 11898 Differential Bitstream & Frame Summary',
    'Binary State Monitor',
    canHealthy.detectedProtocol === 'CAN_BUS' &&
      canHealthy.samples.length === 48 &&
      canHealthy.bitString.length === 48 &&
      canHealthy.hexBytes.length === 6 &&
      canHealthy.canFrameSummary !== null &&
      canHealthy.canFrameSummary.health === 'ACTIVE_500KBPS' &&
      canHealthy.canFrameSummary.vDiffMax >= 1.9 &&
      canHealthy.canFrameSummary.dominantPct > 10 &&
      canHealthy.canFrameSummary.recessivePct > 10 &&
      canHealthy.canFrameSummary.sofDetected === true,
    'CAN_BUS, 48 bits, 6 hex bytes, Vdiff>=1.9V, SOF detected',
    `proto=${canHealthy.detectedProtocol}, bits=${canHealthy.bitString.length}, bytes=${canHealthy.hexBytes.length}, vDiffMax=${canHealthy.canFrameSummary?.vDiffMax}V, dom=${canHealthy.canFrameSummary?.dominantPct}%, sof=${canHealthy.canFrameSummary?.sofDetected}`
  );

  // 7.4: CAN_H Fault Collapse (SHORT_TO_GND / hasCanFault)
  const canFaultSol = solveCircuit(
    healthyPsu,
    DEFAULT_ECU_PINS,
    [{ pinId: 'ecu-pin-13', faultType: 'SHORT_TO_GND', description: 'CAN_H short to GND', timestamp: Date.now() }],
    DEFAULT_WIRES,
    DEFAULT_BENCH_COMPONENTS,
    dmmDummy
  );
  const canFaulted = analyzePinBinaryState({
    pinId: 'ecu-pin-13',
    pinLabel: 'CAN_H',
    pinNumber: 13,
    mnaNodeVoltage: canFaultSol.nodeVoltages['ecu-pin-13'] ?? 0,
    companionMnaVoltage: canFaultSol.nodeVoltages['ecu-pin-14'] ?? 2.5,
    faultType: 'SHORT_TO_GND',
    isPowerOn: true,
    hasCanFault: true,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 1200,
    tStartSec: 0,
  });
  assert(
    'CAN Bus Short-to-GND Fault Collapses Differential Traffic to BUS_FAULT_COLLAPSED',
    'Binary State Monitor',
    canFaulted.detectedProtocol === 'FAULT_OR_OFF' &&
      canFaulted.canFrameSummary?.health === 'BUS_FAULT_COLLAPSED' &&
      canFaulted.canFrameSummary?.dominantPct === 0,
    'FAULT_OR_OFF, BUS_FAULT_COLLAPSED, dominantPct=0',
    `proto=${canFaulted.detectedProtocol}, health=${canFaulted.canFrameSummary?.health}, dom=${canFaulted.canFrameSummary?.dominantPct}%`
  );

  // 7.5: Static DC Analog Pin (TPS_SIG) vs Regulated 5V Rail (VREF_5V) + PSU OFF
  const tpsStatic = analyzePinBinaryState({
    pinId: 'ecu-pin-7',
    pinLabel: 'TPS_SIG',
    pinNumber: 7,
    mnaNodeVoltage: baseSolution.nodeVoltages['ecu-pin-7'] ?? 0.68,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 850,
    tStartSec: 0,
  });
  const vrefHigh = analyzePinBinaryState({
    pinId: 'ecu-pin-5',
    pinLabel: 'VREF_5V',
    pinNumber: 5,
    mnaNodeVoltage: baseSolution.nodeVoltages['ecu-pin-5'] ?? 5.0,
    isPowerOn: true,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 850,
    tStartSec: 0,
  });
  const psuOffCan = analyzePinBinaryState({
    pinId: 'ecu-pin-13',
    pinLabel: 'CAN_H',
    pinNumber: 13,
    mnaNodeVoltage: 0,
    companionMnaVoltage: 0,
    isPowerOn: false,
    hasCanFault: false,
    hasInjectorFault: false,
    isInjectorFiring: true,
    rpm: 850,
    tStartSec: 0,
  });
  assert(
    'Static DC Pins Report 0 Edges & PSU OFF Halts CAN Frame Decoding',
    'Binary State Monitor',
    tpsStatic.detectedProtocol === 'STATIC_LEVEL' &&
      tpsStatic.metrics.edgeCount === 0 &&
      tpsStatic.metrics.currentLogicLevel === 0 &&
      vrefHigh.detectedProtocol === 'STATIC_LEVEL' &&
      vrefHigh.metrics.currentLogicLevel === 1 &&
      vrefHigh.metrics.dutyCyclePct === 100 &&
      psuOffCan.detectedProtocol === 'FAULT_OR_OFF' &&
      psuOffCan.canFrameSummary?.health === 'POWER_OFF',
    'TPS static 0 edges (LOW), VREF static 100% (HIGH), PSU OFF CAN -> POWER_OFF',
    `tps=${tpsStatic.detectedProtocol}/${tpsStatic.metrics.edgeCount}/${tpsStatic.metrics.currentLogicLevel}, vref=${vrefHigh.metrics.dutyCyclePct}%/${vrefHigh.metrics.currentLogicLevel}, off=${psuOffCan.canFrameSummary?.health}`
  );
}

// ==========================================
// RUNNER & REPORTING
// ==========================================
export function runAllTests(): { passed: number; failed: number; total: number; results: TestResult[] } {
  testResults.length = 0;

  try {
    testMatrixSolver();
    testOhmsLawAndNetwork();
    testAutomotiveModels();
    testFaultInjection();
    testMultimeterModes();
    testOscilloscopeSignals();
    testBinaryStateMonitor();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    testResults.push({
      name: 'Test Execution Exception',
      category: 'Runner',
      passed: false,
      expected: 'Clean Execution',
      actual: msg,
    });
  }

  const passed = testResults.filter(r => r.passed).length;
  const failed = testResults.filter(r => !r.passed).length;

  console.log('====================================================');
  console.log(`AUTOTECH LAB TEST SUITE RESULTS: ${passed}/${testResults.length} PASSED`);
  console.log('====================================================');
  testResults.forEach(r => {
    const symbol = r.passed ? '✓ [PASS]' : '✗ [FAIL]';
    console.log(`${symbol} [${r.category}] ${r.name}`);
    if (!r.passed) {
      console.log(`    Expected: ${r.expected}`);
      console.log(`    Actual:   ${r.actual}`);
    }
  });

  return { passed, failed, total: testResults.length, results: testResults };
}

// Allow direct execution via tsx
if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('circuitEngine.test.ts')) {
  const result = runAllTests();
  process.exit(result.failed > 0 ? 1 : 0);
}
