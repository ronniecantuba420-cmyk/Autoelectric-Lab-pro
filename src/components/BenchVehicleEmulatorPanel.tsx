import React, { useMemo, useState } from 'react';
import {
  Car,
  ChevronDown,
  ChevronUp,
  Cpu,
  Gauge,
  Radio,
  Volume2,
  VolumeX,
  Zap,
  ExternalLink,
} from 'lucide-react';
import { BenchComponent } from '../types/ecu';
import { ECU_BRAND_PROFILES } from './ecuPinoutData';
import {
  RpmEmulatorState,
  UNIVERSAL_BRAND_KEY,
  VEHICLE_CATALOG,
  getEcuProfileById,
  getSelectedVehicleContext,
  resolveProfileForVehicle,
  resolveSelectionFromProfileId,
} from '../utils/vehicleEcuRegistry';
import {
  computeRpmAudioProfile,
  playModuleActivationSound,
} from '../utils/audioFeedback';

interface BenchVehicleEmulatorPanelProps {
  selectedBrandKey: string;
  selectedModelName: string;
  selectedEcuProfileId: string | null;
  onSelectVehicleEcu: (brandKey: string, modelName: string, ecuProfileId: string | null) => void;
  onOpenEcuPinouts?: () => void;
  rpmEmulator: RpmEmulatorState;
  onChangeRpmEmulator: React.Dispatch<React.SetStateAction<RpmEmulatorState>>;
  components: BenchComponent[];
  onUpdateComponentState?: (compId: string, updates: Record<string, number | boolean | string>) => void;
  isPowerOn: boolean;
}

const RPM_PRESETS = [
  { label: 'Idle', rpm: 800 },
  { label: '2.5k', rpm: 2500 },
  { label: '4.5k', rpm: 4500 },
  { label: '6.5k', rpm: 6500 },
];

