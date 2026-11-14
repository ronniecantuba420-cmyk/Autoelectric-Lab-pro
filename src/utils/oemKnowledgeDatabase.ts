/**
 * Canonical OEM Vehicle, ECU Verification Gating, Boot-Mode, & Table 16 DLC Database.
 *
 * Single source of truth consumed by:
 * - `vehicleEcuRegistry.ts` (Bench Test Car/Model/ECU selector & gating alerts)
 * - `offlineChatbotEngine.ts` (MiniSearch RAG index & anti-fabrication guardrails)
 * - `voiceCommandParser.ts` & `FloatingLabNavigator.tsx` (hands-free voice pinout/DLC/OCR_VERIFY guidance)
 *
 * Ingestion Rules Enforced:
 * 1. VERIFIED — Verified bench power-up, pinouts, boot-mode protocols, and Table 16 DLC maps.
 * 2. OCR_VERIFY — Mandatory physical ECU part number & harness continuity verification prompts prior to energizing/probing.
 * 3. PART_METADATA_ONLY / MECHANICAL_NO_ECU — Strictly metadata, controller identifiers, DLC protocols,
 *    or mechanical-injection notices ONLY. Zero fabricated ECU pin numbers.
 * 4. BENCH_TEST_SCENARIOS — Verified OEM bench fault simulation scenarios mapped to DTCs & lab behavior.
 */

import { FaultType } from '../types/ecu';

export type EcuIngestionStatus =
  | 'VERIFIED'
  | 'OCR_VERIFY'
  | 'PART_METADATA_ONLY'
  | 'MECHANICAL_NO_ECU';

export interface VerifiedVoiceEcuGuide {
  id: string;
  brandKey: string;
  brandLabel: string;
  ecuName: string;
  status: 'VERIFIED' | 'OCR_VERIFY';
  linkedProfileId: string | null;
  models: string[];
  tableRef: string;
  keyBenchPins: string;
  bootOrPowerRule: string;
  ocrVerifyGate?: string;
  dlcProtocol: string;
  voicePrompt: string;
}

export interface RestrictedModelEntry {
  id: string;
  brandKey: string;
  brandLabel: string;
  modelName: string;
  status: 'PART_METADATA_ONLY' | 'MECHANICAL_NO_ECU';
  oemControllerNote: string;
  dlcProtocol: string;
  restrictionReason: string;
}

export interface DlcInterfaceEntry {
  id: string;
  brandKey: string;
  brandLabel: string;
  connectorTypes: string;
  obd2Pins: string;
  legacyDlcPins: string;
  protocolNotes: string;
  voiceSummary: string;
}

export interface OcrVerifyRule {
  id: string;
  matchTerms: string[];
  title: string;
  prompt: string;
  spokenAlert: string;
}

export interface BenchTestScenarioEntry {
  id: string;
  scenarioNumber: number;
  brandKey: string;
  brandLabel: string;
  market: string;
  targetModuleAndModels: string;
  dtcCode: string;
  faultDescription: string;
  benchSimulationSetup: string;
  expectedEcuBehavior: string;
  recommendedPinId: string;
  recommendedFaultType: FaultType;
  faultPresetLabel: string;
}

/**
 * Rule 1: Voice-Ready Verified & OCR_VERIFY ECU Bench & Boot Guides
 * (Complements `ECU_BRAND_PROFILES` without duplicating pin arrays).
 */
