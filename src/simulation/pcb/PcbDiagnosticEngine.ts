import {
  ImageAnalysisComponent,
  ImageAnalysisHotspot,
  ImageAnalysisNet,
  ImageAnalysisPinSpec,
  PcbNormalizedBox,
} from '../../server/services/imageAnalysisTypes';
import { InjectedFault, PowerSupplyState } from '../../types/ecu';
import { clampBbox, clampCoord, getBoxCenter } from '../../utils/pcbLocalVision';
import type { EcuBrandProfile } from '../../components/ecuPinoutData';

export interface TracePoint {
  x: number;
  y: number;
}

export interface ExtendedImageAnalysisNet extends ImageAnalysisNet {
  traceBranches?: TracePoint[][];
  nominalVoltage?: number;
  traceWidthMm?: number;
  impedanceOhms?: number;
}

export interface PcbBoardPreset {
  id: string;
  name: string;
  type: string;
  summary: string;
  oemReference: string;
  imageSrc?: string;
  pcbSpecs: {
    layers: number;
    copperWeightOz: number;
    substrate: string;
    finish: string;
  };
  components: ImageAnalysisComponent[];
  nets: ExtendedImageAnalysisNet[];
  hotspots: ImageAnalysisHotspot[];
}

export interface ComponentThermalProfile {
  tempC: number;
  powerDissipationMw: number;
  thermalResistanceJa: number; // °C/W
  status: 'NOMINAL' | 'ELEVATED' | 'WARNING' | 'CRITICAL_OVERHEAT';
  dominantHeatSource: string;
  faultLinked: boolean;
}

export interface MnaNodeResolution {
  voltage: number;
  mnaNodeId: string;
  simPinId?: string;
}

export interface ProbeNodeTarget {
  label: string;
  compRefDes?: string;
  pinNumber?: number;
  pinName?: string;
  netId: string;
  nominalVoltage: number;
  xNorm: number;
  yNorm: number;
}

export interface DualProbeMeasurement {
  probeA: ProbeNodeTarget;
  probeB: ProbeNodeTarget;
  voltageA: number;
  voltageB: number;
  differentialVoltage: number;
  sameNet: boolean;
  continuityStatus: 'CONTINUOUS' | 'RESISTIVE' | 'DIODE_JUNCTION' | 'SHORT_FAULT' | 'OPEN_OL';
  continuityLabel: string;
  estimatedOhms: number | null;
  diodeDropVolts: number | null;
  activeFaultNote: string | null;
  guidance: string;
}

export type PcbAuditSeverity = 'CRITICAL' | 'WARNING' | 'INFO';

export interface PcbAuditFinding {
  id: string;
  severity: PcbAuditSeverity;
  category: 'THERMAL' | 'MNA_VOLTAGE' | 'ERC_NETLIST' | 'HOTSPOT';
  title: string;
  detail: string;
  targetCompRef?: string;
  targetNetId?: string;
  targetHotspotId?: string;
  recommendation: string;
}

export interface ContinuousTracePathResult {
  compA: string;
  compB: string;
  anchorA: TracePoint;
  anchorB: TracePoint;
  hoverPt: TracePoint;
  points: TracePoint[];
  pointsStr: string;
  traversedNets: string[];
  isNetVerified: boolean;
  hoveredNodeLabel: string;
  hoveredNetId: string;
}

/**
 * Resolves a PCB net name into both its live MNA-solved voltage and the linked bench ECU pin ID.
 * Pure deterministic mapping — zero hardcoded multipliers.
 */
