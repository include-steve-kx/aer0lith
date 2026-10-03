export const COMBAT_LIMITS = {
  bullets: 256, bulletTrails: 512, sparks: 64, contacts: 320,
  meteors: 48,
  missiles: 64,
  trails: 96,
  samples: 256,
  fragments: 576,
  explosions: 48,
  shakes: 48,
} as const;
export const DEFAULT_METEORS = {
  meteorBulletHits: 4,
  meteorEnabled: true,
  meteorProximityEnabled: true,
  meteorMinTriggerDistance: 50,
  meteorMaxTriggerDistance: 65,
  meteorMinFuseDelay: 0,
  meteorMaxFuseDelay: 0.5,
  meteorMinDiameter: 6,
  meteorMaxDiameter: 36,
  meteorCount: 12,
  meteorInterval: 10,
  meteorSpeed: 6.5,
  meteorSpin: 40,
  meteorSpread: 30,
  meteorColor: '#555b5e',
  meteorProximityColor: '#ffffff',
  meteorProximityFalloff: 1,
  meteorAshColor: '#303638',
  meteorIrregularity: 0.5,
  meteorDetection: 8,
  meteorTargetColor: '#ffffff',
  meteorTargetThickness: 0.05,
  meteorMarkers: true,
  meteorPushVectorScale: 1,
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
  explosionPush: 20,
  explosionVelocityAxisFactor: 0.5,
  explosionPushLife: 2,
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
export const DEFAULT_PULSE = {
  pulseEnabled: true,
  pulseRange: 800,
  pulseRadius: 80,
  pulsePlasmaRadius: 8,
  pulseCooldown: 1,
  pulseDuration: 0.6,
  pulseColor: '#9ffcff',
  pulseBrightness: 1.35,
  pulseFadePower: 1.4,
  pulseFlutter: 0.35,
  pulseFlutterRate: 1,
  pulseShakeStrength: 1.3,
  pulseShakeFrequency: 20,
  pulseShakeDuration: 3.6,
  pulseGlassWidth: 2,
  pulseGlassLength: 1,
  pulseElectricStrength: 2,
  pulseElectricSpread: 1.3,
  pulseElectricTravelTime: 0.7,
  pulseElectricTrail: 0.19,
  pulseBeamLightColor: '#9ffcff',
  pulseBeamLightIntensity: 175,
  pulseBeamLightRange: 100,
  pulseElectricLightColor: '#6fe9ff',
  pulseElectricLightIntensity: 875,
  pulseElectricLightRange: 210,
  pulseRefraction: 1.65,
  pulseDispersion: 0.8,
  pulseTerrainTintStrength: 0.55,
  pulseTerrainTintWidth: 18,
  pulsePlasmaDebug: false,
  pulseGlassDebug: false,
  pulseElectricDebug: false,
};
export type BulletSettings = typeof DEFAULT_BULLETS;
export type ImpactSettings = typeof DEFAULT_IMPACTS;
export type MeteorSettings = typeof DEFAULT_METEORS & ImpactSettings;
export type MissileSettings = typeof DEFAULT_MISSILES;
export type PulseSettings = typeof DEFAULT_PULSE;
export type CombatSettings = MeteorSettings & MissileSettings & BulletSettings & PulseSettings;
export const DEFAULT_COMBAT: CombatSettings = {
  ...DEFAULT_BULLETS,
  ...DEFAULT_METEORS,
  ...DEFAULT_IMPACTS,
  ...DEFAULT_MISSILES,
  ...DEFAULT_PULSE,
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
  ['meteorProximityEnabled', 'PROXIMITY EXPLOSIONS'],
  ['meteorMinTriggerDistance', 'MIN EXPLOSION SURFACE DISTANCE', 5, 150, 1, ' M'],
  ['meteorMaxTriggerDistance', 'MAX EXPLOSION SURFACE DISTANCE', 5, 150, 1, ' M'],
  ['meteorMinFuseDelay', 'MIN EXPLOSION WAIT', 0, 8, 0.1, ' S'],
  ['meteorMaxFuseDelay', 'MAX EXPLOSION WAIT', 0, 8, 0.1, ' S'],
  ['meteorMinDiameter', 'MIN DIAMETER', 2, 72, 1, ' M'],
  ['meteorMaxDiameter', 'MAX DIAMETER', 2, 72, 1, ' M'],
  ['meteorCount', 'METEORS / ENCOUNTER', 1, 24, 1],
  ['meteorInterval', 'ENCOUNTER INTERVAL', 4, 40, 1, ' S'],
  ['meteorSpeed', 'DRIFT SPEED', 0, 10, 0.1, ' M/S'],
  ['meteorSpin', 'ROTATION SPEED', 0, 40, 0.5, ' °/S'],
  ['meteorSpread', 'ENCOUNTER SPREAD', 15, 100, 1, ' M'],
  ['meteorColor', 'DORMANT METEOR COLOR'],
  ['meteorProximityColor', 'TRIGGER HOTSPOT + FRESH FRAGMENT COLOR'],
  ['meteorProximityFalloff', 'TRIGGER HOTSPOT FALLOFF', 1, 64, 1],
  ['meteorAshColor', 'ASH FRAGMENT COLOR'],
  ['meteorIrregularity', 'SHAPE IRREGULARITY', 0, 0.5, 0.125],
  ['meteorDetection', 'DETECTION DURATION', 3, 15, 0.5, ' S'],
  ['meteorTargetColor', 'TARGET COLOR'],
  ['meteorTargetThickness', 'BOX THICKNESS', 0.04, 0.3, 0.01, ' M'],
  ['meteorMarkers', 'TARGET MARKERS'],
  ['meteorPushVectorScale', 'PUSH VECTOR LENGTH', 0, 10, 0.1, '×'],
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
  ['explosionVelocityAxisFactor', 'VELOCITY-AXIS PUSH', 0, 1, 0.05, '×'],
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
export const PULSE_CONTROLS: readonly ControlSpec[] = [
  ['pulseEnabled', 'PULSE CANNON ENABLED'],
  ['pulseRange', 'RANGE', 160, 800, 20, ' M'],
  ['pulseRadius', 'IMPACT BEAM RADIUS', 4, 160, 2, ' M'],
  ['pulsePlasmaRadius', 'INNER PLASMA RADIUS', 4, 80, 2, ' M'],
  ['pulseCooldown', 'COOLDOWN', 0.25, 15, 0.25, ' S'],
  ['pulseDuration', 'VISUAL DURATION', 0.2, 1.5, 0.05, ' S'],
  ['pulseColor', 'PLASMA COLOR'],
  ['pulseBrightness', 'PLASMA BRIGHTNESS', 0, 3, 0.05],
  ['pulseFadePower', 'FADE CURVE', 0.25, 4, 0.05],
  ['pulseFlutter', 'PLASMA FLUTTER', 0, 1.5, 0.05],
  ['pulseFlutterRate', 'FLUTTER RATE', 0, 4, 0.05, '×'],
  ['pulseShakeStrength', 'CAMERA SHAKE', 0, 2, 0.05],
  ['pulseShakeFrequency', 'SHAKE FREQUENCY', 4, 30, 1, ' HZ'],
  ['pulseShakeDuration', 'SHAKE DURATION', 0.3, 8, 0.1, ' S'],
  ['pulseGlassWidth', 'OUTER GLASS WIDTH', 0.5, 2, 0.01, '×'],
  ['pulseGlassLength', 'OUTER GLASS LENGTH', 0.5, 1.2, 0.01, '×'],
  ['pulseElectricStrength', 'ELECTRIC STRENGTH', 0, 4, 0.05],
  ['pulseElectricSpread', 'ELECTRIC SPREAD', 0, 2, 0.05, '×'],
  ['pulseElectricTravelTime', 'ELECTRIC TRAVEL TIME', 0.1, 1.5, 0.05, ' S'],
  ['pulseElectricTrail', 'ELECTRIC TRAIL LENGTH', 0.05, 1, 0.01, '×'],
  ['pulseBeamLightColor', 'BEAM LIGHT COLOR'],
  ['pulseBeamLightIntensity', 'BEAM LIGHT INTENSITY', 0, 2000, 25],
  ['pulseBeamLightRange', 'BEAM LIGHT RANGE', 20, 800, 10, ' M'],
  ['pulseElectricLightColor', 'ELECTRIC LIGHT COLOR'],
  ['pulseElectricLightIntensity', 'ELECTRIC LIGHT INTENSITY', 0, 2000, 25],
  ['pulseElectricLightRange', 'ELECTRIC LIGHT RANGE', 10, 400, 10, ' M'],
  ['pulseRefraction', 'REFRACTION', 0, 3, 0.05],
  ['pulseDispersion', 'DISPERSION', 0, 2, 0.01],
  ['pulseTerrainTintStrength', 'TERRAIN REMNANT', 0, 1, 0.05],
  ['pulseTerrainTintWidth', 'REMNANT FALLOFF', 2, 60, 2, ' M'],
  ['pulsePlasmaDebug', 'SOLID PLASMA'],
  ['pulseGlassDebug', 'SOLID GLASS'],
  ['pulseElectricDebug', 'SOLID ELECTRICITY'],
];
export function migrateCombatSettings(
  input: Partial<Record<keyof CombatSettings, unknown>>,
): Partial<Record<keyof CombatSettings, unknown>> {
  const migrated = { ...input };
  // Adopt the new darker lifecycle default for saves that still contain the
  // exact former default, while preserving intentional custom meteor colors.
  if (input.meteorProximityColor === undefined && input.meteorColor === '#8b8f92')
    migrated.meteorColor = DEFAULT_COMBAT.meteorColor;
  const legacyArmedColor = (input as Record<string, unknown>).meteorArmedColor;
  if (
    input.meteorProximityColor === undefined &&
    typeof legacyArmedColor === 'string' &&
    /^#[0-9a-f]{6}$/i.test(legacyArmedColor)
  )
    migrated.meteorProximityColor = legacyArmedColor.toLowerCase() === '#e8f6f7'
      ? DEFAULT_COMBAT.meteorProximityColor
      : legacyArmedColor;
  return migrated;
}
export function sanitizeCombatSettings(
  input: Partial<Record<keyof CombatSettings, unknown>>,
  restore = false,
): CombatSettings {
  const result = { ...DEFAULT_COMBAT };
  for (const [key, , min, max, step] of [
    ...METEOR_CONTROLS,
    ...MISSILE_CONTROLS, ...DESTRUCTION_CONTROLS, ...PULSE_CONTROLS,
    ...BULLET_CONTROLS,
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
  result.meteorMinTriggerDistance = Math.min(
    result.meteorMinTriggerDistance,
    result.meteorMaxTriggerDistance,
  );
  result.meteorMinFuseDelay = Math.min(
    result.meteorMinFuseDelay,
    result.meteorMaxFuseDelay,
  );
  if (restore) {
    result.explosionDebug = false;
    result.muzzleDebug = false;
    result.pulsePlasmaDebug = false;
    result.pulseGlassDebug = false;
    result.pulseElectricDebug = false;
  }
  return result;
}
