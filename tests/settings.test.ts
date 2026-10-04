import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  DEFAULT_FLIGHT_TUNING,
  driftBoostColorForTier,
  sanitizeFlightTuning,
} from '../src/flight/FlightTuning.ts';
import { DEFAULT_COMBAT, sanitizeCombatSettings } from '../src/combat/settings.ts';
import { migrateAutomaticSlipSettings, migrateVisualSettingsV1 } from '../src/ui/SettingsPanel.ts';

test('legacy pixel point settings migrate to world-space dot controls', () => {
  const migrated = migrateVisualSettingsV1({
    terrainPointSize: 1,
    dangerMaxSize: 16,
    terrainColor: '#c8c8c8',
    glowStrength: 3,
  });

  assert.equal(migrated.terrainDotRadiusM, 0.14);
  assert.equal(migrated.dangerSizeMultiplier, 3);
  assert.equal(migrated.terrainColor, '#c8c8c8');
  assert.equal(migrated.glowStrength, 3);
});

test('legacy world-space migrations clamp out-of-range values', () => {
  assert.equal(migrateVisualSettingsV1({ terrainPointSize: 100 }).terrainDotRadiusM, 0.6);
  assert.equal(migrateVisualSettingsV1({ terrainPointSize: 0 }).terrainDotRadiusM, 0.05);
  assert.equal(migrateVisualSettingsV1({ dangerMaxSize: 100 }).dangerSizeMultiplier, 8);
});

test('flight tuning sanitizes slip curves, ordered tiers, drain, and speed caps', () => {
  const tuned = sanitizeFlightTuning({
    ...DEFAULT_FLIGHT_TUNING,
    slipStartSpeed: 100,
    slipFullSpeed: 20,
    slipCurvePreset: 'broken' as 's-curve',
    slipCurveX1: 0.9,
    slipCurveX2: 0.1,
    slipCurveY1: 0.8,
    slipCurveY2: 0.2,
    slipChargeRate: 40,
    driftBoostDrainOne: 5,
    driftTierTwo: 80,
    driftTierThree: 50,
    driftBoostSpeedOne: 180,
    driftBoostSpeedTwo: 130,
    driftBoostSpeedThree: 140,
    collisionRestitution: 4,
    collisionFriction: -2,
    collisionSeparationSpeed: 80,
    routeHorizontalTurns: 4,
    routeVerticalTurns: 0,
    routeClearance: 8,
    normalTopSpeed: 200,
    normalBoostTopSpeed: 80,
    terrainCrystalClusterScale: 20,
    terrainAheadDistance: 9999,
    driftPulseFrequency: 99,
    driftPulseMinIntensity: 1.8,
    driftPulseMaxIntensity: 0.2,
  });
  assert.ok(tuned.slipStartSpeed < tuned.slipFullSpeed);
  assert.equal(tuned.slipCurvePreset, 's-curve');
  assert.ok(tuned.slipCurveX1 <= tuned.slipCurveX2);
  assert.ok(tuned.slipCurveY1 <= tuned.slipCurveY2);
  assert.ok(tuned.driftBoostDrainOne > tuned.slipChargeRate);
  assert.ok(tuned.driftTierTwo < tuned.driftTierThree);
  assert.ok(tuned.driftBoostSpeedOne <= tuned.driftBoostSpeedTwo);
  assert.ok(tuned.driftBoostSpeedTwo <= tuned.driftBoostSpeedThree);
  assert.equal(tuned.collisionRestitution, 0.8);
  assert.equal(tuned.collisionFriction, 0);
  assert.equal(tuned.collisionSeparationSpeed, 12);
  assert.equal(tuned.routeHorizontalTurns, 1.5);
  assert.equal(tuned.routeVerticalTurns, 0.5);
  assert.equal(tuned.routeClearance, 1.5);
  assert.equal(tuned.normalTopSpeed, 200);
  assert.equal(tuned.normalBoostTopSpeed, 200);
  assert.equal(tuned.terrainCrystalClusterScale, 4);
  assert.equal(tuned.terrainAheadDistance, 2560);
  assert.equal(tuned.driftPulseFrequency, 6);
  assert.equal(tuned.driftPulseMinIntensity, 1.8);
  assert.equal(tuned.driftPulseMaxIntensity, 1.8);
});