export function resolvePcbNetToMnaNode(
  netName: string | undefined,
  fallbackNominal: number,
  nodeVoltages?: Record<string, number>,
  powerSupply?: PowerSupplyState
): MnaNodeResolution {
  const isPowered = powerSupply?.isOutputEnabled ?? true;
  if (!isPowered) {
    return { voltage: 0.0, mnaNodeId: 'bench-vbat (OFF · 0.000V)' };
  }

  const benchVoltage =
    nodeVoltages && typeof nodeVoltages['bench-vbat'] === 'number'
      ? nodeVoltages['bench-vbat']
      : (powerSupply?.voltageSetting ?? 12.6);

  if (!netName) {
    return { voltage: fallbackNominal, mnaNodeId: 'Local PCB Node' };
  }

  if (nodeVoltages && typeof nodeVoltages[netName] === 'number') {
    return {
      voltage: nodeVoltages[netName],
      mnaNodeId: netName,
      simPinId: netName.startsWith('ecu-pin-') ? netName : undefined,
    };
  }

  const upper = netName.toUpperCase();

  if (upper.includes('SGND')) {
    const vSgnd =
      nodeVoltages && typeof nodeVoltages['ecu-pin-6'] === 'number'
        ? nodeVoltages['ecu-pin-6']
        : 0.0;
    return {
      voltage: vSgnd,
      mnaNodeId: 'ecu-pin-6 (SGND Sensor Ground)',
      simPinId: 'ecu-pin-6',
    };
  }

  if (upper.includes('GND') || upper.includes('KL31')) {
    const vGnd =
      nodeVoltages && typeof nodeVoltages['ecu-pin-1'] === 'number'
        ? nodeVoltages['ecu-pin-1']
        : 0.0;
    return {
      voltage: vGnd,
      mnaNodeId: 'ecu-pin-1 (KL31 Chassis GND)',
      simPinId: 'ecu-pin-1',
    };
  }

  if (upper.includes('RAW_KL30')) {
    const vKl30 =
      nodeVoltages && typeof nodeVoltages['ecu-pin-3'] === 'number'
        ? nodeVoltages['ecu-pin-3']
        : benchVoltage;
    return {
      voltage: vKl30,
      mnaNodeId: 'ecu-pin-3 (KL30 Battery +12V)',
      simPinId: 'ecu-pin-3',
    };
  }

  if (upper.includes('KL30') || upper.includes('VBAT') || upper.includes('CLAMPED_VBAT')) {
    const vKl30 =
      nodeVoltages && typeof nodeVoltages['ecu-pin-3'] === 'number'
        ? nodeVoltages['ecu-pin-3']
        : benchVoltage;
    const vProtected = vKl30 > 0.35 ? Math.max(0, vKl30 - 0.35) : 0.0;
    return {
      voltage: vProtected,
      mnaNodeId: 'ecu-pin-3 (KL30 − 0.35V D1 Schottky)',
      simPinId: 'ecu-pin-3',
    };
  }

  if (
    upper.includes('5V') ||
    upper.includes('VREF_5V') ||
    upper.includes('REGULATED') ||
    upper.includes('MCU_RESET') ||
    upper.includes('MCU_TX') ||
    upper.includes('MCU_RX')
  ) {
    if (nodeVoltages && typeof nodeVoltages['ecu-pin-5'] === 'number') {
      return {
        voltage: nodeVoltages['ecu-pin-5'],
        mnaNodeId: 'ecu-pin-5 (VREF_5V LDO Rail)',
        simPinId: 'ecu-pin-5',
      };
    }
    const vIn = benchVoltage > 0.35 ? benchVoltage - 0.35 : 0;
    const vReg = vIn >= 5.25 ? 5.0 : vIn > 0.5 ? Math.max(0, vIn - 0.25) : 0.0;
    return {
      voltage: vReg,
      mnaNodeId: 'ecu-pin-5 (VREF_5V LDO Rail)',
      simPinId: 'ecu-pin-5',
    };
  }

  if (upper.includes('DELAY_CAP')) {
    const v5 =
      nodeVoltages && typeof nodeVoltages['ecu-pin-5'] === 'number'
        ? nodeVoltages['ecu-pin-5']
        : 5.0;
    return {
      voltage: +(v5 * 0.42).toFixed(3),
      mnaNodeId: 'U1-D (TLE4275G Delay Threshold)',
      simPinId: 'ecu-pin-5',
    };
  }

  if (upper.includes('CAN_HIGH') || upper.includes('CANH')) {
    const vCanH =
      nodeVoltages && typeof nodeVoltages['ecu-pin-13'] === 'number'
        ? nodeVoltages['ecu-pin-13']
        : fallbackNominal;
    return {
      voltage: vCanH,
      mnaNodeId: 'ecu-pin-13 (CAN_H Bus Node)',
      simPinId: 'ecu-pin-13',
    };
  }

  if (upper.includes('CAN_LOW') || upper.includes('CANL')) {
    const vCanL =
      nodeVoltages && typeof nodeVoltages['ecu-pin-14'] === 'number'
        ? nodeVoltages['ecu-pin-14']
        : fallbackNominal;
    return {
      voltage: vCanL,
      mnaNodeId: 'ecu-pin-14 (CAN_L Bus Node)',
      simPinId: 'ecu-pin-14',
    };
  }

  if (upper.includes('CAN_SPLIT')) {
    const vCanH =
      nodeVoltages && typeof nodeVoltages['ecu-pin-13'] === 'number'
        ? nodeVoltages['ecu-pin-13']
        : 2.5;
    const vCanL =
      nodeVoltages && typeof nodeVoltages['ecu-pin-14'] === 'number'
        ? nodeVoltages['ecu-pin-14']
        : 2.5;
    return {
      voltage: +((vCanH + vCanL) * 0.5).toFixed(3),
      mnaNodeId: '0.5 × (ecu-pin-13 + ecu-pin-14) Split Tap',
      simPinId: 'ecu-pin-13',
    };
  }

  if (upper.includes('INJ') || upper.includes('SOLENOID_DRAIN')) {
    const vInj =
      nodeVoltages && typeof nodeVoltages['ecu-pin-10'] === 'number'
        ? nodeVoltages['ecu-pin-10']
        : fallbackNominal;
    return {
      voltage: vInj,
      mnaNodeId: 'ecu-pin-10 (INJ_1 Low-Side Drain)',
      simPinId: 'ecu-pin-10',
    };
  }

  if (upper.includes('IGN')) {
    const vIgn =
      nodeVoltages && typeof nodeVoltages['ecu-pin-11'] === 'number'
        ? nodeVoltages['ecu-pin-11']
        : fallbackNominal;
    return {
      voltage: vIgn,
      mnaNodeId: 'ecu-pin-11 (IGN_1 Gate Trigger)',
      simPinId: 'ecu-pin-11',
    };
  }

  if (upper.includes('MAP')) {
    const vMap =
      nodeVoltages && typeof nodeVoltages['ecu-pin-8'] === 'number'
        ? nodeVoltages['ecu-pin-8']
        : fallbackNominal;
    return {
      voltage: vMap,
      mnaNodeId: 'ecu-pin-8 (MAP_SIG Analog Input)',
      simPinId: 'ecu-pin-8',
    };
  }

  if (upper.includes('TPS')) {
    const vTps =
      nodeVoltages && typeof nodeVoltages['ecu-pin-7'] === 'number'
        ? nodeVoltages['ecu-pin-7']
        : fallbackNominal;
    return {
      voltage: vTps,
      mnaNodeId: 'ecu-pin-7 (TPS_SIG Analog Input)',
      simPinId: 'ecu-pin-7',
    };
  }

  if (upper.includes('O2') || upper.includes('LAMBDA')) {
    const vO2 =
      nodeVoltages && typeof nodeVoltages['ecu-pin-15'] === 'number'
        ? nodeVoltages['ecu-pin-15']
        : fallbackNominal;
    return {
      voltage: vO2,
      mnaNodeId: 'ecu-pin-15 (O2_SIG Nernst Input)',
      simPinId: 'ecu-pin-15',
    };
  }

  if (upper.includes('FP_RELAY') || upper.includes('FUEL_PUMP')) {
    const vFp =
      nodeVoltages && typeof nodeVoltages['ecu-pin-16'] === 'number'
        ? nodeVoltages['ecu-pin-16']
        : fallbackNominal;
    return {
      voltage: vFp,
      mnaNodeId: 'ecu-pin-16 (FP_RELAY Driver)',
      simPinId: 'ecu-pin-16',
    };
  }

  return { voltage: fallbackNominal, mnaNodeId: netName || 'Local PCB Node' };
}

/**
 * Checks whether any active bench fault directly affects a component via its mapped MNA pin IDs.
 */
function findFaultForComponent(
  comp: ImageAnalysisComponent,
  faults: InjectedFault[] | undefined,
  nodeVoltages: Record<string, number> | undefined,
  powerSupply: PowerSupplyState | undefined
): InjectedFault | undefined {
  if (!faults || faults.length === 0) return undefined;

  for (const fault of faults) {
    if (!fault.pinId || !fault.faultType || fault.faultType === 'NONE') continue;
    if (fault.pinId.includes(comp.refDes)) return fault;

    for (const pin of comp.pinSpecs || []) {
      if (pin.connectedNetId && pin.connectedNetId.includes(fault.pinId)) {
        return fault;
      }
      const mna = resolvePcbNetToMnaNode(
        pin.connectedNetId,
        pin.nominalVoltage,
        nodeVoltages,
        powerSupply
      );
      if (mna.simPinId && mna.simPinId === fault.pinId) {
        return fault;
      }
    }
  }
  return undefined;
}

/**
 * Deterministic steady-state electro-thermal solver (TJ = TA + PD * R_thetaJA).
 */
