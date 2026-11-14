import React, { Suspense, lazy, useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEFAULT_ECU_PINS,
  DEFAULT_BENCH_COMPONENTS,
  DEFAULT_WIRES,
  solveCircuit,
} from './utils/circuitSolver';
import {
  EcuPin,
  BenchComponent,
  WireConnection,
  InjectedFault,
  FaultType,
  MultimeterState,
  PowerSupplyState,
} from './types/ecu';
import { LabTopNav, LabTab, MobileBenchPane, RackFilter } from './components/LabTopNav';
import { LabWorkspaceLayout } from './components/LabWorkspaceLayout';
import { LabStatusFooter } from './components/LabStatusFooter';
import { recordRenderCycle } from './utils/perfMonitor';
import {
  SavedBenchSession,
  SavedDiagnosticLog,
  subscribeBenchSessions,
  subscribeDiagnosticLogs,
  syncFordOemPinoutsToDatabase,
} from './services/benchStorageService';
import { useAuth } from './context/AuthContext';
import {
  RpmEmulatorState,
  UNIVERSAL_BRAND_KEY,
  applyEcuProfileToPins,
  getEcuProfileById,
} from './utils/vehicleEcuRegistry';
import { stopRpmEmulatorAudio, updateRpmEmulatorAudio } from './utils/audioFeedback';

const IntroductionModal = lazy(() =>
  import('./components/IntroductionModal').then((m) => ({ default: m.IntroductionModal }))
);
const GroundedSearchModal = lazy(() =>
  import('./components/GroundedSearchModal').then((m) => ({ default: m.GroundedSearchModal }))
);
const BenchCloudModal = lazy(() =>
  import('./components/BenchCloudModal').then((m) => ({ default: m.BenchCloudModal }))
);
const OfflineAssistantModal = lazy(() =>
  import('./components/OfflineAssistantModal').then((m) => ({ default: m.OfflineAssistantModal }))
);
const GoogleDocsModal = lazy(() =>
  import('./components/GoogleDocsModal').then((m) => ({ default: m.GoogleDocsModal }))
);

function shouldSkipIntroOnLoad(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).get('autostart') === '1';
}

