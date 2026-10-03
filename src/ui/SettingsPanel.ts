import { CombatSettingsControls } from './CombatSettingsControls.ts';
import type { CombatSettings } from '../combat/settings.ts';
import type { FlightEffectSettings } from '../render/FlightEffects.ts';
import { bindButtonAction } from './bindButtonAction.ts';
import type { FlightTuningSettings } from '../flight/FlightTuning.ts';
import { FlightSettingsControls } from './FlightSettingsControls.ts';
import { installSettingHelp } from './SettingHelp.ts';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing settings element #${id}`);
  return result as T;
}

const STORAGE_KEY = 'aer0lith.settings.v4';
const SECTION_STATE_KEY = 'aer0lith.settings-sections.v1';
const PREVIOUS_STORAGE_KEY = 'aer0lith.settings.v3';
const AEROLITH_LEGACY_STORAGE_KEY = 'aer0lith.visual-settings.v2';
const LEGACY_STORAGE_KEY_V1 = 'vector-flight.visual-settings.v1';
const LEGACY_STORAGE_KEY_V2 = 'vector-flight.visual-settings.v2';

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function migrateVisualSettingsV1(saved: Record<string, unknown>): Record<string, unknown> {
  const terrainPointSize = saved.terrainPointSize;
  const dangerMaxSize = saved.dangerMaxSize;
  return {
    ...saved,
    terrainDotRadiusM: typeof terrainPointSize === 'number' && Number.isFinite(terrainPointSize)
      ? clamp(terrainPointSize * 0.14, 0.05, 0.6)
      : undefined,
    dangerSizeMultiplier: typeof dangerMaxSize === 'number' && Number.isFinite(dangerMaxSize)
      ? clamp(1 + dangerMaxSize / 8, 1, 8)
      : undefined,
  };
}

export interface AppSettings extends FlightEffectSettings, CombatSettings, FlightTuningSettings {
  scanTerrainSpeed: number;
  scanTerrainPattern: 'dot' | 'plus';
  scanTerrainPatternSpacing: number;
  scanTerrainPatternSize: number;
  scanTerrainPatternColor: string;
  scanTerrainPatternBrightness: number;
  scanTerrainPatternPersistence: number;
  scanTerrainFrontWidth: number;
  scanTerrainFrontColor: string;
  scanTerrainFrontBrightness: number;
  scanTerrainTrailColor: string;
  scanTerrainTrailLength: number;
  scanTerrainTrailFalloff: number;
  scanGlassEnabled: boolean;
  scanGlassFlutter: number;
  scanGlassFlutterRate: number;
  /** Retains the saved key; now controls the separate shell's fade-out. */
  scanGlassPersistence: number;
  boostShakeStrength: number;
  boostShakeFrequency: number;
  shipGhostEnabled: boolean;
  shipGhostOpacity: number;
  shipGhostColor: string;
  scanGlassStrength: number;
  scanGlassDispersion: number;
  renderResolutionMode: 'full' | 'balanced' | 'adaptive';
  terrainRenderingMode: 'dot' | 'mesh';
  backgroundColor: string;
  meshColor: string;
  terrainFogDensity: number;
  dangerDistance: number;
  dangerSizeMultiplier: number;
  dangerSizeFalloff: number;
  dangerColor: string;
  terrainDotRadiusM: number;
  terrainDotDensityPer100M2: number;
  terrainColor: string;
  terrainCrystalAmount: number;
  terrainCrystalOpacity: number;
  terrainCrystalRefraction: number;
  terrainCrystalDispersion: number;
  terrainCrystalColor: string;
  planeColor: string;
  autopilotGuideColor: string;
  windStreakCount: number;
  windStreakLength: number;
  windSpeedThreshold: number;
  windOpacity: number;
  windColor: string;
  windLengthSpeedResponse: number;
  windCountSpeedResponse: number;
  flockEnabled: boolean;
  flockMinSize: number;
  flockMaxSize: number;
  flockInterval: number;
  flockSpread: number;
  flockSpeed: number;
  flockColor: string;
  flockTargetColor: string;
  flockTargetThickness: number;
  crtEnabled: boolean;
  crtCurvature: number;
  crtRgbMask: number;
  crtScanlines: number;
  crtGrain: number;
  crtVignette: number;
  crtChromatic: number;
  crtDither: number;
  motionBlurEnabled: boolean;
  motionBlurStrength: number;
  motionBlurStartSpeed: number;
  motionBlurMaxPixels: number;
  glowEnabled: boolean;
  glowStrength: number;
  glowRadius: number;
  fontChoice: 'technical' | 'system' | 'terminal';
}

/** Compatibility alias for render systems that still consume the visual subset. */
export type VisualSettings = AppSettings;

