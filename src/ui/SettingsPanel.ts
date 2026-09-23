import { bindButtonAction } from './bindButtonAction.ts';

function element<T extends HTMLElement>(id: string): T {
  const result = document.getElementById(id);
  if (!result) throw new Error(`Missing settings element #${id}`);
  return result as T;
}

const STORAGE_KEY = 'aer0lith.visual-settings.v2';
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

export interface VisualSettings {
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
  planeColor: string;
  autopilotGuideColor: string;
  windStreakCount: number;
  windStreakLength: number;
  windSpeedThreshold: number;
  windOpacity: number;
  windColor: string;
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

export class SettingsPanel {
  readonly button = element<HTMLButtonElement>('settings-button');
  private readonly panel = element<HTMLElement>('settings-panel');
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
  onChange: ((settings: VisualSettings) => void) | undefined;

  constructor() {
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
    for (const input of this.panel.querySelectorAll('input, select')) {
      input.addEventListener('input', () => this.emit());
      input.addEventListener('change', () => this.emit());
    }
    this.updateReadouts();
    this.updateModeVisibility();
  }

  get values(): VisualSettings {
    return {
      renderResolutionMode: this.renderResolutionMode.value as VisualSettings['renderResolutionMode'],
      terrainRenderingMode: this.terrainRenderingMode.value as VisualSettings['terrainRenderingMode'],
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
      planeColor: this.planeColor.value,
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
      fontChoice: this.fontChoice.value as VisualSettings['fontChoice'],
    };
  }

  apply(): void {
    this.emit();
  }

  private toggle(): void {
    const opening = this.panel.hidden;
    this.panel.hidden = !opening;
    this.button.setAttribute('aria-expanded', String(opening));
    this.button.setAttribute('aria-label', opening ? 'Close visual settings' : 'Open visual settings');
    this.button.textContent = opening ? 'SETTINGS / CLOSE' : 'SETTINGS';
  }

  private emit(): void {
    this.updateReadouts();
    this.updateModeVisibility();
    const settings = this.values;
    this.persist(settings);
    this.onChange?.(settings);
  }

  private restore(): void {
    try {
      const currentRaw = localStorage.getItem(STORAGE_KEY);
      const legacyV2Raw = currentRaw ? null : localStorage.getItem(LEGACY_STORAGE_KEY_V2);
      const legacyV1Raw = currentRaw || legacyV2Raw
        ? null
        : localStorage.getItem(LEGACY_STORAGE_KEY_V1);
      const parsed = JSON.parse(currentRaw ?? legacyV2Raw ?? legacyV1Raw ?? 'null') as unknown;
      if (!isRecord(parsed)) return;
      const saved = legacyV1Raw ? migrateVisualSettingsV1(parsed) : parsed;
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
      this.restoreColor(this.planeColor, this.migrateColor(saved.planeColor, '#b7bdbb', '#e6e6e6'));
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

  private persist(settings: VisualSettings): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
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
    this.terrainFogDensityValue.textContent = this.terrainFogDensity.valueAsNumber.toFixed(5);
    this.dangerDistanceValue.textContent = `${this.dangerDistance.valueAsNumber.toFixed(0)} M`;
    this.dangerSizeMultiplierValue.textContent = `${this.dangerSizeMultiplier.valueAsNumber.toFixed(1)}×`;
    this.dangerSizeFalloffValue.textContent = this.dangerSizeFalloff.valueAsNumber.toFixed(2);
    this.terrainDotRadiusValue.textContent = `${this.terrainDotRadiusM.valueAsNumber.toFixed(2)} M`;
    this.terrainDotDensityValue.textContent = `${this.terrainDotDensity.valueAsNumber.toFixed(2)} / 100 M²`;
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