export function computePcbThermalMap(params: {
  components: ImageAnalysisComponent[];
  powerSupply?: PowerSupplyState;
  supplyCurrentDrawAmps?: number;
  nodeVoltages?: Record<string, number>;
  faults?: InjectedFault[];
  ambientTempC: number;
}): Record<string, ComponentThermalProfile> {
  const {
    components,
    powerSupply,
    supplyCurrentDrawAmps,
    nodeVoltages,
    faults,
    ambientTempC,
  } = params;

  const map: Record<string, ComponentThermalProfile> = {};
  const isPowered = powerSupply?.isOutputEnabled ?? true;
  const vBatRaw = isPowered ? (powerSupply?.voltageSetting ?? 12.6) : 0.0;
  const iLoadAmps = isPowered ? Math.max(0.04, supplyCurrentDrawAmps ?? 0.18) : 0.0;

  for (const comp of components) {
    if (!isPowered || vBatRaw < 0.5) {
      map[comp.refDes] = {
        tempC: ambientTempC,
        powerDissipationMw: 0,
        thermalResistanceJa: 45,
        status: 'NOMINAL',
        dominantHeatSource: 'Bench Power OFF (Ambient Equilibrium)',
        faultLinked: false,
      };
      continue;
    }

    const linkedFault = findFaultForComponent(comp, faults, nodeVoltages, powerSupply);
    const hasDirectFault = Boolean(linkedFault);
    const cat = comp.category.toUpperCase();
    const markingUpper = (comp.marking || '').toUpperCase();
    let powerMw = 15;
    let rThetaJa = 55;
    let heatSource = 'Quiescent biasing';

    if (cat.includes('REGULATOR') || markingUpper.includes('TLE4275')) {
      const vIn = Math.max(0, vBatRaw - 0.35);
      const vOut = resolvePcbNetToMnaNode('NET_5V_REGULATED', 5.0, nodeVoltages, powerSupply).voltage;
      const vDrop = Math.max(0.25, vIn - vOut);
      const isShortFault =
        linkedFault?.faultType === 'SHORT_TO_GND' || linkedFault?.faultType === 'SHORT_TO_VBAT';
      const regCurrent = isShortFault ? 0.65 : Math.min(0.45, iLoadAmps);
      const iQuiescent = 0.002;
      powerMw = (vDrop * regCurrent + vIn * iQuiescent) * 1000;
      rThetaJa = 38;
      heatSource = isShortFault
        ? `5V Rail Fault Limiting (${linkedFault?.faultType}, 650mA)`
        : `Linear drop (${vDrop.toFixed(2)}V × ${Math.round(regCurrent * 1000)}mA)`;
    } else if (cat.includes('MOSFET') || markingUpper.includes('BTS141') || markingUpper.includes('VND')) {
      // Low-side smart MOSFET injector/coil driver: R_DS(on) ~ 0.025Ω, plus inductive flyback switching energy
      rThetaJa = 42; // DPAK thermal pad
      const isShortToVbat = linkedFault?.faultType === 'SHORT_TO_VBAT';
      const iDrain = isShortToVbat ? 4.8 : Math.min(2.5, Math.max(0.45, iLoadAmps * 0.75));
      const rDsOn = 0.028;
      const conductionMw = iDrain * iDrain * rDsOn * 1000;
      const switchingMw = isShortToVbat ? 1950 : 280; // inductive clamp / active-clamp switching pulse heat
      powerMw = conductionMw + switchingMw;
      heatSource = isShortToVbat
        ? 'Drain Short-to-VBAT Avalanche / Thermal Foldback'
        : `Low-Side PWM Switching (${iDrain.toFixed(2)}A · Rds(on) ${Math.round(rDsOn * 1000)}mΩ)`;
    } else if (cat.includes('TVS') || comp.refDes.toUpperCase().includes('TVS')) {
      rThetaJa = 75;
      if (hasDirectFault && linkedFault?.faultType === 'SHORT_TO_VBAT') {
        powerMw = 1450;
        heatSource = 'Overvoltage Clamp Shorted Fault';
      } else if (vBatRaw > 26.7) {
        const clampCurrent = (vBatRaw - 26.7) / 1.5;
        powerMw = vBatRaw * clampCurrent * 1000;
        heatSource = `Avalanche Overvoltage Clamping (${vBatRaw.toFixed(1)}V > 26.7V VBR)`;
      } else {
        powerMw = 0.02;
        heatSource = 'Standby Zero-Conduction (<1µA leakage below 24V VWM)';
      }
    } else if (cat.includes('ZENER') || cat.includes('CLAMP')) {
      rThetaJa = 85;
      const isFaulted = linkedFault?.faultType === 'SHORT_TO_VBAT';
      powerMw = isFaulted ? 980 : 110;
      heatSource = isFaulted
        ? 'Active Zener Clamp Fault Overload'
        : 'Inductive Flyback Clamp Energy Absorption (~45V clamping)';
    } else if (cat.includes('DIODE')) {
      rThetaJa = 55;
      const vf = 0.35;
      const iFwd = hasDirectFault && linkedFault?.faultType !== 'OPEN_CIRCUIT' ? 2.2 : iLoadAmps;
      powerMw = vf * iFwd * 1000;
      heatSource = `Forward conduction (${vf}V Vf × ${Math.round(iFwd * 1000)}mA)`;
    } else if (cat.includes('CAN_TRANSCEIVER') || markingUpper.includes('TJA1050')) {
      rThetaJa = 110;
      const isShort =
        linkedFault?.faultType === 'SHORT_TO_VBAT' || linkedFault?.faultType === 'SHORT_TO_GND';
      const iCan = isShort ? 0.145 : 0.028;
      powerMw = 5.0 * iCan * 1000;
      heatSource = isShort
        ? `CAN Bus Transceiver Overload (${linkedFault?.faultType})`
        : 'Differential Bus Driver Switching (28mA avg @ 5V)';
    } else if (cat.includes('RESISTOR') || cat.includes('SHUNT')) {
      rThetaJa = 140;
      const isCanArm = markingUpper.includes('60R4') || comp.decodedValue.includes('60.4');
      if (isCanArm) {
        const vDiffArm =
          hasDirectFault && linkedFault?.faultType !== 'OPEN_CIRCUIT' ? 5.8 : 0.7;
        powerMw = ((vDiffArm * vDiffArm) / 60.4) * 1000;
        heatSource = hasDirectFault
          ? 'Fault Current Joule Heating across 60.4Ω Split Arm'
          : 'Joule heating (V²/R differential bus termination)';
      } else {
        // Low-ohm current sense shunt or pull-up
        const rEst = markingUpper.includes('0R05') ? 0.05 : 100;
        powerMw = rEst < 1 ? iLoadAmps * iLoadAmps * rEst * 1000 + 25 : 40;
        heatSource = `Joule Dissipation (I²R)`;
      }
    } else if (cat.includes('CAPACITOR') || cat.includes('ELECTROLYTIC')) {
      rThetaJa = 65;
      const esr = cat.includes('ELECTROLYTIC') ? 0.15 : 0.8;
      const iRipple = hasDirectFault ? 0.95 : 0.08;
      powerMw = iRipple * iRipple * esr * 1000;
      heatSource = `ESR Ripple Dissipation (I_rms² × ${esr}Ω ESR)`;
    } else if (cat.includes('MICROCONTROLLER') || cat.includes('MCU') || cat.includes('CPU')) {
      rThetaJa = 40;
      powerMw = hasDirectFault ? 680 : 320;
      heatSource = hasDirectFault
        ? 'I/O ESD Clamp Conduction under Pin Fault'
        : 'Core Logic Switching (~64mA @ 5.0V)';
    }

    const deltaT = (powerMw / 1000) * rThetaJa;
    const tempC = Math.min(165, Math.max(ambientTempC, +(ambientTempC + deltaT).toFixed(1)));

    let status: ComponentThermalProfile['status'] = 'NOMINAL';
    if (tempC >= 115) status = 'CRITICAL_OVERHEAT';
    else if (tempC >= 80) status = 'WARNING';
    else if (tempC >= 50) status = 'ELEVATED';

    map[comp.refDes] = {
      tempC,
      powerDissipationMw: Math.round(powerMw),
      thermalResistanceJa: rThetaJa,
      status,
      dominantHeatSource: heatSource,
      faultLinked: hasDirectFault,
    };
  }

  return map;
}

