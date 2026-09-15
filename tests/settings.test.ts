import assert from 'node:assert/strict';
import test from 'node:test';
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