export const VERIFIED_VOICE_ECU_GUIDES: VerifiedVoiceEcuGuide[] = [
  {
    id: 'guide-toyota-1krfe',
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    ecuName: '1KR-FE ECM (3 Hardware Revisions)',
    status: 'OCR_VERIFY',
    linkedProfileId: 'toyota-denso-175822',
    models: ['Wigo (1KR-FE)'],
    tableRef: 'Tables 3A–3B',
    keyBenchPins: 'Verify exact revision table (Rev 1 / Rev 2 / Rev 3) prior to applying +BATT, IGSW, E1, CANH/CANL.',
    bootOrPowerRule: '3 distinct 1KR-FE ECM pin configurations exist across model years; check OEM PCB/case sticker before wiring bench harness.',
    ocrVerifyGate: 'OCR_VERIFY REQUIRED: Select among the 3 Toyota 1KR-FE ECU revisions by verifying physical ECU part number & harness continuity before energizing.',
    dlcProtocol: 'OBD-II Pin 6/14 ISO 15765-4 CAN (500 kbps) · Pin 7 legacy SIL check',
    voicePrompt: 'Toyota 1KR-FE alert: verify physical ECU part number and select among the three 1KR-FE revisions before energizing.',
  },
  {
    id: 'guide-toyota-1nr-2nr',
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    ecuName: 'Denso 1NR-FE / 2NR-FE Dual VVT-i ECM',
    status: 'VERIFIED',
    linkedProfileId: 'toyota-denso-175822',
    models: ['Vios (1NR-FE / 2NR-FE)', 'Avanza (1NR-VE / 2NR-VE)', 'Yaris (1NR-FE)'],
    tableRef: 'Section 2 & Toyota Bench Rules',
    keyBenchPins: 'KL30 BATT (+12V constant), IGSW (+12V key-ON), MREL -> +B relay feed, E1/E01/E02 Ground, CANH/CANL (60Ω terminated).',
    bootOrPowerRule: 'Energize BATT and IGSW; confirm MREL pulls EFI Main Relay coil low so +B/+B2 rails reach 12.6V.',
    dlcProtocol: 'SAE J1962 OBD-II CAN (Pins 6 & 14) + Pin 13 (TC test jump)',
    voicePrompt: 'Toyota 1NR-FE and 2NR-FE bench wakeup: supply constant 12V to BATT, switched 12V to IGSW, bond E1 grounds, and verify 60 Ohm CAN termination.',
  },
  {
    id: 'guide-toyota-1nzfe',
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    ecuName: 'Denso 1NZ-FE ECM (Vios / Yaris 60P+60P)',
    status: 'VERIFIED',
    linkedProfileId: 'toyota-denso-175822',
    models: ['Vios (1NZ-FE)', 'Yaris (1NZ-FE)', 'Altis'],
    tableRef: 'Tables 10A–10B',
    keyBenchPins: 'Verified cavities: A50, B31, E3, E5, A21, C20 (BATT / +B / IGSW / MREL / Ground / SIL-CAN wakeup verification).',
    bootOrPowerRule: 'Verify A50/B31/E3/E5/A21/C20 cavity positions per Table 10A-10B; supply fused +12V BATT & IGSW, bond engine ground, read SIL OBD2 Pin 7 or CAN 6/14.',
    dlcProtocol: 'Toyota OBD-II Pin 7 (SIL / ISO-9141) on early Gen-1 or Pins 6/14 CAN on later 1NZ-FE',
    voicePrompt: 'Toyota 1NZ-FE verified pins include A50, B31, E3, E5, A21, and C20 per Tables 10A and 10B. Check fuse protection before applying 12 volts.',
  },
  {
    id: 'guide-toyota-1kd-2kd',
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    ecuName: 'Denso 175822 / 275036 (1KD-FTV / 2KD-FTV Common Rail)',
    status: 'VERIFIED',
    linkedProfileId: 'toyota-denso-175822',
    models: ['Hilux (1KD/2KD-FTV)', 'Fortuner (1KD/2KD-FTV)', 'Innova (1KD/2KD-FTV)', 'Hiace (1KD/2KD-FTV Only)'],
    tableRef: 'Gen-1 to Gen-4 Multi-Plug Pinout',
    keyBenchPins: 'E1 (A1) GND, BATT (B2) +12V, IGSW (A9) +12V, MREL (A8), +B (D1/D2), SIL (B23) / CANH-L (C20/C21).',
    bootOrPowerRule: 'Confirm external EDU trigger line #10/#20/#30/#40 polarity and inspect CPU #2 crystal resonator if MIL flashes rapidly with false P0093.',
    dlcProtocol: 'ISO-9141 SIL (OBD2 Pin 7) on Gen-1/2 or CAN 6/14 on Gen-3/4',
    voicePrompt: 'Toyota 1KD and 2KD Denso bench hookup: E1 A1 ground, BATT B2 constant 12V, IGSW A9 ignition, MREL A8 relay, and SIL B23 or CAN C20 C21.',
  },
  {
    id: 'guide-toyota-1gdftv',
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    ecuName: 'Toyota 1GD-FTV ECM (i-ART vs. Non-i-ART)',
    status: 'OCR_VERIFY',
    linkedProfileId: 'toyota-denso-175822',
    models: ['Hilux (1GD-FTV)', 'Fortuner (1GD-FTV)', 'Innova (1GD-FTV)'],
    tableRef: '1GD-FTV Bench & Injector Driver Guide',
    keyBenchPins: 'Verify i-ART closed-loop smart injector pressure sensor wiring vs. non-i-ART EDU-driven solenoid injectors before powering driver stage.',
    bootOrPowerRule: 'i-ART injectors carry embedded 5V pressure/temperature EEPROM sensors directly to ECM; non-i-ART variants differ in injector coil return.',
    ocrVerifyGate: 'OCR_VERIFY REQUIRED: Confirm i-ART vs. non-i-ART on the physical Toyota 1GD-FTV ECU part number before energizing injector channels.',
    dlcProtocol: 'High-Speed CAN ISO 15765-4 (OBD-II Pins 6 & 14)',
    voicePrompt: 'Toyota 1GD-FTV alert: verify ECU part number to confirm i-ART versus non-i-ART injector driver architecture before energizing.',
  },
  {
    id: 'guide-honda-r18a2-fn2',
    brandKey: 'honda',
    brandLabel: 'Honda',
    ecuName: 'Honda Keihin R18A2 / FN2 (Connectors A / B / C)',
    status: 'OCR_VERIFY',
    linkedProfileId: 'honda-keihin-pgmfi',
    models: ['Civic (R18A2 / FN2)'],
    tableRef: 'Tables 11A–11B',
    keyBenchPins: 'Connectors A/B/C; mandatory verification required prior to probing Pin A16 and Pins B37–B39 / C37.',
    bootOrPowerRule: 'Verify exact Keihin/Honda R18A2 vs FN2 Type-R harness revision on case label before energizing power/sensor buses.',
    ocrVerifyGate: 'OCR_VERIFY REQUIRED: Verify physical ECU part number and harness continuity before probing Honda A16 and B37–B39 / C37.',
    dlcProtocol: 'Honda CAN Pins 6/14 & K-Line Pin 7 (F-CAN / K-Line)',
    voicePrompt: 'Honda R18A2 and FN2 alert: confirm physical ECU part number and harness continuity before probing pins A16, B37 through B39, or C37.',
  },
  {
    id: 'guide-honda-obd2a',
    brandKey: 'honda',
    brandLabel: 'Honda',
    ecuName: 'Honda OBD2A PGM-FI ECU',
    status: 'VERIFIED',
    linkedProfileId: 'honda-keihin-pgmfi',
    models: ['Civic (OBD2A Legacy)'],
    tableRef: 'Table 11A / 11B & Table 16',
    keyBenchPins: 'OBD2A multi-plug A/C/D layout: logic/power grounds, VBAT constant +12V, IG1 switched ignition, Main Relay PGM-FI feed, and K-Line / SCS service check.',
    bootOrPowerRule: 'Bond logic and power grounds cleanly before powering IG1; use 3-pin / 5-pin legacy DLC K-Line & SCS short jumper for flash codes.',
    dlcProtocol: 'Honda 3-Pin / 5-Pin Legacy DLC (K-Line + SCS) / OBD2 Pin 7',
    voicePrompt: 'Honda OBD2A ECU: bond main logic grounds, apply VBAT and IG1 12 volts, and read diagnostics on the Honda K-Line and SCS connector.',
  },
  {
    id: 'guide-nissan-d40',
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    ecuName: 'Nissan Navara D40 YD25DDTi Denso ECM (2007–2009 vs. 2010+)',
    status: 'OCR_VERIFY',
    linkedProfileId: 'nissan-hitachi-mec11',
    models: ['Navara D40 (YD25DDTi)'],
    tableRef: 'Table 12A',
    keyBenchPins: 'Critical Pins 105, 107, 108 power/relay allocation differs between 2007–2009 and 2010+ D40 YD25DDTi ECM revisions.',
    bootOrPowerRule: 'Inspect physical ECM aluminum label and measure resistance from Pins 105/107/108 to ground before applying +12V bench power.',
    ocrVerifyGate: 'OCR_VERIFY REQUIRED: Verify physical ECU part number (2007–2009 vs. 2010+) and harness continuity before energizing Nissan D40 Pins 105, 107, or 108.',
    dlcProtocol: 'Nissan CAN (OBD-II Pins 6 & 14) / Legacy K-Line check',
    voicePrompt: 'Nissan D40 YD25DDTi alert: verify physical ECU part number for 2007 to 2009 versus 2010 revision and check harness continuity before energizing pins 105, 107, or 108.',
  },
  {
    id: 'guide-nissan-qr25de',
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    ecuName: 'Nissan QR25DE Hitachi ECM',
    status: 'VERIFIED',
    linkedProfileId: 'nissan-hitachi-mec11',
    models: ['X-Trail / Teana (QR25DE)'],
    tableRef: 'Table 12B',
    keyBenchPins: '121-pin Hitachi chamber A/B layout: constant +BATT, switched IGN, ECM relay self-shutoff, chassis grounds, and OBD2 K-Line / CAN.',
    bootOrPowerRule: 'Never use ECM sensor ground pins as probe reference for high-current +12V tests; always reference chassis battery negative.',
    dlcProtocol: 'OBD-II CAN Pins 6/14 (late QR25DE) or ISO-9141 Pin 7 (early)',
    voicePrompt: 'Nissan QR25DE Hitachi bench test: verify constant battery, switched ignition, chassis grounds, and never use ECM sensor ground to probe battery circuits.',
  },
  {
    id: 'guide-mitsubishi-4d56-4m41',
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    ecuName: 'Mitsubishi Denso SH7058 / SH72543 (4D56 / 4M41 121-Pin A/B & Ep7)',
    status: 'VERIFIED',
    linkedProfileId: 'mitsubishi-denso-diesel',
    models: ['Montero Sport (4D56 / 4M41)', 'Strada / L200 (4D56 DI-D)', 'Pajero (4M41 DI-D)', 'L300 Euro-4 (4N14)'],
    tableRef: 'Tables 13A–13B',
    keyBenchPins: '121-pin Connectors A & B + Ep7 bench/boot pin assignment; main power ground, permanent +BATT, switched IG1, CAN-H / CAN-L (60Ω terminated).',
    bootOrPowerRule: 'Follow Ep7 bench/boot sequence: verify stable 12.6V bench PSU before applying boot/watchdog clock signals during SH7058/SH72543 read.',
    dlcProtocol: 'OBD-II CAN (Pins 6 & 14) + MUT-II/III Pin 1 / Pin 7 where equipped',
    voicePrompt: 'Mitsubishi 4D56 and 4M41 121-pin A and B with Ep7 protocol: bond engine grounds, apply constant 12V and IG1, terminate CAN with 120 Ohms, and verify Ep7 sequence.',
  },
  {
    id: 'guide-isuzu-4hk1',
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    ecuName: 'Isuzu Transtron 4HK1 ECM (12V vs. 24V Dual-Voltage Caution)',
    status: 'OCR_VERIFY',
    linkedProfileId: 'isuzu-transtron-4jj1',
    models: ['NHR / NKR / NPR / NQR Trucks (4HK1)'],
    tableRef: 'Section 2 Isuzu 4HK1 Voltage Gate',
    keyBenchPins: 'Main Relay feed, +BATT, IGN_SW, Chassis GND, CAN-H / CAN-L — strictly confirm 12V light-duty vs. 24V commercial chassis spec.',
    bootOrPowerRule: 'DO NOT set Bench Power Supply to 24V until the physical Transtron ECU part number confirms a 24V commercial rating.',
    ocrVerifyGate: 'OCR_VERIFY REQUIRED: Confirm 12V vs. 24V ECU hardware voltage rating on the Isuzu 4HK1 part number label before energizing the Bench Power Supply.',
    dlcProtocol: 'J1962 OBD-II CAN (Pins 6 & 14) / J1939 Heavy-Duty Bridge',
    voicePrompt: 'Isuzu 4HK1 critical alert: confirm whether this ECU is 12 volt or 24 volt from the physical part number before energizing power.',
  },
  {
    id: 'guide-suzuki-f6a-m16-j20',
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    ecuName: 'Suzuki Legacy F6A (A/T / ECT) & M16A / J20A (Restricted from K15B)',
    status: 'OCR_VERIFY',
    linkedProfileId: null,
    models: ['F6A Kei / Multi-Cab (A/T / ECT)', 'Grand Vitara / SX4 (J20A / M16A)'],
    tableRef: 'Section 2 Suzuki Verified Legacy & Restriction Rule',
    keyBenchPins: 'Verified legacy F6A A/T/ECT & M16/J20 bench wakeup tables only; STRICTLY RESTRICTED from cross-application onto Suzuki K15B.',
    bootOrPowerRule: 'Confirm physical engine code and ECU connector before energizing. NEVER substitute M16/J20 or Delphi MT20U pinouts onto K15B.',
    ocrVerifyGate: 'RESTRICTION GATE: Suzuki M16/J20 pinouts are strictly prohibited on K15B (Jimny/Ertiga/XL7). Verify engine family before bench wiring.',
    dlcProtocol: 'Suzuki 6-Pin / 12-Pin SDL Legacy DLC & OBD-II K-Line/CAN',
    voicePrompt: 'Suzuki verified legacy note: F6A, M16, and J20 are verified only for their matching harnesses and strictly restricted from Suzuki K15B models.',
  },
  {
    id: 'guide-hyundai-accent-cpeg',
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai & Kia',
    ecuName: 'Hyundai 2014 Accent [EGGA-AG]/[EGGA-KG], CPEGP2.10.1, CPEGD2 & G4-J (39110-24550)',
    status: 'VERIFIED',
    linkedProfileId: 'hyundai-kia-edc16c39',
    models: ['Accent 2014 ([EGGA-AG] / [EGGA-KG])', 'Soluto / Reina (CPEGD2 / CPEGP2.10.1 Bench)', 'G4-J (39110-24550)'],
    tableRef: 'Tables 14A–14C',
    keyBenchPins: 'Bench power/GND/IG15/CAN pins per Tables 14A–14C for [EGGA-AG]/[EGGA-KG], CPEGP2.10.1, CPEGD2, and 39110-24550 G4-J controllers.',
    bootOrPowerRule: 'Verify exact ECU code ([EGGA-AG] vs [EGGA-KG], CPEGP2.10.1, CPEGD2, or 39110-24550) and supply clean 12.6V bench voltage with 60Ω CAN termination.',
    dlcProtocol: 'OBD-II CAN Pins 6 & 14 + K-Line Pin 7 (legacy diagnostics)',
    voicePrompt: 'Hyundai verified bench group covers 2014 Accent EGGA-AG and EGGA-KG, CPEGP2.10.1, CPEGD2, and G4-J 39110-24550 per Tables 14A through 14C.',
  },
  {
    id: 'guide-ford-sid209',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford FoMoCo Continental SID209 (A/B/C Grid & Boot Protocol)',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Ranger (SID209 Euro-5 / 2.2L / 3.2L)', 'Everest (SID209)'],
    tableRef: 'Table 15',
    keyBenchPins: 'Triple-chamber Connector A / B / C grid (50P / 54P / 50P): Grounds, KL30 Battery, KL15 Ignition, HS-CAN (6/14), and TC1797 Boot Pad.',
    bootOrPowerRule: 'Bench unlock & full EEPROM/Flash read requires TriCore TC1797 boot resistor/GPT clock protocol per Table 15 (do not apply 18V FEPS to HS-CAN SID209).',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14) + MS-CAN (Pins 3 & 11)',
    voicePrompt: 'Ford SID209 per Table 15 uses triple-chamber A, B, and C connectors with TriCore TC1797 boot protocol and High-Speed CAN on pins 6 and 14.',
  },
  {
    id: 'guide-ford-ranger-everest-t6',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford Ranger & Everest T6 PCM (C1E Connector)',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Ranger T6', 'Everest T6', 'Ranger & Everest T6'],
    tableRef: 'Ford OEM Pinouts (T6 C1E)',
    keyBenchPins: 'Power (+12V): Pin C1E148 | Switched Ignition (+12V): Pin C1E142 | Grounds (0V): Pins C1E139 and C1E140.',
    bootOrPowerRule: 'For the Ranger and Everest T6, connect constant power to Pin C1E148, switched ignition to Pin C1E142, and grounds to Pins C1E139 and C1E140.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14) + MS-CAN (Pins 3 & 11)',
    voicePrompt: 'For the Ford Ranger and Everest T6, power goes to Pin C1E148, switched ignition to Pin C1E142, and grounds to Pins C1E139 and C1E140.',
  },
  {
    id: 'guide-ford-nextgen-ecoblue',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford Next-Gen Ranger & Everest 2.0L EcoBlue PCM (CBR Connector)',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Next-Gen Ranger EcoBlue', 'Next-Gen Everest EcoBlue', 'Next-Gen Ranger & Everest EcoBlue'],
    tableRef: 'Ford OEM Pinouts (EcoBlue CBR)',
    keyBenchPins: 'Constant Power (+12V): CBR Pin 1 | Switched Ignition (+12V): CBR Pin 3 | Grounds (0V): CBR Pins 2 and 4.',
    bootOrPowerRule: 'For the Next-Gen Ranger and Everest EcoBlue, constant power connects to CBR pin 1, ignition to CBR pin 3, and grounds to CBR pins 2 and 4.',
    dlcProtocol: 'Ford HS-CAN / FD-CAN (OBD-II Pins 6 & 14)',
    voicePrompt: 'For the Next-Gen Ranger and Everest EcoBlue, constant power connects to Pin CBR pin 1, ignition to CBR pin 3, and grounds to CBR pins 2 and 4.',
  },
  {
    id: 'guide-ford-ecosport-fiesta-15l',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford EcoSport & Fiesta 1.5L Ti-VCT EMS / PCM',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['EcoSport 1.5L', 'Fiesta 1.5L', 'EcoSport & Fiesta 1.5L'],
    tableRef: 'Ford OEM Pinouts (EcoSport/Fiesta 1.5L)',
    keyBenchPins: 'Power (+12V): Pin 1 | Switched Ignition (+12V): Pin 2 | Grounds (0V): Pins 3 and 4.',
    bootOrPowerRule: 'For the EcoSport and Fiesta 1.5L, connect power to Pin 1, ignition to Pin 2, and ground to Pins 3 and 4.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14) + MS-CAN (Pins 3 & 11)',
    voicePrompt: 'For the Ford EcoSport and Fiesta 1.5L, connect power to Pin 1, ignition to Pin 2, and ground to Pins 3 and 4.',
  },
  {
    id: 'guide-ford-focus-ecosport-gdi',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford Focus & EcoSport GDI Direct Injection PCM',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Focus GDI', 'EcoSport GDI', 'Focus & EcoSport GDI'],
    tableRef: 'Ford OEM Pinouts (Focus/EcoSport GDI)',
    keyBenchPins: 'Power (+12V): Pin 61 | Switched Ignition (+12V): Pin 16 | Ground (0V): Pin 32.',
    bootOrPowerRule: 'The Focus and EcoSport GDI require power on Pin 61, ignition on Pin 16, and ground on Pin 32.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14) + MS-CAN (Pins 3 & 11)',
    voicePrompt: 'The Ford Focus and EcoSport GDI require power on Pin 61, ignition on Pin 16, and ground on Pin 32.',
  },
  {
    id: 'guide-ford-powershift-tcm',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford PowerShift TCM (6DCT250 Dual-Clutch Transmission Control Module)',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['PowerShift TCM (EcoSport / Fiesta / Focus 6DCT250)', 'PowerShift TCM'],
    tableRef: 'Ford OEM Pinouts (PowerShift TCM)',
    keyBenchPins: 'Power (+12V): Pins 1 and 2 | Switched Ignition (+12V): Pin 3 | Grounds (0V): Pins 4 and 5.',
    bootOrPowerRule: 'For the PowerShift TCM, power is applied to Pins 1 and 2, ignition to Pin 3, and grounds to Pins 4 and 5.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14, 500 kbps)',
    voicePrompt: 'For the Ford PowerShift TCM, power is applied to Pins 1 and 2, ignition to Pin 3, and grounds to Pins 4 and 5.',
  },
  {
    id: 'guide-ford-territory-ecoboost',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford Territory 1.5L EcoBoost PCM / EMS',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Territory 1.5L EcoBoost', 'Territory (PH)'],
    tableRef: 'Ford OEM Pinouts (Territory 1.5L EcoBoost)',
    keyBenchPins: 'Power (+12V): Pin 8 | Switched Ignition (+12V): Pin 9 | Grounds (0V): Pins 10 and 11.',
    bootOrPowerRule: 'The Territory 1.5L EcoBoost uses Pin 8 for power, Pin 9 for ignition, and Pins 10 and 11 for ground.',
    dlcProtocol: 'OBD-II ISO 15765-4 HS-CAN (Pins 6 & 14)',
    voicePrompt: 'The Ford Territory 1.5L EcoBoost uses Pin 8 for power, Pin 9 for ignition, and Pins 10 and 11 for ground.',
  },
  {
    id: 'guide-ford-ranger-25na',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford Ranger 2.5L NA Petrol PCM',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Ranger 2.5L NA'],
    tableRef: 'Ford OEM Pinouts (Ranger 2.5L NA)',
    keyBenchPins: 'Power (+12V): Pin 1 | Switched Ignition (+12V): Pin 2 | Grounds (0V): Pins 3 and 4.',
    bootOrPowerRule: 'Connecting the Ranger 2.5L NA requires power on Pin 1, ignition on Pin 2, and ground on Pins 3 and 4.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14)',
    voicePrompt: 'Connecting the Ford Ranger 2.5L NA requires power on Pin 1, ignition on Pin 2, and ground on Pins 3 and 4.',
  },
  {
    id: 'guide-ford-escape-focus-duratec',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Older Ford Escape, Focus & Duratec PCM',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Older Escape / Focus / Duratec', 'Escape Duratec', 'Focus Duratec'],
    tableRef: 'Ford OEM Pinouts (Escape/Focus Duratec)',
    keyBenchPins: 'Power (+12V): Pin 15 | Switched Ignition (+12V): Pin 6 | Ground (0V): Pin 61.',
    bootOrPowerRule: 'Older Escape, Focus, and Duratec models take power on Pin 15, ignition on Pin 6, and ground on Pin 61.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14) / SAE J1850 PWM',
    voicePrompt: 'Older Ford Escape, Focus, and Duratec models take power on Pin 15, ignition on Pin 6, and ground on Pin 61.',
  },
  {
    id: 'guide-ford-explorer',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford Explorer PCM',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Explorer', 'Ford Explorer'],
    tableRef: 'Ford OEM Pinouts (Explorer)',
    keyBenchPins: 'Power (+12V): Pin 103 | Switched Ignition (+12V): Pin 105 | Ground (0V): Pin 116.',
    bootOrPowerRule: 'For the Explorer, power goes to Pin 103, ignition to Pin 105, and ground to Pin 116.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14) + MS-CAN (Pins 3 & 11)',
    voicePrompt: 'For the Ford Explorer, power goes to Pin 103, ignition to Pin 105, and ground to Pin 116.',
  },
  {
    id: 'guide-ford-transit-22tdci',
    brandKey: 'ford',
    brandLabel: 'Ford',
    ecuName: 'Ford Transit 2.2L TDCi PCM',
    status: 'VERIFIED',
    linkedProfileId: 'ford-fomoco-sid208',
    models: ['Transit 2.2L TDCi', 'Ford Transit 2.2L TDCi'],
    tableRef: 'Ford OEM Pinouts (Transit 2.2L TDCi)',
    keyBenchPins: 'Power (+12V): Pin B20 | Switched Ignition (+12V): Pin B22 | Grounds (0V): Pins B23 and B24.',
    bootOrPowerRule: 'The Transit 2.2L TDCi needs power on Pin B20, ignition on Pin B22, and ground on Pins B23 and B24.',
    dlcProtocol: 'Ford HS-CAN (OBD-II Pins 6 & 14) + MS-CAN (Pins 3 & 11)',
    voicePrompt: 'The Ford Transit 2.2L TDCi needs power on Pin B20, ignition on Pin B22, and ground on Pins B23 and B24.',
  },
];

/**
 * Rule 2: Mandatory OCR_VERIFY & Hardware-Conflict Prompts
 */
