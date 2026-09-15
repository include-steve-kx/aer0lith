import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { PALETTE } from '../src/core/config.ts';
import { CollisionDebugView } from '../src/render/CollisionDebugView.ts';
import { TrailView } from '../src/render/TrailView.ts';
import { WindView } from '../src/render/WindView.ts';

test('wing trails discard old samples and stay within their distance budget', () => {
  const trail = new TrailView();
  const orientation = new Quaternion();
  const origin = new Vector3();
  for (let index = 0; index < 1200; index += 1) {
    trail.add(new Vector3(0, 40, index * 1.6), orientation, origin);
  }
  assert.ok(trail.sampleCount < 260);
  assert.ok(trail.distanceSpan <= 360);
});

test('collision debug wireframe changes from yellow to red on contact', () => {
  const view = new CollisionDebugView();
  assert.equal(view.colorHex, PALETTE.collision);
  view.setColliding(true);
  assert.equal(view.colorHex, PALETTE.alertRed);
  view.setColliding(false);
  assert.equal(view.colorHex, PALETTE.collision);
});

test('wing trails intensify and recover smoothly with throttle input', () => {
  const trail = new TrailView();
  trail.update(1, true);
  assert.ok(trail.throttleIntensity > 0.9);
  trail.update(2, false);
  assert.ok(trail.throttleIntensity < 0.03);
});

test('wind field keeps a bounded pool and responds to throttle input', () => {
  const wind = new WindView();
  const segmentCount = wind.segmentCount;
  const position = new Vector3(0, 50, 0);
  const orientation = new Quaternion();
  wind.update(1, position, orientation, 55, true);
  assert.equal(wind.segmentCount, segmentCount);
  assert.ok(wind.throttleIntensity > 0.9);
  wind.update(2, position, orientation, 55, false);
  assert.equal(wind.segmentCount, segmentCount);
  assert.ok(wind.throttleIntensity < 0.03);
});

test('wind streak settings update without changing the fixed world-space pool', () => {
  const wind = new WindView();
  const segmentCount = wind.segmentCount;
  wind.applyVisualSettings({
    windStreakCount: 164,
    windStreakLength: 38,
    windSpeedThreshold: 42,
    windOpacity: 0.31,
    windColor: '#eeeeee',
  });
  wind.update(1 / 60, new Vector3(0, 50, 0), new Quaternion(), 55, false);
  assert.equal(segmentCount, 120);
  assert.equal(wind.segmentCount, 164);
  assert.equal(wind.capacity, 240);
  assert.equal(wind.configuredLength, 38);
  assert.equal(wind.configuredThreshold, 42);

  wind.applyVisualSettings({
    windStreakCount: 999,
    windStreakLength: 38,
    windSpeedThreshold: 42,
    windOpacity: 0.31,
    windColor: '#eeeeee',
  });
  assert.equal(wind.segmentCount, wind.capacity);
});

test('wind streak centers persist in world space and follow floating-origin rebases', () => {
  const wind = new WindView();
  const plane = new Vector3(0, 50, 0);
  const orientation = new Quaternion();
  const before = new Vector3();
  const afterTravel = new Vector3();
  const afterRebase = new Vector3();

  wind.update(1 / 60, plane, orientation, 55, false);
  wind.getHeadPosition(0, before);
  plane.z += 1;
  wind.update(1 / 60, plane, orientation, 55, false);
  wind.getHeadPosition(0, afterTravel);
  assert.deepEqual(afterTravel.toArray(), before.toArray());

  const shift = new Vector3(256, 0, 512);
  wind.applyOriginShift(shift);
  wind.getHeadPosition(0, afterRebase);
  // Instance positions are intentionally stored in Float32 GPU buffers.
  assert.ok(afterRebase.distanceTo(before.clone().sub(shift)) < 1e-4);
  assert.equal(wind.simulationSpace, 'world');
  assert.equal(wind.depthTestingEnabled, true);
});