export class SettingsPanel {
  readonly button = element<HTMLButtonElement>('settings-button');
  private readonly panel = element<HTMLElement>('settings-panel');
  private readonly applyWorldSettingsButton = element<HTMLButtonElement>('apply-world-settings');
  private readonly renderResolutionMode = element<HTMLSelectElement>('render-resolution-mode');
  private readonly terrainRenderingMode = element<HTMLSelectElement>('terrain-rendering-mode');
  private readonly backgroundColor = element<HTMLInputElement>('background-color');
  private readonly meshColor = element<HTMLInputElement>('mesh-color');
  private readonly terrainFogDensity = element<HTMLInputElement>('terrain-fog-density');
  private readonly dotRenderSettings = element<HTMLElement>('dot-render-settings');
  private readonly meshRenderSettings = element<HTMLElement>('mesh-render-settings');
  private readonly dangerDistance = element<HTMLInputElement>('danger-distance');
  private readonly dangerSizeMultiplier = element<HTMLInputElement>('danger-size-multiplier');
  private readonly dangerSizeFalloff = element<HTMLInputElement>('danger-size-falloff');
  private readonly dangerColor = element<HTMLInputElement>('danger-color');
  private readonly terrainDotRadiusM = element<HTMLInputElement>('terrain-dot-radius');
  private readonly terrainDotDensity = element<HTMLInputElement>('terrain-dot-density');
  private readonly terrainColor = element<HTMLInputElement>('terrain-color');
  private readonly terrainCrystalAmount = element<HTMLInputElement>('terrain-crystal-amount');
  private readonly terrainCrystalOpacity = element<HTMLInputElement>('terrain-crystal-opacity');
  private readonly terrainCrystalRefraction = element<HTMLInputElement>('terrain-crystal-refraction');
  private readonly terrainCrystalDispersion = element<HTMLInputElement>('terrain-crystal-dispersion');
  private readonly terrainCrystalColor = element<HTMLInputElement>('terrain-crystal-color');
  private readonly scanTerrainSpeed = element<HTMLInputElement>('scan-terrain-speed');
  private readonly scanTerrainSpeedValue = element<HTMLOutputElement>('scan-terrain-speed-value');
  private readonly scanTerrainPattern = element<HTMLSelectElement>('scan-terrain-pattern');
  private readonly scanTerrainPatternSpacing = element<HTMLInputElement>('scan-terrain-pattern-spacing');
  private readonly scanTerrainPatternSpacingValue = element<HTMLOutputElement>('scan-terrain-pattern-spacing-value');
  private readonly scanTerrainPatternSize = element<HTMLInputElement>('scan-terrain-pattern-size');
  private readonly scanTerrainPatternSizeValue = element<HTMLOutputElement>('scan-terrain-pattern-size-value');
  private readonly scanTerrainPatternColor = element<HTMLInputElement>('scan-terrain-pattern-color');
  private readonly scanTerrainPatternBrightness = element<HTMLInputElement>('scan-terrain-pattern-brightness');
  private readonly scanTerrainPatternBrightnessValue = element<HTMLOutputElement>('scan-terrain-pattern-brightness-value');
  private readonly scanTerrainPatternPersistence = element<HTMLInputElement>('scan-terrain-pattern-persistence');
  private readonly scanTerrainPatternPersistenceValue = element<HTMLOutputElement>('scan-terrain-pattern-persistence-value');
  private readonly scanTerrainFrontWidth = element<HTMLInputElement>('scan-terrain-front-width');
  private readonly scanTerrainFrontWidthValue = element<HTMLOutputElement>('scan-terrain-front-width-value');
  private readonly scanTerrainFrontColor = element<HTMLInputElement>('scan-terrain-front-color');
  private readonly scanTerrainFrontBrightness = element<HTMLInputElement>('scan-terrain-front-brightness');
  private readonly scanTerrainFrontBrightnessValue = element<HTMLOutputElement>('scan-terrain-front-brightness-value');
  private readonly scanTerrainTrailColor = element<HTMLInputElement>('scan-terrain-trail-color');
  private readonly scanTerrainTrailLength = element<HTMLInputElement>('scan-terrain-trail-length');
  private readonly scanTerrainTrailLengthValue = element<HTMLOutputElement>('scan-terrain-trail-length-value');
  private readonly scanTerrainTrailFalloff = element<HTMLInputElement>('scan-terrain-trail-falloff');
  private readonly scanTerrainTrailFalloffValue = element<HTMLOutputElement>('scan-terrain-trail-falloff-value');
  private readonly scanGlassFlutter = element<HTMLInputElement>('scan-glass-flutter');
  private readonly scanGlassFlutterValue = element<HTMLOutputElement>('scan-glass-flutter-value');
  private readonly scanGlassFlutterRate = element<HTMLInputElement>('scan-glass-flutter-rate');
  private readonly scanGlassFlutterRateValue = element<HTMLOutputElement>('scan-glass-flutter-rate-value');
  private readonly scanGlassEnabled = element<HTMLInputElement>('scan-glass-enabled');
  private readonly wakeDebugButton = element<HTMLButtonElement>('wake-debug');
  private wakeDebugEnabled = false;
  private readonly boostFadeDuration = element<HTMLInputElement>('boost-fade-duration');
  private readonly boostFadeDurationValue = element<HTMLOutputElement>('boost-fade-duration-value');
  private readonly boostIdleAmount = element<HTMLInputElement>('boost-idle-amount');
  private readonly boostIdleAmountValue = element<HTMLOutputElement>('boost-idle-amount-value');
  private readonly scanGlassStrength = element<HTMLInputElement>('scan-glass-strength');
  private readonly scanGlassStrengthValue = element<HTMLOutputElement>('scan-glass-strength-value');
  private readonly scanGlassDispersion = element<HTMLInputElement>('scan-glass-dispersion');
  private readonly scanGlassDispersionValue = element<HTMLOutputElement>('scan-glass-dispersion-value');
  private readonly boostGlassDebugButton = element<HTMLButtonElement>('boost-glass-debug');
  private boostGlassDebug = false;
  private readonly boostExhaustWidth = element<HTMLInputElement>('boost-exhaust-width');
  private readonly boostExhaustWidthValue = element<HTMLOutputElement>('boost-exhaust-width-value');
  private readonly boostGlassWidth = element<HTMLInputElement>('boost-glass-width');
  private readonly boostGlassWidthValue = element<HTMLOutputElement>('boost-glass-width-value');
  private readonly boostGlassLength = element<HTMLInputElement>('boost-glass-length');
  private readonly boostGlassLengthValue = element<HTMLOutputElement>('boost-glass-length-value');
  private readonly boostGlassEnabled = element<HTMLInputElement>('boost-glass-enabled');
  private readonly shipGhostEnabled = element<HTMLInputElement>('ship-ghost-enabled');
  private readonly boostRefraction = element<HTMLInputElement>('boost-refraction');
  private readonly boostRefractionValue = element<HTMLOutputElement>('boost-refraction-value');
  private readonly boostDispersion = element<HTMLInputElement>('boost-dispersion');
  private readonly boostDispersionValue = element<HTMLOutputElement>('boost-dispersion-value');
  private readonly boostFlowRate = element<HTMLInputElement>('boost-flow-rate');
  private readonly boostFlowRateValue = element<HTMLOutputElement>('boost-flow-rate-value');
  private readonly wingWarpFlowRate = element<HTMLInputElement>('wing-warp-flow-rate');
  private readonly wingWarpFlowRateValue = element<HTMLOutputElement>('wing-warp-flow-rate-value');
  private readonly wingWarpFlutterRate = element<HTMLInputElement>('wing-warp-flutter-rate');
  private readonly wingWarpFlutterRateValue = element<HTMLOutputElement>('wing-warp-flutter-rate-value');
  private readonly windCountSpeedResponse = element<HTMLInputElement>('wind-count-speed-response');
  private readonly windCountSpeedResponseValue = element<HTMLOutputElement>('wind-count-speed-response-value');
  private readonly windLengthSpeedResponse = element<HTMLInputElement>('wind-length-speed-response');
  private readonly windLengthSpeedResponseValue = element<HTMLOutputElement>('wind-length-speed-response-value');
  private readonly boostFlutter = element<HTMLInputElement>('boost-flutter');
  private readonly boostFlutterValue = element<HTMLOutputElement>('boost-flutter-value');
  private readonly boostFlutterRate = element<HTMLInputElement>('boost-flutter-rate');
  private readonly boostFlutterRateValue = element<HTMLOutputElement>('boost-flutter-rate-value');
  private readonly boostShakeStrength = element<HTMLInputElement>('boost-shake-strength');
  private readonly boostShakeStrengthValue = element<HTMLOutputElement>('boost-shake-strength-value');
  private readonly boostShakeFrequency = element<HTMLInputElement>('boost-shake-frequency');
  private readonly boostShakeFrequencyValue = element<HTMLOutputElement>('boost-shake-frequency-value');
  private readonly wingSweepBack = element<HTMLInputElement>('wing-sweep-back');
  private readonly wingSweepBackValue = element<HTMLOutputElement>('wing-sweep-back-value');
  private readonly wingTuckIn = element<HTMLInputElement>('wing-tuck-in');
  private readonly wingTuckInValue = element<HTMLOutputElement>('wing-tuck-in-value');
  private readonly wingFoldSpeed = element<HTMLInputElement>('wing-fold-speed');
  private readonly wingFoldSpeedValue = element<HTMLOutputElement>('wing-fold-speed-value');
  private readonly scanGlassPersistence = element<HTMLInputElement>('scan-glass-persistence');
  private readonly scanGlassPersistenceValue = element<HTMLOutputElement>('scan-glass-persistence-value');
  private readonly shipGhostColor = element<HTMLInputElement>('ship-ghost-color');
  private readonly shipGhostOpacity = element<HTMLInputElement>('ship-ghost-opacity');
  private readonly shipGhostOpacityValue = element<HTMLOutputElement>('ship-ghost-opacity-value');
  private readonly boostExhaustColor = element<HTMLInputElement>('boost-exhaust-color');
  private readonly boostExhaustLength = element<HTMLInputElement>('boost-exhaust-length');
  private readonly boostExhaustLengthValue = element<HTMLOutputElement>('boost-exhaust-length-value');
  private readonly wingWarpLength = element<HTMLInputElement>('wing-warp-length');
  private readonly wingWarpLengthValue = element<HTMLOutputElement>('wing-warp-length-value');
  private readonly wingWarpHeight = element<HTMLInputElement>('wing-warp-height');
  private readonly wingWarpHeightValue = element<HTMLOutputElement>('wing-warp-height-value');
  private readonly wingWarpThickness = element<HTMLInputElement>('wing-warp-thickness');
  private readonly wingWarpThicknessValue = element<HTMLOutputElement>('wing-warp-thickness-value');
  private readonly wingWarpFlutter = element<HTMLInputElement>('wing-warp-flutter');
  private readonly wingWarpFlutterValue = element<HTMLOutputElement>('wing-warp-flutter-value');
  private readonly wingWarpOpacity = element<HTMLInputElement>('wing-warp-opacity');
  private readonly wingWarpOpacityValue = element<HTMLOutputElement>('wing-warp-opacity-value');
  private readonly wingWarpDispersion = element<HTMLInputElement>('wing-warp-dispersion');
  private readonly wingWarpDispersionValue = element<HTMLOutputElement>('wing-warp-dispersion-value');
  private readonly boostExhaustEnabled = element<HTMLInputElement>('boost-exhaust-enabled');
  private readonly boostExhaustStrength = element<HTMLInputElement>('boost-exhaust-strength');
  private readonly wingWarpEnabled = element<HTMLInputElement>('wing-warp-enabled');
  private readonly wingWarpStrength = element<HTMLInputElement>('wing-warp-strength');
  private readonly boostExhaustStrengthValue = element<HTMLOutputElement>('boost-exhaust-strength-value');
  private readonly wingWarpStrengthValue = element<HTMLOutputElement>('wing-warp-strength-value');
  private readonly planeColor = element<HTMLInputElement>('plane-color');
  private readonly autopilotGuideColor = element<HTMLInputElement>('autopilot-guide-color');
  private readonly windStreakLength = element<HTMLInputElement>('wind-streak-length');
  private readonly windStreakCount = element<HTMLInputElement>('wind-streak-count');
  private readonly windSpeedThreshold = element<HTMLInputElement>('wind-speed-threshold');
  private readonly windOpacity = element<HTMLInputElement>('wind-opacity');
  private readonly windColor = element<HTMLInputElement>('wind-color');
  private readonly flockEnabled = element<HTMLInputElement>('flock-enabled');
  private readonly flockSizeRange = element<HTMLElement>('flock-size-range');
  private readonly flockMinSize = element<HTMLInputElement>('flock-size-min');
  private readonly flockMaxSize = element<HTMLInputElement>('flock-size-max');
  private readonly flockInterval = element<HTMLInputElement>('flock-interval');
  private readonly flockSpread = element<HTMLInputElement>('flock-spread');
  private readonly flockSpeed = element<HTMLInputElement>('flock-speed');
  private readonly flockColor = element<HTMLInputElement>('flock-color');
  private readonly flockTargetColor = element<HTMLInputElement>('flock-target-color');
  private readonly flockTargetThickness = element<HTMLInputElement>('flock-target-thickness');
  private readonly crtEnabled = element<HTMLInputElement>('crt-enabled');
  private readonly crtCurvature = element<HTMLInputElement>('crt-curvature');
  private readonly crtRgbMask = element<HTMLInputElement>('crt-rgb-mask');
  private readonly crtScanlines = element<HTMLInputElement>('crt-scanlines');
  private readonly crtGrain = element<HTMLInputElement>('crt-grain');
  private readonly crtVignette = element<HTMLInputElement>('crt-vignette');
  private readonly crtChromatic = element<HTMLInputElement>('crt-chromatic');
  private readonly crtDither = element<HTMLInputElement>('crt-dither');
  private readonly motionBlurEnabled = element<HTMLInputElement>('motion-blur-enabled');
  private readonly motionBlurStrength = element<HTMLInputElement>('motion-blur-strength');
  private readonly motionBlurStartSpeed = element<HTMLInputElement>('motion-blur-start-speed');
  private readonly motionBlurMaxPixels = element<HTMLInputElement>('motion-blur-max-pixels');
  private readonly motionBlurStrengthValue = element<HTMLOutputElement>('motion-blur-strength-value');
  private readonly motionBlurStartSpeedValue = element<HTMLOutputElement>('motion-blur-start-speed-value');
  private readonly motionBlurMaxPixelsValue = element<HTMLOutputElement>('motion-blur-max-pixels-value');
  private readonly glowEnabled = element<HTMLInputElement>('glow-enabled');
  private readonly glowStrength = element<HTMLInputElement>('glow-strength');
  private readonly glowRadius = element<HTMLInputElement>('glow-radius');
  private readonly fontChoice = element<HTMLSelectElement>('font-choice');
  private readonly dangerDistanceValue = element<HTMLOutputElement>('danger-distance-value');
  private readonly dangerSizeMultiplierValue = element<HTMLOutputElement>('danger-size-multiplier-value');
  private readonly dangerSizeFalloffValue = element<HTMLOutputElement>('danger-size-falloff-value');
  private readonly terrainDotRadiusValue = element<HTMLOutputElement>('terrain-dot-radius-value');
  private readonly terrainDotDensityValue = element<HTMLOutputElement>('terrain-dot-density-value');
  private readonly terrainCrystalAmountValue = element<HTMLOutputElement>('terrain-crystal-amount-value');
  private readonly terrainCrystalOpacityValue = element<HTMLOutputElement>('terrain-crystal-opacity-value');
  private readonly terrainCrystalRefractionValue = element<HTMLOutputElement>('terrain-crystal-refraction-value');
  private readonly terrainCrystalDispersionValue = element<HTMLOutputElement>('terrain-crystal-dispersion-value');
  private readonly windStreakLengthValue = element<HTMLOutputElement>('wind-streak-length-value');
  private readonly windStreakCountValue = element<HTMLOutputElement>('wind-streak-count-value');
  private readonly windSpeedThresholdValue = element<HTMLOutputElement>('wind-speed-threshold-value');
  private readonly windOpacityValue = element<HTMLOutputElement>('wind-opacity-value');
  private readonly flockSizeValue = element<HTMLOutputElement>('flock-size-value');
  private readonly flockIntervalValue = element<HTMLOutputElement>('flock-interval-value');
  private readonly flockSpreadValue = element<HTMLOutputElement>('flock-spread-value');
  private readonly flockSpeedValue = element<HTMLOutputElement>('flock-speed-value');
  private readonly flockTargetThicknessValue = element<HTMLOutputElement>('flock-target-thickness-value');
  private readonly crtCurvatureValue = element<HTMLOutputElement>('crt-curvature-value');
  private readonly crtRgbMaskValue = element<HTMLOutputElement>('crt-rgb-mask-value');
  private readonly crtScanlinesValue = element<HTMLOutputElement>('crt-scanlines-value');
  private readonly crtGrainValue = element<HTMLOutputElement>('crt-grain-value');
  private readonly crtVignetteValue = element<HTMLOutputElement>('crt-vignette-value');
  private readonly crtChromaticValue = element<HTMLOutputElement>('crt-chromatic-value');
  private readonly crtDitherValue = element<HTMLOutputElement>('crt-dither-value');
  private readonly terrainFogDensityValue = element<HTMLOutputElement>('terrain-fog-density-value');
  private readonly glowStrengthValue = element<HTMLOutputElement>('glow-strength-value');
  private readonly glowRadiusValue = element<HTMLOutputElement>('glow-radius-value');
  onChange: ((settings: AppSettings) => void) | undefined;
  onReset: (() => void) | undefined;
  onApplyWorldSettings: (() => void) | undefined;
  private readonly resetButton = document.createElement('button');
  private readonly resetEvents = new AbortController();
  private readonly defaults: Array<{ input: HTMLInputElement | HTMLSelectElement; value: string; checked: boolean }>;

