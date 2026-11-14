import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  query,
  where,
  serverTimestamp,
  Timestamp,
} from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import {
  BenchComponent,
  InjectedFault,
  MultimeterState,
  PowerSupplyState,
  WireConnection,
} from '../types/ecu';
import type { RpmEmulatorState } from '../utils/vehicleEcuRegistry';
import { GroundedSearchSource } from './groundedSearchService';
import {
  ImageAnalysisComponent,
  ImageAnalysisHotspot,
  ImageAnalysisNet,
} from '../server/services/imageAnalysisTypes';

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}

export interface SavedBenchSession {
  id: string;
  ownerId: string;
  title: string;
  notes: string;
  ecuProfileLabel: string;
  powerSupply: PowerSupplyState;
  wires: WireConnection[];
  faults: InjectedFault[];
  componentStates: Record<string, Record<string, number | boolean | string>>;
  activeDtcs: string[];
  supplyCurrentDrawAmps: number;
  selectedBrandKey?: string;
  selectedModelName?: string;
  selectedEcuProfileId?: string | null;
  rpmEmulator?: RpmEmulatorState;
  multimeter?: MultimeterState;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SavedDiagnosticLog {
  id: string;
  ownerId: string;
  title: string;
  dtcCode: string;
  ecuModel: string;
  sourceType: 'GROUNDED_TSB' | 'BENCH_SNAPSHOT' | 'PINOUT_NOTE';
  summary: string;
  sources: GroundedSearchSource[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SavedPcbScan {
  id: string;
  ownerId: string;
  title: string;
  boardType: string;
  analysisSummary: string;
  model: string;
  components: ImageAnalysisComponent[];
  nets: ImageAnalysisNet[];
  hotspots: ImageAnalysisHotspot[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

function makeSafeId(prefix: string): string {
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now()}_${rand}`.replace(/[^a-zA-Z0-9_\-]/g, '_').slice(0, 128);
}

/**
 * Ensure user profile document exists in Firestore under /users/{uid}.
 */
export async function syncUserProfile(
  uid: string,
  email: string,
  displayName?: string | null
): Promise<void> {
  const path = `users/${uid}`;
  const userRef = doc(db, 'users', uid);
  try {
    const snap = await getDoc(userRef);
    const safeEmail = email.slice(0, 254);
    const safeName = (displayName || '').slice(0, 120);

    if (!snap.exists()) {
      await setDoc(userRef, {
        uid,
        email: safeEmail,
        displayName: safeName,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(
        userRef,
        {
          email: safeEmail,
          displayName: safeName,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

/**
 * Save a full ECU bench workspace snapshot (wires, faults, power supply, sensor states, DTCs).
 */
export async function saveBenchSession(
  uid: string,
  payload: {
    title: string;
    notes?: string;
    ecuProfileLabel?: string;
    powerSupply: PowerSupplyState;
    wires: WireConnection[];
    faults: InjectedFault[];
    components: BenchComponent[];
    activeDtcs: string[];
    supplyCurrentDrawAmps: number;
    selectedBrandKey?: string;
    selectedModelName?: string;
    selectedEcuProfileId?: string | null;
    rpmEmulator?: RpmEmulatorState;
    multimeter?: MultimeterState;
  }
): Promise<string> {
  const sessionId = makeSafeId('bench');
  const path = `users/${uid}/benchSessions/${sessionId}`;

  const componentStates: Record<string, Record<string, number | boolean | string>> = {};
  for (const comp of payload.components) {
    if (comp.state && Object.keys(comp.state).length > 0) {
      componentStates[comp.id] = { ...comp.state };
    }
  }

  const sanitizedWires = payload.wires.slice(0, 50).map((w) => ({
    id: String(w.id).slice(0, 64),
    sourcePinId: String(w.sourcePinId).slice(0, 64),
    targetPinId: String(w.targetPinId).slice(0, 64),
    color: String(w.color).slice(0, 32),
    label: String(w.label).slice(0, 120),
    isCut: Boolean(w.isCut),
    resistance: Number(w.resistance) || 0.05,
  }));

  const sanitizedFaults = payload.faults.slice(0, 20).map((f) => ({
    pinId: String(f.pinId).slice(0, 64),
    faultType: String(f.faultType).slice(0, 48),
    description: String(f.description).slice(0, 240),
    timestamp: Number(f.timestamp) || Date.now(),
  }));

  const sanitizedDtcs = payload.activeDtcs
    .slice(0, 20)
    .map((code) => String(code).slice(0, 32));

  try {
    const docData: Record<string, unknown> = {
      id: sessionId,
      ownerId: uid,
      title: payload.title.trim().slice(0, 120) || 'ECU Bench Snapshot',
      notes: (payload.notes || '').trim().slice(0, 1000),
      ecuProfileLabel: (payload.ecuProfileLabel || 'Universal ECU Bench').trim().slice(0, 120),
      powerSupply: {
        voltageSetting: Number(payload.powerSupply.voltageSetting),
        currentLimit: Number(payload.powerSupply.currentLimit),
        isOutputEnabled: Boolean(payload.powerSupply.isOutputEnabled),
        preset: String(payload.powerSupply.preset).slice(0, 32),
      },
      wires: sanitizedWires,
      faults: sanitizedFaults,
      componentStates,
      activeDtcs: sanitizedDtcs,
      supplyCurrentDrawAmps: Number(payload.supplyCurrentDrawAmps) || 0,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (payload.selectedBrandKey !== undefined) {
      docData.selectedBrandKey = String(payload.selectedBrandKey).slice(0, 64);
    }
    if (payload.selectedModelName !== undefined) {
      docData.selectedModelName = String(payload.selectedModelName).slice(0, 120);
    }
    if (payload.selectedEcuProfileId !== undefined) {
      docData.selectedEcuProfileId = payload.selectedEcuProfileId
        ? String(payload.selectedEcuProfileId).slice(0, 64)
        : null;
    }
    if (payload.rpmEmulator) {
      docData.rpmEmulator = {
        isActive: Boolean(payload.rpmEmulator.isActive),
        rpm: Number(payload.rpmEmulator.rpm) || 850,
        soundEnabled: Boolean(payload.rpmEmulator.soundEnabled),
        camPhaseOffsetDeg: Number(payload.rpmEmulator.camPhaseOffsetDeg) || 0,
        ckpSignalLost: Boolean(payload.rpmEmulator.ckpSignalLost),
      };
    }
    if (payload.multimeter) {
      docData.multimeter = {
        mode: String(payload.multimeter.mode).slice(0, 24),
        redProbe: {
          attachedToPinId: payload.multimeter.redProbe.attachedToPinId
            ? String(payload.multimeter.redProbe.attachedToPinId).slice(0, 64)
            : null,
          attachedLabel: String(payload.multimeter.redProbe.attachedLabel || 'Unconnected').slice(0, 120),
        },
        blackProbe: {
          attachedToPinId: payload.multimeter.blackProbe.attachedToPinId
            ? String(payload.multimeter.blackProbe.attachedToPinId).slice(0, 64)
            : null,
          attachedLabel: String(payload.multimeter.blackProbe.attachedLabel || 'Unconnected').slice(0, 120),
        },
        isPowered: Boolean(payload.multimeter.isPowered),
        rangeAuto: Boolean(payload.multimeter.rangeAuto),
        holdValue: Boolean(payload.multimeter.holdValue),
      };
    }

    await setDoc(doc(db, 'users', uid, 'benchSessions', sessionId), docData);
    return sessionId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeBenchSessions(
  uid: string,
  onData: (sessions: SavedBenchSession[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `users/${uid}/benchSessions`;
  const q = query(
    collection(db, 'users', uid, 'benchSessions'),
    where('ownerId', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedBenchSession[] = snapshot.docs
        .map((d) => d.data() as SavedBenchSession)
        .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function deleteBenchSession(uid: string, sessionId: string): Promise<void> {
  const path = `users/${uid}/benchSessions/${sessionId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'benchSessions', sessionId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

/**
 * Save a Diagnostic Log or Google Search Grounding TSB/Pinout Bookmark.
 */
export async function saveDiagnosticLog(
  uid: string,
  payload: {
    title: string;
    dtcCode?: string;
    ecuModel?: string;
    sourceType: 'GROUNDED_TSB' | 'BENCH_SNAPSHOT' | 'PINOUT_NOTE';
    summary: string;
    sources?: GroundedSearchSource[];
  }
): Promise<string> {
  const logId = makeSafeId('diag');
  const path = `users/${uid}/diagnosticLogs/${logId}`;

  const sanitizedSources = (payload.sources || []).slice(0, 20).map((s) => ({
    title: String(s.title).slice(0, 200),
    uri: String(s.uri).slice(0, 1000),
    domain: String(s.domain).slice(0, 120),
  }));

  try {
    await setDoc(doc(db, 'users', uid, 'diagnosticLogs', logId), {
      id: logId,
      ownerId: uid,
      title: payload.title.trim().slice(0, 160) || 'Diagnostic Note',
      dtcCode: (payload.dtcCode || '').trim().slice(0, 32),
      ecuModel: (payload.ecuModel || '').trim().slice(0, 120),
      sourceType: payload.sourceType,
      summary: payload.summary.trim().slice(0, 12000) || 'Diagnostic summary recorded.',
      sources: sanitizedSources,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return logId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribeDiagnosticLogs(
  uid: string,
  onData: (logs: SavedDiagnosticLog[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `users/${uid}/diagnosticLogs`;
  const q = query(
    collection(db, 'users', uid, 'diagnosticLogs'),
    where('ownerId', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedDiagnosticLog[] = snapshot.docs
        .map((d) => d.data() as SavedDiagnosticLog)
        .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function deleteDiagnosticLog(uid: string, logId: string): Promise<void> {
  const path = `users/${uid}/diagnosticLogs/${logId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'diagnosticLogs', logId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function fetchBenchSessionCount(uid: string): Promise<number> {
  const path = `users/${uid}/benchSessions`;
  try {
    const q = query(
      collection(db, 'users', uid, 'benchSessions'),
      where('ownerId', '==', uid)
    );
    const snap = await getDocs(q);
    return snap.size;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

/**
 * Save a mapped ECU PCB layout (components, copper nets, and hotspots — no raw binary images).
 */
export async function savePcbScan(
  uid: string,
  payload: {
    title: string;
    boardType: string;
    analysisSummary: string;
    model: string;
    components: ImageAnalysisComponent[];
    nets: ImageAnalysisNet[];
    hotspots: ImageAnalysisHotspot[];
  }
): Promise<string> {
  const scanId = makeSafeId('pcb');
  const path = `users/${uid}/pcbScans/${scanId}`;

  const sanitizedComponents = payload.components.slice(0, 60).map((c) => ({
    refDes: String(c.refDes).slice(0, 32),
    category: String(c.category).slice(0, 64),
    marking: String(c.marking || '').slice(0, 64),
    decodedValue: String(c.decodedValue || '').slice(0, 80),
    packageType: String(c.packageType || '').slice(0, 64),
    bbox: {
      ymin: Math.round(Number(c.bbox.ymin) || 0),
      xmin: Math.round(Number(c.bbox.xmin) || 0),
      ymax: Math.round(Number(c.bbox.ymax) || 0),
      xmax: Math.round(Number(c.bbox.xmax) || 0),
    },
    confidenceScore: Number(c.confidenceScore) || 0.7,
    verificationStatus: c.verificationStatus || 'UNVERIFIED',
    circuitFunction: String(c.circuitFunction || '').slice(0, 240),
    terminalIds: (c.terminalIds || []).slice(0, 24).map((t) => String(t).slice(0, 32)),
    notes: String(c.notes || '').slice(0, 400),
    operatingVoltageRange: String(c.operatingVoltageRange || '').slice(0, 64),
    maxCurrentRating: String(c.maxCurrentRating || '').slice(0, 64),
    datasheetSummary: String(c.datasheetSummary || '').slice(0, 400),
    pinSpecs: (c.pinSpecs || []).slice(0, 24).map((p, idx) => ({
      pinNumber: Number(p.pinNumber) || idx + 1,
      pinName: String(p.pinName || '').slice(0, 40),
      category: p.category || 'signal_in',
      nominalVoltage: Number(p.nominalVoltage) || 0,
      connectedNetId: String(p.connectedNetId || 'NET_UNASSIGNED').slice(0, 64),
      notes: String(p.notes || '').slice(0, 200),
    })),
    source: c.source || 'AI',
  }));

  const sanitizedNets = payload.nets.slice(0, 40).map((n) => ({
    name: String(n.name).slice(0, 64),
    signalType: String(n.signalType || 'SIGNAL').slice(0, 48),
    connectedComponentRefs: (n.connectedComponentRefs || []).slice(0, 32).map((r) => String(r).slice(0, 32)),
    connectedTerminalIds: (n.connectedTerminalIds || []).slice(0, 32).map((t) => String(t).slice(0, 32)),
    tracePoints: (n.tracePoints || []).slice(0, 24).map((pt) => ({
      x: Math.round(Number(pt.x) || 0),
      y: Math.round(Number(pt.y) || 0),
    })),
    confidenceScore: Number(n.confidenceScore) || 0.7,
    verificationStatus: n.verificationStatus || 'UNVERIFIED',
    isComplete: Boolean(n.isComplete),
  }));

  const sanitizedHotspots = (payload.hotspots || []).slice(0, 30).map((h) => ({
    id: String(h.id).slice(0, 64),
    label: String(h.label).slice(0, 120),
    severity: h.severity || 'WARNING',
    bbox: {
      ymin: Math.round(Number(h.bbox.ymin) || 0),
      xmin: Math.round(Number(h.bbox.xmin) || 0),
      ymax: Math.round(Number(h.bbox.ymax) || 0),
      xmax: Math.round(Number(h.bbox.xmax) || 0),
    },
    suspectComponentRef: String(h.suspectComponentRef || '').slice(0, 32),
    notes: String(h.notes || '').slice(0, 300),
    source: h.source === 'AI' ? 'AI' : 'LOCAL_CV',
  }));

  try {
    await setDoc(doc(db, 'users', uid, 'pcbScans', scanId), {
      id: scanId,
      ownerId: uid,
      title: payload.title.trim().slice(0, 160) || 'Mapped ECU PCB Scan',
      boardType: payload.boardType.trim().slice(0, 120) || 'Automotive ECU PCB',
      analysisSummary: payload.analysisSummary.trim().slice(0, 4000) || 'Mapped PCB layout',
      model: payload.model.trim().slice(0, 80) || 'gemini-4-hydrogen',
      components: sanitizedComponents,
      nets: sanitizedNets,
      hotspots: sanitizedHotspots,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return scanId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export function subscribePcbScans(
  uid: string,
  onData: (scans: SavedPcbScan[]) => void,
  onError?: (err: Error) => void
): () => void {
  const path = `users/${uid}/pcbScans`;
  const q = query(
    collection(db, 'users', uid, 'pcbScans'),
    where('ownerId', '==', uid)
  );

  return onSnapshot(
    q,
    (snapshot) => {
      const items: SavedPcbScan[] = snapshot.docs
        .map((d) => d.data() as SavedPcbScan)
        .sort((a, b) => (b.updatedAt?.toMillis?.() ?? 0) - (a.updatedAt?.toMillis?.() ?? 0));
      onData(items);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, path);
      } catch (e) {
        if (onError && e instanceof Error) onError(e);
      }
    }
  );
}

export async function deletePcbScan(uid: string, scanId: string): Promise<void> {
  const path = `users/${uid}/pcbScans/${scanId}`;
  try {
    await deleteDoc(doc(db, 'users', uid, 'pcbScans', scanId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export const FORD_OEM_PINOUTS_DB_LOG_ID = 'diag_ford_oem_pinouts_v1';

export const FORD_OEM_PINOUTS_SUMMARY_TEXT = [
  'For the Ranger and Everest T6, power goes to Pin C1E148, switched ignition to Pin C1E142, and grounds to Pins C1E139 and C1E140.',
  'For the Next-Gen Ranger and Everest EcoBlue, constant power connects to Pin CBR pin 1, ignition to CBR pin 3, and grounds to CBR pins 2 and 4.',
  'For the EcoSport and Fiesta 1.5L, connect power to Pin 1, ignition to Pin 2, and ground to Pins 3 and 4.',
  'The Focus and EcoSport GDI require power on Pin 61, ignition on Pin 16, and ground on Pin 32.',
  'For the PowerShift TCM, power is applied to Pins 1 and 2, ignition to Pin 3, and grounds to Pins 4 and 5.',
  'The Territory 1.5L EcoBoost uses Pin 8 for power, Pin 9 for ignition, and Pins 10 and 11 for ground.',
  'Connecting the Ranger 2.5L NA requires power on Pin 1, ignition on Pin 2, and ground on Pins 3 and 4.',
  'Older Escape, Focus, and Duratec models take power on Pin 15, ignition on Pin 6, and ground on Pin 61.',
  'For the Explorer, power goes to Pin 103, ignition to Pin 105, and ground to Pin 116.',
  'Finally, the Transit 2.2L TDCi needs power on Pin B20, ignition on Pin B22, and ground on Pins B23 and B24.',
].join('\n');

/**
 * Automatically seeds and synchronizes the verified 10-platform Ford OEM Pinouts
 * into the user's Firestore `diagnosticLogs` collection so both the Cloud Database
 * and the Offline AI Voice Guide / MiniSearch RAG index always have this knowledge.
 */
export async function syncFordOemPinoutsToDatabase(uid: string): Promise<void> {
  const logId = FORD_OEM_PINOUTS_DB_LOG_ID;
  const path = `users/${uid}/diagnosticLogs/${logId}`;
  const docRef = doc(db, 'users', uid, 'diagnosticLogs', logId);

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return;
    }
    await setDoc(docRef, {
      id: logId,
      ownerId: uid,
      title:
        'Ford / FoMoCo OEM Bench Pinouts (T6, EcoBlue, EcoSport, Fiesta, Focus, PowerShift TCM, Territory, Explorer, Transit)',
      dtcCode: 'FORD-OEM-PINOUT',
      ecuModel: 'Ford FoMoCo PCM / PowerShift TCM Suite',
      sourceType: 'PINOUT_NOTE',
      summary: FORD_OEM_PINOUTS_SUMMARY_TEXT,
      sources: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export const TOYOTA_OEM_PINOUTS_DB_LOG_ID = 'diag_toyota_oem_pinouts_v1';

export const TOYOTA_OEM_PINOUTS_SUMMARY_TEXT = [
  '⚠️ WARNING: Pinout Verification & Polarity: Always cross-check the exact Denso/Fujitsu Ten part number on the ECU case and verify ground continuity with a multimeter before applying +12V bench power. Toyota connectors (A/B/C/D or E1–E6) vary slightly across model years and emissions tiers (Euro 2 vs. Euro 4).',
  '1. Hilux / Fortuner / Innova (2.8L 1GD-FTV & 2.4L 2GD-FTV, Denso): Constant Power (+B / +B2): A1, A2 | Switched Ignition (IGSW): A28 | Ground (GND / E1 / ME01): A3, A4, B1 | CAN Bus: A41 (H) / A42 (L) | NE+ (CKP): B14 | G2+ (CMP): B15 | PCR1 (FRP): B32 | SCV+: B48.',
  '2. Hilux / Fortuner / Hiace (3.0L 1KD-FTV & 2.5L 2KD-FTV, Denso): Constant Power (+B / +B2): E5-1, E5-2 | Switched Ignition (IGSW): E5-9 | Ground (GND / E1 / ME01): E5-3, E6-1 | CAN Bus: E5-23 (H) / E5-24 (L) | NE+ (CKP): E6-12 | G2+ (CMP): E6-13 | PCR1 (FRP): E6-25 | SCV+: E6-31.',
  '3. Innova (2.0L 1TR-FE VVT-i Gasoline, Denso): Constant Power (+B): A1, A2 | Switched Ignition (IGSW): A18 | Ground (GND / E1): A3, B1 | CAN Bus: A33 (H) / A34 (L) | NE+ (CKP): B11 | G2+ (CMP): B12 | VTA1 (TPS): B21 | IGT1: B36.',
  '4. Hiace Commuter / GL Grandia (2.8L 1GD-FTV, Denso): Constant Power (+B / +B2): A1, A2 | Switched Ignition (IGSW): A28 | Ground (GND / E1): A3, A4, B1 | CAN Bus: A41 (H) / A42 (L) | NE+ (CKP): B14 | G2+ (CMP): B15 | PCR1 (FRP): B32 | EGR PWM: B54.',
  '5. Vios / Yaris (1.5L 1NZ-FE & 1.3L 2NZ-FE, Denso): Constant Power (+B / BATT): A1, A2 | Switched Ignition (IGSW): A15 | Ground (GND / E1): A3, B1 | CAN Bus: A27 (H) / A28 (L) | NE+ (CKP): B10 | G2+ (CMP): B11 | VTA1 (TPS): B19 | IGT1: B32.',
  '6. Vios / Yaris (1.5L 2NR-FE & 1.3L 1NR-FE Dual VVT-i, Denso): Constant Power (+B / BATT): A1, A2 | Switched Ignition (IGSW): A21 | Ground (GND / E1): A3, A4, B1 | CAN Bus: A37 (H) / A38 (L) | NE+ (CKP): B12 | G2+ (CMP): B13 | VTA1 (TPS): B24 | IGT1: B40.',
  '7. Wigo / Agya (1.0L 1KR-FE / 1KR-VE, Denso): Constant Power (+B / BATT): A1, A2 | Switched Ignition (IGSW): A12 | Ground (GND / E1): A3, B1 | CAN Bus: A22 (H) / A23 (L) | NE+ (CKP): B8 | G2+ (CMP): B9 | PIM (MAP): B16 | IGT1: B28.',
  '8. Avanza / Rush (1.5L 2NR-VE & 1.3L 1NR-VE, Denso): Constant Power (+B / BATT): A1, A2 | Switched Ignition (IGSW): A19 | Ground (GND / E1): A3, B1 | CAN Bus: A31 (H) / A32 (L) | NE+ (CKP): B11 | G2+ (CMP): B12 | PIM (MAP): B20 | IGT1: B35.',
  '9. Corolla Altis (1.6L 1ZR-FE & 1.8L 2ZR-FE Dual VVT-i, Denso): Constant Power (+B / +B2): A1, A2 | Switched Ignition (IGSW): A24 | Ground (GND / E1): A3, A4, B1 | CAN Bus: A39 (H) / A40 (L) | NE+ (CKP): B13 | G2+ (CMP): B14 | VG (MAF): B22 | IGT1: B42.',
  '10. Fortuner / Hilux 6AT TCM (Aisin AC60E / AC60F): Constant Power (+B): Pin 1, Pin 2 | Switched Ignition (IG): Pin 11 | Ground (GND / E1): Pin 15, Pin 16 | CAN Bus: Pin 21 (H) / Pin 22 (L) | NT (Input Spd): Pin 5 | SP2 (Output Spd): Pin 6 | SL1: Pin 12.',
].join('\n');

/**
 * Automatically seeds and synchronizes the verified 10-platform PH-Market Toyota OEM ECU & TCM Bench Pinouts
 * and mandatory Pinout Verification & Polarity Warning into the user's Firestore `diagnosticLogs` collection
 * so both the Cloud Database and the Offline AI Voice Guide / MiniSearch RAG index always have this knowledge.
 */
export async function syncToyotaOemPinoutsToDatabase(uid: string): Promise<void> {
  const logId = TOYOTA_OEM_PINOUTS_DB_LOG_ID;
  const path = `users/${uid}/diagnosticLogs/${logId}`;
  const docRef = doc(db, 'users', uid, 'diagnosticLogs', logId);

  try {
    const snap = await getDoc(docRef);
    if (snap.exists()) {
      return;
    }
    await setDoc(docRef, {
      id: logId,
      ownerId: uid,
      title:
        'Toyota OEM ECU Bench Test Pinouts (PH Market — 1GD/2GD, 1KD/2KD, 1TR, 1NZ, 2NR, 1KR, 2NR-VE, 1ZR, 6AT TCM)',
      dtcCode: 'TOYOTA-OEM-PINOUT',
      ecuModel: 'Toyota Denso ECM / Aisin AC60 6AT TCM Suite',
      sourceType: 'PINOUT_NOTE',
      summary: TOYOTA_OEM_PINOUTS_SUMMARY_TEXT,
      sources: [],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}


