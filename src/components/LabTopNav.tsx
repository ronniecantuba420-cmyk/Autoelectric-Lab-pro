import React from 'react';
import {
  AlertTriangle,
  Bot,
  Box,
  BookOpen,
  CheckCircle2,
  FileText,
  Globe,
  HelpCircle,
  RotateCcw,
  Save,
} from 'lucide-react';
import { CircuitSolution } from '../utils/circuitSolver';

export type LabTab =
  | 'BENCH_LAB'
  | 'WIRING_DIAGRAM'
  | 'THREE_D_TWIN'
  | 'ECU_PINOUT'
  | 'OSCILLOSCOPE'
  | 'PCB_SCANNER'
  | 'REPAIR_GUIDE';

export type RackFilter = 'ALL' | 'DMM_POWER' | 'FAULT_MATRIX';
export type MobileBenchPane = 'INSTRUMENTS' | 'CANVAS' | 'GUIDE';

interface LabTopNavProps {
  activeTab: LabTab;
  onSelectTab: (tab: LabTab) => void;
  simulationSpeed: number;
  onChangeSimulationSpeed: (speed: number) => void;
  circuitSolution: CircuitSolution;
  isSignedIn: boolean;
  onOpenCloudModal: () => void;
  onOpenDocsModal: () => void;
  onOpenOfflineBot: () => void;
  onOpenGroundedSearch: () => void;
  onOpenIntroModal: () => void;
  onResetLab: () => void;
}

const NAV_TABS: Array<{ id: LabTab; label: string; icon?: 'box' | 'book' }> = [
  { id: 'BENCH_LAB', label: 'Bench Lab' },
  { id: 'WIRING_DIAGRAM', label: 'Harness Wiring' },
  { id: 'THREE_D_TWIN', label: '3D Bench Twin', icon: 'box' },
  { id: 'ECU_PINOUT', label: 'ECU Pinouts' },
  { id: 'OSCILLOSCOPE', label: 'Oscilloscope' },
  { id: 'PCB_SCANNER', label: 'PCB Scanner' },
  { id: 'REPAIR_GUIDE', label: 'Repair Manuals', icon: 'book' },
];

