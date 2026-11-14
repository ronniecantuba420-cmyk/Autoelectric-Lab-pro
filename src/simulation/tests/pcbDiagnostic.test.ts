import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolvePcbNetToMnaNode,
  computePcbThermalMap,
  measureDualProbePcb,
  auditPcbDiagnostics,
  computeComponentPinCoords,
  computeContinuousTracePath,
  convertOemProfileToPcbBoard,
  type ExtendedImageAnalysisNet,
  type ProbeNodeTarget,
} from '../pcb/PcbDiagnosticEngine';
import type { ImageAnalysisComponent, ImageAnalysisHotspot } from '../../server/services/imageAnalysisTypes';
import type { InjectedFault, PowerSupplyState } from '../../types/ecu';
import { ECU_BRAND_PROFILES } from '../../components/ecuPinoutData';
import { VERIFIED_VOICE_ECU_GUIDES } from '../../utils/oemKnowledgeDatabase';
import { parseAndExecuteVoiceCommand } from '../../utils/voiceCommandParser';
import { OfflineDiagnosticChatbot } from '../../services/offlineChatbotEngine';

const PSU_ON: PowerSupplyState = {
  voltageSetting: 12.6,
  currentLimit: 5.0,
  isOutputEnabled: true,
  preset: '12V_BENCH',
};

const PSU_OFF: PowerSupplyState = {
  voltageSetting: 12.6,
  currentLimit: 5.0,
  isOutputEnabled: false,
  preset: '12V_BENCH',
};

const BASE_NODE_VOLTAGES: Record<string, number> = {
  'bench-vbat': 12.6,
  'ecu-pin-1': 0.0,
  'ecu-pin-3': 12.6,
  'ecu-pin-5': 5.0,
  'ecu-pin-6': 2.1,
  'ecu-pin-8': 1.8,
  'ecu-pin-10': 12.4,
  'ecu-pin-11': 0.15,
  'ecu-pin-13': 2.55,
  'ecu-pin-14': 2.45,
  'ecu-pin-15': 0.45,
  'ecu-pin-16': 2.5,
};

const SAMPLE_LDO_BOARD_COMPS: ImageAnalysisComponent[] = [
  {
    refDes: 'U1',
    category: 'VOLTAGE_REGULATOR',
    marking: 'TLE4275G',
    decodedValue: '5.0V ±2% / 450mA Automotive LDO',
    packageType: 'TO-263-5',
    bbox: { ymin: 333, xmin: 333, ymax: 667, xmax: 583 },
    confidenceScore: 0.98,
    verificationStatus: 'VERIFIED',
    circuitFunction: 'Main +5V Logic Regulator',
    terminalIds: ['U1-1', 'U1-3', 'U1-5'],
    notes: 'LDO',
    source: 'MANUAL',
    pinSpecs: [
      {
        pinNumber: 1,
        pinName: 'VIN',
        category: 'power',
        nominalVoltage: 12.25,
        connectedNetId: 'NET_KL30_VBAT',
        notes: 'Protected VBAT',
      },
      {
        pinNumber: 3,
        pinName: 'GND',
        category: 'ground',
        nominalVoltage: 0.0,
        connectedNetId: 'NET_CHASSIS_GND',
        notes: 'Ground',
      },
      {
        pinNumber: 5,
        pinName: 'VOUT',
        category: 'power',
        nominalVoltage: 5.0,
        connectedNetId: 'NET_5V_REGULATED',
        notes: '+5V Output',
      },
    ],
  },
  {
    refDes: 'D1',
    category: 'DIODE',
    marking: 'B540C',
    decodedValue: '40V / 5A Schottky Barrier Diode',
    packageType: 'SMC',
    bbox: { ymin: 150, xmin: 150, ymax: 260, xmax: 270 },
    confidenceScore: 0.96,
    verificationStatus: 'VERIFIED',
    circuitFunction: 'Reverse Polarity Protection',
    terminalIds: ['D1-1', 'D1-2'],
    notes: 'Schottky',
    source: 'MANUAL',
    pinSpecs: [
      {
        pinNumber: 1,
        pinName: 'A',
        category: 'power',
        nominalVoltage: 12.6,
        connectedNetId: 'NET_RAW_KL30',
        notes: 'Anode',
      },
      {
        pinNumber: 2,
        pinName: 'K',
        category: 'power',
        nominalVoltage: 12.25,
        connectedNetId: 'NET_KL30_VBAT',
        notes: 'Cathode',
      },
    ],
  },
  {
    refDes: 'TVS1',
    category: 'TVS_DIODE',
    marking: 'SMBJ24CA',
    decodedValue: '24V Bidirectional Load-Dump TVS',
    packageType: 'SMB',
    bbox: { ymin: 150, xmin: 600, ymax: 260, xmax: 720 },
    confidenceScore: 0.96,
    verificationStatus: 'VERIFIED',
    circuitFunction: 'ISO 7637-2 Load Dump Clamp',
    terminalIds: ['TVS1-1', 'TVS1-2'],
    notes: 'TVS',
    source: 'MANUAL',
    pinSpecs: [
      {
        pinNumber: 1,
        pinName: 'K1',
        category: 'power',
        nominalVoltage: 12.25,
        connectedNetId: 'NET_KL30_VBAT',
        notes: 'Clamp top',
      },
      {
        pinNumber: 2,
        pinName: 'K2',
        category: 'ground',
        nominalVoltage: 0.0,
        connectedNetId: 'NET_CHASSIS_GND',
        notes: 'Ground',
      },
    ],
  },
];

