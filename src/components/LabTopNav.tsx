import React, { useEffect, useId, useRef } from 'react';
import {
  AlertTriangle,
  Bot,
  Box,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  FileText,
  Globe,
  HelpCircle,
  RotateCcw,
  Save,
  type LucideIcon,
} from 'lucide-react';

import type { CircuitSolution } from '../utils/circuitSolver';

// -----------------------------------------------------------------------------
// Types
// -----------------------------------------------------------------------------

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

export interface LabTopNavProps {
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

type ActionTone = 'emerald' | 'blue' | 'amber' | 'cyan' | 'neutral';

interface NavigationItem {
  id: LabTab;
  label: string;
  icon?: LucideIcon;
}

interface UtilityAction {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  tone: ActionTone;
  onClick: () => void;
}

// -----------------------------------------------------------------------------
// Configuration
// -----------------------------------------------------------------------------

const BRAND_IMAGE =
  '/assets/aistudio/file_0000000098d48211abb177ce752b7b0e_62980da7.png';

const NAV_TABS: readonly NavigationItem[] = [
  { id: 'BENCH_LAB', label: 'Bench Lab' },
  { id: 'WIRING_DIAGRAM', label: 'Harness Wiring' },
  { id: 'THREE_D_TWIN', label: '3D Bench Twin', icon: Box },
  { id: 'ECU_PINOUT', label: 'ECU Pinouts' },
  { id: 'OSCILLOSCOPE', label: 'Oscilloscope' },
  { id: 'PCB_SCANNER', label: 'PCB Scanner' },
  { id: 'REPAIR_GUIDE', label: 'Repair Manuals', icon: BookOpen },
];

const SIMULATION_SPEEDS = [
  { value: 0.25, label: '0.25× · Slow motion' },
  { value: 0.5, label: '0.5× · Slow' },
  { value: 1, label: '1× · Realtime' },
  { value: 2, label: '2× · Fast' },
  { value: 4, label: '4× · Turbo' },
] as const;

const FOCUS_STYLES =
  'focus-visible:outline-none focus-visible:ring-2 ' +
  'focus-visible:ring-cyan-300 focus-visible:ring-offset-2 ' +
  'focus-visible:ring-offset-slate-950';

const ACTION_TONES: Record<ActionTone, string> = {
  emerald:
    'border-emerald-500/25 bg-emerald-500/10 text-emerald-200 ' +
    'hover:border-emerald-400/50 hover:bg-emerald-500/20',

  blue:
    'border-blue-500/25 bg-blue-500/10 text-blue-200 ' +
    'hover:border-blue-400/50 hover:bg-blue-500/20',

  amber:
    'border-amber-500/25 bg-amber-500/10 text-amber-200 ' +
    'hover:border-amber-400/50 hover:bg-amber-500/20',

  cyan:
    'border-cyan-300/60 bg-cyan-400 text-slate-950 ' +
    'hover:border-cyan-200 hover:bg-cyan-300',

  neutral:
    'border-white/10 bg-white/[0.03] text-slate-300 ' +
    'hover:border-white/20 hover:bg-white/[0.07] hover:text-white',
};

// -----------------------------------------------------------------------------
// Reusable elements
// -----------------------------------------------------------------------------

function UtilityButton({ action }: { action: UtilityAction }) {
  const Icon = action.icon;

  return (
    <button
      type="button"
      onClick={action.onClick}
      aria-label={action.label}
      title={action.description}
      className={[
        'inline-flex min-h-10 min-w-10 shrink-0 items-center justify-center',
        'gap-2 whitespace-nowrap rounded-lg border px-3 py-2',
        'text-xs font-semibold',
        'transition-colors motion-reduce:transition-none',
        FOCUS_STYLES,
        ACTION_TONES[action.tone],
      ].join(' ')}
    >
      <Icon
        aria-hidden="true"
        className="h-4 w-4 shrink-0"
        strokeWidth={1.8}
      />

      <span className="hidden 2xl:inline">{action.label}</span>
    </button>
  );
}

interface SimulationSpeedSelectProps {
  value: number;
  onChange: (speed: number) => void;
}

function SimulationSpeedSelect({
  value,
  onChange,
}: SimulationSpeedSelectProps) {
  const selectId = useId();

  const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const nextSpeed = Number(event.target.value);

    if (SIMULATION_SPEEDS.some((speed) => speed.value === nextSpeed)) {
      onChange(nextSpeed);
    }
  };