export const OCR_VERIFY_RULES: OcrVerifyRule[] = [
  {
    id: 'gate-nissan-d40',
    matchTerms: ['d40', 'yd25', 'yd25ddti', 'navara', '105', '107', '108'],
    title: 'OCR_VERIFY: Nissan D40 YD25DDTi (2007–2009 vs. 2010+)',
    prompt: 'Verify the physical ECU part number and harness continuity BEFORE energizing Nissan D40 Pins 105, 107, or 108 (pinout differs between 2007–2009 and 2010+ revisions).',
    spokenAlert: 'Verification required before energizing Nissan D40 pins 105, 107, or 108. Confirm the physical ECU part number for 2007 to 2009 versus 2010 plus, and check harness continuity.',
  },
  {
    id: 'gate-toyota-1krfe',
    matchTerms: ['1kr', '1kr-fe', '1krfe', 'wigo'],
    title: 'OCR_VERIFY: Toyota 1KR-FE Three Hardware Revisions',
    prompt: 'Verify the physical ECU part number on the case sticker and select among the three 1KR-FE revisions (Tables 3A–3B) before applying bench power.',
    spokenAlert: 'Verification required for Toyota 1KR-FE. Confirm the physical ECU part number and select the matching hardware revision among the three 1KR-FE tables.',
  },
  {
    id: 'gate-toyota-1gdftv',
    matchTerms: ['1gd', '1gd-ftv', '1gdftv', 'i-art', 'iart'],
    title: 'OCR_VERIFY: Toyota 1GD-FTV (i-ART vs. Non-i-ART)',
    prompt: 'Verify physical ECU part number to confirm i-ART closed-loop smart injectors vs. non-i-ART injector driver topology before bench testing injector outputs.',
    spokenAlert: 'Verification required for Toyota 1GD-FTV. Confirm whether the ECU is i-ART or non-i-ART before energizing injector circuits.',
  },
  {
    id: 'gate-isuzu-4hk1',
    matchTerms: ['4hk1', '4hk', 'npr', 'nqr'],
    title: 'OCR_VERIFY: Isuzu 4HK1 12V vs. 24V System Check',
    prompt: 'Confirm 12V vs. 24V rating from the physical Isuzu 4HK1 ECU part number BEFORE adjusting Bench Power Supply voltage.',
    spokenAlert: 'Critical voltage check for Isuzu 4HK1. Confirm 12 volt versus 24 volt rating on the physical ECU label before energizing power.',
  },
  {
    id: 'gate-honda-a16-b37',
    matchTerms: ['r18a2', 'fn2', 'a16', 'b37', 'b38', 'b39', 'c37'],
    title: 'OCR_VERIFY: Honda R18A2 / FN2 Critical Cavities',
    prompt: 'Verify physical Honda ECU part number and harness continuity BEFORE probing Pin A16 and Pins B37–B39 / C37.',
    spokenAlert: 'Verification required before probing Honda A16 or B37 through B39 and C37. Confirm the physical ECU part number and harness continuity first.',
  },
  {
    id: 'gate-suzuki-k15b-restriction',
    matchTerms: ['k15b', 'm16', 'j20', 'jimny', 'ertiga', 'xl7', 's-presso', 'dzire', 'swift', 'celerio', 'apv'],
    title: 'RESTRICTION GATE: Suzuki K15B Isolation',
    prompt: 'Suzuki M16 / J20 pinouts are STRICTLY RESTRICTED from K15B platforms. Pin-by-pin factory wiring is unavailable for K15B / S-Presso / Ertiga / Jimny / Dzire / XL7 / Swift / Celerio / APV — never fabricate pin numbers.',
    spokenAlert: 'Suzuki restriction alert. Never apply M16 or J20 pinouts to Suzuki K15B models. K15B, Ertiga, and Jimny are restricted to metadata and DLC protocols only.',
  },
];

/**
 * Rule 3: Restricted / Publicly Unavailable OEM Schematics & Mechanical No-ECU Vehicles
 * (Strictly PART_METADATA_ONLY or MECHANICAL_NO_ECU — zero fabricated pin numbers).
 */
export const RESTRICTED_MODEL_DATABASE: RestrictedModelEntry[] = [
  // MG Cars — all 10 models (including hybrid / EV / TRQ-L platforms)
  ...([
    ['MG 3 (Hybrid+ / Petrol)', 'SAIC / Bosch / VCU Hybrid Metadata Only · OBD-II CAN / DoIP'],
    ['MG 4 EV (MSP EV)', 'SAIC VCU / BMS / PEB Traction Inverter (EV High-Voltage Safety)'],
    ['MG 5 (1.5L / GT)', 'SAIC / Bosch MED17 / EMS Metadata Only · ISO 15765 CAN'],
    ['MG ZS (1.5L / T)', 'SAIC EMS Metadata Only · OBD-II ISO 15765-4 CAN (500 kbps)'],
    ['MG ZS EV', 'SAIC VCU / BMS / MCU High-Voltage EV Platform (HV Lockout Required)'],
    ['MG HS (1.5T / PHEV)', 'SAIC / Bosch MED17 / PHEV Hybrid TRQ-L Control Metadata'],
    ['MG RX5', 'SAIC / Bosch Engine Management & TCM Metadata Only'],
    ['MG GT', 'SAIC / 1.5T GDI EMS Metadata Only · ISO 15765 CAN'],
    ['MG One (TRQ-L / Sigma)', 'SAIC Sigma Architecture / TRQ-L Powertrain Metadata Only'],
    ['MG Cyberster (EV)', 'SAIC Dual-Motor EV VCU / BMS / Inverter Architecture Metadata'],
  ] as const).map(([modelName, note], idx) => ({
    id: `mg-model-${idx + 1}`,
    brandKey: 'mg-cars',
    brandLabel: 'MG Cars',
    modelName,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: note,
    dlcProtocol: 'SAE J1962 OBD-II CAN Pins 6 & 14 (500 kbps) / DoIP Ethernet (EV/TRQ-L)',
    restrictionReason: 'Factory pin-by-pin ECU cavity table not in verified public technical record. Zero pin numbers fabricated.',
  })),

  // Hyundai PART_METADATA_ONLY models
  ...([
    'Stargazer',
    'Staria',
    'Creta',
    'Tucson',
    'Reina',
    'Eon',
    'Santa Fe',
    'Kona',
  ]).map((modelName, idx) => ({
    id: `hyundai-meta-${idx + 1}`,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai & Kia',
    modelName: `${modelName} (Metadata Only)`,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: 'Hyundai Kefico / Continental / Bosch EMS Metadata Only (verified pinout limited to Accent EGGA, CPEGP2.10.1, CPEGD2, G4-J 39110-24550 & EDC16C39)',
    dlcProtocol: 'OBD-II ISO 15765-4 CAN (Pins 6 & 14) / K-Line Pin 7 on legacy Eon',
    restrictionReason: 'No verified pin-by-pin cavity table ingested for this model trim; metadata & DLC protocol only.',
  })),

  // Ford PART_METADATA_ONLY models (Mustang & Expedition remain metadata-only; Ranger/Everest T6 & EcoBlue, EcoSport, Fiesta, Focus, PowerShift TCM, Territory, Escape/Duratec, Explorer, Transit 2.2L TDCi are now VERIFIED)
  ...([
    'Mustang',
    'Expedition',
  ]).map((modelName, idx) => ({
    id: `ford-meta-${idx + 1}`,
    brandKey: 'ford',
    brandLabel: 'Ford',
    modelName: `${modelName} (Metadata Only)`,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: 'FoMoCo PCM Metadata Only (verified pinouts available for Ranger/Everest T6 & EcoBlue, EcoSport/Fiesta 1.5L, Focus/EcoSport GDI, PowerShift TCM, Territory 1.5L EcoBoost, Ranger 2.5L NA, Escape/Focus Duratec, Explorer, and Transit 2.2L TDCi)',
    dlcProtocol: 'Ford HS-CAN (Pins 6 & 14) + MS-CAN (Pins 3 & 11)',
    restrictionReason: 'No verified pin-by-pin PCM cavity map ingested for this model; do not substitute other FoMoCo pins.',
  })),

  // Toyota PART_METADATA_ONLY models
  ...([
    ['Hiace (Commuter / GL Grandia Non-1KD/2KD)', 'Denso / 1GD or Non-1KD/2KD Variant Metadata Only'],
    ['Raize (1.2L WA-VE / 1.0T 1KR-VET)', 'Daihatsu / Denso DNGA Controller Metadata Only (Do not mix with Wigo 1KR-FE)'],
    ['Tamaraw (2.4L 2GD-FTV)', 'Toyota IMV-0 / Denso 2GD-FTV Metadata Only'],
    ['2GD-FTV ECM Platforms', 'Denso 2GD-FTV ECM Metadata Only (Separate from 1KD/2KD/1GD verified guides)'],
  ] as const).map(([modelName, note], idx) => ({
    id: `toyota-meta-${idx + 1}`,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    modelName,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: note,
    dlcProtocol: 'OBD-II ISO 15765 CAN (Pins 6 & 14)',
    restrictionReason: 'Factory pin-by-pin wiring table unavailable in retrieved record; stored as part metadata only.',
  })),

  // Mitsubishi PART_METADATA_ONLY + MECHANICAL_NO_ECU models
  {
    id: 'mitsubishi-xpander',
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    modelName: 'Xpander (4A91)',
    status: 'PART_METADATA_ONLY',
    oemControllerNote: 'Mitsubishi MIVEC 4A91 EMS Metadata Only',
    dlcProtocol: 'OBD-II CAN Pins 6 & 14',
    restrictionReason: 'Factory pin-by-pin cavity table unavailable; metadata and DLC only.',
  },
  {
    id: 'mitsubishi-mirage-3a92',
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    modelName: 'Mirage / G4 (3A92)',
    status: 'PART_METADATA_ONLY',
    oemControllerNote: 'Mitsubishi 3A92 1.2L MIVEC EMS Metadata Only',
    dlcProtocol: 'OBD-II CAN Pins 6 & 14',
    restrictionReason: 'Factory pin-by-pin cavity table unavailable; metadata and DLC only.',
  },
  {
    id: 'mitsubishi-xforce',
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    modelName: 'Xforce (4A91)',
    status: 'PART_METADATA_ONLY',
    oemControllerNote: 'Mitsubishi Xforce EMS Metadata Only',
    dlcProtocol: 'OBD-II CAN Pins 6 & 14',
    restrictionReason: 'Factory pin-by-pin cavity table unavailable; metadata and DLC only.',
  },
  {
    id: 'mitsubishi-l300-mech',
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    modelName: 'L300 (4D56 Mechanical Diesel — NO ECU)',
    status: 'MECHANICAL_NO_ECU',
    oemControllerNote: 'Mechanical rotary injection pump (VE-type) & fuel cut solenoid — NO Engine Control Unit (ECU). (Only Euro-4 4N14 uses Denso ECM).',
    dlcProtocol: 'None (Mechanical Diesel Fuel Injection — Verify 12V fuel cut solenoid directly)',
    restrictionReason: 'Mechanical 4D56 diesel carries NO Engine ECU. Do not search for ECM pinouts.',
  },
  {
    id: 'mitsubishi-adventure-mech',
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    modelName: 'Adventure (4D56 Mech Diesel / 4G63 Carb — NO ECU)',
    status: 'MECHANICAL_NO_ECU',
    oemControllerNote: 'Mechanical VE injection pump (4D56) or Carbureted (4G63) — NO Engine Control Unit (ECU).',
    dlcProtocol: 'None / Glow Timer Relay only (No OBD-II Engine ECU)',
    restrictionReason: 'Legacy mechanical diesel / carbureted platform carries NO Engine ECU.',
  },

  // Suzuki PART_METADATA_ONLY models (strictly isolated from M16/J20 & Delphi)
  ...([
    'S-Presso (K10B / K10C)',
    'Ertiga (K15B)',
    'Jimny (K15B)',
    'Dzire (K12M / K12N)',
    'XL7 (K15B)',
    'Swift (K12M / K14B)',
    'Celerio (K10B / K10C)',
    'APV (G16A)',
  ]).map((modelName, idx) => ({
    id: `suzuki-meta-${idx + 1}`,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    modelName,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: 'Suzuki Bosch / Denso / Mitsubishi EMS Metadata Only (M16/J20 pinouts STRICTLY RESTRICTED from K15B)',
    dlcProtocol: 'OBD-II CAN (Pins 6 & 14) / Suzuki 6-Pin & 12-Pin SDL Legacy where fitted',
    restrictionReason: 'Factory pin-by-pin table restricted; strictly prohibited from inheriting M16/J20 or Delphi MT20U pinouts.',
  })),

  // Honda PART_METADATA_ONLY models & L15A1 cavity map restriction
  ...([
    'BR-V',
    'CR-V',
    'Brio',
    'HR-V',
    'Mobilio',
    'Accord',
    'City / Jazz L15A1 (Cavity Maps Restricted)',
  ]).map((modelName, idx) => ({
    id: `honda-meta-${idx + 1}`,
    brandKey: 'honda',
    brandLabel: 'Honda',
    modelName,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: 'Honda Keihin PGM-FI Part Metadata & DLC Protocol Only (L15A1 cavity pin map unavailable)',
    dlcProtocol: 'OBD-II CAN (Pins 6 & 14) / K-Line Pin 7 / Legacy 3-Pin or 5-Pin SCS DLC',
    restrictionReason: 'Factory cavity-by-cavity pinout map unavailable in retrieved technical record; never fabricate pin numbers.',
  })),

  // Nissan PART_METADATA_ONLY models
  ...([
    'Terra (YD25 / YS23)',
    'NV350 Urvan (YD25DDTi)',
    'Almera (N17 / N18 HRA0/HR15)',
    'Livina',
    'Kicks e-Power',
    'Patrol',
    'Juke',
  ]).map((modelName, idx) => ({
    id: `nissan-meta-${idx + 1}`,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    modelName,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: 'Nissan / Hitachi / Denso / e-Power VCU Metadata Only (Do not mix N17/N18 or NV350 with N16 MEC11/D40)',
    dlcProtocol: 'OBD-II ISO 15765 CAN (Pins 6 & 14)',
    restrictionReason: 'Factory pin-by-pin wiring table unavailable in retrieved record; metadata and DLC only.',
  })),

  // Isuzu PART_METADATA_ONLY + MECHANICAL_NO_ECU models
  ...([
    'D-Max (RZ4E / Non-4JJ1 Trims)',
    'mu-X (RZ4E / Non-4JJ1 Trims)',
    'Traviz (4JA1-L Euro-4)',
    'Alterra (Unverified Trim Metadata)',
    'Trooper',
    'F-Series (6HK1 / Heavy Duty)',
  ]).map((modelName, idx) => ({
    id: `isuzu-meta-${idx + 1}`,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    modelName,
    status: 'PART_METADATA_ONLY' as const,
    oemControllerNote: 'Isuzu Transtron / Denso Part Metadata Only (Verify 12V vs 24V on commercial F-Series)',
    dlcProtocol: 'OBD-II CAN (Pins 6 & 14) / J1939 Heavy-Duty',
    restrictionReason: 'Factory pin-by-pin wiring table restricted to verified 4JJ1 and gated 4HK1 guides.',
  })),
  ...([
    'Crosswind (4JA1 Mechanical Diesel — NO ECU)',
    'Hi-Lander (4JA1 Mechanical Diesel — NO ECU)',
    'Fuego (4JA1 Mechanical Diesel — NO ECU)',
  ]).map((modelName, idx) => ({
    id: `isuzu-mech-${idx + 1}`,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    modelName,
    status: 'MECHANICAL_NO_ECU' as const,
    oemControllerNote: 'Mechanical 4JA1 direct-injection diesel pump — NO Engine Control Unit (ECU). Only glow plug timer & fuel cut solenoid exist.',
    dlcProtocol: 'None (Legacy Mechanical Injection — No OBD-II Engine ECU)',
    restrictionReason: 'No Engine ECU fitted on 4JA1 mechanical Crosswind / Hi-Lander / Fuego.',
  })),
];