const SAMPLE_NETS: ExtendedImageAnalysisNet[] = [
  {
    name: 'NET_KL30_VBAT',
    signalType: 'BATTERY_POWER',
    nominalVoltage: 12.25,
    impedanceOhms: 0.02,
    connectedComponentRefs: ['D1', 'TVS1', 'U1'],
    connectedTerminalIds: ['D1-2', 'TVS1-1', 'U1-1'],
    tracePoints: [
      { x: 270, y: 205 },
      { x: 333, y: 400 },
    ],
    confidenceScore: 0.97,
    verificationStatus: 'VERIFIED',
    isComplete: true,
  },
  {
    name: 'NET_5V_REGULATED',
    signalType: '5V_LOGIC',
    nominalVoltage: 5.0,
    impedanceOhms: 0.05,
    connectedComponentRefs: ['U1'],
    connectedTerminalIds: ['U1-5'],
    tracePoints: [
      { x: 333, y: 600 },
      { x: 750, y: 600 },
    ],
    confidenceScore: 0.98,
    verificationStatus: 'VERIFIED',
    isComplete: true,
  },
  {
    name: 'NET_CHASSIS_GND',
    signalType: 'GROUND',
    nominalVoltage: 0.0,
    impedanceOhms: 0.01,
    connectedComponentRefs: ['U1', 'TVS1'],
    connectedTerminalIds: ['U1-3', 'TVS1-2'],
    tracePoints: [
      { x: 333, y: 500 },
      { x: 660, y: 260 },
    ],
    confidenceScore: 0.99,
    verificationStatus: 'VERIFIED',
    isComplete: true,
  },
];

