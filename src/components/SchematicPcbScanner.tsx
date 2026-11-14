import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { analyzePcbImage } from '../services/pcbImageAnalysisService';
import {
  ImageAnalysisComponent,
  ImageAnalysisHotspot,
  ImageAnalysisNet,
  ImageAnalysisPinSpec,
  ImageAnalysisResult,
  PcbNormalizedBox,
} from '../server/services/imageAnalysisTypes';
import {
  clampBbox,
  clampCoord,
  cropPcbRegionToJpegBase64,
  fusePcbVisionResults,
  getBoxCenter,
  LocalPcbCvOutput,
  mergeMacroCropResults,
  runLocalPcbCv,
} from '../utils/pcbLocalVision';
import {
  deletePcbScan,
  SavedPcbScan,
  savePcbScan,
  subscribePcbScans,
} from '../services/benchStorageService';
import { useAuth } from '../context/AuthContext';
import { PowerSupplyState, InjectedFault } from '../types/ecu';
import {
  resolvePcbNetToMnaNode,
  computePcbThermalMap,
  measureDualProbePcb,
  auditPcbDiagnostics,
  computeComponentPinCoords,
  computeContinuousTracePath,
  convertOemProfileToPcbBoard,
  type TracePoint,
  type ExtendedImageAnalysisNet,
  type PcbBoardPreset,
  type ComponentThermalProfile,
  type ProbeNodeTarget,
} from '../simulation/pcb/PcbDiagnosticEngine';
import { ECU_BRAND_PROFILES } from './ecuPinoutData';
import {
  Upload,
  Cpu,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  CheckCircle,
  AlertTriangle,
  Download,
  Plus,
  Eye,
  EyeOff,
  Search,
  Trash2,
  Activity,
  Disc,
  Crop,
  Move,
  Flame,
  Globe,
  Bot,
  CloudUpload,
  FolderOpen,
  Link2,
  Sparkles,
  Hand,
  Waypoints,
  Zap,
  Thermometer,
  Info,
  Crosshair,
  Layers,
  CheckSquare,
  Sliders,
  Maximize2,
  RefreshCw,
  Route,
  X,
  FileText,
  ArrowLeftRight,
  ShieldAlert,
} from 'lucide-react';

// ============================================================================
// EXTENDED TYPES & INTERFACES
// ============================================================================

export type PcbPinSpec = ImageAnalysisPinSpec;
export type DetailedPcbComponent = ImageAnalysisComponent;
export type { TracePoint, ExtendedImageAnalysisNet, ComponentThermalProfile };

export interface SchematicPcbScannerProps {
  onOpenGroundedSearch?: (query?: string, dtc?: string, ecu?: string) => void;
  onOpenOfflineBot?: (prompt?: string) => void;
  onOpenCloudModal?: () => void;
  nodeVoltages?: Record<string, number>;
  supplyCurrentDrawAmps?: number;
  powerSupply?: PowerSupplyState;
  faults?: InjectedFault[];
}

type SampleBoard = PcbBoardPreset;
type InteractionMode = 'EDIT' | 'PAN' | 'PROBE' | 'MACRO_CROP' | 'TRACE_EDIT' | 'TRACE_PATH';
type OpticalFilterMode = 'NORMAL' | 'CONTRAST' | 'UV_SILK' | 'XRAY';

type InteractionDrag =
  | {
      type: 'MOVE';
      refDes: string;
      startClientX: number;
      startClientY: number;
      origBox: PcbNormalizedBox;
      boardRect: DOMRect;
    }
  | {
      type: 'RESIZE';
      refDes: string;
      startClientX: number;
      startClientY: number;
      origBox: PcbNormalizedBox;
      boardRect: DOMRect;
    }
  | {
      type: 'CROP';
      startXNorm: number;
      startYNorm: number;
      boardRect: DOMRect;
    }
  | {
      type: 'PAN_VIEWPORT';
      startClientX: number;
      startClientY: number;
      startScrollLeft: number;
      startScrollTop: number;
    }
  | {
      type: 'MOVE_TRACE_NODE';
      netName: string;
      pointIndex: number;
      branchIndex?: number;
      boardRect: DOMRect;
    };

// ============================================================================
// VERIFIED AUTOMOTIVE OEM SAMPLE BOARDS (FIXED HARDWARE & DATASHEET SPECS)
// ============================================================================

const SAMPLE_BOARDS: SampleBoard[] = [
  {
    id: 'sample-power-stage',
    name: 'ECU 5V Power Supply & Clamping Stage',
    type: 'Automotive ECU Power Supply PCB',
    oemReference: 'Bosch ME7.5 / EDC16 Power Regulation Topology',
    imageSrc: '/src/assets/images/pcb_ldo_stage_1794671232433.jpg',
    summary:
      'Infineon TLE4275G 5.0V Low-Dropout Regulator with B540C reverse-polarity Schottky barrier protection, SMBJ24CA ISO 7637-2 load-dump transient clamp, and low-ESR stability filtering.',
    pcbSpecs: {
      layers: 4,
      copperWeightOz: 2.0,
      substrate: 'FR4 High-Tg (170°C) AEC-Q100 Grade 1',
      finish: 'ENIG (Electroless Nickel Immersion Gold)',
    },
    components: [
      {
        refDes: 'U1',
        category: 'VOLTAGE_REGULATOR',
        marking: 'TLE4275G',
        decodedValue: '5.0V ±2% / 450mA Automotive LDO',
        packageType: 'TO-263-5 (D2PAK-5)',
        bbox: { ymin: 325, xmin: 410, ymax: 725, xmax: 605 },
        confidenceScore: 0.98,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Main ECU +5.00V Reference, Sensor Supply & MCU Logic Regulator',
        terminalIds: ['U1-1', 'U1-2', 'U1-3', 'U1-4', 'U1-5', 'U1-TAB'],
        notes:
          'Infineon TLE4275G (TO-263-5). Pin 2 is active-low Reset Output (RO); Pin 4 is Reset Delay Timing Capacitor (D). Heatsink tab is internally bonded to Pin 3 (GND) and soldered to 2oz thermal ground plane.',
        operatingVoltageRange: '5.5V – 42V DC (Survival up to 45V)',
        maxCurrentRating: '450 mA (Internal current limit 650mA)',
        datasheetSummary:
          'Ultra-low dropout (typ. 250mV @ 300mA), integrated power-on reset generator with programmable delay via Pin 4 capacitor, reverse polarity proof (-42V), overtemperature shutdown @ Tj > 150°C.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'I (VIN)',
            category: 'power',
            nominalVoltage: 12.25,
            connectedNetId: 'NET_KL30_VBAT',
            notes: 'Protected +12V battery supply input after Schottky diode D1 (~0.35V forward drop)',
          },
          {
            pinNumber: 2,
            pinName: 'RO (RESET)',
            category: 'signal_out',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_MCU_RESET',
            notes: 'Open-collector active-low power-on reset output to MCU (pulled to 5V via internal/external pull-up; pulls <0.4V if VQ < 4.65V)',
          },
          {
            pinNumber: 3,
            pinName: 'GND (TAB)',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Regulator ground reference and thermal heatsink tab connection',
          },
          {
            pinNumber: 4,
            pinName: 'D (DELAY)',
            category: 'signal_in',
            nominalVoltage: 2.1,
            connectedNetId: 'NET_DELAY_CAP',
            notes: 'Reset delay timing capacitor terminal (connects 47nF–100nF MLCC to GND; charges/discharges between thresholds to set reset hold time)',
          },
          {
            pinNumber: 5,
            pinName: 'Q (VOUT)',
            category: 'power',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_5V_REGULATED',
            notes: 'Regulated +5.00V ±2% output rail feeding MCU, CAN transceiver, and MAP/TPS 5V VREF',
          },
        ],
      },
      {
        refDes: 'D1',
        category: 'DIODE',
        marking: 'B540C',
        decodedValue: '40V / 5.0A Schottky Barrier Rectifier',
        packageType: 'SMC (DO-214AB)',
        bbox: { ymin: 365, xmin: 245, ymax: 665, xmax: 335 },
        confidenceScore: 0.96,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Series Reverse Battery Polarity Protection',
        terminalIds: ['D1-A', 'D1-K'],
        notes: 'Blocks negative current if battery leads are reversed during jump-start. Forward drop Vf ≈ 0.35V at typical 250mA ECU quiescent load (0.55V at 5A max).',
        operatingVoltageRange: '40V Max Repetitive Reverse Voltage (VRRM)',
        maxCurrentRating: '5.0 A Continuous Forward Current',
        datasheetSummary:
          'Guard-ring die construction for transient protection, low forward voltage drop (0.35V @ 0.3A, 0.55V @ 5.0A), high surge capability (100A IFSM).',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'ANODE (A)',
            category: 'power',
            nominalVoltage: 12.6,
            connectedNetId: 'NET_RAW_KL30',
            notes: 'Unprotected raw battery input from ECU harness Pin KL30 (+12.6V)',
          },
          {
            pinNumber: 2,
            pinName: 'CATHODE (K)',
            category: 'power',
            nominalVoltage: 12.25,
            connectedNetId: 'NET_KL30_VBAT',
            notes: 'Reverse-polarity protected internal VBat rail (12.60V - 0.35V Vf = 12.25V)',
          },
        ],
      },
      {
        refDes: 'C1',
        category: 'ELECTROLYTIC_CAP',
        marking: '470uF 35V VT',
        decodedValue: '470 µF / 35V Low-ESR Aluminum Electrolytic',
        packageType: 'SMD V-Chip (10x10.2mm)',
        bbox: { ymin: 335, xmin: 18, ymax: 645, xmax: 225 },
        confidenceScore: 0.94,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Bulk Input Reservoir & Alternator Ripple Filter',
        terminalIds: ['C1-POS', 'C1-NEG'],
        notes: 'Maintains U1 input voltage during starter cranking voltage sags and absorbs low-frequency alternator ripple.',
        operatingVoltageRange: '35V DC Rated (-55°C to +125°C)',
        maxCurrentRating: '850 mA RMS Ripple Current @ 100kHz',
        datasheetSummary:
          'AEC-Q200 high-temperature automotive electrolytic capacitor, ESR < 0.15Ω @ 100kHz, 4000h endurance at 125°C.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'POS (+)',
            category: 'power',
            nominalVoltage: 12.25,
            connectedNetId: 'NET_KL30_VBAT',
            notes: 'Protected +12.25V internal VBat bus smoothing node',
          },
          {
            pinNumber: 2,
            pinName: 'NEG (-)',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Chassis power ground plane return',
          },
        ],
      },
      {
        refDes: 'C2',
        category: 'CAPACITOR',
        marking: '226C (22uF 16V)',
        decodedValue: '22 µF / 16V Automotive Tantalum',
        packageType: 'EIA 7343-31 (Case D)',
        bbox: { ymin: 380, xmin: 685, ymax: 650, xmax: 775 },
        confidenceScore: 0.92,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'TLE4275G 5V Output Loop Compensation & Stability Filter',
        terminalIds: ['C2-POS', 'C2-NEG'],
        notes: 'Rated at 16V (3.2x voltage derating on 5V rail per automotive MnO2 tantalum rules to prevent thermal ignition). Tunnel ESR (0.4Ω - 2.5Ω) required for TLE4275G phase margin.',
        operatingVoltageRange: '16V DC Rated (Derated to 10.5V @ 125°C)',
        maxCurrentRating: 'ESR 0.8 Ω (TLE4275G stability window: ≤ 3.0 Ω)',
        datasheetSummary:
          'AEC-Q200 molded solid tantalum chip capacitor. Satisfies TLE4275G datasheet requirement (CQ ≥ 22µF, ESR ≤ 3Ω) to prevent LDO oscillation.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'ANODE (+)',
            category: 'power',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_5V_REGULATED',
            notes: 'Connected directly to U1 Pin 5 (+5.00V regulated output)',
          },
          {
            pinNumber: 2,
            pinName: 'CATHODE (-)',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Low-inductance return to U1 GND plane',
          },
        ],
      },
      {
        refDes: 'TVS1',
        category: 'TVS_DIODE',
        marking: 'SMBJ24CA',
        decodedValue: '24V Standoff / 38.9V Clamp Bidirectional TVS',
        packageType: 'SMB (DO-214AA)',
        bbox: { ymin: 375, xmin: 800, ymax: 655, xmax: 905 },
        confidenceScore: 0.95,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'ISO 7637-2 Pulse 5a/5b Load-Dump & Inductive Transient Clamp',
        terminalIds: ['TVS-1', 'TVS-2'],
        notes: 'Non-conducting (<1µA leakage, 0mW dissipation) under normal 12V–14.8V operation. Clamps high-energy alternator load-dump spikes (>26.7V breakdown) to protect U1.',
        operatingVoltageRange: '24.0V Standoff (VWM) / 26.7V–29.5V Breakdown (VBR) / 38.9V Max Clamp (VC)',
        maxCurrentRating: '600W Peak Pulse (15.4A IPP @ 10/1000µs)',
        datasheetSummary:
          'Sub-nanosecond transient response, clamps inductive energy spikes from alternator load dump or starter solenoid release. Fails as a dead short if subjected to sustained >28V overvoltage.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'TERM 1',
            category: 'power',
            nominalVoltage: 12.25,
            connectedNetId: 'NET_KL30_VBAT',
            notes: 'Protected +12.25V VBat bus clamping node',
          },
          {
            pinNumber: 2,
            pinName: 'TERM 2',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'High-current transient ground return pad',
          },
        ],
      },
    ],
    nets: [
      {
        name: 'NET_RAW_KL30',
        signalType: 'BATTERY_POWER',
        nominalVoltage: 12.6,
        traceWidthMm: 2.0,
        impedanceOhms: 0.015,
        connectedComponentRefs: ['D1'],
        connectedTerminalIds: ['D1-A'],
        tracePoints: [
          { x: 65, y: 438 },
          { x: 111, y: 438 },
        ],
        traceBranches: [
          [
            { x: 65, y: 438 },
            { x: 111, y: 438 },
          ],
        ],
        confidenceScore: 0.97,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_KL30_VBAT',
        signalType: 'BATTERY_POWER',
        nominalVoltage: 12.25,
        traceWidthMm: 2.0,
        impedanceOhms: 0.025,
        connectedComponentRefs: ['D1', 'C1', 'U1', 'TVS1'],
        connectedTerminalIds: ['D1-K', 'C1-POS', 'U1-1', 'TVS-1'],
        tracePoints: [
          { x: 250, y: 438 },
          { x: 333, y: 438 },
          { x: 333, y: 396 },
          { x: 250, y: 438 },
          { x: 181, y: 583 },
          { x: 653, y: 698 },
        ],
        // Orthogonal multi-branch segments prevent false diagonal lines across the PCB
        traceBranches: [
          // Branch 1: D1 Cathode -> Junction -> U1 Pin 1 (VIN)
          [
            { x: 250, y: 438 },
            { x: 295, y: 438 },
            { x: 295, y: 396 },
            { x: 333, y: 396 },
          ],
          // Branch 2: D1 Cathode -> C1 Positive Terminal
          [
            { x: 250, y: 438 },
            { x: 181, y: 438 },
            { x: 181, y: 583 },
          ],
          // Branch 3: Junction -> Under-IC Feed -> TVS1 Terminal 1
          [
            { x: 295, y: 438 },
            { x: 295, y: 555 },
            { x: 615, y: 555 },
            { x: 615, y: 698 },
            { x: 653, y: 698 },
          ],
        ],
        confidenceScore: 0.96,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_5V_REGULATED',
        signalType: '5V_LOGIC',
        nominalVoltage: 5.0,
        traceWidthMm: 1.2,
        impedanceOhms: 0.04,
        connectedComponentRefs: ['U1', 'C2'],
        connectedTerminalIds: ['U1-5', 'C2-POS'],
        tracePoints: [
          { x: 583, y: 604 },
          { x: 620, y: 604 },
          { x: 620, y: 448 },
          { x: 653, y: 448 },
        ],
        traceBranches: [
          [
            { x: 583, y: 604 },
            { x: 620, y: 604 },
            { x: 620, y: 448 },
            { x: 653, y: 448 },
          ],
        ],
        confidenceScore: 0.95,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_MCU_RESET',
        signalType: 'SIGNAL_TRACE',
        nominalVoltage: 5.0,
        traceWidthMm: 0.35,
        impedanceOhms: 0.12,
        connectedComponentRefs: ['U1'],
        connectedTerminalIds: ['U1-2'],
        tracePoints: [
          { x: 333, y: 455 },
          { x: 280, y: 455 },
          { x: 280, y: 260 },
          { x: 450, y: 260 },
        ],
        traceBranches: [
          [
            { x: 333, y: 455 },
            { x: 280, y: 455 },
            { x: 280, y: 260 },
            { x: 450, y: 260 },
          ],
        ],
        confidenceScore: 0.92,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_DELAY_CAP',
        signalType: 'SIGNAL_TRACE',
        nominalVoltage: 2.1,
        traceWidthMm: 0.35,
        impedanceOhms: 0.15,
        connectedComponentRefs: ['U1'],
        connectedTerminalIds: ['U1-4'],
        tracePoints: [
          { x: 333, y: 565 },
          { x: 285, y: 565 },
          { x: 285, y: 640 },
        ],
        traceBranches: [
          [
            { x: 333, y: 565 },
            { x: 285, y: 565 },
            { x: 285, y: 640 },
          ],
        ],
        confidenceScore: 0.91,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_CHASSIS_GND',
        signalType: 'GROUND',
        nominalVoltage: 0.0,
        traceWidthMm: 3.5,
        impedanceOhms: 0.008,
        connectedComponentRefs: ['U1', 'C1', 'C2', 'TVS1'],
        connectedTerminalIds: ['U1-3', 'C1-NEG', 'C2-NEG', 'TVS-2'],
        tracePoints: [
          { x: 181, y: 813 },
          { x: 181, y: 860 },
          { x: 458, y: 860 },
          { x: 715, y: 860 },
          { x: 458, y: 667 },
          { x: 715, y: 771 },
          { x: 715, y: 521 },
        ],
        traceBranches: [
          // Main bottom ground bus spine
          [
            { x: 181, y: 813 },
            { x: 181, y: 860 },
            { x: 458, y: 860 },
            { x: 715, y: 860 },
            { x: 715, y: 771 },
          ],
          // U1 Pin 3 / Tab ground riser
          [
            { x: 458, y: 667 },
            { x: 458, y: 860 },
          ],
          // C2 negative ground riser
          [
            { x: 715, y: 521 },
            { x: 795, y: 521 },
            { x: 795, y: 860 },
            { x: 715, y: 860 },
          ],
        ],
        confidenceScore: 0.98,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
    ],
    hotspots: [
      {
        id: 'sample-ldo-thermal',
        label: 'LDO Linear Drop Dissipation Zone (U1 Tab)',
        severity: 'INFO',
        bbox: { ymin: 220, xmin: 375, ymax: 735, xmax: 635 },
        suspectComponentRef: 'U1',
        notes:
          'Normal linear power dissipation: P = (12.25V - 5.0V) × I_load. If 5V VREF is shorted to GND externally (e.g., chafed TPS/MAP harness), U1 hits current limit (~650mA) and thermally cycles at 150°C.',
        source: 'AI',
      },
      {
        id: 'sample-tvs-stress',
        label: 'Load-Dump Clamp Overvoltage Failure Zone',
        severity: 'WARNING',
        bbox: { ymin: 360, xmin: 790, ymax: 670, xmax: 915 },
        suspectComponentRef: 'TVS1',
        notes:
          'Verify bidirectional TVS1 resistance in-circuit (>10MΩ normal). A 24V truck jump-start or sustained alternator regulator runaway (>27V) causes TVS1 to fail as a dead short (<0.5Ω), blowing the KL30 fuse.',
        source: 'AI',
      },
    ],
  },
  {
    id: 'sample-can-stage',
    name: 'High-Speed CAN Transceiver Stage',
    type: 'ISO 11898-2 High-Speed CAN Bus Interface PCB',
    oemReference: 'NXP TJA1050 / Bosch Controller Area Network Physical Layer',
    imageSrc: '/src/assets/images/pcb_can_stage_1794671234715.jpg',
    summary:
      'NXP TJA1050 1 Mbps High-Speed CAN transceiver with dual 60.4Ω 1% split termination resistors (R1/R2) and 4.7nF common-mode EMI stabilization capacitor (C3) referenced to VREF (2.5V).',
    pcbSpecs: {
      layers: 4,
      copperWeightOz: 1.0,
      substrate: 'FR4 Controlled Differential Impedance (120Ω)',
      finish: 'HASL Lead-Free / Automotive Grade',
    },
    components: [
      {
        refDes: 'U2',
        category: 'CAN_TRANSCEIVER',
        marking: 'TJA1050',
        decodedValue: 'High-Speed CAN Transceiver (1 Mbps ISO 11898-2)',
        packageType: 'SOIC-8',
        bbox: { ymin: 320, xmin: 325, ymax: 635, xmax: 610 },
        confidenceScore: 0.98,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Differential High-Speed CAN Bus Physical Layer Interface',
        terminalIds: ['U2-1', 'U2-2', 'U2-3', 'U2-4', 'U2-5', 'U2-6', 'U2-7', 'U2-8'],
        notes:
          'Standard TJA1050 has a single 5V VCC rail (no separate VIO pin; RXD swings to 5V VCC, while TXD accepts 3.3V/5V TTL thresholds). Pin 8 (S) tied to GND enables normal high-speed transmit/receive mode.',
        operatingVoltageRange: '4.75V – 5.25V DC (Bus pins -27V to +40V fault-tolerant)',
        maxCurrentRating: '50 mA Dominant / 6 mA Recessive',
        datasheetSummary:
          'ISO 11898-2 compliant up to 1 Mbaud, matched output propagation delay, VREF (0.5×VCC = 2.5V) output for split termination stabilization, passive behavior when unpowered, >6kV ESD protection.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'TXD',
            category: 'signal_in',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_MCU_TX',
            notes: 'Transmit data input from MCU CAN controller (internal pull-up to VCC; HIGH = recessive idle)',
          },
          {
            pinNumber: 2,
            pinName: 'GND',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Transceiver ground reference',
          },
          {
            pinNumber: 3,
            pinName: 'VCC',
            category: 'power',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_5V_REGULATED',
            notes: 'Regulated +5.00V transceiver power supply input',
          },
          {
            pinNumber: 4,
            pinName: 'RXD',
            category: 'signal_out',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_MCU_RX',
            notes: 'Receive data push-pull output to MCU (driven to VCC = 5.0V in recessive bus state, 0V in dominant state)',
          },
          {
            pinNumber: 5,
            pinName: 'VREF',
            category: 'power',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_SPLIT',
            notes: '0.5 × VCC (2.50V) reference voltage output stabilizing the R1/R2 split termination midpoint',
          },
          {
            pinNumber: 6,
            pinName: 'CANL',
            category: 'bus',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_LOW',
            notes: 'High-Speed CAN-Low bus line (2.5V recessive idle; pulls down to ~1.5V during dominant bit)',
          },
          {
            pinNumber: 7,
            pinName: 'CANH',
            category: 'bus',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_HIGH',
            notes: 'High-Speed CAN-High bus line (2.5V recessive idle; pulls up to ~3.5V during dominant bit)',
          },
          {
            pinNumber: 8,
            pinName: 'S (SILENT)',
            category: 'signal_in',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Silent mode control input (LOW = Normal high-speed Tx/Rx enabled; HIGH = Tx disabled, listen-only)',
          },
        ],
      },
      {
        refDes: 'R1',
        category: 'RESISTOR',
        marking: '60R4',
        decodedValue: '60.4 Ω ±1% Precision Metal Film',
        packageType: '0805 (Metric 2012)',
        bbox: { ymin: 340, xmin: 690, ymax: 425, xmax: 820 },
        confidenceScore: 0.96,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'CAN Split Termination Upper Arm (CANH to Split Node)',
        terminalIds: ['R1-1', 'R1-2'],
        notes: 'In series with R2 (60.4Ω + 60.4Ω = 120.8Ω differential termination across CANH and CANL).',
        operatingVoltageRange: '0.25W Pulse-Withstanding Automotive Grade',
        maxCurrentRating: '65 mA Continuous',
        datasheetSummary:
          'AEC-Q200 sulfur-resistant thin-film resistor. Tight 1% tolerance prevents common-mode-to-differential mode conversion on the twisted pair.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'TERM 1',
            category: 'bus',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_HIGH',
            notes: 'Connected to CANH differential trace',
          },
          {
            pinNumber: 2,
            pinName: 'TERM 2',
            category: 'bus',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_SPLIT',
            notes: 'Connected to 2.5V split termination center tap',
          },
        ],
      },
      {
        refDes: 'R2',
        category: 'RESISTOR',
        marking: '60R4',
        decodedValue: '60.4 Ω ±1% Precision Metal Film',
        packageType: '0805 (Metric 2012)',
        bbox: { ymin: 545, xmin: 690, ymax: 625, xmax: 820 },
        confidenceScore: 0.96,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'CAN Split Termination Lower Arm (CANL to Split Node)',
        terminalIds: ['R2-1', 'R2-2'],
        notes: 'Combined with R1 and remote 120Ω bus terminator, yields 60Ω total DC resistance between CANH and CANL.',
        operatingVoltageRange: '0.25W Pulse-Withstanding Automotive Grade',
        maxCurrentRating: '65 mA Continuous',
        datasheetSummary:
          'AEC-Q200 sulfur-resistant thin-film resistor matching R1 to maintain balanced differential signaling.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'TERM 1',
            category: 'bus',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_LOW',
            notes: 'Connected to CANL differential trace',
          },
          {
            pinNumber: 2,
            pinName: 'TERM 2',
            category: 'bus',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_SPLIT',
            notes: 'Connected to 2.5V split termination center tap',
          },
        ],
      },
      {
        refDes: 'C3',
        category: 'CAPACITOR',
        marking: '4n7',
        decodedValue: '4.7 nF / 50V C0G/NP0 MLCC',
        packageType: '0603 (Metric 1608)',
        bbox: { ymin: 420, xmin: 870, ymax: 560, xmax: 920 },
        confidenceScore: 0.93,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Split Termination Common-Mode HF Noise Filter Capacitor',
        terminalIds: ['C3-1', 'C3-2'],
        notes: 'Forms a low-pass RC filter (fc ≈ 1 / (2π × 30.2Ω × 4.7nF) ≈ 1.12 MHz) shunting common-mode RF interference to ground.',
        operatingVoltageRange: '50V DC C0G/NP0 Dielectric',
        maxCurrentRating: 'N/A',
        datasheetSummary:
          'Zero-piezoelectric C0G dielectric capacitor providing low-impedance shunt path for common-mode EMI on the split termination midpoint.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'TERM 1',
            category: 'bus',
            nominalVoltage: 2.5,
            connectedNetId: 'NET_CAN_SPLIT',
            notes: 'Split termination center tap (2.5V DC)',
          },
          {
            pinNumber: 2,
            pinName: 'TERM 2',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Clean RF chassis ground return',
          },
        ],
      },
    ],
    nets: [
      {
        name: 'NET_CAN_HIGH',
        signalType: 'CAN_DIFFERENTIAL',
        nominalVoltage: 2.5,
        traceWidthMm: 0.35,
        impedanceOhms: 60.0,
        connectedComponentRefs: ['U2', 'R1'],
        connectedTerminalIds: ['U2-7', 'R1-1'],
        tracePoints: [
          { x: 528, y: 458 },
          { x: 575, y: 458 },
          { x: 575, y: 406 },
          { x: 611, y: 406 },
        ],
        traceBranches: [
          [
            { x: 528, y: 458 },
            { x: 575, y: 458 },
            { x: 575, y: 406 },
            { x: 611, y: 406 },
          ],
        ],
        confidenceScore: 0.97,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_CAN_LOW',
        signalType: 'CAN_DIFFERENTIAL',
        nominalVoltage: 2.5,
        traceWidthMm: 0.35,
        impedanceOhms: 60.0,
        connectedComponentRefs: ['U2', 'R2'],
        connectedTerminalIds: ['U2-6', 'R2-1'],
        tracePoints: [
          { x: 528, y: 583 },
          { x: 575, y: 583 },
          { x: 575, y: 656 },
          { x: 611, y: 656 },
        ],
        traceBranches: [
          [
            { x: 528, y: 583 },
            { x: 575, y: 583 },
            { x: 575, y: 656 },
            { x: 611, y: 656 },
          ],
        ],
        confidenceScore: 0.97,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_CAN_SPLIT',
        signalType: 'CAN_DIFFERENTIAL',
        nominalVoltage: 2.5,
        traceWidthMm: 0.4,
        impedanceOhms: 0.08,
        connectedComponentRefs: ['U2', 'R1', 'R2', 'C3'],
        connectedTerminalIds: ['U2-5', 'R1-2', 'R2-2', 'C3-1'],
        tracePoints: [
          { x: 528, y: 531 },
          { x: 708, y: 531 },
          { x: 708, y: 406 },
          { x: 708, y: 656 },
          { x: 764, y: 531 },
        ],
        traceBranches: [
          // Horizontal VREF bridge from U2 Pin 5 through split node to C3 Pin 1
          [
            { x: 528, y: 531 },
            { x: 708, y: 531 },
            { x: 764, y: 531 },
          ],
          // Vertical tie between R1-2 and R2-2 intersecting at (708, 531)
          [
            { x: 708, y: 406 },
            { x: 708, y: 531 },
            { x: 708, y: 656 },
          ],
        ],
        confidenceScore: 0.95,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_5V_REGULATED',
        signalType: '5V_LOGIC',
        nominalVoltage: 5.0,
        traceWidthMm: 0.8,
        impedanceOhms: 0.05,
        connectedComponentRefs: ['U2'],
        connectedTerminalIds: ['U2-3'],
        tracePoints: [
          { x: 220, y: 520 },
          { x: 333, y: 520 },
        ],
        traceBranches: [
          [
            { x: 220, y: 520 },
            { x: 333, y: 520 },
          ],
        ],
        confidenceScore: 0.95,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_CHASSIS_GND',
        signalType: 'GROUND',
        nominalVoltage: 0.0,
        traceWidthMm: 2.0,
        impedanceOhms: 0.01,
        connectedComponentRefs: ['U2', 'C3'],
        connectedTerminalIds: ['U2-2', 'U2-8', 'C3-2'],
        tracePoints: [
          { x: 333, y: 465 },
          { x: 275, y: 465 },
          { x: 275, y: 780 },
          { x: 833, y: 780 },
          { x: 833, y: 531 },
          { x: 528, y: 645 },
        ],
        traceBranches: [
          [
            { x: 333, y: 465 },
            { x: 275, y: 465 },
            { x: 275, y: 780 },
            { x: 833, y: 780 },
            { x: 833, y: 531 },
          ],
          [
            { x: 528, y: 645 },
            { x: 528, y: 780 },
          ],
        ],
        confidenceScore: 0.96,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
    ],
    hotspots: [
      {
        id: 'sample-can-esd',
        label: 'CANH/CANL ESD & Short-to-Battery Stress Zone',
        severity: 'INFO',
        bbox: { ymin: 315, xmin: 315, ymax: 645, xmax: 620 },
        suspectComponentRef: 'U2',
        notes:
          'Measure differential resistance across R1+R2 (120.8Ω local, 60Ω on complete bus) and diode drop from CANH/CANL (Pins 6 & 7) to GND. Shorted internal ESD clamp locks bus dominant or silent.',
        source: 'AI',
      },
    ],
  },
  {
    id: 'sample-injector-stage',
    name: 'Injector MOSFET & Flyback Clamp Stage',
    type: 'Low-Side Smart Power Actuator Driver PCB',
    oemReference: 'Infineon BTS141 / Bosch Fuel Injector Driver Topology',
    imageSrc: '/src/assets/images/pcb_injector_stage_1794671235614.jpg',
    summary:
      'Low-side smart power MOSFET injector sink (Q1 BTS141) wired to ECU Pin #10 (INJ_1), protected by a 45V active inductive flyback clamp (D2 SMBJ45A) and 50mΩ current-sense shunt (R3 0R05).',
    pcbSpecs: {
      layers: 4,
      copperWeightOz: 2.0,
      substrate: 'High-Tg FR4 w/ 2oz Heavy Copper Drain Pour',
      finish: 'ENIG Automotive High-Current',
    },
    components: [
      {
        refDes: 'Q1',
        category: 'MOSFET_DRIVER',
        marking: 'BTS141',
        decodedValue: '60V / 25A Smart Low-Side HITFET',
        packageType: 'TO-252-3 (DPAK)',
        bbox: { ymin: 240, xmin: 410, ymax: 625, xmax: 595 },
        confidenceScore: 0.98,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Low-Side Fuel Injector Solenoid Sink & Thermal-Protected Switch',
        terminalIds: ['Q1-G', 'Q1-D', 'Q1-S'],
        notes:
          'Drives ECU Pin #10 (INJ_1) low during injection dwell pulses (2.5–3.8ms) and integrates overtemperature/overcurrent protection.',
        operatingVoltageRange: '60V VDS Max (Active clamp ~48V)',
        maxCurrentRating: '25 A Peak / 28 mΩ Rds(on)',
        datasheetSummary:
          'Logic-level gate drive from 5V MCU buffer; internal active Zener drain-to-gate clamp limits inductive solenoid flyback below 55V.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'GATE (IN)',
            category: 'signal_in',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_5V_REGULATED',
            notes: '5V PWM gate command via 100Ω gate drive resistor',
          },
          {
            pinNumber: 2,
            pinName: 'DRAIN (INJ_1)',
            category: 'driver_out',
            nominalVoltage: 12.25,
            connectedNetId: 'NET_INJ_1_LOW',
            notes: 'Connects directly to ECU Pin #10 (INJ_1) low-side injector coil return',
          },
          {
            pinNumber: 3,
            pinName: 'SOURCE (SENSE)',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_SHUNT_SENSE',
            notes: 'Returns injector sink current through 50mΩ shunt R3 to Chassis GND',
          },
        ],
      },
      {
        refDes: 'R3',
        category: 'SHUNT_RESISTOR',
        marking: '0R05',
        decodedValue: '0.05 Ω ±1% / 2W Current-Sense Shunt',
        packageType: '2512 Kelvin SMD',
        bbox: { ymin: 695, xmin: 375, ymax: 875, xmax: 635 },
        confidenceScore: 0.96,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Injector Peak/Hold Current Monitoring Shunt',
        terminalIds: ['R3-1', 'R3-2'],
        notes: 'Generates 50mV per Amp feedback to ECU current-limit comparator.',
        operatingVoltageRange: '2W Continuous Power',
        maxCurrentRating: '6.3 A RMS',
        datasheetSummary: 'Manganin precision low-TCR shunt resistor (0.05Ω). Check for cracked end-caps on misfire DTC P0201.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'KELVIN (+)',
            category: 'ground',
            nominalVoltage: 0.05,
            connectedNetId: 'NET_SHUNT_SENSE',
            notes: 'MOSFET Source Kelvin sense tap',
          },
          {
            pinNumber: 2,
            pinName: 'GND (-)',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Power ground plane return (KL31)',
          },
        ],
      },
      {
        refDes: 'D2',
        category: 'ZENER_CLAMP',
        marking: 'SMBJ45A',
        decodedValue: '45V Unidirectional Flyback TVS Clamp',
        packageType: 'SMB (DO-214AA)',
        bbox: { ymin: 315, xmin: 715, ymax: 605, xmax: 825 },
        confidenceScore: 0.95,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'External Solenoid Inductive Kickback Clamp',
        terminalIds: ['D2-K', 'D2-A'],
        notes: 'Limits inductive flyback spikes on INJ_1 (#10) during rapid MOSFET turn-off.',
        operatingVoltageRange: '45V Standoff / 50V Breakdown',
        maxCurrentRating: '600 W Peak Pulse',
        datasheetSummary: 'Fast-recovery avalanche clamp protecting Q1 drain during inductive load turn-off.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'CATHODE (K)',
            category: 'driver_out',
            nominalVoltage: 12.25,
            connectedNetId: 'NET_INJ_1_LOW',
            notes: 'Clamps high-voltage inductive spike on INJ_1 drain pour',
          },
          {
            pinNumber: 2,
            pinName: 'ANODE (A)',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Chassis ground clamp return',
          },
        ],
      },
      {
        refDes: 'C4',
        category: 'CAPACITOR',
        marking: '104K 50V',
        decodedValue: '100 nF / 50V X7R Snubber MLCC',
        packageType: '0805 SMD',
        bbox: { ymin: 405, xmin: 205, ymax: 595, xmax: 275 },
        confidenceScore: 0.93,
        verificationStatus: 'VERIFIED',
        circuitFunction: 'Gate Drive & 5V Logic Decoupling Capacitor',
        terminalIds: ['C4-1', 'C4-2'],
        notes: 'Suppresses dV/dt ringing on MOSFET gate bus.',
        operatingVoltageRange: '50V DC X7R AEC-Q200',
        maxCurrentRating: 'N/A',
        datasheetSummary: 'Automotive MLCC flex-termination capacitor preventing solder-flex cracking.',
        source: 'MANUAL',
        pinSpecs: [
          {
            pinNumber: 1,
            pinName: 'VCC',
            category: 'power',
            nominalVoltage: 5.0,
            connectedNetId: 'NET_5V_REGULATED',
            notes: '5V gate buffer supply rail',
          },
          {
            pinNumber: 2,
            pinName: 'GND',
            category: 'ground',
            nominalVoltage: 0.0,
            connectedNetId: 'NET_CHASSIS_GND',
            notes: 'Signal ground return',
          },
        ],
      },
    ],
    nets: [
      {
        name: 'NET_INJ_1_LOW',
        signalType: 'ACTUATOR_PWM',
        nominalVoltage: 12.25,
        traceWidthMm: 2.5,
        impedanceOhms: 0.02,
        connectedComponentRefs: ['Q1', 'D2'],
        connectedTerminalIds: ['Q1-D', 'D2-K'],
        tracePoints: [
          { x: 590, y: 510 },
          { x: 645, y: 510 },
          { x: 645, y: 440 },
          { x: 690, y: 440 },
        ],
        traceBranches: [
          [
            { x: 590, y: 510 },
            { x: 645, y: 510 },
            { x: 645, y: 440 },
            { x: 690, y: 440 },
          ],
        ],
        confidenceScore: 0.97,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_5V_REGULATED',
        signalType: '5V_LOGIC',
        nominalVoltage: 5.0,
        traceWidthMm: 0.6,
        impedanceOhms: 0.05,
        connectedComponentRefs: ['C4', 'Q1'],
        connectedTerminalIds: ['C4-1', 'Q1-G'],
        tracePoints: [
          { x: 265, y: 480 },
          { x: 325, y: 480 },
          { x: 325, y: 435 },
          { x: 380, y: 435 },
        ],
        traceBranches: [
          [
            { x: 265, y: 480 },
            { x: 325, y: 480 },
            { x: 325, y: 435 },
            { x: 380, y: 435 },
          ],
        ],
        confidenceScore: 0.95,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_SHUNT_SENSE',
        signalType: 'SIGNAL_TRACE',
        nominalVoltage: 0.05,
        traceWidthMm: 2.0,
        impedanceOhms: 0.015,
        connectedComponentRefs: ['Q1', 'R3'],
        connectedTerminalIds: ['Q1-S', 'R3-1'],
        tracePoints: [
          { x: 485, y: 660 },
          { x: 485, y: 710 },
        ],
        traceBranches: [
          [
            { x: 485, y: 660 },
            { x: 485, y: 710 },
          ],
        ],
        confidenceScore: 0.96,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
      {
        name: 'NET_CHASSIS_GND',
        signalType: 'GROUND',
        nominalVoltage: 0.0,
        traceWidthMm: 3.5,
        impedanceOhms: 0.008,
        connectedComponentRefs: ['C4', 'R3', 'D2'],
        connectedTerminalIds: ['C4-2', 'R3-2', 'D2-A'],
        tracePoints: [
          { x: 215, y: 540 },
          { x: 215, y: 875 },
          { x: 485, y: 875 },
          { x: 758, y: 875 },
          { x: 758, y: 515 },
        ],
        traceBranches: [
          [
            { x: 215, y: 540 },
            { x: 215, y: 875 },
            { x: 758, y: 875 },
            { x: 758, y: 515 },
          ],
          [
            { x: 485, y: 830 },
            { x: 485, y: 875 },
          ],
        ],
        confidenceScore: 0.97,
        verificationStatus: 'VERIFIED',
        isComplete: true,
      },
    ],
    hotspots: [
      {
        id: 'sample-inj-drain-thermal',
        label: 'Q1 Drain Flyback & Short-to-VBAT Stress Zone',
        severity: 'WARNING',
        bbox: { ymin: 155, xmin: 300, ymax: 645, xmax: 700 },
        suspectComponentRef: 'Q1',
        notes:
          'Check INJ_1 (#10) injector coil resistance (11–16Ω petrol) before powering ECU. A shorted injector coil pulls Q1 into thermal foldback.',
        source: 'AI',
      },
    ],
  },
];

