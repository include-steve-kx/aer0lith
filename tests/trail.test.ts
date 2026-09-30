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

test('wind count and length scale with speed, with independently configurable responses', () => {
  const wind = new WindView(), plane = new Vector3(), q = new Quaternion();
  wind.update(0, plane, q, 30, false); const slowCount = wind.segmentCount, slowLength = wind.effectiveLength;
  wind.update(0, plane, q, 55, false);
  assert.equal(wind.segmentCount, 120); assert.equal(wind.effectiveLength, 22);
  wind.update(0, plane, q, 110, false);
  assert.equal(wind.segmentCount, 240); assert.equal(wind.effectiveLength, 44);
  assert.ok(slowCount < 120 && slowLength < 22);
  const position = wind.getHeadPosition(0, new Vector3()).clone();
  wind.update(0, plane, q, 110, false, true);
  assert.ok(wind.getHeadPosition(0, new Vector3()).equals(position));
  wind.applyVisualSettings({ windStreakCount: 100, windStreakLength: 20, windSpeedThreshold: 20,
    windOpacity: .36, windColor: '#ffffff', windCountSpeedResponse: 0, windLengthSpeedResponse: 2 });
  assert.equal(wind.segmentCount, 100); assert.equal(wind.effectiveLength, 80);
  wind.applyVisualSettings({ windStreakCount: 100, windStreakLength: 20, windSpeedThreshold: 20,
    windOpacity: .36, windColor: '#ffffff', windCountSpeedResponse: 1, windLengthSpeedResponse: 0 });
  assert.equal(wind.segmentCount, 200); assert.equal(wind.effectiveLength, 20);
});

test('wind spawns across uniform elliptical area without a central hole', () => {
  const wind = new WindView(); wind.update(0, new Vector3(), new Quaternion(), 55, false);
  const point = new Vector3(), quadrants = [0, 0, 0, 0];
  let meanArea = 0, inner = 0, minimumRadius = Infinity;
  for (let i = 0; i < wind.capacity; i++) {
    wind.getHeadPosition(i, point);
    const area = (point.x / 150) ** 2 + (point.y / 92) ** 2;
    assert.ok(area <= 1.000001); meanArea += area;
    if (area < .25) inner++;
    minimumRadius = Math.min(minimumRadius, Math.sqrt(area));
    quadrants[(point.x >= 0 ? 1 : 0) + (point.y >= 0 ? 2 : 0)]++;
  }
  assert.ok(Math.abs(meanArea / wind.capacity - .5) < .06);
  assert.ok(inner > 40 && inner < 80, 'quarter-area center receives about a quarter of samples');
  // Check central coverage over multiple deterministic populations, not one small sample.
  for (let cycle = 0; cycle < 10; cycle++) {
    wind.reset(new Vector3(), new Quaternion());
    for (let i = 0; i < wind.capacity; i++) {
      wind.getHeadPosition(i, point);
      minimumRadius = Math.min(minimumRadius, Math.hypot(point.x / 150, point.y / 92));
    }
  }
  assert.ok(minimumRadius < .08, 'streaks may spawn within the former central exclusion zone');
  quadrants.forEach(count => assert.ok(count > 40 && count < 80));
});