test('shipped handling defaults use the tighter player-tuned profile', () => {
  assert.equal(DEFAULT_FLIGHT_TUNING.pitchRate, 1);
  assert.equal(DEFAULT_FLIGHT_TUNING.normalAcceleration, 40);
  assert.equal(DEFAULT_FLIGHT_TUNING.rollRate, 1.5);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraPositionResponse, 0.07);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraHeadingResponse, 0.1);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraRecoveryResponse, 0.1);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraTravelInfluence, 0.9);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraBankResponse, 0.1);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraMaxLag, 12);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftCueOpacity, 0.7);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftMeterArcLength, 20);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftMeterRadialThickness, 0.5);
  assert.equal(DEFAULT_COMBAT.pulseRadius, 80);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionFriction, 0.6);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkAmount, 3);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkColor, '#ffffff');
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkThickness, 0.15);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkLength, 4);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkSpeed, 50);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkLifetime, 0.8);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkSpread, 1);
  assert.equal(DEFAULT_FLIGHT_TUNING.slipChargeRate, 40);
  assert.equal(DEFAULT_FLIGHT_TUNING.slipStartSpeed, 12);
  assert.equal(DEFAULT_FLIGHT_TUNING.slipFullSpeed, 90);
  assert.equal(DEFAULT_FLIGHT_TUNING.slipCurvePreset, 's-curve');
  assert.deepEqual([
    DEFAULT_FLIGHT_TUNING.driftBoostColorOne,
    DEFAULT_FLIGHT_TUNING.driftBoostColorTwo,
    DEFAULT_FLIGHT_TUNING.driftBoostColorThree,
  ], ['#ffdd80', '#ff7a7a', '#bf80ff']);
  assert.equal(DEFAULT_FLIGHT_TUNING.normalGrip, 6);
  assert.equal(DEFAULT_FLIGHT_TUNING.hardTurnGrip, 3.75);
  assert.equal(DEFAULT_FLIGHT_TUNING.normalTopSpeed, 130);
  assert.equal(DEFAULT_FLIGHT_TUNING.normalBoostTopSpeed, 200);
  assert.deepEqual([
    DEFAULT_FLIGHT_TUNING.driftBoostSpeedOne,
    DEFAULT_FLIGHT_TUNING.driftBoostSpeedTwo,
    DEFAULT_FLIGHT_TUNING.driftBoostSpeedThree,
  ], [215, 230, 250]);
  assert.deepEqual([
    DEFAULT_FLIGHT_TUNING.driftBoostAccelerationOne,
    DEFAULT_FLIGHT_TUNING.driftBoostAccelerationTwo,
    DEFAULT_FLIGHT_TUNING.driftBoostAccelerationThree,
  ], [50, 60, 75]);
  assert.deepEqual([
    DEFAULT_FLIGHT_TUNING.driftBoostKickOne,
    DEFAULT_FLIGHT_TUNING.driftBoostKickTwo,
    DEFAULT_FLIGHT_TUNING.driftBoostKickThree,
  ], [10, 20, 30]);
  assert.deepEqual([
    DEFAULT_FLIGHT_TUNING.driftBoostDrainOne,
    DEFAULT_FLIGHT_TUNING.driftBoostDrainTwo,
    DEFAULT_FLIGHT_TUNING.driftBoostDrainThree,
  ], [50, 60, 75]);
  assert.equal(DEFAULT_FLIGHT_TUNING.terrainCrystalClusterScale, 1.8);
  assert.equal(DEFAULT_FLIGHT_TUNING.terrainAheadDistance, 1280);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailRate, 64);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailSize, 10);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailLifetime, 2);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailTurbulence, 6);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowColor, '#ffffff');
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowHeadStyle, 'wire');
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowHeadLength, 90);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowHeadWidth, 20);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowBodyLength, 210);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowLineThickness, 2);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationLookAhead, 400);
  assert.equal(DEFAULT_FLIGHT_TUNING.wrongWayDelay, 1);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftCueSize, 72);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftShakeStrength, 0.5);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftPulseFrequency, 1.5);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftPulseMinIntensity, 0.7);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftPulseMaxIntensity, 1.3);
});

