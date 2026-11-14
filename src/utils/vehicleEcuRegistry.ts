import { ECU_BRAND_PROFILES, EcuBrandProfile } from '../components/ecuPinoutData';
import { EcuPin } from '../types/ecu';
import { DEFAULT_ECU_PINS } from './circuitSolver';
import {
  EcuIngestionStatus,
  RESTRICTED_MODEL_DATABASE,
  TABLE16_DLC_INTERFACES,
  VERIFIED_VOICE_ECU_GUIDES,
  matchSafetyGatesForQuery,
} from './oemKnowledgeDatabase';

export interface RpmEmulatorState {
  isActive: boolean;
  rpm: number;
  soundEnabled: boolean;
  camPhaseOffsetDeg?: number;
  ckpSignalLost?: boolean;
}

export interface VehicleMakeEntry {
  brandKey: string;
  brandLabel: string;
  models: string[];
  profiles: EcuBrandProfile[];
}

export interface SelectedVehicleContext {
  brandKey: string;
  brandLabel: string;
  modelName: string;
  status: EcuIngestionStatus;
  gateAlert: string | null;
  spokenAlert: string | null;
  controllerNote: string;
  dlcProtocol: string;
  tableRef: string | null;
  hasVerifiedPinoutMap: boolean;
}

export const UNIVERSAL_BRAND_KEY = 'universal-bench';

/**
 * Curated verified models per `EcuBrandProfile` that aren't already enumerated in
 * `VERIFIED_VOICE_ECU_GUIDES`, eliminating mid-parenthesis splits and model duplication.
 */
const PROFILE_VERIFIED_MODELS: Record<string, string[]> = {
  'isuzu-transtron-4jj1': [
    'D-Max (4JJ1-TCX / 4JK1)',
    'mu-X (4JJ1-TCX / 4JJ3-TCX)',
    'Alterra (4JJ1-TC)',
    'NHR / NKR / NPR Trucks (4JJ1 / 4JK1)',
  ],
  'mitsubishi-melco-e6t': [
    'Lancer EX (4B11)',
    'Lancer Cedia (4G18)',
    'ASX (4B11)',
    'Outlander (4B12)',
  ],
  'nissan-hitachi-mec11': ['Sentra N16 (QG16DE MEC11 / MEC22)'],
  'hyundai-kia-edc16c39': [
    'Grand Starex (D4CB EDC16C39)',
    'H-100 / K2500 (D4CB)',
    'Sportage (D4EA / EDC16C39)',
  ],
  'magneti-marelli-iaw-5nf': [
    'Fiat Stilo (1.6L 16V IAW 5NF)',
    'Fiat Palio / Punto / Siena',
    'Fiat Idea / Doblo (1.6L / 1.8L)',
  ],
  'bosch-me75': [
    'Volkswagen Polo / Golf (ME7.5)',
    'Audi A4 / A6 (ME7.1.1 / ME7.5)',
    'VW Beetle (1.8T / 2.0L Petrol)',
  ],
  'ford-fomoco-sid208': [
    'Ranger 2.2L / 3.2L (SID208)',
    'Ranger Raptor (FoMoCo PCM)',
  ],
  'delphi-mt20u': [
    'Geely Coolray / Emgrand (MT20U / MT80)',
    'Changan CS35 (Delphi MT20U)',
    'Chery Tiggo (Delphi MT20U)',
  ],
};

/**
 * Derives canonical `brandKey` and `brandLabel` from a profile's `brandName`.
 */
export function normalizeBrandKey(brandName: string): { brandKey: string; brandLabel: string } {
  const rawMake = brandName.split('/')[0].trim();
  const brandKey = rawMake.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return { brandKey, brandLabel: rawMake };
}

function addUniqueModel(models: string[], model: string) {
  if (model && !models.includes(model)) {
    models.push(model);
  }
}

/**
 * Builds structured Car Make -> Vehicle Model -> ECU Hardware options cleanly from
 * `VERIFIED_VOICE_ECU_GUIDES`, curated `PROFILE_VERIFIED_MODELS`, and `RESTRICTED_MODEL_DATABASE`
 * with zero duplicate model names or broken comma-split fragments.
 */
