import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FLIGHT_TUNING, sanitizeFlightTuning } from '../src/flight/FlightTuning.ts';
import { DEFAULT_COMBAT } from '../src/combat/settings.ts';
import { migrateVisualSettingsV1 } from '../src/ui/SettingsPanel.ts';

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

test('flight tuning sanitizes ordered tiers, angles, and speed caps', () => {
  const tuned = sanitizeFlightTuning({
    ...DEFAULT_FLIGHT_TUNING,
    driftMinAngle: 60,
    driftFullAngle: 20,
    driftMaxAngle: 30,
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
  });
  assert.ok(tuned.driftMinAngle < tuned.driftFullAngle);
  assert.ok(tuned.driftFullAngle <= tuned.driftMaxAngle);
  assert.ok(tuned.driftTierTwo < tuned.driftTierThree);
  assert.ok(tuned.driftBoostSpeedOne <= tuned.driftBoostSpeedTwo);
  assert.ok(tuned.driftBoostSpeedTwo <= tuned.driftBoostSpeedThree);
  assert.equal(tuned.collisionRestitution, 0.8);
  assert.equal(tuned.collisionFriction, 0);
  assert.equal(tuned.collisionSeparationSpeed, 12);
  assert.equal(tuned.routeHorizontalTurns, 1.5);
  assert.equal(tuned.routeVerticalTurns, 0.5);
  assert.equal(tuned.routeClearance, 1.5);
});

test('shipped handling defaults use the tighter player-tuned profile', () => {
  assert.equal(DEFAULT_FLIGHT_TUNING.rollRate, 1.5);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraPositionResponse, 0.07);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraHeadingResponse, 0.1);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraRecoveryResponse, 0.1);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraTravelInfluence, 0.8);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraBankResponse, 0.1);
  assert.equal(DEFAULT_FLIGHT_TUNING.cameraMaxLag, 24);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftCueOpacity, 0.7);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftMeterArcLength, 32);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftMeterRadialThickness, 1.5);
  assert.equal(DEFAULT_COMBAT.pulseRadius, 80);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionFriction, 0.6);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkAmount, 3);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkColor, '#ffffff');
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkThickness, 0.15);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkLength, 4);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkSpeed, 50);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkLifetime, 0.8);
  assert.equal(DEFAULT_FLIGHT_TUNING.collisionSparkSpread, 1);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftChargeRate, 100);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailRate, 64);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailSize, 10);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailLifetime, 2);
  assert.equal(DEFAULT_FLIGHT_TUNING.driftTrailTurbulence, 6);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowColor, '#ffffff');
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowHeadStyle, 'wire');
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowHeadLength, 7);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowHeadWidth, 12);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowBodyLength, 22);
  assert.equal(DEFAULT_FLIGHT_TUNING.navigationArrowLineThickness, 1);
});

test('new collision, spark, navigation, and terrain settings reject invalid values', () => {
  const tuned = sanitizeFlightTuning({
    ...DEFAULT_FLIGHT_TUNING,
    collisionRestitution: Number.NaN,
    collisionSparkAmount: Number.POSITIVE_INFINITY,
    collisionSparkColor: 'gold',
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
  assert.equal(tuned.driftMeterArcLength, 64);
  assert.equal(tuned.driftMeterRadialThickness, 0.5);
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

test('3D HUD arrow controls expose five-times-expanded upper bounds', () => {
  const tuned = sanitizeFlightTuning({
    ...DEFAULT_FLIGHT_TUNING,
    navigationArrowScale: 999,
    navigationArrowHeadLength: 999,
    navigationArrowHeadWidth: 999,
    navigationArrowBodyLength: 999,
    navigationArrowLineThickness: 999,
  });
  assert.equal(tuned.navigationArrowScale, 9);
  assert.equal(tuned.navigationArrowHeadLength, 90);
  assert.equal(tuned.navigationArrowHeadWidth, 120);
  assert.equal(tuned.navigationArrowBodyLength, 210);
  assert.equal(tuned.navigationArrowLineThickness, 15);
});
