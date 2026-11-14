import React, { useEffect, useMemo, useState } from 'react';
import { EcuPin, FaultType, InjectedFault, DiagnosticTroubleCode } from '../types/ecu';
import {
  AlertTriangle,
  ShieldCheck,
  Trash2,
  ZapOff,
  CheckCircle2,
  Flame,
  Wrench,
  Sparkles,
  Globe,
  Activity,
  Database,
  ChevronDown,
  ChevronUp,
  Play,
} from 'lucide-react';
import { recordRenderCycle } from '../utils/perfMonitor';
import { BENCH_TEST_SCENARIOS, getBenchTestScenarios } from '../utils/oemKnowledgeDatabase';

interface FaultInjectorProps {
  pins: EcuPin[];
  faults: InjectedFault[];
  activeDTCs: DiagnosticTroubleCode[];
  onAddFault: (pinId: string, faultType: FaultType, description: string) => void;
  onRemoveFault: (pinId: string) => void;
  onClearAll: () => void;
  selectedPinId: string | null;
  onSelectPin: (pinId: string) => void;
  onSearchDtc?: (dtcCode: string, description: string) => void;
  selectedBrandKey?: string;
  nodeVoltages?: Record<string, number>;
}

export const FaultInjector: React.FC<FaultInjectorProps> = React.memo(({
  pins,
  faults,
  activeDTCs,
  onAddFault,
  onRemoveFault,
  onClearAll,
  selectedPinId,
  onSelectPin,
  onSearchDtc,
  selectedBrandKey,
  nodeVoltages = {},
}) => {
  const [scenariosOpen, setScenariosOpen] = useState(false);
  const [showAllBrands, setShowAllBrands] = useState(true);
  useEffect(() => {
    recordRenderCycle('FaultInjector');
  });

  const currentPin = pins.find(p => p.id === selectedPinId) || pins[0] || null;
  if (!currentPin) {
    return (
      <div className="hud-panel rounded-xl p-3.5 text-xs font-mono text-slate-400">
        No ECU pins loaded for fault injection.
      </div>
    );
  }
  const activeFaultForPin = faults.find(f => f.pinId === currentPin.id);

  const faultOptions: { type: FaultType; label: string; desc: string; icon: React.ReactNode; color: string }[] = [
    { type: 'NONE', label: 'Nominal (No Fault)', desc: 'Clean OEM pin connection without electrical fault', icon: <ShieldCheck className="w-4 h-4 text-emerald-400" />, color: 'hover:border-emerald-500' },
    { type: 'OPEN_CIRCUIT', label: 'Open Circuit (Harness Break)', desc: 'Terminal pushed out, broken copper strand, or unseated pin', icon: <ZapOff className="w-4 h-4 text-amber-400" />, color: 'hover:border-amber-500' },
    { type: 'SHORT_TO_GND', label: 'Short to Ground (KL31)', desc: 'Harness pinched against chassis metal / engine block ground', icon: <AlertTriangle className="w-4 h-4 text-rose-400" />, color: 'hover:border-rose-500' },
    { type: 'SHORT_TO_VBAT', label: 'Short to Battery (+12V)', desc: 'Harness melted/shorted to constant unswitched +12V battery rail', icon: <Flame className="w-4 h-4 text-orange-400" />, color: 'hover:border-orange-500' },
    { type: 'HIGH_RESISTANCE_50R', label: 'High Resistance (+50Ω)', desc: 'Mild connector pin fretting corrosion / oxidation', icon: <Wrench className="w-4 h-4 text-yellow-400" />, color: 'hover:border-yellow-500' },
    { type: 'HIGH_RESISTANCE_250R', label: 'High Resistance (+250Ω)', desc: 'Moderate water intrusion & terminal green-crust corrosion', icon: <Wrench className="w-4 h-4 text-yellow-500" />, color: 'hover:border-yellow-500' },
  ];

  // Quick Automotive Diagnostic Scenarios
  const runScenario = (pinId: string, faultType: FaultType, desc: string) => {
    onSelectPin(pinId);
    onAddFault(pinId, faultType, desc);
  };

  const visibleBenchScenarios = useMemo(() => {
    if (showAllBrands || !selectedBrandKey || selectedBrandKey === 'universal-bench') {
      return BENCH_TEST_SCENARIOS;
    }
    const brandFiltered = getBenchTestScenarios(selectedBrandKey);
    return brandFiltered.length > 0 ? brandFiltered : BENCH_TEST_SCENARIOS;
  }, [showAllBrands, selectedBrandKey]);

  const activePinById = useMemo(() => {
    const map = new Map<string, EcuPin>();
    for (const p of pins) {
      map.set(p.id, p);
    }
    return map;
  }, [pins]);

  return (
    <div className="hud-panel rounded-xl p-3.5 flex flex-col gap-3.5 text-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-cyan-500/15 pb-2">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-400" />
          <span className="text-sm font-hud font-bold tracking-wider text-slate-100 uppercase">
            Fault Injection Matrix
          </span>
        </div>
        {faults.length > 0 && (
          <button
            onClick={onClearAll}
            className="text-[10px] font-mono text-rose-400 hover:text-rose-300 flex items-center gap-1 bg-rose-950/40 px-2 py-0.5 rounded border border-rose-800 transition"
          >
            <Trash2 className="w-3 h-3" /> Clear All ({faults.length})
          </button>
        )}
      </div>

      {/* Quick Scenario Presets */}
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-1.5 text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          <div className="flex items-center gap-1.5">
            <Sparkles className="w-3 h-3 text-cyan-400" />
            <span>Diagnostic Scenarios</span>
          </div>
          <button
            type="button"
            onClick={() => setScenariosOpen((prev) => !prev)}
            className="flex items-center gap-1 px-1.5 py-0.5 rounded border border-cyan-500/40 bg-cyan-950/40 hover:bg-cyan-900/50 text-cyan-300 transition normal-case text-[10px]"
            aria-expanded={scenariosOpen}
          >
            <Database className="w-2.5 h-2.5" />
            <span>OEM Scenarios DB ({BENCH_TEST_SCENARIOS.length})</span>
            {scenariosOpen ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-[10px] font-mono">
          <button
            onClick={() => runScenario('ecu-pin-7', 'OPEN_CIRCUIT', 'TPS Signal Wire Break')}
            className="p-1.5 bg-slate-950 border border-slate-800 hover:border-amber-500 rounded text-left text-slate-300 transition"
          >
            <span className="text-amber-400 font-semibold block">TPS Wire Break</span>
            <span className="text-[9px] text-slate-500">Triggers P0122</span>
          </button>
          <button
            onClick={() => runScenario('ecu-pin-13', 'SHORT_TO_GND', 'CAN_H Shorted to GND')}
            className="p-1.5 bg-slate-950 border border-slate-800 hover:border-rose-500 rounded text-left text-slate-300 transition"
          >
            <span className="text-rose-400 font-semibold block">CAN Bus Short</span>
            <span className="text-[9px] text-slate-500">Triggers U0001</span>
          </button>
          <button
            onClick={() => runScenario('ecu-pin-10', 'OPEN_CIRCUIT', 'Injector 1 Open Circuit')}
            className="p-1.5 bg-slate-950 border border-slate-800 hover:border-amber-500 rounded text-left text-slate-300 transition"
          >
            <span className="text-amber-400 font-semibold block">Injector 1 Open</span>
            <span className="text-[9px] text-slate-500">Triggers P0201</span>
          </button>
          <button
            onClick={() => runScenario('ecu-pin-1', 'HIGH_RESISTANCE_50R', 'Main Ground Fretting')}
            className="p-1.5 bg-slate-950 border border-slate-800 hover:border-yellow-500 rounded text-left text-slate-300 transition"
          >
            <span className="text-yellow-400 font-semibold block">Ground Corrosion</span>
            <span className="text-[9px] text-slate-500">+50Ω Ground Offset</span>
          </button>
        </div>

        {/* Expandable OEM Bench Test Scenarios Database */}
        {scenariosOpen && (
          <div className="mt-1 p-2 rounded-lg bg-slate-950/90 border border-cyan-500/30 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2 text-[10px] font-mono border-b border-slate-800 pb-1.5">
              <span className="text-cyan-300 font-semibold">
                PH Market Bench Scenarios ({visibleBenchScenarios.length})
              </span>
              {selectedBrandKey && selectedBrandKey !== 'universal-bench' && (
                <button
                  type="button"
                  onClick={() => setShowAllBrands((prev) => !prev)}
                  className="px-1.5 py-0.5 rounded bg-slate-900 border border-slate-700 text-slate-300 hover:text-cyan-300 text-[9px]"
                >
                  {showAllBrands ? `Filter: ${selectedBrandKey.toUpperCase()}` : 'Show All Brands'}
                </button>
              )}
            </div>

            <div className="max-h-56 overflow-y-auto pr-1 flex flex-col gap-1.5">
              {visibleBenchScenarios.map((sc) => {
                const targetPin = activePinById.get(sc.recommendedPinId);
                const isFaultInjected = faults.some(
                  (f) =>
                    f.pinId === sc.recommendedPinId &&
                    f.faultType === sc.recommendedFaultType &&
                    f.description === sc.faultPresetLabel
                );
                return (
                  <div
                    key={sc.id}
                    className={`p-2 rounded border text-[10px] font-mono flex flex-col gap-1 transition ${
                      isFaultInjected
                        ? 'bg-rose-950/35 border-rose-500/70'
                        : 'bg-slate-900/75 border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-1.5">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className="px-1 py-0.5 rounded bg-cyan-950 text-cyan-300 border border-cyan-700/70 font-bold shrink-0">
                          #{sc.scenarioNumber} {sc.brandLabel}
                        </span>
                        <span className="px-1.5 py-0.5 rounded bg-amber-950/80 text-amber-300 border border-amber-700/70 font-bold shrink-0">
                          {sc.dtcCode}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() =>
                          runScenario(sc.recommendedPinId, sc.recommendedFaultType, sc.faultPresetLabel)
                        }
                        className="px-1.5 py-0.5 rounded bg-cyan-600/80 hover:bg-cyan-500 text-white font-bold flex items-center gap-1 shrink-0 transition"
                        title={`Inject ${sc.recommendedFaultType} on ${targetPin?.label ?? sc.recommendedPinId}`}
                      >
                        <Play className="w-2.5 h-2.5" />
                        <span>Simulate Fault</span>
                      </button>
                    </div>
                    <div className="text-slate-100 font-semibold leading-snug">
                      {sc.targetModuleAndModels} — {sc.faultDescription}
                    </div>
                    <div className="text-[9px] text-slate-300 font-sans leading-snug">
                      <span className="text-cyan-400 font-semibold">Setup:</span> {sc.benchSimulationSetup}
                    </div>
                    <div className="text-[9px] text-slate-400 font-sans leading-snug">
                      <span className="text-emerald-400 font-semibold">Expected:</span> {sc.expectedEcuBehavior}
                    </div>
                    <div className="text-[9px] text-slate-500 flex items-center justify-between pt-0.5 gap-2">
                      <span>
                        Bench Pin: {targetPin ? `${targetPin.label} (#${targetPin.pinNumber})` : sc.recommendedPinId}
                        {nodeVoltages[sc.recommendedPinId] !== undefined
                          ? ` (${nodeVoltages[sc.recommendedPinId].toFixed(2)}V)`
                          : ''}
                      </span>
                      <span className="flex items-center gap-1.5">
                        {isFaultInjected && (
                          <span className="px-1 py-0.5 rounded bg-emerald-950/80 border border-emerald-500/50 text-emerald-300 font-bold text-[8px]">
                            {activeDTCs.some((d) => sc.dtcCode.includes(d.code))
                              ? 'MNA VERIFIED · DTC ACTIVE'
                              : 'MNA FAULT ACTIVE'}
                          </span>
                        )}
                        <span>{sc.recommendedFaultType}</span>
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Target Pin Selector */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-slate-800">
        <label className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">
          Target ECU Pin Under Test:
        </label>
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-1 max-h-28 overflow-y-auto pr-1">
          {pins.map(p => {
            const hasFault = faults.some(f => f.pinId === p.id);
            const isSelected = p.id === currentPin.id;
            return (
              <button
                key={p.id}
                onClick={() => onSelectPin(p.id)}
                className={`px-1.5 py-1 text-[10px] font-mono rounded border flex flex-col items-center justify-center transition ${
                  isSelected
                    ? 'bg-cyan-950 border-cyan-400 text-cyan-200 font-bold ring-1 ring-cyan-500'
                    : hasFault
                    ? 'bg-rose-950/70 border-rose-600 text-rose-300 font-semibold'
                    : 'bg-slate-950 border-slate-800 text-slate-400 hover:border-slate-700'
                }`}
              >
                <span>{p.label}</span>
                {hasFault && <span className="text-[8px] text-rose-400 font-bold">FAULT</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Active Pin Details */}
      <div className="hud-well p-2 rounded-lg flex items-center justify-between text-xs font-mono">
        <div>
          <span className="text-cyan-400 font-semibold">{currentPin.label}</span>
          <span className="text-slate-400 ml-2">Pin #{currentPin.pinNumber}: {currentPin.name}</span>
        </div>
        <div className="text-[10px] text-slate-500">
          Nominal: {currentPin.nominalVoltage.toFixed(1)}V
        </div>
      </div>

      {/* Fault Injection Options */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
        {faultOptions.map(opt => {
          const isActive = (opt.type === 'NONE' && !activeFaultForPin) || (activeFaultForPin?.faultType === opt.type);
          return (
            <button
              key={opt.type}
              onClick={() => {
                if (opt.type === 'NONE') {
                  onRemoveFault(currentPin.id);
                } else {
                  onAddFault(currentPin.id, opt.type, opt.label);
                }
              }}
              className={`p-2 rounded border text-left flex items-start gap-2 transition ${
                isActive
                  ? 'bg-cyan-950/50 border-cyan-500/70 text-white'
                  : `bg-slate-950/70 border-slate-800/90 text-slate-300 ${opt.color}`
              }`}
            >
              <div className="mt-0.5">{opt.icon}</div>
              <div className="flex flex-col">
                <span className="text-xs font-mono font-semibold">{opt.label}</span>
                <span className="text-[9px] text-slate-400 leading-tight mt-0.5">{opt.desc}</span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Live ECU OBD-II Diagnostic Trouble Codes */}
      <div className="flex flex-col gap-1.5 pt-1 border-t border-cyan-500/15">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
            <Activity className="w-3.5 h-3.5 text-amber-400" />
            LIVE OBD-II DTC MONITOR:
          </span>
          <span className="text-[10px] font-mono text-slate-500">{activeDTCs.length} Stored</span>
        </div>

        {activeDTCs.length === 0 ? (
          <div className="bg-emerald-950/30 border border-emerald-900/60 p-2 rounded text-[11px] font-mono text-emerald-400 flex items-center gap-2">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
            <span>ECU Status: All circuits nominal. Zero DTCs logged.</span>
          </div>
        ) : (
          <div className="flex flex-col gap-1 max-h-32 overflow-y-auto">
            {activeDTCs.map(dtc => (
              <div
                key={dtc.code}
                className="bg-slate-950 border border-rose-900/60 p-1.5 rounded flex items-center justify-between text-xs font-mono"
              >
                <div className="flex items-center gap-2 truncate">
                  <span className="bg-rose-950 text-rose-300 border border-rose-700 px-1.5 py-0.5 rounded font-bold text-[10px]">
                    {dtc.code}
                  </span>
                  <div className="flex flex-col truncate">
                    <span className="text-slate-200 font-semibold text-[10px] truncate">{dtc.system}</span>
                    <span className="text-slate-400 text-[9px] truncate">{dtc.description}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0 ml-1">
                  <span className="text-[9px] uppercase px-1 py-0.5 rounded bg-rose-950 text-rose-400 border border-rose-800 font-semibold">
                    {dtc.severity}
                  </span>
                  {onSearchDtc && (
                    <button
                      onClick={() => onSearchDtc(dtc.code, dtc.description)}
                      className="px-1.5 py-0.5 rounded bg-blue-950 hover:bg-blue-900 border border-blue-700/80 text-cyan-300 hover:text-white transition flex items-center gap-1 text-[9px] font-bold"
                      title={`Search Live Google Grounding for ${dtc.code}`}
                    >
                      <Globe className="w-2.5 h-2.5 text-cyan-400" />
                      <span>Search TSB</span>
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
});