export const LabTopNav: React.FC<LabTopNavProps> = ({
  activeTab,
  onSelectTab,
  simulationSpeed,
  onChangeSimulationSpeed,
  circuitSolution,
  isSignedIn,
  onOpenCloudModal,
  onOpenDocsModal,
  onOpenOfflineBot,
  onOpenGroundedSearch,
  onOpenIntroModal,
  onResetLab,
}) => {
  return (
    <header className="hud-header px-2.5 sm:px-5 py-1.5 lg:py-0 lg:h-13 flex flex-col lg:flex-row lg:items-center lg:justify-between gap-1.5 lg:gap-4 text-xs shrink-0">
      {/* Top Row on Mobile / Brand Zone on Desktop */}
      <div className="flex items-center justify-between gap-2 w-full lg:w-auto min-w-0">
        <div className="flex items-center gap-2 shrink-0">
          <img
            src="/assets/aistudio/file_0000000098d48211abb177ce752b7b0e_62980da7.png"
            alt="AutoElectric Lab Pro"
            referrerPolicy="no-referrer"
            className="h-6 sm:h-8 w-auto object-contain rounded-md border border-cyan-500/40"
          />
          <span className="font-hud font-bold tracking-wide text-xs sm:text-base whitespace-nowrap shrink-0">
            <span className="brand-wordmark-silver">AutoElectric Lab</span>{' '}
            <span className="brand-wordmark-amber">Pro</span>
          </span>
        </div>

        {/* Mobile/Tablet Utility Actions Strip */}
        <div className="flex lg:hidden items-center gap-1 overflow-x-auto scrollbar-none font-mono pl-1">
          <div className="flex items-center hud-well px-1.5 py-0.5 rounded-md text-[10px] shrink-0">
            <select
              aria-label="Simulation Speed Mobile"
              value={simulationSpeed}
              onChange={(e) => onChangeSimulationSpeed(parseFloat(e.target.value))}
              className="bg-transparent text-cyan-300 font-bold rounded py-0.5 text-[10px] focus:outline-none cursor-pointer"
            >
              <option value="0.25" className="bg-slate-950">0.25x</option>
              <option value="0.5" className="bg-slate-950">0.5x</option>
              <option value="1.0" className="bg-slate-950">1.0x</option>
              <option value="2.0" className="bg-slate-950">2.0x</option>
              <option value="4.0" className="bg-slate-950">4.0x</option>
            </select>
          </div>

          <button
            type="button"
            onClick={onOpenCloudModal}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-emerald-300 bg-emerald-950/60 border border-emerald-700/60 rounded-md whitespace-nowrap shrink-0"
            title="Save or Load Bench Workspaces"
            aria-label="Save or Load Bench Workspaces"
          >
            <Save className="w-3 h-3 text-emerald-400" />
            <span className="hidden sm:inline">Saved</span>
          </button>

          <button
            type="button"
            onClick={onOpenDocsModal}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-blue-200 bg-blue-950/70 border border-blue-600/60 rounded-md whitespace-nowrap shrink-0"
            title="Google Docs Reports"
            aria-label="Google Docs Reports"
          >
            <FileText className="w-3 h-3 text-blue-400" />
            <span className="hidden sm:inline">Docs</span>
          </button>

          <button
            type="button"
            onClick={onOpenOfflineBot}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-amber-200 bg-amber-950/70 border border-amber-500/50 rounded-md whitespace-nowrap shrink-0"
            title="Offline Diagnostic Bot"
            aria-label="Offline Diagnostic Bot"
          >
            <Bot className="w-3 h-3 text-amber-400" />
            <span className="hidden sm:inline">Bot</span>
          </button>

          <button
            type="button"
            onClick={onOpenGroundedSearch}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-slate-950 bg-cyan-400 rounded-md whitespace-nowrap shrink-0"
            title="Google Search Grounding"
            aria-label="Google Search Grounding"
          >
            <Globe className="w-3 h-3" />
          </button>

          <button
            type="button"
            onClick={onOpenIntroModal}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-semibold text-cyan-300 bg-slate-900/80 border border-cyan-500/30 rounded-md whitespace-nowrap shrink-0"
            title="Guide & Credits"
            aria-label="Guide and Credits"
          >
            <HelpCircle className="w-3 h-3 text-cyan-400" />
          </button>

          <button
            type="button"
            onClick={onResetLab}
            className="flex items-center gap-1 px-2 py-1 text-[10px] font-medium text-slate-200 bg-slate-900/80 border border-slate-700 rounded-md whitespace-nowrap shrink-0"
            title="Reset Bench"
            aria-label="Reset Bench"
          >
            <RotateCcw className="w-3 h-3" />
          </button>
        </div>
      </div>

      {/* Unified Navigation Tabs */}
      <nav
        aria-label="Virtual ECU Lab Sections"
        className="flex items-center gap-1 hud-well p-1 rounded-lg overflow-x-auto scrollbar-none w-full lg:w-auto shrink-0"
      >
        {NAV_TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => onSelectTab(tab.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`px-2.5 sm:px-3 py-1 sm:py-1.5 text-[11px] sm:text-xs font-hud font-bold tracking-wide uppercase rounded-md whitespace-nowrap shrink-0 transition flex items-center gap-1 ${
                isActive
                  ? 'bg-cyan-500 text-slate-950 shadow-sm'
                  : 'text-slate-300 hover:text-white hover:bg-slate-800/70'
              }`}
            >
              {tab.icon === 'box' && <Box className="w-3.5 h-3.5" />}
              {tab.icon === 'book' && <BookOpen className="w-3.5 h-3.5" />}
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* Desktop Telemetry & Utility Actions */}
      <div className="hidden lg:flex items-center gap-1.5 sm:gap-2 shrink-0 font-mono">
        <div className="hidden 2xl:flex items-center gap-2 text-[11px] text-slate-400 mr-1">
          <span>DRAW:</span>
          <span className="text-amber-400 font-bold tabular-nums">
            {circuitSolution.supplyCurrentDrawAmps.toFixed(2)} A
          </span>
          <span className="text-slate-700">·</span>
          {circuitSolution.activeDTCs.length > 0 ? (
            <span className="text-rose-400 font-bold flex items-center gap-1 whitespace-nowrap">
              <AlertTriangle className="w-3.5 h-3.5" /> {circuitSolution.activeDTCs.length} FAULT
            </span>
          ) : (
            <span className="text-emerald-400 font-bold flex items-center gap-1 whitespace-nowrap">
              <CheckCircle2 className="w-3.5 h-3.5" /> NOMINAL
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 hud-well px-2 py-1 rounded-lg text-xs shrink-0">
          <span className="text-[10px] text-slate-400 font-bold whitespace-nowrap hidden xl:inline">
            SPEED:
          </span>
          <select
            aria-label="Simulation Speed"
            value={simulationSpeed}
            onChange={(e) => onChangeSimulationSpeed(parseFloat(e.target.value))}
            className="bg-transparent text-cyan-300 font-bold rounded px-1 py-0.5 text-[11px] focus:outline-none cursor-pointer"
          >
            <option value="0.25" className="bg-slate-950">0.25x Slow-Mo</option>
            <option value="0.5" className="bg-slate-950">0.5x Slow</option>
            <option value="1.0" className="bg-slate-950">1.0x Realtime</option>
            <option value="2.0" className="bg-slate-950">2.0x Fast</option>
            <option value="4.0" className="bg-slate-950">4.0x Turbo</option>
          </select>
        </div>

        <button
          type="button"
          onClick={onOpenCloudModal}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-300 bg-emerald-950/60 hover:bg-emerald-900/70 border border-emerald-700/60 rounded-lg transition whitespace-nowrap shrink-0"
          title="Save or Load Bench Workspaces & Diagnostic Logs"
        >
          <Save className="w-3.5 h-3.5 text-emerald-400" />
          <span className="hidden xl:inline">{isSignedIn ? 'Saved Benches' : 'Save Bench'}</span>
        </button>

        <button
          type="button"
          onClick={onOpenDocsModal}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-blue-200 bg-blue-950/70 hover:bg-blue-900/70 border border-blue-600/60 rounded-lg transition whitespace-nowrap shrink-0"
          title="Export MNA Bench Reports & Manage Google Docs"
        >
          <FileText className="w-3.5 h-3.5 text-blue-400" />
          <span className="hidden xl:inline">Google Docs</span>
        </button>

        <button
          type="button"
          onClick={onOpenOfflineBot}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-amber-200 bg-amber-950/70 hover:bg-amber-900/80 border border-amber-500/50 rounded-lg transition whitespace-nowrap shrink-0"
          title="100% Offline Diagnostic Assistant (MiniSearch Local Engine)"
        >
          <Bot className="w-3.5 h-3.5 text-amber-400" />
          <span className="hidden xl:inline">Offline Bot</span>
        </button>

        <button
          type="button"
          onClick={onOpenGroundedSearch}
          className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-slate-950 bg-cyan-400 hover:bg-cyan-300 rounded-lg transition whitespace-nowrap shrink-0"
          title="Search Live OEM Bulletins, TSBs & Pinouts with Google Search Grounding"
        >
          <Globe className="w-3.5 h-3.5" />
          <span className="hidden xl:inline">Google Grounding</span>
        </button>

        <button
          type="button"
          onClick={onOpenIntroModal}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-semibold text-cyan-300 bg-slate-900/80 hover:bg-slate-800 border border-cyan-500/30 rounded-lg transition whitespace-nowrap shrink-0"
          title="View Instructions & Executive Credentials"
        >
          <HelpCircle className="w-3.5 h-3.5 text-cyan-400" />
          <span className="hidden 2xl:inline">Guide & Credits</span>
        </button>

        <button
          type="button"
          onClick={onResetLab}
          className="flex items-center gap-1 px-2.5 py-1.5 text-[11px] font-medium text-slate-200 bg-slate-900/80 hover:bg-slate-800 border border-slate-700 rounded-lg transition whitespace-nowrap shrink-0"
          title="Reset Bench to Factory Setup"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span className="hidden 2xl:inline">Reset</span>
        </button>
      </div>
    </header>
  );
};
