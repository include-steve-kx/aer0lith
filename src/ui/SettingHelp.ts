const HELP: Record<string, string> = {
  'pitch-rate': 'How quickly the nose pitches up or down.',
  'roll-rate': 'How quickly the aircraft banks left or right.',
  'yaw-rate': 'How quickly direct yaw turns the nose left or right.',
  'bank-yaw-rate': 'How strongly banking also turns the aircraft.',
  'pitch-auto-level': 'How quickly pitch returns toward level when released.',
  'roll-auto-level': 'How quickly bank returns toward level when released.',
  'normal-grip': 'How quickly normal flight aligns travel with the nose. Higher values feel tighter.',
  'hard-turn-grip': 'How quickly travel realigns with the nose during a hard turn. Lower values preserve more slide.',
  'turn-slip-start-rate': 'Nose turn rate where automatic grip reduction begins.',
  'turn-slip-full-rate': 'Nose turn rate where hard-turn grip is fully applied.',
  'grip-engage-response': 'How quickly grip releases as a hard turn begins.',
  'grip-recovery-response': 'How quickly full grip returns after the turn settles.',
  'normal-acceleration': 'How quickly normal flight reaches its target speed.',
  'normal-top-speed': 'Maximum cruise speed when normal Boost is not held.',
  'normal-boost-top-speed': 'Maximum speed while holding normal Boost without stored drift energy.',
  'collision-restitution': 'Fraction of incoming normal speed returned as a rebound. Lower values lose more energy.',
  'collision-friction': 'How strongly surface contact removes velocity along the surface.',
  'collision-separation-speed': 'Small outward speed used once to keep a new contact from sticking inside a surface.',
  'impact-flash-duration': 'How long the struck aircraft area flashes red.',
  'collision-sparks-enabled': 'Shows or hides collision sparks without changing physics.',
  'collision-spark-amount': 'Multiplies the number of sparks produced by energy lost during contact.',
  'collision-spark-color': 'Sets the collision spark color.',
  'collision-spark-thickness': 'Width of each world-space spark ribbon.',
  'collision-spark-length': 'Maximum visible streak length behind each spark.',
  'collision-spark-speed': 'Initial speed of sparks leaving the contact surface.',
  'collision-spark-lifetime': 'How long collision sparks remain visible.',
  'collision-spark-spread': 'How widely sparks scatter opposite the scrape direction and away from the surface.',
  'slip-start-speed': 'Sideways travel speed where automatic slip begins producing energy and visuals.',
  'slip-full-speed': 'Sideways travel speed that reaches the maximum selected curve response.',
  'slip-curve-preset': 'Chooses how normalized slip becomes energy and visual strength.',
  'slip-charge-rate': 'Maximum drift energy earned per second at full slip response.',
  'slip-collision-suppress-time': 'How long steering-created slip is excluded from charging after surface contact. Explosion slip remains eligible.',
  'drift-grace-time': 'How long banked energy waits before it starts decaying.',
  'drift-passive-decay': 'How quickly unused drift energy drains.',
  'drift-tier-two': 'Energy required to enter drift-boost tier II.',
  'drift-tier-three': 'Energy required to enter drift-boost tier III.',
  'drift-tier-hysteresis': 'Extra threshold margin that prevents rapid tier flicker.',
  'drift-boost-color-one': 'Color used by the exhaust, light, Boost button, and meter for drift-boost tier I.',
  'drift-boost-color-two': 'Color used by the exhaust, light, Boost button, and meter for drift-boost tier II.',
  'drift-boost-color-three': 'Color used by the exhaust, light, Boost button, and meter for drift-boost tier III.',
  'drift-boost-nose-bias': 'How much the ignition kick points toward the nose instead of the current travel direction.',
  'boost-repress-window': 'Brief time normal boost remains active while you release and re-press to upgrade into drift boost.',
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
  'drift-meter-arc-length': 'Sets the length of the annular sector along its centerline. The circle radius remains fixed at 25% of screen width.',
  'drift-meter-radial-thickness': 'Sets the distance between the inner and outer curves of the annular sector.',
  'drift-trail-response': 'How strongly existing wake effects respond to drift angle.',
  'slip-visual-attack': 'How quickly camera and ash visuals rise when automatic slip begins.',
  'slip-visual-release': 'How smoothly camera and ash visuals fade after automatic slip ends.',
  'drift-tier-pulse': 'Pulses stored energy while it is charging or powering drift boost.',
  'drift-pulse-frequency': 'How many times per second the active tier color brightens and dims.',
  'drift-pulse-min-intensity': 'Darkest brightness reached by the energy pulse.',
  'drift-pulse-max-intensity': 'Brightest brightness reached by the energy pulse.',
  'drift-shake-strength': 'Additional camera shake produced by drift boost.',
  'drift-trail-enabled': 'Shows a thick ash-like tail trail automatically while the aircraft is slipping.',
  'drift-trail-rate': 'Maximum number of tail-ash particles emitted each second at full slip response.',
  'drift-trail-size': 'Average world-space diameter of each soft tail-ash cloud.',
  'drift-trail-lifetime': 'How long emitted drift ash remains visible.',
  'drift-trail-opacity': 'Maximum visibility of the drift ash.',
  'drift-trail-turbulence': 'How quickly ash spreads and wanders away from its path.',
  'drift-trail-color': 'Color of the drift ash clouds.',
  'navigation-arrow-enabled': 'Shows or hides the CSS 3D HUD arrow that points toward the upcoming route.',
  'navigation-arrow-scale': 'Changes the fixed screen-space size of the route arrow.',
  'navigation-arrow-head-style': 'Chooses an open four-line head or a solid four-sided pyramid head.',
  'navigation-arrow-head-length': 'Sets how far the arrowhead extends backward from its tip in depth.',
  'navigation-arrow-head-width': 'Sets the width of the quadrangular arrowhead base.',
  'navigation-arrow-body-length': 'Sets the depth length of the arrow shaft from its tail to its tip.',
  'navigation-arrow-line-thickness': 'Sets the thickness of the shaft, wire head, and solid-head outline.',
  'navigation-look-ahead': 'How far along the generated route the HUD arrow samples its target.',
  'navigation-arrow-color': 'Sets the route arrow color.',
  'wrong-way-enabled': 'Shows a warning after sustained backward route progress.',
  'wrong-way-delay': 'How long backward progress must continue before the warning appears.',
  'route-horizontal-turns': 'Scales horizontal route bends after the world restarts.',
  'route-vertical-turns': 'Scales vertical route bends after the world restarts.',
  'route-clearance': 'Scales tunnel width, height, and guaranteed air clearance after restart.',
  'terrain-ahead-distance': 'Maximum forward edge of generated terrain, measured from the start of the current 128-metre chunk. Larger values use more memory and generation time after restart.',
  'flock-spawn-distance-min': 'Nearest distance ahead of the aircraft where a new flock can appear.',
  'flock-spawn-distance-max': 'Farthest distance ahead of the aircraft where a new flock can appear.',
  'combat-meteorSpawnDistanceMin': 'Nearest distance ahead of the aircraft used when placing a new meteor encounter.',
  'combat-meteorSpawnDistanceMax': 'Farthest distance ahead of the aircraft used when placing a new meteor encounter.',
  'combat-meteorCountMin': 'Smallest number of meteors the game can attempt to place in one encounter.',
  'combat-meteorCountMax': 'Largest number of meteors the game can attempt to place in one encounter.',
  'touch-dead-zone': 'Joystick movement ignored around its center.',
  'touch-response-curve': 'Changes how quickly touch steering grows away from center.',
  'touch-primary-scale': 'Scales the large Boost button on desktop and touch screens.',
  'scan-reset-interval': 'Time required for the terrain scan button to refill after each use.',
  'scan-terrain-distance': 'Maximum radius of the spherical scan. The wave travels this far in every direction from the aircraft.',
  'terrain-crystal-cluster-scale': 'Controls crystal patch size. Higher values create larger, less scattered regions after Apply and Restart or New World.',
};