  private readonly combatControls = new CombatSettingsControls();
  private readonly flightControls: FlightSettingsControls;

  constructor() {
    this.flightControls = new FlightSettingsControls(this.panel);
    this.installCollapsibleSections();
    installSettingHelp(this.panel);
    // Capture the shipped HTML and combat defaults before loading personal edits.
    this.defaults = Array.from(this.panel.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'), input => ({
      input, value: input.value, checked: input instanceof HTMLInputElement && input.checked,
    }));
    this.resetButton.id = 'reset-settings';
    this.resetButton.type = 'button';
    this.resetButton.className = 'reset-settings';
    this.resetButton.textContent = 'RESET ALL SETTINGS TO DEFAULT';
    this.panel.append(this.resetButton);
    bindButtonAction(this.resetButton, () => this.resetToDefaults(), this.resetEvents.signal);
    this.restore();
    this.flockMinSize.addEventListener('input', () => {
      if (this.flockMinSize.valueAsNumber > this.flockMaxSize.valueAsNumber) {
        this.flockMinSize.value = this.flockMaxSize.value;
      }
    });
    this.flockMaxSize.addEventListener('input', () => {
      if (this.flockMaxSize.valueAsNumber < this.flockMinSize.valueAsNumber) {
        this.flockMaxSize.value = this.flockMinSize.value;
      }
    });
    bindButtonAction(this.button, () => this.toggle());
    bindButtonAction(this.applyWorldSettingsButton, () => this.onApplyWorldSettings?.());
    bindButtonAction(this.boostGlassDebugButton, () => {
      this.boostGlassDebug = !this.boostGlassDebug;
      this.emit();
    });
    bindButtonAction(this.wakeDebugButton, () => {
      this.wakeDebugEnabled = !this.wakeDebugEnabled;
      this.emit();
    });
    for (const input of this.panel.querySelectorAll('input, select')) {
      input.addEventListener('input', () => this.emit());
      input.addEventListener('change', () => this.emit());
    }
    this.updateReadouts();
    this.updateModeVisibility();
  }

  get values(): AppSettings {
    return {
      ...this.combatControls.values,
      ...this.flightControls.values,
      renderResolutionMode: this.renderResolutionMode.value as AppSettings['renderResolutionMode'],
      terrainRenderingMode: this.terrainRenderingMode.value as AppSettings['terrainRenderingMode'],
      backgroundColor: this.backgroundColor.value,
      meshColor: this.meshColor.value,
      terrainFogDensity: this.terrainFogDensity.valueAsNumber,
      dangerDistance: this.dangerDistance.valueAsNumber,
      dangerSizeMultiplier: this.dangerSizeMultiplier.valueAsNumber,
      dangerSizeFalloff: this.dangerSizeFalloff.valueAsNumber,
      dangerColor: this.dangerColor.value,
      terrainDotRadiusM: this.terrainDotRadiusM.valueAsNumber,
      terrainDotDensityPer100M2: this.terrainDotDensity.valueAsNumber,
      terrainColor: this.terrainColor.value,
      terrainCrystalAmount: this.terrainCrystalAmount.valueAsNumber,
      terrainCrystalOpacity: this.terrainCrystalOpacity.valueAsNumber,
      terrainCrystalRefraction: this.terrainCrystalRefraction.valueAsNumber,
      terrainCrystalDispersion: this.terrainCrystalDispersion.valueAsNumber,
      terrainCrystalColor: this.terrainCrystalColor.value,
      planeColor: this.planeColor.value,
      scanTerrainSpeed: this.scanTerrainSpeed.valueAsNumber,
      scanTerrainPattern: this.scanTerrainPattern.value as AppSettings['scanTerrainPattern'],
      scanTerrainPatternSpacing: this.scanTerrainPatternSpacing.valueAsNumber,
      scanTerrainPatternSize: this.scanTerrainPatternSize.valueAsNumber,
      scanTerrainPatternColor: this.scanTerrainPatternColor.value,
      scanTerrainPatternBrightness: this.scanTerrainPatternBrightness.valueAsNumber,
      scanTerrainPatternPersistence: this.scanTerrainPatternPersistence.valueAsNumber,
      scanTerrainFrontWidth: this.scanTerrainFrontWidth.valueAsNumber,
      scanTerrainFrontColor: this.scanTerrainFrontColor.value,
      scanTerrainFrontBrightness: this.scanTerrainFrontBrightness.valueAsNumber,
      scanTerrainTrailColor: this.scanTerrainTrailColor.value,
      scanTerrainTrailLength: this.scanTerrainTrailLength.valueAsNumber,
      scanTerrainTrailFalloff: this.scanTerrainTrailFalloff.valueAsNumber,
      scanGlassEnabled: this.scanGlassEnabled.checked,
      scanGlassFlutter: this.scanGlassFlutter.valueAsNumber,
      scanGlassFlutterRate: this.scanGlassFlutterRate.valueAsNumber,
      wakeDebugEnabled: this.wakeDebugEnabled,
      boostFadeDuration: this.boostFadeDuration.valueAsNumber,
      boostIdleAmount: this.boostIdleAmount.valueAsNumber,
      scanGlassStrength: this.scanGlassStrength.valueAsNumber,
      scanGlassDispersion: this.scanGlassDispersion.valueAsNumber,
      boostGlassEnabled: this.boostGlassEnabled.checked,
      boostGlassDebug: this.boostGlassDebug,
      boostExhaustWidth: this.boostExhaustWidth.valueAsNumber,
      boostGlassWidth: this.boostGlassWidth.valueAsNumber,
      boostGlassLength: this.boostGlassLength.valueAsNumber,
      shipGhostEnabled: this.shipGhostEnabled.checked,
      boostRefraction: this.boostRefraction.valueAsNumber,
      boostDispersion: this.boostDispersion.valueAsNumber,
      boostFlowRate: this.boostFlowRate.valueAsNumber,
      wingWarpFlowRate: this.wingWarpFlowRate.valueAsNumber,
      wingWarpFlutterRate: this.wingWarpFlutterRate.valueAsNumber,
      windCountSpeedResponse: this.windCountSpeedResponse.valueAsNumber,
      windLengthSpeedResponse: this.windLengthSpeedResponse.valueAsNumber,
      boostFlutter: this.boostFlutter.valueAsNumber,
      boostFlutterRate: this.boostFlutterRate.valueAsNumber,
      boostShakeStrength: this.boostShakeStrength.valueAsNumber,
      boostShakeFrequency: this.boostShakeFrequency.valueAsNumber,
      wingSweepBack: this.wingSweepBack.valueAsNumber,
      wingTuckIn: this.wingTuckIn.valueAsNumber,
      wingFoldSpeed: this.wingFoldSpeed.valueAsNumber,
      scanGlassPersistence: this.scanGlassPersistence.valueAsNumber,
      shipGhostOpacity: this.shipGhostOpacity.valueAsNumber,
      shipGhostColor: this.shipGhostColor.value,
      boostExhaustColor: this.boostExhaustColor.value,
      boostExhaustLength: this.boostExhaustLength.valueAsNumber,
      wingWarpLength: this.wingWarpLength.valueAsNumber,
      wingWarpHeight: this.wingWarpHeight.valueAsNumber,
      wingWarpThickness: this.wingWarpThickness.valueAsNumber,
      wingWarpFlutter: this.wingWarpFlutter.valueAsNumber,
      wingWarpOpacity: this.wingWarpOpacity.valueAsNumber,
      wingWarpDispersion: this.wingWarpDispersion.valueAsNumber,
      boostExhaustEnabled: this.boostExhaustEnabled.checked,
      boostExhaustStrength: this.boostExhaustStrength.valueAsNumber,
      wingWarpEnabled: this.wingWarpEnabled.checked,
      wingWarpStrength: this.wingWarpStrength.valueAsNumber,
      autopilotGuideColor: this.autopilotGuideColor.value,
      windStreakCount: this.windStreakCount.valueAsNumber,
      windStreakLength: this.windStreakLength.valueAsNumber,
      windSpeedThreshold: this.windSpeedThreshold.valueAsNumber,
      windOpacity: this.windOpacity.valueAsNumber,
      windColor: this.windColor.value,
      flockEnabled: this.flockEnabled.checked,
      flockMinSize: this.flockMinSize.valueAsNumber,
      flockMaxSize: this.flockMaxSize.valueAsNumber,
      flockInterval: this.flockInterval.valueAsNumber,
      flockSpread: this.flockSpread.valueAsNumber,
      flockSpeed: this.flockSpeed.valueAsNumber,
      flockColor: this.flockColor.value,
      flockTargetColor: this.flockTargetColor.value,
      flockTargetThickness: this.flockTargetThickness.valueAsNumber,
      crtEnabled: this.crtEnabled.checked,
      crtCurvature: this.crtCurvature.valueAsNumber,
      crtRgbMask: this.crtRgbMask.valueAsNumber,
      crtScanlines: this.crtScanlines.valueAsNumber,
      crtGrain: this.crtGrain.valueAsNumber,
      crtVignette: this.crtVignette.valueAsNumber,
      crtChromatic: this.crtChromatic.valueAsNumber,
      crtDither: this.crtDither.valueAsNumber,
      motionBlurEnabled: this.motionBlurEnabled.checked,
      motionBlurStrength: this.motionBlurStrength.valueAsNumber,
      motionBlurStartSpeed: this.motionBlurStartSpeed.valueAsNumber,
      motionBlurMaxPixels: this.motionBlurMaxPixels.valueAsNumber,
      glowEnabled: this.glowEnabled.checked,
      glowStrength: this.glowStrength.valueAsNumber,
      glowRadius: this.glowRadius.valueAsNumber,
      fontChoice: this.fontChoice.value as AppSettings['fontChoice'],
    };
  }

  apply(): void {
    this.emit();
  }

  private toggle(): void {
    const opening = this.panel.hidden;
    this.panel.hidden = !opening;
    this.button.setAttribute('aria-expanded', String(opening));
    this.button.setAttribute('aria-label', opening ? 'Close game settings' : 'Open game settings');
    this.button.textContent = opening ? 'SETTINGS / CLOSE' : 'SETTINGS';
  }

  private installCollapsibleSections(): void {
    const priority = [
      'settings-handling-title',
      'settings-camera-follow-title',
      'settings-drift-energy-title',
      'settings-drift-boost-title',
      'settings-drift-display-title',
      'settings-drift-trail-title',
      'settings-impact-title',
      'settings-navigation-title',
      'settings-world-route-title',
      'settings-touch-title',
    ];
    const sections = Array.from(this.panel.querySelectorAll<HTMLElement>(':scope > .settings-section'));
    const first = sections[0];
    if (first) {
      const ordered = priority
        .map(id => sections.find(section => section.querySelector(':scope > h2')?.id === id))
        .filter((section): section is HTMLElement => Boolean(section));
      const marker = document.createComment('primary settings order');
      first.before(marker);
      for (const section of ordered) marker.before(section);
      marker.remove();
    }

    const expanded = this.restoreExpandedSections();
    for (const section of this.panel.querySelectorAll<HTMLElement>(':scope > .settings-section')) {
      const heading = section.querySelector<HTMLElement>(':scope > h2');
      if (!heading) continue;
      const key = heading.id || (heading.textContent ?? 'settings')
        .trim().toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'settings-section-toggle';
      button.id = heading.id;
      button.textContent = heading.textContent;
      button.setAttribute('aria-expanded', String(expanded.has(key)));
      heading.replaceWith(button);

      const content = document.createElement('div');
      content.className = 'settings-section-content';
      content.id = `${key}-settings-content`;
      while (button.nextSibling) content.append(button.nextSibling);
      section.append(content);
      button.setAttribute('aria-controls', content.id);
      section.dataset.settingsSection = key;
      section.classList.toggle('is-collapsed', !expanded.has(key));
      button.addEventListener('click', () => {
        const collapsed = section.classList.toggle('is-collapsed');
        button.setAttribute('aria-expanded', String(!collapsed));
        this.persistExpandedSections();
      }, { signal: this.resetEvents.signal });
    }
  }

  private restoreExpandedSections(): Set<string> {
    try {
      const parsed = JSON.parse(localStorage.getItem(SECTION_STATE_KEY) ?? '[]') as unknown;
      return new Set(Array.isArray(parsed) ? parsed.filter(value => typeof value === 'string') : []);
    } catch {
      return new Set();
    }
  }

  private persistExpandedSections(): void {
    try {
      const expanded = Array.from(
        this.panel.querySelectorAll<HTMLElement>(':scope > .settings-section:not(.is-collapsed)'),
        section => section.dataset.settingsSection,
      ).filter((key): key is string => Boolean(key));
      localStorage.setItem(SECTION_STATE_KEY, JSON.stringify(expanded));
    } catch {
      // Section toggles remain usable when storage is unavailable.
    }
  }

  private emit(): void {
    this.updateReadouts();
    this.updateModeVisibility();
    const settings = this.values;
    this.persist(settings);
    this.onChange?.(settings);
  }

  resetToDefaults(): void {
    for (const { input, value, checked } of this.defaults) {
      input.value = value;
      if (input instanceof HTMLInputElement) input.checked = checked;
    }
    this.wakeDebugEnabled = false;
    this.boostGlassDebug = false;
    this.onReset?.();
    this.emit();
  }

  private restore(): void {
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      const previousRaw = currentRaw ? null : localStorage.getItem(PREVIOUS_STORAGE_KEY);
      const aerolithLegacyRaw = currentRaw || previousRaw ? null : localStorage.getItem(AEROLITH_LEGACY_STORAGE_KEY);
      const legacyV2Raw = currentRaw || previousRaw || aerolithLegacyRaw ? null : localStorage.getItem(LEGACY_STORAGE_KEY_V2);
      const legacyV1Raw = currentRaw || previousRaw || aerolithLegacyRaw || legacyV2Raw
        ? null
        : localStorage.getItem(LEGACY_STORAGE_KEY_V1);
      const parsed = JSON.parse(currentRaw ?? previousRaw ?? aerolithLegacyRaw ?? legacyV2Raw ?? legacyV1Raw ?? 'null') as unknown;
      if (!isRecord(parsed)) return;
      const saved = legacyV1Raw ? migrateVisualSettingsV1(parsed) : parsed;
      this.combatControls.restore(saved);
      this.flightControls.restore(saved);
      if (
        saved.renderResolutionMode === 'full'
        || saved.renderResolutionMode === 'balanced'
        || saved.renderResolutionMode === 'adaptive'
      ) {
        this.renderResolutionMode.value = saved.renderResolutionMode;
      }
      if (saved.terrainRenderingMode === 'dot' || saved.terrainRenderingMode === 'mesh') {
        this.terrainRenderingMode.value = saved.terrainRenderingMode;
      }
      this.restoreColor(this.backgroundColor, saved.backgroundColor);
      this.restoreColor(this.meshColor, saved.meshColor);
      this.restoreRange(this.terrainFogDensity, saved.terrainFogDensity);
      this.restoreRange(this.dangerDistance, saved.dangerDistance);
      this.restoreRange(this.dangerSizeMultiplier, saved.dangerSizeMultiplier);
      this.restoreRange(this.dangerSizeFalloff, saved.dangerSizeFalloff);
      this.restoreColor(this.dangerColor, saved.dangerColor);
      this.restoreRange(this.terrainDotRadiusM, saved.terrainDotRadiusM);
      this.restoreRange(this.terrainDotDensity, saved.terrainDotDensityPer100M2);
      this.restoreColor(this.terrainColor, this.migrateColor(saved.terrainColor, '#b7bdbb', '#c8c8c8'));
      this.restoreRange(this.terrainCrystalAmount, saved.terrainCrystalAmount);
      this.restoreRange(this.terrainCrystalOpacity, saved.terrainCrystalOpacity);
      this.restoreRange(this.terrainCrystalRefraction, saved.terrainCrystalRefraction);
      this.restoreRange(this.terrainCrystalDispersion, saved.terrainCrystalDispersion);
      this.restoreColor(this.terrainCrystalColor, saved.terrainCrystalColor);
      this.restoreColor(this.planeColor, this.migrateColor(saved.planeColor, '#b7bdbb', '#e6e6e6'));
      this.restoreRange(this.scanTerrainSpeed, saved.scanTerrainSpeed);
      if (saved.scanTerrainPattern === 'dot' || saved.scanTerrainPattern === 'plus') {
        this.scanTerrainPattern.value = saved.scanTerrainPattern;
      }
      this.restoreRange(this.scanTerrainPatternSpacing, saved.scanTerrainPatternSpacing);
      this.restoreRange(this.scanTerrainPatternSize, saved.scanTerrainPatternSize);
      this.restoreColor(this.scanTerrainPatternColor, saved.scanTerrainPatternColor);
      this.restoreRange(this.scanTerrainPatternBrightness, saved.scanTerrainPatternBrightness);
      this.restoreRange(this.scanTerrainPatternPersistence, saved.scanTerrainPatternPersistence);
      this.restoreRange(this.scanTerrainFrontWidth, saved.scanTerrainFrontWidth);
      this.restoreColor(this.scanTerrainFrontColor, saved.scanTerrainFrontColor);
      this.restoreRange(this.scanTerrainFrontBrightness, saved.scanTerrainFrontBrightness);
      this.restoreColor(this.scanTerrainTrailColor, saved.scanTerrainTrailColor);
      this.restoreRange(this.scanTerrainTrailLength, saved.scanTerrainTrailLength);
      this.restoreRange(this.scanTerrainTrailFalloff, saved.scanTerrainTrailFalloff);
      this.restoreColor(this.autopilotGuideColor, saved.autopilotGuideColor);
      this.restoreRange(this.windStreakCount, saved.windStreakCount);
      this.restoreRange(this.windStreakLength, saved.windStreakLength);
      this.restoreRange(this.windSpeedThreshold, saved.windSpeedThreshold);
      this.restoreRange(
        this.windOpacity,
        saved.windOpacity === 0.22 ? 0.36 : saved.windOpacity,
      );
      this.restoreColor(this.windColor, saved.windColor);
      if (typeof saved.flockEnabled === 'boolean') this.flockEnabled.checked = saved.flockEnabled;
      this.restoreRange(this.flockMinSize, saved.flockMinSize);
      this.restoreRange(this.flockMaxSize, saved.flockMaxSize);
      this.restoreRange(this.flockInterval, saved.flockInterval === 20 ? 8 : saved.flockInterval);
      this.restoreRange(this.flockSpread, saved.flockSpread === 18 ? 30 : saved.flockSpread);
      this.restoreRange(this.flockSpeed, saved.flockSpeed);
      this.restoreColor(this.flockColor, this.migrateColor(saved.flockColor, '#d7ded7', '#ffffff'));
      this.restoreColor(this.flockTargetColor, saved.flockTargetColor);
      this.restoreRange(
        this.flockTargetThickness,
        saved.flockTargetThickness === 0.085 ? 0.16 : saved.flockTargetThickness,
      );
      if (typeof saved.crtEnabled === 'boolean') this.crtEnabled.checked = saved.crtEnabled;
      this.restoreRange(this.crtCurvature, saved.crtCurvature);
      this.restoreRange(this.crtRgbMask, saved.crtRgbMask);
      this.restoreRange(this.crtScanlines, saved.crtScanlines);
      this.restoreRange(this.crtGrain, saved.crtGrain);
      this.restoreRange(this.crtVignette, saved.crtVignette);
      this.restoreRange(this.crtChromatic, saved.crtChromatic);
      this.restoreRange(this.crtDither, saved.crtDither);
      if (typeof saved.scanGlassEnabled === 'boolean') this.scanGlassEnabled.checked = saved.scanGlassEnabled;
      this.restoreRange(this.boostFadeDuration, saved.boostFadeDuration);
      this.restoreRange(this.boostIdleAmount, saved.boostIdleAmount);
      this.restoreRange(this.scanGlassFlutter, saved.scanGlassFlutter);
      this.restoreRange(this.scanGlassFlutterRate, saved.scanGlassFlutterRate);
      this.restoreRange(this.scanGlassStrength, saved.scanGlassStrength);
      this.restoreRange(this.scanGlassDispersion, saved.scanGlassDispersion);
      if (typeof saved.boostGlassEnabled === 'boolean') this.boostGlassEnabled.checked = saved.boostGlassEnabled;
      if (typeof saved.shipGhostEnabled === 'boolean') this.shipGhostEnabled.checked = saved.shipGhostEnabled;
      this.restoreRange(this.boostExhaustWidth, saved.boostExhaustWidth);
      this.restoreRange(this.boostGlassWidth, saved.boostGlassWidth);
      this.restoreRange(this.boostGlassLength, saved.boostGlassLength);
      this.restoreRange(this.boostRefraction, saved.boostRefraction);
      this.restoreRange(this.boostDispersion, saved.boostDispersion);
      this.restoreRange(this.boostFlowRate, saved.boostFlowRate);
      this.restoreRange(this.wingWarpFlowRate, saved.wingWarpFlowRate);
      this.restoreRange(this.wingWarpFlutterRate, saved.wingWarpFlutterRate);
      this.restoreRange(this.windCountSpeedResponse, saved.windCountSpeedResponse);
      this.restoreRange(this.windLengthSpeedResponse, saved.windLengthSpeedResponse);
      this.restoreRange(this.boostFlutter, saved.boostFlutter);
      this.restoreRange(this.boostFlutterRate, saved.boostFlutterRate);
      this.restoreRange(this.boostShakeStrength, saved.boostExhaustWidth === undefined && saved.boostShakeStrength === 0.35 ? 0.65 : saved.boostShakeStrength);
      this.restoreRange(this.boostShakeFrequency, saved.boostShakeFrequency);
      this.restoreRange(this.wingSweepBack, saved.wingSweepBack);
      this.restoreRange(this.wingTuckIn, saved.wingTuckIn);
      this.restoreRange(this.wingFoldSpeed, saved.wingFoldSpeed);
      this.restoreRange(this.scanGlassPersistence, saved.scanGlassPersistence);
      // Upgrade the previous faint default once; preserve explicit custom opacity.
      this.restoreRange(this.shipGhostOpacity, saved.shipGhostColor === undefined && saved.shipGhostOpacity === 0.13 ? 0.5 : saved.shipGhostOpacity);
      this.restoreColor(this.shipGhostColor, saved.shipGhostColor ?? saved.autopilotGuideColor);
      this.restoreColor(this.boostExhaustColor, saved.boostExhaustColor);
      this.restoreRange(this.boostExhaustLength, saved.boostExhaustWidth === undefined && saved.boostExhaustLength === 36 ? 54 : saved.boostExhaustLength);
      this.restoreRange(this.wingWarpLength, saved.wingWarpLength);
      this.restoreRange(this.wingWarpHeight, saved.wingWarpHeight);
      this.restoreRange(this.wingWarpThickness, saved.wingWarpThickness);
      this.restoreRange(this.wingWarpFlutter, saved.wingWarpFlutter);
      this.restoreRange(this.wingWarpOpacity, saved.wingWarpOpacity);
      this.restoreRange(this.wingWarpDispersion, saved.wingWarpDispersion);
      if (typeof saved.boostExhaustEnabled === 'boolean') this.boostExhaustEnabled.checked = saved.boostExhaustEnabled;
      if (typeof saved.wingWarpEnabled === 'boolean') this.wingWarpEnabled.checked = saved.wingWarpEnabled;
      this.restoreRange(this.boostExhaustStrength, saved.boostExhaustStrength);
      this.restoreRange(this.wingWarpStrength, saved.wingWarpStrength);
      if (typeof saved.motionBlurEnabled === 'boolean') this.motionBlurEnabled.checked = saved.motionBlurEnabled;
      this.restoreRange(this.motionBlurStrength, saved.motionBlurStrength);
      this.restoreRange(this.motionBlurStartSpeed, saved.motionBlurStartSpeed);
      this.restoreRange(this.motionBlurMaxPixels, saved.motionBlurMaxPixels);
      if (typeof saved.glowEnabled === 'boolean') this.glowEnabled.checked = saved.glowEnabled;
      this.restoreRange(this.glowStrength, saved.glowStrength);
      this.restoreRange(this.glowRadius, saved.glowRadius);
      if (saved.fontChoice === 'technical' || saved.fontChoice === 'system' || saved.fontChoice === 'terminal') {
        this.fontChoice.value = saved.fontChoice;
      }
    } catch {
      // Storage may be unavailable or contain stale data; HTML defaults remain valid.
    }
  }

  disposeCombatControls(): void { this.resetEvents.abort(); this.resetButton.remove(); this.combatControls.dispose(); }

  private persist(settings: AppSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        ...settings,
        explosionDebug: false,
        muzzleDebug: false,
        pulsePlasmaDebug: false,
        pulseGlassDebug: false,
        pulseElectricDebug: false,
      }));
    } catch {
      // Visual controls continue to work when browser storage is unavailable.
    }
  }

  private restoreRange(input: HTMLInputElement, value: unknown): void {
    if (typeof value !== 'number' || !Number.isFinite(value)) return;
    const min = Number(input.min);
    const max = Number(input.max);
    input.value = String(Math.min(max, Math.max(min, value)));
  }

  private restoreColor(input: HTMLInputElement, value: unknown): void {
    if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) input.value = value;
  }

  private migrateColor(value: unknown, previousDefault: string, nextDefault: string): unknown {
    return typeof value === 'string' && value.toLowerCase() === previousDefault ? nextDefault : value;
  }

  private updateReadouts(): void {
    this.combatControls.updateReadouts();
    this.flightControls.updateReadouts();
    this.terrainFogDensityValue.textContent = this.terrainFogDensity.valueAsNumber.toFixed(5);
    this.dangerDistanceValue.textContent = `${this.dangerDistance.valueAsNumber.toFixed(0)} M`;
    this.dangerSizeMultiplierValue.textContent = `${this.dangerSizeMultiplier.valueAsNumber.toFixed(1)}×`;
    this.dangerSizeFalloffValue.textContent = this.dangerSizeFalloff.valueAsNumber.toFixed(2);
    this.terrainDotRadiusValue.textContent = `${this.terrainDotRadiusM.valueAsNumber.toFixed(2)} M`;
    this.terrainDotDensityValue.textContent = `${this.terrainDotDensity.valueAsNumber.toFixed(2)} / 100 M²`;
    const crystalPercent = Math.round(this.terrainCrystalAmount.valueAsNumber * 100);
    this.terrainCrystalAmountValue.textContent = `~${100 - crystalPercent} / ${crystalPercent}`;
    this.terrainCrystalOpacityValue.textContent = `${Math.round(this.terrainCrystalOpacity.valueAsNumber * 100)}%`;
    this.terrainCrystalRefractionValue.textContent = this.terrainCrystalRefraction.valueAsNumber.toFixed(2);
    this.terrainCrystalDispersionValue.textContent = this.terrainCrystalDispersion.valueAsNumber.toFixed(2);
    this.scanTerrainSpeedValue.textContent = `${this.scanTerrainSpeed.valueAsNumber.toFixed(0)} M/S`;
    this.scanTerrainPatternSpacingValue.textContent = `${this.scanTerrainPatternSpacing.valueAsNumber.toFixed(0)} M`;
    this.scanTerrainPatternSizeValue.textContent = `${this.scanTerrainPatternSize.valueAsNumber.toFixed(1)} M`;
    this.scanTerrainPatternBrightnessValue.textContent = this.scanTerrainPatternBrightness.valueAsNumber.toFixed(2);
    this.scanTerrainPatternPersistenceValue.textContent = `${this.scanTerrainPatternPersistence.valueAsNumber.toFixed(1)} S`;
    this.scanTerrainFrontWidthValue.textContent = `${this.scanTerrainFrontWidth.valueAsNumber.toFixed(1)} M`;
    this.scanTerrainFrontBrightnessValue.textContent = this.scanTerrainFrontBrightness.valueAsNumber.toFixed(2);
    this.scanTerrainTrailLengthValue.textContent = `${this.scanTerrainTrailLength.valueAsNumber.toFixed(0)} M`;
    this.scanTerrainTrailFalloffValue.textContent = this.scanTerrainTrailFalloff.valueAsNumber.toFixed(2);
    this.windStreakCountValue.textContent = this.windStreakCount.valueAsNumber.toFixed(0);
    this.windStreakLengthValue.textContent = `${this.windStreakLength.valueAsNumber.toFixed(0)} M`;
    this.windSpeedThresholdValue.textContent = `${this.windSpeedThreshold.valueAsNumber.toFixed(0)} M/S`;
    this.windOpacityValue.textContent = this.windOpacity.valueAsNumber.toFixed(2);
    const rangeMin = Number(this.flockMinSize.min);
    const rangeMax = Number(this.flockMinSize.max);
    const denominator = Math.max(1, rangeMax - rangeMin);
    this.flockSizeRange.style.setProperty(
      '--range-min',
      `${((this.flockMinSize.valueAsNumber - rangeMin) / denominator) * 100}%`,
    );
    this.flockSizeRange.style.setProperty(
      '--range-max',
      `${((this.flockMaxSize.valueAsNumber - rangeMin) / denominator) * 100}%`,
    );
    this.flockSizeValue.textContent = `${this.flockMinSize.valueAsNumber.toFixed(0)}–${this.flockMaxSize.valueAsNumber.toFixed(0)}`;
    this.flockIntervalValue.textContent = `${this.flockInterval.valueAsNumber.toFixed(0)} S`;
    this.flockSpreadValue.textContent = `${this.flockSpread.valueAsNumber.toFixed(0)} M`;
    this.flockSpeedValue.textContent = `${this.flockSpeed.valueAsNumber.toFixed(0)} M/S`;
    this.flockTargetThicknessValue.textContent = `${this.flockTargetThickness.valueAsNumber.toFixed(3)} M`;
    this.crtCurvatureValue.textContent = this.crtCurvature.valueAsNumber.toFixed(3);
    this.crtRgbMaskValue.textContent = this.crtRgbMask.valueAsNumber.toFixed(2);
    this.crtScanlinesValue.textContent = this.crtScanlines.valueAsNumber.toFixed(2);
    this.crtGrainValue.textContent = this.crtGrain.valueAsNumber.toFixed(2);
    this.crtVignetteValue.textContent = this.crtVignette.valueAsNumber.toFixed(2);
    this.crtChromaticValue.textContent = this.crtChromatic.valueAsNumber.toFixed(2);
    this.crtDitherValue.textContent = this.crtDither.valueAsNumber.toFixed(2);
    this.wakeDebugButton.textContent = this.wakeDebugEnabled ? 'WAKE GEOMETRY / OPAQUE' : 'WAKE GEOMETRY / GLASS';
    this.wakeDebugButton.setAttribute('aria-pressed', String(this.wakeDebugEnabled));
    this.wakeDebugButton.setAttribute('aria-label', this.wakeDebugEnabled ? 'Hide opaque wake geometry' : 'Show opaque wake geometry');
    this.boostFadeDurationValue.textContent = this.boostFadeDuration.valueAsNumber.toFixed(2) + ' S';
    this.boostIdleAmountValue.textContent = `${Math.round(this.boostIdleAmount.valueAsNumber * 100)}%`;
    this.scanGlassFlutterValue.textContent = (this.scanGlassFlutter.valueAsNumber * 100).toFixed(1) + '%';
    this.scanGlassFlutterRateValue.textContent = this.scanGlassFlutterRate.valueAsNumber.toFixed(2) + '×';
    this.scanGlassStrengthValue.textContent = this.scanGlassStrength.valueAsNumber.toFixed(2) + '';
    this.scanGlassDispersionValue.textContent = this.scanGlassDispersion.valueAsNumber.toFixed(2) + '';
    this.boostExhaustWidthValue.textContent = this.boostExhaustWidth.valueAsNumber.toFixed(2) + '×';
    this.boostGlassWidthValue.textContent = this.boostGlassWidth.valueAsNumber.toFixed(2) + '×';
    this.boostGlassLengthValue.textContent = (this.boostGlassLength.valueAsNumber * 100).toFixed(0) + '%';
    this.boostGlassDebugButton.textContent = this.boostGlassDebug ? 'BOOSTER MESH / OPAQUE' : 'BOOSTER MESH / GLASS';
    this.boostGlassDebugButton.setAttribute('aria-pressed', String(this.boostGlassDebug));
    this.boostGlassDebugButton.setAttribute('aria-label', this.boostGlassDebug ? 'Hide opaque booster geometry' : 'Show opaque booster geometry');
    this.boostRefractionValue.textContent = this.boostRefraction.valueAsNumber.toFixed(2) + '';
    this.boostDispersionValue.textContent = this.boostDispersion.valueAsNumber.toFixed(2) + '';
    this.boostFlowRateValue.textContent = this.boostFlowRate.valueAsNumber.toFixed(2) + '×';
    this.wingWarpFlowRateValue.textContent = this.wingWarpFlowRate.valueAsNumber.toFixed(2) + '×';
    this.wingWarpFlutterRateValue.textContent = this.wingWarpFlutterRate.valueAsNumber.toFixed(2) + '×';
    this.windCountSpeedResponseValue.textContent = this.windCountSpeedResponse.valueAsNumber.toFixed(2);
    this.windLengthSpeedResponseValue.textContent = this.windLengthSpeedResponse.valueAsNumber.toFixed(2);
    this.boostFlutterValue.textContent = this.boostFlutter.valueAsNumber.toFixed(2) + ' M';
    this.boostFlutterRateValue.textContent = this.boostFlutterRate.valueAsNumber.toFixed(2) + '×';
    this.boostShakeStrengthValue.textContent = this.boostShakeStrength.valueAsNumber.toFixed(2) + '';
    this.boostShakeFrequencyValue.textContent = this.boostShakeFrequency.valueAsNumber.toFixed(0) + ' HZ';
    this.wingSweepBackValue.textContent = this.wingSweepBack.valueAsNumber.toFixed(0) + '°';
    this.wingTuckInValue.textContent = this.wingTuckIn.valueAsNumber.toFixed(0) + '°';
    this.wingFoldSpeedValue.textContent = this.wingFoldSpeed.valueAsNumber.toFixed(2) + '×';
    this.scanGlassPersistenceValue.textContent = this.scanGlassPersistence.valueAsNumber.toFixed(2) + ' S';
    this.shipGhostOpacityValue.textContent = (this.shipGhostOpacity.valueAsNumber * 100).toFixed(0) + '%';
    this.boostExhaustLengthValue.textContent = this.boostExhaustLength.valueAsNumber.toFixed(0) + ' m';
    this.wingWarpLengthValue.textContent = this.wingWarpLength.valueAsNumber.toFixed(0) + ' m';
    this.wingWarpHeightValue.textContent = this.wingWarpHeight.valueAsNumber.toFixed(2) + ' m';
    this.wingWarpThicknessValue.textContent = this.wingWarpThickness.valueAsNumber.toFixed(2) + ' m';
    this.wingWarpFlutterValue.textContent = this.wingWarpFlutter.valueAsNumber.toFixed(2) + ' m';
    this.wingWarpOpacityValue.textContent = this.wingWarpOpacity.valueAsNumber.toFixed(3);
    this.wingWarpDispersionValue.textContent = this.wingWarpDispersion.valueAsNumber.toFixed(2);
    this.boostExhaustStrengthValue.textContent = this.boostExhaustStrength.valueAsNumber.toFixed(2);
    this.wingWarpStrengthValue.textContent = this.wingWarpStrength.valueAsNumber.toFixed(2);
    this.motionBlurStrengthValue.textContent = this.motionBlurStrength.valueAsNumber.toFixed(2);
    this.motionBlurStartSpeedValue.textContent = `${this.motionBlurStartSpeed.valueAsNumber.toFixed(0)} M/S`;
    this.motionBlurMaxPixelsValue.textContent = `${this.motionBlurMaxPixels.valueAsNumber.toFixed(0)} PX`;
    this.glowStrengthValue.textContent = this.glowStrength.valueAsNumber.toFixed(2);
    this.glowRadiusValue.textContent = this.glowRadius.valueAsNumber.toFixed(2);
  }

  private updateModeVisibility(): void {
    const dotMode = this.terrainRenderingMode.value === 'dot';
    this.dotRenderSettings.hidden = !dotMode;
    this.meshRenderSettings.hidden = dotMode;
  }
}
