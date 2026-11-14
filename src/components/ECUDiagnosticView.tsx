import React from 'react';
import {
  EcuPin,
  InjectedFault,
  MultimeterState,
  PowerSupplyState,
  WireConnection,
} from '../types/ecu';
import { CircuitSolution } from '../utils/circuitSolver';
import { DiagnosticGuidePanel } from './DiagnosticGuidePanel';
import { LabTab } from './LabTopNav';

interface ECUDiagnosticViewProps {
  visibleOnMobile: boolean;
  isOpen: boolean;
  onClose: () => void;
  powerSupply: PowerSupplyState;
  pins: EcuPin[];
  wires: WireConnection[];
  faults: InjectedFault[];
  circuitSolution: CircuitSolution;
  multimeter: MultimeterState;
  selectedPinId: string | null;
  onSelectPin: (pinId: string | null) => void;
  onNavigateTab: (tab: LabTab) => void;
  onOpenOfflineBot: (prompt?: string) => void;
  compactWidth?: boolean;
  isShortViewport?: boolean;
  moveControls?: React.ReactNode;
}

export const ECUDiagnosticView: React.FC<ECUDiagnosticViewProps> = ({
  visibleOnMobile,
  isOpen,
  onClose,
  powerSupply,
  pins,
  wires,
  faults,
  circuitSolution,
  multimeter,
  selectedPinId,
  onSelectPin,
  onNavigateTab,
  onOpenOfflineBot,
  compactWidth = false,
  isShortViewport = false,
  moveControls,
}) => {
  if (!isOpen) {
    return null;
  }

  return (
    <section
      aria-label="ECU Diagnostic View"
      className={`flex-1 lg:flex-initial min-h-0 flex-col gap-1.5 overflow-hidden ${
        visibleOnMobile ? 'flex' : 'hidden lg:flex'
      }`}
    >
      {moveControls}
      <DiagnosticGuidePanel
        isOpen={isOpen}
        onClose={onClose}
        powerSupply={powerSupply}
        pins={pins}
        wires={wires}
        faults={faults}
        activeDTCs={circuitSolution.activeDTCs}
        nodeVoltages={circuitSolution.nodeVoltages}
        supplyCurrentDrawAmps={circuitSolution.supplyCurrentDrawAmps}
        isSupplyCurrentTripped={circuitSolution.isSupplyCurrentTripped}
        multimeter={multimeter}
        multimeterReading={circuitSolution.multimeterReading}
        selectedPinId={selectedPinId}
        onSelectPin={onSelectPin}
        onNavigateTab={onNavigateTab}
        onOpenOfflineBot={onOpenOfflineBot}
        compactWidth={compactWidth}
        isShortViewport={isShortViewport}
      />
    </section>
  );
};
