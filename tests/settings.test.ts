import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_FLIGHT_TUNING, sanitizeFlightTuning } from '../src/flight/FlightTuning.ts';
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
  });
  assert.ok(tuned.driftMinAngle < tuned.driftFullAngle);
  assert.ok(tuned.driftFullAngle <= tuned.driftMaxAngle);
  assert.ok(tuned.driftTierTwo < tuned.driftTierThree);
  assert.ok(tuned.driftBoostSpeedOne <= tuned.driftBoostSpeedTwo);
  assert.ok(tuned.driftBoostSpeedTwo <= tuned.driftBoostSpeedThree);
});
