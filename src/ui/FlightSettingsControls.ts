import {
  DEFAULT_FLIGHT_TUNING,
  sanitizeFlightTuning,
  type FlightTuningSettings,
} from '../flight/FlightTuning.ts';
import { presetControlPoints } from '../flight/SlipResponse.ts';

type FlightSettingKey = keyof FlightTuningSettings;
type FlightSettingControl = HTMLInputElement | HTMLSelectElement;

export class FlightSettingsControls {
  private readonly inputs = new Map<FlightSettingKey, FlightSettingControl>();
  private readonly curvePreset: HTMLSelectElement | null;
  private readonly curvePath: SVGPathElement | null;
  private readonly curveHandles: SVGPathElement | null;
  private readonly curveHandleOne: SVGCircleElement | null;
  private readonly curveHandleTwo: SVGCircleElement | null;
  private activeCurveHandle: 1 | 2 | undefined;

  constructor(root: HTMLElement) {
    for (const candidate of root.querySelectorAll<FlightSettingControl>('[data-flight-setting]')) {
      const key = candidate.dataset.flightSetting as FlightSettingKey | undefined;
      if (key && key in DEFAULT_FLIGHT_TUNING) this.inputs.set(key, candidate);
    }
    this.curvePreset = root.querySelector<HTMLSelectElement>('#slip-curve-preset');
    this.curvePath = root.querySelector<SVGPathElement>('#slip-curve-path');
    this.curveHandles = root.querySelector<SVGPathElement>('#slip-curve-handles');
    this.curveHandleOne = root.querySelector<SVGCircleElement>('#slip-curve-handle-one');
    this.curveHandleTwo = root.querySelector<SVGCircleElement>('#slip-curve-handle-two');
    this.curvePreset?.addEventListener('change', this.onCurvePresetChange);
    this.curveHandleOne?.addEventListener('pointerdown', event => this.beginCurveDrag(event, 1));
    this.curveHandleTwo?.addEventListener('pointerdown', event => this.beginCurveDrag(event, 2));
    window.addEventListener('pointermove', this.onCurvePointerMove);
    window.addEventListener('pointerup', this.endCurveDrag);
    window.addEventListener('pointercancel', this.endCurveDrag);
    this.updateCurveEditor();
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
    this.updateCurveEditor();
  }

  updateReadouts(): void {
    this.writeSanitizedValues();
    this.updateCurveEditor();
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

  private onCurvePresetChange = (): void => {
    if (!this.curvePreset || this.curvePreset.value === 'custom') {
      this.updateCurveEditor();
      return;
    }
    const [x1, y1, x2, y2] = presetControlPoints(this.curvePreset.value as FlightTuningSettings['slipCurvePreset']);
    this.setCurveControl('slipCurveX1', x1);
    this.setCurveControl('slipCurveY1', y1);
    this.setCurveControl('slipCurveX2', x2);
    this.setCurveControl('slipCurveY2', y2);
    this.updateCurveEditor();
  };

  private beginCurveDrag(event: PointerEvent, handle: 1 | 2): void {
    this.activeCurveHandle = handle;
    (event.currentTarget as SVGCircleElement).setPointerCapture(event.pointerId);
    event.preventDefault();
  }

  private onCurvePointerMove = (event: PointerEvent): void => {
    if (!this.activeCurveHandle || !this.curvePath) return;
    const svg = this.curvePath.ownerSVGElement;
    if (!svg) return;
    const bounds = svg.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, ((event.clientX - bounds.left) / bounds.width * 240 - 20) / 210));
    const y = Math.max(0, Math.min(1, 1 - (((event.clientY - bounds.top) / bounds.height * 140 - 10) / 110)));
    const values = this.rawValues();
    if (this.activeCurveHandle === 1) {
      this.setCurveControl('slipCurveX1', Math.min(x, values.slipCurveX2));
      this.setCurveControl('slipCurveY1', Math.min(y, values.slipCurveY2));
    } else {
      this.setCurveControl('slipCurveX2', Math.max(x, values.slipCurveX1));
      this.setCurveControl('slipCurveY2', Math.max(y, values.slipCurveY1));
    }
    if (this.curvePreset) this.curvePreset.value = 'custom';
    this.updateCurveEditor();
    this.curvePreset?.dispatchEvent(new Event('input', { bubbles: true }));
  };

  private endCurveDrag = (): void => { this.activeCurveHandle = undefined; };

  private setCurveControl(key: FlightSettingKey, value: number): void {
    const input = this.inputs.get(key);
    if (input instanceof HTMLInputElement) input.value = value.toFixed(3);
  }

  private updateCurveEditor(): void {
    if (!this.curvePath || !this.curveHandles || !this.curveHandleOne || !this.curveHandleTwo) return;
    const values = this.rawValues();
    const controls = values.slipCurvePreset === 'custom'
      ? [values.slipCurveX1, values.slipCurveY1, values.slipCurveX2, values.slipCurveY2]
      : presetControlPoints(values.slipCurvePreset);
    const [x1, y1, x2, y2] = controls;
    const point = (x: number, y: number): [number, number] => [20 + x * 210, 120 - y * 110];
    const [p1x, p1y] = point(x1, y1);
    const [p2x, p2y] = point(x2, y2);
    this.curvePath.setAttribute('d', `M20 120 C${p1x} ${p1y} ${p2x} ${p2y} 230 10`);
    this.curveHandles.setAttribute('d', `M20 120L${p1x} ${p1y}M230 10L${p2x} ${p2y}`);
    this.curveHandleOne.setAttribute('cx', String(p1x));
    this.curveHandleOne.setAttribute('cy', String(p1y));
    this.curveHandleTwo.setAttribute('cx', String(p2x));
    this.curveHandleTwo.setAttribute('cy', String(p2y));
  }
}
