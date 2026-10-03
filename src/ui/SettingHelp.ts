const HELP: Record<string, string> = {
  'pitch-rate': 'How quickly the nose pitches up or down.',
  'roll-rate': 'How quickly the aircraft banks left or right.',
  'yaw-rate': 'How quickly direct yaw turns the nose left or right.',
  'bank-yaw-rate': 'How strongly banking also turns the aircraft.',
  'pitch-auto-level': 'How quickly pitch returns toward level when released.',
  'roll-auto-level': 'How quickly bank returns toward level when released.',
  'normal-grip': 'How quickly normal flight aligns travel with the nose. Higher values feel tighter.',
  'drift-grip': 'How quickly travel aligns with the nose while drifting. Lower values preserve more slide.',
  'normal-acceleration': 'How quickly normal flight reaches its target speed.',
  'impact-push-scale': 'Multiplies the surface-normal push calculated from impact speed and angle.',
  'impact-min-push': 'Smallest outward push applied for any confirmed contact.',
  'impact-max-push': 'Largest outward push allowed from one impact.',
  'impact-push-duration': 'How long the impact push decays like an explosion force.',
  'impact-flash-duration': 'How long the struck aircraft area flashes red.',
  'impact-cooldown': 'Short delay before the same continuing contact can trigger another impact.',
  'drift-min-angle': 'Smallest nose-to-travel angle that can earn drift energy.',
  'drift-full-angle': 'Slip angle that earns drift energy at full efficiency.',
  'drift-max-angle': 'Largest slip angle counted when calculating drift energy.',
  'drift-charge-rate': 'Energy earned per second at the full charge angle.',
  'drift-speed-influence': 'How strongly aircraft speed changes drift-energy gain.',
  'drift-grace-time': 'How long banked energy waits before it starts decaying.',
  'drift-passive-decay': 'How quickly unused drift energy drains.',
  'drift-tier-two': 'Energy required to enter drift-boost tier II.',
  'drift-tier-three': 'Energy required to enter drift-boost tier III.',
  'drift-tier-hysteresis': 'Extra threshold margin that prevents rapid tier flicker.',
  'drift-boost-nose-bias': 'How much the ignition kick points toward the nose instead of the current travel direction.',
  'camera-position-response': 'How quickly the chase camera moves with the aircraft. Lower values feel tighter.',
  'camera-heading-response': 'How quickly the chase camera turns during a drift. Lower values feel tighter.',
  'camera-recovery-response': 'How quickly the camera returns behind the nose after drifting.',
  'camera-travel-influence': 'How strongly drift travel direction pulls the chase-camera angle sideways.',
  'camera-bank-response': 'How quickly the chase camera follows aircraft bank.',
  'camera-max-lag': 'Maximum sideways angle allowed between the nose and chase camera.',
  'drift-cue-enabled': 'Shows or hides the travel-direction marker near the center crosshair.',
  'drift-cue-size': 'Maximum distance of the travel-direction marker from the crosshair.',
  'drift-cue-opacity': 'Visibility of the travel-direction marker.',
  'drift-meter-enabled': 'Shows or hides the curved drift-energy meter.',
  'drift-meter-scale': 'Changes the size of the drift-energy meter.',
  'drift-trail-response': 'How strongly existing wake effects respond to drift angle.',
  'drift-tier-pulse': 'Adds a restrained pulse when tier III energy is available.',
  'drift-shake-strength': 'Additional camera shake produced by drift boost.',
  'drift-trail-enabled': 'Shows a thick ash-like world trail only while deliberate drift is held.',
  'drift-trail-rate': 'Number of ash particles emitted per second while drifting.',
  'drift-trail-size': 'Average width of each soft ash cloud.',
  'drift-trail-lifetime': 'How long emitted drift ash remains visible.',
  'drift-trail-opacity': 'Maximum visibility of the drift ash.',
  'drift-trail-turbulence': 'How quickly ash spreads and wanders away from its path.',
  'drift-trail-color': 'Color of the drift ash clouds.',
  'touch-dead-zone': 'Joystick movement ignored around its center.',
  'touch-response-curve': 'Changes how quickly touch steering grows away from center.',
  'touch-primary-scale': 'Scales the large Drift and Boost buttons.',
};

const SECTION_HELP: Record<string, string> = {
  'settings-handling-title': 'Steering authority, automatic leveling, traction, and acceleration.',
  'settings-drift-energy-title': 'How deliberate sliding earns, stores, and loses drift energy.',
  'settings-impact-title': 'Non-punishing surface and meteor contact push, cooldown, and hit feedback.',
  'settings-drift-boost-title': 'Speed, acceleration, ignition kick, and drain for each boost tier.',
  'settings-camera-follow-title': 'How tightly chase cameras follow the aircraft and its travel direction.',
  'settings-drift-display-title': 'On-screen feedback for drift angle, energy, tiers, and camera motion.',
  'settings-drift-trail-title': 'Appearance and persistence of the world-space ash emitted only while drifting.',
  'settings-touch-title': 'Touch joystick response and primary-action button sizing.',
};

function fallbackHelp(label: string, control: HTMLInputElement | HTMLSelectElement): string {
  const name = label.toLowerCase();
  if (control instanceof HTMLSelectElement) return `Chooses the ${name} option.`;
  if (control.type === 'checkbox') return `Turns ${name} on or off.`;
  if (control.type === 'color') return name.endsWith('color') ? `Sets the ${name}.` : `Sets the ${name} color.`;
  return `Adjusts ${name}.`;
}

/** Adds concise native hover help without creating live regions or per-frame work. */
export function installSettingHelp(root: HTMLElement): void {
  for (const heading of root.querySelectorAll<HTMLElement>('.settings-section > h2')) {
    heading.title = SECTION_HELP[heading.id] ?? `Settings for ${heading.textContent?.trim().toLowerCase()}.`;
  }
  for (const label of root.querySelectorAll<HTMLLabelElement>('label[for]')) {
    const control = label.control;
    if (!(control instanceof HTMLInputElement || control instanceof HTMLSelectElement)) continue;
    const text = label.querySelector('span')?.textContent?.trim() ?? control.getAttribute('aria-label') ?? control.id;
    const description = HELP[control.id] ?? fallbackHelp(text, control);
    label.title = description;
    control.title = description;
  }
  for (const control of root.querySelectorAll<HTMLInputElement>('.settings-tier-grid input')) {
    control.title = control.getAttribute('aria-label') ?? 'Adjusts this drift-boost tier value.';
  }
}
