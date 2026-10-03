import assert from 'node:assert/strict';
import test from 'node:test';
import { Points, Quaternion, Vector3 } from 'three';
import { DEFAULT_FLIGHT_TUNING } from '../src/flight/FlightTuning.ts';
import { DriftTrailView } from '../src/render/DriftTrailView.ts';

test('drift ash uses a fixed pool and emits only while drift intensity is active', () => {
  const trail = new DriftTrailView();
  trail.configure(DEFAULT_FLIGHT_TUNING);
  const position = new Vector3();
  const orientation = new Quaternion();
  const velocity = new Vector3(20, 0, 80);
  trail.update(0.5, position, orientation, velocity, 0);
  assert.equal(trail.emittedCount, 0);
  trail.update(0.5, position, orientation, velocity, 1);
  assert.equal(trail.emittedCount, 32);
  assert.ok(trail.activeCount > 0);
  const points = trail.group.children[0] as Points;
  const positions = points.geometry.getAttribute('position');
  for (let index = 0; index < 32; index += 1) {
    assert.equal(positions.getX(index), 0);
    assert.ok(Math.abs(positions.getY(index) - 0.05) < 1e-6);
    assert.equal(positions.getZ(index), -3.75);
  }
  const emitted = trail.emittedCount;
  trail.update(0.5, position, orientation, velocity, 0);
  assert.equal(trail.emittedCount, emitted, 'coasting never emits drift ash');
  for (let step = 0; step < 10; step += 1) trail.update(0.5, position, orientation, velocity, 0);
  assert.equal(trail.activeCount, 0);
  assert.equal(trail.group.visible, false);
  trail.dispose();
});

test('disabled or paused drift trails neither emit nor advance', () => {
  const trail = new DriftTrailView();
  trail.configure({ ...DEFAULT_FLIGHT_TUNING, driftTrailEnabled: false });
  const position = new Vector3();
  const orientation = new Quaternion();
  const velocity = new Vector3(0, 0, 90);
  trail.update(1, position, orientation, velocity, 1);
  assert.equal(trail.emittedCount, 0);
  trail.configure(DEFAULT_FLIGHT_TUNING);
  trail.update(1, position, orientation, velocity, 1, true);
  assert.equal(trail.emittedCount, 0);
  trail.dispose();
});