export const BenchVehicleEmulatorPanel: React.FC<BenchVehicleEmulatorPanelProps> = ({
  selectedBrandKey,
  selectedModelName,
  selectedEcuProfileId,
  onSelectVehicleEcu,
  onOpenEcuPinouts,
  rpmEmulator,
  onChangeRpmEmulator,
  components,
  onUpdateComponentState,
  isPowerOn,
}) => {
  const [isExpanded, setIsExpanded] = useState(true);

  const selectedMake = useMemo(
    () => VEHICLE_CATALOG.find((m) => m.brandKey === selectedBrandKey) || null,
    [selectedBrandKey]
  );

  const activeProfile = useMemo(
    () => getEcuProfileById(selectedEcuProfileId),
    [selectedEcuProfileId]
  );

  const vehicleCtx = useMemo(
    () => getSelectedVehicleContext(selectedBrandKey, selectedModelName, selectedEcuProfileId),
    [selectedBrandKey, selectedModelName, selectedEcuProfileId]
  );

  const injComp = useMemo(() => components.find((c) => c.id === 'comp-inj'), [components]);
  const relayComp = useMemo(() => components.find((c) => c.id === 'comp-relay'), [components]);
  const tpsComp = useMemo(() => components.find((c) => c.id === 'comp-tps'), [components]);

  const isInjectorActive = Boolean(injComp?.state?.isFiring ?? true);
  const isRelayActive = Boolean(relayComp?.state?.isLatched ?? true);
  const tpsPercent = Number(tpsComp?.state?.throttleAnglePercent ?? 20);
  const isTpsBoosted = tpsPercent >= 50;

  const rpmAudioProfile = useMemo(
    () => computeRpmAudioProfile(rpmEmulator.rpm),
    [rpmEmulator.rpm]
  );

  const rpmNormalized = rpmAudioProfile.normalizedRpm;
  const activeSoundBars =
    !rpmEmulator.isActive || !isPowerOn || !rpmEmulator.soundEnabled
      ? 0
      : Math.max(1, Math.round(1 + rpmNormalized * 4));

  const soundIntensityLabel = !rpmEmulator.isActive
    ? 'Off'
    : !isPowerOn
    ? 'PSU Off (Standby)'
    : !rpmEmulator.soundEnabled
    ? 'Muted'
    : rpmEmulator.rpm < 1600
    ? 'Subtle Idle Pulse'
    : rpmEmulator.rpm < 3800
    ? 'Noticeable Mid Hum'
    : 'High RPM Cadence';

  const soundTooltip = !rpmEmulator.isActive || !isPowerOn || !rpmEmulator.soundEnabled
    ? soundIntensityLabel
    : `Web Audio FM: ${rpmAudioProfile.carrierHz.toFixed(0)} Hz carrier · ${rpmAudioProfile.fmModHz.toFixed(0)} Hz mod (±${rpmAudioProfile.fmDeviationHz.toFixed(1)} Hz)`;

  const handleBrandChange = (brandKey: string) => {
    if (rpmEmulator.soundEnabled) {
      playModuleActivationSound(true, 'sensor');
    }
    if (brandKey === UNIVERSAL_BRAND_KEY) {
      onSelectVehicleEcu(UNIVERSAL_BRAND_KEY, 'Generic 16-Pin Bench', null);
      return;
    }
    const make = VEHICLE_CATALOG.find((m) => m.brandKey === brandKey);
    const firstModel = make?.models[0] || '';
    const profile = resolveProfileForVehicle(brandKey, firstModel);
    onSelectVehicleEcu(brandKey, firstModel, profile?.id || null);
  };

  const handleModelChange = (modelName: string) => {
    if (rpmEmulator.soundEnabled) {
      playModuleActivationSound(true, 'sensor');
    }
    const profile = resolveProfileForVehicle(selectedBrandKey, modelName);
    onSelectVehicleEcu(selectedBrandKey, modelName, profile?.id || selectedEcuProfileId);
  };

  const handleEcuChange = (profileId: string) => {
    if (rpmEmulator.soundEnabled) {
      playModuleActivationSound(true, 'sensor');
    }
    if (!profileId || profileId === UNIVERSAL_BRAND_KEY) {
      onSelectVehicleEcu(UNIVERSAL_BRAND_KEY, 'Generic 16-Pin Bench', null);
      return;
    }
    const resolved = resolveSelectionFromProfileId(profileId);
    onSelectVehicleEcu(resolved.brandKey, resolved.modelName, resolved.ecuProfileId);
  };

  const handleToggleRpmEmulator = () => {
    const nextActive = !rpmEmulator.isActive;
    if (rpmEmulator.soundEnabled) {
      playModuleActivationSound(nextActive, 'rpm');
    }
    setRpmActiveState(nextActive);
  };

  const setRpmActiveState = (nextActive: boolean) => {
    onChangeRpmEmulator((prev) => ({ ...prev, isActive: nextActive }));
  };

  const handleToggleSoundFx = () => {
    const nextSound = !rpmEmulator.soundEnabled;
    if (nextSound) {
      playModuleActivationSound(true, 'sensor');
    }
    onChangeRpmEmulator((prev) => ({ ...prev, soundEnabled: nextSound }));
  };

  const handleToggleInjector = () => {
    const next = !isInjectorActive;
    if (rpmEmulator.soundEnabled) {
      playModuleActivationSound(next, 'injector');
    }
    onUpdateComponentState?.('comp-inj', { isFiring: next });
  };

  const handleToggleRelay = () => {
    const next = !isRelayActive;
    if (rpmEmulator.soundEnabled) {
      playModuleActivationSound(next, 'relay');
    }
    onUpdateComponentState?.('comp-relay', { isLatched: next });
  };

  const handleToggleTpsStep = () => {
    const nextBoosted = !isTpsBoosted;
    if (rpmEmulator.soundEnabled) {
      playModuleActivationSound(nextBoosted, 'sensor');
    }
    onUpdateComponentState?.('comp-tps', { throttleAnglePercent: nextBoosted ? 68 : 20 });
  };

  const availableEcuProfiles = selectedMake ? selectedMake.profiles : ECU_BRAND_PROFILES;

  return (
    <div className="hud-panel rounded-xl p-2.5 sm:p-3 text-slate-100 flex flex-col gap-2 shrink-0">
      {/* Compact Header */}
      <div className="flex items-center justify-between gap-2 border-b border-cyan-500/15 pb-1.5">
        <button
          type="button"
          onClick={() => setIsExpanded((prev) => !prev)}
          className="flex items-center gap-2 min-w-0 text-left group cursor-pointer"
          aria-expanded={isExpanded}
        >
          <Car className="w-4 h-4 text-cyan-400 shrink-0" />
          <div className="min-w-0">
            <span className="text-[11px] font-hud font-bold tracking-wider uppercase text-slate-100 block truncate">
              Vehicle / ECU &amp; Emulators
            </span>
            <span className="text-[9.5px] font-mono text-cyan-300/90 block truncate">
              {activeProfile
                ? `${selectedMake?.brandLabel || activeProfile.brandName} · ${selectedModelName}`
                : 'Universal 16-Pin ECU Bench'}
            </span>
          </div>
          {isExpanded ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          )}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={handleToggleSoundFx}
            title={rpmEmulator.soundEnabled ? 'Mute Emulator Audio FX' : 'Enable Emulator Audio FX'}
            aria-label={rpmEmulator.soundEnabled ? 'Mute Emulator Sound' : 'Unmute Emulator Sound'}
            className={`p-1 rounded border text-[10px] font-mono transition cursor-pointer ${
              rpmEmulator.soundEnabled
                ? 'bg-cyan-950/70 border-cyan-600/50 text-cyan-300 hover:bg-cyan-900/70'
                : 'bg-slate-900 border-slate-700 text-slate-500 hover:text-slate-300'
            }`}
          >
            {rpmEmulator.soundEnabled ? (
              <Volume2 className="w-3.5 h-3.5" />
            ) : (
              <VolumeX className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={handleToggleRpmEmulator}
            className={`px-2 py-0.5 rounded text-[10px] font-mono font-bold border transition cursor-pointer ${
              rpmEmulator.isActive
                ? 'bg-emerald-500/20 border-emerald-400 text-emerald-300'
                : 'bg-slate-900 border-slate-700 text-slate-400 hover:text-white'
            }`}
          >
            {rpmEmulator.isActive ? `${rpmEmulator.rpm} RPM` : 'RPM OFF'}
          </button>
        </div>
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-2 text-[11px] font-mono">
          {/* 1. Cars, Model & ECU Selection Grid */}
          <div className="hud-well rounded-lg p-2 flex flex-col gap-1.5">
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex flex-col gap-0.5">
                <label
                  htmlFor="bench-car-brand"
                  className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold"
                >
                  Car Make
                </label>
                <select
                  id="bench-car-brand"
                  aria-label="Select Car Brand"
                  value={selectedBrandKey}
                  onChange={(e) => handleBrandChange(e.target.value)}
                  className="bg-slate-950 border border-slate-700/80 rounded px-1.5 py-1 text-[10.5px] text-slate-100 focus:outline-none focus:border-cyan-400 truncate cursor-pointer"
                >
                  <option value={UNIVERSAL_BRAND_KEY}>Universal ECU</option>
                  {VEHICLE_CATALOG.map((make) => (
                    <option key={make.brandKey} value={make.brandKey}>
                      {make.brandLabel}
                    </option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-0.5">
                <label
                  htmlFor="bench-car-model"
                  className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold"
                >
                  Car Model
                </label>
                <select
                  id="bench-car-model"
                  aria-label="Select Vehicle Model"
                  value={selectedBrandKey === UNIVERSAL_BRAND_KEY ? 'Generic 16-Pin Bench' : selectedModelName}
                  disabled={selectedBrandKey === UNIVERSAL_BRAND_KEY}
                  onChange={(e) => handleModelChange(e.target.value)}
                  className="bg-slate-950 border border-slate-700/80 rounded px-1.5 py-1 text-[10.5px] text-slate-100 focus:outline-none focus:border-cyan-400 disabled:opacity-60 truncate cursor-pointer"
                >
                  {selectedMake ? (
                    selectedMake.models.map((model) => (
                      <option key={model} value={model}>
                        {model}
                      </option>
                    ))
                  ) : (
                    <option value="Generic 16-Pin Bench">16-Pin Universal</option>
                  )}
                </select>
              </div>
            </div>

            <div className="flex flex-col gap-0.5">
              <div className="flex items-center justify-between">
                <label
                  htmlFor="bench-ecu-unit"
                  className="text-[9px] text-slate-400 uppercase tracking-wider font-semibold flex items-center gap-1"
                >
                  <Cpu className="w-2.5 h-2.5 text-amber-400" />
                  <span>ECU Module</span>
                </label>
                {activeProfile && onOpenEcuPinouts && (
                  <button
                    type="button"
                    onClick={onOpenEcuPinouts}
                    className="text-[9px] text-cyan-300 hover:text-cyan-200 flex items-center gap-0.5 cursor-pointer"
                  >
                    <span>OEM Pinouts</span>
                    <ExternalLink className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
              <select
                id="bench-ecu-unit"
                aria-label="Select ECU Model"
                value={selectedEcuProfileId || UNIVERSAL_BRAND_KEY}
                disabled={
                  vehicleCtx.status === 'PART_METADATA_ONLY' ||
                  vehicleCtx.status === 'MECHANICAL_NO_ECU'
                }
                onChange={(e) => handleEcuChange(e.target.value)}
                className="bg-slate-950 border border-slate-700/80 rounded px-1.5 py-1 text-[10.5px] text-amber-200 focus:outline-none focus:border-cyan-400 disabled:opacity-65 truncate cursor-pointer"
              >
                <option value={UNIVERSAL_BRAND_KEY}>
                  Universal 16-Pin Trainer (KL30 / KL15 / TPS / CAN)
                </option>
                {availableEcuProfiles.map((profile) => (
                  <option key={profile.id} value={profile.id}>
                    {profile.modelName}
                  </option>
                ))}
              </select>
            </div>

            {/* Ingestion Status, OCR_VERIFY Gate, & Table 16 DLC Readout */}
            {selectedBrandKey !== UNIVERSAL_BRAND_KEY && (
              <div
                className={`rounded px-2 py-1.5 text-[9.5px] border flex flex-col gap-1 ${
                  vehicleCtx.status === 'OCR_VERIFY'
                    ? 'bg-amber-950/40 border-amber-500/50 text-amber-200'
                    : vehicleCtx.status === 'PART_METADATA_ONLY'
                    ? 'bg-slate-900/90 border-rose-500/40 text-slate-300'
                    : vehicleCtx.status === 'MECHANICAL_NO_ECU'
                    ? 'bg-orange-950/40 border-orange-500/50 text-orange-200'
                    : 'bg-slate-950/70 border-cyan-500/20 text-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-1.5">
                  <span
                    className={`px-1.5 py-0.5 rounded font-bold text-[8.5px] uppercase tracking-wider ${
                      vehicleCtx.status === 'VERIFIED'
                        ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40'
                        : vehicleCtx.status === 'OCR_VERIFY'
                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                        : vehicleCtx.status === 'MECHANICAL_NO_ECU'
                        ? 'bg-orange-500/20 text-orange-300 border border-orange-500/50'
                        : 'bg-rose-500/20 text-rose-300 border border-rose-500/40'
                    }`}
                  >
                    {vehicleCtx.status}
                  </span>
                  {vehicleCtx.tableRef && (
                    <span className="text-[9px] text-cyan-300 truncate">{vehicleCtx.tableRef}</span>
                  )}
                </div>

                <div className="text-slate-200 font-semibold leading-snug">
                  {activeProfile ? activeProfile.cavityInfo : vehicleCtx.controllerNote}
                </div>

                {vehicleCtx.gateAlert && (
                  <div className="text-[9.5px] font-sans leading-snug text-amber-200 bg-black/30 rounded px-1.5 py-1 border border-amber-500/30">
                    {vehicleCtx.gateAlert}
                  </div>
                )}

                <div className="text-[9px] text-slate-400 truncate" title={vehicleCtx.dlcProtocol}>
                  DLC: {vehicleCtx.dlcProtocol}
                </div>

                {activeProfile && (
                  <div className="text-slate-400 truncate">
                    Key Pins:{' '}
                    {activeProfile.essentialChecklist
                      .slice(0, 3)
                      .map((item) => item.pin)
                      .join(' · ')}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* 2. Module & RPM Emulator Controls with Audio Feedback */}
          <div className="hud-well rounded-lg p-2 flex flex-col gap-2">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Gauge className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span className="text-[10px] font-bold uppercase tracking-wider text-slate-200 truncate">
                  RPM / CKP Emulator
                </span>
              </div>

              {/* Dynamic Acoustic Level Indicator */}
              <div
                className="flex items-center gap-1.5 shrink-0"
                title={soundTooltip}
              >
                <div className="flex items-end gap-0.5 h-3" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((bar) => (
                    <span
                      key={bar}
                      style={{ height: `${bar * 20}%` }}
                      className={`w-1 rounded-xs transition-colors ${
                        bar <= activeSoundBars
                          ? bar >= 4
                            ? 'bg-amber-400'
                            : 'bg-emerald-400'
                          : 'bg-slate-700'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[9px] text-slate-400 truncate max-w-[115px]">
                  {soundIntensityLabel}
                </span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleToggleRpmEmulator}
                aria-pressed={rpmEmulator.isActive}
                className={`px-2.5 py-1 rounded text-[10px] font-bold border transition shrink-0 cursor-pointer ${
                  rpmEmulator.isActive
                    ? 'bg-emerald-600/25 border-emerald-400 text-emerald-200 shadow-sm'
                    : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                }`}
              >
                {rpmEmulator.isActive ? 'ACTIVE' : 'TURN ON'}
              </button>

              <input
                type="range"
                aria-label="RPM Emulator Speed"
                min={600}
                max={7000}
                step={50}
                value={rpmEmulator.rpm}
                onChange={(e) => {
                  const nextRpm = parseInt(e.target.value, 10);
                  if (!rpmEmulator.isActive && rpmEmulator.soundEnabled) {
                    playModuleActivationSound(true, 'rpm');
                  }
                  onChangeRpmEmulator((prev) => ({
                    ...prev,
                    isActive: true,
                    rpm: nextRpm,
                  }));
                }}
                className="flex-1 accent-emerald-400 h-1.5 bg-slate-800 rounded cursor-pointer"
              />

              <span className="text-[11px] font-bold tabular-nums text-emerald-300 w-[62px] text-right shrink-0">
                {rpmEmulator.rpm} RPM
              </span>
            </div>

            {/* Quick RPM Presets */}
            <div className="grid grid-cols-4 gap-1">
              {RPM_PRESETS.map((preset) => {
                const isSelectedPreset =
                  rpmEmulator.isActive && Math.abs(rpmEmulator.rpm - preset.rpm) <= 100;
                return (
                  <button
                    key={preset.rpm}
                    type="button"
                    onClick={() => {
                      if (!rpmEmulator.isActive && rpmEmulator.soundEnabled) {
                        playModuleActivationSound(true, 'rpm');
                      }
                      onChangeRpmEmulator((prev) => ({
                        ...prev,
                        isActive: true,
                        rpm: preset.rpm,
                      }));
                    }}
                    className={`py-0.5 rounded text-[9.5px] border transition cursor-pointer ${
                      isSelectedPreset
                        ? 'bg-emerald-500/20 border-emerald-400 text-emerald-200 font-bold'
                        : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}
            </div>

            {/* Sub-module Activators with Tactile Sound Effects */}
            <div className="grid grid-cols-3 gap-1 pt-1 border-t border-slate-800/80">
              <button
                type="button"
                onClick={handleToggleInjector}
                aria-pressed={isInjectorActive}
                className={`px-1.5 py-1 rounded border text-[9.5px] flex items-center justify-center gap-1 transition cursor-pointer ${
                  isInjectorActive
                    ? 'bg-cyan-500/15 border-cyan-500/60 text-cyan-200 font-semibold'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Zap className="w-3 h-3 shrink-0" />
                <span className="truncate">INJ1 {isInjectorActive ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleRelay}
                aria-pressed={isRelayActive}
                className={`px-1.5 py-1 rounded border text-[9.5px] flex items-center justify-center gap-1 transition cursor-pointer ${
                  isRelayActive
                    ? 'bg-amber-500/15 border-amber-500/60 text-amber-200 font-semibold'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Radio className="w-3 h-3 shrink-0" />
                <span className="truncate">MREL {isRelayActive ? 'ON' : 'OFF'}</span>
              </button>

              <button
                type="button"
                onClick={handleToggleTpsStep}
                aria-pressed={isTpsBoosted}
                className={`px-1.5 py-1 rounded border text-[9.5px] flex items-center justify-center gap-1 transition cursor-pointer ${
                  isTpsBoosted
                    ? 'bg-purple-500/15 border-purple-500/60 text-purple-200 font-semibold'
                    : 'bg-slate-900/80 border-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <span className="truncate">TPS {tpsPercent}%</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
