import {
  DEFAULT_FLIGHT_TUNING,
  sanitizeFlightTuning,
  type FlightTuningSettings,
} from '../flight/FlightTuning.ts';

type FlightSettingKey = keyof FlightTuningSettings;
type FlightSettingControl = HTMLInputElement | HTMLSelectElement;

export class FlightSettingsControls {
  private readonly inputs = new Map<FlightSettingKey, FlightSettingControl>();

  constructor(root: HTMLElement) {
    for (const candidate of root.querySelectorAll<FlightSettingControl>('[data-flight-setting]')) {
      const key = candidate.dataset.flightSetting as FlightSettingKey | undefined;
      if (key && key in DEFAULT_FLIGHT_TUNING) this.inputs.set(key, candidate);
    }
  }

  get values(): FlightTuningSettings {
    const values = { ...DEFAULT_FLIGHT_TUNING } as FlightTuningSettings;
    for (const [key, input] of this.inputs) {
      if (input instanceof HTMLSelectElement) {
        (values as unknown as Record<string, number | boolean | string>)[key] = input.value;
      } else if (input.type === 'checkbox') {
        (values as unknown as Record<string, number | boolean | string>)[key] = input.checked;
      } else if (input.type === 'color') {
        (values as unknown as Record<string, number | boolean | string>)[key] = input.value;
      } else {
        const min = Number(input.min);
        const max = Number(input.max);
        const raw = input.valueAsNumber;
        (values as unknown as Record<string, number | boolean | string>)[key] = Number.isFinite(raw)
          ? Math.min(max, Math.max(min, raw))
          : DEFAULT_FLIGHT_TUNING[key] as number;
      }
    }
    return sanitizeFlightTuning(values);
  }

  restore(saved: Record<string, unknown>): void {
    for (const [key, input] of this.inputs) {
      const savedValue = saved[key];
      const value = key === 'navigationArrowColor' && savedValue === '#ffee66'
        ? DEFAULT_FLIGHT_TUNING.navigationArrowColor
        : savedValue;
      if (input instanceof HTMLSelectElement) {
        if (typeof value === 'string' && Array.from(input.options).some((option) => option.value === value)) {
          input.value = value;
        }
        continue;
      }
      if (input.type === 'checkbox') {
        if (typeof value === 'boolean') input.checked = value;
        continue;
      }
      if (input.type === 'color') {
        if (typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)) input.value = value;
        continue;
      }
      if (typeof value !== 'number' || !Number.isFinite(value)) continue;
      input.value = String(Math.min(Number(input.max), Math.max(Number(input.min), value)));
    }
    this.writeSanitizedValues();
  }

  updateReadouts(): void {
    this.writeSanitizedValues();
    for (const input of this.inputs.values()) {
      if (input instanceof HTMLSelectElement || input.type === 'checkbox' || input.type === 'color') continue;
      const output = document.getElementById(`${input.id}-value`);
      if (!(output instanceof HTMLOutputElement)) continue;
      const decimals = Number(input.dataset.decimals ?? '2');
      const unit = input.dataset.unit ?? '';
      const displayValue = unit === '%' && Number(input.max) <= 1
        ? input.valueAsNumber * 100
        : input.valueAsNumber;
      output.textContent = `${displayValue.toFixed(decimals)}${unit}`;
    }
  }

  private writeSanitizedValues(): void {
    const values = sanitizeFlightTuning(this.rawValues());
    for (const [key, input] of this.inputs) {
      if (input instanceof HTMLSelectElement || input.type !== 'checkbox') input.value = String(values[key]);
    }
  }

  private rawValues(): FlightTuningSettings {
    const values = { ...DEFAULT_FLIGHT_TUNING } as FlightTuningSettings;
    for (const [key, input] of this.inputs) {
      (values as unknown as Record<string, number | boolean | string>)[key] = input instanceof HTMLSelectElement
        ? input.value
        : input.type === 'checkbox'
        ? input.checked
        : input.type === 'color' ? input.value : input.valueAsNumber;
    }
    return values;
  }
}