const SECTION_HELP: Record<string, string> = {
  'settings-handling-title': 'Steering authority, automatic leveling, traction, and acceleration.',
  'settings-drift-energy-title': 'How sideways velocity automatically becomes visual response and stored drift energy.',
  'settings-impact-title': 'Energy loss, friction, separation, sparks, and aircraft hit feedback for terrain and meteor contact.',
  'settings-collision-sparks-title': 'Appearance and density of short world-space sparks at the exact contact point.',
  'settings-drift-boost-title': 'Speed, acceleration, ignition kick, drain, and visual color for each boost tier.',
  'settings-camera-follow-title': 'How tightly chase cameras follow the aircraft and its travel direction.',
  'settings-drift-display-title': 'On-screen feedback for automatic slip, curved energy meter, tiers, and camera motion.',
  'settings-drift-trail-title': 'Appearance and persistence of automatic world-space tail ash.',
  'settings-navigation-title': 'Screen-space route direction and delayed wrong-way feedback.',
  'settings-world-route-title': 'Terrain streaming, route shape, clearance, and crystal generation controls that take effect after applying or creating a new world.',
  'settings-touch-title': 'Touch joystick response and Boost button sizing.',
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
  for (const heading of root.querySelectorAll<HTMLElement>('.settings-section > .settings-section-toggle, .settings-section h3')) {
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
  for (const control of root.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) {
    if (control.title) continue;
    const ariaLabel = control.getAttribute('aria-label');
    if (ariaLabel) control.title = HELP[control.id] ?? `Adjusts ${ariaLabel.toLowerCase()}.`;
  }
  const applyWorld = root.querySelector<HTMLButtonElement>('#apply-world-settings');
  if (applyWorld) applyWorld.title = 'Save world-generation changes and restart this same seeded world.';
}
