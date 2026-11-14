import React from 'react';
import {
  BenchComponent,
  EcuPin,
  FaultType,
  InjectedFault,
  MultimeterState,
  PowerSupplyState,
} from '../types/ecu';
import { CircuitSolution } from '../utils/circuitSolver';
import { BenchPowerSupply } from './BenchPowerSupply';
import { BenchVehicleEmulatorPanel } from './BenchVehicleEmulatorPanel';
import { DigitalMultimeter } from './DigitalMultimeter';
import { FaultInjector } from './FaultInjector';
import { RackFilter } from './LabTopNav';
import { RpmEmulatorState, UNIVERSAL_BRAND_KEY } from '../utils/vehicleEcuRegistry';

interface InstrumentPanelsProps {
  visibleOnMobile: boolean;
  rackFilter: RackFilter;
  onChangeRackFilter: (filter: RackFilter) => void;
  powerSupply: PowerSupplyState;
  onChangePowerSupply: React.Dispatch<React.SetStateAction<PowerSupplyState>>;
  multimeter: MultimeterState;
  onChangeMultimeter: React.Dispatch<React.SetStateAction<MultimeterState>>;
  circuitSolution: CircuitSolution;
  pins: EcuPin[];
  components: BenchComponent[];
  faults: InjectedFault[];
  selectedPinId: string | null;
  onSelectPin: (pinId: string | null) => void;
  onAddFault: (pinId: string, faultType: FaultType, description: string) => void;
  onRemoveFault: (pinId: string) => void;
  onClearAllFaults: () => void;
  onSearchDtc: (code: string, desc: string) => void;
  selectedBrandKey?: string;
  selectedModelName?: string;
  selectedEcuProfileId?: string | null;
  onSelectVehicleEcu?: (brandKey: string, modelName: string, ecuProfileId: string | null) => void;
  onOpenEcuPinouts?: () => void;
  rpmEmulator?: RpmEmulatorState;
  onChangeRpmEmulator?: React.Dispatch<React.SetStateAction<RpmEmulatorState>>;
  onUpdateComponentState?: (compId: string, updates: Record<string, number | boolean | string>) => void;
  compactWidth?: boolean;
  isShortViewport?: boolean;
  moveControls?: React.ReactNode;
}

const FALLBACK_RPM_EMULATOR: RpmEmulatorState = {
  isActive: false,
  rpm: 850,
  soundEnabled: true,
};

export const InstrumentPanels: React.FC<InstrumentPanelsProps> = ({
  visibleOnMobile,
  rackFilter,
  onChangeRackFilter,
  powerSupply,
  onChangePowerSupply,
  multimeter,
  onChangeMultimeter,
  circuitSolution,
  pins,
  components,
  faults,
  selectedPinId,
  onSelectPin,
  onAddFault,
  onRemoveFault,
  onClearAllFaults,
  onSearchDtc,
  selectedBrandKey = UNIVERSAL_BRAND_KEY,
  selectedModelName = 'Generic 16-Pin Bench',
  selectedEcuProfileId = null,
  onSelectVehicleEcu,
  onOpenEcuPinouts,
  rpmEmulator = FALLBACK_RPM_EMULATOR,
  onChangeRpmEmulator,
  onUpdateComponentState,
  compactWidth = false,
  isShortViewport = false,
  moveControls,
}) => {
  return (
    <section
      aria-label="Bench Instrument Panels"
      className={`w-full ${
        compactWidth ? 'lg:w-[305px] xl:w-[325px]' : 'lg:w-[370px] xl:w-[385px]'
      } flex-col ${
        isShortViewport ? 'gap-2' : 'gap-2.5'
      } shrink-0 overflow-hidden flex-1 lg:flex-initial min-h-0 transition-[width] duration-150 ${
        visibleOnMobile ? 'flex' : 'hidden lg:flex'
      }`}
    >
      {moveControls}
      {/* Rack View Filter Tabs */}
      <div
        role="tablist"
        aria-label="Instrument Rack Filter"
        className="flex items-center gap-1 hud-panel p-1 rounded-lg text-[11px] font-mono shrink-0"
      >
        <button
          type="button"
          role="tab"
          aria-selected={rackFilter === 'ALL'}
          onClick={() => onChangeRackFilter('ALL')}
          className={`flex-1 py-1 rounded text-center transition whitespace-nowrap ${
            rackFilter === 'ALL'
              ? 'bg-cyan-500/20 text-cyan-300 border border-cyan-500/40 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          All Rack
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rackFilter === 'DMM_POWER'}
          onClick={() => onChangeRackFilter('DMM_POWER')}
          className={`flex-1 py-1 rounded text-center transition whitespace-nowrap ${
            rackFilter === 'DMM_POWER'
              ? 'bg-slate-800 text-cyan-300 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          DMM & Power
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={rackFilter === 'FAULT_MATRIX'}
          onClick={() => onChangeRackFilter('FAULT_MATRIX')}
          className={`flex-1 py-1 rounded text-center transition whitespace-nowrap ${
            rackFilter === 'FAULT_MATRIX'
              ? 'bg-slate-800 text-cyan-300 font-semibold'
              : 'text-slate-400 hover:text-white'
          }`}
        >
          Fault Matrix
        </button>
      </div>

      {/* Scrollable Instrument Rack */}
      <div className={`flex-1 overflow-y-auto pr-1 flex flex-col ${isShortViewport ? 'gap-2' : 'gap-3'} min-h-0`}>
        {(rackFilter === 'ALL' || rackFilter === 'DMM_POWER') && (
          <>
            {onSelectVehicleEcu && onChangeRpmEmulator && (
              <BenchVehicleEmulatorPanel
                selectedBrandKey={selectedBrandKey}
                selectedModelName={selectedModelName}
                selectedEcuProfileId={selectedEcuProfileId}
                onSelectVehicleEcu={onSelectVehicleEcu}
                onOpenEcuPinouts={onOpenEcuPinouts}
                rpmEmulator={rpmEmulator}
                onChangeRpmEmulator={onChangeRpmEmulator}
                components={components}
                onUpdateComponentState={onUpdateComponentState}
                isPowerOn={powerSupply.isOutputEnabled}
              />
            )}

            <BenchPowerSupply
              powerSupply={powerSupply}
              onChange={onChangePowerSupply}
              actualCurrentAmps={circuitSolution.supplyCurrentDrawAmps}
              isTripped={circuitSolution.isSupplyCurrentTripped}
              actualOutputVoltage={circuitSolution.nodeVoltages['bench-vbat']}
            />

            <DigitalMultimeter
              multimeter={multimeter}
              onChange={onChangeMultimeter}
              reading={circuitSolution.multimeterReading}
              pins={pins}
              components={components}
              selectedPinId={selectedPinId}
            />
          </>
        )}

        {(rackFilter === 'ALL' || rackFilter === 'FAULT_MATRIX') && (
          <FaultInjector
            pins={pins}
            faults={faults}
            activeDTCs={circuitSolution.activeDTCs}
            onAddFault={onAddFault}
            onRemoveFault={onRemoveFault}
            onClearAll={onClearAllFaults}
            selectedPinId={selectedPinId}
            onSelectPin={onSelectPin}
            onSearchDtc={onSearchDtc}
            selectedBrandKey={selectedBrandKey}
            nodeVoltages={circuitSolution.nodeVoltages}
          />
        )}
      </div>
    </section>
  );
};