/**
 * Table 16: Vehicle-Side OBD-II (SAE J1962 16-Pin) & Legacy OEM DLC Interfaces
 */
export const TABLE16_DLC_INTERFACES: DlcInterfaceEntry[] = [
  {
    id: 'dlc-toyota',
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    connectorTypes: '16-Pin SAE J1962 OBD-II + Legacy 22-Pin / 17-Pin TDCL',
    obd2Pins: 'Pin 4: Chassis GND | Pin 5: Signal GND | Pin 6: CAN-H | Pin 14: CAN-L | Pin 7: SIL (ISO-9141 / K-Line) | Pin 13: TC (Blink/ABS Reset) | Pin 9: TAC | Pin 16: +12V BATT',
    legacyDlcPins: '22-Pin / 17-Pin Engine Bay TDCL: +B (+12V), E1 (GND), TE1/TC (Blink Code Jumper to E1), VF1 (O2 Feedback), W (MIL)',
    protocolNotes: 'Gen-1 1NZ/1KD/2KD uses Pin 7 SIL or MOBD; newer 1NR/2NR/1GD uses CAN 6 & 14. Jump Pin 13 (TC) to Pin 4 (CG) for manual blink codes.',
    voiceSummary: 'Toyota DLC Table 16: OBD2 Pin 16 battery, 4 and 5 ground, 6 and 14 CAN, Pin 7 SIL K-Line, Pin 13 TC test. Legacy 22-pin and 17-pin TDCL uses TE1 to E1 jumper.',
  },
  {
    id: 'dlc-honda',
    brandKey: 'honda',
    brandLabel: 'Honda',
    connectorTypes: '16-Pin SAE J1962 OBD-II + Legacy 3-Pin & 2-Pin SCS DLC',
    obd2Pins: 'Pin 4: Chassis GND | Pin 5: Signal GND | Pin 6: F-CAN H | Pin 14: F-CAN L | Pin 7: K-Line (PGM-FI) | Pin 16: +12V BATT',
    legacyDlcPins: 'Legacy 3-Pin DLC (Light Blue/Blue): K-Line Data, +12V IGN, GND · Paired with 2-Pin SCS (Service Check Signal) short plug for MIL blink codes.',
    protocolNotes: 'OBD2A and early PGM-FI use 3-Pin + 2-Pin SCS or OBD2 Pin 7 K-Line; R18A2/FN2 and late models use F-CAN on Pins 6 and 14.',
    voiceSummary: 'Honda DLC Table 16: OBD2 Pin 7 K-Line and Pins 6 and 14 F-CAN, Pin 16 battery, 4 and 5 ground. Legacy OBD2A uses 3-pin K-Line plus 2-pin SCS blink jumper.',
  },
  {
    id: 'dlc-nissan',
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    connectorTypes: '16-Pin SAE J1962 OBD-II + Legacy 14-Pin Grey CONSULT-I DLC',
    obd2Pins: 'Pin 4: Chassis GND | Pin 5: Signal GND | Pin 6: CAN-H | Pin 14: CAN-L | Pin 7: ISO-9141 K-Line (MEC11/MEC22) | Pin 8: IGN SW (some) | Pin 16: +12V BATT',
    legacyDlcPins: '14-Pin CONSULT-I Trapezoid Connector: RX (Data In), TX (Data Out), CLK (Sync Clock), CHK (Diag Trigger), IGN (+12V), GND',
    protocolNotes: 'Sentra/Almera N16 Hitachi MEC11/MEC22 uses pure K-Line Pin 7 (ignore TCU Pins 86/94). Navara D40 YD25DDTi uses CAN 6/14.',
    voiceSummary: 'Nissan DLC Table 16: OBD2 Pin 7 K-Line for N16 MEC11 and MEC22, Pins 6 and 14 CAN for D40 and modern models, and 14-pin CONSULT-I for legacy RX, TX, and CLK.',
  },
  {
    id: 'dlc-mitsubishi',
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    connectorTypes: '16-Pin SAE J1962 OBD-II + Legacy 12-Pin MUT-II DLC',
    obd2Pins: 'Pin 1: MUT-II Trigger /ABS | Pin 4/5: GND | Pin 6: CAN-H | Pin 14: CAN-L | Pin 7: K-Line (ISO-9141) | Pin 16: +12V BATT',
    legacyDlcPins: '12-Pin Legacy MUT-II Connector: Pin 1 SCI/K-Line, Pin 10 Diagnostics Request, Pin 12 Ground',
    protocolNotes: '4D56 / 4M41 DI-D common-rail uses CAN 6/14 (with MUT-III). Verify L300/Adventure is Euro-4 4N14 before scanning — mechanical 4D56 has NO Engine ECU.',
    voiceSummary: 'Mitsubishi DLC Table 16: OBD2 Pins 6 and 14 CAN, Pin 7 K-Line, Pin 1 MUT trigger, and legacy 12-pin MUT-II connector. Mechanical 4D56 L300 has no engine ECU.',
  },
  {
    id: 'dlc-suzuki',
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    connectorTypes: '16-Pin SAE J1962 OBD-II + Legacy 6-Pin / 12-Pin SDL DLC',
    obd2Pins: 'Pin 4/5: GND | Pin 6: CAN-H | Pin 14: CAN-L | Pin 7: ISO-9141 K-Line / SDL | Pin 9: Suzuki SDL (older J20/M16) | Pin 16: +12V BATT',
    legacyDlcPins: '6-Pin / 12-Pin Suzuki Data Link (SDL): SDL Data, Diag Switch Ground Terminal (blink code trigger), +12V, GND',
    protocolNotes: 'Legacy F6A/J20 uses SDL Pin 7 or Pin 9; modern K15B (Jimny/Ertiga/XL7) uses CAN 6/14 ONLY (never cross-wire M16/J20 pinouts onto K15B).',
    voiceSummary: 'Suzuki DLC Table 16: OBD2 Pins 6 and 14 CAN on modern K15B, Pin 7 or Pin 9 SDL on older M16 and J20, plus 6-pin and 12-pin SDL test connectors.',
  },
  {
    id: 'dlc-standard-j1962',
    brandKey: 'universal-bench',
    brandLabel: 'Standard SAE J1962 / Isuzu / Hyundai / Ford / MG',
    connectorTypes: '16-Pin SAE J1962 Universal Bench DLC',
    obd2Pins: 'Pin 4: Chassis GND | Pin 5: Signal GND | Pin 6: HS-CAN High | Pin 14: HS-CAN Low | Pin 7: K-Line (ISO-9141 / KWP2000) | Pin 3/11: Ford MS-CAN | Pin 16: +12V BATT (60Ω CAN Term)',
    legacyDlcPins: 'MG EV / TRQ-L platforms may carry DoIP Ethernet lines alongside HS-CAN; Isuzu F-Series/4HK1 verify 12V vs 24V VBAT on Pin 16 before plugging scanner!',
    protocolNotes: 'Standard universal bench breakout wires Pin 16 -> KL30 (+12V fused), Pins 4 & 5 -> KL31 GND, Pin 6 -> CAN_H, Pin 14 -> CAN_L, Pin 7 -> K-Line.',
    voiceSummary: 'Standard SAE J1962 DLC: Pin 16 battery positive, Pins 4 and 5 ground, Pins 6 and 14 High-Speed CAN terminated at 60 Ohms, Pin 7 K-Line, and Pins 3 and 11 Ford Medium-Speed CAN.',
  },
];

/**
 * Finds all matching OCR_VERIFY or restriction rules for a query or vehicle/ECU string.
 */
export function matchSafetyGatesForQuery(text: string): OcrVerifyRule[] {
  const q = text.toLowerCase();
  return OCR_VERIFY_RULES.filter((rule) =>
    rule.matchTerms.some((term) => q.includes(term.toLowerCase()))
  );
}

/**
 * Finds matching PART_METADATA_ONLY or MECHANICAL_NO_ECU records for anti-fabrication guardrails.
 */
export function matchRestrictedModelsForQuery(text: string): RestrictedModelEntry[] {
  const q = text.toLowerCase().trim();
  if (!q) return [];
  const results: RestrictedModelEntry[] = [];
  const stopTokens = new Set(['cars', 'metadata', 'only', 'mech', 'diesel', 'mechanical', 'ecu', 'no', 'non', 'ev', 'trims', 'unverified', 'trim', 'heavy', 'duty', 'cavity', 'maps', 'restricted', 'platforms']);

  for (const entry of RESTRICTED_MODEL_DATABASE) {
    if (entry.brandKey === 'mg-cars') {
      if (/\bmg\b|\bcyberster\b|\brx5\b|\btrq-l\b/i.test(q)) {
        results.push(entry);
      }
      continue;
    }

    // Special guards so verified engine variants do not trigger restricted sibling trims
    if (entry.id === 'mitsubishi-l300-mech' && (/4n14|euro[\s-]*4/i.test(q) || (!/\bl300\b/i.test(q) && /4d56|121[\s-]*pin|ep7/i.test(q)))) {
      continue;
    }
    if (entry.id === 'mitsubishi-adventure-mech' && !/\badventure\b/i.test(q)) {
      continue;
    }
    if ((entry.id === 'isuzu-meta-1' || entry.id === 'isuzu-meta-2') && /4jj1|4jj3|4jk1/i.test(q)) {
      continue;
    }
    // Hiace 1KD/2KD-FTV is verified; generic non-1KD/2KD Hiace is PART_METADATA_ONLY
    if (entry.id === 'toyota-meta-1' && /1kd|2kd/i.test(q)) {
      continue;
    }

    const baseName = entry.modelName.replace(/\([^)]*\)/g, '').trim().toLowerCase();
    const parenContent = (entry.modelName.match(/\(([^)]*)\)/)?.[1] || '').toLowerCase();
    const modelTokens = [...baseName.split(/[\s/,-]+/), ...parenContent.split(/[\s/,-]+/)]
      .map((t) => t.trim())
      .filter((t) => t.length >= 3 && !stopTokens.has(t) && t !== '4d56');

    // Include explicit short model tokens like 'gt', 'xl7', 'apv', 'br-v', 'cr-v', 'hr-v'
    const exactBase = baseName.replace(/\s+/g, ' ');
    const matchedBase = exactBase.length >= 2 && new RegExp(`\\b${exactBase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q);
    const matchedToken = modelTokens.some((tok) =>
      new RegExp(`\\b${tok.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(q)
    );

    if (matchedBase || matchedToken) {
      results.push(entry);
    }
  }
  return results;
}

/**
 * Brand-by-Brand OEM Bench Test Scenarios Database.
 * - Batch 1: Toyota (PH Market — Vios, Hilux, Fortuner, Innova, Yaris, Avanza, Altis).
 * - Batch 2: Ford (PH Market — Ranger, Everest, EcoSport, Fiesta, Territory).
 * - Batch 3: Mitsubishi (PH Market — Montero Sport, Strada, L300, Mirage/Mirage G4, Xpander, Lancer EX).
 * - Batch 4: Nissan (PH Market — Navara, Terra, Almera, Urvan NV350, Sylphy, Juke, X-Trail).
 * - Batch 5: Isuzu (PH Market — D-Max, mu-X, Traviz, N-Series).
 * - Batch 6: Hyundai (PH Market — Accent CRDi/Gas, Starex / Staria, Tucson, Reina, Elantra).
 * - Batch 7: Suzuki (PH Market — Ertiga, Swift, Dzire, Celerio, Jimny, S-Presso).
 * - Batch 8: Honda (PH Market — City, Civic, BR-V, CR-V, Brio).
 */