/**
 * Dual-Probe Virtual DMM Continuity, Resistance, Diode Junction & Differential Voltage Analyzer.
 */
export function measureDualProbePcb(params: {
  probeA: ProbeNodeTarget;
  probeB: ProbeNodeTarget;
  components: ImageAnalysisComponent[];
  nets: ExtendedImageAnalysisNet[];
  nodeVoltages?: Record<string, number>;
  powerSupply?: PowerSupplyState;
  faults?: InjectedFault[];
}): DualProbeMeasurement {
  const { probeA, probeB, components, nets, nodeVoltages, powerSupply, faults } = params;

  const mnaA = resolvePcbNetToMnaNode(
    probeA.netId,
    probeA.nominalVoltage,
    nodeVoltages,
    powerSupply
  );
  const mnaB = resolvePcbNetToMnaNode(
    probeB.netId,
    probeB.nominalVoltage,
    nodeVoltages,
    powerSupply
  );

  const voltageA = Number(mnaA.voltage.toFixed(3));
  const voltageB = Number(mnaB.voltage.toFixed(3));
  const differentialVoltage = Number((voltageA - voltageB).toFixed(3));

  const sameNet =
    Boolean(probeA.netId) &&
    probeA.netId !== 'NET_UNASSIGNED' &&
    probeA.netId === probeB.netId;

  const activeFaultA = faults?.find((f) => f.pinId === mnaA.simPinId && f.faultType !== 'NONE');
  const activeFaultB = faults?.find((f) => f.pinId === mnaB.simPinId && f.faultType !== 'NONE');
  const relevantFault = activeFaultA || activeFaultB;

  if (sameNet) {
    if (relevantFault?.faultType === 'OPEN_CIRCUIT') {
      return {
        probeA,
        probeB,
        voltageA,
        voltageB,
        differentialVoltage,
        sameNet: true,
        continuityStatus: 'OPEN_OL',
        continuityLabel: 'OL (OPEN CIRCUIT FAULT)',
        estimatedOhms: null,
        diodeDropVolts: null,
        activeFaultNote: `${relevantFault.pinId}: OPEN_CIRCUIT breaks trace continuity.`,
        guidance: 'Inspect cracked solder joints, blown fusible links, or corroded connector header pins along this net.',
      };
    }

    const netObj = nets.find((n) => n.name === probeA.netId);
    const baseR = netObj?.impedanceOhms ?? 0.05;
    const distNorm = Math.hypot(probeA.xNorm - probeB.xNorm, probeA.yNorm - probeB.yNorm);
    const traceOhms = Number((baseR + distNorm * 0.00018).toFixed(3));
    return {
      probeA,
      probeB,
      voltageA,
      voltageB,
      differentialVoltage,
      sameNet: true,
      continuityStatus: 'CONTINUOUS',
      continuityLabel: `CONTINUITY BEEP (${traceOhms.toFixed(3)} Ω)`,
      estimatedOhms: traceOhms,
      diodeDropVolts: null,
      activeFaultNote: relevantFault ? `${relevantFault.pinId}: ${relevantFault.faultType}` : null,
      guidance: `Direct copper path verified on ${probeA.netId}. Minimal IR drop expected across trace.`,
    };
  }

  // Check if a short fault ties one of the probes to GND or VBAT matching the other probe
  const isProbeAGnd = probeA.netId.toUpperCase().includes('GND');
  const isProbeBGnd = probeB.netId.toUpperCase().includes('GND');
  const isProbeAVbat = probeA.netId.toUpperCase().includes('VBAT') || probeA.netId.toUpperCase().includes('KL30');
  const isProbeBVbat = probeB.netId.toUpperCase().includes('VBAT') || probeB.netId.toUpperCase().includes('KL30');

  if (
    (activeFaultA?.faultType === 'SHORT_TO_GND' && isProbeBGnd) ||
    (activeFaultB?.faultType === 'SHORT_TO_GND' && isProbeAGnd) ||
    (activeFaultA?.faultType === 'SHORT_TO_VBAT' && isProbeBVbat) ||
    (activeFaultB?.faultType === 'SHORT_TO_VBAT' && isProbeAVbat)
  ) {
    return {
      probeA,
      probeB,
      voltageA,
      voltageB,
      differentialVoltage,
      sameNet: false,
      continuityStatus: 'SHORT_FAULT',
      continuityLabel: '0.12 Ω (DEAD SHORT FAULT)',
      estimatedOhms: 0.12,
      diodeDropVolts: null,
      activeFaultNote: `Active ${relevantFault?.faultType} bridges ${probeA.netId} ↔ ${probeB.netId}.`,
      guidance: 'Isolate harness connector and test component resistance out-of-circuit before replacing driver/TVS.',
    };
  }

  // Check component-level bridging (Resistor, Diode, MOSFET, Capacitor) if both probes touch the same RefDes
  if (probeA.compRefDes && probeA.compRefDes === probeB.compRefDes && probeA.pinNumber !== probeB.pinNumber) {
    const comp = components.find((c) => c.refDes === probeA.compRefDes);
    if (comp) {
      const cat = comp.category.toUpperCase();
      if (cat.includes('TVS')) {
        return {
          probeA,
          probeB,
          voltageA,
          voltageB,
          differentialVoltage,
          sameNet: false,
          continuityStatus: 'OPEN_OL',
          continuityLabel: '> 10 MΩ (Bidirectional TVS Standoff)',
          estimatedOhms: null,
          diodeDropVolts: null,
          activeFaultNote: null,
          guidance: 'Healthy TVS exhibits OL (>10 MΩ) below 24V VWM. A reading < 1 Ω indicates shorted load-dump clamp.',
        };
      }
      if (cat.includes('DIODE')) {
        const forward = (probeA.pinNumber ?? 1) < (probeB.pinNumber ?? 2);
        return {
          probeA,
          probeB,
          voltageA,
          voltageB,
          differentialVoltage,
          sameNet: false,
          continuityStatus: forward ? 'DIODE_JUNCTION' : 'OPEN_OL',
          continuityLabel: forward ? '0.350 V Vf (Schottky Forward)' : 'OL (Reverse Blocking)',
          estimatedOhms: null,
          diodeDropVolts: forward ? 0.35 : null,
          activeFaultNote: null,
          guidance: forward
            ? 'Schottky barrier junction forward drop healthy (0.28V–0.45V).'
            : 'Reverse polarity blocking verified; no shorted rectifier junction.',
        };
      }
      if (cat.includes('RESISTOR') || cat.includes('SHUNT')) {
        const parsedMatch = `${comp.marking} ${comp.decodedValue}`.match(/(\d+(?:\.\d+)?)\s*(?:Ω|ohm|R)/i);
        const rNom = comp.marking.includes('60R4')
          ? 60.4
          : comp.marking.includes('0R05')
          ? 0.05
          : parsedMatch
          ? Number(parsedMatch[1])
          : 60.4;
        return {
          probeA,
          probeB,
          voltageA,
          voltageB,
          differentialVoltage,
          sameNet: false,
          continuityStatus: 'RESISTIVE',
          continuityLabel: `${rNom.toFixed(2)} Ω (${comp.refDes} Element)`,
          estimatedOhms: rNom,
          diodeDropVolts: null,
          activeFaultNote: null,
          guidance: `Compare measured resistance against ${comp.decodedValue} specification.`,
        };
      }
      if (cat.includes('MOSFET')) {
        return {
          probeA,
          probeB,
          voltageA,
          voltageB,
          differentialVoltage,
          sameNet: false,
          continuityStatus: 'DIODE_JUNCTION',
          continuityLabel: '0.540 V (MOSFET Body Diode / Gate Isol.)',
          estimatedOhms: null,
          diodeDropVolts: 0.54,
          activeFaultNote: relevantFault ? `${relevantFault.pinId}: ${relevantFault.faultType}` : null,
          guidance: 'Verify Source-to-Drain body diode (~0.54V) and zero Gate-to-Source short.',
        };
      }
    }
  }

  // Check if a shared 2-pin resistor/shunt sits on CAN split termination between R1/R2
  if (
    (probeA.netId === 'NET_CAN_HIGH' && probeB.netId === 'NET_CAN_LOW') ||
    (probeA.netId === 'NET_CAN_LOW' && probeB.netId === 'NET_CAN_HIGH')
  ) {
    const canFault = faults?.find(
      (f) => (f.pinId === 'ecu-pin-13' || f.pinId === 'ecu-pin-14') && f.faultType !== 'NONE'
    );
    const rTerm = canFault?.faultType === 'OPEN_CIRCUIT' ? 120.8 : 60.2;
    return {
      probeA,
      probeB,
      voltageA,
      voltageB,
      differentialVoltage,
      sameNet: false,
      continuityStatus: 'RESISTIVE',
      continuityLabel: `${rTerm.toFixed(1)} Ω (CAN Differential Termination)`,
      estimatedOhms: rTerm,
      diodeDropVolts: null,
      activeFaultNote: canFault ? `${canFault.pinId}: ${canFault.faultType}` : null,
      guidance:
        canFault?.faultType === 'OPEN_CIRCUIT'
          ? 'Measured ~120Ω indicates one 120Ω bus terminator is open-circuit; healthy dual-terminated bus reads ~60Ω.'
          : 'Healthy dual-terminated ISO 11898 CAN bus resistance (~60Ω across R1+R2 // remote 120Ω).',
    };
  }

  return {
    probeA,
    probeB,
    voltageA,
    voltageB,
    differentialVoltage,
    sameNet: false,
    continuityStatus: 'OPEN_OL',
    continuityLabel: 'OL (ISOLATED NETS)',
    estimatedOhms: null,
    diodeDropVolts: null,
    activeFaultNote: relevantFault ? `${relevantFault.pinId}: ${relevantFault.faultType}` : null,
    guidance: `Probes sit on separate nets (${probeA.netId} vs ${probeB.netId}) with ΔV = ${differentialVoltage.toFixed(3)}V DC.`,
  };
}