const OEM_PCB_BOARDS: SampleBoard[] = ECU_BRAND_PROFILES.filter(
  (p) => Boolean(p.pcbImageSrc && p.pcbComponents && p.pcbComponents.length > 0)
).map((p) => convertOemProfileToPcbBoard(p));

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export const SchematicPcbScanner: React.FC<SchematicPcbScannerProps> = ({
  onOpenGroundedSearch,
  onOpenOfflineBot,
  onOpenCloudModal,
  nodeVoltages,
  supplyCurrentDrawAmps,
  powerSupply,
  faults,
}) => {
  const { user, authReady } = useAuth();

  // Board & Analysis State
  const [selectedBoard, setSelectedBoard] = useState<SampleBoard>(SAMPLE_BOARDS[0]);
  const [boardTitle, setBoardTitle] = useState<string>(SAMPLE_BOARDS[0].name);
  const [boardType, setBoardType] = useState<string>(SAMPLE_BOARDS[0].type);
  const [analysisSummary, setAnalysisSummary] = useState<string>(SAMPLE_BOARDS[0].summary);
  const [analysisModel, setAnalysisModel] = useState<string>('preset-reference');

  const [components, setComponents] = useState<DetailedPcbComponent[]>(SAMPLE_BOARDS[0].components);
  const [nets, setNets] = useState<ExtendedImageAnalysisNet[]>(SAMPLE_BOARDS[0].nets);
  const [hotspots, setHotspots] = useState<ImageAnalysisHotspot[]>(SAMPLE_BOARDS[0].hotspots);

  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string>(
    'AI & LOCAL CV ENGINE ONLINE · Drag boxes to adjust, hover pins to trace nets, or upload any ECU PCB photo'
  );
  const [uploadedImageUrl, setUploadedImageUrl] = useState<string | null>(
    SAMPLE_BOARDS[0].imageSrc || null
  );
  const [boardAspect, setBoardAspect] = useState<number>(4 / 3); // width / height
  const [showPhotoTexture, setShowPhotoTexture] = useState<boolean>(true);

  // Selection & Highlighting State
  const [selectedCompRef, setSelectedCompRef] = useState<string | null>('U1');
  const [activeNetId, setActiveNetId] = useState<string | null>('NET_5V_REGULATED');
  const [hoveredPinNetId, setHoveredPinNetId] = useState<string | null>(null);
  const effectiveNetId = hoveredPinNetId || activeNetId;
  const [selectedPinNumber, setSelectedPinNumber] = useState<number | null>(5);
  const [selectedHotspotId, setSelectedHotspotId] = useState<string | null>(null);
  const [tracePathPair, setTracePathPair] = useState<[string | null, string | null]>([null, null]);

  // Hovered Node Exact MNA Voltage Tooltip State
  const [hoveredNodeTooltip, setHoveredNodeTooltip] = useState<{
    nodeLabel: string;
    compRefDes?: string;
    pinNumber?: number;
    pinName?: string;
    netId: string;
    mnaSourceNode: string;
    detectedVoltage: number;
    nominalVoltage: number;
    category?: string;
    notes?: string;
    xNorm: number;
    yNorm: number;
  } | null>(null);

  // Filtering & UI Navigation State
  const [searchTerm, setSearchTerm] = useState('');
  const [filterMode, setFilterMode] = useState<'ALL' | 'VERIFIED' | 'UNVERIFIED'>('ALL');
  const [mobileTab, setMobileTab] = useState<'CANVAS' | 'DRAWER'>('CANVAS');
  const [inspectorSubTab, setInspectorSubTab] = useState<'PART' | 'NETS' | 'PROBE' | 'AUDIT' | 'THERMAL'>('PART');

  // Interactive Modes, Optical Filters & Layer Visibility
  const [interactionMode, setInteractionMode] = useState<InteractionMode>('EDIT');
  const [opticalFilter, setOpticalFilter] = useState<OpticalFilterMode>('NORMAL');
  const [showAddPartMenu, setShowAddPartMenu] = useState(false);
  const [probeA, setProbeA] = useState<ProbeNodeTarget | null>(null);
  const [probeB, setProbeB] = useState<ProbeNodeTarget | null>(null);
  const [nextProbeSlot, setNextProbeSlot] = useState<'A' | 'B'>('A');
  const [cropMarquee, setCropMarquee] = useState<PcbNormalizedBox | null>(null);
  const [showComponents, setShowComponents] = useState(true);
  const [showNets, setShowNets] = useState(true);
  const [showPinMarkers, setShowPinMarkers] = useState(true);
  const [showVoltageLabels, setShowVoltageLabels] = useState(true);
  const [showHotspots, setShowHotspots] = useState(true);
  const [showThermalHeatmap, setShowThermalHeatmap] = useState(false);
  const [showDatasheetInfo, setShowDatasheetInfo] = useState(false);
  const [clickedDatasheetNode, setClickedDatasheetNode] = useState<{
    compRefDes: string;
    pinNumber?: number;
    pinName?: string;
    netId?: string;
    xNorm: number;
    yNorm: number;
  } | null>(null);
  const [zoomLevel, setZoomLevel] = useState(1.0);
  const [ambientTempC, setAmbientTempC] = useState<number>(25);

  // Cloud Saved PCB Scans state
  const [savedScans, setSavedScans] = useState<SavedPcbScan[]>([]);
  const [showSavedScansPanel, setShowSavedScansPanel] = useState(false);
  const [isSavingScan, setIsSavingScan] = useState(false);

  // Quick Net Creation state
  const [newNetName, setNewNetName] = useState('');

  // Refs for DOM & Stale-Closure-Free Pointer Interaction
  const viewportScrollRef = useRef<HTMLDivElement | null>(null);
  const boardRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<InteractionDrag | null>(null);
  const cropMarqueeRef = useRef<PcbNormalizedBox | null>(null);
  const lastLocalCvRef = useRef<LocalPcbCvOutput | null>(null);

  // Latest state refs so global pointer listeners don't need to rebind on every 60fps drag frame
  const componentsRef = useRef<DetailedPcbComponent[]>(components);
  useEffect(() => {
    componentsRef.current = components;
  }, [components]);

  const executeMacroCropScanRef = useRef<(box: PcbNormalizedBox) => Promise<void>>(async () => {});

  // Subscribe to user's saved PCB scans in Firestore
  useEffect(() => {
    if (!authReady || !user) {
      setSavedScans([]);
      return;
    }
    const unsub = subscribePcbScans(
      user.uid,
      (scans) => setSavedScans(scans),
      () => {}
    );
    return () => unsub();
  }, [authReady, user]);

  // Revoke ObjectURL on change/unmount
  useEffect(() => {
    return () => {
      if (uploadedImageUrl && uploadedImageUrl.startsWith('blob:')) {
        URL.revokeObjectURL(uploadedImageUrl);
      }
    };
  }, [uploadedImageUrl]);

  // ============================================================================
  // LIVE MNA NODE VOLTAGE, ELECTRO-THERMAL, DUAL-PROBE & AUDIT ENGINE
  // ============================================================================

  const resolveMnaNodeDetails = useCallback(
    (netName: string | undefined, fallbackNominal: number) =>
      resolvePcbNetToMnaNode(netName, fallbackNominal, nodeVoltages, powerSupply),
    [nodeVoltages, powerSupply]
  );

  const resolveLiveNetVoltage = useCallback(
    (netName: string | undefined, fallbackNominal: number): number =>
      resolvePcbNetToMnaNode(netName, fallbackNominal, nodeVoltages, powerSupply).voltage,
    [nodeVoltages, powerSupply]
  );

  const componentThermalMap = useMemo<Record<string, ComponentThermalProfile>>(
    () =>
      computePcbThermalMap({
        components,
        powerSupply,
        supplyCurrentDrawAmps,
        nodeVoltages,
        faults,
        ambientTempC,
      }),
    [components, powerSupply, supplyCurrentDrawAmps, nodeVoltages, faults, ambientTempC]
  );

  const dualProbeMeasurement = useMemo(() => {
    if (!probeA || !probeB) return null;
    return measureDualProbePcb({
      probeA,
      probeB,
      components,
      nets,
      nodeVoltages,
      powerSupply,
      faults,
    });
  }, [probeA, probeB, components, nets, nodeVoltages, powerSupply, faults]);

  const boardAuditFindings = useMemo(
    () =>
      auditPcbDiagnostics({
        components,
        nets,
        hotspots,
        thermalMap: componentThermalMap,
        nodeVoltages,
        powerSupply,
        faults,
      }),
    [components, nets, hotspots, componentThermalMap, nodeVoltages, powerSupply, faults]
  );

  const peakBoardTempC = useMemo(() => {
    const temps = Object.values(componentThermalMap).map((t) => t.tempC);
    return temps.length > 0 ? Math.max(...temps) : ambientTempC;
  }, [componentThermalMap, ambientTempC]);

  const criticalAuditCount = useMemo(
    () => boardAuditFindings.filter((f) => f.severity === 'CRITICAL').length,
    [boardAuditFindings]
  );

  const handlePlaceProbe = useCallback(
    (target: ProbeNodeTarget) => {
      if (nextProbeSlot === 'A') {
        setProbeA(target);
        setNextProbeSlot('B');
        setInspectorSubTab('PROBE');
        setStatusMessage(
          `PROBE A (RED) anchored on ${target.label} [${target.netId}] — click a second node for Probe B (BLACK).`
        );
      } else {
        setProbeB(target);
        setNextProbeSlot('A');
        setInspectorSubTab('PROBE');
        setStatusMessage(
          `DUAL PROBE ACTIVE: A (${probeA?.label || 'Node A'}) ↔ B (${target.label})`
        );
      }
    },
    [nextProbeSlot, probeA]
  );

  // ============================================================================
  // IMAGE PROCESSING, HYBRID VISION & MACRO CROP PIPELINE
  // ============================================================================

  const prepareOptimizedPcbImage = async (
    file: File
  ): Promise<{
    previewUrl: string;
    imageBase64: string;
    mimeType: string;
    aspect: number;
    localCv: LocalPcbCvOutput;
  }> => {
    const MAX_DIM = 1600;
    const rawUrl = URL.createObjectURL(file);
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image();
        el.onload = () => resolve(el);
        el.onerror = () => reject(new Error('Failed to decode uploaded PCB image'));
        el.src = rawUrl;
      });

      const natW = img.naturalWidth || 1200;
      const natH = img.naturalHeight || 800;
      const scale = Math.min(1, MAX_DIM / Math.max(natW, natH));
      const targetW = Math.max(1, Math.round(natW * scale));
      const targetH = Math.max(1, Math.round(natH * scale));

      const canvas = document.createElement('canvas');
      canvas.width = targetW;
      canvas.height = targetH;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('Canvas 2D context unavailable');
      ctx.drawImage(img, 0, 0, targetW, targetH);

      const localCv = runLocalPcbCv(canvas);

      const blob = await new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (result) => (result ? resolve(result) : reject(new Error('Image compression failed'))),
          'image/jpeg',
          0.86
        );
      });

      const dataUrl = canvas.toDataURL('image/jpeg', 0.86);
      const imageBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;

      canvas.width = 0;
      canvas.height = 0;

      return {
        previewUrl: URL.createObjectURL(blob),
        imageBase64,
        mimeType: 'image/jpeg',
        aspect: targetW / targetH,
        localCv,
      };
    } finally {
      URL.revokeObjectURL(rawUrl);
    }
  };

  // Load Sample or OEM Board Preset
  const loadSample = (board: SampleBoard) => {
    setSelectedBoard(board);
    setBoardTitle(board.name);
    setBoardType(board.type);
    setAnalysisSummary(board.summary);
    setAnalysisModel(board.imageSrc ? 'oem-board-reference' : 'preset-reference');
    setComponents(board.components);
    setNets(board.nets);
    setHotspots(board.hotspots);
    setUploadedImageUrl(board.imageSrc || null);
    setBoardAspect(1.5);
    setInteractionMode('EDIT');
    setCropMarquee(null);
    setProbeA(null);
    setProbeB(null);
    setNextProbeSlot('A');
    setSelectedCompRef(board.components[0]?.refDes || null);
    setActiveNetId(board.nets[0]?.name || null);
    setSelectedPinNumber(board.components[0]?.pinSpecs?.[0]?.pinNumber || 1);
    setSelectedHotspotId(board.hotspots[0]?.id || null);
    setTracePathPair([null, null]);
    setClickedDatasheetNode(null);
    setStatusMessage(
      board.imageSrc
        ? `Loaded OEM ECU PCB Photography: ${board.name} (${board.components.length} mapped stages)`
        : `Loaded Reference Stage Preset: ${board.name}`
    );
  };

  const handleFitBoardToViewport = () => {
    const vp = viewportScrollRef.current;
    if (!vp) {
      setZoomLevel(1.0);
      return;
    }
    const availW = Math.max(320, vp.clientWidth - 48);
    const availH = Math.max(260, vp.clientHeight - 72);
    const baseH = 740 / Math.max(0.5, Math.min(2.2, boardAspect));
    const fitZoom = Math.min(availW / 740, availH / baseH);
    setZoomLevel(Math.min(2.4, Math.max(0.55, Number(fitZoom.toFixed(2)))));
  };

  // Automatic Upload & Hybrid Vision Mapping
  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.size > 12 * 1024 * 1024) {
      setStatusMessage('ERROR: File size exceeds 12 MB upload limit.');
      return;
    }

    setIsAnalyzing(true);
    setInteractionMode('EDIT');
    setCropMarquee(null);
    setTracePathPair([null, null]);
    setClickedDatasheetNode(null);
    setStatusMessage('PHASE 1/2: Running Local Sobel/Pad CV & optimizing photo...');

    try {
      const { previewUrl, imageBase64, mimeType, aspect, localCv } = await prepareOptimizedPcbImage(file);
      lastLocalCvRef.current = localCv;
      setUploadedImageUrl(previewUrl);
      setBoardAspect(aspect);
      setBoardTitle(file.name.replace(/\.[^.]+$/, ''));
      setBoardType('Uploaded Automotive ECU PCB');

      if (localCv.components.length > 0 || localCv.hotspots.length > 0) {
        const draft = fusePcbVisionResults(null, localCv);
        setComponents(draft.components);
        setNets(draft.nets);
        setHotspots(draft.hotspots || []);
        setSelectedCompRef(draft.components[0]?.refDes || null);
        setActiveNetId(draft.nets[0]?.name || null);
      }

      setStatusMessage('PHASE 2/2: Mapping ICs, pinouts & copper traces with Gemini Vision...');

      let aiResult: ImageAnalysisResult | null = null;
      try {
        aiResult = await analyzePcbImage({
          imageBase64,
          mimeType,
          documentName: file.name,
          documentType: 'pcb',
        });
      } catch (aiErr) {
        console.warn('AI analysis fallback to Local CV:', aiErr);
      }

      const fused = fusePcbVisionResults(
        aiResult && aiResult.detectionMethod === 'AI_ANALYZED' ? aiResult : null,
        localCv
      );

      setComponents(fused.components);
      setNets(fused.nets);
      setHotspots(fused.hotspots || []);
      setAnalysisSummary(fused.analysisSummary);
      setAnalysisModel(fused.model);
      setSelectedCompRef(fused.components[0]?.refDes || null);
      setActiveNetId(fused.nets[0]?.name || null);
      setSelectedHotspotId(fused.hotspots?.[0]?.id || null);

      if (fused.detectionMethod === 'AI_ANALYZED') {
        setStatusMessage(
          `AUTO-MAP COMPLETE (${fused.model}): ${fused.components.length} parts, ${fused.nets.length} nets, ${fused.hotspots?.length || 0} hotspots`
        );
      } else {
        setStatusMessage(
          `LOCAL CV MAPPED (Offline Mode): ${fused.components.length} clusters, ${fused.nets.length} trace links, ${fused.hotspots?.length || 0} hotspots`
        );
      }
    } catch (err) {
      console.error('PCB upload pipeline error:', err);
      setStatusMessage('ERROR: Could not decode PCB image. Try a standard PNG/JPG photo.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Re-run deterministic Local CV hotspot & cluster scan on current uploaded image
  const handleRerunLocalCv = async () => {
    if (!uploadedImageUrl) return;
    setIsAnalyzing(true);
    setStatusMessage('Running local Sobel/thermal hotspot CV scan...');
    try {
      const { localCv } = await cropPcbRegionToJpegBase64(uploadedImageUrl, {
        ymin: 0,
        xmin: 0,
        ymax: 1000,
        xmax: 1000,
      });
      lastLocalCvRef.current = localCv;
      const fused = fusePcbVisionResults(
        {
          documentType: 'pcb',
          confidenceScore: 0.85,
          detectionMethod: 'AI_ANALYZED',
          analysisSummary,
          components,
          terminals: [],
          nets,
          hotspots,
          warnings: [],
          model: analysisModel,
          provider: 'hybrid',
        },
        localCv
      );
      setComponents(fused.components);
      setNets(fused.nets);
      setHotspots(fused.hotspots || []);
      setStatusMessage(
        `LOCAL CV REFRESHED: ${fused.hotspots?.length || 0} hotspot(s) & ${fused.components.length} components mapped.`
      );
    } catch (err) {
      console.warn('Local CV refresh failed:', err);
      setStatusMessage('Local CV refresh failed on current board.');
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Execute Macro Crop Re-Scan on selected normalized [0..1000] rectangle
  const executeMacroCropScan = useCallback(
    async (cropBox: PcbNormalizedBox) => {
      if (!uploadedImageUrl) return;
      setIsAnalyzing(true);
      setStatusMessage(
        `MACRO CROP SCAN: Zooming region [${cropBox.xmin},${cropBox.ymin}]–[${cropBox.xmax},${cropBox.ymax}]...`
      );
      try {
        const { imageBase64, mimeType, localCv } = await cropPcbRegionToJpegBase64(
          uploadedImageUrl,
          cropBox
        );

        let aiCrop: ImageAnalysisResult | null = null;
        try {
          aiCrop = await analyzePcbImage({
            imageBase64,
            mimeType,
            documentName: `${boardTitle}_macro_crop.jpg`,
            documentType: 'pcb_macro_crop',
            regionBox: cropBox,
          });
        } catch (err) {
          console.warn('Macro crop AI fallback to local CV:', err);
        }

        const fusedCrop = fusePcbVisionResults(
          aiCrop && aiCrop.detectionMethod === 'AI_ANALYZED' ? aiCrop : null,
          localCv
        );

        const merged = mergeMacroCropResults(
          { components, nets, hotspots },
          cropBox,
          fusedCrop
        );

        setComponents(merged.components);
        setNets(merged.nets);
        setHotspots(merged.hotspots);
        setInteractionMode('EDIT');
        setCropMarquee(null);
        setStatusMessage(
          `MACRO CROP MERGED: +${merged.addedCount} new parts, ${merged.updatedCount} refined markings`
        );
      } catch (err) {
        console.warn('Macro crop error:', err);
        setStatusMessage('Macro crop scan failed. Try drawing a slightly larger box.');
      } finally {
        setIsAnalyzing(false);
      }
    },
    [uploadedImageUrl, boardTitle, components, nets, hotspots]
  );

  useEffect(() => {
    executeMacroCropScanRef.current = executeMacroCropScan;
  }, [executeMacroCropScan]);

  // ============================================================================
  // UNIFIED POINTER INTERACTION (MOVE, RESIZE, PAN, CROP, TRACE NODE EDIT)
  // ============================================================================

  useEffect(() => {
    const handlePointerMove = (e: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag) return;

      if (drag.type === 'MOVE') {
        const dxNorm = ((e.clientX - drag.startClientX) / Math.max(1, drag.boardRect.width)) * 1000;
        const dyNorm = ((e.clientY - drag.startClientY) / Math.max(1, drag.boardRect.height)) * 1000;
        const w = drag.origBox.xmax - drag.origBox.xmin;
        const h = drag.origBox.ymax - drag.origBox.ymin;
        const xmin = clampCoord(drag.origBox.xmin + dxNorm, 0, 1000 - w);
        const ymin = clampCoord(drag.origBox.ymin + dyNorm, 0, 1000 - h);
        const nextBox: PcbNormalizedBox = {
          ymin,
          xmin,
          ymax: ymin + h,
          xmax: xmin + w,
        };
        setComponents((prev) =>
          prev.map((c) => (c.refDes === drag.refDes ? { ...c, bbox: nextBox } : c))
        );
      } else if (drag.type === 'RESIZE') {
        const dxNorm = ((e.clientX - drag.startClientX) / Math.max(1, drag.boardRect.width)) * 1000;
        const dyNorm = ((e.clientY - drag.startClientY) / Math.max(1, drag.boardRect.height)) * 1000;
        const xmax = clampCoord(drag.origBox.xmax + dxNorm, drag.origBox.xmin + 20, 1000);
        const ymax = clampCoord(drag.origBox.ymax + dyNorm, drag.origBox.ymin + 20, 1000);
        const nextBox: PcbNormalizedBox = {
          ymin: drag.origBox.ymin,
          xmin: drag.origBox.xmin,
          ymax,
          xmax,
        };
        setComponents((prev) =>
          prev.map((c) => (c.refDes === drag.refDes ? { ...c, bbox: nextBox } : c))
        );
      } else if (drag.type === 'CROP') {
        const currX = clampCoord(((e.clientX - drag.boardRect.left) / Math.max(1, drag.boardRect.width)) * 1000);
        const currY = clampCoord(((e.clientY - drag.boardRect.top) / Math.max(1, drag.boardRect.height)) * 1000);
        const nextBox: PcbNormalizedBox = {
          xmin: Math.min(drag.startXNorm, currX),
          ymin: Math.min(drag.startYNorm, currY),
          xmax: Math.max(drag.startXNorm, currX),
          ymax: Math.max(drag.startYNorm, currY),
        };
        cropMarqueeRef.current = nextBox;
        setCropMarquee(nextBox);
      } else if (drag.type === 'PAN_VIEWPORT') {
        if (viewportScrollRef.current) {
          const dx = e.clientX - drag.startClientX;
          const dy = e.clientY - drag.startClientY;
          viewportScrollRef.current.scrollLeft = drag.startScrollLeft - dx;
          viewportScrollRef.current.scrollTop = drag.startScrollTop - dy;
        }
      } else if (drag.type === 'MOVE_TRACE_NODE') {
        const currX = Math.round(
          clampCoord(((e.clientX - drag.boardRect.left) / Math.max(1, drag.boardRect.width)) * 1000)
        );
        const currY = Math.round(
          clampCoord(((e.clientY - drag.boardRect.top) / Math.max(1, drag.boardRect.height)) * 1000)
        );
        setNets((prevNets) =>
          prevNets.map((net) => {
            if (net.name !== drag.netName) return net;
            if (typeof drag.branchIndex === 'number' && net.traceBranches) {
              const nextBranches = net.traceBranches.map((branch, bIdx) =>
                bIdx === drag.branchIndex
                  ? branch.map((pt, pIdx) => (pIdx === drag.pointIndex ? { x: currX, y: currY } : pt))
                  : branch
              );
              return {
                ...net,
                traceBranches: nextBranches,
                tracePoints: nextBranches.flat(),
              };
            }
            const nextPts = net.tracePoints.map((pt, idx) =>
              idx === drag.pointIndex ? { x: currX, y: currY } : pt
            );
            return { ...net, tracePoints: nextPts };
          })
        );
      }
    };

    const handlePointerUp = () => {
      const drag = dragRef.current;
      if (!drag) return;
      dragRef.current = null;

      if (drag.type === 'MOVE') {
        const movedComp = componentsRef.current.find((c) => c.refDes === drag.refDes);
        if (movedComp) {
          const oldCenter = getBoxCenter(drag.origBox);
          const newCenter = getBoxCenter(movedComp.bbox);
          const deltaX = newCenter.x - oldCenter.x;
          const deltaY = newCenter.y - oldCenter.y;
          if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
            setNets((prevNets) =>
              prevNets.map((net) => {
                if (!net.connectedComponentRefs.includes(drag.refDes)) return net;
                let movedAny = false;
                const moveNearPoint = (pt: TracePoint): TracePoint => {
                  const dist = Math.hypot(pt.x - oldCenter.x, pt.y - oldCenter.y);
                  if (dist < 125) {
                    movedAny = true;
                    return {
                      x: clampCoord(pt.x + deltaX),
                      y: clampCoord(pt.y + deltaY),
                    };
                  }
                  return pt;
                };
                const updatedPts = net.tracePoints.map(moveNearPoint);
                const updatedBranches = net.traceBranches
                  ? net.traceBranches.map((branch) => branch.map(moveNearPoint))
                  : undefined;
                return movedAny
                  ? { ...net, tracePoints: updatedPts, traceBranches: updatedBranches }
                  : net;
              })
            );
          }
        }
      } else if (drag.type === 'CROP') {
        const box = cropMarqueeRef.current;
        cropMarqueeRef.current = null;
        if (box && box.xmax - box.xmin >= 25 && box.ymax - box.ymin >= 25) {
          void executeMacroCropScanRef.current(box);
        } else {
          setCropMarquee(null);
          setStatusMessage('Macro crop box too small — drag a larger area around the IC or trace.');
        }
      }
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
    return () => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
    };
  }, []);

  // ============================================================================
  // COMPONENT, PIN & NET EDITING ACTIONS
  // ============================================================================

  const handleAddCustomComponent = (
    template:
      | 'TEST_POINT'
      | 'MOSFET_DRIVER'
      | 'VOLTAGE_REGULATOR'
      | 'RESISTOR'
      | 'CAPACITOR'
      | 'DIODE'
  ) => {
    const nextIndex = components.length + 1;
    const prefixMap: Record<typeof template, string> = {
      TEST_POINT: 'TP',
      MOSFET_DRIVER: 'Q',
      VOLTAGE_REGULATOR: 'U',
      RESISTOR: 'R',
      CAPACITOR: 'C',
      DIODE: 'D',
    };
    let refDes = `${prefixMap[template]}${nextIndex}`;
    let bump = nextIndex;
    while (components.some((c) => c.refDes === refDes)) {
      bump++;
      refDes = `${prefixMap[template]}${bump}`;
    }

    const defaultNet = activeNetId || 'NET_5V_REGULATED';
    const specPresets: Record<
      typeof template,
      {
        marking: string;
        decodedValue: string;
        packageType: string;
        circuitFunction: string;
        vRange: string;
        pins: PcbPinSpec[];
      }
    > = {
      TEST_POINT: {
        marking: refDes,
        decodedValue: 'Technician Probe Pad',
        packageType: 'SMD Test Pad (1.5mm)',
        circuitFunction: 'Manual Technician Oscilloscope / Multimeter Test Point',
        vRange: '0V – 42V DC',
        pins: [
          {
            pinNumber: 1,
            pinName: 'PAD',
            category: 'signal_in',
            nominalVoltage: 5.0,
            connectedNetId: defaultNet,
            notes: 'Direct probe test point pad',
          },
        ],
      },
      MOSFET_DRIVER: {
        marking: 'BTS141',
        decodedValue: '60V / 25A Low-Side Smart MOSFET',
        packageType: 'TO-252-3 (DPAK)',
        circuitFunction: 'Low-Side Actuator / Solenoid Sink Switch',
        vRange: '60V VDS Max',
        pins: [
          { pinNumber: 1, pinName: 'GATE', category: 'signal_in', nominalVoltage: 5.0, connectedNetId: 'NET_5V_REGULATED', notes: '5V MCU gate drive' },
          { pinNumber: 2, pinName: 'DRAIN', category: 'driver_out', nominalVoltage: 12.25, connectedNetId: 'NET_INJ_1_LOW', notes: 'Actuator low-side drain' },
          { pinNumber: 3, pinName: 'SOURCE', category: 'ground', nominalVoltage: 0.0, connectedNetId: 'NET_CHASSIS_GND', notes: 'Ground return' },
        ],
      },
      VOLTAGE_REGULATOR: {
        marking: 'TLE4275G',
        decodedValue: '5.0V ±2% Automotive LDO',
        packageType: 'TO-263-5',
        circuitFunction: 'ECU +5V Regulated Logic Supply',
        vRange: '5.5V – 42V DC',
        pins: [
          { pinNumber: 1, pinName: 'VIN', category: 'power', nominalVoltage: 12.25, connectedNetId: 'NET_KL30_VBAT', notes: 'Protected VBat input' },
          { pinNumber: 2, pinName: 'GND', category: 'ground', nominalVoltage: 0.0, connectedNetId: 'NET_CHASSIS_GND', notes: 'Ground tab' },
          { pinNumber: 3, pinName: 'VOUT', category: 'power', nominalVoltage: 5.0, connectedNetId: 'NET_5V_REGULATED', notes: '+5V output rail' },
        ],
      },
      RESISTOR: {
        marking: '100R',
        decodedValue: '100 Ω ±1% AEC-Q200',
        packageType: '0805 SMD',
        circuitFunction: 'Series Damping / Termination Resistor',
        vRange: '0.25W / 150V Max',
        pins: [
          { pinNumber: 1, pinName: 'TERM 1', category: 'signal_in', nominalVoltage: 5.0, connectedNetId: defaultNet, notes: 'Resistor terminal 1' },
          { pinNumber: 2, pinName: 'TERM 2', category: 'ground', nominalVoltage: 0.0, connectedNetId: 'NET_CHASSIS_GND', notes: 'Resistor terminal 2' },
        ],
      },
      CAPACITOR: {
        marking: '100nF 50V',
        decodedValue: '100 nF / 50V X7R MLCC',
        packageType: '0805 SMD',
        circuitFunction: 'Bypass & Decoupling Capacitor',
        vRange: '50V DC X7R',
        pins: [
          { pinNumber: 1, pinName: 'POS (+)', category: 'power', nominalVoltage: 5.0, connectedNetId: defaultNet, notes: 'Positive decoupling rail' },
          { pinNumber: 2, pinName: 'GND (-)', category: 'ground', nominalVoltage: 0.0, connectedNetId: 'NET_CHASSIS_GND', notes: 'Ground plane return' },
        ],
      },
      DIODE: {
        marking: 'B540C',
        decodedValue: '40V / 5A Schottky Barrier Diode',
        packageType: 'SMC (DO-214AB)',
        circuitFunction: 'Reverse Polarity / Flyback Protection Diode',
        vRange: '40V VRRM',
        pins: [
          { pinNumber: 1, pinName: 'ANODE (A)', category: 'power', nominalVoltage: 12.6, connectedNetId: defaultNet, notes: 'Anode terminal' },
          { pinNumber: 2, pinName: 'CATHODE (K)', category: 'power', nominalVoltage: 12.25, connectedNetId: 'NET_KL30_VBAT', notes: 'Cathode terminal' },
        ],
      },
    };

    const chosen = specPresets[template];
    const newComp: DetailedPcbComponent = {
      refDes,
      category: template,
      marking: chosen.marking,
      decodedValue: chosen.decodedValue,
      packageType: chosen.packageType,
      bbox: { ymin: 220, xmin: 420, ymax: 320, xmax: 530 },
      confidenceScore: 1.0,
      verificationStatus: 'VERIFIED',
      circuitFunction: chosen.circuitFunction,
      terminalIds: chosen.pins.map((p) => `${refDes}-${p.pinNumber}`),
      notes: 'Added manually during bench PCB inspection.',
      operatingVoltageRange: chosen.vRange,
      source: 'MANUAL',
      pinSpecs: chosen.pins,
    };
    setComponents((prev) => [...prev, newComp]);
    setSelectedCompRef(refDes);
    setSelectedPinNumber(1);
    setInspectorSubTab('PART');
    setShowAddPartMenu(false);
    setStatusMessage(`Added ${refDes} (${chosen.marking}) — drag box on PCB canvas to position over component.`);
  };

  const handleAddManualComponent = () => handleAddCustomComponent('TEST_POINT');

  const handleAddPinToComponent = (refDes: string) => {
    setComponents((prev) =>
      prev.map((c) => {
        if (c.refDes !== refDes) return c;
        const currentPins = c.pinSpecs || [];
        const nextPinNumber =
          currentPins.reduce((max, p) => Math.max(max, p.pinNumber), 0) + 1;
        const newPin: PcbPinSpec = {
          pinNumber: nextPinNumber,
          pinName: `PIN_${nextPinNumber}`,
          category: 'signal_in',
          nominalVoltage: 5.0,
          connectedNetId: activeNetId || 'NET_UNASSIGNED',
          notes: 'User-defined IC/connector pin',
        };
        return {
          ...c,
          pinSpecs: [...currentPins, newPin],
          terminalIds: [...c.terminalIds, `${refDes}-${nextPinNumber}`],
        };
      })
    );
    setStatusMessage(`Added new pin to ${refDes}`);
  };

  const handleDeleteComponent = (refDes: string) => {
    setComponents((prev) => prev.filter((c) => c.refDes !== refDes));
    setNets((prev) =>
      prev.map((n) => ({
        ...n,
        connectedComponentRefs: n.connectedComponentRefs.filter((r) => r !== refDes),
      }))
    );
    if (selectedCompRef === refDes) setSelectedCompRef(null);
  };

  const updateSelectedComponentField = (
    refDes: string,
    updates: Partial<DetailedPcbComponent>
  ) => {
    setComponents((prev) =>
      prev.map((c) => (c.refDes === refDes ? { ...c, ...updates } : c))
    );
  };

  const handleUpdatePinNet = (
    compRefDes: string,
    pinNumber: number,
    nextNetId: string,
    nextPinName?: string,
    nextVoltage?: number
  ) => {
    const cleanNet = nextNetId.trim().toUpperCase().replace(/\s+/g, '_') || 'NET_UNASSIGNED';

    setComponents((prev) =>
      prev.map((c) => {
        if (c.refDes !== compRefDes) return c;
        const nextPins = (c.pinSpecs || []).map((p) =>
          p.pinNumber === pinNumber
            ? {
                ...p,
                connectedNetId: cleanNet,
                pinName: nextPinName !== undefined ? nextPinName : p.pinName,
                nominalVoltage:
                  nextVoltage !== undefined && !Number.isNaN(nextVoltage)
                    ? nextVoltage
                    : p.nominalVoltage,
              }
            : p
        );
        return { ...c, pinSpecs: nextPins };
      })
    );

    if (cleanNet !== 'NET_UNASSIGNED') {
      setNets((prevNets) => {
        const compObj = components.find((c) => c.refDes === compRefDes);
        const compCenter = compObj ? getBoxCenter(compObj.bbox) : { x: 500, y: 500 };
        const existingIdx = prevNets.findIndex((n) => n.name === cleanNet);

        if (existingIdx >= 0) {
          return prevNets.map((n, idx) => {
            if (idx !== existingIdx) return n;
            const hasComp = n.connectedComponentRefs.includes(compRefDes);
            return {
              ...n,
              connectedComponentRefs: hasComp
                ? n.connectedComponentRefs
                : [...n.connectedComponentRefs, compRefDes],
              tracePoints: hasComp
                ? n.tracePoints
                : [...n.tracePoints, compCenter],
            };
          });
        }

        return [
          ...prevNets,
          {
            name: cleanNet,
            signalType: cleanNet.includes('GND')
              ? 'GROUND'
              : cleanNet.includes('5V')
              ? '5V_LOGIC'
              : cleanNet.includes('VBAT') || cleanNet.includes('KL30')
              ? 'BATTERY_POWER'
              : cleanNet.includes('CAN')
              ? 'CAN_DIFFERENTIAL'
              : 'SIGNAL_TRACE',
            connectedComponentRefs: [compRefDes],
            connectedTerminalIds: [`${compRefDes}-P${pinNumber}`],
            tracePoints: [compCenter],
            confidenceScore: 0.9,
            verificationStatus: 'VERIFIED',
            isComplete: false,
          },
        ];
      });
      setActiveNetId(cleanNet);
    }
  };

  const handleCreateAndLinkNet = () => {
    if (!selectedCompRef) return;
    const targetName =
      newNetName.trim().toUpperCase().replace(/\s+/g, '_') || `NET_TRACE_${nets.length + 1}`;
    const comp = components.find((c) => c.refDes === selectedCompRef);
    const targetPin = selectedPinNumber || comp?.pinSpecs?.[0]?.pinNumber || 1;
    handleUpdatePinNet(selectedCompRef, targetPin, targetName);
    setNewNetName('');
    setStatusMessage(`Linked ${selectedCompRef} Pin #${targetPin} to net [${targetName}]`);
  };

  /**
   * Generates clean L-shaped (orthogonal Manhattan) copper trace segments between connected components.
   */
  const handleAutoRouteNet = (netName: string) => {
    setNets((prev) =>
      prev.map((n) => {
        if (n.name !== netName) return n;
        const centers = n.connectedComponentRefs
          .map((ref) => components.find((c) => c.refDes === ref))
          .filter((c): c is DetailedPcbComponent => Boolean(c))
          .map((c) => getBoxCenter(c.bbox));

        if (centers.length < 2) return n;

        const branches: TracePoint[][] = [];
        for (let i = 0; i < centers.length - 1; i++) {
          const a = centers[i];
          const b = centers[i + 1];
          const midX = Math.round((a.x + b.x) / 2);
          branches.push([
            { x: a.x, y: a.y },
            { x: midX, y: a.y },
            { x: midX, y: b.y },
            { x: b.x, y: b.y },
          ]);
        }

        return {
          ...n,
          traceBranches: branches,
          tracePoints: branches.flat(),
          isComplete: true,
        };
      })
    );
    setStatusMessage(`Auto-routed orthogonal Manhattan copper trace for [${netName}]`);
  };

  const handleAddWaypointToActiveNet = () => {
    if (!effectiveNetId) return;
    setNets((prev) =>
      prev.map((n) => {
        if (n.name !== effectiveNetId) return n;
        const lastPt = n.tracePoints[n.tracePoints.length - 1] || { x: 500, y: 500 };
        const nextPt = {
          x: clampCoord(lastPt.x + 45),
          y: clampCoord(lastPt.y + 35),
        };
        if (n.traceBranches && n.traceBranches.length > 0) {
          const nextBranches = n.traceBranches.map((b, idx) =>
            idx === n.traceBranches!.length - 1 ? [...b, nextPt] : b
          );
          return { ...n, traceBranches: nextBranches, tracePoints: nextBranches.flat() };
        }
        return { ...n, tracePoints: [...n.tracePoints, nextPt] };
      })
    );
    setInteractionMode('TRACE_EDIT');
    setStatusMessage(`Added trace waypoint to [${effectiveNetId}] — drag white vertices on canvas.`);
  };

  const handleDeleteLastVertexFromActiveNet = () => {
    if (!effectiveNetId) return;
    setNets((prev) =>
      prev.map((n) => {
        if (n.name !== effectiveNetId) return n;
        if (n.traceBranches && n.traceBranches.length > 0) {
          const lastIdx = n.traceBranches.length - 1;
          const nextBranches = n.traceBranches.map((b, idx) =>
            idx === lastIdx && b.length > 2 ? b.slice(0, -1) : b
          );
          return { ...n, traceBranches: nextBranches, tracePoints: nextBranches.flat() };
        }
        if (n.tracePoints.length > 2) {
          return { ...n, tracePoints: n.tracePoints.slice(0, -1) };
        }
        return n;
      })
    );
    setStatusMessage(`Removed trailing vertex from [${effectiveNetId}].`);
  };

  const handleAddManualHotspot = (severity: 'CRITICAL' | 'WARNING' | 'INFO' = 'WARNING') => {
    const targetComp = components.find((c) => c.refDes === selectedCompRef);
    const bbox = targetComp
      ? clampBbox({
          ymin: targetComp.bbox.ymin - 15,
          xmin: targetComp.bbox.xmin - 15,
          ymax: targetComp.bbox.ymax + 15,
          xmax: targetComp.bbox.xmax + 15,
        })
      : { ymin: 420, xmin: 420, ymax: 560, xmax: 560 };

    const newHotspot: ImageAnalysisHotspot = {
      id: `manual-hotspot-${Date.now()}`,
      label: targetComp
        ? `${targetComp.refDes} Physical Inspection Flag`
        : 'Manual Solder / Thermal Inspection Zone',
      severity,
      bbox,
      suspectComponentRef: targetComp?.refDes,
      notes: targetComp
        ? `Technician flagged ${targetComp.refDes} (${targetComp.marking}) for solder crack, heat discoloration, or pad continuity check.`
        : 'Technician flagged region for microscopic solder joint and trace continuity inspection.',
      source: 'LOCAL_CV',
    };
    setHotspots((prev) => [newHotspot, ...prev]);
    setSelectedHotspotId(newHotspot.id);
    setShowHotspots(true);
    setInspectorSubTab('AUDIT');
    setStatusMessage(`Flagged new ${severity} inspection hotspot${targetComp ? ` on ${targetComp.refDes}` : ''}.`);
  };

  const handleDeleteHotspot = (id: string) => {
    setHotspots((prev) => prev.filter((h) => h.id !== id));
    if (selectedHotspotId === id) setSelectedHotspotId(null);
  };

  const verifyComponent = (refDes: string) => {
    setComponents((prev) =>
      prev.map((c) =>
        c.refDes === refDes
          ? {
              ...c,
              verificationStatus: c.verificationStatus === 'VERIFIED' ? 'UNVERIFIED' : 'VERIFIED',
              notes:
                c.verificationStatus === 'VERIFIED'
                  ? 'Reverted to unverified status'
                  : 'Verified by Senior Auto-Electrician against OEM schematics.',
            }
          : c
      )
    );
  };

  // ============================================================================
  // CLOUD SYNC & JSON EXPORT
  // ============================================================================

  const handleSavePcbToCloud = async () => {
    if (!user) {
      if (onOpenCloudModal) {
        onOpenCloudModal();
      } else {
        setStatusMessage('Sign in via Saved Benches to store PCB maps in Cloud Storage.');
      }
      return;
    }

    setIsSavingScan(true);
    try {
      await savePcbScan(user.uid, {
        title: boardTitle || 'Mapped ECU PCB Scan',
        boardType: boardType || 'Automotive ECU PCB',
        analysisSummary,
        model: analysisModel,
        components,
        nets,
        hotspots,
      });
      setStatusMessage(
        `SAVED TO CLOUD: "${boardTitle}" (${components.length} parts, ${nets.length} nets, ${hotspots.length} hotspots)`
      );
    } catch (err) {
      console.error('Failed to save PCB scan:', err);
      setStatusMessage('Cloud save failed — check authentication status or network.');
    } finally {
      setIsSavingScan(false);
    }
  };

  const handleLoadSavedScan = (scan: SavedPcbScan) => {
    setBoardTitle(scan.title);
    setBoardType(scan.boardType);
    setAnalysisSummary(scan.analysisSummary);
    setAnalysisModel(scan.model);
    setComponents(scan.components || []);
    setNets((scan.nets as ExtendedImageAnalysisNet[]) || []);
    setHotspots(scan.hotspots || []);
    setUploadedImageUrl(null);
    setBoardAspect(1.5);
    setSelectedCompRef(scan.components?.[0]?.refDes || null);
    setActiveNetId(scan.nets?.[0]?.name || null);
    setTracePathPair([null, null]);
    setClickedDatasheetNode(null);
    setShowSavedScansPanel(false);
    setStatusMessage(`Loaded Cloud PCB Map: ${scan.title} (${scan.components?.length || 0} components)`);
  };

  const handleDeleteSavedScan = async (scanId: string) => {
    if (!user) return;
    try {
      await deletePcbScan(user.uid, scanId);
    } catch (err) {
      console.warn('Delete PCB scan failed:', err);
    }
  };

  const exportProjectJson = () => {
    const project = {
      boardName: boardTitle,
      boardType,
      analysisSummary,
      model: analysisModel,
      timestamp: new Date().toISOString(),
      components,
      nets,
      hotspots,
      thermalSnapshot: componentThermalMap,
      source: 'AutoElectric Lab Pro PCB Inspection Engine v2.4',
    };
    const blob = new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `autoelectric-pcb-${boardTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // ============================================================================
  // MEMOIZED SELECTORS & HELPERS
  // ============================================================================

  const filteredComponents = useMemo(() => {
    const q = searchTerm.toLowerCase();
    return components.filter((c) => {
      const matchesSearch =
        c.refDes.toLowerCase().includes(q) ||
        c.category.toLowerCase().includes(q) ||
        c.marking.toLowerCase().includes(q) ||
        c.decodedValue.toLowerCase().includes(q);

      if (!matchesSearch) return false;
      if (filterMode === 'VERIFIED') return c.verificationStatus === 'VERIFIED';
      if (filterMode === 'UNVERIFIED') return c.verificationStatus === 'UNVERIFIED';
      return true;
    });
  }, [components, searchTerm, filterMode]);

  const selectedComponent = useMemo(
    () => components.find((c) => c.refDes === selectedCompRef),
    [components, selectedCompRef]
  );

  const activeNetObject = useMemo(
    () => nets.find((n) => n.name === effectiveNetId),
    [nets, effectiveNetId]
  );

  const getNetColor = (netName: string): string => {
    const upper = netName.toUpperCase();
    if (upper.includes('5V') || upper.includes('REG')) return '#00f3ff';
    if (upper.includes('VBAT') || upper.includes('KL30')) return '#ef4444';
    if (upper.includes('GND')) return '#39ff14';
    if (upper.includes('HIGH') || upper.includes('CANH')) return '#ff6600';
    if (upper.includes('LOW') || upper.includes('CANL')) return '#a855f7';
    if (upper.includes('SPLIT') || upper.includes('VREF')) return '#38bdf8';
    return '#f59e0b';
  };

  const openDatasheetCardForNode = useCallback(
    (
      compRefDes: string,
      xNorm: number,
      yNorm: number,
      pinNumber?: number,
      pinName?: string,
      netId?: string
    ) => {
      if (!showDatasheetInfo) return;
      setClickedDatasheetNode({
        compRefDes,
        pinNumber,
        pinName,
        netId,
        xNorm,
        yNorm,
      });
    },
    [showDatasheetInfo]
  );

  const handleSelectTracePathComponent = useCallback(
    (refDes: string) => {
      setTracePathPair((prev) => {
        const [first, second] = prev;
        if (!first || (first && second)) {
          setStatusMessage(
            `TRACE PATH [A = ${refDes}]: Click a second component [B], then hover any node to trace continuous path.`
          );
          return [refDes, null];
        }
        if (first === refDes) {
          setStatusMessage(
            `TRACE PATH [A = ${refDes}]: Pick a different second component [B] to complete the trace pair.`
          );
          return prev;
        }
        setStatusMessage(
          `TRACE PATH READY [${first} ↔ ${refDes}]: Hover over any pin or trace node to highlight continuous line.`
        );
        return [first, refDes];
      });
    },
    []
  );

  // Computes continuous orthogonal trace path between two clicked components via PcbDiagnosticEngine
  const highlightedContinuousPath = useMemo(
    () =>
      computeContinuousTracePath({
        tracePathPair,
        hoveredNode: hoveredNodeTooltip,
        components,
        nets,
      }),
    [tracePathPair, hoveredNodeTooltip, components, nets]
  );

  // Aspect-locked board dimensions so 0..1000 coordinates match photo pixels 1:1
  const boardWidthPx = Math.round(740 * zoomLevel);
  const boardHeightPx = Math.round((740 / Math.max(0.5, Math.min(2.2, boardAspect))) * zoomLevel);

  // ============================================================================
  // RENDER
  // ============================================================================

  return (
    <div className="flex-1 flex flex-col hud-panel rounded-xl overflow-hidden text-slate-100 font-mono select-none">
      {/* Top Banner Toolbar */}
      <div className="flex flex-wrap items-center justify-between border-b border-cyan-500/15 p-2.5 hud-header text-xs gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <img
            src="/assets/aistudio/file_0000000098d48211abb177ce752b7b0e_62980da7.png"
            alt="AutoElectric Lab Pro Official Logo"
            className="h-7 w-auto object-contain rounded border border-cyan-500/40 shadow-sm shrink-0"
          />
          <div className="flex flex-col min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-sm font-hud font-bold text-slate-100 tracking-wider uppercase whitespace-nowrap">
                PCB Vision & Auto Track Mapper
              </span>
              <span className="hidden lg:inline-flex items-center gap-1 px-1.5 py-0.5 text-[9.5px] rounded bg-cyan-950/90 border border-cyan-500/40 text-cyan-300 font-semibold tabular-nums">
                <Zap className="w-2.5 h-2.5 text-cyan-400" />
                {powerSupply?.isOutputEnabled !== false
                  ? `BENCH ${(powerSupply?.voltageSetting ?? 12.6).toFixed(1)}V`
                  : 'BENCH OFF (0.0V)'}
              </span>
              <button
                type="button"
                onClick={() => {
                  setShowThermalHeatmap(true);
                  setInspectorSubTab('THERMAL');
                }}
                className={`hidden xl:inline-flex items-center gap-1 px-1.5 py-0.5 text-[9.5px] rounded border font-semibold tabular-nums transition ${
                  peakBoardTempC >= 110
                    ? 'bg-rose-950/90 border-rose-500/70 text-rose-200 animate-pulse'
                    : peakBoardTempC >= 80
                    ? 'bg-amber-950/90 border-amber-500/60 text-amber-200'
                    : 'bg-slate-900 border-slate-700 text-sky-300 hover:border-sky-500/60'
                }`}
                title="Peak Component Junction Temperature (Click to open IR Thermal Telemetry)"
              >
                <Thermometer className="w-2.5 h-2.5" />
                PEAK {peakBoardTempC.toFixed(0)}°C
              </button>
              <button
                type="button"
                onClick={() => setInspectorSubTab('AUDIT')}
                className={`hidden xl:inline-flex items-center gap-1 px-1.5 py-0.5 text-[9.5px] rounded border font-semibold tabular-nums transition ${
                  criticalAuditCount > 0
                    ? 'bg-rose-950/90 border-rose-500/70 text-rose-200'
                    : boardAuditFindings.length > 0
                    ? 'bg-amber-950/80 border-amber-500/50 text-amber-200'
                    : 'bg-emerald-950/80 border-emerald-500/50 text-emerald-300'
                }`}
                title="Automated MNA, Thermal & ERC Audit Findings"
              >
                <ShieldAlert className="w-2.5 h-2.5" />
                {criticalAuditCount > 0
                  ? `${criticalAuditCount} CRIT AUDIT`
                  : boardAuditFindings.length > 0
                  ? `${boardAuditFindings.length} AUDIT`
                  : 'ERC NOMINAL'}
              </button>
            </div>
            <span className="text-[10.5px] text-cyan-300/90 truncate max-w-[460px] font-sans">
              {isAnalyzing ? 'Analyzing PCB geometry & markings...' : statusMessage}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none w-full lg:w-auto lg:flex-wrap pb-0.5 lg:pb-0">
          {/* Reference Stage Presets */}
          <div className="flex items-center gap-1 bg-slate-950/80 p-1 rounded-lg border border-slate-800 shrink-0">
            <span className="text-[9.5px] text-slate-400 px-1 font-bold">PRESETS:</span>
            {SAMPLE_BOARDS.map((sb) => (
              <button
                key={sb.id}
                type="button"
                onClick={() => loadSample(sb)}
                className={`px-2 py-0.5 text-[10px] rounded border transition whitespace-nowrap ${
                  selectedBoard.id === sb.id && (!uploadedImageUrl || uploadedImageUrl === sb.imageSrc)
                    ? 'bg-cyan-950 border-cyan-400 text-cyan-200 font-bold shadow-sm'
                    : 'bg-slate-900 border-slate-700/80 text-slate-400 hover:text-white'
                }`}
                title={sb.summary}
              >
                {sb.id === 'sample-power-stage'
                  ? '5V LDO Stage'
                  : sb.id === 'sample-can-stage'
                  ? 'CAN Transceiver'
                  : 'Injector MOSFET'}
              </button>
            ))}
          </div>

          {/* OEM ECU Photography Presets */}
          {OEM_PCB_BOARDS.length > 0 && (
            <select
              aria-label="Load OEM ECU PCB Profile"
              value={OEM_PCB_BOARDS.some((b) => b.id === selectedBoard.id) ? selectedBoard.id : ''}
              onChange={(e) => {
                const chosen = OEM_PCB_BOARDS.find((b) => b.id === e.target.value);
                if (chosen) loadSample(chosen);
              }}
              className="px-2 py-1 text-[10.5px] bg-slate-900 text-cyan-200 border border-slate-700 hover:border-cyan-500/60 rounded-lg focus:outline-none focus:border-cyan-400 cursor-pointer shrink-0"
              title="Load Real OEM ECU PCB Photography with MNA-Linked Stages"
            >
              <option value="" disabled>
                OEM ECU PCBs ({OEM_PCB_BOARDS.length})
              </option>
              {OEM_PCB_BOARDS.map((oem) => (
                <option key={oem.id} value={oem.id}>
                  {oem.name}
                </option>
              ))}
            </select>
          )}

          {/* Add Custom Part Palette Toggle */}
          <button
            type="button"
            onClick={() => setShowAddPartMenu((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1 border rounded-lg transition whitespace-nowrap shrink-0 ${
              showAddPartMenu
                ? 'bg-cyan-950 border-cyan-400 text-cyan-200 font-semibold'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
            }`}
            title="Insert Test Pad, MOSFET Driver, LDO, Resistor, Capacitor, or Diode onto Board"
          >
            <Plus className="w-3.5 h-3.5 text-cyan-400" />
            <span>Add Part</span>
          </button>

          {/* Local CV Re-Scan (when image uploaded) */}
          {uploadedImageUrl && (
            <button
              type="button"
              onClick={handleRerunLocalCv}
              disabled={isAnalyzing}
              className="flex items-center gap-1 px-2 py-1 bg-amber-950/70 hover:bg-amber-900/80 text-amber-200 border border-amber-600/60 rounded-lg transition disabled:opacity-50 whitespace-nowrap shrink-0"
              title="Run Local CV Burn/Oxidation & Pad Cluster Scan"
            >
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              <span>Local CV</span>
            </button>
          )}

          {/* Save Cloud Map */}
          <button
            type="button"
            onClick={handleSavePcbToCloud}
            disabled={isSavingScan}
            className="flex items-center gap-1 px-2 py-1 bg-emerald-950/70 hover:bg-emerald-900/80 text-emerald-200 border border-emerald-600/60 rounded-lg transition disabled:opacity-50 whitespace-nowrap shrink-0"
            title="Save Mapped PCB Components, Nets & Hotspots to Firestore"
          >
            <CloudUpload className="w-3.5 h-3.5 text-emerald-400" />
            <span>{isSavingScan ? 'Saving...' : 'Save Cloud'}</span>
          </button>

          {/* Saved Maps Dropdown Toggle */}
          <button
            type="button"
            onClick={() => setShowSavedScansPanel((prev) => !prev)}
            className={`flex items-center gap-1 px-2 py-1 rounded-lg border transition whitespace-nowrap shrink-0 ${
              showSavedScansPanel
                ? 'bg-cyan-950 border-cyan-500 text-cyan-200'
                : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
            }`}
            title="Load Saved Cloud PCB Scans"
          >
            <FolderOpen className="w-3.5 h-3.5" />
            <span>Saved ({savedScans.length})</span>
          </button>

          {/* Upload Button */}
          <label className="flex items-center gap-1 px-2.5 py-1 bg-cyan-700 hover:bg-cyan-600 text-white rounded-lg cursor-pointer font-semibold transition shadow-sm whitespace-nowrap shrink-0">
            <Upload className="w-3.5 h-3.5" />
            <span>Upload PCB Photo</span>
            <input type="file" accept="image/*" onChange={handleUpload} className="hidden" />
          </label>

          {/* Export JSON */}
          <button
            type="button"
            onClick={exportProjectJson}
            className="flex items-center gap-1 px-2 py-1 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded-lg transition whitespace-nowrap shrink-0"
            title="Export JSON Datasheet & Thermal Backup"
          >
            <Download className="w-3.5 h-3.5" />
            <span>Export</span>
          </button>
        </div>
      </div>

      {/* Quick-Insert Component Palette Bar (Non-clipped across desktop & mobile) */}
      {showAddPartMenu && (
        <div className="bg-slate-950 border-b border-cyan-500/25 px-3 py-2 flex flex-wrap items-center gap-1.5 text-[10.5px]">
          <span className="text-cyan-300 font-bold uppercase mr-1 flex items-center gap-1">
            <Plus className="w-3 h-3" /> Insert Component:
          </span>
          {(
            [
              { id: 'TEST_POINT', label: 'Test Pad' },
              { id: 'MOSFET_DRIVER', label: 'MOSFET (BTS141)' },
              { id: 'VOLTAGE_REGULATOR', label: 'LDO (TLE4275G)' },
              { id: 'RESISTOR', label: 'Resistor (100R)' },
              { id: 'CAPACITOR', label: 'Capacitor (100nF)' },
              { id: 'DIODE', label: 'Schottky (B540C)' },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => handleAddCustomComponent(item.id)}
              className="px-2 py-1 rounded bg-slate-900 hover:bg-cyan-950 border border-slate-700 hover:border-cyan-400 text-slate-200 hover:text-cyan-200 font-semibold transition"
            >
              + {item.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setShowAddPartMenu(false)}
            className="ml-auto px-2 py-1 rounded text-slate-400 hover:text-white hover:bg-slate-800 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Close
          </button>
        </div>
      )}

      {/* Collapsible Saved Cloud PCB Maps Bar */}
      {showSavedScansPanel && (
        <div className="bg-slate-950 border-b border-cyan-500/20 px-3 py-2 flex flex-col gap-2 text-xs">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-cyan-300 uppercase">
              Cloud Saved PCB Maps ({savedScans.length})
            </span>
            {!user && (
              <button
                onClick={() => onOpenCloudModal?.()}
                className="text-[11px] px-2 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600 text-white font-semibold"
              >
                Sign In to Sync Cloud Maps
              </button>
            )}
          </div>
          {savedScans.length === 0 ? (
            <div className="text-[11px] text-slate-400 font-sans">
              {user
                ? 'No saved PCB maps yet. Click "Save Cloud" after mapping a PCB.'
                : 'Sign in with Google via Saved Benches to access your private cloud PCB library.'}
            </div>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {savedScans.map((scan) => (
                <div
                  key={scan.id}
                  className="min-w-[220px] max-w-[260px] bg-slate-900 border border-slate-800 rounded-lg p-2 flex items-center justify-between gap-2 shrink-0"
                >
                  <button
                    onClick={() => handleLoadSavedScan(scan)}
                    className="text-left min-w-0 flex-1 hover:text-cyan-300 transition"
                  >
                    <div className="font-bold text-slate-100 truncate">{scan.title}</div>
                    <div className="text-[10px] text-slate-400 truncate">
                      {scan.components?.length || 0} parts · {scan.nets?.length || 0} nets ·{' '}
                      {scan.hotspots?.length || 0} hotspots
                    </div>
                  </button>
                  <button
                    onClick={() => handleDeleteSavedScan(scan.id)}
                    className="p-1 text-slate-500 hover:text-rose-400 transition shrink-0"
                    title="Delete Saved PCB Map"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Mobile Segmented Control Switcher */}
      <div className="flex md:hidden items-center bg-slate-900 p-1 border-b border-slate-800 text-xs font-mono shrink-0">
        <button
          onClick={() => setMobileTab('CANVAS')}
          className={`flex-1 py-1.5 rounded-md text-center transition font-semibold flex items-center justify-center gap-1.5 ${
            mobileTab === 'CANVAS' ? 'bg-cyan-600 text-white shadow-sm font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Cpu className="w-3.5 h-3.5" />
          <span>PCB Interactive Canvas</span>
        </button>
        <button
          onClick={() => setMobileTab('DRAWER')}
          className={`flex-1 py-1.5 rounded-md text-center transition font-semibold flex items-center justify-center gap-1.5 ${
            mobileTab === 'DRAWER' ? 'bg-cyan-600 text-white shadow-sm font-bold' : 'text-slate-400 hover:text-white'
          }`}
        >
          <Activity className="w-3.5 h-3.5" />
          <span>Inspector & Nets ({components.length})</span>
        </button>
      </div>

      {/* Main Dual Workspace: Interactive PCB Canvas Left + Component Inspector Right */}
      <div className="flex-1 flex flex-col md:flex-row overflow-hidden min-h-0">
        {/* Left: Interactive Canvas */}
        <div
          className={`flex-1 relative hud-blueprint-grid border-r border-cyan-500/15 flex-col overflow-hidden ${
            mobileTab === 'CANVAS' ? 'flex' : 'hidden md:flex'
          }`}
        >
          {/* HUD Layer & Tool Controls + Trace Path Status Stack */}
          <div className="absolute top-2 left-2 right-44 sm:right-48 z-40 flex flex-col items-start gap-1.5 pointer-events-none">
            <div className="pointer-events-auto flex flex-nowrap md:flex-wrap items-center gap-1 hud-panel p-1 rounded-lg text-[10.5px] sm:text-[11px] text-slate-300 shadow-lg border border-slate-800/90 max-w-full overflow-x-auto scrollbar-none [&>button]:whitespace-nowrap [&>button]:shrink-0">
            <button
              onClick={() => setInteractionMode('EDIT')}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                interactionMode === 'EDIT' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-white'
              }`}
              title="Select, Drag & Resize Component Boxes"
            >
              <Move className="w-3 h-3" />
              <span>Edit Boxes</span>
            </button>

            <button
              type="button"
              onClick={() => setInteractionMode('PAN')}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                interactionMode === 'PAN' ? 'bg-cyan-600 text-white font-bold' : 'text-slate-400 hover:text-white'
              }`}
              title="Click and drag anywhere to pan across zoomed PCB"
            >
              <Hand className="w-3 h-3" />
              <span>Pan</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setInteractionMode((m) => {
                  const next = m === 'PROBE' ? 'EDIT' : 'PROBE';
                  if (next === 'PROBE') {
                    setInspectorSubTab('PROBE');
                    setStatusMessage(
                      'DUAL PROBE MODE: Click any pin pad, component, or trace node to place Red Probe A & Black Probe B.'
                    );
                  }
                  return next;
                });
              }}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                interactionMode === 'PROBE'
                  ? 'bg-sky-600 text-white font-bold shadow-[0_0_12px_rgba(56,189,248,0.55)]'
                  : probeA || probeB
                  ? 'bg-sky-950 text-sky-300 border border-sky-500/60 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Place Dual Probes (A/B) for Live MNA Differential Voltage, Continuity & Diode Drop Testing"
            >
              <Crosshair className="w-3 h-3" />
              <span>Probe A/B</span>
            </button>

            <button
              type="button"
              onClick={() => setInteractionMode((m) => (m === 'TRACE_EDIT' ? 'EDIT' : 'TRACE_EDIT'))}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                interactionMode === 'TRACE_EDIT'
                  ? 'bg-emerald-600 text-white font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Drag individual copper trace vertices to align with physical PCB tracks"
            >
              <Waypoints className="w-3 h-3" />
              <span>Edit Traces</span>
            </button>

            <button
              type="button"
              onClick={() => {
                setInteractionMode((m) => {
                  const next = m === 'TRACE_PATH' ? 'EDIT' : 'TRACE_PATH';
                  if (next === 'TRACE_PATH') {
                    setStatusMessage(
                      tracePathPair[0] && tracePathPair[1]
                        ? `TRACE PATH ACTIVE [${tracePathPair[0]} ↔ ${tracePathPair[1]}]: Hover any node to trace path, or click 2 new components.`
                        : 'TRACE PATH MODE: Click two components on the PCB, then hover over any node to trace a continuous line.'
                    );
                  }
                  return next;
                });
              }}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                interactionMode === 'TRACE_PATH'
                  ? 'bg-fuchsia-600 text-white font-bold shadow-[0_0_12px_rgba(217,70,239,0.55)]'
                  : tracePathPair[0] && tracePathPair[1]
                  ? 'bg-fuchsia-950 text-fuchsia-300 border border-fuchsia-500/60 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Click 2 components, then hover any node to highlight a continuous trace path between them (Tip: Shift+Click in Edit mode also selects)"
            >
              <Route className="w-3 h-3" />
              <span>Highlight Trace Path</span>
            </button>

            <button
              type="button"
              onClick={() => {
                if (!uploadedImageUrl) {
                  setStatusMessage('Upload a PCB photo first to use zoomed Macro Crop re-scan.');
                  return;
                }
                setInteractionMode((m) => (m === 'MACRO_CROP' ? 'EDIT' : 'MACRO_CROP'));
                setCropMarquee(null);
              }}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                interactionMode === 'MACRO_CROP'
                  ? 'bg-amber-500 text-slate-950 font-bold'
                  : 'text-slate-400 hover:text-white'
              }`}
              title="Drag a zoom box over any SMD cluster to re-scan IC markings"
            >
              <Crop className="w-3 h-3" />
              <span>Macro Crop</span>
            </button>

            <span className="text-slate-700 px-0.5">|</span>

            <button
              type="button"
              onClick={() => setShowComponents(!showComponents)}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showComponents ? 'bg-slate-800 text-cyan-300 font-bold' : 'text-slate-500'
              }`}
            >
              {showComponents ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              <span>Parts</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPhotoTexture((prev) => !prev)}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showPhotoTexture ? 'bg-slate-800 text-emerald-300 font-bold' : 'text-slate-500'
              }`}
              title="Toggle High-Detail Top-Down PCB Macro Texture vs CAD Vector Grid"
            >
              <Layers className="w-3 h-3" />
              <span>{showPhotoTexture ? 'Photo BG' : 'CAD Grid'}</span>
            </button>
            <button
              type="button"
              onClick={() => setShowNets(!showNets)}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showNets ? 'bg-slate-800 text-cyan-300 font-bold' : 'text-slate-500'
              }`}
            >
              {showNets ? <Eye className="w-3 h-3" /> : <EyeOff className="w-3 h-3" />}
              <span>Traces</span>
            </button>
            <button
              type="button"
              onClick={() => setShowHotspots(!showHotspots)}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showHotspots ? 'bg-slate-800 text-rose-300 font-bold' : 'text-slate-500'
              }`}
            >
              <Flame className="w-3 h-3" />
              <span>Hotspots ({hotspots.length})</span>
            </button>
            <button
              type="button"
              onClick={() => setShowPinMarkers(!showPinMarkers)}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showPinMarkers ? 'bg-slate-800 text-amber-300 font-bold' : 'text-slate-500'
              }`}
              title="Toggle Physical Solder Pads & Trace Nodes"
            >
              <Disc className="w-3 h-3" />
              <span>Pins</span>
            </button>
            <button
              type="button"
              onClick={() => setShowVoltageLabels(!showVoltageLabels)}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showVoltageLabels
                  ? 'bg-emerald-950 text-emerald-300 font-bold border border-emerald-500/60 shadow-[0_0_10px_rgba(16,185,129,0.25)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Automatically label component nodes with live MNA solver voltages"
            >
              <Zap className="w-3 h-3 text-emerald-400" />
              <span>MNA V-Labels</span>
            </button>
            <button
              type="button"
              onClick={() => setShowThermalHeatmap(!showThermalHeatmap)}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showThermalHeatmap
                  ? 'bg-rose-950 text-rose-200 font-bold border border-rose-500/70 shadow-[0_0_12px_rgba(244,63,94,0.4)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="Toggle Physics-Based Electro-Thermal IR Camera Overlay"
            >
              <Thermometer className="w-3 h-3 text-rose-400" />
              <span>IR Thermal</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setShowDatasheetInfo((prev) => {
                  const next = !prev;
                  if (!next) {
                    setClickedDatasheetNode(null);
                  } else {
                    setStatusMessage(
                      'DATASHEET INFO ENABLED: Click any component node or pin pad to view component specifications.'
                    );
                  }
                  return next;
                });
              }}
              className={`px-2 py-0.5 rounded flex items-center gap-1 transition ${
                showDatasheetInfo
                  ? 'bg-sky-950 text-sky-200 font-bold border border-sky-400/70 shadow-[0_0_12px_rgba(56,189,248,0.35)]'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title="When enabled, clicking any component node displays a floating datasheet specification summary card"
            >
              <FileText className="w-3 h-3 text-sky-400" />
              <span>Show Datasheet Info</span>
            </button>

            <span className="text-slate-700 px-0.5">|</span>

            {/* Optical Inspection Filter Selector */}
            <div className="flex items-center gap-0.5 shrink-0" role="group" aria-label="Optical PCB Inspection Filter">
              {(
                [
                  { id: 'NORMAL', label: 'Norm' },
                  { id: 'CONTRAST', label: 'Contrast' },
                  { id: 'UV_SILK', label: 'UV Silk' },
                  { id: 'XRAY', label: 'X-Ray' },
                ] as const
              ).map((flt) => (
                <button
                  key={flt.id}
                  type="button"
                  onClick={() => setOpticalFilter(flt.id)}
                  className={`px-1.5 py-0.5 rounded text-[9.5px] transition ${
                    opticalFilter === flt.id
                      ? 'bg-cyan-900 text-cyan-200 border border-cyan-400/60 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title={`Optical Filter: ${flt.label}`}
                >
                  {flt.label}
                </button>
              ))}
            </div>
            </div>

            {/* Active Dual-Probe Live Measurement Status Bar */}
            {(interactionMode === 'PROBE' || probeA || probeB) && (
              <div className="pointer-events-auto bg-slate-950/95 backdrop-blur-md border border-sky-500/60 rounded-lg px-2.5 py-1.5 text-[10.5px] font-mono text-slate-200 shadow-xl flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-sky-300 font-bold">
                  <Crosshair className="w-3.5 h-3.5 text-sky-400" />
                  <span>DUAL PROBE:</span>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                    probeA
                      ? 'bg-rose-950/90 border-rose-400 text-rose-200'
                      : 'bg-slate-900 border-slate-700 text-slate-500'
                  }`}
                >
                  A(+): {probeA ? probeA.label : 'Click node 1'}
                </span>
                <span className="text-sky-400 font-bold">↔</span>
                <span
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                    probeB
                      ? 'bg-sky-950/90 border-sky-400 text-sky-200'
                      : 'bg-slate-900 border-slate-700 text-slate-500'
                  }`}
                >
                  B(−): {probeB ? probeB.label : 'Click node 2'}
                </span>
                {dualProbeMeasurement && (
                  <span className="px-2 py-0.5 rounded bg-slate-900 border border-amber-500/50 text-amber-300 font-bold tabular-nums">
                    ΔV {dualProbeMeasurement.differentialVoltage >= 0 ? '+' : ''}
                    {dualProbeMeasurement.differentialVoltage.toFixed(3)}V ·{' '}
                    {dualProbeMeasurement.continuityLabel}
                  </span>
                )}
                {(probeA || probeB) && (
                  <button
                    type="button"
                    onClick={() => {
                      setProbeA(null);
                      setProbeB(null);
                      setNextProbeSlot('A');
                      setStatusMessage('Cleared Dual Probes A & B.');
                    }}
                    className="ml-1 px-1.5 py-0.5 rounded bg-slate-900 hover:bg-rose-950 border border-slate-700 hover:border-rose-500/60 text-slate-300 hover:text-rose-200 flex items-center gap-0.5 text-[9.5px] transition"
                    title="Clear Probe A and Probe B"
                  >
                    <X className="w-2.5 h-2.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            )}

            {/* Trace Path Two-Component Pair Status Bar */}
            {(interactionMode === 'TRACE_PATH' || tracePathPair[0] !== null) && (
              <div className="pointer-events-auto bg-slate-950/95 backdrop-blur-md border border-fuchsia-500/60 rounded-lg px-2.5 py-1.5 text-[10.5px] font-mono text-slate-200 shadow-xl flex flex-wrap items-center gap-2">
                <div className="flex items-center gap-1 text-fuchsia-300 font-bold">
                  <Route className="w-3.5 h-3.5 text-fuchsia-400" />
                  <span>TRACE PATH:</span>
                </div>
                <span
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                    tracePathPair[0]
                      ? 'bg-fuchsia-950/90 border-fuchsia-400 text-fuchsia-200'
                      : 'bg-slate-900 border-slate-700 text-slate-500'
                  }`}
                >
                  A: {tracePathPair[0] || 'Click Comp 1'}
                </span>
                <span className="text-fuchsia-400 font-bold">↔</span>
                <span
                  className={`px-1.5 py-0.5 rounded border text-[10px] font-bold ${
                    tracePathPair[1]
                      ? 'bg-cyan-950/90 border-cyan-400 text-cyan-200'
                      : 'bg-slate-900 border-slate-700 text-slate-500'
                  }`}
                >
                  B: {tracePathPair[1] || 'Click Comp 2'}
                </span>
                <span className="text-[10px] font-sans text-slate-300">
                  {highlightedContinuousPath
                    ? `Tracing via ${highlightedContinuousPath.hoveredNodeLabel} (${
                        highlightedContinuousPath.isNetVerified
                          ? highlightedContinuousPath.traversedNets.join(' → ')
                          : 'Direct Node Route'
                      })`
                    : tracePathPair[0] && tracePathPair[1]
                    ? 'Hover over any pin or trace node to highlight continuous line'
                    : 'Click 2 components on the board (or Shift+Click in Edit mode)'}
                </span>
                {(tracePathPair[0] || tracePathPair[1]) && (
                  <button
                    type="button"
                    onClick={() => {
                      setTracePathPair([null, null]);
                      setStatusMessage('Cleared Trace Path component pair.');
                    }}
                    className="ml-1 px-1.5 py-0.5 rounded bg-slate-900 hover:bg-rose-950 border border-slate-700 hover:border-rose-500/60 text-slate-300 hover:text-rose-200 flex items-center gap-0.5 text-[9.5px] transition"
                    title="Clear selected trace path components"
                  >
                    <X className="w-2.5 h-2.5" />
                    <span>Clear</span>
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Zoom controls */}
          <div className="absolute top-2.5 right-2.5 z-40 flex items-center gap-1 hud-panel p-1 rounded-lg border border-slate-800/90 shadow-lg">
            <button
              type="button"
              onClick={() => setZoomLevel((prev) => Math.max(0.55, +(prev - 0.15).toFixed(2)))}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] px-1.5 text-slate-200 font-bold tabular-nums">
              {Math.round(zoomLevel * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoomLevel((prev) => Math.min(2.4, +(prev + 0.15).toFixed(2)))}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleFitBoardToViewport}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-cyan-300"
              title="Fit PCB to Viewport"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={() => setZoomLevel(1.0)}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-white"
              title="Reset 100% Zoom"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Active Net Live Telemetry Banner */}
          {activeNetObject && (
            <div className="absolute bottom-3 right-3 z-40 bg-slate-950/90 backdrop-blur-md border border-cyan-500/50 rounded-xl px-3 py-2 text-[10.5px] font-mono text-slate-200 shadow-2xl flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span
                  className="w-2.5 h-2.5 rounded-full animate-pulse"
                  style={{ backgroundColor: getNetColor(activeNetObject.name) }}
                />
                <span className="font-bold text-cyan-300">{activeNetObject.name}</span>
              </div>
              <span className="text-slate-600">|</span>
              <span className="text-amber-300 font-bold tabular-nums">
                {resolveLiveNetVoltage(
                  activeNetObject.name,
                  activeNetObject.nominalVoltage ?? 5.0
                ).toFixed(2)}
                V DC
              </span>
              <span className="text-slate-600">|</span>
              <span className="text-slate-400">
                Nodes: <strong className="text-slate-100">{activeNetObject.connectedComponentRefs.join(', ')}</strong>
              </span>
            </div>
          )}

          {/* Aspect-Locked 0..1000 Normalized PCB Viewport */}
          <div
            ref={viewportScrollRef}
            onWheel={(e) => {
              if (e.ctrlKey || e.metaKey) {
                e.preventDefault();
                const delta = e.deltaY < 0 ? 0.12 : -0.12;
                setZoomLevel((prev) => Math.min(2.4, Math.max(0.55, +(prev + delta).toFixed(2))));
              }
            }}
            className="flex-1 overflow-auto px-6 pt-28 pb-12 flex items-start justify-center"
          >
            <div
              ref={boardRef}
              onPointerDown={(e) => {
                if (!boardRef.current) return;
                if (interactionMode === 'PAN' && viewportScrollRef.current) {
                  dragRef.current = {
                    type: 'PAN_VIEWPORT',
                    startClientX: e.clientX,
                    startClientY: e.clientY,
                    startScrollLeft: viewportScrollRef.current.scrollLeft,
                    startScrollTop: viewportScrollRef.current.scrollTop,
                  };
                  return;
                }
                if (interactionMode === 'MACRO_CROP') {
                  const rect = boardRef.current.getBoundingClientRect();
                  const startXNorm = clampCoord(((e.clientX - rect.left) / Math.max(1, rect.width)) * 1000);
                  const startYNorm = clampCoord(((e.clientY - rect.top) / Math.max(1, rect.height)) * 1000);
                  dragRef.current = {
                    type: 'CROP',
                    startXNorm,
                    startYNorm,
                    boardRect: rect,
                  };
                  setCropMarquee({
                    xmin: startXNorm,
                    ymin: startYNorm,
                    xmax: startXNorm,
                    ymax: startYNorm,
                  });
                  return;
                }
                if (interactionMode === 'EDIT') {
                  setClickedDatasheetNode(null);
                }
              }}
              style={{ width: `${boardWidthPx}px`, height: `${boardHeightPx}px` }}
              className={`relative shrink-0 my-auto bg-[#071512] border-4 border-[#16382f] rounded-xl shadow-2xl overflow-hidden select-none ${
                interactionMode === 'MACRO_CROP' || interactionMode === 'PROBE'
                  ? 'cursor-crosshair'
                  : interactionMode === 'PAN'
                  ? 'cursor-grab active:cursor-grabbing'
                  : ''
              }`}
            >
              {/* Scan Photo / High-Detail PCB Macro Texture (1:1 coordinate fidelity) or High-Detail FR4 Board Vector */}
              {uploadedImageUrl && showPhotoTexture ? (
                <img
                  src={uploadedImageUrl}
                  alt="Uploaded PCB Scan Document"
                  referrerPolicy="no-referrer"
                  decoding="async"
                  draggable={false}
                  onLoad={(e) => {
                    const el = e.currentTarget;
                    if (el.naturalWidth > 0 && el.naturalHeight > 0) {
                      const nextAspect = el.naturalWidth / el.naturalHeight;
                      setBoardAspect(nextAspect);
                      const vp = viewportScrollRef.current;
                      if (vp) {
                        const availW = Math.max(320, vp.clientWidth - 48);
                        const availH = Math.max(240, vp.clientHeight - 160);
                        const baseH = 740 / Math.max(0.5, Math.min(2.2, nextAspect));
                        const fitZoom = Math.min(1.0, availW / 740, availH / baseH);
                        setZoomLevel(Math.min(2.4, Math.max(0.55, Number(fitZoom.toFixed(2)))));
                      }
                    }
                  }}
                  className={`absolute inset-0 w-full h-full object-fill pointer-events-none transition-all duration-200 ${
                    opticalFilter === 'CONTRAST'
                      ? 'opacity-95 contrast-150 brightness-110 saturate-125'
                      : opticalFilter === 'UV_SILK'
                      ? 'opacity-95 invert hue-rotate-180 contrast-125 brightness-105'
                      : opticalFilter === 'XRAY'
                      ? 'opacity-25 grayscale contrast-150'
                      : 'opacity-90'
                  }`}
                />
              ) : (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className={`absolute inset-0 w-full h-full pointer-events-none transition-opacity ${
                    opticalFilter === 'XRAY'
                      ? 'opacity-30 grayscale'
                      : opticalFilter === 'UV_SILK'
                      ? 'invert hue-rotate-180 contrast-125'
                      : opticalFilter === 'CONTRAST'
                      ? 'contrast-150 brightness-110'
                      : 'opacity-100'
                  }`}
                >
                  <defs>
                    <pattern id="pcbGrid" width="40" height="40" patternUnits="userSpaceOnUse">
                      <path d="M 40 0 L 0 0 0 40" fill="none" stroke="#113027" strokeWidth="1" />
                      <circle cx="20" cy="20" r="1.2" fill="#184236" />
                    </pattern>
                    <radialGradient id="groundPourGlow" cx="50%" cy="50%" r="55%">
                      <stop offset="0%" stopColor="#12382e" stopOpacity="0.6" />
                      <stop offset="100%" stopColor="#071512" stopOpacity="0.95" />
                    </radialGradient>
                  </defs>

                  <rect width="1000" height="1000" fill="url(#groundPourGlow)" />
                  <rect width="1000" height="1000" fill="url(#pcbGrid)" />

                  {/* Board Perimeter Silkscreen & Keepout Border */}
                  <rect
                    x="42"
                    y="55"
                    width="916"
                    height="890"
                    rx="18"
                    fill="none"
                    stroke="#286b59"
                    strokeWidth="3"
                    strokeDasharray="12,6"
                  />

                  {/* Corner Chassis Mounting Holes with Ground Via Rings */}
                  {[
                    { cx: 80, cy: 95 },
                    { cx: 920, cy: 95 },
                    { cx: 80, cy: 905 },
                    { cx: 920, cy: 905 },
                  ].map((hole, idx) => (
                    <g key={idx}>
                      <circle cx={hole.cx} cy={hole.cy} r="22" fill="#0d2620" stroke="#c29d38" strokeWidth="5" />
                      <circle cx={hole.cx} cy={hole.cy} r="11" fill="#040b09" />
                    </g>
                  ))}

                  {/* Thermal Via Stitching Array under U1 / U2 Center Zone */}
                  {[380, 420, 460, 500, 540].map((vx) =>
                    [420, 470, 520, 570, 620].map((vy) => (
                      <circle
                        key={`${vx}-${vy}`}
                        cx={vx}
                        cy={vy}
                        r="4"
                        fill="#061410"
                        stroke="#2d7a64"
                        strokeWidth="1.5"
                        opacity="0.65"
                      />
                    ))
                  )}

                  {/* OEM Silkscreen Legend Header */}
                  <text x="125" y="102" fill="#52b79a" fontSize="21" fontFamily="monospace" fontWeight="bold">
                    AUTOELECTRIC LAB PRO // {boardTitle.toUpperCase()}
                  </text>
                  <text x="125" y="130" fill="#37856f" fontSize="13.5" fontFamily="monospace">
                    {selectedBoard.oemReference} · {selectedBoard.pcbSpecs.layers}-LAYER {selectedBoard.pcbSpecs.copperWeightOz}oz CU · AEC-Q100
                  </text>
                </svg>
              )}

              {/* IR Thermal Camera Radial Heat Plumes (underneath components when heatmap enabled) */}
              {showThermalHeatmap && (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full z-10 pointer-events-none"
                >
                  <defs>
                    {components.map((comp) => {
                      const therm = componentThermalMap[comp.refDes];
                      const temp = therm?.tempC ?? 25;
                      const stopColor =
                        temp >= 110
                          ? '#f43f5e'
                          : temp >= 80
                          ? '#f59e0b'
                          : temp >= 50
                          ? '#fb923c'
                          : '#3b82f6';
                      return (
                        <radialGradient key={`grad-${comp.refDes}`} id={`therm-grad-${comp.refDes}`} cx="50%" cy="50%" r="50%">
                          <stop offset="0%" stopColor={stopColor} stopOpacity="0.65" />
                          <stop offset="55%" stopColor={stopColor} stopOpacity="0.25" />
                          <stop offset="100%" stopColor={stopColor} stopOpacity="0" />
                        </radialGradient>
                      );
                    })}
                  </defs>
                  {components.map((comp) => {
                    const center = getBoxCenter(comp.bbox);
                    const rx = Math.max(85, (comp.bbox.xmax - comp.bbox.xmin) * 0.95);
                    const ry = Math.max(85, (comp.bbox.ymax - comp.bbox.ymin) * 0.95);
                    return (
                      <ellipse
                        key={`plume-${comp.refDes}`}
                        cx={center.x}
                        cy={center.y}
                        rx={rx}
                        ry={ry}
                        fill={`url(#therm-grad-${comp.refDes})`}
                      />
                    );
                  })}
                </svg>
              )}

              {/* Neon Copper Traces SVG Overlay (0..1000 normalized viewBox) */}
              {showNets && (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full z-15 pointer-events-none"
                >
                  {nets.map((net) => {
                    const branches: TracePoint[][] =
                      net.traceBranches && net.traceBranches.length > 0
                        ? net.traceBranches
                        : net.tracePoints && net.tracePoints.length >= 2
                        ? [net.tracePoints]
                        : [];

                    if (branches.length === 0) return null;

                    const isNetActive = effectiveNetId === net.name;
                    const neonColor = getNetColor(net.name);

                    return (
                      <g
                        key={net.name}
                        onClick={(e) => {
                          e.stopPropagation();
                          setActiveNetId(net.name);
                          setInspectorSubTab('NETS');
                          const vLive = resolveLiveNetVoltage(net.name, net.nominalVoltage ?? 5.0);
                          setStatusMessage(
                            `NET [${net.name}] (${vLive.toFixed(2)}V DC) -> Nodes: ${net.connectedComponentRefs.join(', ') || 'Trace Node'}`
                          );
                        }}
                        className="cursor-pointer pointer-events-auto"
                      >
                        {branches.map((branch, bIdx) => {
                          if (branch.length < 2) return null;
                          const pointsStr = branch.map((p) => `${p.x},${p.y}`).join(' ');
                          return (
                            <React.Fragment key={`${net.name}-b-${bIdx}`}>
                              {/* Wide invisible hit target for easy clicking */}
                              <polyline
                                points={pointsStr}
                                fill="none"
                                stroke="transparent"
                                strokeWidth="26"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              />
                              {/* Outer neon glow trace */}
                              <polyline
                                points={pointsStr}
                                fill="none"
                                stroke={isNetActive ? '#00f3ff' : neonColor}
                                strokeWidth={isNetActive ? '12' : '5.5'}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                opacity={isNetActive ? '0.95' : '0.6'}
                                style={{
                                  filter: isNetActive
                                    ? 'drop-shadow(0 0 12px #00f3ff)'
                                    : `drop-shadow(0 0 5px ${neonColor})`,
                                }}
                              />
                              {/* Inner high-contrast core conductor */}
                              <polyline
                                points={pointsStr}
                                fill="none"
                                stroke="#ffffff"
                                strokeWidth={isNetActive ? '3.5' : '1.5'}
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeDasharray={isNetActive ? '10,6' : undefined}
                                opacity={isNetActive ? '1' : '0.8'}
                              />
                            </React.Fragment>
                          );
                        })}

                        {/* Interactive Solder Pads / Trace Vertices */}
                        {showPinMarkers &&
                          branches.map((branch, bIdx) =>
                            branch.map((p, pIdx) => {
                              const mnaInfo = resolveMnaNodeDetails(
                                net.name,
                                net.nominalVoltage ?? 5.0
                              );
                              return (
                                <circle
                                  key={`${net.name}-pt-${bIdx}-${pIdx}`}
                                  cx={p.x}
                                  cy={p.y}
                                  r={interactionMode === 'TRACE_EDIT' ? '11' : isNetActive ? '8.5' : '5.5'}
                                  fill={
                                    interactionMode === 'TRACE_EDIT'
                                      ? '#fde047'
                                      : isNetActive
                                      ? '#00f3ff'
                                      : neonColor
                                  }
                                  stroke="#0f172a"
                                  strokeWidth="2.5"
                                  onMouseEnter={() => {
                                    setHoveredPinNetId(net.name);
                                    setHoveredNodeTooltip({
                                      nodeLabel: `Trace Junction Node #${pIdx + 1}`,
                                      netId: net.name,
                                      mnaSourceNode: mnaInfo.mnaNodeId,
                                      detectedVoltage: mnaInfo.voltage,
                                      nominalVoltage: net.nominalVoltage ?? mnaInfo.voltage,
                                      category: net.signalType,
                                      notes: `Connected components: ${net.connectedComponentRefs.join(', ') || 'None'}`,
                                      xNorm: p.x,
                                      yNorm: p.y,
                                    });
                                  }}
                                  onMouseLeave={() => {
                                    setHoveredPinNetId(null);
                                    setHoveredNodeTooltip(null);
                                  }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (interactionMode === 'PROBE') {
                                      handlePlaceProbe({
                                        label: `${net.name} Node #${pIdx + 1}`,
                                        netId: net.name,
                                        nominalVoltage: net.nominalVoltage ?? 5.0,
                                        xNorm: p.x,
                                        yNorm: p.y,
                                      });
                                      return;
                                    }
                                    setActiveNetId(net.name);
                                    const primaryCompRef = net.connectedComponentRefs?.[0];
                                    if (primaryCompRef) {
                                      const linkedComp = components.find((c) => c.refDes === primaryCompRef);
                                      const linkedPin = linkedComp?.pinSpecs?.find(
                                        (ps) => ps.connectedNetId === net.name
                                      );
                                      openDatasheetCardForNode(
                                        primaryCompRef,
                                        p.x,
                                        p.y,
                                        linkedPin?.pinNumber,
                                        linkedPin?.pinName,
                                        net.name
                                      );
                                    }
                                  }}
                                  onPointerDown={(e) => {
                                    if (interactionMode !== 'TRACE_EDIT' || !boardRef.current) return;
                                    e.stopPropagation();
                                    setActiveNetId(net.name);
                                    dragRef.current = {
                                      type: 'MOVE_TRACE_NODE',
                                      netName: net.name,
                                      branchIndex: net.traceBranches ? bIdx : undefined,
                                      pointIndex: pIdx,
                                      boardRect: boardRef.current.getBoundingClientRect(),
                                    };
                                  }}
                                  className={
                                    interactionMode === 'TRACE_EDIT'
                                      ? 'cursor-move hover:scale-125 transition-transform'
                                      : 'cursor-pointer'
                                  }
                                >
                                  <title>{`${net.name} Node #${pIdx + 1}: ${mnaInfo.voltage.toFixed(3)} V DC (MNA: ${mnaInfo.mnaNodeId})`}</title>
                                </circle>
                              );
                            })
                          )}
                      </g>
                    );
                  })}

                  {/* Physical Component Edge Pin Solder Pads & Automatic MNA Voltage Callouts */}
                  {showPinMarkers &&
                    components.map((comp) => {
                      const pins = comp.pinSpecs || [];
                      return pins.map((pin, idx) => {
                        const pt = computeComponentPinCoords(comp, idx, pins.length);
                        const isPinNetActive = effectiveNetId === pin.connectedNetId;
                        const mnaDetails = resolveMnaNodeDetails(
                          pin.connectedNetId,
                          pin.nominalVoltage
                        );
                        const isLeftEdge = pt.x <= comp.bbox.xmin + 10;
                        const labelX = isLeftEdge ? pt.x - 44 : pt.x + 10;
                        const labelY = pt.y - 8;

                        return (
                          <g
                            key={`pad-${comp.refDes}-${pin.pinNumber}`}
                            className="pointer-events-auto cursor-pointer"
                            onMouseEnter={() => {
                              if (pin.connectedNetId && pin.connectedNetId !== 'NET_UNASSIGNED') {
                                setHoveredPinNetId(pin.connectedNetId);
                              }
                              setHoveredNodeTooltip({
                                nodeLabel: `${comp.refDes} · Pin #${pin.pinNumber} (${pin.pinName})`,
                                compRefDes: comp.refDes,
                                pinNumber: pin.pinNumber,
                                pinName: pin.pinName,
                                netId: pin.connectedNetId,
                                mnaSourceNode: mnaDetails.mnaNodeId,
                                detectedVoltage: mnaDetails.voltage,
                                nominalVoltage: pin.nominalVoltage,
                                category: pin.category,
                                notes: pin.notes,
                                xNorm: pt.x,
                                yNorm: pt.y,
                              });
                            }}
                            onMouseLeave={() => {
                              setHoveredPinNetId(null);
                              setHoveredNodeTooltip(null);
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (interactionMode === 'PROBE') {
                                handlePlaceProbe({
                                  label: `${comp.refDes} #${pin.pinNumber} (${pin.pinName})`,
                                  compRefDes: comp.refDes,
                                  pinNumber: pin.pinNumber,
                                  pinName: pin.pinName,
                                  netId: pin.connectedNetId,
                                  nominalVoltage: pin.nominalVoltage,
                                  xNorm: pt.x,
                                  yNorm: pt.y,
                                });
                                return;
                              }
                              if (interactionMode === 'TRACE_PATH' || e.shiftKey) {
                                handleSelectTracePathComponent(comp.refDes);
                                return;
                              }
                              setSelectedCompRef(comp.refDes);
                              setSelectedPinNumber(pin.pinNumber);
                              setActiveNetId(pin.connectedNetId);
                              setInspectorSubTab('PART');
                              openDatasheetCardForNode(
                                comp.refDes,
                                pt.x,
                                pt.y,
                                pin.pinNumber,
                                pin.pinName,
                                pin.connectedNetId
                              );
                            }}
                          >
                            <title>{`${comp.refDes} Pin #${pin.pinNumber} (${pin.pinName}) — Detected MNA Voltage: ${mnaDetails.voltage.toFixed(3)} V DC (Nominal: ${pin.nominalVoltage.toFixed(2)} V) | Net: ${pin.connectedNetId}`}</title>
                            <rect
                              x={pt.x - 7}
                              y={pt.y - 5}
                              width="14"
                              height="10"
                              rx="2.5"
                              fill={isPinNetActive ? '#00f3ff' : '#e2e8f0'}
                              stroke="#0f172a"
                              strokeWidth="1.8"
                            />
                            {showVoltageLabels && (
                              <g>
                                <rect
                                  x={labelX}
                                  y={labelY}
                                  width="36"
                                  height="15"
                                  rx="3"
                                  fill={isPinNetActive ? '#083344' : '#020617'}
                                  fillOpacity="0.92"
                                  stroke={
                                    isPinNetActive
                                      ? '#00f3ff'
                                      : pin.category === 'ground'
                                      ? '#10b981'
                                      : '#f59e0b'
                                  }
                                  strokeWidth="1.2"
                                />
                                <text
                                  x={labelX + 18}
                                  y={labelY + 10.5}
                                  textAnchor="middle"
                                  fill={
                                    isPinNetActive
                                      ? '#67e8f9'
                                      : pin.category === 'ground'
                                      ? '#6ee7b7'
                                      : '#fcd34d'
                                  }
                                  fontSize="9.5"
                                  fontFamily="monospace"
                                  fontWeight="bold"
                                >
                                  {mnaDetails.voltage.toFixed(2)}V
                                </text>
                              </g>
                            )}
                          </g>
                        );
                      });
                    })}
                </svg>
              )}

              {/* Fault Hotspots Layer (Burn / Oxidation / Thermal Zones) */}
              {showHotspots &&
                hotspots.map((hotspot) => {
                  const isSelectedHotspot = selectedHotspotId === hotspot.id;
                  const topPct = (hotspot.bbox.ymin / 1000) * 100;
                  const leftPct = (hotspot.bbox.xmin / 1000) * 100;
                  const widthPct = ((hotspot.bbox.xmax - hotspot.bbox.xmin) / 1000) * 100;
                  const heightPct = ((hotspot.bbox.ymax - hotspot.bbox.ymin) / 1000) * 100;

                  const tone =
                    hotspot.severity === 'CRITICAL'
                      ? 'border-rose-500 bg-rose-500/20 text-rose-200'
                      : hotspot.severity === 'WARNING'
                      ? 'border-amber-400 bg-amber-500/20 text-amber-200'
                      : 'border-cyan-400 bg-cyan-500/15 text-cyan-200';

                  return (
                    <div
                      key={hotspot.id}
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedHotspotId(hotspot.id);
                        setInspectorSubTab('AUDIT');
                        if (hotspot.suspectComponentRef) {
                          setSelectedCompRef(hotspot.suspectComponentRef);
                        }
                        setStatusMessage(`HOTSPOT [${hotspot.severity}]: ${hotspot.label}`);
                      }}
                      style={{
                        top: `${topPct}%`,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: `${heightPct}%`,
                      }}
                      className={`absolute z-20 border-2 border-dashed rounded-md cursor-pointer transition ${tone} ${
                        isSelectedHotspot ? 'ring-2 ring-white shadow-lg z-25' : ''
                      }`}
                      title={`${hotspot.severity}: ${hotspot.label}`}
                    >
                      <span className="absolute -top-4 left-0 text-[8.5px] font-bold px-1 rounded bg-slate-950/90 border border-current whitespace-nowrap flex items-center gap-0.5">
                        <Flame className="w-2.5 h-2.5" />
                        {hotspot.severity}
                      </span>
                    </div>
                  );
                })}

              {/* Interactive Draggable & Resizable Component Bounding Boxes (0..1000 %) */}
              {showComponents &&
                components.map((comp) => {
                  const isSelected = selectedCompRef === comp.refDes;
                  const isTraceSourceA = tracePathPair[0] === comp.refDes;
                  const isTraceTargetB = tracePathPair[1] === comp.refDes;
                  const isVerified = comp.verificationStatus === 'VERIFIED';
                  const activeNetObj = nets.find((n) => n.name === effectiveNetId);
                  const isCompInActiveNet = effectiveNetId
                    ? comp.pinSpecs?.some((p) => p.connectedNetId === effectiveNetId) ||
                      activeNetObj?.connectedComponentRefs.includes(comp.refDes)
                    : false;

                  const thermal = componentThermalMap[comp.refDes] || {
                    tempC: ambientTempC,
                    powerDissipationMw: 0,
                    thermalResistanceJa: 50,
                    status: 'NOMINAL',
                    dominantHeatSource: 'Ambient',
                  };
                  const tempC = Math.round(thermal.tempC);

                  const topPct = (comp.bbox.ymin / 1000) * 100;
                  const leftPct = (comp.bbox.xmin / 1000) * 100;
                  const widthPct = ((comp.bbox.xmax - comp.bbox.xmin) / 1000) * 100;
                  const heightPct = ((comp.bbox.ymax - comp.bbox.ymin) / 1000) * 100;

                  const positionY = comp.bbox.ymin < 230 ? 'top-full mt-2' : 'bottom-full mb-2';
                  const positionX = comp.bbox.xmin > 560 ? 'right-0' : 'left-0';

                  return (
                    <div
                      key={comp.refDes}
                      tabIndex={0}
                      onMouseEnter={() => {
                        const firstNet = comp.pinSpecs?.[0]?.connectedNetId;
                        if (firstNet && firstNet !== 'NET_UNASSIGNED') {
                          setHoveredPinNetId(firstNet);
                        }
                      }}
                      onMouseLeave={() => {
                        setHoveredPinNetId(null);
                      }}
                      onPointerDown={(e) => {
                        if ((e.target as HTMLElement).dataset.noDrag === 'true') return;
                        if (interactionMode === 'PROBE') {
                          e.stopPropagation();
                          const firstPin = comp.pinSpecs?.[0];
                          const pt = firstPin
                            ? computeComponentPinCoords(comp, 0, comp.pinSpecs?.length || 1)
                            : getBoxCenter(comp.bbox);
                          handlePlaceProbe({
                            label: firstPin
                              ? `${comp.refDes} #${firstPin.pinNumber} (${firstPin.pinName})`
                              : comp.refDes,
                            compRefDes: comp.refDes,
                            pinNumber: firstPin?.pinNumber,
                            pinName: firstPin?.pinName,
                            netId: firstPin?.connectedNetId || 'NET_UNASSIGNED',
                            nominalVoltage: firstPin?.nominalVoltage ?? 0,
                            xNorm: pt.x,
                            yNorm: pt.y,
                          });
                          return;
                        }
                        if (interactionMode === 'TRACE_PATH' || (interactionMode === 'EDIT' && e.shiftKey)) {
                          e.stopPropagation();
                          setSelectedCompRef(comp.refDes);
                          handleSelectTracePathComponent(comp.refDes);
                          return;
                        }
                        if (interactionMode !== 'EDIT' || !boardRef.current) return;
                        e.stopPropagation();
                        setSelectedCompRef(comp.refDes);
                        setInspectorSubTab('PART');
                        const firstPin = comp.pinSpecs?.[0];
                        if (
                          firstPin?.connectedNetId &&
                          firstPin.connectedNetId !== 'NET_UNASSIGNED'
                        ) {
                          setActiveNetId(firstPin.connectedNetId);
                          setSelectedPinNumber(firstPin.pinNumber);
                        }
                        const boxCenter = getBoxCenter(comp.bbox);
                        openDatasheetCardForNode(
                          comp.refDes,
                          boxCenter.x,
                          boxCenter.y,
                          firstPin?.pinNumber,
                          firstPin?.pinName,
                          firstPin?.connectedNetId
                        );
                        dragRef.current = {
                          type: 'MOVE',
                          refDes: comp.refDes,
                          startClientX: e.clientX,
                          startClientY: e.clientY,
                          origBox: { ...comp.bbox },
                          boardRect: boardRef.current.getBoundingClientRect(),
                        };
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          if (interactionMode === 'TRACE_PATH') {
                            handleSelectTracePathComponent(comp.refDes);
                          } else {
                            setSelectedCompRef(comp.refDes);
                          }
                        }
                      }}
                      style={{
                        top: `${topPct}%`,
                        left: `${leftPct}%`,
                        width: `${widthPct}%`,
                        height: `${heightPct}%`,
                      }}
                      className={`group/comp absolute ${
                        interactionMode === 'TRACE_PATH'
                          ? 'cursor-crosshair'
                          : 'cursor-grab active:cursor-grabbing'
                      } border-2 transition-shadow flex flex-col justify-between p-1.5 rounded-md focus:outline-none ${
                        showThermalHeatmap
                          ? tempC >= 110
                            ? 'border-rose-500 bg-rose-950/85 text-rose-200 shadow-[0_0_24px_rgba(244,63,94,0.95)] animate-pulse z-25'
                            : tempC >= 80
                            ? 'border-amber-400 bg-amber-950/80 text-amber-200 shadow-[0_0_16px_rgba(245,158,11,0.75)] z-25'
                            : tempC >= 48
                            ? 'border-orange-400 bg-orange-950/55 text-orange-200 z-25'
                            : 'border-sky-500/80 bg-sky-950/45 text-sky-200 z-25'
                          : isTraceSourceA
                          ? 'border-fuchsia-400 bg-fuchsia-950/80 shadow-[0_0_22px_rgba(232,121,249,0.7)] ring-2 ring-fuchsia-400 z-30'
                          : isTraceTargetB
                          ? 'border-cyan-300 bg-cyan-950/80 shadow-[0_0_22px_rgba(34,211,238,0.75)] ring-2 ring-cyan-300 z-30'
                          : isSelected
                          ? 'border-cyan-400 bg-cyan-950/80 shadow-2xl ring-2 ring-cyan-400/60 z-30'
                          : isCompInActiveNet
                          ? 'border-cyan-400 bg-cyan-950/85 shadow-[0_0_18px_rgba(0,243,255,0.6)] ring-1 ring-cyan-300 z-25'
                          : isVerified
                          ? 'border-emerald-500/80 bg-emerald-950/40 hover:border-emerald-400 z-20'
                          : 'border-amber-500/80 bg-amber-950/35 hover:border-amber-400 z-20'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[10px] font-mono font-bold leading-none gap-1">
                        <span
                          className={
                            showThermalHeatmap
                              ? tempC >= 110
                                ? 'text-rose-300 font-extrabold'
                                : tempC >= 80
                                ? 'text-amber-300 font-extrabold'
                                : 'text-sky-300 font-extrabold'
                              : isTraceSourceA
                              ? 'text-fuchsia-300 font-extrabold'
                              : isTraceTargetB
                              ? 'text-cyan-200 font-extrabold'
                              : isSelected || isCompInActiveNet
                              ? 'text-cyan-300 font-extrabold'
                              : isVerified
                              ? 'text-emerald-300'
                              : 'text-amber-300'
                          }
                        >
                          {comp.refDes}
                        </span>
                        <div className="flex items-center gap-0.5 shrink-0">
                          {isTraceSourceA && (
                            <span className="text-[7px] bg-fuchsia-500 text-slate-950 px-1 rounded font-extrabold">
                              TRACE A
                            </span>
                          )}
                          {isTraceTargetB && (
                            <span className="text-[7px] bg-cyan-300 text-slate-950 px-1 rounded font-extrabold">
                              TRACE B
                            </span>
                          )}
                          {showThermalHeatmap && (
                            <span
                              className={`text-[8.5px] px-1 rounded font-bold border ${
                                tempC >= 110
                                  ? 'bg-rose-950 text-rose-200 border-rose-500'
                                  : tempC >= 80
                                  ? 'bg-amber-950 text-amber-200 border-amber-500'
                                  : tempC >= 48
                                  ? 'bg-orange-950 text-orange-200 border-orange-500'
                                  : 'bg-sky-950 text-sky-200 border-sky-500'
                              }`}
                            >
                              {tempC}°C · {thermal.powerDissipationMw}mW
                            </span>
                          )}
                          {!showThermalHeatmap && !isTraceSourceA && !isTraceTargetB && isCompInActiveNet && (
                            <span className="text-[7px] bg-cyan-400 text-black px-1 rounded font-extrabold">
                              NET
                            </span>
                          )}
                          {isVerified ? (
                            <CheckCircle className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <span className="text-[7.5px] text-amber-300 bg-amber-950/90 px-1 rounded border border-amber-700">
                              {comp.source === 'LOCAL_CV' ? 'CV' : 'AI'}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="text-[9px] font-mono truncate text-slate-100 font-semibold leading-tight">
                        {comp.marking || comp.category}
                      </div>

                      {/* Component Pin Interactive Badges with Automatic MNA Voltage Labeling */}
                      {comp.pinSpecs && comp.pinSpecs.length > 0 && (
                        <div className="flex items-center gap-0.5 flex-wrap pt-0.5 border-t border-slate-800/80">
                          {comp.pinSpecs.slice(0, 8).map((pin, idx) => {
                            const isPinSelected =
                              selectedPinNumber === pin.pinNumber && selectedCompRef === comp.refDes;
                            const isPinNetActive = effectiveNetId === pin.connectedNetId;
                            const mnaDetails = resolveMnaNodeDetails(
                              pin.connectedNetId,
                              pin.nominalVoltage
                            );
                            const liveV = mnaDetails.voltage;
                            const pinCoords = computeComponentPinCoords(
                              comp,
                              idx,
                              comp.pinSpecs?.length || 1
                            );
                            return (
                              <button
                                key={pin.pinNumber}
                                data-no-drag="true"
                                onMouseEnter={() => {
                                  if (pin.connectedNetId && pin.connectedNetId !== 'NET_UNASSIGNED') {
                                    setHoveredPinNetId(pin.connectedNetId);
                                  }
                                  setHoveredNodeTooltip({
                                    nodeLabel: `${comp.refDes} · Pin #${pin.pinNumber} (${pin.pinName})`,
                                    compRefDes: comp.refDes,
                                    pinNumber: pin.pinNumber,
                                    pinName: pin.pinName,
                                    netId: pin.connectedNetId,
                                    mnaSourceNode: mnaDetails.mnaNodeId,
                                    detectedVoltage: liveV,
                                    nominalVoltage: pin.nominalVoltage,
                                    category: pin.category,
                                    notes: pin.notes,
                                    xNorm: pinCoords.x,
                                    yNorm: pinCoords.y,
                                  });
                                }}
                                onMouseLeave={() => {
                                  setHoveredPinNetId(null);
                                  setHoveredNodeTooltip(null);
                                }}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  if (interactionMode === 'PROBE') {
                                    handlePlaceProbe({
                                      label: `${comp.refDes} #${pin.pinNumber} (${pin.pinName})`,
                                      compRefDes: comp.refDes,
                                      pinNumber: pin.pinNumber,
                                      pinName: pin.pinName,
                                      netId: pin.connectedNetId,
                                      nominalVoltage: pin.nominalVoltage,
                                      xNorm: pinCoords.x,
                                      yNorm: pinCoords.y,
                                    });
                                    return;
                                  }
                                  if (interactionMode === 'TRACE_PATH' || e.shiftKey) {
                                    handleSelectTracePathComponent(comp.refDes);
                                    return;
                                  }
                                  setSelectedCompRef(comp.refDes);
                                  setSelectedPinNumber(pin.pinNumber);
                                  setActiveNetId(pin.connectedNetId);
                                  setInspectorSubTab('PART');
                                  openDatasheetCardForNode(
                                    comp.refDes,
                                    pinCoords.x,
                                    pinCoords.y,
                                    pin.pinNumber,
                                    pin.pinName,
                                    pin.connectedNetId
                                  );
                                  const connectedNet = nets.find((n) => n.name === pin.connectedNetId);
                                  const nodes = connectedNet
                                    ? connectedNet.connectedComponentRefs.join(', ')
                                    : comp.refDes;
                                  setStatusMessage(
                                    `PIN #${pin.pinNumber} (${pin.pinName}) · ${liveV.toFixed(3)}V DC · Net [${pin.connectedNetId}] -> ${nodes}`
                                  );
                                }}
                                title={`${comp.refDes} Pin #${pin.pinNumber} (${pin.pinName}) — Detected MNA Voltage: ${liveV.toFixed(3)} V DC (Nominal: ${pin.nominalVoltage.toFixed(2)} V) | Net: ${pin.connectedNetId}`}
                                className={`px-1 rounded text-[7px] font-mono font-bold transition flex items-center gap-0.5 ${
                                  isPinSelected
                                    ? 'bg-cyan-300 text-black ring-1 ring-white font-extrabold'
                                    : isPinNetActive
                                    ? 'bg-cyan-950 text-cyan-200 border border-cyan-400 shadow-[0_0_10px_rgba(0,243,255,0.5)]'
                                    : 'bg-slate-900/90 text-slate-300 hover:bg-slate-800 border border-slate-700'
                                }`}
                              >
                                <span>#{pin.pinNumber}</span>
                                {showVoltageLabels && (
                                  <span
                                    className={
                                      isPinSelected
                                        ? 'text-slate-950 font-extrabold'
                                        : pin.category === 'ground'
                                        ? 'text-emerald-300'
                                        : 'text-amber-300'
                                    }
                                  >
                                    {liveV.toFixed(2)}V
                                  </span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {/* Corner Resize Handle */}
                      {interactionMode === 'EDIT' && (
                        <div
                          data-no-drag="true"
                          onPointerDown={(e) => {
                            if (!boardRef.current) return;
                            e.stopPropagation();
                            setSelectedCompRef(comp.refDes);
                            dragRef.current = {
                              type: 'RESIZE',
                              refDes: comp.refDes,
                              startClientX: e.clientX,
                              startClientY: e.clientY,
                              origBox: { ...comp.bbox },
                              boardRect: boardRef.current.getBoundingClientRect(),
                            };
                          }}
                          title="Drag to resize bounding box"
                          className="absolute -bottom-1 -right-1 w-3 h-3 bg-cyan-400 border border-slate-950 rounded-sm cursor-nwse-resize opacity-80 hover:opacity-100"
                        />
                      )}

                      {/* Hover Contextual Spec & Live Electro-Thermal Tooltip (hidden when hovering a specific pin node so node tooltip takes focus) */}
                      {!hoveredNodeTooltip && (
                        <div
                          className={`opacity-0 group-hover/comp:opacity-100 pointer-events-none absolute ${positionY} ${positionX} w-68 bg-slate-950/95 backdrop-blur-md border border-cyan-500/70 text-slate-100 p-2.5 rounded-lg shadow-2xl z-40 transition-opacity duration-150 font-mono`}
                        >
                          <div className="flex items-center justify-between border-b border-slate-800 pb-1.5 mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <strong className="text-cyan-300 text-xs">{comp.refDes}</strong>
                              <span className="text-[10px] text-slate-400 font-sans truncate max-w-[120px]">
                                {comp.category.replace(/_/g, ' ')}
                              </span>
                            </div>
                            <span className="text-[9px] px-1.5 rounded font-bold bg-slate-900 border border-slate-700 text-amber-300 tabular-nums">
                              {thermal.tempC.toFixed(1)}°C ({thermal.powerDissipationMw}mW)
                            </span>
                          </div>
                          <div className="grid grid-cols-2 gap-x-2 gap-y-1 text-[10px]">
                            <div>
                              <span className="text-slate-500 text-[8.5px] block font-sans">Package</span>
                              <span className="font-semibold text-slate-100 truncate block">
                                {comp.packageType || 'SMD'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 text-[8.5px] block font-sans">Rating</span>
                              <span className="font-semibold text-cyan-300 truncate block">
                                {comp.operatingVoltageRange || '5V DC'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 text-[8.5px] block font-sans">Marking</span>
                              <span className="font-semibold text-amber-300 truncate block">
                                {comp.marking || comp.decodedValue || 'N/A'}
                              </span>
                            </div>
                            <div>
                              <span className="text-slate-500 text-[8.5px] block font-sans">Thermal RθJA</span>
                              <span className="font-semibold text-emerald-300 truncate block">
                                {thermal.thermalResistanceJa} °C/W
                              </span>
                            </div>
                          </div>
                          <div className="mt-1.5 pt-1 border-t border-slate-800/80 text-[9px] text-slate-400 font-sans truncate">
                            {thermal.dominantHeatSource}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}

              {/* Continuous Highlighted Trace Path Between Two Clicked Components on Node Hover */}
              {highlightedContinuousPath && highlightedContinuousPath.points.length >= 2 && (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full z-35 pointer-events-none"
                >
                  <defs>
                    <linearGradient id="tracePathGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                      <stop offset="0%" stopColor="#e879f9" />
                      <stop offset="50%" stopColor="#22d3ee" />
                      <stop offset="100%" stopColor="#38bdf8" />
                    </linearGradient>
                  </defs>

                  {/* Outer luminous halo */}
                  <polyline
                    points={highlightedContinuousPath.pointsStr}
                    fill="none"
                    stroke={highlightedContinuousPath.isNetVerified ? '#22d3ee' : '#e879f9'}
                    strokeWidth="16"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    opacity="0.35"
                  />

                  {/* Crisp continuous core conductor */}
                  <polyline
                    points={highlightedContinuousPath.pointsStr}
                    fill="none"
                    stroke="url(#tracePathGradient)"
                    strokeWidth="6.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />

                  {/* Animated electron signal flow dashes */}
                  <polyline
                    points={highlightedContinuousPath.pointsStr}
                    fill="none"
                    stroke="#ffffff"
                    strokeWidth="2.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeDasharray="10,8"
                    className="animate-electron-flow"
                  />

                  {/* Component A Anchor Marker */}
                  <circle
                    cx={highlightedContinuousPath.anchorA.x}
                    cy={highlightedContinuousPath.anchorA.y}
                    r="13"
                    fill="#d946ef"
                    fillOpacity="0.28"
                    stroke="#f0abfc"
                    strokeWidth="3"
                  />
                  <circle
                    cx={highlightedContinuousPath.anchorA.x}
                    cy={highlightedContinuousPath.anchorA.y}
                    r="5"
                    fill="#ffffff"
                  />

                  {/* Hovered Node Junction Ring */}
                  <circle
                    cx={highlightedContinuousPath.hoverPt.x}
                    cy={highlightedContinuousPath.hoverPt.y}
                    r="15"
                    fill="none"
                    stroke="#fde047"
                    strokeWidth="2.8"
                    strokeDasharray="4,3"
                  />
                  <circle
                    cx={highlightedContinuousPath.hoverPt.x}
                    cy={highlightedContinuousPath.hoverPt.y}
                    r="5.5"
                    fill="#fde047"
                  />

                  {/* Component B Anchor Marker */}
                  <circle
                    cx={highlightedContinuousPath.anchorB.x}
                    cy={highlightedContinuousPath.anchorB.y}
                    r="13"
                    fill="#06b6d4"
                    fillOpacity="0.28"
                    stroke="#67e8f9"
                    strokeWidth="3"
                  />
                  <circle
                    cx={highlightedContinuousPath.anchorB.x}
                    cy={highlightedContinuousPath.anchorB.y}
                    r="5"
                    fill="#ffffff"
                  />
                </svg>
              )}

              {/* Dual-Probe SVG Reticles & Differential Measurement Span */}
              {(probeA || probeB) && (
                <svg
                  viewBox="0 0 1000 1000"
                  preserveAspectRatio="none"
                  className="absolute inset-0 w-full h-full z-40 pointer-events-none"
                >
                  {probeA && probeB && (
                    <g>
                      <line
                        x1={probeA.xNorm}
                        y1={probeA.yNorm}
                        x2={probeB.xNorm}
                        y2={probeB.yNorm}
                        stroke="#38bdf8"
                        strokeWidth="3.5"
                        strokeDasharray="10,6"
                      />
                      {dualProbeMeasurement && (
                        <g>
                          <rect
                            x={(probeA.xNorm + probeB.xNorm) / 2 - 78}
                            y={(probeA.yNorm + probeB.yNorm) / 2 - 14}
                            width="156"
                            height="28"
                            rx="6"
                            fill="#020617"
                            fillOpacity="0.94"
                            stroke="#38bdf8"
                            strokeWidth="2"
                          />
                          <text
                            x={(probeA.xNorm + probeB.xNorm) / 2}
                            y={(probeA.yNorm + probeB.yNorm) / 2 + 4}
                            textAnchor="middle"
                            fill="#fcd34d"
                            fontSize="11.5"
                            fontFamily="monospace"
                            fontWeight="bold"
                          >
                            {`ΔV ${dualProbeMeasurement.differentialVoltage >= 0 ? '+' : ''}${dualProbeMeasurement.differentialVoltage.toFixed(2)}V · ${
                              dualProbeMeasurement.estimatedOhms !== null
                                ? `${dualProbeMeasurement.estimatedOhms}Ω`
                                : dualProbeMeasurement.diodeDropVolts !== null
                                ? `${dualProbeMeasurement.diodeDropVolts.toFixed(2)}Vf`
                                : 'OL'
                            }`}
                          </text>
                        </g>
                      )}
                    </g>
                  )}

                  {probeA && (
                    <g>
                      <circle cx={probeA.xNorm} cy={probeA.yNorm} r="18" fill="#ef4444" fillOpacity="0.22" stroke="#ef4444" strokeWidth="3" />
                      <circle cx={probeA.xNorm} cy={probeA.yNorm} r="5.5" fill="#ef4444" stroke="#ffffff" strokeWidth="2" />
                      <rect x={probeA.xNorm - 14} y={probeA.yNorm - 34} width="28" height="16" rx="4" fill="#ef4444" />
                      <text x={probeA.xNorm} y={probeA.yNorm - 22.5} textAnchor="middle" fill="#ffffff" fontSize="10.5" fontFamily="monospace" fontWeight="bold">
                        A+
                      </text>
                    </g>
                  )}

                  {probeB && (
                    <g>
                      <circle cx={probeB.xNorm} cy={probeB.yNorm} r="18" fill="#38bdf8" fillOpacity="0.22" stroke="#38bdf8" strokeWidth="3" />
                      <circle cx={probeB.xNorm} cy={probeB.yNorm} r="5.5" fill="#38bdf8" stroke="#ffffff" strokeWidth="2" />
                      <rect x={probeB.xNorm - 14} y={probeB.yNorm - 34} width="28" height="16" rx="4" fill="#0284c7" />
                      <text x={probeB.xNorm} y={probeB.yNorm - 22.5} textAnchor="middle" fill="#ffffff" fontSize="10.5" fontFamily="monospace" fontWeight="bold">
                        B-
                      </text>
                    </g>
                  )}
                </svg>
              )}

              {/* Floating Precision MNA Node Voltage Tooltip on Pin / Node Hover */}
              {hoveredNodeTooltip && (
                <div
                  style={{
                    top: `${Math.min(76, Math.max(8, (hoveredNodeTooltip.yNorm / 1000) * 100 - 14))}%`,
                    left: `${Math.min(64, Math.max(4, (hoveredNodeTooltip.xNorm / 1000) * 100 + 3))}%`,
                  }}
                  className="pointer-events-none absolute z-50 w-[min(18rem,calc(100vw-2rem))] sm:w-72 bg-slate-950/95 backdrop-blur-md border-2 border-cyan-400 text-slate-100 p-2.5 sm:p-3 rounded-xl shadow-[0_0_25px_rgba(0,243,255,0.45)] font-mono text-[10px]"
                >
                  <div className="flex items-center justify-between gap-2 border-b border-slate-800 pb-1.5 mb-2">
                    <div className="flex items-center gap-1.5 truncate">
                      <Zap className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="font-bold text-cyan-300 truncate">
                        {hoveredNodeTooltip.nodeLabel}
                      </span>
                    </div>
                    <span className="text-[8.5px] px-1.5 py-0.5 rounded bg-cyan-950 border border-cyan-500/50 text-cyan-200 uppercase shrink-0">
                      MNA PROBE
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 bg-slate-900/90 p-2 rounded-lg border border-slate-800 mb-2">
                    <div>
                      <span className="text-[8.5px] text-slate-400 block font-sans">
                        Detected MNA Voltage
                      </span>
                      <span className="text-sm font-extrabold text-amber-300 tabular-nums">
                        {hoveredNodeTooltip.detectedVoltage.toFixed(3)} V DC
                      </span>
                    </div>
                    <div>
                      <span className="text-[8.5px] text-slate-400 block font-sans">
                        Nominal Spec / ΔV
                      </span>
                      <span className="text-xs font-bold text-slate-200 tabular-nums block">
                        {hoveredNodeTooltip.nominalVoltage.toFixed(2)} V (
                        {hoveredNodeTooltip.detectedVoltage - hoveredNodeTooltip.nominalVoltage >= 0
                          ? '+'
                          : ''}
                        {(
                          hoveredNodeTooltip.detectedVoltage - hoveredNodeTooltip.nominalVoltage
                        ).toFixed(2)}
                        V)
                      </span>
                    </div>
                  </div>

                  <div className="flex flex-col gap-1 text-[9.5px]">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">PCB Net ID:</span>
                      <span className="font-bold text-cyan-300">{hoveredNodeTooltip.netId}</span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-400">MNA Solver Node:</span>
                      <span className="font-semibold text-emerald-300 truncate max-w-[165px]">
                        {hoveredNodeTooltip.mnaSourceNode}
                      </span>
                    </div>
                  </div>

                  {highlightedContinuousPath && (
                    <div className="mt-1.5 pt-1.5 border-t border-fuchsia-500/40 text-[9px] font-mono text-fuchsia-200 flex items-center justify-between gap-2">
                      <span className="font-bold truncate">
                        PATH: {highlightedContinuousPath.compA} ↔ {highlightedContinuousPath.compB}
                      </span>
                      <span className="px-1 py-0.5 rounded bg-fuchsia-950/90 border border-fuchsia-500/50 text-[8px] shrink-0">
                        {highlightedContinuousPath.isNetVerified ? 'NET VERIFIED' : 'NODE ROUTE'}
                      </span>
                    </div>
                  )}

                  {hoveredNodeTooltip.notes && (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-800/80 text-[9px] text-slate-300 font-sans leading-snug">
                      {hoveredNodeTooltip.notes}
                    </div>
                  )}
                </div>
              )}

              {/* Floating Component Datasheet Specification Card (on Node Click when 'Show Datasheet Info' enabled) */}
              {showDatasheetInfo &&
                clickedDatasheetNode &&
                (() => {
                  const comp = components.find((c) => c.refDes === clickedDatasheetNode.compRefDes);
                  if (!comp) return null;

                  const clickedPin =
                    clickedDatasheetNode.pinNumber !== undefined
                      ? comp.pinSpecs?.find((p) => p.pinNumber === clickedDatasheetNode.pinNumber)
                      : undefined;
                  const clickedNet = clickedDatasheetNode.netId
                    ? nets.find((n) => n.name === clickedDatasheetNode.netId)
                    : undefined;
                  const thermal = componentThermalMap[comp.refDes];

                  const resistanceSpec = comp.category.toUpperCase().includes('RESISTOR')
                    ? comp.decodedValue
                    : comp.maxCurrentRating && /Ω|ohm|esr/i.test(comp.maxCurrentRating)
                    ? comp.maxCurrentRating
                    : clickedNet?.impedanceOhms !== undefined
                    ? `${comp.decodedValue} (Trace ${clickedNet.impedanceOhms}Ω)`
                    : comp.decodedValue || 'N/A';

                  const maxVoltageSpec =
                    comp.operatingVoltageRange ||
                    (clickedPin ? `${clickedPin.nominalVoltage.toFixed(1)}V Nominal Pin Rail` : '5V–12V DC Automotive');

                  const currentOrThermalSpec =
                    comp.maxCurrentRating && !/Ω|ohm|esr/i.test(comp.maxCurrentRating)
                      ? comp.maxCurrentRating
                      : thermal
                      ? `${thermal.thermalResistanceJa} °C/W · ${thermal.tempC.toFixed(1)}°C`
                      : comp.maxCurrentRating || 'N/A';

                  const mnaPinInfo = clickedPin
                    ? resolveMnaNodeDetails(clickedPin.connectedNetId, clickedPin.nominalVoltage)
                    : null;

                  return (
                    <div
                      onPointerDown={(e) => e.stopPropagation()}
                      onClick={(e) => e.stopPropagation()}
                      style={{
                        top: `${Math.min(64, Math.max(8, (clickedDatasheetNode.yNorm / 1000) * 100 + 2))}%`,
                        left: `${Math.min(58, Math.max(4, (clickedDatasheetNode.xNorm / 1000) * 100 + 2))}%`,
                      }}
                      className="pointer-events-auto absolute z-45 w-[min(19rem,calc(100vw-2rem))] sm:w-76 bg-slate-950/95 backdrop-blur-md border-2 border-sky-400/80 text-slate-100 p-2.5 sm:p-3 rounded-xl shadow-[0_0_26px_rgba(56,189,248,0.38)] font-mono text-[10px]"
                    >
                      <div className="flex items-start justify-between gap-2 border-b border-slate-800 pb-1.5 mb-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <FileText className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                            <span className="font-extrabold text-sky-300 text-xs">{comp.refDes}</span>
                            <span className="text-slate-200 font-bold truncate">
                              {comp.marking || comp.category}
                            </span>
                          </div>
                          <span className="text-[9px] text-slate-400 font-sans block truncate mt-0.5">
                            {comp.packageType || 'SMD'} · {comp.category.replace(/_/g, ' ')}
                          </span>
                        </div>
                        <button
                          onClick={() => setClickedDatasheetNode(null)}
                          className="p-0.5 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition shrink-0"
                          title="Close Datasheet Info Card"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <div className="grid grid-cols-2 gap-1.5 bg-slate-900/90 p-2 rounded-lg border border-slate-800 mb-2">
                        <div className="col-span-2">
                          <span className="text-[8.5px] text-slate-400 block font-sans">
                            Max / Operating Voltage
                          </span>
                          <span className="text-[10px] font-bold text-amber-300 leading-tight block">
                            {maxVoltageSpec}
                          </span>
                        </div>
                        <div>
                          <span className="text-[8.5px] text-slate-400 block font-sans">
                            Resistance / Value
                          </span>
                          <span className="text-[10px] font-bold text-cyan-300 leading-tight block truncate" title={resistanceSpec}>
                            {resistanceSpec}
                          </span>
                        </div>
                        <div>
                          <span className="text-[8.5px] text-slate-400 block font-sans">
                            Current / Thermal
                          </span>
                          <span className="text-[10px] font-bold text-emerald-300 leading-tight block truncate" title={currentOrThermalSpec}>
                            {currentOrThermalSpec}
                          </span>
                        </div>
                      </div>

                      {clickedPin && mnaPinInfo && (
                        <div className="mb-2 px-2 py-1 rounded bg-sky-950/60 border border-sky-500/35 flex items-center justify-between gap-2 text-[9px]">
                          <span className="text-sky-200 truncate">
                            Pin #{clickedPin.pinNumber} ({clickedPin.pinName})
                          </span>
                          <span className="font-bold text-amber-300 tabular-nums shrink-0">
                            {mnaPinInfo.voltage.toFixed(2)}V · {clickedPin.connectedNetId}
                          </span>
                        </div>
                      )}

                      <p className="text-[9.5px] text-slate-300 font-sans leading-snug line-clamp-3">
                        {comp.datasheetSummary || comp.circuitFunction || comp.notes || 'Standard automotive ECU component.'}
                      </p>

                      <div className="mt-2 pt-1.5 border-t border-slate-800 flex items-center justify-between gap-2">
                        {onOpenGroundedSearch ? (
                          <button
                            onClick={() =>
                              onOpenGroundedSearch(
                                `${comp.marking || comp.decodedValue} ${comp.category} datasheet specifications`,
                                '',
                                comp.marking || comp.refDes
                              )
                            }
                            className="px-2 py-0.5 rounded bg-cyan-950 hover:bg-cyan-900 border border-cyan-500/40 text-cyan-200 text-[9px] font-semibold flex items-center gap-1 transition"
                          >
                            <Globe className="w-2.5 h-2.5" />
                            <span>Full Datasheet</span>
                          </button>
                        ) : (
                          <span />
                        )}
                        <button
                          onClick={() => {
                            setSelectedCompRef(comp.refDes);
                            setInspectorSubTab('PART');
                          }}
                          className="text-[9px] text-sky-300 hover:text-sky-200 font-semibold"
                        >
                          Open Part Inspector →
                        </button>
                      </div>
                    </div>
                  );
                })()}

              {/* Thermal Heatmap Legend & Ambient Temperature Control Bar */}
              {showThermalHeatmap && (
                <div className="absolute bottom-3 left-3 z-30 bg-slate-950/95 backdrop-blur-md border border-rose-500/60 rounded-xl p-2.5 text-[10px] font-mono text-slate-100 shadow-2xl flex flex-wrap items-center gap-3">
                  <div className="flex items-center gap-1.5 font-bold text-rose-300">
                    <Flame className="w-4 h-4 text-rose-400 animate-pulse" />
                    <span>ELECTRO-THERMAL IR (TJ = TA + PD·RθJA)</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-sky-500" /> {ambientTempC}°C (Idle)
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-orange-500" /> 55°C
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400" /> 85°C
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-full bg-rose-500" /> 115°C+
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 pl-2 border-l border-slate-800">
                    <span className="text-[9px] text-slate-400">TA:</span>
                    <input
                      type="range"
                      min={20}
                      max={85}
                      value={ambientTempC}
                      onChange={(e) => setAmbientTempC(Number(e.target.value))}
                      className="w-16 accent-rose-500 cursor-pointer"
                      title="Adjust Ambient Engine Bay / Bench Temperature (TA)"
                    />
                    <span className="text-[9.5px] font-bold text-amber-300 tabular-nums">{ambientTempC}°C</span>
                  </div>
                </div>
              )}

              {/* Macro Crop Drag Selection Marquee */}
              {cropMarquee && (
                <div
                  style={{
                    top: `${(cropMarquee.ymin / 1000) * 100}%`,
                    left: `${(cropMarquee.xmin / 1000) * 100}%`,
                    width: `${((cropMarquee.xmax - cropMarquee.xmin) / 1000) * 100}%`,
                    height: `${((cropMarquee.ymax - cropMarquee.ymin) / 1000) * 100}%`,
                  }}
                  className="absolute z-40 border-2 border-dashed border-amber-400 bg-amber-400/15 pointer-events-none"
                >
                  <span className="absolute -top-5 left-0 bg-amber-500 text-slate-950 text-[9px] font-bold px-1.5 rounded">
                    MACRO CROP SCAN AREA
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Right: Structured Tabbed Inspection, Pinout Editor, Nets & Thermal Drawer */}
        <aside
          className={`w-full md:w-[430px] bg-slate-900 p-3 flex-col gap-3 overflow-y-auto text-xs font-mono border-t md:border-t-0 md:border-l border-slate-800 shrink-0 ${
            mobileTab === 'DRAWER' ? 'flex' : 'hidden md:flex'
          }`}
        >
          {/* Inspector Sub-Navigation Tabs */}
          <div className="grid grid-cols-5 gap-1 bg-slate-950 p-1 rounded-xl border border-slate-800">
            <button
              type="button"
              onClick={() => setInspectorSubTab('PART')}
              className={`py-1.5 px-1 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition ${
                inspectorSubTab === 'PART'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/50 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Cpu className="w-3 h-3 shrink-0" />
              <span>Part</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorSubTab('NETS')}
              className={`py-1.5 px-1 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition ${
                inspectorSubTab === 'NETS'
                  ? 'bg-cyan-950 text-cyan-300 border border-cyan-500/50 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Waypoints className="w-3 h-3 shrink-0" />
              <span>Nets</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorSubTab('PROBE')}
              className={`py-1.5 px-1 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition ${
                inspectorSubTab === 'PROBE'
                  ? 'bg-sky-950 text-sky-300 border border-sky-500/50 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Crosshair className="w-3 h-3 shrink-0" />
              <span>Probe</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorSubTab('AUDIT')}
              className={`py-1.5 px-1 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 whitespace-nowrap transition ${
                inspectorSubTab === 'AUDIT'
                  ? 'bg-rose-950 text-rose-300 border border-rose-500/50 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
              title={`Diagnostic Audit (${boardAuditFindings.length} findings)`}
            >
              <ShieldAlert className="w-3 h-3 shrink-0" />
              <span>Audit {boardAuditFindings.length > 0 ? boardAuditFindings.length : ''}</span>
            </button>
            <button
              type="button"
              onClick={() => setInspectorSubTab('THERMAL')}
              className={`py-1.5 px-1 rounded-lg text-[10px] font-bold flex items-center justify-center gap-1 transition ${
                inspectorSubTab === 'THERMAL'
                  ? 'bg-amber-950 text-amber-300 border border-amber-500/50 shadow'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              <Thermometer className="w-3 h-3 shrink-0" />
              <span>IR</span>
            </button>
          </div>

          {/* SUB-TAB 1: SELECTED COMPONENT DATASHEET & PINOUT EDITOR */}
          {inspectorSubTab === 'PART' && (
            <>
              {selectedComponent ? (
                <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex flex-col gap-2.5 shadow-md">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-lg font-bold text-cyan-300">{selectedComponent.refDes}</span>
                      <span className="text-[11px] text-slate-400 font-sans truncate">
                        ({selectedComponent.category})
                      </span>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded font-bold border ${
                          selectedComponent.verificationStatus === 'VERIFIED'
                            ? 'bg-emerald-950 border-emerald-700 text-emerald-300'
                            : 'bg-amber-950 border-amber-700 text-amber-300'
                        }`}
                      >
                        {selectedComponent.verificationStatus}
                      </span>
                      <button
                        onClick={() => handleDeleteComponent(selectedComponent.refDes)}
                        className="p-1 text-slate-500 hover:text-rose-400 rounded transition"
                        title="Delete Part Observation"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* Editable Component Specs */}
                  <div className="grid grid-cols-2 gap-2 text-[11px] bg-slate-900 p-2.5 rounded-lg border border-slate-800 font-sans">
                    <div>
                      <label className="text-slate-500 block text-[9px] font-mono uppercase">Marking Code</label>
                      <input
                        type="text"
                        value={selectedComponent.marking}
                        onChange={(e) =>
                          updateSelectedComponentField(selectedComponent.refDes, { marking: e.target.value })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 block text-[9px] font-mono uppercase">Package</label>
                      <input
                        type="text"
                        value={selectedComponent.packageType}
                        onChange={(e) =>
                          updateSelectedComponentField(selectedComponent.refDes, { packageType: e.target.value })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-slate-100 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 block text-[9px] font-mono uppercase">Operating Range</label>
                      <input
                        type="text"
                        value={selectedComponent.operatingVoltageRange || ''}
                        onChange={(e) =>
                          updateSelectedComponentField(selectedComponent.refDes, {
                            operatingVoltageRange: e.target.value,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-cyan-300 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                    <div>
                      <label className="text-slate-500 block text-[9px] font-mono uppercase">Decoded Value</label>
                      <input
                        type="text"
                        value={selectedComponent.decodedValue}
                        onChange={(e) =>
                          updateSelectedComponentField(selectedComponent.refDes, {
                            decodedValue: e.target.value,
                          })
                        }
                        className="w-full bg-slate-950 border border-slate-800 rounded px-1.5 py-0.5 text-amber-300 font-mono text-[11px] focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  </div>

                  {/* Ecosystem Action Buttons: Google Grounding & Offline Bot */}
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      onClick={() =>
                        onOpenGroundedSearch?.(
                          `${selectedComponent.marking || selectedComponent.decodedValue} ${selectedComponent.category} automotive ECU datasheet pinout`,
                          '',
                          selectedComponent.marking || selectedComponent.refDes
                        )
                      }
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-500/50 text-cyan-200 font-semibold text-[11px] transition"
                    >
                      <Globe className="w-3.5 h-3.5 text-cyan-400" />
                      <span>Lookup IC / TSB</span>
                    </button>
                    <button
                      onClick={() =>
                        onOpenOfflineBot?.(
                          `Analyze ECU PCB component ${selectedComponent.refDes} (${selectedComponent.marking || selectedComponent.decodedValue}, ${selectedComponent.category}). Function: ${selectedComponent.circuitFunction}. What failure modes and multimeter checks apply?`
                        )
                      }
                      className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-lg bg-amber-950/80 hover:bg-amber-900 border border-amber-500/50 text-amber-200 font-semibold text-[11px] transition"
                    >
                      <Bot className="w-3.5 h-3.5 text-amber-400" />
                      <span>Ask Offline Bot</span>
                    </button>
                  </div>

                  {selectedComponent.datasheetSummary && (
                    <div className="text-[10.5px] text-slate-300 bg-slate-900/80 p-2 rounded-lg border border-slate-800 font-sans leading-relaxed">
                      <span className="text-[9px] text-cyan-400 uppercase font-mono font-bold block mb-0.5">
                        OEM Datasheet & Hardware Notes:
                      </span>
                      {selectedComponent.datasheetSummary}
                      {selectedComponent.notes && (
                        <p className="mt-1 text-[10px] text-slate-400 border-t border-slate-800 pt-1">
                          {selectedComponent.notes}
                        </p>
                      )}
                    </div>
                  )}

                  {/* Editable Pinout, Nominal Voltage & Live MNA Voltage Table */}
                  <div className="flex flex-col gap-1.5 pt-1">
                    <div className="flex items-center justify-between">
                      <span className="font-bold text-slate-300 text-[10px] uppercase tracking-wider">
                        PINOUT & LIVE MNA TELEMETRY ({selectedComponent.pinSpecs?.length || 0} PINS)
                      </span>
                      <button
                        onClick={() => handleAddPinToComponent(selectedComponent.refDes)}
                        className="text-[9.5px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700 flex items-center gap-0.5"
                      >
                        <Plus className="w-2.5 h-2.5" /> Add Pin
                      </button>
                    </div>

                    {selectedComponent.pinSpecs && selectedComponent.pinSpecs.length > 0 && (
                      <div className="border border-slate-800 rounded-lg overflow-hidden text-[10px]">
                        <table className="w-full text-left border-collapse">
                          <thead className="bg-slate-900 text-slate-400 font-mono text-[9px] uppercase border-b border-slate-800">
                            <tr>
                              <th className="p-1.5">Pin</th>
                              <th className="p-1.5">Signal</th>
                              <th className="p-1.5" title="Editable Nominal Spec Voltage">Spec V</th>
                              <th className="p-1.5" title="Live Simulated MNA Node Voltage">Live V</th>
                              <th className="p-1.5">Connected Net ID</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 font-mono">
                            {selectedComponent.pinSpecs.map((pin) => {
                              const isPinSelected =
                                selectedPinNumber === pin.pinNumber &&
                                selectedCompRef === selectedComponent.refDes;
                              const liveVolts = resolveLiveNetVoltage(
                                pin.connectedNetId,
                                pin.nominalVoltage
                              );
                              return (
                                <tr
                                  key={pin.pinNumber}
                                  onClick={() => {
                                    setSelectedPinNumber(pin.pinNumber);
                                    setActiveNetId(pin.connectedNetId);
                                  }}
                                  className={`cursor-pointer transition ${
                                    isPinSelected
                                      ? 'bg-cyan-950/90 text-cyan-200'
                                      : 'hover:bg-slate-900/60 text-slate-300'
                                  }`}
                                >
                                  <td className="p-1 font-bold text-cyan-400">#{pin.pinNumber}</td>
                                  <td className="p-1">
                                    <input
                                      type="text"
                                      value={pin.pinName}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) =>
                                        handleUpdatePinNet(
                                          selectedComponent.refDes,
                                          pin.pinNumber,
                                          pin.connectedNetId,
                                          e.target.value
                                        )
                                      }
                                      className="w-16 bg-transparent border-b border-slate-800 focus:border-cyan-500 text-slate-200 focus:outline-none"
                                    />
                                  </td>
                                  <td className="p-1">
                                    <input
                                      type="number"
                                      step="0.1"
                                      value={pin.nominalVoltage}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) =>
                                        handleUpdatePinNet(
                                          selectedComponent.refDes,
                                          pin.pinNumber,
                                          pin.connectedNetId,
                                          undefined,
                                          parseFloat(e.target.value)
                                        )
                                      }
                                      className="w-12 bg-slate-900/80 border border-slate-800 rounded px-1 py-0.5 text-slate-300 tabular-nums focus:outline-none focus:border-cyan-500"
                                    />
                                  </td>
                                  <td className="p-1 font-bold text-amber-300 tabular-nums">
                                    {liveVolts.toFixed(2)}V
                                  </td>
                                  <td className="p-1">
                                    <input
                                      type="text"
                                      value={pin.connectedNetId}
                                      onClick={(e) => e.stopPropagation()}
                                      onChange={(e) =>
                                        handleUpdatePinNet(
                                          selectedComponent.refDes,
                                          pin.pinNumber,
                                          e.target.value
                                        )
                                      }
                                      className="w-full bg-slate-900/90 border border-slate-800 rounded px-1 py-0.5 text-cyan-300 focus:outline-none focus:border-cyan-500"
                                    />
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}

                    {/* Selected Pin Detailed Note & Quick Probe Action */}
                    {selectedPinNumber && (
                      <div className="text-[10px] text-slate-300 bg-slate-900/70 px-2.5 py-1.5 rounded border border-slate-800 font-sans flex items-start justify-between gap-2">
                        <div>
                          <strong className="text-cyan-400 font-mono">
                            Pin #{selectedPinNumber} Function:{' '}
                          </strong>
                          {selectedComponent.pinSpecs?.find((p) => p.pinNumber === selectedPinNumber)
                            ?.notes || 'Standard terminal connection.'}
                        </div>
                        <button
                          type="button"
                          onClick={() => {
                            const idx =
                              selectedComponent.pinSpecs?.findIndex(
                                (p) => p.pinNumber === selectedPinNumber
                              ) ?? -1;
                            const pinObj = idx >= 0 ? selectedComponent.pinSpecs?.[idx] : undefined;
                            if (!pinObj) return;
                            const pt = computeComponentPinCoords(
                              selectedComponent,
                              idx,
                              selectedComponent.pinSpecs?.length || 1
                            );
                            handlePlaceProbe({
                              label: `${selectedComponent.refDes} #${pinObj.pinNumber} (${pinObj.pinName})`,
                              compRefDes: selectedComponent.refDes,
                              pinNumber: pinObj.pinNumber,
                              pinName: pinObj.pinName,
                              netId: pinObj.connectedNetId,
                              nominalVoltage: pinObj.nominalVoltage,
                              xNorm: pt.x,
                              yNorm: pt.y,
                            });
                          }}
                          className="shrink-0 px-2 py-1 rounded bg-sky-950 hover:bg-sky-900 border border-sky-500/50 text-sky-200 font-mono text-[9.5px] font-bold flex items-center gap-1"
                          title="Anchor next Dual Probe (A or B) on this Pin"
                        >
                          <Crosshair className="w-3 h-3" />
                          <span>Probe Pin</span>
                        </button>
                      </div>
                    )}

                    {/* Quick Link Component to New or Existing Net */}
                    <div className="flex items-center gap-1.5 pt-1">
                      <input
                        type="text"
                        placeholder="New net e.g. NET_5V_REF"
                        value={newNetName}
                        onChange={(e) => setNewNetName(e.target.value)}
                        className="flex-1 bg-slate-900 border border-slate-800 rounded px-2 py-1 text-[10px] text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                      <button
                        onClick={handleCreateAndLinkNet}
                        className="flex items-center gap-1 px-2.5 py-1 rounded bg-cyan-800 hover:bg-cyan-700 text-white text-[10px] font-semibold"
                      >
                        <Link2 className="w-3 h-3" />
                        <span>Link Pin #{selectedPinNumber || 1}</span>
                      </button>
                    </div>
                  </div>

                  {/* Technician Sign-Off Button */}
                  <button
                    onClick={() => verifyComponent(selectedComponent.refDes)}
                    className={`mt-1 py-1.5 px-3 rounded-lg font-bold text-xs flex items-center justify-center gap-2 transition ${
                      selectedComponent.verificationStatus === 'VERIFIED'
                        ? 'bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700'
                        : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-md'
                    }`}
                  >
                    <CheckCircle className="w-4 h-4" />
                    <span>
                      {selectedComponent.verificationStatus === 'VERIFIED'
                        ? 'Revoke Sign-off'
                        : 'Technician Sign-Off & Verify'}
                    </span>
                  </button>
                </div>
              ) : (
                <div className="p-4 bg-slate-950 border border-slate-800 rounded-xl text-slate-400 text-center text-xs font-sans">
                  Click any component box on the PCB canvas to inspect and edit its datasheet and pinout.
                </div>
              )}
            </>
          )}

          {/* SUB-TAB 2: COPPER TRACE NETS & ORTHOGONAL ROUTER */}
          {inspectorSubTab === 'NETS' && (
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <span className="text-[10.5px] font-bold text-cyan-300 uppercase">
                  Copper Trace Net Registry ({nets.length})
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={handleAddWaypointToActiveNet}
                    disabled={!effectiveNetId}
                    className="text-[10px] px-2 py-0.5 rounded bg-emerald-900/80 hover:bg-emerald-800 text-emerald-200 border border-emerald-600/50 disabled:opacity-40"
                  >
                    + Add Vertex
                  </button>
                  <button
                    type="button"
                    onClick={handleDeleteLastVertexFromActiveNet}
                    disabled={!effectiveNetId}
                    className="text-[10px] px-2 py-0.5 rounded bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-200 border border-slate-700 disabled:opacity-40"
                    title="Remove last waypoint vertex from active net"
                  >
                    − Del Vertex
                  </button>
                </div>
              </div>
              <p className="text-[10px] text-slate-400 font-sans">
                Click any net to highlight its connected pins and copper paths. Use &ldquo;Edit Traces&rdquo; in the canvas toolbar to drag individual trace vertices.
              </p>
              <div className="flex flex-col gap-1.5 max-h-64 overflow-y-auto pr-1">
                {nets.map((net) => {
                  const isSelected = effectiveNetId === net.name;
                  const color = getNetColor(net.name);
                  const liveV = resolveLiveNetVoltage(net.name, net.nominalVoltage ?? 5.0);
                  return (
                    <div
                      key={net.name}
                      onClick={() => setActiveNetId(net.name)}
                      className={`p-2 rounded-lg border flex flex-col gap-1 cursor-pointer transition text-[11px] ${
                        isSelected
                          ? 'bg-cyan-950/80 border-cyan-400 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2 truncate min-w-0 font-bold">
                          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                          <span className="truncate">{net.name}</span>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="text-[10px] text-amber-300 font-bold tabular-nums">
                            {liveV.toFixed(2)}V
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleAutoRouteNet(net.name);
                            }}
                            className="text-[9px] px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-cyan-300 border border-slate-700"
                            title="Rebuild orthogonal Manhattan copper trace across linked components"
                          >
                            Orthogonal Route
                          </button>
                        </div>
                      </div>
                      <div className="text-[9.5px] text-slate-400 flex items-center justify-between">
                        <span>Nodes: {net.connectedComponentRefs.join(', ') || 'None'}</span>
                        <span>{net.signalType}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* SUB-TAB 3: DUAL-PROBE BENCH METER (CONTINUITY / DIODE / ΔV) */}
          {inspectorSubTab === 'PROBE' && (
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-bold text-sky-300 uppercase flex items-center gap-1.5">
                  <Crosshair className="w-3.5 h-3.5 text-sky-400" />
                  Dual-Probe MNA & Continuity Meter
                </span>
                <button
                  type="button"
                  onClick={() => setInteractionMode('PROBE')}
                  className={`text-[9.5px] px-2 py-0.5 rounded font-bold border transition ${
                    interactionMode === 'PROBE'
                      ? 'bg-sky-600 border-sky-400 text-white'
                      : 'bg-slate-800 border-slate-700 text-sky-300 hover:border-sky-500'
                  }`}
                >
                  {interactionMode === 'PROBE' ? 'Probing Active' : 'Activate Probe Tool'}
                </button>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div className="p-2 rounded-lg bg-slate-900 border border-rose-500/40 flex flex-col gap-0.5">
                  <span className="text-[9px] text-rose-300 font-bold uppercase">
                    Probe A (Red +) {nextProbeSlot === 'A' ? '· NEXT' : ''}
                  </span>
                  <span className="text-[11px] font-bold text-white truncate">
                    {probeA ? probeA.label : 'Unplaced'}
                  </span>
                  <span className="text-[10px] text-amber-300 tabular-nums font-bold">
                    {probeA
                      ? `${resolveLiveNetVoltage(probeA.netId, probeA.nominalVoltage).toFixed(3)} V DC`
                      : '—'}
                  </span>
                  <span className="text-[9px] text-slate-400 truncate">
                    {probeA ? probeA.netId : 'Click any node on board'}
                  </span>
                </div>

                <div className="p-2 rounded-lg bg-slate-900 border border-sky-500/40 flex flex-col gap-0.5">
                  <span className="text-[9px] text-sky-300 font-bold uppercase">
                    Probe B (Black −) {nextProbeSlot === 'B' ? '· NEXT' : ''}
                  </span>
                  <span className="text-[11px] font-bold text-white truncate">
                    {probeB ? probeB.label : 'Unplaced'}
                  </span>
                  <span className="text-[10px] text-amber-300 tabular-nums font-bold">
                    {probeB
                      ? `${resolveLiveNetVoltage(probeB.netId, probeB.nominalVoltage).toFixed(3)} V DC`
                      : '—'}
                  </span>
                  <span className="text-[9px] text-slate-400 truncate">
                    {probeB ? probeB.netId : 'Click second node'}
                  </span>
                </div>
              </div>

              {dualProbeMeasurement ? (
                <div className="p-2.5 rounded-lg bg-slate-900/95 border border-cyan-500/40 flex flex-col gap-2">
                  <div className="flex items-center justify-between gap-2">
                    <div>
                      <span className="text-[9px] text-slate-400 uppercase block font-sans">
                        Differential Potential ΔV (A − B)
                      </span>
                      <span className="text-base font-extrabold text-amber-300 tabular-nums">
                        {dualProbeMeasurement.differentialVoltage >= 0 ? '+' : ''}
                        {dualProbeMeasurement.differentialVoltage.toFixed(3)} V DC
                      </span>
                    </div>
                    <span
                      className={`text-[9px] px-2 py-0.5 rounded font-bold border uppercase ${
                        dualProbeMeasurement.continuityStatus === 'SHORT_FAULT'
                          ? 'bg-rose-950 border-rose-500 text-rose-200'
                          : dualProbeMeasurement.continuityStatus === 'CONTINUOUS'
                          ? 'bg-emerald-950 border-emerald-500 text-emerald-200'
                          : dualProbeMeasurement.continuityStatus === 'DIODE_JUNCTION' ||
                            dualProbeMeasurement.continuityStatus === 'RESISTIVE'
                          ? 'bg-amber-950 border-amber-500 text-amber-200'
                          : 'bg-slate-800 border-slate-600 text-slate-300'
                      }`}
                    >
                      {dualProbeMeasurement.continuityStatus.replace('_', ' ')}
                    </span>
                  </div>

                  <div className="px-2 py-1.5 rounded bg-slate-950 border border-slate-800 text-[11px] font-bold text-cyan-200 tabular-nums">
                    {dualProbeMeasurement.continuityLabel}
                  </div>

                  {dualProbeMeasurement.activeFaultNote && (
                    <div className="px-2 py-1.5 rounded bg-rose-950/70 border border-rose-500/60 text-[10px] text-rose-200 font-sans">
                      <strong>Fault Correlation:</strong> {dualProbeMeasurement.activeFaultNote}
                    </div>
                  )}

                  <p className="text-[10px] text-slate-300 font-sans leading-relaxed">
                    {dualProbeMeasurement.guidance}
                  </p>
                </div>
              ) : (
                <div className="p-3 rounded-lg bg-slate-900 border border-slate-800 text-[10.5px] text-slate-400 font-sans text-center">
                  Place both <strong>Probe A (+)</strong> and <strong>Probe B (−)</strong> on any pins or trace nodes to measure MNA ΔV, copper continuity, diode Vf, or CAN differential termination.
                </div>
              )}

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={!probeA || !probeB}
                  onClick={() => {
                    if (!probeA || !probeB) return;
                    setProbeA(probeB);
                    setProbeB(probeA);
                    setStatusMessage('Swapped Probe A (+) ↔ Probe B (−) polarity.');
                  }}
                  className="flex-1 py-1.5 px-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-[10px] font-semibold flex items-center justify-center gap-1"
                >
                  <ArrowLeftRight className="w-3 h-3" />
                  <span>Swap A ↔ B</span>
                </button>
                <button
                  type="button"
                  disabled={!probeA && !probeB}
                  onClick={() => {
                    setProbeA(null);
                    setProbeB(null);
                    setNextProbeSlot('A');
                    setStatusMessage('Cleared Dual Probes A & B.');
                  }}
                  className="py-1.5 px-3 rounded-lg bg-slate-800 hover:bg-rose-950 disabled:opacity-40 text-slate-300 hover:text-rose-200 border border-slate-700 text-[10px] font-semibold"
                >
                  Clear
                </button>
              </div>
            </div>
          )}

          {/* SUB-TAB 4: AUTOMATED MNA/ERC AUDIT & PHYSICAL HOTSPOTS */}
          {inspectorSubTab === 'AUDIT' && (
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex flex-col gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10.5px] text-cyan-300 uppercase tracking-wider font-bold flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5 text-cyan-400" />
                    Automated ERC / MNA Audit ({boardAuditFindings.length})
                  </span>
                  {criticalAuditCount > 0 && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-rose-950 border border-rose-500 text-rose-200 font-bold">
                      {criticalAuditCount} CRITICAL
                    </span>
                  )}
                </div>

                {boardAuditFindings.length === 0 ? (
                  <div className="text-[10.5px] text-emerald-300 font-sans px-2.5 py-2.5 bg-emerald-950/30 rounded-lg border border-emerald-700/50 text-center">
                    All MNA voltage rails, thermal junctions, and netlist checks are nominal.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {boardAuditFindings.map((finding) => (
                      <div
                        key={finding.id}
                        onClick={() => {
                          if (finding.targetCompRef) setSelectedCompRef(finding.targetCompRef);
                          if (finding.targetNetId) setActiveNetId(finding.targetNetId);
                          if (finding.targetHotspotId) setSelectedHotspotId(finding.targetHotspotId);
                          if (finding.category === 'THERMAL') setShowThermalHeatmap(true);
                          setStatusMessage(`AUDIT FOCUS: ${finding.title}`);
                        }}
                        className={`p-2 rounded-lg border cursor-pointer transition text-[10.5px] ${
                          finding.severity === 'CRITICAL'
                            ? 'bg-rose-950/50 border-rose-500/60 hover:border-rose-400 text-slate-100'
                            : finding.severity === 'WARNING'
                            ? 'bg-amber-950/40 border-amber-500/50 hover:border-amber-400 text-slate-200'
                            : 'bg-slate-900 border-slate-800 hover:border-cyan-500/50 text-slate-300'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-bold">
                          <span className="truncate">{finding.title}</span>
                          <span
                            className={`text-[8.5px] px-1.5 py-0.5 rounded shrink-0 ${
                              finding.severity === 'CRITICAL'
                                ? 'bg-rose-900 text-rose-100'
                                : finding.severity === 'WARNING'
                                ? 'bg-amber-900 text-amber-100'
                                : 'bg-cyan-950 text-cyan-200'
                            }`}
                          >
                            {finding.severity}
                          </span>
                        </div>
                        <p className="text-[9.5px] text-slate-300 font-sans mt-1 leading-snug">
                          {finding.detail}
                        </p>
                        <p className="text-[9px] text-cyan-300/90 font-sans mt-1">
                          Action: {finding.recommendation}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="pt-2 border-t border-slate-800 flex flex-col gap-2">
                <div className="flex items-center justify-between gap-1 flex-wrap">
                  <span className="text-[10.5px] text-rose-300 uppercase tracking-wider font-bold flex items-center gap-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 text-rose-400" />
                    Physical Hotspots ({hotspots.length})
                  </span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleAddManualHotspot('WARNING')}
                      className="text-[9.5px] px-1.5 py-0.5 rounded bg-amber-950/80 hover:bg-amber-900 text-amber-200 border border-amber-600/50"
                      title="Flag Warning Inspection Zone on Selected Component"
                    >
                      + Warning
                    </button>
                    <button
                      type="button"
                      onClick={() => handleAddManualHotspot('CRITICAL')}
                      className="text-[9.5px] px-1.5 py-0.5 rounded bg-rose-950/80 hover:bg-rose-900 text-rose-200 border border-rose-600/50"
                      title="Flag Critical Fault Zone on Selected Component"
                    >
                      + Critical
                    </button>
                  </div>
                </div>

                {hotspots.length === 0 ? (
                  <div className="text-[10.5px] text-slate-500 font-sans px-2 py-2.5 bg-slate-900 rounded-lg border border-slate-800 text-center">
                    No physical hotspots flagged on this board.
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-48 overflow-y-auto pr-1">
                    {hotspots.map((h) => (
                      <div
                        key={h.id}
                        onClick={() => {
                          setSelectedHotspotId(h.id);
                          setShowHotspots(true);
                          if (h.suspectComponentRef) setSelectedCompRef(h.suspectComponentRef);
                        }}
                        className={`p-2 rounded-lg border cursor-pointer transition text-[10.5px] ${
                          selectedHotspotId === h.id
                            ? 'bg-rose-950/60 border-rose-400 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2 font-bold">
                          <span className="truncate">{h.label}</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <span
                              className={`text-[8.5px] px-1.5 py-0.5 rounded ${
                                h.severity === 'CRITICAL'
                                  ? 'bg-rose-900 text-rose-200'
                                  : h.severity === 'WARNING'
                                  ? 'bg-amber-900 text-amber-200'
                                  : 'bg-cyan-900 text-cyan-200'
                              }`}
                            >
                              {h.severity}
                            </span>
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteHotspot(h.id);
                              }}
                              className="p-0.5 text-slate-500 hover:text-rose-300"
                              title="Remove Hotspot Flag"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                        <p className="text-[9.5px] text-slate-300 font-sans mt-1 leading-relaxed">{h.notes}</p>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* SUB-TAB 5: ELECTRO-THERMAL IR SIMULATOR TELEMETRY */}
          {inspectorSubTab === 'THERMAL' && (
            <div className="bg-slate-950 border border-slate-800 p-3 rounded-xl flex flex-col gap-2.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[10.5px] font-bold text-amber-300 uppercase flex items-center gap-1.5">
                  <Thermometer className="w-3.5 h-3.5 text-rose-400" />
                  Electro-Thermal (Peak {peakBoardTempC.toFixed(1)}°C)
                </span>
                <button
                  type="button"
                  onClick={() => setShowThermalHeatmap((v) => !v)}
                  className={`text-[9.5px] px-2 py-0.5 rounded font-bold border transition ${
                    showThermalHeatmap
                      ? 'bg-rose-950 border-rose-500 text-rose-200'
                      : 'bg-slate-800 border-slate-700 text-slate-300'
                  }`}
                >
                  {showThermalHeatmap ? 'IR Overlay: ON' : 'IR Overlay: OFF'}
                </button>
              </div>
              <p className="text-[10px] text-slate-400 font-sans leading-relaxed">
                Computes real steady-state junction temperature (<code className="text-cyan-300">TJ = TA + PD × RθJA</code>) from bench supply voltage, load current, and active fault injections.
              </p>
              <div className="flex flex-col gap-1.5 max-h-60 overflow-y-auto pr-1">
                {components.map((comp) => {
                  const th = componentThermalMap[comp.refDes];
                  if (!th) return null;
                  return (
                    <div
                      key={`therm-row-${comp.refDes}`}
                      onClick={() => {
                        setSelectedCompRef(comp.refDes);
                        setShowThermalHeatmap(true);
                      }}
                      className="p-2 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 cursor-pointer flex flex-col gap-1"
                    >
                      <div className="flex items-center justify-between gap-1.5">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <span className="font-bold text-cyan-300 truncate">
                            {comp.refDes} <span className="text-slate-400 font-normal">({comp.marking})</span>
                          </span>
                          {th.faultLinked && (
                            <span className="text-[8px] px-1 py-0.5 rounded bg-rose-950 border border-rose-500/70 text-rose-200 font-bold shrink-0">
                              FAULT
                            </span>
                          )}
                        </div>
                        <span
                          className={`text-[10px] font-bold px-1.5 py-0.5 rounded tabular-nums shrink-0 ${
                            th.tempC >= 110
                              ? 'bg-rose-950 text-rose-300 border border-rose-600'
                              : th.tempC >= 80
                              ? 'bg-amber-950 text-amber-300 border border-amber-600'
                              : 'bg-sky-950 text-sky-300 border border-sky-700'
                          }`}
                        >
                          {th.tempC.toFixed(1)}°C · {th.powerDissipationMw} mW
                        </span>
                      </div>
                      <div className="text-[9.5px] text-slate-400 font-sans">
                        {th.dominantHeatSource}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Always-Visible Component Search & Registry List */}
          <div className="flex flex-col gap-2 pt-2 border-t border-slate-800">
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-slate-400 uppercase tracking-wider font-bold">
                PART REGISTRY ({filteredComponents.length}):
              </span>
              <div className="flex items-center gap-1 text-[9px]">
                <button
                  onClick={() => setFilterMode('ALL')}
                  className={`px-1.5 py-0.5 rounded ${
                    filterMode === 'ALL' ? 'bg-slate-800 text-cyan-300 font-bold' : 'text-slate-500'
                  }`}
                >
                  All
                </button>
                <button
                  onClick={() => setFilterMode('VERIFIED')}
                  className={`px-1.5 py-0.5 rounded ${
                    filterMode === 'VERIFIED' ? 'bg-emerald-950 text-emerald-300 font-bold' : 'text-slate-500'
                  }`}
                >
                  Verified
                </button>
                <button
                  onClick={() => setFilterMode('UNVERIFIED')}
                  className={`px-1.5 py-0.5 rounded ${
                    filterMode === 'UNVERIFIED' ? 'bg-amber-950 text-amber-300 font-bold' : 'text-slate-500'
                  }`}
                >
                  Unverified
                </button>
              </div>
            </div>

            <div className="relative">
              <Search className="w-3.5 h-3.5 absolute left-2.5 top-2 text-slate-400" />
              <input
                type="text"
                placeholder="Search RefDes, IC, marking..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-2.5 py-1 text-xs text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="flex flex-col gap-1 max-h-44 overflow-y-auto pr-1">
              {filteredComponents.map((comp) => (
                <div
                  key={comp.refDes}
                  onClick={() => {
                    setSelectedCompRef(comp.refDes);
                    setInspectorSubTab('PART');
                    if (comp.pinSpecs?.[0]?.connectedNetId) {
                      setActiveNetId(comp.pinSpecs[0].connectedNetId);
                    }
                  }}
                  className={`p-2 rounded-lg border flex items-center justify-between cursor-pointer transition text-[11px] ${
                    selectedCompRef === comp.refDes
                      ? 'bg-slate-800 border-cyan-400 text-white font-bold'
                      : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                  }`}
                >
                  <div className="flex items-center gap-2 truncate">
                    <span className="font-bold text-cyan-400 font-mono">{comp.refDes}</span>
                    <span className="text-slate-400 text-[10px] truncate max-w-[140px]">
                      {comp.marking || comp.category}
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {showThermalHeatmap && componentThermalMap[comp.refDes] && (
                      <span className="text-[9px] text-rose-300 font-mono">
                        {Math.round(componentThermalMap[comp.refDes].tempC)}°C
                      </span>
                    )}
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-semibold ${
                        comp.verificationStatus === 'VERIFIED'
                          ? 'bg-emerald-950 text-emerald-400 border border-emerald-800'
                          : 'bg-amber-950 text-amber-400 border border-amber-800'
                      }`}
                    >
                      {comp.verificationStatus === 'VERIFIED'
                        ? 'VERIFIED'
                        : comp.source === 'LOCAL_CV'
                        ? 'CV'
                        : 'AI'}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
};