export const BENCH_TEST_SCENARIOS: BenchTestScenarioEntry[] = [
  {
    id: 'scenario-toyota-1',
    scenarioNumber: 1,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Vios 1NR-FE / 2NR-FE)',
    dtcCode: 'P0351 – P0354',
    faultDescription: 'Ignition Coil "A"–"D" Primary/Secondary Circuit',
    benchSimulationSetup:
      'Disconnect IGF (Ignition Confirmation) return line or pull coil trigger load on bench simulator.',
    expectedEcuBehavior:
      'ECU sets code within 2–3 crank/run cycles and cuts fuel injector pulse to the affected cylinder.',
    recommendedPinId: 'ecu-pin-11',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Toyota #1: Ignition Coil / IGF Open (P0351–P0354)',
  },
  {
    id: 'scenario-toyota-2',
    scenarioNumber: 2,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Hilux / Fortuner 1GD-FTV / 2GD-FTV)',
    dtcCode: 'P0087',
    faultDescription: 'Fuel Rail/System Pressure - Too Low',
    benchSimulationSetup:
      'Lower the fuel rail pressure sensor signal voltage below 0.5V (simulating < 20 MPa at idle) using a potentiometer.',
    expectedEcuBehavior:
      'ECU enters limp mode, caps RPM, and increases Suction Control Valve (SCV) duty cycle to compensate.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Toyota #2: Fuel Rail Pressure Low <0.5V (P0087)',
  },
  {
    id: 'scenario-toyota-3',
    scenarioNumber: 3,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Hilux / Fortuner / Innova 2KD / 1GD)',
    dtcCode: 'P0400',
    faultDescription: 'Exhaust Gas Recirculation Flow',
    benchSimulationSetup:
      'Set EGR position sensor feedback voltage static while commanding EGR stepper/DC motor movement.',
    expectedEcuBehavior:
      'ECU flags flow deviation fault and disables EGR motor driver output until key cycle.',
    recommendedPinId: 'ecu-pin-9',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Toyota #3: EGR Position Feedback Deviation (P0400)',
  },
  {
    id: 'scenario-toyota-4',
    scenarioNumber: 4,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Vios / Yaris / Avanza)',
    dtcCode: 'P0102',
    faultDescription: 'Mass or Volume Air Flow "A" Circuit Low',
    benchSimulationSetup:
      'Drop MAF sensor signal frequency/voltage below 0.2V (open circuit simulation).',
    expectedEcuBehavior:
      'ECU switches to fail-safe alpha-N (TPS/RPM) fueling map; air-fuel trim calculation freezes.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Toyota #4: MAF Signal Open <0.2V (P0102)',
  },
  {
    id: 'scenario-toyota-5',
    scenarioNumber: 5,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Vios / Innova 1TR-FE)',
    dtcCode: 'P2118',
    faultDescription: 'Throttle Actuator Control Motor Current Range',
    benchSimulationSetup:
      'Open the dedicated ETCS (Electronic Throttle Control System) power supply fuse/pin on the bench harness.',
    expectedEcuBehavior:
      'ECU immediately cuts power to the throttle motor driver; throttle plate snaps to default mechanical limp angle (~7°).',
    recommendedPinId: 'ecu-pin-12',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Toyota #5: ETCS Power Supply Fuse Open (P2118)',
  },
  {
    id: 'scenario-toyota-6',
    scenarioNumber: 6,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (All Toyota Gasoline & Diesel)',
    dtcCode: 'P0500',
    faultDescription: 'Vehicle Speed Sensor "A"',
    benchSimulationSetup:
      'Cut or ground the SPD (Vehicle Speed) pulse input signal from the ABS/combination meter simulator while simulating RPM > 2000.',
    expectedEcuBehavior:
      'ECU registers speed mismatch after ~10 seconds of simulated drive load; disables overdrive/top gear lockup.',
    recommendedPinId: 'ecu-pin-13',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Toyota #6: SPD Pulse Signal Grounded (P0500)',
  },
  {
    id: 'scenario-toyota-7',
    scenarioNumber: 7,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / ECM (Vios CVT / Altis)',
    dtcCode: 'P2757',
    faultDescription: 'Torque Converter Clutch Pressure Control Solenoid',
    benchSimulationSetup:
      'Introduce high resistance (> 25 Ω) or open circuit on the SLU (Lock-Up) linear solenoid load resistor.',
    expectedEcuBehavior:
      'Module detects current draw anomaly on the PWM driver and forces transmission into hydraulic fail-safe (fixed gear ratio).',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Toyota #7: SLU Solenoid High Resistance >25Ω (P2757)',
  },
  {
    id: 'scenario-toyota-8',
    scenarioNumber: 8,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / ECM (Fortuner / Hilux 6-Speed AT)',
    dtcCode: 'P0751',
    faultDescription: 'Shift Solenoid "A" Performance / Stuck Off',
    benchSimulationSetup:
      'Leave solenoid coil electrically connected, but fail to trigger the corresponding hydraulic pressure switch feedback input.',
    expectedEcuBehavior:
      'TCM logs mechanical/hydraulic performance fault on the 2nd consecutive drive cycle and locks transmission in 3rd/4th gear.',
    recommendedPinId: 'ecu-pin-16',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Toyota #8: Shift Solenoid A Pressure Feedback Fault (P0751)',
  },
  {
    id: 'scenario-toyota-9',
    scenarioNumber: 9,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'ABS / VSC ECU (Hilux / Fortuner / Vios)',
    dtcCode: 'C0200 / C0205',
    faultDescription: 'Right/Left Front Wheel Speed Sensor Signal',
    benchSimulationSetup:
      'Inject a noisy AC/square wave signal or drop signal amplitude below 0.1V on the FR/FL wheel speed inputs.',
    expectedEcuBehavior:
      'ABS module illuminates warning flag over CAN bus and disables ABS/VSC/TRC solenoid relay drivers.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Toyota #9: Front Wheel Speed Sensor Drop <0.1V (C0200/C0205)',
  },
  {
    id: 'scenario-toyota-10',
    scenarioNumber: 10,
    brandKey: 'toyota',
    brandLabel: 'Toyota',
    market: 'PH Market',
    targetModuleAndModels: 'Airbag SRS ECU (All Toyota Models)',
    dtcCode: 'B1801',
    faultDescription: 'Driving Side Squib Circuit Open',
    benchSimulationSetup:
      'Replace the standard 2.2 Ω simulator resistor on the driver airbag squib pins with an open circuit (or > 6 Ω).',
    expectedEcuBehavior:
      'SRS ECU immediately logs an active fault in EEPROM and broadcasts SRS warning lamp ON via CAN.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Toyota #10: Driver Airbag Squib Circuit Open >6Ω (B1801)',
  },
  // Batch 2: Ford (PH Market — Ranger, Everest, EcoSport, Fiesta, Territory)
  {
    id: 'scenario-ford-1',
    scenarioNumber: 1,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'BCM (Body Control Module - Ranger / Everest T6 & Next-Gen)',
    dtcCode: 'U3000:49',
    faultDescription: 'Control Module - Internal Electronic Failure',
    benchSimulationSetup:
      'Simulate low battery cranking voltage drop (< 8.5V) during bench boot-up or inject corrupted EEPROM checksum sector.',
    expectedEcuBehavior:
      'BCM locks out specific high-side FET outputs (e.g., low beam headlights or washer pump) permanently until flash/counter reset.',
    recommendedPinId: 'ecu-pin-3',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Ford #1: BCM Undervoltage Drop / Internal Lockout (U3000:49)',
  },
  {
    id: 'scenario-ford-2',
    scenarioNumber: 2,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'PCM / BCM (Ranger / Everest / EcoSport)',
    dtcCode: 'U0100',
    faultDescription: 'Lost Communication With ECM/PCM "A"',
    benchSimulationSetup:
      'Disconnect HS-CAN (High-Speed CAN) high or low line between the PCM and BCM/Gateway on the bench breakout box.',
    expectedEcuBehavior:
      'Dependent modules log loss-of-communication flags within 500ms; instrument cluster simulator drops RPM/temp gauges.',
    recommendedPinId: 'ecu-pin-13',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Ford #2: HS-CAN Line Open / Lost PCM Comm (U0100)',
  },
  {
    id: 'scenario-ford-3',
    scenarioNumber: 3,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'TCM (EcoSport / Fiesta 6DCT250 PowerShift)',
    dtcCode: 'P07A3 / P07A5',
    faultDescription: 'Transmission Friction Element "A" / "B" Stuck On',
    benchSimulationSetup:
      'Hold clutch fork position hall-effect sensor signal static while TCM commands clutch actuator motor sweep.',
    expectedEcuBehavior:
      'TCM flags mechanical/actuator correlation fault, disables odd or even gear engagement, and triggers "Transmission Malfunction" message.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Ford #3: PowerShift Clutch Fork Hall Signal Static (P07A3/P07A5)',
  },
  {
    id: 'scenario-ford-4',
    scenarioNumber: 4,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'TCM (EcoSport / Fiesta 6DCT250 PowerShift)',
    dtcCode: 'P0606',
    faultDescription: 'Control Module Processor',
    benchSimulationSetup:
      'Introduce voltage ripple (> 1.5V AC) on the TCM 12V main power supply pin under load.',
    expectedEcuBehavior:
      'Internal watchdog resets TCM microprocessor; module drops off CAN bus briefly and logs internal processor fault.',
    recommendedPinId: 'ecu-pin-4',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Ford #4: TCM 12V Supply Ripple / Watchdog Reset (P0606)',
  },
  {
    id: 'scenario-ford-5',
    scenarioNumber: 5,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (Ranger / Everest 2.2L & 3.2L Duratorq)',
    dtcCode: 'P0089',
    faultDescription: 'Fuel Pressure Regulator 1 Performance',
    benchSimulationSetup:
      'Create a > 15 MPa discrepancy between commanded VCV (Volume Control Valve) PWM duty cycle and simulated FRP sensor voltage.',
    expectedEcuBehavior:
      'PCM limits fuel rail pressure target, enters limp mode (capped at ~2,500 RPM), and disables turbo boost solenoid duty.',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Ford #5: VCV / FRP Pressure Performance Mismatch (P0089)',
  },
  {
    id: 'scenario-ford-6',
    scenarioNumber: 6,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (Ranger / Everest 2.0L Bi-Turbo / Single Turbo)',
    dtcCode: 'P0299',
    faultDescription: 'Turbocharger/Supercharger "A" Underboost',
    benchSimulationSetup:
      'Hold MAP (Manifold Absolute Pressure) sensor voltage below 1.8V while simulating high engine load and boost solenoid actuation.',
    expectedEcuBehavior:
      'PCM detects boost deviation after ~5 seconds under simulated load and disables VGT/wastegate actuator control.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Ford #6: MAP Below 1.8V Under Boost Load (P0299)',
  },
  {
    id: 'scenario-ford-7',
    scenarioNumber: 7,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (Ranger / Everest 2.2L / 3.2L / 2.0L)',
    dtcCode: 'P0405',
    faultDescription: 'Exhaust Gas Recirculation Sensor "A" Circuit Low',
    benchSimulationSetup:
      'Pull the EGR valve position feedback signal pin to ground (< 0.15V) on the bench harness.',
    expectedEcuBehavior:
      'PCM immediately logs low-input circuit fault, sets EGR commanded position to 0%, and illuminates MIL.',
    recommendedPinId: 'ecu-pin-9',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Ford #7: EGR Position Feedback Grounded <0.15V (P0405)',
  },
  {
    id: 'scenario-ford-8',
    scenarioNumber: 8,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'TCM (Ranger / Everest 6R80 6-Speed AT)',
    dtcCode: 'P0720 / P0722',
    faultDescription: 'Output Shaft Speed (OSS) Sensor Circuit No Signal',
    benchSimulationSetup:
      'Cut or ground the OSS hall-effect square-wave signal input on the lead-frame simulator harness.',
    expectedEcuBehavior:
      'TCM loses output speed reference, forces transmission into 3rd or 5th gear hydraulic limp mode, and disables torque converter lockup.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Ford #8: 6R80 OSS Hall Signal Open / No Signal (P0720/P0722)',
  },
  {
    id: 'scenario-ford-9',
    scenarioNumber: 9,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'ABS / DSC Module (Ranger / Everest / EcoSport)',
    dtcCode: 'C0034 / C0037',
    faultDescription: 'Right Front / Left Rear Wheel Speed Sensor',
    benchSimulationSetup:
      'Open-circuit the active magneto-resistive wheel speed sensor loop (current drops outside 7mA–14mA normal window).',
    expectedEcuBehavior:
      'ABS module immediately sets active sensor circuit fault and broadcasts ABS/Traction Control/Hill Descent disable flags over CAN.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Ford #9: Active WSS Loop Open Outside 7–14mA (C0034/C0037)',
  },
  {
    id: 'scenario-ford-10',
    scenarioNumber: 10,
    brandKey: 'ford',
    brandLabel: 'Ford',
    market: 'PH Market',
    targetModuleAndModels: 'RCM (Restraints Control Module - All Ford Models)',
    dtcCode: 'B0001:13',
    faultDescription: 'Driver Frontal Stage 1 Deployment Control - Circuit Open',
    benchSimulationSetup:
      'Remove the 2.2 Ω load resistor from the Stage 1 driver squib pins on the bench breakout harness.',
    expectedEcuBehavior:
      'RCM detects open squib loop on startup self-test (< 2 seconds) and commands the airbag warning indicator ON.',
    recommendedPinId: 'ecu-pin-11',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Ford #10: Stage 1 Driver Squib 2.2Ω Resistor Open (B0001:13)',
  },
  // Batch 3: Mitsubishi (PH Market — Montero Sport, Strada, L300, Mirage/Mirage G4, Xpander, Lancer EX)
  {
    id: 'scenario-mitsubishi-1',
    scenarioNumber: 1,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Montero Sport / Strada 4D56 & 4N15)',
    dtcCode: 'P0089 / P0629',
    faultDescription: 'Suction Control Valve (SCV) / Fuel Pump Control Circuit',
    benchSimulationSetup:
      'Introduce high resistance (> 15 Ω) or open circuit on the SCV PWM low-side driver pin on the bench load box.',
    expectedEcuBehavior:
      'ECM cuts SCV duty cycle, sets rail pressure fault, and limits engine speed to ~2,000 RPM limp mode.',
    recommendedPinId: 'ecu-pin-16',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Mitsubishi #1: SCV PWM High Resistance >15Ω (P0089/P0629)',
  },
  {
    id: 'scenario-mitsubishi-2',
    scenarioNumber: 2,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Montero Sport / Strada 4N15 MIVEC)',
    dtcCode: 'P0093',
    faultDescription: 'Fuel System Leak Detected - Large Leak',
    benchSimulationSetup:
      'Drop simulated Fuel Rail Pressure (FRP) sensor voltage rapidly (> 30 MPa drop within 1 second) under high simulated RPM.',
    expectedEcuBehavior:
      'ECM immediately cuts injector firing pulses (engine stall simulation) and latches a hard rail-leak DTC.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Mitsubishi #2: FRP Rapid Drop >30 MPa / Large Leak (P0093)',
  },
  {
    id: 'scenario-mitsubishi-3',
    scenarioNumber: 3,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Montero Sport / Strada / L300 Euro 4)',
    dtcCode: 'P0401 / P0403',
    faultDescription: 'EGR Flow Insufficient / EGR Control Circuit',
    benchSimulationSetup:
      'Disconnect the DC EGR motor coil load or freeze the EGR lift sensor feedback voltage during duty-cycle sweep.',
    expectedEcuBehavior:
      'ECM disables EGR motor H-bridge driver, logs emission fault, and restricts turbo boost targets.',
    recommendedPinId: 'ecu-pin-9',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Mitsubishi #3: DC EGR Motor / Lift Sensor Fault (P0401/P0403)',
  },
  {
    id: 'scenario-mitsubishi-4',
    scenarioNumber: 4,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Montero Sport / Strada 4D56 / 4N15)',
    dtcCode: 'P1272 / P0088',
    faultDescription: 'Fuel Rail Pressure Relief Valve / Too High',
    benchSimulationSetup:
      'Raise FRP sensor input voltage above 4.3V (simulating > 200 MPa) while holding SCV duty cycle at minimum.',
    expectedEcuBehavior:
      'ECM enters severe limp mode, triggers check engine lamp, and commands full fuel-cut if voltage exceeds 4.5V.',
    recommendedPinId: 'ecu-pin-5',
    recommendedFaultType: 'SHORT_TO_VBAT',
    faultPresetLabel: 'Mitsubishi #4: FRP Overpressure >4.3V / >200 MPa (P1272/P0088)',
  },
  {
    id: 'scenario-mitsubishi-5',
    scenarioNumber: 5,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Mirage / Mirage G4 3A92 & Xpander 4A91)',
    dtcCode: 'P0606',
    faultDescription: 'ECM/PCM Processor Internal Fault',
    benchSimulationSetup:
      'Inject brief voltage drop (< 6.5V for 200ms) on the main ignition-switched +12V pin while simulating crank/cam signals.',
    expectedEcuBehavior:
      'Internal watchdog detects processor logic mismatch, resets fuel/ignition drivers, and logs internal CPU error.',
    recommendedPinId: 'ecu-pin-4',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Mitsubishi #5: KL15 +12V Drop <6.5V Watchdog Reset (P0606)',
  },
  {
    id: 'scenario-mitsubishi-6',
    scenarioNumber: 6,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Mirage / Xpander / Lancer EX)',
    dtcCode: 'P0122 / P0223',
    faultDescription: 'Throttle Position Sensor (TPS) Sub/Main Circuit Range',
    benchSimulationSetup:
      'Cross-short TPS1 and TPS2 analog return lines or pull TPS1 below 0.2V on the electronic throttle simulator.',
    expectedEcuBehavior:
      'ECM immediately shuts down the throttle actuator motor relay, locking throttle plate at ~6° mechanical fail-safe.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Mitsubishi #6: TPS1/TPS2 Sub/Main Range Fault <0.2V (P0122/P0223)',
  },
  {
    id: 'scenario-mitsubishi-7',
    scenarioNumber: 7,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / CVT-ECU (Mirage / Mirage G4 / Lancer CVT)',
    dtcCode: 'P0868 / P0746',
    faultDescription: 'Secondary Fluid Pressure Low / Pressure Control Solenoid "A"',
    benchSimulationSetup:
      'Hold secondary pressure sensor input below 0.8V while commanding line pressure solenoid current to maximum.',
    expectedEcuBehavior:
      'CVT module sets hydraulic fail-safe mode, locks pulley ratio to low/safe gear, and flashes "D" or warning indicator over CAN.',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Mitsubishi #7: CVT Secondary Fluid Pressure Low <0.8V (P0868/P0746)',
  },
  {
    id: 'scenario-mitsubishi-8',
    scenarioNumber: 8,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'TCM (Montero Sport 8-Speed AT / Strada 5-Speed AT)',
    dtcCode: 'P0715 / P0720',
    faultDescription: 'Input/Turbine Speed Sensor or Output Speed Sensor Circuit',
    benchSimulationSetup:
      'Cut or ground the Hall-effect square-wave signal on the input or output shaft speed pin on the bench harness.',
    expectedEcuBehavior:
      'TCM loses gear-ratio calculation, locks transmission into 3rd or 4th gear limp mode, and disables manual/paddle shift mode.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Mitsubishi #8: Turbine/Output Speed Hall Grounded (P0715/P0720)',
  },
  {
    id: 'scenario-mitsubishi-9',
    scenarioNumber: 9,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ETACS-ECU (Body Control - Montero / Strada / Xpander)',
    dtcCode: 'U0141 / B1A25',
    faultDescription: 'Lost Communication with ETACS / Immobilizer Key Error',
    benchSimulationSetup:
      'Disconnect B-CAN line between ECM and ETACS or leave transponder antenna coil open-circuit during ignition-ON simulation.',
    expectedEcuBehavior:
      'ETACS blocks starter relay ground trigger and sends fuel-cut inhibit message to ECM via CAN bus.',
    recommendedPinId: 'ecu-pin-13',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Mitsubishi #9: ETACS B-CAN / Transponder Open (U0141/B1A25)',
  },
  {
    id: 'scenario-mitsubishi-10',
    scenarioNumber: 10,
    brandKey: 'mitsubishi',
    brandLabel: 'Mitsubishi',
    market: 'PH Market',
    targetModuleAndModels: 'ABS / ASC-ECU (Montero Sport / Strada / Xpander)',
    dtcCode: 'C1011 / C1022',
    faultDescription: 'Front Right / Rear Left Wheel Speed Sensor Circuit',
    benchSimulationSetup:
      'Open-circuit or short-to-ground the active wheel speed sensor current loop on the ABS bench breakout box.',
    expectedEcuBehavior:
      'ABS module disables ABS, Active Stability Control (ASC), and Hill Start Assist, broadcasting warning flags over CAN.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Mitsubishi #10: Active WSS Loop Open / Grounded (C1011/C1022)',
  },
  // Batch 4: Nissan (PH Market — Navara, Terra, Almera, Urvan NV350, Sylphy, Juke, X-Trail)
  {
    id: 'scenario-nissan-1',
    scenarioNumber: 1,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / CVT-ECU (Almera / Sylphy / Juke RE0F11A CVT)',
    dtcCode: 'P1778',
    faultDescription: 'Step Motor Function',
    benchSimulationSetup:
      'Open-circuit or introduce high resistance (> 30 Ω) on one of the 4 stepper motor coil driver pins on the bench load box.',
    expectedEcuBehavior:
      'TCM detects coil current mismatch, locks pulley ratio into mechanical fail-safe mode, and disables manual/sport mode.',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Nissan #1: CVT Step Motor Coil High Resistance >30Ω (P1778)',
  },
  {
    id: 'scenario-nissan-2',
    scenarioNumber: 2,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / CVT-ECU (Almera / X-Trail / Sylphy CVT)',
    dtcCode: 'P0868 / P0746',
    faultDescription: 'Secondary Fluid Pressure Low / Pressure Control Solenoid "A"',
    benchSimulationSetup:
      'Hold secondary pressure sensor input below 0.7V while commanding line pressure solenoid PWM duty cycle to maximum.',
    expectedEcuBehavior:
      'TCM forces hydraulic limp mode, illuminates MIL via CAN request to ECM, and prevents torque converter lockup.',
    recommendedPinId: 'ecu-pin-16',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Nissan #2: CVT Secondary Pressure Low <0.7V (P0868/P0746)',
  },
  {
    id: 'scenario-nissan-3',
    scenarioNumber: 3,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Navara NP300 / Terra YD25DDTi)',
    dtcCode: 'P0089 / P1275',
    faultDescription: 'Fuel Pump / Suction Control Valve (SCV) Control Function',
    benchSimulationSetup:
      'Create > 15 MPa discrepancy between commanded SCV current duty cycle and simulated Fuel Rail Pressure (FRP) sensor voltage.',
    expectedEcuBehavior:
      'ECM enters limp mode (caps engine speed at ~2,000–2,500 RPM) and disables VGT turbo boost control solenoid.',
    recommendedPinId: 'ecu-pin-12',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Nissan #3: YD25 SCV / FRP Pressure Mismatch (P0089/P1275)',
  },
  {
    id: 'scenario-nissan-4',
    scenarioNumber: 4,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Urvan NV350 / Navara YD25DDTi)',
    dtcCode: 'P0234 / P0299',
    faultDescription: 'Turbocharger Overboost / Underboost Condition',
    benchSimulationSetup:
      'Hold Boost Pressure Sensor voltage static (< 1.5V or > 4.2V) while varying simulated RPM and throttle load on the bench.',
    expectedEcuBehavior:
      'ECM logs boost deviation fault after ~5 seconds under load and cuts PWM duty to the electronic turbo actuator / vacuum solenoid.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Nissan #4: Static Boost Sensor <1.5V Under Load (P0234/P0299)',
  },
  {
    id: 'scenario-nissan-5',
    scenarioNumber: 5,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Navara / Terra / Urvan NV350)',
    dtcCode: 'P0403 / P0409',
    faultDescription: 'Exhaust Gas Recirculation Control Circuit / Sensor "A"',
    benchSimulationSetup:
      'Disconnect the DC EGR motor load or pull the EGR position feedback voltage to ground (< 0.15V) on the breakout harness.',
    expectedEcuBehavior:
      'ECM immediately cuts H-bridge motor driver power, logs active emission fault, and sets EGR target position to 0%.',
    recommendedPinId: 'ecu-pin-9',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Nissan #5: EGR Feedback Grounded <0.15V (P0403/P0409)',
  },
  {
    id: 'scenario-nissan-6',
    scenarioNumber: 6,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Almera / Urvan / Navara)',
    dtcCode: 'P0102 / P0103',
    faultDescription: 'Mass Air Flow (MAF) Sensor Circuit Low / High',
    benchSimulationSetup:
      'Drop MAF sensor analog output voltage below 0.3V (open circuit) or pull above 4.8V (short to 5V reference).',
    expectedEcuBehavior:
      'ECM switches to fail-safe alpha-N (TPS/RPM) fueling calculation and caps maximum RPM at ~2,400 RPM.',
    recommendedPinId: 'ecu-pin-5',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Nissan #6: MAF Signal Open <0.3V / High >4.8V (P0102/P0103)',
  },
  {
    id: 'scenario-nissan-7',
    scenarioNumber: 7,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (All Nissan Electronic Throttle Models)',
    dtcCode: 'P1122 / P2135',
    faultDescription: 'Electric Throttle Control Function / TPS Correlation',
    benchSimulationSetup:
      'Cross-short TPS1 and TPS2 analog return pins or open the throttle motor power relay pin on the bench harness.',
    expectedEcuBehavior:
      'ECM immediately cuts power to the throttle actuator driver, allowing the return spring to lock the plate at ~6° fail-safe angle.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Nissan #7: ETC Relay Open / TPS Correlation Fault (P1122/P2135)',
  },
  {
    id: 'scenario-nissan-8',
    scenarioNumber: 8,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'BCM / IPDM E/R (Navara / Terra / Almera)',
    dtcCode: 'U1000 / B2193',
    faultDescription: 'CAN Communication Circuit / NATS Chain of ECM-IMMU',
    benchSimulationSetup:
      'Disconnect the CAN-H or CAN-L line between the ECM, BCM, and IPDM, or leave the NATS immobilizer antenna coil open-circuit.',
    expectedEcuBehavior:
      'BCM/IPDM blocks starter relay ground trigger and broadcasts security/immobilizer fuel-cut inhibit over CAN.',
    recommendedPinId: 'ecu-pin-13',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Nissan #8: CAN-H / NATS IMMU Chain Open (U1000/B2193)',
  },
  {
    id: 'scenario-nissan-9',
    scenarioNumber: 9,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'ABS Actuator & Electric Unit (Navara / Terra / Almera)',
    dtcCode: 'C1101 – C1104',
    faultDescription: 'Front/Rear Wheel Speed Sensor Circuit',
    benchSimulationSetup:
      'Open-circuit or short-to-ground the active wheel speed sensor current loop on the ABS bench simulator box.',
    expectedEcuBehavior:
      'ABS ECU disables ABS, EBD, and Vehicle Dynamic Control (VDC), broadcasting warning lamp flags over CAN.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Nissan #9: Active WSS Current Loop Open (C1101–C1104)',
  },
  {
    id: 'scenario-nissan-10',
    scenarioNumber: 10,
    brandKey: 'nissan',
    brandLabel: 'Nissan',
    market: 'PH Market',
    targetModuleAndModels: 'Airbag Diagnosis Sensor Unit (All Nissan Models)',
    dtcCode: 'B1049 / B1054',
    faultDescription: 'Driver Airbag Module Open Circuit',
    benchSimulationSetup:
      'Replace the 2.2 Ω squib simulator resistor on the driver frontal airbag pins with an open circuit (> 6 Ω).',
    expectedEcuBehavior:
      'SRS module immediately logs active fault in EEPROM and sends airbag warning indicator ON signal over CAN.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Nissan #10: Driver Airbag Squib Open >6Ω (B1049/B1054)',
  },
  // Batch 5: Isuzu (PH Market — D-Max, mu-X, Traviz, N-Series)
  {
    id: 'scenario-isuzu-1',
    scenarioNumber: 1,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (D-Max / mu-X 4JJ1-TCX & 4JK1-TC)',
    dtcCode: 'P0087 / P1093',
    faultDescription: 'Fuel Rail/System Pressure - Too Low',
    benchSimulationSetup:
      'Lower the simulated Fuel Rail Pressure (FRP) sensor voltage below 0.5V while commanding high RPM load on the crank/cam simulator.',
    expectedEcuBehavior:
      'ECM enters derate/limp mode, caps engine RPM, and drives Suction Control Valve (SCV) PWM duty cycle to maximum.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Isuzu #1: FRP Sensor Low <0.5V Under Load (P0087/P1093)',
  },
  {
    id: 'scenario-isuzu-2',
    scenarioNumber: 2,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (D-Max / mu-X / N-Series 4JJ1 / 4HK1)',
    dtcCode: 'P0089 / P0091',
    faultDescription: 'Fuel Pressure Regulator (SCV) Performance / Circuit Low',
    benchSimulationSetup:
      'Introduce high resistance (> 15 Ω) or short-to-ground on the SCV low-side driver pin on the bench load box.',
    expectedEcuBehavior:
      'ECM cuts SCV current control, logs Flash Code 151/247, and restricts fuel injection quantity.',
    recommendedPinId: 'ecu-pin-16',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Isuzu #2: SCV Driver High Resistance >15Ω / Flash 151/247 (P0089/P0091)',
  },
  {
    id: 'scenario-isuzu-3',
    scenarioNumber: 3,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (D-Max / mu-X / Traviz 4JA1 / 4JJ3)',
    dtcCode: 'P0404 / P0409',
    faultDescription: 'EGR Control Circuit Range / Sensor Circuit',
    benchSimulationSetup:
      'Freeze the EGR valve position sensor analog feedback voltage while sweeping the DC EGR motor PWM output.',
    expectedEcuBehavior:
      'ECM detects position-command mismatch (Flash Code 44/45), disables EGR motor H-bridge output, and illuminates MIL.',
    recommendedPinId: 'ecu-pin-9',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Isuzu #3: EGR Position Mismatch / Flash 44/45 (P0404/P0409)',
  },
  {
    id: 'scenario-isuzu-4',
    scenarioNumber: 4,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (D-Max / mu-X 4JJ1 / RZ4E)',
    dtcCode: 'P0234 / P0045',
    faultDescription: 'Turbocharger Overboost / Boost Control Solenoid Circuit',
    benchSimulationSetup:
      'Hold Boost/MAP sensor voltage above 4.2V under simulated load, or open-circuit the VGT actuator/solenoid coil load.',
    expectedEcuBehavior:
      'ECM logs Flash Code 42/33, cuts boost actuator PWM duty to 0%, and caps maximum fuel delivery.',
    recommendedPinId: 'ecu-pin-12',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Isuzu #4: VGT Boost Solenoid Open / Overboost (P0234/P0045)',
  },
  {
    id: 'scenario-isuzu-5',
    scenarioNumber: 5,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (All Isuzu Common Rail Models)',
    dtcCode: 'P1261 / P1262',
    faultDescription: 'Injection Nozzle Common 1 / 2 Drive System Fault',
    benchSimulationSetup:
      'Open-circuit or short-to-ground one of the injector bank high-side boost capacitor driver lines (Cylinders 1&4 or 2&3).',
    expectedEcuBehavior:
      'ECM immediately shuts down the affected injector bank driver (Flash Code 34) to protect the internal DC-DC boost converter.',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Isuzu #5: Injector Common 1/2 Bank Open / Flash 34 (P1261/P1262)',
  },
  {
    id: 'scenario-isuzu-6',
    scenarioNumber: 6,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (D-Max / mu-X / N-Series)',
    dtcCode: 'P0016 / P0340',
    faultDescription: 'Crankshaft-Camshaft Correlation / Cam Sensor No Signal',
    benchSimulationSetup:
      'Phase-shift the simulated Camshaft (CMP) square wave by > 15° relative to the Crankshaft (CKP) missing-tooth signal, or drop CMP signal.',
    expectedEcuBehavior:
      'ECM logs Flash Code 16 or 14, switches to crank-only limp synchronization, and delays injector firing.',
    recommendedPinId: 'ecu-pin-11',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Isuzu #6: CKP-CMP Phase Shift / CMP No Signal (P0016/P0340)',
  },
  {
    id: 'scenario-isuzu-7',
    scenarioNumber: 7,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (D-Max / mu-X / Traviz)',
    dtcCode: 'P0102 / P0103',
    faultDescription: 'Mass Air Flow (MAF) Sensor Circuit Low / High',
    benchSimulationSetup:
      'Drop MAF sensor signal frequency/voltage below 0.2V (open circuit) or pull above 4.8V on the bench breakout box.',
    expectedEcuBehavior:
      'ECM sets Flash Code 91, ignores MAF input, and reverts to default barometric/boost-based airflow estimation.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Isuzu #7: MAF Signal Low <0.2V / Flash 91 (P0102/P0103)',
  },
  {
    id: 'scenario-isuzu-8',
    scenarioNumber: 8,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (All Isuzu Electronic Diesel Models)',
    dtcCode: 'P0606 / P0601',
    faultDescription: 'ECM Processor / Internal Memory Checksum Error',
    benchSimulationSetup:
      'Simulate cranking voltage sag (< 6.5V for 250ms) on the main +12V battery feed or inject corrupted EEPROM checksum sector.',
    expectedEcuBehavior:
      'Internal watchdog resets main CPU (Flash Code 51/53), inhibits injector/SCV outputs, and flags critical ECU fault.',
    recommendedPinId: 'ecu-pin-3',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Isuzu #8: Cranking Sag <6.5V / Watchdog Reset (P0606/P0601)',
  },
  {
    id: 'scenario-isuzu-9',
    scenarioNumber: 9,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'TCM (D-Max / mu-X 6-Speed Aisin AT)',
    dtcCode: 'P0751 – P0775',
    faultDescription: 'Shift Solenoid Performance / Valve Body Solenoid Circuit',
    benchSimulationSetup:
      'Open-circuit a shift solenoid load resistor or fail to toggle the corresponding transmission fluid pressure switch input.',
    expectedEcuBehavior:
      'TCM enters hydraulic fail-safe mode, locks transmission into 3rd gear, and disables manual shift mode.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Isuzu #9: Aisin 6AT Shift Solenoid / Pressure Switch Open (P0751–P0775)',
  },
  {
    id: 'scenario-isuzu-10',
    scenarioNumber: 10,
    brandKey: 'isuzu',
    brandLabel: 'Isuzu',
    market: 'PH Market',
    targetModuleAndModels: 'ABS / ESC Control Module (D-Max / mu-X)',
    dtcCode: 'C0031 – C0040',
    faultDescription: 'Front/Rear Wheel Speed Sensor Circuit',
    benchSimulationSetup:
      'Open-circuit or short-to-ground the active magneto-resistive wheel speed sensor loop on the ABS bench simulator.',
    expectedEcuBehavior:
      'ABS ECU immediately disables ABS, Traction Control, and ESC, broadcasting warning lamp ON flags via CAN bus.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Isuzu #10: Active WSS Loop Open / Grounded (C0031–C0040)',
  },
  // Batch 6: Hyundai (PH Market — Accent CRDi/Gas, Starex / Staria, Tucson, Reina, Elantra)
  {
    id: 'scenario-hyundai-1',
    scenarioNumber: 1,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Accent / Starex / Tucson CRDi U2 & A2)',
    dtcCode: 'P0087 / P1186',
    faultDescription: 'Fuel Rail/System Pressure - Too Low at Monitoring',
    benchSimulationSetup:
      'Lower the simulated Fuel Rail Pressure (FRP) sensor voltage below 0.5V while simulating engine load (> 2,000 RPM).',
    expectedEcuBehavior:
      'ECM enters limp mode (caps engine speed at ~2,800 RPM) and drives the Rail Pressure Regulator Valve (RPCV) / IMV to maximum duty.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Hyundai #1: CRDi FRP Low <0.5V Under Load (P0087/P1186)',
  },
  {
    id: 'scenario-hyundai-2',
    scenarioNumber: 2,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Accent / Starex CRDi)',
    dtcCode: 'P0088 / P1185',
    faultDescription: 'Fuel Rail/System Pressure - Too High',
    benchSimulationSetup:
      'Raise FRP sensor input voltage above 4.3V while commanding minimum IMV/RPCV duty cycle on the bench load box.',
    expectedEcuBehavior:
      'ECM cuts injector firing pulses (engine stall simulation) to protect the rail and latches a hard overpressure DTC.',
    recommendedPinId: 'ecu-pin-5',
    recommendedFaultType: 'SHORT_TO_VBAT',
    faultPresetLabel: 'Hyundai #2: CRDi FRP Overpressure >4.3V (P0088/P1185)',
  },
  {
    id: 'scenario-hyundai-3',
    scenarioNumber: 3,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Accent / Starex / Tucson CRDi)',
    dtcCode: 'P0401 / P0404',
    faultDescription: 'Exhaust Gas Recirculation Flow / Control Circuit Range',
    benchSimulationSetup:
      'Hold the EGR position feedback voltage static while sweeping the DC EGR motor PWM output on the bench harness.',
    expectedEcuBehavior:
      'ECM detects position deviation, disables EGR motor H-bridge driver output, and illuminates MIL.',
    recommendedPinId: 'ecu-pin-9',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Hyundai #3: CRDi EGR Feedback Deviation (P0401/P0404)',
  },
  {
    id: 'scenario-hyundai-4',
    scenarioNumber: 4,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Accent / Starex CRDi VGT)',
    dtcCode: 'P0299 / P0234',
    faultDescription: 'Turbocharger Underboost / Overboost Condition',
    benchSimulationSetup:
      'Hold Boost Pressure Sensor (BPS) voltage static (< 1.5V or > 4.2V) during simulated high-load acceleration.',
    expectedEcuBehavior:
      'ECM logs boost control fault after ~5 seconds and cuts PWM duty to the electronic VGT actuator or vacuum solenoid.',
    recommendedPinId: 'ecu-pin-12',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Hyundai #4: Static BPS / VGT Boost Actuator Cut (P0299/P0234)',
  },
  {
    id: 'scenario-hyundai-5',
    scenarioNumber: 5,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Accent Gas / Reina / Elantra)',
    dtcCode: 'P0335 / P0340',
    faultDescription: 'Crankshaft / Camshaft Position Sensor "A" Circuit',
    benchSimulationSetup:
      'Drop the Crankshaft (CKP) inductive/Hall signal or phase-shift the Camshaft (CMP) square wave by > 15° on the bench simulator.',
    expectedEcuBehavior:
      'Dropping CKP immediately halts injector and ignition coil drivers; CMP loss forces extended cranking and batch-fire limp mode.',
    recommendedPinId: 'ecu-pin-11',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Hyundai #5: CKP Drop / CMP Phase Shift Fault (P0335/P0340)',
  },
  {
    id: 'scenario-hyundai-6',
    scenarioNumber: 6,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Accent / Reina / Tucson Gasoline)',
    dtcCode: 'P2110 / P2135',
    faultDescription: 'Throttle Actuator Control System - Forced Limited RPM / TPS Correlation',
    benchSimulationSetup:
      'Cross-short TPS1 and TPS2 analog feedback pins or open-circuit the Electronic Throttle Control (ETC) motor power feed.',
    expectedEcuBehavior:
      'ECM cuts power to the throttle actuator driver, locking the throttle plate at ~7° mechanical limp angle and capping RPM at ~1,500.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Hyundai #6: ETC Power / TPS Correlation Limp ~1500 RPM (P2110/P2135)',
  },
  {
    id: 'scenario-hyundai-7',
    scenarioNumber: 7,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / PCM (Accent / Elantra / Tucson 6-Speed AT)',
    dtcCode: 'P0717 / P0722',
    faultDescription: 'Input/Turbine Speed Sensor or Output Speed Sensor No Signal',
    benchSimulationSetup:
      'Cut or ground the Hall-effect square-wave signal on the input or output shaft speed pin on the transmission simulator harness.',
    expectedEcuBehavior:
      'TCM loses gear-ratio calculation, forces transmission into 3rd or 4th gear hydraulic fail-safe mode, and disables manual shift mode.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Hyundai #7: 6AT Input/Output Speed No Signal (P0717/P0722)',
  },
  {
    id: 'scenario-hyundai-8',
    scenarioNumber: 8,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / PCM (Accent / Starex AT)',
    dtcCode: 'P0741 / P0753',
    faultDescription: 'Torque Converter Clutch / Shift Solenoid "A" Electrical',
    benchSimulationSetup:
      'Open-circuit or introduce high resistance (> 25 Ω) on a shift solenoid or Damper Clutch Control Solenoid (DCCS) load resistor.',
    expectedEcuBehavior:
      'Module detects current draw anomaly on the low-side PWM driver and locks transmission into fail-safe gear.',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Hyundai #8: DCCS / Shift Solenoid A High Resistance >25Ω (P0741/P0753)',
  },
  {
    id: 'scenario-hyundai-9',
    scenarioNumber: 9,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'BCM / Smart Key Module (Accent / Tucson / Staria)',
    dtcCode: 'B1603 / U0140',
    faultDescription: 'CAN Communication Bus Off / Lost Communication with BCM',
    benchSimulationSetup:
      'Disconnect B-CAN / C-CAN lines between ECM and BCM or leave the immobilizer coil antenna open during ignition-ON simulation.',
    expectedEcuBehavior:
      'ECM blocks fuel injector/ignition coil enable flags (crank-no-start) and logs immobilizer/CAN communication fault.',
    recommendedPinId: 'ecu-pin-13',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Hyundai #9: B-CAN / C-CAN Bus Off & BCM Lost Comm (B1603/U0140)',
  },
  {
    id: 'scenario-hyundai-10',
    scenarioNumber: 10,
    brandKey: 'hyundai-kia',
    brandLabel: 'Hyundai',
    market: 'PH Market',
    targetModuleAndModels: 'ABS / ESC Module (Accent / Tucson / Starex)',
    dtcCode: 'C1200 – C1211',
    faultDescription: 'Front/Rear Wheel Speed Sensor Open or Short',
    benchSimulationSetup:
      'Open-circuit or short-to-ground the active magneto-resistive wheel speed sensor loop on the ABS bench breakout box.',
    expectedEcuBehavior:
      'ABS ECU disables ABS, EBD, and ESC systems, broadcasting warning lamp ON flags over the CAN bus.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Hyundai #10: Active WSS Loop Open / Short (C1200–C1211)',
  },
  // Batch 7: Suzuki (PH Market — Ertiga, Swift, Dzire, Celerio, Jimny, S-Presso)
  {
    id: 'scenario-suzuki-1',
    scenarioNumber: 1,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Ertiga / Swift / Jimny K15B & K12M)',
    dtcCode: 'P2119 / P2135',
    faultDescription: 'Throttle Actuator Control Throttle Body Range / TPS Correlation',
    benchSimulationSetup:
      'Cross-short TPS1 and TPS2 analog return lines or hold TPS feedback static while commanding throttle motor PWM.',
    expectedEcuBehavior:
      'ECM immediately cuts power to the Electronic Throttle Control (ETC) motor driver, locking the throttle plate at ~6° mechanical limp angle.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Suzuki #1: K15B/K12M ETC Range & TPS Correlation (P2119/P2135)',
  },
  {
    id: 'scenario-suzuki-2',
    scenarioNumber: 2,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Dzire / Celerio AGS / Swift)',
    dtcCode: 'P0335 / P0340',
    faultDescription: 'Crankshaft / Camshaft Position Sensor "A" Circuit',
    benchSimulationSetup:
      'Drop the Crankshaft (CKP) Hall-effect square wave or phase-shift the Camshaft (CMP) signal by > 15° on the bench simulator.',
    expectedEcuBehavior:
      'Dropping CKP immediately halts injector and coil firing; CMP loss forces extended cranking and batch-fire fail-safe synchronization.',
    recommendedPinId: 'ecu-pin-12',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Suzuki #2: CKP Signal Drop / CMP Phase Shift (P0335/P0340)',
  },
  {
    id: 'scenario-suzuki-3',
    scenarioNumber: 3,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (All Suzuki K-Series Gasoline Models)',
    dtcCode: 'P0351 – P0354',
    faultDescription: 'Ignition Coil "A"–"D" Primary/Secondary Circuit',
    benchSimulationSetup:
      'Open-circuit or introduce high resistance (> 20 Ω) on an ignition coil trigger driver pin on the bench load box.',
    expectedEcuBehavior:
      'ECM detects primary circuit current anomaly within 2–3 crank/run cycles and cuts fuel injector pulse to the affected cylinder.',
    recommendedPinId: 'ecu-pin-11',
    recommendedFaultType: 'HIGH_RESISTANCE_50R',
    faultPresetLabel: 'Suzuki #3: K-Series Ignition Coil Primary >20Ω (P0351–P0354)',
  },
  {
    id: 'scenario-suzuki-4',
    scenarioNumber: 4,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (Ertiga / Swift / Celerio / S-Presso)',
    dtcCode: 'P0107 / P0108',
    faultDescription: 'Manifold Absolute Pressure (MAP) Sensor Circuit Low / High',
    benchSimulationSetup:
      'Pull the MAP sensor analog input pin below 0.2V (short to ground) or above 4.8V (short to 5V reference).',
    expectedEcuBehavior:
      'ECM switches to fail-safe TPS/RPM alpha-N fueling map, disables closed-loop fuel trim, and illuminates MIL.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Suzuki #4: MAP Sensor Low <0.2V / High >4.8V (P0107/P0108)',
  },
  {
    id: 'scenario-suzuki-5',
    scenarioNumber: 5,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'ECM (All Suzuki Electronic Models)',
    dtcCode: 'P0606 / P0602',
    faultDescription: 'ECM/PCM Processor / Control Module Programming Error',
    benchSimulationSetup:
      'Simulate cranking voltage sag (< 6.5V for 250ms) on the main +12V battery feed or inject corrupted EEPROM checksum sector.',
    expectedEcuBehavior:
      'Internal watchdog resets main CPU, inhibits fuel pump/injector relay ground drivers, and latches internal ECU fault.',
    recommendedPinId: 'ecu-pin-3',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Suzuki #5: Cranking Sag <6.5V Watchdog Reset (P0606/P0602)',
  },
  {
    id: 'scenario-suzuki-6',
    scenarioNumber: 6,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / AGS Controller (Dzire / Celerio / S-Presso Auto Gear Shift)',
    dtcCode: 'P0900 / P0919',
    faultDescription: 'Clutch Actuator Circuit Open / Gear Shift Position Control Error',
    benchSimulationSetup:
      'Open-circuit the clutch actuator DC motor load or freeze the gear shift stroke sensor analog feedback during shift command.',
    expectedEcuBehavior:
      'AGS controller halts gear engagement, flashes the gear indicator warning light on the cluster over CAN, and locks transmission in neutral or current gear.',
    recommendedPinId: 'ecu-pin-16',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Suzuki #6: AGS Clutch Actuator Open / Stroke Error (P0900/P0919)',
  },
  {
    id: 'scenario-suzuki-7',
    scenarioNumber: 7,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'TCM / CVT-ECU (Swift / Celerio CVT)',
    dtcCode: 'P0868 / P0746',
    faultDescription: 'Secondary Fluid Pressure Low / Pressure Control Solenoid "A"',
    benchSimulationSetup:
      'Hold secondary pressure sensor input below 0.7V while driving line pressure solenoid PWM duty cycle to maximum.',
    expectedEcuBehavior:
      'CVT module enters hydraulic limp mode, locks pulley ratio to low/safe gear, and disables torque converter lockup.',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Suzuki #7: CVT Secondary Pressure Low <0.7V (P0868/P0746)',
  },
  {
    id: 'scenario-suzuki-8',
    scenarioNumber: 8,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'TCM (Ertiga / Jimny 4-Speed AT)',
    dtcCode: 'P0751 / P0756',
    faultDescription: 'Shift Solenoid "A" or "B" Performance / Stuck Off',
    benchSimulationSetup:
      'Open-circuit a shift solenoid load resistor on the bench harness while simulating vehicle speed > 30 km/h.',
    expectedEcuBehavior:
      'TCM detects solenoid circuit/ratio error and locks transmission into 3rd gear hydraulic fail-safe mode.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Suzuki #8: 4AT Shift Solenoid A/B Open Circuit (P0751/P0756)',
  },
  {
    id: 'scenario-suzuki-9',
    scenarioNumber: 9,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'BCM / Immobilizer Module (Ertiga / Swift / Jimny)',
    dtcCode: 'B1150 / U0140',
    faultDescription: 'Immobilizer Transponder Communication / Lost Communication with BCM',
    benchSimulationSetup:
      'Disconnect CAN-H/CAN-L between ECM and BCM or leave the transponder antenna coil open during ignition-ON simulation.',
    expectedEcuBehavior:
      'BCM blocks starter relay ground trigger and broadcasts immobilizer fuel-cut inhibit message over CAN bus.',
    recommendedPinId: 'ecu-pin-13',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Suzuki #9: BCM CAN / Transponder Coil Open (B1150/U0140)',
  },
  {
    id: 'scenario-suzuki-10',
    scenarioNumber: 10,
    brandKey: 'suzuki',
    brandLabel: 'Suzuki',
    market: 'PH Market',
    targetModuleAndModels: 'ABS / ESP Control Module (Ertiga / Swift / Jimny)',
    dtcCode: 'C1021 – C1028',
    faultDescription: 'Front/Rear Wheel Speed Sensor Circuit Open or Short',
    benchSimulationSetup:
      'Open-circuit or short-to-ground the active wheel speed sensor current loop on the ABS bench breakout box.',
    expectedEcuBehavior:
      'ABS module disables ABS, EBD, and ESP systems, broadcasting warning lamp ON flags over the CAN bus.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Suzuki #10: Active WSS Loop Open / Grounded (C1021–C1028)',
  },
  // Batch 8: Honda (PH Market — City, Civic, BR-V, CR-V, Brio)
  {
    id: 'scenario-honda-1',
    scenarioNumber: 1,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (City / BR-V / Civic L15Z1 & R18Z1)',
    dtcCode: 'P2135 / P2118',
    faultDescription: 'Throttle Position Sensor (TPS) 1/2 Correlation / Actuator Current',
    benchSimulationSetup:
      'Cross-short TPS1 and TPS2 analog return lines or open-circuit the Electronic Throttle Control (ETCS) motor power relay pin.',
    expectedEcuBehavior:
      'PCM immediately cuts power to the throttle motor H-bridge driver, locking the throttle plate at ~6° mechanical fail-safe angle.',
    recommendedPinId: 'ecu-pin-7',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Honda #1: TPS1/2 Correlation & ETCS Cut ~6° Limp (P2135/P2118)',
  },
  {
    id: 'scenario-honda-2',
    scenarioNumber: 2,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (Civic / CR-V 1.5L VTEC Turbo L15B7)',
    dtcCode: 'P0299 / P0234',
    faultDescription: 'Turbocharger Underboost / Overboost Condition',
    benchSimulationSetup:
      'Hold MAP/Boost sensor voltage static (< 1.5V or > 4.2V) while varying simulated engine RPM and throttle load on the bench.',
    expectedEcuBehavior:
      'PCM logs boost deviation fault after ~5 seconds under load and cuts PWM duty to the electronic wastegate actuator.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Honda #2: L15B7 Static Boost Sensor / Wastegate Cut (P0299/P0234)',
  },
  {
    id: 'scenario-honda-3',
    scenarioNumber: 3,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (City / BR-V / Brio / Civic)',
    dtcCode: 'P0335 / P0340',
    faultDescription: 'Crankshaft (CKP) / Camshaft (CMP) Position Sensor Circuit',
    benchSimulationSetup:
      'Drop the CKP Hall-effect square wave or phase-shift the CMP signal by > 15° relative to CKP on the bench simulator.',
    expectedEcuBehavior:
      'Dropping CKP immediately halts injector and coil firing; CMP loss forces extended cranking and batch-fire limp synchronization.',
    recommendedPinId: 'ecu-pin-11',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Honda #3: CKP Signal Drop / CMP Phase Shift (P0335/P0340)',
  },
  {
    id: 'scenario-honda-4',
    scenarioNumber: 4,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (All Honda i-VTEC / Earth Dreams Models)',
    dtcCode: 'P2646 / P2647',
    faultDescription: 'VTEC Oil Pressure Switch / Rocker Arm Oil Control Solenoid',
    benchSimulationSetup:
      'Open-circuit the VTEC spool valve solenoid load resistor or fail to toggle the VTEC oil pressure switch input when RPM exceeds 4,500.',
    expectedEcuBehavior:
      'PCM logs VTEC system fault, illuminates MIL, and caps engine speed at ~3,000–3,500 RPM limp mode.',
    recommendedPinId: 'ecu-pin-10',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Honda #4: VTEC Spool Solenoid Open / Oil Switch Fault (P2646/P2647)',
  },
  {
    id: 'scenario-honda-5',
    scenarioNumber: 5,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (City / Civic / CR-V)',
    dtcCode: 'P0102 / P0103',
    faultDescription: 'Mass Air Flow (MAF) Sensor Circuit Low / High',
    benchSimulationSetup:
      'Drop MAF sensor frequency/voltage below 0.2V (open circuit) or pull above 4.8V (short to 5V reference) on the breakout box.',
    expectedEcuBehavior:
      'PCM ignores MAF input, switches to fail-safe speed-density (MAP/RPM) fueling map, and disables closed-loop fuel trim.',
    recommendedPinId: 'ecu-pin-8',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Honda #5: MAF Sensor Open <0.2V / Speed-Density Fail-Safe (P0102/P0103)',
  },
  {
    id: 'scenario-honda-6',
    scenarioNumber: 6,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM (All Honda Electronic Models)',
    dtcCode: 'P0606 / P0602',
    faultDescription: 'PCM Processor / Control Module Programming Error',
    benchSimulationSetup:
      'Simulate cranking voltage sag (< 6.5V for 250ms) on the main +12V battery feed or inject corrupted EEPROM checksum sector.',
    expectedEcuBehavior:
      'Internal watchdog resets main CPU, inhibits PGM-FI main relay/injector drivers, and latches internal ECU fault.',
    recommendedPinId: 'ecu-pin-3',
    recommendedFaultType: 'HIGH_RESISTANCE_250R',
    faultPresetLabel: 'Honda #6: Cranking Sag <6.5V Watchdog Reset (P0606/P0602)',
  },
  {
    id: 'scenario-honda-7',
    scenarioNumber: 7,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM / TCM (City / BR-V / Civic Earth Dreams CVT)',
    dtcCode: 'P0842 / P0843',
    faultDescription: 'Transmission Fluid Pressure (TFP) Sensor/Switch "A" Circuit Low / High',
    benchSimulationSetup:
      'Pull the CVT secondary/pulley pressure sensor analog input below 0.3V or above 4.8V on the transmission simulator harness.',
    expectedEcuBehavior:
      'PCM/TCM enters hydraulic fail-safe mode, locks pulley ratio to low/safe gear, and flashes the "D" indicator over CAN.',
    recommendedPinId: 'ecu-pin-9',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Honda #7: Earth Dreams CVT TFP Sensor Low <0.3V (P0842/P0843)',
  },
  {
    id: 'scenario-honda-8',
    scenarioNumber: 8,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'PCM / TCM (City / Civic / CR-V CVT & 5AT)',
    dtcCode: 'P0715 / P0720',
    faultDescription: 'Input/Turbine Speed Sensor or Output/Countershaft Speed Sensor',
    benchSimulationSetup:
      'Cut or ground the Hall-effect square-wave signal on the input or output shaft speed pin while simulating drive load.',
    expectedEcuBehavior:
      'Module loses gear-ratio calculation, forces transmission into hydraulic fail-safe mode, and disables paddle/sport shift mode.',
    recommendedPinId: 'ecu-pin-14',
    recommendedFaultType: 'SHORT_TO_GND',
    faultPresetLabel: 'Honda #8: CVT/5AT Input/Output Speed No Signal (P0715/P0720)',
  },
  {
    id: 'scenario-honda-9',
    scenarioNumber: 9,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'BCM / MICU (Multiplex Integrated Control Unit)',
    dtcCode: 'U0155 / B1000',
    faultDescription: 'Lost Communication with Gauge Control Module / F-CAN Bus Off',
    benchSimulationSetup:
      'Disconnect F-CAN (Fast CAN) or B-CAN lines between PCM, MICU, and cluster simulator, or leave immobilizer unit unplugged.',
    expectedEcuBehavior:
      'MICU blocks starter cut relay ground trigger and broadcasts immobilizer fuel-cut inhibit message over CAN bus.',
    recommendedPinId: 'ecu-pin-13',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Honda #9: MICU F-CAN / B-CAN Bus Off & Lost Cluster Comm (U0155/B1000)',
  },
  {
    id: 'scenario-honda-10',
    scenarioNumber: 10,
    brandKey: 'honda',
    brandLabel: 'Honda',
    market: 'PH Market',
    targetModuleAndModels: 'VSA Modulator-Control Unit (City / Civic / CR-V / BR-V)',
    dtcCode: 'C0031 – C0040',
    faultDescription: 'Front/Rear Wheel Speed Sensor Circuit Open or Short',
    benchSimulationSetup:
      'Open-circuit or short-to-ground the active wheel speed sensor current loop on the VSA bench breakout box.',
    expectedEcuBehavior:
      'VSA ECU immediately disables ABS, EBD, Vehicle Stability Assist (VSA), and Hill Start Assist, broadcasting warning flags over CAN.',
    recommendedPinId: 'ecu-pin-15',
    recommendedFaultType: 'OPEN_CIRCUIT',
    faultPresetLabel: 'Honda #10: VSA Active WSS Loop Open / Grounded (C0031–C0040)',
  },
];

/**
 * Returns saved OEM bench test scenarios, optionally filtered by `brandKey`.
 */
export function getBenchTestScenarios(brandKey?: string): BenchTestScenarioEntry[] {
  if (!brandKey || brandKey === 'ALL' || brandKey === 'universal-bench') {
    return BENCH_TEST_SCENARIOS;
  }
  return BENCH_TEST_SCENARIOS.filter((s) => s.brandKey === brandKey);
}