export function buildVehicleCatalog(): VehicleMakeEntry[] {
  const makeMap = new Map<string, VehicleMakeEntry>();

  const ensureMake = (brandKey: string, brandLabel: string): VehicleMakeEntry => {
    let entry = makeMap.get(brandKey);
    if (!entry) {
      entry = { brandKey, brandLabel, models: [], profiles: [] };
      makeMap.set(brandKey, entry);
    }
    return entry;
  };

  for (const profile of ECU_BRAND_PROFILES) {
    const { brandKey, brandLabel } = normalizeBrandKey(profile.brandName);
    const entry = ensureMake(brandKey, brandLabel);
    entry.profiles.push(profile);
    const extraModels = PROFILE_VERIFIED_MODELS[profile.id] || [];
    for (const m of extraModels) {
      addUniqueModel(entry.models, m);
    }
  }

  for (const guide of VERIFIED_VOICE_ECU_GUIDES) {
    const entry = ensureMake(guide.brandKey, guide.brandLabel);
    for (const m of guide.models) {
      addUniqueModel(entry.models, m);
    }
  }

  for (const restricted of RESTRICTED_MODEL_DATABASE) {
    const entry = ensureMake(restricted.brandKey, restricted.brandLabel);
    addUniqueModel(entry.models, restricted.modelName);
  }

  return Array.from(makeMap.values());
}

export const VEHICLE_CATALOG: VehicleMakeEntry[] = buildVehicleCatalog();

/**
 * Picks the best matching verified ECU profile for a given Car Make and Vehicle Model.
 * Strictly returns `null` for `PART_METADATA_ONLY` and `MECHANICAL_NO_ECU` vehicles so
 * restricted models never inherit unrelated ECU pinout maps.
 */
export function resolveProfileForVehicle(
  brandKey: string,
  modelName: string
): EcuBrandProfile | null {
  if (brandKey === UNIVERSAL_BRAND_KEY) return null;

  const restrictedMatch = RESTRICTED_MODEL_DATABASE.find(
    (r) => r.brandKey === brandKey && r.modelName === modelName
  );
  if (restrictedMatch) {
    return null;
  }

  const guideMatch = VERIFIED_VOICE_ECU_GUIDES.find(
    (g) => g.brandKey === brandKey && g.models.includes(modelName)
  );
  if (guideMatch) {
    return guideMatch.linkedProfileId
      ? ECU_BRAND_PROFILES.find((p) => p.id === guideMatch.linkedProfileId) || null
      : null;
  }

  for (const [profileId, models] of Object.entries(PROFILE_VERIFIED_MODELS)) {
    if (models.includes(modelName)) {
      return ECU_BRAND_PROFILES.find((p) => p.id === profileId) || null;
    }
  }

  const make = VEHICLE_CATALOG.find((m) => m.brandKey === brandKey);
  if (!make || make.profiles.length === 0) return null;
  return make.profiles[0];
}

/**
 * Resolves `brandKey`, default `modelName`, and `ecuProfileId` cleanly from an ECU profile ID.
 */
export function resolveSelectionFromProfileId(profileId: string): {
  brandKey: string;
  modelName: string;
  ecuProfileId: string | null;
} {
  const profile = ECU_BRAND_PROFILES.find((p) => p.id === profileId);
  if (!profile) {
    return {
      brandKey: UNIVERSAL_BRAND_KEY,
      modelName: 'Generic 16-Pin Bench',
      ecuProfileId: null,
    };
  }
  const { brandKey } = normalizeBrandKey(profile.brandName);
  const make = VEHICLE_CATALOG.find((m) => m.brandKey === brandKey);
  const curated = PROFILE_VERIFIED_MODELS[profile.id] || [];
  const linkedGuide = VERIFIED_VOICE_ECU_GUIDES.find((g) => g.linkedProfileId === profile.id);
  const matchedModel = curated[0] || linkedGuide?.models[0] || make?.models[0] || '';
  return {
    brandKey,
    modelName: matchedModel,
    ecuProfileId: profile.id,
  };
}

/**
 * Evaluates verification status (`VERIFIED`, `OCR_VERIFY`, `PART_METADATA_ONLY`, `MECHANICAL_NO_ECU`),
 * mandatory safety prompts, DLC protocol notes, and controller metadata for the selected vehicle.
 */