  return (
    <div className="relative shrink-0">
      <label htmlFor={selectId} className="sr-only">
        Simulation speed
      </label>

      <select
        id={selectId}
        value={value}
        onChange={handleChange}
        className={[
          'min-h-10 w-40 appearance-none rounded-lg',
          'border border-white/10 bg-slate-900',
          'py-2 pl-3 pr-9',
          'font-mono text-xs font-semibold text-cyan-200',
          'cursor-pointer transition-colors hover:border-cyan-400/40',
          'motion-reduce:transition-none',
          FOCUS_STYLES,
        ].join(' ')}
      >
        {SIMULATION_SPEEDS.map((speed) => (
          <option key={speed.value} value={speed.value}>
            {speed.label}
          </option>
        ))}
      </select>

      <ChevronDown
        aria-hidden="true"
        className="pointer-events-none absolute right-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400"
      />
    </div>
  );
}

function BenchTelemetry({
  circuitSolution,
}: {
  circuitSolution: CircuitSolution;
}) {
  const current = circuitSolution.supplyCurrentDrawAmps;
  const faultCount = circuitSolution.activeDTCs.length;
  const hasFaults = faultCount > 0;

  const currentLabel = Number.isFinite(current)
    ? `${current.toFixed(2)} A`
    : 'Unavailable';

  const StatusIcon = hasFaults ? AlertTriangle : CheckCircle2;

  return (
    <div
      role="group"
      aria-label="Bench telemetry"
      className="hidden shrink-0 items-center gap-4 border-l border-white/10 pl-4 font-mono text-[11px] xl:flex"
    >
      <div className="flex items-center gap-2">
        <span className="uppercase tracking-wider text-slate-500">
          Draw
        </span>

        <span className="font-semibold tabular-nums text-amber-300">
          <span className="sr-only">Supply current: </span>
          {currentLabel}
        </span>
      </div>

      <span
        className={[
          'inline-flex items-center gap-1.5 whitespace-nowrap',
          'font-semibold uppercase tracking-wide',
          hasFaults ? 'text-rose-300' : 'text-emerald-300',
        ].join(' ')}
      >
        <StatusIcon aria-hidden="true" className="h-3.5 w-3.5" />

        {hasFaults
          ? `${faultCount} ${faultCount === 1 ? 'fault' : 'faults'}`
          : 'Nominal'}
      </span>
    </div>
  );
}