export default function App() {
  const { user, authReady } = useAuth();

  // Introduction View Modal (opens automatically unless ?autostart=1 is provided)
  const [showIntroModal, setShowIntroModal] = useState(() => !shouldSkipIntroOnLoad());

  // Saved Bench & Diagnostic Logs Modal
  const [showCloudModal, setShowCloudModal] = useState(false);

  // Google Docs OEM Diagnostic Report & Notes Modal
  const [showDocsModal, setShowDocsModal] = useState(false);

  // 100% Offline MiniSearch Diagnostic Chatbot Modal (lazy-initialized on first open)
  const [showOfflineBot, setShowOfflineBot] = useState(false);
  const [hasOpenedOfflineBot, setHasOpenedOfflineBot] = useState(false);
  const [offlineBotPrompt, setOfflineBotPrompt] = useState<string | null>(null);
  const [showDiagnosticGuide, setShowDiagnosticGuide] = useState(true);
  const [savedLogs, setSavedLogs] = useState<SavedDiagnosticLog[]>([]);
  const [savedSessions, setSavedSessions] = useState<SavedBenchSession[]>([]);

  const handleOpenOfflineBot = useCallback((prompt?: string) => {
    setHasOpenedOfflineBot(true);
    setOfflineBotPrompt(prompt || null);
    setShowOfflineBot(true);
  }, []);

  useEffect(() => {
    if (!authReady || !user) {
      setSavedLogs([]);
      setSavedSessions([]);
      return;
    }

    syncFordOemPinoutsToDatabase(user.uid).catch(() => {});

    const unsubLogs = subscribeDiagnosticLogs(
      user.uid,
      (logs) => setSavedLogs(logs),
      () => {}
    );
    const unsubSessions = subscribeBenchSessions(
      user.uid,
      (sessions) => setSavedSessions(sessions),
      () => {}
    );

    return () => {
      unsubLogs();
      unsubSessions();
    };
  }, [authReady, user]);

  // Live Google Search Grounding Modal State
  const [showSearchModal, setShowSearchModal] = useState(false);
  const [groundedSearchQuery, setGroundedSearchQuery] = useState('');
  const [groundedSearchDtc, setGroundedSearchDtc] = useState('');
  const [groundedSearchEcu, setGroundedSearchEcu] = useState('');

  const handleOpenGroundedSearch = useCallback((query?: string, dtc?: string, ecu?: string) => {
    setGroundedSearchQuery(query || '');
    setGroundedSearchDtc(dtc || '');
    setGroundedSearchEcu(ecu || '');
    setShowSearchModal(true);
  }, []);

  // Navigation & Layout State
  const [activeTab, setActiveTab] = useState<LabTab>('BENCH_LAB');
  const [rackFilter, setRackFilter] = useState<RackFilter>('ALL');
  const [mobileBenchPane, setMobileBenchPane] = useState<MobileBenchPane>('INSTRUMENTS');
  const [simulationSpeed, setSimulationSpeed] = useState<number>(1.0);

  // Core Bench State
  const [powerSupply, setPowerSupply] = useState<PowerSupplyState>({
    voltageSetting: 12.6,
    currentLimit: 5.0,
    isOutputEnabled: true,
    preset: '12V_BENCH',
  });

  const [pins, setPins] = useState<EcuPin[]>(DEFAULT_ECU_PINS);
  const [components, setComponents] = useState<BenchComponent[]>(DEFAULT_BENCH_COMPONENTS);
  const [wires, setWires] = useState<WireConnection[]>(DEFAULT_WIRES);
  const [faults, setFaults] = useState<InjectedFault[]>([]);
  const [selectedPinId, setSelectedPinId] = useState<string | null>('ecu-pin-7');

  // Selected Vehicle Car / Model / ECU Profile & RPM Emulator State
  const [selectedBrandKey, setSelectedBrandKey] = useState<string>(UNIVERSAL_BRAND_KEY);
  const [selectedModelName, setSelectedModelName] = useState<string>('Generic 16-Pin Bench');
  const [selectedEcuProfileId, setSelectedEcuProfileId] = useState<string | null>(null);
  const [rpmEmulator, setRpmEmulator] = useState<RpmEmulatorState>({
    isActive: false,
    rpm: 850,
    soundEnabled: true,
  });

  // Synchronize RPM Emulator minimal sound synthesizer with active state, RPM, mute & PSU output
  useEffect(() => {
    const isEffectivelyEnergized = rpmEmulator.isActive && powerSupply.isOutputEnabled;
    updateRpmEmulatorAudio(isEffectivelyEnergized, rpmEmulator.rpm, rpmEmulator.soundEnabled);
  }, [rpmEmulator.isActive, rpmEmulator.rpm, rpmEmulator.soundEnabled, powerSupply.isOutputEnabled]);

  useEffect(() => {
    return () => {
      stopRpmEmulatorAudio();
    };
  }, []);

  // Multimeter State
  const [multimeter, setMultimeter] = useState<MultimeterState>({
    mode: 'V_DC',
    redProbe: { attachedToPinId: 'ecu-pin-7', attachedLabel: 'TPS_SIG (Pin 7)' },
    blackProbe: { attachedToPinId: 'chassis-gnd', attachedLabel: 'Chassis GND (KL31)' },
    isPowered: true,
    rangeAuto: true,
    holdValue: false,
  });

  useEffect(() => {
    recordRenderCycle('App');
  });

  const wire9 = useMemo(() => wires.find((w) => w.id === 'wire-9'), [wires]);
  const wire10 = useMemo(() => wires.find((w) => w.id === 'wire-10'), [wires]);
  const wire11 = useMemo(() => wires.find((w) => w.id === 'wire-11'), [wires]);

  const hasCanFault = useMemo(
    () =>
      faults.some((f) => f.pinId === 'ecu-pin-13' || f.pinId === 'ecu-pin-14') ||
      Boolean(wire10?.isCut) ||
      Boolean(wire11?.isCut),
    [faults, wire10?.isCut, wire11?.isCut]
  );

  const hasInjectorFault = useMemo(
    () => faults.some((f) => f.pinId === 'ecu-pin-10') || Boolean(wire9?.isCut),
    [faults, wire9?.isCut]
  );

  const isInjectorFiring = useMemo(() => {
    const inj = components.find((c) => c.id === 'comp-inj');
    return Boolean(inj?.state?.isFiring ?? true);
  }, [components]);

  // Memoize MNA circuit solution so UI-only state changes never re-allocate solver matrices
  const circuitSolution = useMemo(() => {
    recordRenderCycle('MnaSolver');
    return solveCircuit(powerSupply, pins, faults, wires, components, multimeter, {
      rpm: rpmEmulator.isActive ? rpmEmulator.rpm : 850,
      isInjectorFiring,
      hasCanFault,
      hasInjectorFault,
      camPhaseOffsetDeg: rpmEmulator.camPhaseOffsetDeg ?? 0,
      ckpSignalLost: Boolean(rpmEmulator.ckpSignalLost),
    });
  }, [
    powerSupply,
    pins,
    faults,
    wires,
    components,
    multimeter,
    rpmEmulator.isActive,
    rpmEmulator.rpm,
    rpmEmulator.camPhaseOffsetDeg,
    rpmEmulator.ckpSignalLost,
    isInjectorFiring,
    hasCanFault,
    hasInjectorFault,
  ]);

  const offlineBotLiveContext = useMemo(
    () => ({
      powerSupply,
      pins,
      wires,
      faults,
      activeDTCs: circuitSolution.activeDTCs,
      nodeVoltages: circuitSolution.nodeVoltages,
      supplyCurrentDrawAmps: circuitSolution.supplyCurrentDrawAmps,
      isSupplyCurrentTripped: circuitSolution.isSupplyCurrentTripped,
      multimeter,
      multimeterDisplay: circuitSolution.multimeterReading.display,
      multimeterUnit: circuitSolution.multimeterReading.unit,
      multimeterWarning: circuitSolution.multimeterReading.warningMessage,
      selectedPinId,
    }),
    [powerSupply, pins, wires, faults, circuitSolution, multimeter, selectedPinId]
  );

  // Fault management handlers
  const handleAddFault = useCallback((pinId: string, faultType: FaultType, description: string) => {
    setFaults((prev) => {
      const filtered = prev.filter((f) => f.pinId !== pinId);
      return [...filtered, { pinId, faultType, description, timestamp: Date.now() }];
    });
  }, []);

  const handleRemoveFault = useCallback((pinId: string) => {
    setFaults((prev) => prev.filter((f) => f.pinId !== pinId));
  }, []);

  const handleClearAllFaults = useCallback(() => {
    setFaults([]);
  }, []);

  const handleSearchDtcFromInjector = useCallback(
    (code: string, desc: string) => {
      const profile = getEcuProfileById(selectedEcuProfileId);
      const ecuLabel = profile
        ? `${profile.brandName} ${selectedModelName} (${profile.modelName})`
        : 'Universal Bench';
      handleOpenGroundedSearch(
        `${code} ${desc} ${ecuLabel} diagnostic procedure technical service bulletin`,
        code,
        ecuLabel
      );
    },
    [handleOpenGroundedSearch, selectedEcuProfileId, selectedModelName]
  );

  // Wire management
  const handleAddWire = useCallback(
    (sourcePinId: string, targetPinId: string, color?: string, label?: string) => {
      setWires((prev) => {
        const exists = prev.some(
          (w) =>
            (w.sourcePinId === sourcePinId && w.targetPinId === targetPinId) ||
            (w.sourcePinId === targetPinId && w.targetPinId === sourcePinId)
        );
        if (exists) return prev;

        const uniqueId =
          typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
            ? `wire-${crypto.randomUUID().slice(0, 8)}`
            : `wire-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

        const newWire: WireConnection = {
          id: uniqueId,
          sourcePinId,
          targetPinId,
          color: color || '#06b6d4',
          label: label || 'Auxiliary Harness Lead',
          isCut: false,
          resistance: 0.05,
        };
        return [...prev, newWire];
      });
    },
    []
  );

  const handleToggleCutWire = useCallback((wireId: string) => {
    setWires((prev) => prev.map((w) => (w.id === wireId ? { ...w, isCut: !w.isCut } : w)));
  }, []);

  const handleDeleteWire = useCallback((wireId: string) => {
    setWires((prev) => prev.filter((w) => w.id !== wireId));
  }, []);

  const handleUpdateComponentState = useCallback(
    (compId: string, updates: Record<string, number | boolean | string>) => {
      setComponents((prev) =>
        prev.map((c) => (c.id === compId ? { ...c, state: { ...c.state, ...updates } } : c))
      );
    },
    []
  );

  const handleAttachProbe = useCallback((color: 'red' | 'black', pinId: string, label: string) => {
    if (color === 'red') {
      setMultimeter((prev) => ({
        ...prev,
        redProbe: { attachedToPinId: pinId, attachedLabel: label },
      }));
    } else {
      setMultimeter((prev) => ({
        ...prev,
        blackProbe: { attachedToPinId: pinId, attachedLabel: label },
      }));
    }
  }, []);

  const handleOpenEcuPinouts = useCallback(() => {
    setActiveTab('ECU_PINOUT');
  }, []);

  const handleSelectVehicleEcu = useCallback(
    (brandKey: string, modelName: string, ecuProfileId: string | null) => {
      setSelectedBrandKey(brandKey);
      setSelectedModelName(modelName);
      setSelectedEcuProfileId(ecuProfileId);
      setPins(applyEcuProfileToPins(ecuProfileId, DEFAULT_ECU_PINS));
    },
    []
  );

  // Reset entire laboratory to pristine factory state
  const handleResetLab = useCallback(() => {
    stopRpmEmulatorAudio();
    setPowerSupply({
      voltageSetting: 12.6,
      currentLimit: 5.0,
      isOutputEnabled: true,
      preset: '12V_BENCH',
    });
    setSelectedBrandKey(UNIVERSAL_BRAND_KEY);
    setSelectedModelName('Generic 16-Pin Bench');
    setSelectedEcuProfileId(null);
    setRpmEmulator({ isActive: false, rpm: 850, soundEnabled: true });
    setPins(DEFAULT_ECU_PINS);
    setComponents(DEFAULT_BENCH_COMPONENTS);
    setWires(DEFAULT_WIRES);
    setFaults([]);
    setSelectedPinId('ecu-pin-7');
    setMultimeter({
      mode: 'V_DC',
      redProbe: { attachedToPinId: 'ecu-pin-7', attachedLabel: 'TPS_SIG (Pin 7)' },
      blackProbe: { attachedToPinId: 'chassis-gnd', attachedLabel: 'Chassis GND (KL31)' },
      isPowered: true,
      rangeAuto: true,
      holdValue: false,
    });
  }, []);

  // Restore saved bench session into live MNA state
  const handleLoadBenchSession = useCallback((session: SavedBenchSession) => {
    if (session.powerSupply) {
      setPowerSupply(session.powerSupply);
    }
    if (Array.isArray(session.wires)) {
      setWires(session.wires);
    }
    if (Array.isArray(session.faults)) {
      setFaults(
        session.faults.map((f) => ({
          pinId: f.pinId,
          faultType: f.faultType as FaultType,
          description: f.description,
          timestamp: f.timestamp,
        }))
      );
    }
    if (session.componentStates) {
      setComponents((prev) =>
        prev.map((c) =>
          session.componentStates[c.id]
            ? { ...c, state: { ...c.state, ...session.componentStates[c.id] } }
            : c
        )
      );
    }
    if (session.selectedBrandKey) {
      const nextBrand = session.selectedBrandKey;
      const nextModel = session.selectedModelName || 'Generic 16-Pin Bench';
      const nextProfileId = session.selectedEcuProfileId ?? null;
      setSelectedBrandKey(nextBrand);
      setSelectedModelName(nextModel);
      setSelectedEcuProfileId(nextProfileId);
      setPins(applyEcuProfileToPins(nextProfileId, DEFAULT_ECU_PINS));
    }
    if (session.rpmEmulator) {
      setRpmEmulator({
        isActive: Boolean(session.rpmEmulator.isActive),
        rpm: Number(session.rpmEmulator.rpm) || 850,
        soundEnabled: session.rpmEmulator.soundEnabled !== false,
        camPhaseOffsetDeg: Number(session.rpmEmulator.camPhaseOffsetDeg) || 0,
        ckpSignalLost: Boolean(session.rpmEmulator.ckpSignalLost),
      });
    }
    if (session.multimeter) {
      setMultimeter(session.multimeter);
    }
  }, []);

  const selectedPin = pins.find((p) => p.id === selectedPinId);

  const handleQuickAttachRedProbe = useCallback(() => {
    if (!selectedPinId) return;
    const label = selectedPin ? `${selectedPin.label} (${selectedPin.name})` : selectedPinId;
    handleAttachProbe('red', selectedPinId, label);
  }, [selectedPinId, selectedPin, handleAttachProbe]);

  const handleQuickAttachBlackProbe = useCallback(() => {
    handleAttachProbe('black', 'chassis-gnd', 'Chassis GND (KL31)');
  }, [handleAttachProbe]);

  return (
    <div className="flex flex-col h-[100dvh] hud-shell text-slate-100 font-body select-none overflow-hidden">
      <LabTopNav
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        simulationSpeed={simulationSpeed}
        onChangeSimulationSpeed={setSimulationSpeed}
        circuitSolution={circuitSolution}
        isSignedIn={Boolean(user)}
        onOpenCloudModal={() => setShowCloudModal(true)}
        onOpenDocsModal={() => setShowDocsModal(true)}
        onOpenOfflineBot={() => handleOpenOfflineBot()}
        onOpenGroundedSearch={() => handleOpenGroundedSearch()}
        onOpenIntroModal={() => setShowIntroModal(true)}
        onResetLab={handleResetLab}
      />

      <LabWorkspaceLayout
        activeTab={activeTab}
        onNavigateTab={setActiveTab}
        rackFilter={rackFilter}
        onChangeRackFilter={setRackFilter}
        mobileBenchPane={mobileBenchPane}
        onChangeMobileBenchPane={setMobileBenchPane}
        showDiagnosticGuide={showDiagnosticGuide}
        onSetShowDiagnosticGuide={setShowDiagnosticGuide}
        simulationSpeed={simulationSpeed}
        powerSupply={powerSupply}
        onChangePowerSupply={setPowerSupply}
        multimeter={multimeter}
        onChangeMultimeter={setMultimeter}
        circuitSolution={circuitSolution}
        pins={pins}
        components={components}
        wires={wires}
        faults={faults}
        selectedPinId={selectedPinId}
        onSelectPin={setSelectedPinId}
        onAddFault={handleAddFault}
        onRemoveFault={handleRemoveFault}
        onClearAllFaults={handleClearAllFaults}
        onSearchDtc={handleSearchDtcFromInjector}
        onAddWire={handleAddWire}
        onToggleCutWire={handleToggleCutWire}
        onDeleteWire={handleDeleteWire}
        onAttachProbe={handleAttachProbe}
        onUpdateComponentState={handleUpdateComponentState}
        onOpenEcuPinouts={handleOpenEcuPinouts}
        onOpenOfflineBot={handleOpenOfflineBot}
        onOpenGroundedSearch={handleOpenGroundedSearch}
        onOpenCloudModal={() => setShowCloudModal(true)}
        onResetLab={handleResetLab}
        hasCanFault={hasCanFault}
        hasInjectorFault={hasInjectorFault}
        selectedBrandKey={selectedBrandKey}
        selectedModelName={selectedModelName}
        selectedEcuProfileId={selectedEcuProfileId}
        onSelectVehicleEcu={handleSelectVehicleEcu}
        rpmEmulator={rpmEmulator}
        onChangeRpmEmulator={setRpmEmulator}
        savedSessions={savedSessions}
        savedLogs={savedLogs}
      />

      <LabStatusFooter
        activeTab={activeTab}
        selectedPin={selectedPin}
        circuitSolution={circuitSolution}
        wires={wires}
        showDiagnosticGuide={showDiagnosticGuide}
        onToggleDiagnosticGuide={() => setShowDiagnosticGuide((prev) => !prev)}
        onQuickAttachRedProbe={handleQuickAttachRedProbe}
        onQuickAttachBlackProbe={handleQuickAttachBlackProbe}
      />

      {/* Introduction & Executive Credentials Modal */}
      {showIntroModal && (
        <Suspense fallback={null}>
          <IntroductionModal
            isOpen={showIntroModal}
            onClose={() => setShowIntroModal(false)}
          />
        </Suspense>
      )}

      {/* Live Google Search Grounding Modal */}
      {showSearchModal && (
        <Suspense fallback={null}>
          <GroundedSearchModal
            isOpen={showSearchModal}
            onClose={() => setShowSearchModal(false)}
            initialQuery={groundedSearchQuery}
            initialDtc={groundedSearchDtc}
            initialEcu={groundedSearchEcu}
          />
        </Suspense>
      )}

      {/* Saved Bench Workspaces & Diagnostic Case Logs Modal */}
      {showCloudModal && (
        <Suspense fallback={null}>
          <BenchCloudModal
            isOpen={showCloudModal}
            onClose={() => setShowCloudModal(false)}
            powerSupply={powerSupply}
            wires={wires}
            faults={faults}
            components={components}
            activeDTCs={circuitSolution.activeDTCs}
            supplyCurrentDrawAmps={circuitSolution.supplyCurrentDrawAmps}
            selectedBrandKey={selectedBrandKey}
            selectedModelName={selectedModelName}
            selectedEcuProfileId={selectedEcuProfileId}
            rpmEmulator={rpmEmulator}
            multimeter={multimeter}
            onLoadBenchSession={handleLoadBenchSession}
          />
        </Suspense>
      )}

      {/* Google Docs OEM Diagnostic Reports & Lab Notes Modal */}
      {showDocsModal && (
        <Suspense fallback={null}>
          <GoogleDocsModal
            isOpen={showDocsModal}
            onClose={() => setShowDocsModal(false)}
            powerSupply={powerSupply}
            pins={pins}
            wires={wires}
            faults={faults}
            multimeter={multimeter}
            circuitSolution={circuitSolution}
          />
        </Suspense>
      )}

      {/* 100% Offline Diagnostic Chatbot Modal */}
      {hasOpenedOfflineBot && (
        <Suspense fallback={null}>
          <OfflineAssistantModal
            isOpen={showOfflineBot}
            onClose={() => setShowOfflineBot(false)}
            liveContext={offlineBotLiveContext}
            savedLogs={savedLogs}
            savedSessions={savedSessions}
            initialPrompt={offlineBotPrompt}
            onClearInitialPrompt={() => setOfflineBotPrompt(null)}
            pins={pins}
            onSetVoltage={(volts) => setPowerSupply((prev) => ({ ...prev, voltageSetting: volts }))}
            onResetLab={handleResetLab}
            onAttachProbeToPin={(pinId, label) => handleAttachProbe('red', pinId, label)}
            onSetPowerSupplyOutput={(enabled) =>
              setPowerSupply((prev) => ({ ...prev, isOutputEnabled: enabled }))
            }
            onNavigateTab={(tab, pinId) => {
              setActiveTab(tab);
              if (pinId) {
                setSelectedPinId(pinId);
              }
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
