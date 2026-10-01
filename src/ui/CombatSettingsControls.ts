import {
  DEFAULT_COMBAT, BULLET_CONTROLS, DESTRUCTION_CONTROLS,
  METEOR_CONTROLS,
  MISSILE_CONTROLS,
  PULSE_CONTROLS,
  sanitizeCombatSettings,
  type CombatSettings,
  type ControlSpec,
} from '../combat/settings.ts';
export class CombatSettingsControls {
  private readonly inputs = new Map<keyof CombatSettings, HTMLInputElement>();
  private readonly outputs = new Map<keyof CombatSettings, HTMLOutputElement>();
  private readonly specs = [...METEOR_CONTROLS, ...MISSILE_CONTROLS, ...DESTRUCTION_CONTROLS, ...PULSE_CONTROLS, ...BULLET_CONTROLS];
  private readonly events = new AbortController();
  private readonly sections: HTMLElement[] = [];
  private readonly sizeLabel = document.createElement('output');
  private readonly sizeRange: HTMLDivElement;
  constructor() {
    const panel = document.querySelector('#settings-panel')!;
    for (const [name, specs] of [
      ['METEORS', METEOR_CONTROLS],
      ['METEORS / DESTRUCTION', DESTRUCTION_CONTROLS],
      ['PULSE CANNON', PULSE_CONTROLS],
      ['MISSILES', MISSILE_CONTROLS],
      ['BULLETS', BULLET_CONTROLS],
    ] as const) {
      const section = document.createElement('section');
      section.className = 'settings-section';
      section.setAttribute('aria-label', name);
      const heading = document.createElement('h2');
      heading.textContent = name;
      section.append(heading);
      if (name === 'METEORS') {
        const hint = document.createElement('p');
        hint.className = 'settings-help';
        hint.textContent = 'Danger tint starts at 3× the trigger distance from the rock surface and reaches full intensity at detonation.';
        section.append(hint);
      }
      for (const spec of specs) this.addControl(section, spec);
      panel.append(section);
      this.sections.push(section);
    }
    const min = this.inputs.get('meteorMinDiameter')!,
      max = this.inputs.get('meteorMaxDiameter')!;
    this.sizeRange = document.createElement('div');
    this.sizeRange.className = 'dual-range';
    this.sizeRange.setAttribute('role', 'group');
    this.sizeRange.setAttribute('aria-label', 'Meteor diameter range');
    const caption = min.previousElementSibling!;
    caption.querySelector('span')!.textContent = 'DIAMETER RANGE';
    caption.querySelector('output')!.replaceWith(this.sizeLabel);
    max.previousElementSibling!.remove();
    this.outputs.delete('meteorMinDiameter'); this.outputs.delete('meteorMaxDiameter');
    min.setAttribute('aria-label', 'Minimum meteor diameter'); max.setAttribute('aria-label', 'Maximum meteor diameter');
    min.before(this.sizeRange);
    this.sizeRange.append(min, max);
    min.addEventListener('input', () => {
      if (min.valueAsNumber > max.valueAsNumber) min.value = max.value;
    }, { signal: this.events.signal });
    max.addEventListener('input', () => {
      if (max.valueAsNumber < min.valueAsNumber) max.value = min.value;
    }, { signal: this.events.signal });
    this.restore(DEFAULT_COMBAT);
  }
  private addControl(
    section: HTMLElement,
    [key, label, min, max, step, unit]: ControlSpec,
  ): void {
    const input = document.createElement('input'),
      caption = document.createElement('label'),
      span = document.createElement('span');
    input.id = `combat-${key}`;
    caption.htmlFor = input.id;
    span.textContent = label;
    caption.append(span);
    const value = DEFAULT_COMBAT[key];
    input.type =
      typeof value === 'number'
        ? 'range'
        : typeof value === 'boolean'
          ? 'checkbox'
          : 'color';
    if (typeof value === 'number') {
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      const output = document.createElement('output');
      output.dataset.unit = unit ?? '';
      caption.append(output);
      this.outputs.set(key, output);
      section.append(caption, input);
    } else {
      caption.className =
        typeof value === 'boolean' ? 'toggle-setting' : 'color-setting';
      caption.append(input);
      section.append(caption);
    }
    this.inputs.set(key, input);
  }
  get values(): CombatSettings {
    const values: Partial<Record<keyof CombatSettings, unknown>> = {};
    for (const [key, input] of this.inputs)
      values[key] =
        input.type === 'range'
          ? input.valueAsNumber
          : input.type === 'checkbox'
            ? input.checked
            : input.value;
    return sanitizeCombatSettings(values);
  }
  restore(values: Partial<Record<keyof CombatSettings, unknown>>): void {
    const safe = sanitizeCombatSettings(values, true);
    for (const [key, input] of this.inputs) {
      if (typeof safe[key] === 'boolean') input.checked = safe[key] as boolean;
      else input.value = String(safe[key]);
    }
    this.updateReadouts();
  }
  dispose(): void { this.events.abort(); this.sections.forEach(section => section.remove()); this.inputs.clear(); this.outputs.clear(); }
  updateReadouts(): void {
    this.sizeLabel.textContent = `${this.inputs.get('meteorMinDiameter')!.value}–${this.inputs.get('meteorMaxDiameter')!.value} M`;
    for (const [key, , min, , step] of this.specs) {
      const output = this.outputs.get(key);
      if (output) {
        const value = this.inputs.get(key)!.valueAsNumber;
        output.textContent =
          value.toFixed(step! < 1 ? (step! < 0.1 ? 2 : 1) : 0) +
          (output.dataset.unit ?? '');
      }
      void min;
    }
    if (this.sizeRange) {
      const min = this.inputs.get('meteorMinDiameter')!, max = this.inputs.get('meteorMaxDiameter')!;
      const percent = (input: HTMLInputElement) => ((input.valueAsNumber - Number(input.min)) / (Number(input.max) - Number(input.min))) * 100;
      this.sizeRange.style.setProperty(
        '--range-min',
        `${percent(min)}%`,
      );
      this.sizeRange.style.setProperty(
        '--range-max',
        `${percent(max)}%`,
      );
    }
  }
}