export function getSelectedVehicleContext(
  brandKey: string,
  modelName: string,
  ecuProfileId: string | null
): SelectedVehicleContext {
  if (brandKey === UNIVERSAL_BRAND_KEY) {
    return {
      brandKey,
      brandLabel: 'Universal ECU',
      modelName: 'Generic 16-Pin Bench',
      status: 'VERIFIED',
      gateAlert: null,
      spokenAlert: null,
      controllerNote: 'Universal 16-Pin SAE Bench Trainer (KL30 / KL15 / TPS / CAN)',
      dlcProtocol:
        TABLE16_DLC_INTERFACES.find((d) => d.brandKey === 'universal-bench')?.obd2Pins ||
        'SAE J1962 CAN (6/14) & K-Line (7)',
      tableRef: null,
      hasVerifiedPinoutMap: true,
    };
  }

  const restrictedMatch = RESTRICTED_MODEL_DATABASE.find(
    (r) => r.brandKey === brandKey && r.modelName === modelName
  );
  if (restrictedMatch) {
    const isMech = restrictedMatch.status === 'MECHANICAL_NO_ECU';
    const spokenAlert = isMech
      ? `${restrictedMatch.brandLabel} ${restrictedMatch.modelName}: mechanical fuel injection or carbureted platform with no Engine ECU.`
      : `${restrictedMatch.brandLabel} ${restrictedMatch.modelName} is metadata only. Factory pin numbers are unavailable and will not be fabricated.`;

    return {
      brandKey,
      brandLabel: restrictedMatch.brandLabel,
      modelName: restrictedMatch.modelName,
      status: restrictedMatch.status,
      gateAlert: restrictedMatch.restrictionReason,
      spokenAlert,
      controllerNote: restrictedMatch.oemControllerNote,
      dlcProtocol: restrictedMatch.dlcProtocol,
      tableRef: null,
      hasVerifiedPinoutMap: false,
    };
  }

  const guideMatch = VERIFIED_VOICE_ECU_GUIDES.find(
    (g) => g.brandKey === brandKey && g.models.includes(modelName)
  );
  const profile = getEcuProfileById(ecuProfileId);
  const dlcEntry =
    TABLE16_DLC_INTERFACES.find((d) => d.brandKey === brandKey) ||
    TABLE16_DLC_INTERFACES.find((d) => d.brandKey === 'universal-bench');

  if (guideMatch) {
    const gates = matchSafetyGatesForQuery(
      `${guideMatch.brandLabel} ${modelName} ${guideMatch.ecuName}`
    );
    const gateAlert = guideMatch.ocrVerifyGate || gates[0]?.prompt || null;
    const spokenAlert = gates[0]?.spokenAlert || guideMatch.voicePrompt;

    return {
      brandKey,
      brandLabel: guideMatch.brandLabel,
      modelName,
      status: guideMatch.status,
      gateAlert,
      spokenAlert,
      controllerNote: `${guideMatch.ecuName} — ${guideMatch.keyBenchPins}`,
      dlcProtocol: guideMatch.dlcProtocol,
      tableRef: guideMatch.tableRef,
      hasVerifiedPinoutMap: Boolean(profile || guideMatch.linkedProfileId),
    };
  }

  const make = VEHICLE_CATALOG.find((m) => m.brandKey === brandKey);
  const gates = matchSafetyGatesForQuery(
    `${make?.brandLabel || brandKey} ${modelName} ${profile?.modelName || ''}`
  );

  return {
    brandKey,
    brandLabel: make?.brandLabel || brandKey,
    modelName,
    status: gates.length > 0 ? 'OCR_VERIFY' : 'VERIFIED',
    gateAlert: gates[0]?.prompt || null,
    spokenAlert: gates[0]?.spokenAlert || null,
    controllerNote: profile?.modelName || 'Verified Bench ECU Profile',
    dlcProtocol: dlcEntry?.obd2Pins || 'SAE J1962 OBD-II CAN (6/14) & K-Line (7)',
    tableRef: profile ? 'ECU Connector Pinout Library' : null,
    hasVerifiedPinoutMap: Boolean(profile),
  };
}

/**
 * Applies selected OEM ECU pinout metadata onto the 16 simulated bench ECU pins.
 * Strictly preserves `id` (`ecu-pin-1`..`ecu-pin-16`), `pinNumber`, `label`, `category`,
 * `nominalVoltage`, and `internalResistance` so MNA solver equations and voice commands
 * remain 100% deterministic and unchanged.
 */
export function applyEcuProfileToPins(
  ecuProfileId: string | null,
  basePins: EcuPin[] = DEFAULT_ECU_PINS
): EcuPin[] {
  if (!ecuProfileId) {
    return basePins.map((pin) => ({ ...pin }));
  }

  const profile = ECU_BRAND_PROFILES.find((p) => p.id === ecuProfileId);
  if (!profile) {
    return basePins.map((pin) => ({ ...pin }));
  }

  return basePins.map((basePin) => {
    const oemMatch = profile.pinouts.find((op) => op.associatedSimPinId === basePin.id);
    if (!oemMatch) {
      return { ...basePin };
    }
    const cavityTag = oemMatch.pinCode ? ` [${oemMatch.pinCode}]` : ` [Pin ${oemMatch.pinNumber}]`;
    return {
      ...basePin,
      name: `${oemMatch.label}${cavityTag} · ${basePin.name}`,
      description: `${oemMatch.signalName} — ${oemMatch.wireColor} (${oemMatch.electricalSpec})`,
    };
  });
}

export function getEcuProfileById(ecuProfileId: string | null): EcuBrandProfile | null {
  if (!ecuProfileId) return null;
  return ECU_BRAND_PROFILES.find((p) => p.id === ecuProfileId) || null;
}
