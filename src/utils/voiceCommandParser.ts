import { EcuPin } from '../types/ecu';
import {
  TABLE16_DLC_INTERFACES,
  VERIFIED_VOICE_ECU_GUIDES,
  matchRestrictedModelsForQuery,
  matchSafetyGatesForQuery,
} from './oemKnowledgeDatabase';

export type LabTab = 'BENCH_LAB' | 'WIRING_DIAGRAM' | 'THREE_D_TWIN' | 'ECU_PINOUT' | 'OSCILLOSCOPE' | 'PCB_SCANNER' | 'REPAIR_GUIDE';

export interface CommandExecutionResult {
  matched: boolean;
  actionDescription: string;
  spokenReply: string;
}

export type VoiceBenchPane = 'INSTRUMENTS' | 'CANVAS' | 'GUIDE';

export interface VoiceMeterSummary {
  display: string;
  unit: string;
  dtcCount: number;
  supplyVolts: number;
  isPowerOn: boolean;
  supplyAmps: number;
}

export function parseAndExecuteVoiceCommand(
  transcript: string,
  pins: EcuPin[],
  actions: {
    setVoltage: (volts: number) => void;
    resetLab: () => void;
    attachProbeToPin: (pinId: string, label: string) => void;
    setPowerSupplyOutput: (enabled: boolean) => void;
    switchTab: (tab: LabTab) => void;
    switchMobilePane?: (pane: VoiceBenchPane) => void;
    clearFaults?: () => void;
    readMeter?: () => VoiceMeterSummary;
  }
): CommandExecutionResult {
  const text = transcript.trim().toLowerCase();

  // 1. Set Voltage e.g. "set voltage to 12 volts", "change voltage to 5V", "set power supply to 13.8"
  const voltageMatch = text.match(/(?:set|change)\s+(?:power\s+supply\s+)?voltage\s+(?:to\s+)?([0-9]+(?:\.[0-9]+)?)/i) ||
                       text.match(/voltage\s+([0-9]+(?:\.[0-9]+)?)\s*(?:v|volts?)?/i) ||
                       text.match(/set\s+([0-9]+(?:\.[0-9]+)?)\s*(?:v|volts?)/i);

  if (voltageMatch) {
    const volts = parseFloat(voltageMatch[1]);
    if (!isNaN(volts) && volts >= 0 && volts <= 30) {
      actions.setVoltage(volts);
      return {
        matched: true,
        actionDescription: `Set power supply voltage to ${volts.toFixed(1)}V`,
        spokenReply: `Power supply voltage adjusted to ${volts.toFixed(1)} volts.`,
      };
    }
  }

  // 2. Reset Lab e.g. "reset lab", "reset circuit", "reset bench"
  if (/reset\s+(?:lab|circuit|bench|session)/i.test(text) || /restart\s+(?:lab|bench)/i.test(text)) {
    actions.resetLab();
    return {
      matched: true,
      actionDescription: 'Reset laboratory to pristine factory state',
      spokenReply: 'Laboratory reset to initial factory bench state.',
    };
  }

  // 2b. Clear Faults e.g. "clear faults", "clear dtc", "remove faults"
  if (actions.clearFaults && /(?:clear|remove)\s+(?:all\s+)?(?:faults?|dtcs?|codes?)/i.test(text)) {
    actions.clearFaults();
    return {
      matched: true,
      actionDescription: 'Cleared all injected bench faults',
      spokenReply: 'Cleared all injected faults from the ECU bench.',
    };
  }

  // 2c. Live MNA Meter & Status Readout e.g. "read meter", "check voltage", "bench status"
  if (
    actions.readMeter &&
    /(?:read|check|what\s+is)\s+(?:the\s+)?(?:meter|multimeter|dmm|voltage|reading|status|bench|dtc)/i.test(text)
  ) {
    const snap = actions.readMeter();
    const powerDesc = snap.isPowerOn
      ? `Power supply on at ${snap.supplyVolts.toFixed(1)} volts drawing ${snap.supplyAmps.toFixed(2)} amps`
      : 'Power supply is currently off';
    const dtcDesc =
      snap.dtcCount === 0
        ? 'No active DTCs.'
        : `${snap.dtcCount} active DTC${snap.dtcCount === 1 ? '' : 's'}.`;
    return {
      matched: true,
      actionDescription: `DMM: ${snap.display} ${snap.unit} · PSU: ${snap.isPowerOn ? `${snap.supplyVolts.toFixed(1)}V` : 'OFF'} · ${snap.dtcCount} DTC`,
      spokenReply: `${powerDesc}. Multimeter reads ${snap.display} ${snap.unit}. ${dtcDesc}`,
    };
  }

  // 3. Power Supply Toggle e.g. "turn power supply on", "disable power supply", "turn output off"
  if (/(?:turn\s+(?:power\s+supply\s+)?|power\s+)(on|enable)/i.test(text)) {
    actions.setPowerSupplyOutput(true);
    return {
      matched: true,
      actionDescription: 'Enabled bench power supply output',
      spokenReply: 'Bench power supply output enabled.',
    };
  }
  if (/(?:turn\s+(?:power\s+supply\s+)?|power\s+)(off|disable)/i.test(text) || /cut\s+power/i.test(text)) {
    actions.setPowerSupplyOutput(false);
    return {
      matched: true,
      actionDescription: 'Disabled bench power supply output',
      spokenReply: 'Bench power supply output disabled.',
    };
  }

  // 4. Attach Probe to Pin e.g. "attach probe to pin 7", "probe pin 15", "connect red probe to pin 4"
  const pinMatch = text.match(/(?:attach|connect)?\s*(?:red\s+)?probe\s+(?:to\s+)?(?:pin\s+)?([0-9]+)/i) ||
                   text.match(/probe\s+pin\s+([0-9]+)/i) ||
                   text.match(/pin\s+([0-9]+)\s+probe/i);

  if (pinMatch) {
    const pinNumStr = pinMatch[1];
    const pinNum = parseInt(pinNumStr, 10);
    const targetPin = pins.find((p) => p.pinNumber === pinNum || p.id.endsWith(`-${pinNum}`));
    if (targetPin) {
      actions.attachProbeToPin(targetPin.id, `${targetPin.label} (#${targetPin.pinNumber})`);
      return {
        matched: true,
        actionDescription: `Attached DMM red probe to Pin #${targetPin.pinNumber} (${targetPin.label})`,
        spokenReply: `Attached multimeter probe to pin ${targetPin.pinNumber}, ${targetPin.label}.`,
      };
    } else {
      return {
        matched: true,
        actionDescription: `Pin #${pinNum} not found in ECU pinout map`,
        spokenReply: `Pin number ${pinNum} was not found in the ECU pinout library.`,
      };
    }
  }

  // 5. Bench Pane Switcher (mobile & desktop quick navigation)
  if (
    actions.switchMobilePane &&
    /(?:show|open|go\s+to|focus|switch\s+to)\s+(?:the\s+)?(?:instruments?|multimeter|power\s+supply|fault\s+matrix|rack)/i.test(text)
  ) {
    actions.switchTab('BENCH_LAB');
    actions.switchMobilePane('INSTRUMENTS');
    return {
      matched: true,
      actionDescription: 'Focused Bench Instrument Panels',
      spokenReply: 'Showing bench instrument panels.',
    };
  }
  if (
    actions.switchMobilePane &&
    /(?:show|focus|switch\s+to|go\s+to)\s+(?:the\s+)?(?:harness\s+)?(?:canvas|wires?)/i.test(text)
  ) {
    actions.switchTab('BENCH_LAB');
    actions.switchMobilePane('CANVAS');
    return {
      matched: true,
      actionDescription: 'Focused Harness Wiring Canvas',
      spokenReply: 'Showing harness wiring canvas.',
    };
  }
  if (
    actions.switchMobilePane &&
    /(?:show|open|focus|switch\s+to|go\s+to)\s+(?:the\s+)?(?:5[\s-]*step\s+)?(?:diagnostic\s+)?guide/i.test(text)
  ) {
    actions.switchTab('BENCH_LAB');
    actions.switchMobilePane('GUIDE');
    return {
      matched: true,
      actionDescription: 'Focused 5-Step ECU Diagnostic Guide',
      spokenReply: 'Showing 5-step diagnostic guide.',
    };
  }

  // 6. Switch Tabs / Open Workspace Views
  if (/(?:open|show|switch\s+to)\s+(?:the\s+)?(?:oscilloscope|scope)/i.test(text)) {
    actions.switchTab('OSCILLOSCOPE');
    return { matched: true, actionDescription: 'Opened Oscilloscope workspace', spokenReply: 'Switching to digital oscilloscope.' };
  }
  if (/(?:open|show|switch\s+to)\s+(?:the\s+)?(?:pcb\s+scanner|scanner|board)/i.test(text)) {
    actions.switchTab('PCB_SCANNER');
    return { matched: true, actionDescription: 'Opened PCB Scanner workspace', spokenReply: 'Switching to PCB vision scanner.' };
  }
  if (/(?:open|show|switch\s+to)\s+(?:the\s+)?(?:repair\s+guide|manuals?|knowledge\s+base)/i.test(text)) {
    actions.switchTab('REPAIR_GUIDE');
    return { matched: true, actionDescription: 'Opened ECU Repair Knowledge Base', spokenReply: 'Opening ECU repair knowledge base and diagnostic manuals.' };
  }
  if (/(?:open|show|switch\s+to)\s+(?:the\s+)?(?:pinout|ecu\s+pins?)/i.test(text)) {
    actions.switchTab('ECU_PINOUT');
    return { matched: true, actionDescription: 'Opened ECU Pinout Library', spokenReply: 'Opening ECU connector pinout library.' };
  }
  if (/(?:open|show|switch\s+to)\s+(?:the\s+)?(?:wiring|diagram|canvas)/i.test(text)) {
    actions.switchTab('WIRING_DIAGRAM');
    return { matched: true, actionDescription: 'Opened Wiring Harness Canvas', spokenReply: 'Opening interactive wiring canvas.' };
  }
  if (/(?:open|show|switch\s+to)\s+(?:the\s+)?(?:3d\s+bench|twin|hardware)/i.test(text)) {
    actions.switchTab('THREE_D_TWIN');
    return { matched: true, actionDescription: 'Opened 3D Bench Twin workspace', spokenReply: 'Switching to Three D bench hardware twin.' };
  }
  if (/(?:open|show|switch\s+to)\s+(?:the\s+)?(?:bench|lab|simulator)/i.test(text)) {
    actions.switchTab('BENCH_LAB');
    return { matched: true, actionDescription: 'Opened Main Bench Lab', spokenReply: 'Returning to main bench laboratory.' };
  }

  // 7. Table 16 OBD-II / Legacy DLC Voice Lookup (e.g. "DLC Toyota", "OBD pinout Honda", "Nissan consult DLC")
  if (/(?:dlc|obd[\s-]*2|obd[\s-]*ii|consult|mut[\s-]*2|mut[\s-]*ii|sdl|tdcl|scs)/i.test(text)) {
    const matchedDlc =
      TABLE16_DLC_INTERFACES.find((d) => text.includes(d.brandKey.split('-')[0])) ||
      TABLE16_DLC_INTERFACES.find((d) => d.brandKey === 'universal-bench');
    if (matchedDlc) {
      return {
        matched: true,
        actionDescription: `Table 16 DLC · ${matchedDlc.brandLabel}: ${matchedDlc.obd2Pins}`,
        spokenReply: matchedDlc.voiceSummary,
      };
    }
  }

  // 8. Hardware-Conflict / OCR_VERIFY Voice Gate
  const safetyGates = matchSafetyGatesForQuery(text);
  if (safetyGates.length > 0 && /(?:pin|pinout|verify|check|energize|probe|guide|bench|ecu|volt)/i.test(text)) {
    const primary = safetyGates[0];
    return {
      matched: true,
      actionDescription: `${primary.title}: ${primary.prompt}`,
      spokenReply: primary.spokenAlert,
    };
  }

  // 8b. Restricted PART_METADATA_ONLY / MECHANICAL_NO_ECU Anti-Fabrication Guardrail
  const restrictedMatches = matchRestrictedModelsForQuery(text);
  if (restrictedMatches.length > 0 && /(?:pin|pinout|wiring|ecu|bench|check|guide)/i.test(text)) {
    const first = restrictedMatches[0];
    return {
      matched: true,
      actionDescription: `${first.brandLabel} ${first.modelName} [${first.status}]: ${first.oemControllerNote}`,
      spokenReply:
        first.status === 'MECHANICAL_NO_ECU'
          ? `${first.brandLabel} ${first.modelName} uses mechanical injection and has no Engine ECU.`
          : `${first.brandLabel} ${first.modelName} is metadata only. Verified factory pin numbers are unavailable, so no pinout will be fabricated.`,
    };
  }

  // 9. Verified Voice-Ready ECU Bench Guide Match (e.g. "Ranger T6", "EcoBlue CBR", "EcoSport 1.5L", "Focus GDI", "PowerShift TCM", "Territory 1.5L", "Explorer", "Transit 2.2L", "1NZ-FE", "SID209")
  const guideStopWords = new Set([
    'denso',
    'honda',
    'toyota',
    'nissan',
    'ford',
    'hyundai',
    'isuzu',
    'suzuki',
    'mitsubishi',
    'keihin',
    'hitachi',
    'fomoco',
    'continental',
    'ecm',
    'ecu',
    'pcm',
    'bench',
    'pins',
    'grid',
    'boot',
    'protocol',
    'dual',
    'vvt-i',
    'common',
    'rail',
    'only',
    'trucks',
    'revisions',
    'hardware',
    '2014',
    'legacy',
    'euro-5',
    'euro-4',
    'and',
    'the',
    'for',
    'with',
    'connector',
    'models',
  ]);
  const allowedShortTokens = new Set(['t6', 'na', 'ph']);

  let bestGuide: (typeof VERIFIED_VOICE_ECU_GUIDES)[number] | undefined;
  let bestScore = 0;

  const queryWords = new Set(text.split(/[\s/,()[\]&+-]+/).filter(Boolean));

  for (const g of VERIFIED_VOICE_ECU_GUIDES) {
    const rawTokens = [
      ...g.ecuName.toLowerCase().split(/[\s/,()[\]&]+/),
      ...g.models.join(' ').toLowerCase().split(/[\s/,()[\]&]+/),
    ].filter((t) => (t.length >= 3 || allowedShortTokens.has(t)) && !guideStopWords.has(t));

    const uniqueTokens = Array.from(new Set(rawTokens));
    let score = 0;
    for (const tok of uniqueTokens) {
      if (tok.length <= 2) {
        if (queryWords.has(tok)) score += 3;
      } else if (queryWords.has(tok)) {
        score += 3;
      } else if (text.includes(tok)) {
        score += 2;
      }
    }
    if (score > bestScore) {
      bestScore = score;
      bestGuide = g;
    }
  }

  if (
    bestGuide &&
    bestScore > 0 &&
    /(?:pin|pinout|bench|boot|guide|wakeup|wake\s*up|ecu|pcm|tcm|power|ignition|ground|connect|wiring)/i.test(text)
  ) {
    return {
      matched: true,
      actionDescription: `${bestGuide.brandLabel} ${bestGuide.ecuName} (${bestGuide.tableRef}): ${bestGuide.keyBenchPins}`,
      spokenReply: bestGuide.voicePrompt,
    };
  }

  return {
    matched: false,
    actionDescription: '',
    spokenReply: '',
  };
}