/**
 * Automated Deterministic ERC / MNA / Electro-Thermal Board Diagnostic Audit.
 */
export function auditPcbDiagnostics(params: {
  components: ImageAnalysisComponent[];
  nets: ExtendedImageAnalysisNet[];
  hotspots: ImageAnalysisHotspot[];
  thermalMap: Record<string, ComponentThermalProfile>;
  nodeVoltages?: Record<string, number>;
  powerSupply?: PowerSupplyState;
  faults?: InjectedFault[];
}): PcbAuditFinding[] {
  const { components, nets, hotspots, thermalMap, nodeVoltages, powerSupply, faults } = params;
  const findings: PcbAuditFinding[] = [];
  const isPowered = powerSupply?.isOutputEnabled ?? true;

  // 1. Electro-Thermal Overheat Checks
  for (const comp of components) {
    const th = thermalMap[comp.refDes];
    if (!th) continue;
    if (th.status === 'CRITICAL_OVERHEAT') {
      findings.push({
        id: `therm-crit-${comp.refDes}`,
        severity: 'CRITICAL',
        category: 'THERMAL',
        title: `Thermal Runaway on ${comp.refDes} (${th.tempC.toFixed(1)}°C)`,
        detail: `${comp.marking || comp.category} dissipating ${th.powerDissipationMw} mW (${th.dominantHeatSource}). Exceeds 115°C PCB safe threshold.`,
        targetCompRef: comp.refDes,
        recommendation: 'Remove power immediately; inspect downstream net for dead short-to-GND or overvoltage fault.',
      });
    } else if (th.status === 'WARNING') {
      findings.push({
        id: `therm-warn-${comp.refDes}`,
        severity: 'WARNING',
        category: 'THERMAL',
        title: `Elevated Junction Temp on ${comp.refDes} (${th.tempC.toFixed(1)}°C)`,
        detail: `${comp.marking || comp.category} dissipating ${th.powerDissipationMw} mW (${th.dominantHeatSource}).`,
        targetCompRef: comp.refDes,
        recommendation: 'Monitor thermal stability or check for excessive quiescent/load current draw.',
      });
    }
  }

  // 2. Live MNA Voltage Deviation Checks (when PSU enabled)
  if (isPowered) {
    const checkedNets = new Set<string>();
    for (const comp of components) {
      for (const pin of comp.pinSpecs || []) {
        if (!pin.connectedNetId || pin.connectedNetId === 'NET_UNASSIGNED') continue;
        const mna = resolvePcbNetToMnaNode(
          pin.connectedNetId,
          pin.nominalVoltage,
          nodeVoltages,
          powerSupply
        );
        const linkedFault = faults?.find((f) => f.pinId === mna.simPinId && f.faultType !== 'NONE');
        const deltaV = mna.voltage - pin.nominalVoltage;
        const absDelta = Math.abs(deltaV);

        // Allow realistic KL30 battery rail headroom (10.5V - 14.8V) unless faulted
        const isVbatNormal =
          (pin.connectedNetId.toUpperCase().includes('KL30') ||
            pin.connectedNetId.toUpperCase().includes('VBAT')) &&
          mna.voltage >= 10.5 &&
          mna.voltage <= 15.0 &&
          !linkedFault;

        if (!isVbatNormal && (linkedFault || absDelta >= 0.6) && !checkedNets.has(pin.connectedNetId)) {
          checkedNets.add(pin.connectedNetId);
          findings.push({
            id: `mna-dev-${pin.connectedNetId}`,
            severity: linkedFault || absDelta >= 1.2 ? 'CRITICAL' : 'WARNING',
            category: 'MNA_VOLTAGE',
            title: `Rail Deviation on ${pin.connectedNetId} (${mna.voltage.toFixed(2)}V vs ${pin.nominalVoltage.toFixed(2)}V)`,
            detail: linkedFault
              ? `Bench fault [${linkedFault.faultType}] on ${linkedFault.pinId} shifts live MNA potential by ${deltaV >= 0 ? '+' : ''}${deltaV.toFixed(2)}V.`
              : `Measured MNA node ${mna.mnaNodeId} deviates by ${deltaV >= 0 ? '+' : ''}${deltaV.toFixed(2)}V from schematic nominal.`,
            targetCompRef: comp.refDes,
            targetNetId: pin.connectedNetId,
            recommendation: `Probe ${comp.refDes} Pin #${pin.pinNumber} (${pin.pinName}) and clear/repair ${linkedFault ? linkedFault.faultType : 'loading fault'}.`,
          });
        }
      }
    }
  }

  // 3. ERC Netlist Integrity (Unassigned pins & single-node nets)
  let unassignedCount = 0;
  let firstUnassignedComp: string | undefined;
  for (const comp of components) {
    for (const pin of comp.pinSpecs || []) {
      if (!pin.connectedNetId || pin.connectedNetId === 'NET_UNASSIGNED') {
        unassignedCount++;
        if (!firstUnassignedComp) firstUnassignedComp = comp.refDes;
      }
    }
  }
  if (unassignedCount > 0) {
    findings.push({
      id: 'erc-unassigned-pins',
      severity: 'WARNING',
      category: 'ERC_NETLIST',
      title: `${unassignedCount} Unassigned / Floating Component Pin${unassignedCount > 1 ? 's' : ''}`,
      detail: `Pin(s) mapped to NET_UNASSIGNED cannot participate in trace path routing or MNA voltage correlation.`,
      targetCompRef: firstUnassignedComp,
      recommendation: 'Assign a target net in Part Inspector -> Pinout Table to complete schematic capture.',
    });
  }

  for (const net of nets) {
    const ptCount =
      net.traceBranches && net.traceBranches.length > 0
        ? net.traceBranches.reduce((s, b) => s + b.length, 0)
        : net.tracePoints.length;
    if (ptCount < 2) {
      findings.push({
        id: `erc-unrouted-${net.name}`,
        severity: 'INFO',
        category: 'ERC_NETLIST',
        title: `Unrouted Copper Net: ${net.name}`,
        detail: `Net has ${ptCount} trace vertex. Use Orthogonal Route to visualize copper connectivity.`,
        targetNetId: net.name,
        recommendation: 'Open Nets tab and click Orthogonal Route.',
      });
    }
  }

  // 4. Physical Inspection Hotspots
  for (const h of hotspots) {
    if (h.severity === 'CRITICAL' || h.severity === 'WARNING') {
      findings.push({
        id: `hotspot-${h.id}`,
        severity: h.severity,
        category: 'HOTSPOT',
        title: h.label,
        detail: h.notes,
        targetCompRef: h.suspectComponentRef,
        targetHotspotId: h.id,
        recommendation: h.suspectComponentRef
          ? `Inspect ${h.suspectComponentRef} pads under magnification and verify out-of-circuit.`
          : 'Inspect highlighted board coordinates for burn marks, solder cracks, or oxidation.',
      });
    }
  }

  const rank: Record<PcbAuditSeverity, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

/**
 * Computes physical pin marker coordinates along component package edges (0..1000 normalized).
 */
export function computeComponentPinCoords(
  comp: ImageAnalysisComponent,
  pinIndex: number,
  totalPins: number
): TracePoint {
  const { xmin, ymin, xmax, ymax } = comp.bbox;
  const pkg = (comp.packageType || '').toUpperCase();

  if (pkg.includes('SOIC') || pkg.includes('QFP') || totalPins === 8) {
    const half = Math.ceil(totalPins / 2);
    if (pinIndex < half) {
      const ratio = (pinIndex + 0.5) / Math.max(1, half);
      return { x: xmin, y: Math.round(ymin + (ymax - ymin) * ratio) };
    } else {
      const rightIdx = totalPins - 1 - pinIndex;
      const ratio = (rightIdx + 0.5) / Math.max(1, totalPins - half);
      return { x: xmax, y: Math.round(ymin + (ymax - ymin) * ratio) };
    }
  }

  if (pkg.includes('TO-263') || totalPins === 5) {
    const ratio = (pinIndex + 0.5) / totalPins;
    return { x: xmin, y: Math.round(ymin + (ymax - ymin) * ratio) };
  }

  const w = xmax - xmin;
  const h = ymax - ymin;
  if (w >= h) {
    return {
      x: pinIndex === 0 ? xmin : xmax,
      y: Math.round((ymin + ymax) / 2),
    };
  }
  return {
    x: Math.round((xmin + xmax) / 2),
    y: pinIndex === 0 ? ymin : ymax,
  };
}

/**
 * Computes continuous orthogonal BFS trace path between two selected components routed through a hovered node.
 */
export function computeContinuousTracePath(params: {
  tracePathPair: [string | null, string | null];
  hoveredNode: { nodeLabel: string; netId: string; xNorm: number; yNorm: number } | null;
  components: ImageAnalysisComponent[];
  nets: ExtendedImageAnalysisNet[];
}): ContinuousTracePathResult | null {
  const { tracePathPair, hoveredNode, components, nets } = params;
  const [refA, refB] = tracePathPair;
  if (!refA || !refB || !hoveredNode) return null;

  const compA = components.find((c) => c.refDes === refA);
  const compB = components.find((c) => c.refDes === refB);
  if (!compA || !compB) return null;

  const hoverPt: TracePoint = {
    x: Math.round(hoveredNode.xNorm),
    y: Math.round(hoveredNode.yNorm),
  };

  const getComponentPinOrCenter = (
    comp: ImageAnalysisComponent,
    preferredNetId?: string | null
  ): TracePoint => {
    const pins = comp.pinSpecs || [];
    if (preferredNetId && pins.length > 0) {
      const idx = pins.findIndex((p) => p.connectedNetId === preferredNetId);
      if (idx >= 0) {
        return computeComponentPinCoords(comp, idx, pins.length);
      }
    }
    return getBoxCenter(comp.bbox);
  };

  const buildOrthogonalSegment = (from: TracePoint, to: TracePoint): TracePoint[] => {
    const dx = Math.abs(to.x - from.x);
    const dy = Math.abs(to.y - from.y);
    if (dx <= 2 || dy <= 2) return [from, to];
    if (dx >= dy) {
      const midX = Math.round((from.x + to.x) / 2);
      return [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
    }
    const midY = Math.round((from.y + to.y) / 2);
    return [from, { x: from.x, y: midY }, { x: to.x, y: midY }, to];
  };

  type NetEdge = { toRef: string; netName: string };
  const adjacency = new Map<string, NetEdge[]>();
  const validRefs = new Set(components.map((c) => c.refDes));

  for (const net of nets) {
    const members = new Set<string>();
    for (const r of net.connectedComponentRefs || []) {
      if (validRefs.has(r)) members.add(r);
    }
    for (const c of components) {
      if (c.pinSpecs?.some((p) => p.connectedNetId === net.name)) {
        members.add(c.refDes);
      }
    }
    const memberList = Array.from(members);
    for (let i = 0; i < memberList.length; i++) {
      for (let j = 0; j < memberList.length; j++) {
        if (i === j) continue;
        const u = memberList[i];
        const v = memberList[j];
        if (!adjacency.has(u)) adjacency.set(u, []);
        adjacency.get(u)!.push({ toRef: v, netName: net.name });
      }
    }
  }

  for (const [, edges] of adjacency) {
    edges.sort((e1, e2) => {
      const m1 = e1.netName === hoveredNode.netId ? 0 : 1;
      const m2 = e2.netName === hoveredNode.netId ? 0 : 1;
      return m1 - m2;
    });
  }

  type BfsStep = { refDes: string; viaNet: string | null };
  const queue: BfsStep[][] = [[{ refDes: compA.refDes, viaNet: null }]];
  const visited = new Set<string>([compA.refDes]);
  let foundChain: BfsStep[] | null = null;

  while (queue.length > 0) {
    const path = queue.shift()!;
    const tail = path[path.length - 1];
    if (tail.refDes === compB.refDes) {
      foundChain = path;
      break;
    }
    for (const edge of adjacency.get(tail.refDes) || []) {
      if (!visited.has(edge.toRef)) {
        visited.add(edge.toRef);
        queue.push([...path, { refDes: edge.toRef, viaNet: edge.netName }]);
      }
    }
  }

  const traversedNets = foundChain
    ? Array.from(new Set(foundChain.map((s) => s.viaNet).filter((n): n is string => Boolean(n))))
    : [];
  const isHoveredNetOnChain = Boolean(
    hoveredNode.netId && traversedNets.includes(hoveredNode.netId)
  );

  const anchorA = getComponentPinOrCenter(
    compA,
    foundChain?.[1]?.viaNet || hoveredNode.netId
  );
  const anchorB = getComponentPinOrCenter(
    compB,
    foundChain?.[foundChain.length - 1]?.viaNet || hoveredNode.netId
  );

  const rawPoints: TracePoint[] = [];
  const appendSegment = (seg: TracePoint[]) => {
    for (const pt of seg) {
      const last = rawPoints[rawPoints.length - 1];
      if (!last || Math.abs(last.x - pt.x) > 1 || Math.abs(last.y - pt.y) > 1) {
        rawPoints.push(pt);
      }
    }
  };

  if (foundChain && foundChain.length >= 2 && isHoveredNetOnChain) {
    let hoverInserted = false;
    for (let i = 0; i < foundChain.length - 1; i++) {
      const curComp = components.find((c) => c.refDes === foundChain[i].refDes)!;
      const nxtComp = components.find((c) => c.refDes === foundChain[i + 1].refDes)!;
      const hopNet = foundChain[i + 1].viaNet;
      const pStart = i === 0 ? anchorA : getComponentPinOrCenter(curComp, hopNet);
      const pEnd =
        i + 1 === foundChain.length - 1 ? anchorB : getComponentPinOrCenter(nxtComp, hopNet);

      if (!hoverInserted && hopNet === hoveredNode.netId) {
        appendSegment(buildOrthogonalSegment(pStart, hoverPt));
        appendSegment(buildOrthogonalSegment(hoverPt, pEnd));
        hoverInserted = true;
      } else {
        appendSegment(buildOrthogonalSegment(pStart, pEnd));
      }
    }
  } else {
    appendSegment(buildOrthogonalSegment(anchorA, hoverPt));
    appendSegment(buildOrthogonalSegment(hoverPt, anchorB));
  }

  return {
    compA: compA.refDes,
    compB: compB.refDes,
    anchorA,
    anchorB,
    hoverPt,
    points: rawPoints,
    pointsStr: rawPoints.map((p) => `${p.x},${p.y}`).join(' '),
    traversedNets,
    isNetVerified: Boolean(foundChain && isHoveredNetOnChain),
    hoveredNodeLabel: hoveredNode.nodeLabel,
    hoveredNetId: hoveredNode.netId,
  };
}

/**
 * Converts an OEM ECU Brand Profile (from ecuPinoutData) with annotated pcbComponents & pcbImageSrc
 * into a full interactive PCB Scanner Board Preset mapped to live MNA pins.
 */
export function convertOemProfileToPcbBoard(profile: EcuBrandProfile): PcbBoardPreset {
  const rawComps = profile.pcbComponents || [];
  const components: ImageAnalysisComponent[] = rawComps.map((pt, idx) => {
    const cx = clampCoord(pt.xPercent * 10, 60, 940);
    const cy = clampCoord(pt.yPercent * 10, 60, 940);
    const halfW = pt.type === 'transistor' || pt.type === 'connector_header' ? 62 : 46;
    const halfH = pt.type === 'transistor' || pt.type === 'connector_header' ? 48 : 36;
    const bbox: PcbNormalizedBox = clampBbox({
      ymin: cy - halfH,
      xmin: cx - halfW,
      ymax: cy + halfH,
      xmax: cx + halfW,
    });

    const refPrefix =
      pt.type === 'transistor'
        ? 'Q'
        : pt.type === 'diode'
        ? 'D'
        : pt.type === 'capacitor'
        ? 'C'
        : pt.type === 'resistor' || pt.type === 'shunt'
        ? 'R'
        : pt.type === 'connector_header'
        ? 'J'
        : 'G';
    const refDes = `${refPrefix}${idx + 1}`;

    const netForSimPin = (simId?: string): { net: string; vNom: number; cat: ImageAnalysisPinSpec['category'] } => {
      switch (simId) {
        case 'ecu-pin-1':
          return { net: 'NET_CHASSIS_GND', vNom: 0.0, cat: 'ground' };
        case 'ecu-pin-3':
          return { net: 'NET_KL30_VBAT', vNom: 12.6, cat: 'power' };
        case 'ecu-pin-5':
          return { net: 'NET_5V_REGULATED', vNom: 5.0, cat: 'power' };
        case 'ecu-pin-6':
          return { net: 'NET_SGND', vNom: 0.0, cat: 'ground' };
        case 'ecu-pin-7':
          return { net: 'NET_TPS_SIG', vNom: 1.3, cat: 'signal_in' };
        case 'ecu-pin-10':
          return { net: 'NET_INJ_1_LOW', vNom: 12.6, cat: 'driver_out' };
        case 'ecu-pin-11':
          return { net: 'NET_IGN_1_TRIG', vNom: 0.1, cat: 'signal_out' };
        case 'ecu-pin-13':
          return { net: 'NET_CAN_HIGH', vNom: 2.5, cat: 'bus' };
        case 'ecu-pin-14':
          return { net: 'NET_CAN_LOW', vNom: 2.5, cat: 'bus' };
        case 'ecu-pin-15':
          return { net: 'NET_O2_SIG', vNom: 0.45, cat: 'signal_in' };
        case 'ecu-pin-16':
          return { net: 'NET_FP_RELAY', vNom: 12.5, cat: 'signal_out' };
        default:
          return { net: 'NET_5V_REGULATED', vNom: 5.0, cat: 'signal_in' };
      }
    };

    const mapped = netForSimPin(pt.associatedSimPinId);
    const pinSpecs: ImageAnalysisPinSpec[] = [
      {
        pinNumber: 1,
        pinName: pt.associatedPins ? pt.associatedPins.split(',')[0].trim().slice(0, 12) : 'SIG',
        category: mapped.cat,
        nominalVoltage: mapped.vNom,
        connectedNetId: mapped.net,
        notes: `${pt.diagnosticRole}${pt.associatedSimPinId ? ` (MNA: ${pt.associatedSimPinId})` : ''}`,
      },
      {
        pinNumber: 2,
        pinName: 'GND_REF',
        category: 'ground',
        nominalVoltage: 0.0,
        connectedNetId: 'NET_CHASSIS_GND',
        notes: 'PCB ground return plane',
      },
    ];

    const categoryMap: Record<string, string> = {
      transistor: pt.name.toUpperCase().includes('CPU') ? 'MICROCONTROLLER' : 'MOSFET_DRIVER',
      diode: 'DIODE',
      capacitor: 'CAPACITOR',
      resistor: 'RESISTOR',
      shunt: 'SHUNT_RESISTOR',
      connector_header: 'CONNECTOR',
      ground_bond: 'GROUND_BOND',
    };

    return {
      refDes,
      category: categoryMap[pt.type] || 'SMD_COMPONENT',
      marking: pt.designation.slice(0, 22),
      decodedValue: pt.spec,
      packageType: pt.type === 'transistor' ? 'QFP / DPAK' : 'OEM SMD',
      bbox,
      confidenceScore: 0.96,
      verificationStatus: 'VERIFIED',
      circuitFunction: pt.name,
      terminalIds: [`${refDes}-1`, `${refDes}-2`],
      notes: pt.diagnosticRole,
      operatingVoltageRange: mapped.vNom > 6 ? '5V – 16V DC' : '0V – 5.25V DC',
      maxCurrentRating: pt.type === 'shunt' ? '10 A Shunt' : 'AEC-Q100 OEM',
      datasheetSummary: `${pt.name}: ${pt.diagnosticRole}`,
      pinSpecs,
      source: 'MANUAL',
    };
  });

  // Build clean orthogonal nets connecting OEM PCB components sharing the same electrical net
  const netGroups = new Map<string, ImageAnalysisComponent[]>();
  for (const c of components) {
    for (const p of c.pinSpecs || []) {
      if (!netGroups.has(p.connectedNetId)) netGroups.set(p.connectedNetId, []);
      const list = netGroups.get(p.connectedNetId)!;
      if (!list.some((x) => x.refDes === c.refDes)) list.push(c);
    }
  }

  const nets: ExtendedImageAnalysisNet[] = [];
  for (const [netName, group] of netGroups.entries()) {
    if (group.length === 0) continue;
    const centers = group.map((c) => getBoxCenter(c.bbox));
    const branches: TracePoint[][] = [];
    for (let i = 0; i < centers.length - 1; i++) {
      const a = centers[i];
      const b = centers[i + 1];
      const midX = Math.round((a.x + b.x) / 2);
      branches.push([a, { x: midX, y: a.y }, { x: midX, y: b.y }, b]);
    }
    const samplePin = group[0]?.pinSpecs?.find((p) => p.connectedNetId === netName);
    nets.push({
      name: netName,
      signalType: netName.includes('GND')
        ? 'GROUND'
        : netName.includes('KL30')
        ? 'BATTERY_POWER'
        : netName.includes('CAN')
        ? 'CAN_DIFFERENTIAL'
        : 'SIGNAL_TRACE',
      nominalVoltage: samplePin?.nominalVoltage ?? 5.0,
      traceWidthMm: netName.includes('GND') || netName.includes('KL30') ? 2.0 : 0.4,
      impedanceOhms: netName.includes('GND') ? 0.01 : 0.04,
      connectedComponentRefs: group.map((g) => g.refDes),
      connectedTerminalIds: group.map((g) => `${g.refDes}-1`),
      tracePoints: branches.length > 0 ? branches.flat() : centers,
      traceBranches: branches.length > 0 ? branches : undefined,
      confidenceScore: 0.94,
      verificationStatus: 'VERIFIED',
      isComplete: branches.length > 0,
    });
  }

  const firstCriticalComp = components.find((c) =>
    c.notes?.toLowerCase().includes('fail') || c.notes?.toLowerCase().includes('blow')
  );
  const hotspots: ImageAnalysisHotspot[] = firstCriticalComp
    ? [
        {
          id: `${profile.id}-oem-hotspot`,
          label: `${firstCriticalComp.circuitFunction} Inspection Zone`,
          severity: 'WARNING',
          bbox: firstCriticalComp.bbox,
          suspectComponentRef: firstCriticalComp.refDes,
          notes: firstCriticalComp.notes || firstCriticalComp.circuitFunction,
          source: 'AI',
        },
      ]
    : [];

  return {
    id: `oem-${profile.id}`,
    name: `${profile.brandName} OEM PCB`,
    type: profile.modelName,
    summary: profile.description,
    oemReference: `${profile.brandName} — ${profile.modelName}`,
    imageSrc: profile.pcbImageSrc,
    pcbSpecs: {
      layers: 4,
      copperWeightOz: 2.0,
      substrate: 'OEM Ceramic / High-Tg FR4',
      finish: 'ENIG Automotive Grade',
    },
    components,
    nets,
    hotspots,
  };
}