test('one active tier color drives the whole drift-energy presentation', () => {
  assert.equal(driftBoostColorForTier(DEFAULT_FLIGHT_TUNING, 0), '#ffdd80');
  assert.equal(driftBoostColorForTier(DEFAULT_FLIGHT_TUNING, 1), '#ffdd80');
  assert.equal(driftBoostColorForTier(DEFAULT_FLIGHT_TUNING, 2), '#ff7a7a');
  assert.equal(driftBoostColorForTier(DEFAULT_FLIGHT_TUNING, 3), '#bf80ff');
});

test('drift meter uses one shared tier color and configurable active-state pulse', () => {
  const css = readFileSync(new URL('../src/styles.css', import.meta.url), 'utf8');
  assert.match(css, /\.drift-meter-segments path \{[\s\S]*stroke: var\(--drift-energy-color/);
  assert.doesNotMatch(css, /\.drift-meter-segments path:nth-child/);
  assert.match(css, /\.drift-meter\.is-energy-pulsing \.drift-meter-segments/);
  assert.match(css, /--drift-pulse-min-intensity/);
  assert.match(css, /--drift-pulse-max-intensity/);
});

test('v4 drift settings migrate to automatic slip while preserving custom tuning', () => {
  const defaults = migrateAutomaticSlipSettings({
    normalTopSpeed: 130,
    driftMinAngle: 6,
    driftFullAngle: 45,
    driftGrip: 0.35,
    driftChargeRate: 100,
    planeColor: '#ffffff',
  });
  assert.equal(defaults.slipStartSpeed, 12);
  assert.equal(defaults.slipFullSpeed, 90);
  assert.equal(defaults.hardTurnGrip, 1.25);
  assert.equal(defaults.slipChargeRate, 20);
  assert.equal(defaults.planeColor, '#ffffff');

  const custom = migrateAutomaticSlipSettings({
    normalTopSpeed: 100,
    driftMinAngle: 10,
    driftFullAngle: 30,
    driftGrip: 1.5,
    driftChargeRate: 40,
  });
  assert.ok(Math.abs(Number(custom.slipStartSpeed) - 17.3648) < 0.001);
  assert.ok(Math.abs(Number(custom.slipFullSpeed) - 50) < 0.001);
  assert.equal(custom.hardTurnGrip, 1.5);
  assert.equal(custom.slipChargeRate, 8);
});

test('meteor spawn-ahead range stays ordered and within its slider limits', () => {
  const tuned = sanitizeCombatSettings({
    meteorSpawnDistanceMin: 2000,
    meteorSpawnDistanceMax: 180,
  });
  assert.equal(tuned.meteorSpawnDistanceMin, 180);
  assert.equal(tuned.meteorSpawnDistanceMax, 180);
});

test('new collision, spark, navigation, and terrain settings reject invalid values', () => {
  const tuned = sanitizeFlightTuning({
    ...DEFAULT_FLIGHT_TUNING,
    collisionRestitution: Number.NaN,
    collisionSparkAmount: Number.POSITIVE_INFINITY,
    collisionSparkColor: 'gold',
    driftBoostColorOne: 'blue',
    driftBoostColorTwo: '#12xz89',
    driftBoostColorThree: '',
    driftMeterArcLength: 500,
    driftMeterRadialThickness: -5,
    navigationArrowColor: '#xyzxyz',
    navigationArrowHeadStyle: 'invalid' as 'wire',
    navigationArrowHeadLength: 18,
    navigationArrowHeadWidth: 100,
    navigationArrowBodyLength: 10,
    navigationArrowLineThickness: 20,
    wrongWayDelay: -1,
    routeClearance: Number.NaN,
  });
  assert.equal(tuned.collisionRestitution, DEFAULT_FLIGHT_TUNING.collisionRestitution);
  assert.equal(tuned.collisionSparkAmount, DEFAULT_FLIGHT_TUNING.collisionSparkAmount);
  assert.equal(tuned.collisionSparkColor, DEFAULT_FLIGHT_TUNING.collisionSparkColor);
  assert.equal(tuned.driftBoostColorOne, DEFAULT_FLIGHT_TUNING.driftBoostColorOne);
  assert.equal(tuned.driftBoostColorTwo, DEFAULT_FLIGHT_TUNING.driftBoostColorTwo);
  assert.equal(tuned.driftBoostColorThree, DEFAULT_FLIGHT_TUNING.driftBoostColorThree);
  assert.equal(tuned.driftMeterArcLength, 64);
  assert.equal(tuned.driftMeterRadialThickness, 0.1);
  assert.equal(tuned.navigationArrowColor, DEFAULT_FLIGHT_TUNING.navigationArrowColor);
  assert.equal(tuned.navigationArrowHeadStyle, 'wire');
  assert.equal(tuned.navigationArrowHeadLength, 8, 'head remains shorter than the body');
  assert.equal(tuned.navigationArrowHeadWidth, 100);
  assert.equal(tuned.navigationArrowBodyLength, 10);
  assert.equal(tuned.navigationArrowLineThickness, 15);
  assert.equal(tuned.wrongWayDelay, 0.25);
  assert.equal(tuned.routeClearance, DEFAULT_FLIGHT_TUNING.routeClearance);
});

test('expanded spark ranges retain headroom above the tuned defaults', () => {
  const tuned = sanitizeFlightTuning({
    ...DEFAULT_FLIGHT_TUNING,
    collisionSparkAmount: 99,
    collisionSparkThickness: 99,
    collisionSparkLength: 99,
    collisionSparkSpeed: 999,
    collisionSparkLifetime: 99,
    collisionSparkSpread: 99,
  });
  assert.equal(tuned.collisionSparkAmount, 6);
  assert.equal(tuned.collisionSparkThickness, 0.3);
  assert.equal(tuned.collisionSparkLength, 8);
  assert.equal(tuned.collisionSparkSpeed, 100);
  assert.equal(tuned.collisionSparkLifetime, 1.6);
  assert.equal(tuned.collisionSparkSpread, 2);
});

test('3D HUD arrow controls retain exploration headroom above the new defaults', () => {
  const tuned = sanitizeFlightTuning({
    ...DEFAULT_FLIGHT_TUNING,
    navigationArrowScale: 999,
    navigationArrowHeadLength: 999,
    navigationArrowHeadWidth: 999,
    navigationArrowBodyLength: 999,
    navigationArrowLineThickness: 999,
  });
  assert.equal(tuned.navigationArrowScale, 9);
  assert.equal(tuned.navigationArrowHeadLength, 180);
  assert.equal(tuned.navigationArrowHeadWidth, 120);
  assert.equal(tuned.navigationArrowBodyLength, 420);
  assert.equal(tuned.navigationArrowLineThickness, 15);
});

test('every static numeric setting default fits and aligns with its slider range', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const tags = html.match(/<input\b[^>]*>/g) ?? [];
  const attribute = (tag: string, name: string): string | undefined =>
    tag.match(new RegExp(`\\b${name}="([^"]*)"`))?.[1];

  for (const tag of tags) {
    if (!['range', 'number'].includes(attribute(tag, 'type') ?? '')) continue;
    const id = attribute(tag, 'id') ?? tag;
    const value = Number(attribute(tag, 'value'));
    const minimum = Number(attribute(tag, 'min'));
    const maximum = Number(attribute(tag, 'max'));
    const step = Number(attribute(tag, 'step'));
    assert.ok([value, minimum, maximum, step].every(Number.isFinite), `${id} has finite bounds`);
    assert.ok(value >= minimum && value <= maximum, `${id} default lies within its range`);
    const steps = (value - minimum) / step;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-8, `${id} default aligns with its step`);
  }
});
