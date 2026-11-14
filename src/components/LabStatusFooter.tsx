import React from 'react';
import { PanelRightOpen } from 'lucide-react';
import { EcuPin, WireConnection } from '../types/ecu';
import { CircuitSolution } from '../utils/circuitSolver';
import { LabTab } from './LabTopNav';
import { PerformanceMonitorWidget } from './PerformanceMonitorWidget';

interface LabStatusFooterProps {
  activeTab: LabTab;
  selectedPin: EcuPin | undefined;
  circuitSolution: CircuitSolution;
  wires: WireConnection[];
  showDiagnosticGuide: boolean;
  onToggleDiagnosticGuide: () => void;
  onQuickAttachRedProbe: () => void;
  onQuickAttachBlackProbe: () => void;
}

export const LabStatusFooter: React.FC<LabStatusFooterProps> = ({
  activeTab,
  selectedPin,
  circuitSolution,
  wires,
  showDiagnosticGuide,
  onToggleDiagnosticGuide,
  onQuickAttachRedProbe,
  onQuickAttachBlackProbe,
}) => {
  return (
    <footer className="min-h-9 hud-header border-t border-cyan-500/20 px-2.5 sm:px-4 py-1 flex flex-wrap items-center justify-between gap-1.5 sm:gap-2 text-[10px] sm:text-[11px] font-mono shrink-0 text-slate-400">
      <div className="flex items-center gap-2 sm:gap-4 flex-wrap truncate">
        <span className="truncate">
          TARGET:{' '}
          <strong className="text-cyan-300">
            {selectedPin ? `${selectedPin.label} (#${selectedPin.pinNumber})` : 'None'}
          </strong>
        </span>
        <span className="text-slate-700 hidden xs:inline">|</span>
        <span className="whitespace-nowrap tabular-nums">
          DMM:{' '}
          <strong className="text-amber-300 font-bold">
            {circuitSolution.multimeterReading.display} {circuitSolution.multimeterReading.unit}
          </strong>
        </span>
        <span className="text-slate-700 hidden md:inline">|</span>
        <span className="whitespace-nowrap hidden md:inline tabular-nums">
          HARNESS:{' '}
          <strong className="text-slate-200">
            {wires.filter((w) => !w.isCut).length} Active / {wires.length} Wires
          </strong>
        </span>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        {activeTab === 'BENCH_LAB' && (
          <button
            type="button"
            onClick={onToggleDiagnosticGuide}
            className={`text-[10px] flex items-center gap-1 px-2.5 py-1 rounded border transition whitespace-nowrap ${
              showDiagnosticGuide
                ? 'bg-cyan-950/70 border-cyan-500/50 text-cyan-200'
                : 'bg-slate-900 border-slate-700 text-slate-300 hover:text-white'
            }`}
            title="Toggle 5-Step MNA Diagnostic Guide"
          >
            <PanelRightOpen className="w-3 h-3 text-cyan-400" />
            <span>5-Step Guide</span>
          </button>
        )}
        <button
          type="button"
          onClick={onQuickAttachRedProbe}
          className="text-[10px] text-rose-300 hover:text-white flex items-center gap-1 bg-rose-950/60 hover:bg-rose-900/60 px-2 py-1 rounded border border-rose-800/80 transition whitespace-nowrap"
        >
          Attach Red (+)
        </button>
        <button
          type="button"
          onClick={onQuickAttachBlackProbe}
          className="text-[10px] text-slate-300 hover:text-white flex items-center gap-1 bg-slate-900 hover:bg-slate-800 px-2 py-1 rounded border border-slate-700 transition whitespace-nowrap"
        >
          Black COM (-)
        </button>
        <PerformanceMonitorWidget />
      </div>
    </footer>
  );
};