describe('PcbDiagnosticEngine — Deterministic MNA, Electro-Thermal & Probe Suite', () => {
  it('resolves PCB nets strictly from MNA node voltages and PSU output state', () => {
    const v5 = resolvePcbNetToMnaNode('NET_5V_REGULATED', 5.0, BASE_NODE_VOLTAGES, PSU_ON);
    assert.equal(v5.voltage, 5.0);
    assert.equal(v5.simPinId, 'ecu-pin-5');

    const vKl30 = resolvePcbNetToMnaNode('NET_KL30_VBAT', 12.0, BASE_NODE_VOLTAGES, PSU_ON);
    assert.ok(Math.abs(vKl30.voltage - 12.25) < 0.001, 'Should subtract 0.35V D1 Schottky drop from KL30');

    const vSplit = resolvePcbNetToMnaNode('NET_CAN_SPLIT', 2.5, BASE_NODE_VOLTAGES, PSU_ON);
    assert.equal(vSplit.voltage, 2.5);

    const vTps = resolvePcbNetToMnaNode('NET_TPS_SIG', 1.3, { ...BASE_NODE_VOLTAGES, 'ecu-pin-7': 1.28, 'ecu-pin-6': 0.0 }, PSU_ON);
    assert.equal(vTps.voltage, 1.28);
    assert.equal(vTps.simPinId, 'ecu-pin-7');

    const vSgnd = resolvePcbNetToMnaNode('NET_SGND', 0.0, { ...BASE_NODE_VOLTAGES, 'ecu-pin-6': 0.01 }, PSU_ON);
    assert.equal(vSgnd.voltage, 0.01);
    assert.equal(vSgnd.simPinId, 'ecu-pin-6');

    const vFp = resolvePcbNetToMnaNode('NET_FP_RELAY', 12.5, { ...BASE_NODE_VOLTAGES, 'ecu-pin-16': 12.49 }, PSU_ON);
    assert.equal(vFp.voltage, 12.49);
    assert.equal(vFp.simPinId, 'ecu-pin-16');

    const vOff = resolvePcbNetToMnaNode('NET_5V_REGULATED', 5.0, BASE_NODE_VOLTAGES, PSU_OFF);
    assert.equal(vOff.voltage, 0.0);
  });

  it('computes realistic electro-thermal temperatures & correlates active MNA faults', () => {
    const nominalMap = computePcbThermalMap({
      components: SAMPLE_LDO_BOARD_COMPS,
      powerSupply: PSU_ON,
      supplyCurrentDrawAmps: 0.25,
      nodeVoltages: BASE_NODE_VOLTAGES,
      faults: [],
      ambientTempC: 25,
    });

    assert.equal(nominalMap.U1.faultLinked, false);
    assert.ok(nominalMap.U1.tempC > 60 && nominalMap.U1.tempC < 110, `U1 nominal temp ${nominalMap.U1.tempC}`);
    assert.ok(nominalMap.TVS1.tempC < 26, 'TVS1 must stay cold below 26.7V standoff');

    const shortFaults: InjectedFault[] = [
      { pinId: 'ecu-pin-5', faultType: 'SHORT_TO_GND', description: 'VREF_5V Short to GND', timestamp: 1 },
    ];
    const faultMap = computePcbThermalMap({
      components: SAMPLE_LDO_BOARD_COMPS,
      powerSupply: PSU_ON,
      supplyCurrentDrawAmps: 0.9,
      nodeVoltages: { ...BASE_NODE_VOLTAGES, 'ecu-pin-5': 0.05 },
      faults: shortFaults,
      ambientTempC: 25,
    });

    assert.equal(faultMap.U1.faultLinked, true);
    assert.equal(faultMap.U1.status, 'CRITICAL_OVERHEAT');
    assert.ok(faultMap.U1.tempC >= 115, `U1 should enter critical thermal foldback: ${faultMap.U1.tempC}`);

    // Overvoltage load dump activates TVS1 avalanche clamping
    const loadDumpMap = computePcbThermalMap({
      components: SAMPLE_LDO_BOARD_COMPS,
      powerSupply: { ...PSU_ON, voltageSetting: 32.0 },
      supplyCurrentDrawAmps: 3.5,
      nodeVoltages: { ...BASE_NODE_VOLTAGES, 'bench-vbat': 32.0, 'ecu-pin-3': 32.0 },
      faults: [],
      ambientTempC: 25,
    });
    assert.ok(loadDumpMap.TVS1.tempC > 100, 'TVS1 must heat up during 32V load-dump clamping');

    // Power off returns to ambient
    const offMap = computePcbThermalMap({
      components: SAMPLE_LDO_BOARD_COMPS,
      powerSupply: PSU_OFF,
      ambientTempC: 25,
    });
    assert.equal(offMap.U1.tempC, 25);
    assert.equal(offMap.U1.powerDissipationMw, 0);
  });

  it('measures dual-probe differential voltage, continuity, dead shorts, Schottky Vf & CAN termination', () => {
    const probe5vA: ProbeNodeTarget = {
      label: 'U1 #5 (VOUT)',
      compRefDes: 'U1',
      pinNumber: 5,
      pinName: 'VOUT',
      netId: 'NET_5V_REGULATED',
      nominalVoltage: 5.0,
      xNorm: 333,
      yNorm: 600,
    };
    const probe5vB: ProbeNodeTarget = {
      label: 'NET_5V Node #2',
      netId: 'NET_5V_REGULATED',
      nominalVoltage: 5.0,
      xNorm: 750,
      yNorm: 600,
    };
    const probeGnd: ProbeNodeTarget = {
      label: 'U1 #3 (GND)',
      compRefDes: 'U1',
      pinNumber: 3,
      pinName: 'GND',
      netId: 'NET_CHASSIS_GND',
      nominalVoltage: 0.0,
      xNorm: 333,
      yNorm: 500,
    };

    // 1. Same-net copper continuity
    const contResult = measureDualProbePcb({
      probeA: probe5vA,
      probeB: probe5vB,
      components: SAMPLE_LDO_BOARD_COMPS,
      nets: SAMPLE_NETS,
      nodeVoltages: BASE_NODE_VOLTAGES,
      powerSupply: PSU_ON,
      faults: [],
    });
    assert.equal(contResult.continuityStatus, 'CONTINUOUS');
    assert.ok((contResult.estimatedOhms ?? 99) < 0.5);

    // 2. Open-circuit fault breaks same-net continuity
    const openResult = measureDualProbePcb({
      probeA: probe5vA,
      probeB: probe5vB,
      components: SAMPLE_LDO_BOARD_COMPS,
      nets: SAMPLE_NETS,
      nodeVoltages: BASE_NODE_VOLTAGES,
      powerSupply: PSU_ON,
      faults: [{ pinId: 'ecu-pin-5', faultType: 'OPEN_CIRCUIT', description: 'Open 5V', timestamp: 1 }],
    });
    assert.equal(openResult.continuityStatus, 'OPEN_OL');

    // 3. Dead short to GND across 5V rail & GND probe
    const shortResult = measureDualProbePcb({
      probeA: probe5vA,
      probeB: probeGnd,
      components: SAMPLE_LDO_BOARD_COMPS,
      nets: SAMPLE_NETS,
      nodeVoltages: { ...BASE_NODE_VOLTAGES, 'ecu-pin-5': 0.0 },
      powerSupply: PSU_ON,
      faults: [{ pinId: 'ecu-pin-5', faultType: 'SHORT_TO_GND', description: '5V Short', timestamp: 1 }],
    });
    assert.equal(shortResult.continuityStatus, 'SHORT_FAULT');
    assert.equal(shortResult.estimatedOhms, 0.12);

    // 4. Schottky diode forward vs reverse check
    const diodeA: ProbeNodeTarget = {
      label: 'D1 #1 (A)',
      compRefDes: 'D1',
      pinNumber: 1,
      netId: 'NET_RAW_KL30',
      nominalVoltage: 12.6,
      xNorm: 150,
      yNorm: 205,
    };
    const diodeK: ProbeNodeTarget = {
      label: 'D1 #2 (K)',
      compRefDes: 'D1',
      pinNumber: 2,
      netId: 'NET_KL30_VBAT',
      nominalVoltage: 12.25,
      xNorm: 270,
      yNorm: 205,
    };
    const fwdDiode = measureDualProbePcb({
      probeA: diodeA,
      probeB: diodeK,
      components: SAMPLE_LDO_BOARD_COMPS,
      nets: SAMPLE_NETS,
      nodeVoltages: BASE_NODE_VOLTAGES,
      powerSupply: PSU_ON,
      faults: [],
    });
    assert.equal(fwdDiode.continuityStatus, 'DIODE_JUNCTION');
    assert.equal(fwdDiode.diodeDropVolts, 0.35);

    const revDiode = measureDualProbePcb({
      probeA: diodeK,
      probeB: diodeA,
      components: SAMPLE_LDO_BOARD_COMPS,
      nets: SAMPLE_NETS,
      nodeVoltages: BASE_NODE_VOLTAGES,
      powerSupply: PSU_ON,
      faults: [],
    });
    assert.equal(revDiode.continuityStatus, 'OPEN_OL');

    // 5. CAN differential bus healthy (60.2 Ω) vs open terminator (120.8 Ω)
    const canH: ProbeNodeTarget = {
      label: 'U2 #7 (CANH)',
      netId: 'NET_CAN_HIGH',
      nominalVoltage: 2.55,
      xNorm: 500,
      yNorm: 400,
    };
    const canL: ProbeNodeTarget = {
      label: 'U2 #6 (CANL)',
      netId: 'NET_CAN_LOW',
      nominalVoltage: 2.45,
      xNorm: 500,
      yNorm: 450,
    };
    const healthyCan = measureDualProbePcb({
      probeA: canH,
      probeB: canL,
      components: [],
      nets: [],
      nodeVoltages: BASE_NODE_VOLTAGES,
      powerSupply: PSU_ON,
      faults: [],
    });
    assert.equal(healthyCan.estimatedOhms, 60.2);

    const openCan = measureDualProbePcb({
      probeA: canH,
      probeB: canL,
      components: [],
      nets: [],
      nodeVoltages: BASE_NODE_VOLTAGES,
      powerSupply: PSU_ON,
      faults: [{ pinId: 'ecu-pin-13', faultType: 'OPEN_CIRCUIT', description: 'CANH Open', timestamp: 1 }],
    });
    assert.equal(openCan.estimatedOhms, 120.8);
  });

  it('audits MNA deviations, thermal runaway, unassigned pins & unrouted nets in priority order', () => {
    const faultedVoltages = { ...BASE_NODE_VOLTAGES, 'ecu-pin-5': 0.1 };
    const faults: InjectedFault[] = [
      { pinId: 'ecu-pin-5', faultType: 'SHORT_TO_GND', description: '5V Short', timestamp: 1 },
    ];
    const thermalMap = computePcbThermalMap({
      components: SAMPLE_LDO_BOARD_COMPS,
      powerSupply: PSU_ON,
      supplyCurrentDrawAmps: 0.9,
      nodeVoltages: faultedVoltages,
      faults,
      ambientTempC: 25,
    });
    const extraComps: ImageAnalysisComponent[] = [
      ...SAMPLE_LDO_BOARD_COMPS,
      {
        refDes: 'TP1',
        category: 'TEST_POINT',
        marking: 'TP1',
        decodedValue: 'Test Pad',
        packageType: 'SMD',
        bbox: { ymin: 700, xmin: 700, ymax: 760, xmax: 760 },
        confidenceScore: 1,
        verificationStatus: 'UNVERIFIED',
        circuitFunction: 'Floating',
        terminalIds: ['TP1-1'],
        notes: 'Floating',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'PAD',
            category: 'signal_in',
            nominalVoltage: 5,
            connectedNetId: 'NET_UNASSIGNED',
            notes: 'Unassigned',
          },
        ],
      },
    ];
    const extraNets: ExtendedImageAnalysisNet[] = [
      ...SAMPLE_NETS,
      {
        name: 'NET_SINGLE_NODE',
        signalType: 'SIGNAL_TRACE',
        connectedComponentRefs: ['TP1'],
        connectedTerminalIds: ['TP1-1'],
        tracePoints: [{ x: 730, y: 730 }],
        confidenceScore: 0.9,
        verificationStatus: 'UNVERIFIED',
        isComplete: false,
      },
    ];
    const hotspots: ImageAnalysisHotspot[] = [
      {
        id: 'hs1',
        label: 'LDO Solder Stress',
        severity: 'WARNING',
        bbox: { ymin: 330, xmin: 330, ymax: 670, xmax: 590 },
        suspectComponentRef: 'U1',
        notes: 'Inspect reflow fillet',
        source: 'AI',
      },
    ];

    const findings = auditPcbDiagnostics({
      components: extraComps,
      nets: extraNets,
      hotspots,
      thermalMap,
      nodeVoltages: faultedVoltages,
      powerSupply: PSU_ON,
      faults,
    });

    assert.ok(findings.some((f) => f.category === 'THERMAL' && f.severity === 'CRITICAL'));
    assert.ok(findings.some((f) => f.category === 'MNA_VOLTAGE' && f.targetNetId === 'NET_5V_REGULATED'));
    assert.ok(findings.some((f) => f.id === 'erc-unassigned-pins' && f.severity === 'WARNING'));
    assert.ok(findings.some((f) => f.id === 'erc-unrouted-NET_SINGLE_NODE' && f.severity === 'INFO'));
    assert.equal(findings[0].severity, 'CRITICAL');
  });

  it('converts OEM ECU profiles to MNA-mapped PCB boards and computes continuous BFS trace paths', () => {
    const toyota = ECU_BRAND_PROFILES.find((p) => p.id === 'toyota-denso-175822');
    assert.ok(toyota, 'Toyota Denso OEM profile should exist');

    const oemBoard = convertOemProfileToPcbBoard(toyota);
    assert.ok(oemBoard.imageSrc && oemBoard.imageSrc.length > 0);
    assert.ok(oemBoard.components.length >= 4);
    for (const c of oemBoard.components) {
      assert.ok(c.bbox.xmin >= 0 && c.bbox.xmax <= 1000 && c.bbox.xmin < c.bbox.xmax);
      assert.ok(c.bbox.ymin >= 0 && c.bbox.ymax <= 1000 && c.bbox.ymin < c.bbox.ymax);
    }

    const pt = computeComponentPinCoords(SAMPLE_LDO_BOARD_COMPS[0], 0, 3);
    assert.equal(pt.x, 333);

    const tracePath = computeContinuousTracePath({
      tracePathPair: ['D1', 'U1'],
      hoveredNode: {
        nodeLabel: 'U1 #1 (VIN)',
        netId: 'NET_KL30_VBAT',
        xNorm: 333,
        yNorm: 400,
      },
      components: SAMPLE_LDO_BOARD_COMPS,
      nets: SAMPLE_NETS,
    });
    assert.ok(tracePath, 'Trace path between D1 and U1 over NET_KL30_VBAT should resolve');
    assert.equal(tracePath!.isNetVerified, true);
    assert.ok(tracePath!.traversedNets.includes('NET_KL30_VBAT'));
  });

  it('verifies all 10 Ford OEM pinouts in ECU Pinout Library, Voice Command Parser & Offline AI Chatbot', () => {
    const fordProfile = ECU_BRAND_PROFILES.find((p) => p.id === 'ford-fomoco-sid208');
    assert.ok(fordProfile, 'Ford FoMoCo ECU profile must exist');

    const expectedPinCodes = [
      'C1E148', 'C1E142', 'C1E139', 'C1E140',
      'CBR-1', 'CBR-3', 'CBR-2', 'CBR-4',
      'EF15-P1', 'EF15-P2', 'EF15-P3', 'EF15-P4',
      'GDI-P61', 'GDI-P16', 'GDI-P32',
      'TCM-P1', 'TCM-P2', 'TCM-P3', 'TCM-P4', 'TCM-P5',
      'TERR-P8', 'TERR-P9', 'TERR-P10', 'TERR-P11',
      'R25-P1', 'R25-P2', 'R25-P3', 'R25-P4',
      'DUR-P15', 'DUR-P6', 'DUR-P61',
      'EXP-P103', 'EXP-P105', 'EXP-P116',
      'TR-B20', 'TR-B22', 'TR-B23', 'TR-B24',
    ];
    for (const code of expectedPinCodes) {
      assert.ok(
        fordProfile!.pinouts.some((p) => p.pinCode === code),
        `Ford profile must contain pinCode ${code}`
      );
    }

    assert.equal(
      VERIFIED_VOICE_ECU_GUIDES.filter((g) => g.brandKey === 'ford').length >= 11,
      true,
      'Must include SID209 + all 10 new Ford OEM voice guides'
    );

    const dummyActions = {
      setVoltage: () => {},
      resetLab: () => {},
      attachProbeToPin: () => {},
      setPowerSupplyOutput: () => {},
      switchTab: () => {},
    };

    const t6Voice = parseAndExecuteVoiceCommand('Ranger and Everest T6 pinout', [], dummyActions);
    assert.equal(t6Voice.matched, true);
    assert.ok(t6Voice.spokenReply.includes('C1E148') && t6Voice.spokenReply.includes('C1E142'));

    const ecoBlueVoice = parseAndExecuteVoiceCommand('Next-Gen Ranger EcoBlue pinout', [], dummyActions);
    assert.equal(ecoBlueVoice.matched, true);
    assert.ok(ecoBlueVoice.spokenReply.includes('CBR pin 1') && ecoBlueVoice.spokenReply.includes('CBR pin 3'));

    const ecoSport15Voice = parseAndExecuteVoiceCommand('EcoSport and Fiesta 1.5L pinout', [], dummyActions);
    assert.equal(ecoSport15Voice.matched, true);
    assert.ok(ecoSport15Voice.spokenReply.includes('Pin 1') && ecoSport15Voice.spokenReply.includes('Pin 2'));

    const focusGdiVoice = parseAndExecuteVoiceCommand('Focus and EcoSport GDI pinout', [], dummyActions);
    assert.equal(focusGdiVoice.matched, true);
    assert.ok(focusGdiVoice.spokenReply.includes('Pin 61') && focusGdiVoice.spokenReply.includes('Pin 16'));

    const tcmVoice = parseAndExecuteVoiceCommand('PowerShift TCM pinout', [], dummyActions);
    assert.equal(tcmVoice.matched, true);
    assert.ok(tcmVoice.spokenReply.includes('Pins 1 and 2') && tcmVoice.spokenReply.includes('Pin 3'));

    const territoryVoice = parseAndExecuteVoiceCommand('Territory 1.5L EcoBoost pinout', [], dummyActions);
    assert.equal(territoryVoice.matched, true);
    assert.ok(territoryVoice.spokenReply.includes('Pin 8') && territoryVoice.spokenReply.includes('Pin 9'));

    const ranger25Voice = parseAndExecuteVoiceCommand('Ranger 2.5L NA pinout', [], dummyActions);
    assert.equal(ranger25Voice.matched, true);
    assert.ok(ranger25Voice.spokenReply.includes('Pin 1') && ranger25Voice.spokenReply.includes('Pin 2'));

    const escapeDuratecVoice = parseAndExecuteVoiceCommand('Older Escape Focus Duratec pinout', [], dummyActions);
    assert.equal(escapeDuratecVoice.matched, true);
    assert.ok(escapeDuratecVoice.spokenReply.includes('Pin 15') && escapeDuratecVoice.spokenReply.includes('Pin 6'));

    const explorerVoice = parseAndExecuteVoiceCommand('Ford Explorer pinout', [], dummyActions);
    assert.equal(explorerVoice.matched, true);
    assert.ok(explorerVoice.spokenReply.includes('Pin 103') && explorerVoice.spokenReply.includes('Pin 105'));

    const transitVoice = parseAndExecuteVoiceCommand('Transit 2.2L TDCi pinout', [], dummyActions);
    assert.equal(transitVoice.matched, true);
    assert.ok(transitVoice.spokenReply.includes('Pin B20') && transitVoice.spokenReply.includes('Pin B22'));

    const bot = new OfflineDiagnosticChatbot();
    const botReply = bot.ask('Ranger Everest T6 C1E148 PowerShift TCM Territory Explorer Transit B20 pinouts');
    assert.ok(botReply.answer.includes('C1E148'));
    assert.ok(botReply.answer.includes('B20'));
  });
});