// -----------------------------------------------------------------------------
// Main component
// -----------------------------------------------------------------------------

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
  const navigationRef = useRef<HTMLElement>(null);
  const activeButtonRef = useRef<HTMLButtonElement>(null);

  // Reveal the active section without moving the surrounding page vertically.
  useEffect(() => {
    const navigation = navigationRef.current;
    const activeButton = activeButtonRef.current;

    if (!navigation || !activeButton) return;

    const navigationBounds = navigation.getBoundingClientRect();
    const buttonBounds = activeButton.getBoundingClientRect();
    const padding = 8;

    const isClippedLeft =
      buttonBounds.left < navigationBounds.left + padding;

    const isClippedRight =
      buttonBounds.right > navigationBounds.right - padding;

    if (!isClippedLeft && !isClippedRight) return;

    const offset = isClippedLeft
      ? buttonBounds.left - navigationBounds.left - padding
      : buttonBounds.right - navigationBounds.right + padding;

    const prefersReducedMotion = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;

    navigation.scrollTo({
      left: navigation.scrollLeft + offset,
      behavior: prefersReducedMotion ? 'auto' : 'smooth',
    });
  }, [activeTab]);

  const utilityActions: readonly UtilityAction[] = [
    {
      id: 'workspaces',
      label: isSignedIn ? 'Saved Benches' : 'Save Bench',
      description: 'Save or load bench workspaces and diagnostic logs',
      icon: Save,
      tone: 'emerald',
      onClick: onOpenCloudModal,
    },
    {
      id: 'reports',
      label: 'Google Docs',
      description: 'Export bench reports and manage Google Docs',
      icon: FileText,
      tone: 'blue',
      onClick: onOpenDocsModal,
    },
    {
      id: 'assistant',
      label: 'Offline Bot',
      description: 'Open the offline diagnostic assistant',
      icon: Bot,
      tone: 'amber',
      onClick: onOpenOfflineBot,
    },
    {
      id: 'search',
      label: 'Live Search',
      description: 'Search OEM bulletins, service information, and pinouts',
      icon: Globe,
      tone: 'cyan',
      onClick: onOpenGroundedSearch,
    },
    {
      id: 'guide',
      label: 'Guide & Credits',
      description: 'View lab instructions and credits',
      icon: HelpCircle,
      tone: 'neutral',
      onClick: onOpenIntroModal,
    },
    {
      id: 'reset',
      label: 'Reset Bench',
      description: 'Reset the bench to its factory setup',
      icon: RotateCcw,
      tone: 'neutral',
      onClick: onResetLab,
    },
  ];

  return (
    <header className="relative isolate w-full min-w-0 shrink-0 border-b border-white/10 bg-slate-950 text-slate-200">
      {/* Decorative accent */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400/60 to-transparent"
      />

      {/* Brand, telemetry, and tools */}
      <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2 px-3 py-3 sm:px-5">
        <div className="flex min-w-0 shrink-0 items-center gap-3">
          <img
            src={BRAND_IMAGE}
            alt=""
            width={36}
            height={36}
            decoding="async"
            referrerPolicy="no-referrer"
            className="h-9 w-9 shrink-0 rounded-lg border border-cyan-400/25 bg-slate-900 object-contain p-0.5"
          />

          <div className="min-w-0">
            <div className="flex items-center gap-2 whitespace-nowrap">
              <span className="font-hud text-sm font-bold tracking-wide text-slate-100 sm:text-base">
                AutoElectric Lab
              </span>

              <span className="rounded border border-amber-400/30 bg-amber-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-widest text-amber-300">
                Pro
              </span>
            </div>

            <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.16em] text-slate-500">
              Virtual ECU Workbench
            </p>
          </div>
        </div>

        <BenchTelemetry circuitSolution={circuitSolution} />

        <div
          role="group"
          aria-label="Simulation and workspace tools"
          className="flex w-full min-w-0 items-center gap-2 overflow-x-auto scrollbar-none px-1 py-1 md:ml-auto md:w-auto md:flex-1 md:justify-end"
        >
          <SimulationSpeedSelect
            value={simulationSpeed}
            onChange={onChangeSimulationSpeed}
          />

          <span
            aria-hidden="true"
            className="mx-0.5 h-6 w-px shrink-0 bg-white/10"
          />

          {utilityActions.map((action) => (
            <UtilityButton key={action.id} action={action} />
          ))}
        </div>
      </div>

      {/* Section navigation */}
      <div className="min-w-0 border-t border-white/5 bg-slate-900/40 px-3 sm:px-5">
        <nav
          ref={navigationRef}
          aria-label="Virtual ECU lab sections"
          className="flex min-w-0 items-center gap-1 overflow-x-auto scrollbar-none overscroll-x-contain px-1 py-2"
        >
          {NAV_TABS.map((tab) => {
            const isActive = activeTab === tab.id;
            const Icon = tab.icon;

            return (
              <button
                key={tab.id}
                ref={isActive ? activeButtonRef : undefined}
                type="button"
                onClick={() => onSelectTab(tab.id)}
                aria-current={isActive ? 'page' : undefined}
                className={[
                  'relative inline-flex min-h-10 shrink-0 items-center',
                  'justify-center gap-2 whitespace-nowrap rounded-lg',
                  'border px-3.5 py-2',
                  'font-hud text-[11px] font-bold uppercase tracking-wide',
                  'transition-colors motion-reduce:transition-none',
                  FOCUS_STYLES,
                  isActive
                    ? 'border-cyan-300/60 bg-cyan-400 text-slate-950 shadow-sm'
                    : 'border-transparent text-slate-400 hover:border-white/10 hover:bg-white/5 hover:text-slate-100',
                ].join(' ')}
              >
                {Icon && (
                  <Icon
                    aria-hidden="true"
                    className="h-4 w-4 shrink-0"
                    strokeWidth={1.8}
                  />
                )}

                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
};
