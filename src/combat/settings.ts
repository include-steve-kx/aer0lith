export const COMBAT_LIMITS = {
  meteors: 48,
  missiles: 64,
  trails: 96,
  samples: 256,
  fragments: 192,
  explosions: 16,
  shakes: 16,
} as const;
export const DEFAULT_METEORS = {
  meteorEnabled: true,
  meteorMinDiameter: 6,
  meteorMaxDiameter: 18,
  meteorCount: 6,
  meteorInterval: 14,
  meteorSpeed: 1,
  meteorSpin: 3,
  meteorSpread: 45,
  meteorColor: '#8b8f92',
  meteorIrregularity: 0.25,
  meteorDetection: 8,
  meteorTargetColor: '#ffffff',
  meteorTargetThickness: 0.12,
  meteorMarkers: true,
};
export const DEFAULT_MISSILES = {
  missileEnabled: true,
  missileSpeed: 220,
  missileTurn: 150,
  missileCapacity: 3,
  missileReload: 3,
  missileInterval: 0.18,
  missileColor: '#e6e6e6',
  missileTrailColor: '#e6e6e6',
  missileTrailLength: 60,
  missileTrailLife: 1.2,
  missileTrailWidth: 0.05,
  missileTrailOpacity: 0.55,
  explosionSize: 1.5,
  explosionLife: 0.9,
  explosionRefraction: 0.8,
  explosionDispersion: 0.16,
  explosionBrightness: 0.6,
  fragmentEnabled: true,
  fragmentCount: 8,
  fragmentLife: 2.5,
  fragmentSpeed: 12,
  fragmentSpin: 45,
  explosionShakeStrength: 0.35,
  explosionShakeRadius: 120,
  explosionShakeLife: 0.6,
  explosionShakeFrequency: 18,
  missileHud: true,
  explosionDebug: false,
};
export type MeteorSettings = typeof DEFAULT_METEORS;
export type MissileSettings = typeof DEFAULT_MISSILES;
export type CombatSettings = MeteorSettings & MissileSettings;
export const DEFAULT_COMBAT: CombatSettings = {
  ...DEFAULT_METEORS,
  ...DEFAULT_MISSILES,
};
export type ControlSpec = readonly [
  keyof CombatSettings,
  string,
  number?,
  number?,
  number?,
  string?,
];
export const METEOR_CONTROLS: readonly ControlSpec[] = [
  ['meteorEnabled', 'METEORS ENABLED'],
  ['meteorMinDiameter', 'MIN DIAMETER', 2, 36, 1, ' M'],
  ['meteorMaxDiameter', 'MAX DIAMETER', 2, 36, 1, ' M'],
  ['meteorCount', 'METEORS / ENCOUNTER', 1, 12, 1],
  ['meteorInterval', 'ENCOUNTER INTERVAL', 4, 40, 1, ' S'],
  ['meteorSpeed', 'DRIFT SPEED', 0, 5, 0.1, ' M/S'],
  ['meteorSpin', 'ROTATION SPEED', 0, 20, 0.5, ' °/S'],
  ['meteorSpread', 'ENCOUNTER SPREAD', 15, 100, 1, ' M'],
  ['meteorColor', 'METEOR COLOR'],
  ['meteorIrregularity', 'SHAPE IRREGULARITY', 0, 0.5, 0.125],
  ['meteorDetection', 'DETECTION DURATION', 3, 15, 0.5, ' S'],
  ['meteorTargetColor', 'TARGET COLOR'],
  ['meteorTargetThickness', 'BOX THICKNESS', 0.04, 0.3, 0.01, ' M'],
  ['meteorMarkers', 'TARGET MARKERS'],
];
export const MISSILE_CONTROLS: readonly ControlSpec[] = [
  ['missileEnabled', 'AUTOMATIC MISSILES'],
  ['missileSpeed', 'MISSILE SPEED', 160, 400, 5, ' M/S'],
  ['missileTurn', 'TRACKING TURN RATE', 45, 300, 5, ' °/S'],
  ['missileCapacity', 'STORED / WING', 1, 8, 1],
  ['missileReload', 'RELOAD TIME', 0.5, 10, 0.1, ' S'],
  ['missileInterval', 'LAUNCH INTERVAL', 0.1, 0.8, 0.02, ' S'],
  ['missileColor', 'MISSILE COLOR'],
  ['missileTrailColor', 'TRAIL COLOR'],
  ['missileTrailLength', 'TRAIL LENGTH', 10, 180, 5, ' M'],
  ['missileTrailLife', 'TRAIL PERSISTENCE', 0.2, 6, 0.1, ' S'],
  ['missileTrailWidth', 'TRAIL WIDTH', 0.02, 0.15, 0.01, ' M'],
  ['missileTrailOpacity', 'TRAIL OPACITY', 0, 1, 0.05],
  ['explosionSize', 'EXPLOSION SIZE', 0.5, 3, 0.1, '×'],
  ['explosionLife', 'EXPLOSION DURATION', 0.3, 2, 0.1, ' S'],
  ['explosionRefraction', 'EXPLOSION REFRACTION', 0, 3, 0.05],
  ['explosionDispersion', 'EXPLOSION DISPERSION', 0, 0.6, 0.01],
  ['explosionBrightness', 'PULSE BRIGHTNESS', 0, 1.5, 0.05],
  ['fragmentEnabled', 'FRAGMENTATION'],
  ['fragmentCount', 'FRAGMENTS / METEOR', 4, 12, 4],
  ['fragmentLife', 'FRAGMENT LIFETIME', 0.5, 5, 0.1, ' S'],
  ['fragmentSpeed', 'FRAGMENT SCATTER', 2, 30, 1, ' M/S'],
  ['fragmentSpin', 'FRAGMENT SPIN', 0, 180, 5, ' °/S'],
  ['explosionShakeStrength', 'EXPLOSION SHAKE', 0, 1, 0.05],
  ['explosionShakeRadius', 'SHAKE RADIUS', 20, 250, 5, ' M'],
  ['explosionShakeLife', 'SHAKE DURATION', 0.15, 1.5, 0.05, ' S'],
  ['explosionShakeFrequency', 'SHAKE FREQUENCY', 4, 30, 1, ' HZ'],
  ['missileHud', 'AMMUNITION HUD'],
  ['explosionDebug', 'OPAQUE EXPLOSION MESH'],
];
export function sanitizeCombatSettings(
  input: Partial<Record<keyof CombatSettings, unknown>>,
  restore = false,
): CombatSettings {
  const result = { ...DEFAULT_COMBAT };
  for (const [key, , min, max, step] of [
    ...METEOR_CONTROLS,
    ...MISSILE_CONTROLS,
  ]) {
    const fallback = DEFAULT_COMBAT[key],
      value = input[key];
    let next: number | boolean | string = fallback;
    if (
      typeof fallback === 'number' &&
      typeof value === 'number' &&
      Number.isFinite(value)
    ) {
      next = Math.min(
        max!,
        Math.max(min!, min! + Math.round((value - min!) / step!) * step!),
      );
    } else if (typeof fallback === 'boolean' && typeof value === 'boolean')
      next = value;
    else if (
      typeof fallback === 'string' &&
      typeof value === 'string' &&
      /^#[0-9a-f]{6}$/i.test(value)
    )
      next = value;
    Object.assign(result, { [key]: next });
  }
  result.meteorMinDiameter = Math.min(
    result.meteorMinDiameter,
    result.meteorMaxDiameter,
  );
  if (restore) result.explosionDebug = false;
  return result;
}
