import assert from 'node:assert/strict';
import test from 'node:test';
import { motionBlurExposure, motionBlurStreak } from '../src/render/MotionBlur.ts';

test('cruising has a visible peripheral streak and throttle increases it', () => {
  const cruise = motionBlurStreak(55, 0.45, 20);
  assert.ok(cruise >= 5 && cruise < 6);
  assert.ok(motionBlurStreak(120, 0.45, 20) > cruise * 3);
  assert.ok(motionBlurStreak(55, 1.5, 0) > 25);
  assert.equal(motionBlurStreak(20, 0.45, 20), 0);
  assert.equal(motionBlurStreak(120, 0, 20), 0);
});

test('speed blur is off below its threshold and grows continuously with speed', () => {
  assert.equal(motionBlurExposure(0, 0.45, 20), 0);
  assert.equal(motionBlurExposure(20, 0.45, 20), 0);
  let previous = 0;
  for (let speed = 21; speed <= 120; speed++) {
    const exposure = motionBlurExposure(speed, 0.45, 20);
    assert.ok(exposure > previous);
    assert.ok(exposure <= 0.45 / 60);
    previous = exposure;
  }
  assert.equal(motionBlurExposure(120, 0, 20), 0);
  assert.equal(motionBlurExposure(240, 0.45, 20), previous);
});

test('blur settings cannot produce negative, infinite, or unbounded shutter time', () => {
  for (const speed of [-10, 0, 55, 120, 1e6]) {
    for (const threshold of [-10, 20, 120, 200]) {
      const exposure = motionBlurExposure(speed, 999, threshold);
      assert.ok(exposure >= 0 && exposure <= 1.5 / 60);
    }
  }
  assert.equal(motionBlurExposure(NaN, 1, 20), 0);
  assert.equal(motionBlurExposure(120, Infinity, 20), 0);
  assert.equal(motionBlurExposure(120, 1, NaN), 0);
});
