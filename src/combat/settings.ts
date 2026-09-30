export const COMBAT_LIMITS = {
  bullets: 256, bulletTrails: 512, sparks: 64, contacts: 320,
  meteors: 48,
  missiles: 64,
  trails: 96,
  samples: 256,
  fragments: 192,
  explosions: 16,
  shakes: 16,
} as const;
export const DEFAULT_METEORS = {
  meteorBulletHits: 4,
  meteorEnabled: true,
  meteorMinDiameter: 6,
  meteorMaxDiameter: 36,
  meteorCount: 12,
  meteorInterval: 8,
  meteorSpeed: 5,
  meteorSpin: 20,
  meteorSpread: 30,
  meteorColor: '#8b8f92',
  meteorIrregularity: 0.5,
  meteorDetection: 8,
  meteorTargetColor: '#ffffff',
  meteorTargetThickness: 0.05,
  meteorMarkers: true,
};
export const DEFAULT_MISSILES = {
  missileEnabled: true,
  missileSpeed: 180,
  missileTurn: 150,
  missileCapacity: 3,
  missileReload: 3,
  missileInterval: 0.18,
  missileColor: '#e6e6e6',
  missileTrailColor: '#e6e6e6',
  missileTrailLength: 180,
  missileTrailLife: 6,
  missileTrailWidth: 0.05,
  missileTrailOpacity: 1,
  missileHud: true,
};
export const DEFAULT_IMPACTS = {
  explosionPush: 30, explosionPushLife: 2,
  explosionSize: 1.5,
  explosionLife: 1.2,
  explosionRefraction: 0.8,
  explosionDispersion: 0.16,
  explosionBrightness: 0.6,
  fragmentEnabled: true,
  fragmentCount: 8,
  fragmentLife: 2.5,
  fragmentSpeed: 12,
  fragmentSpin: 45,
  explosionShakeStrength: 0.8,
  explosionShakeRadius: 400,
  explosionShakeLife: 1,
  explosionShakeFrequency: 20,
  explosionDebug: false,
};
export const DEFAULT_BULLETS = {
  bulletEnabled: true, bulletRate: 36, bulletVariation: 0.3, bulletSpread: 0.35,
  bulletSpeed: 580, bulletDiameter: 0.14, bulletLength: 4, bulletRange: 900,
  bulletConvergence: 400, bulletCone: 20, bulletColor: '#fff2c2', bulletTrailColor: '#ffe1a0',
  bulletTrailLength: 65, bulletTrailLife: 1, bulletTrailWidth: 0.03, bulletTrailOpacity: 0.55,
  muzzleColor: '#ffd68a', muzzleLength: 0.65, muzzleWidth: 0.3, muzzleLife: 0.1,
  muzzleRefraction: 0.75, muzzleDispersion: 0.12, muzzleDebug: false,
};
export type BulletSettings = typeof DEFAULT_BULLETS;
export type ImpactSettings = typeof DEFAULT_IMPACTS;
export type MeteorSettings = typeof DEFAULT_METEORS & ImpactSettings;
export type MissileSettings = typeof DEFAULT_MISSILES;
export type CombatSettings = MeteorSettings & MissileSettings & BulletSettings;
export const DEFAULT_COMBAT: CombatSettings = {
  ...DEFAULT_BULLETS,
  ...DEFAULT_METEORS,
  ...DEFAULT_IMPACTS,
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
  ['meteorBulletHits', 'BULLET HITS AT 12 M', 1, 20, 1],
  ['meteorEnabled', 'METEORS ENABLED'],
  ['meteorMinDiameter', 'MIN DIAMETER', 2, 72, 1, ' M'],
  ['meteorMaxDiameter', 'MAX DIAMETER', 2, 72, 1, ' M'],
  ['meteorCount', 'METEORS / ENCOUNTER', 1, 24, 1],
  ['meteorInterval', 'ENCOUNTER INTERVAL', 4, 40, 1, ' S'],
  ['meteorSpeed', 'DRIFT SPEED', 0, 10, 0.1, ' M/S'],
  ['meteorSpin', 'ROTATION SPEED', 0, 40, 0.5, ' °/S'],
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
  ['missileTrailLength', 'TRAIL LENGTH', 10, 360, 5, ' M'],
  ['missileTrailLife', 'TRAIL PERSISTENCE', 0.2, 12, 0.1, ' S'],
  ['missileTrailWidth', 'TRAIL WIDTH', 0.02, 0.15, 0.01, ' M'],
  ['missileTrailOpacity', 'TRAIL OPACITY', 0, 1, 0.05],
  ['missileHud', 'AMMUNITION HUD'],
];
export const DESTRUCTION_CONTROLS: readonly ControlSpec[] = [
  ['explosionPush', 'EXPLOSION PUSH', 0, 180, 1, ' M/S'],
  ['explosionPushLife', 'PUSH SETTLING TIME', 0.2, 4, 0.1, ' S'],
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
  ['explosionShakeRadius', 'SHAKE + PUSH RADIUS', 20, 1000, 5, ' M'],
  ['explosionShakeLife', 'SHAKE DURATION', 0.15, 1.5, 0.05, ' S'],
  ['explosionShakeFrequency', 'SHAKE FREQUENCY', 4, 30, 1, ' HZ'],
  ['explosionDebug', 'OPAQUE EXPLOSION MESH'],
];
export const BULLET_CONTROLS: readonly ControlSpec[] = [
  ['bulletEnabled', 'BULLETS ENABLED'],
  ['bulletRate', 'TOTAL FIRING FREQUENCY', 2, 48, 1, ' /S'],
  ['bulletVariation', 'INTERVAL VARIATION', 0, 0.6, 0.01],
  ['bulletSpread', 'AIM SPREAD HALF-ANGLE', 0, 2, 0.05, ' °'],
  ['bulletSpeed', 'BULLET SPEED', 250, 1200, 10, ' M/S'],
  ['bulletDiameter', 'BULLET DIAMETER', 0.04, 0.4, 0.01, ' M'],
  ['bulletLength', 'BOLT LENGTH', 0.3, 8, 0.1, ' M'],
  ['bulletRange', 'MAXIMUM TRAVEL', 200, 1600, 50, ' M'],
  ['bulletConvergence', 'CONVERGENCE DISTANCE', 100, 1000, 10, ' M'],
  ['bulletCone', 'AIM CONE HALF-ANGLE', 0, 35, 1, ' °'],
  ['bulletColor', 'BULLET COLOR'], ['bulletTrailColor', 'TRAIL COLOR'],
  ['bulletTrailLength', 'TRAIL LENGTH', 2, 100, 1, ' M'],
  ['bulletTrailLife', 'TRAIL PERSISTENCE', 0.05, 2, 0.01, ' S'],
  ['bulletTrailWidth', 'TRAIL WIDTH', 0.01, 0.15, 0.01, ' M'],
  ['bulletTrailOpacity', 'TRAIL OPACITY', 0, 1, 0.05],
  ['muzzleColor', 'MUZZLE COLOR'],
  ['muzzleLength', 'MUZZLE LENGTH', 0.1, 2, 0.05, ' M'],
  ['muzzleWidth', 'MUZZLE WIDTH', 0.04, 0.5, 0.01, ' M'],
  ['muzzleLife', 'MUZZLE DURATION', 0.02, 0.15, 0.01, ' S'],
  ['muzzleRefraction', 'MUZZLE REFRACTION', 0, 1.5, 0.05],
  ['muzzleDispersion', 'MUZZLE DISPERSION', 0, 0.3, 0.01],
  ['muzzleDebug', 'OPAQUE MUZZLE GLASS'],
];
export function sanitizeCombatSettings(
  input: Partial<Record<keyof CombatSettings, unknown>>,
  restore = false,
): CombatSettings {
  const result = { ...DEFAULT_COMBAT };
  for (const [key, , min, max, step] of [
    ...METEOR_CONTROLS,
    ...MISSILE_CONTROLS, ...DESTRUCTION_CONTROLS, ...BULLET_CONTROLS,
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
  if (restore) { result.explosionDebug = false; result.muzzleDebug = false; }
  return result;
}
