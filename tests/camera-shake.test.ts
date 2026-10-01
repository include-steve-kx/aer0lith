import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { BoostEnvelope } from '../src/render/BoostEnvelope.ts';
import { BoostCameraShake } from '../src/render/BoostCameraShake.ts';

test('boost shake is bounded, deterministic while paused, and never drifts the camera base pose', () => {
  const camera = new PerspectiveCamera(); camera.position.set(20, 8, -22); camera.rotation.set(.2, .4, .1);
  const position = camera.position.clone(), q = camera.quaternion.clone();
  const shake = new BoostCameraShake(); shake.update(.065, 1);
  shake.apply(camera, 110);
  const paused = camera.position.clone(), pausedQ = camera.quaternion.clone();
  assert.ok(camera.position.distanceTo(position) > 0.05);
  assert.ok(camera.position.distanceTo(position) < .3);
  shake.restore(camera);
  assert.ok(camera.position.equals(position)); assert.ok(camera.quaternion.equals(q));
  shake.update(0, 1); shake.apply(camera, 110);
  assert.ok(camera.position.equals(paused)); assert.ok(camera.quaternion.equals(pausedQ));
  shake.restore(camera); shake.strength = 0; shake.update(1, 1); shake.apply(camera, 110);
  assert.equal(shake.activeFrequency, 0);
  assert.ok(camera.position.equals(position)); assert.ok(camera.quaternion.equals(q));
  shake.restore(camera);
});

test('held or locked boost settles both shake amount and frequency to zero while flame remains lit', () => {
  const flame = new BoostEnvelope(), shake = new BoostCameraShake(), camera = new PerspectiveCamera();
  flame.fadeDuration = 2;
  flame.update(.065, true); shake.update(.065, flame.shakeIntensity);
  assert.equal(shake.activeFrequency, shake.frequency);
  for (let i = 0; i < 4; i++) {
    const before = shake.activeFrequency;
    flame.update(.5, true); shake.update(.5, flame.shakeIntensity);
    assert.ok(shake.activeFrequency < before);
  }
  assert.equal(shake.activeFrequency, 0); assert.equal(flame.shakeIntensity, 0);
  assert.ok(flame.intensity >= .42, 'steady boosting flame remains visible');
  shake.apply(camera, 120);
  assert.ok(camera.position.equals(new PerspectiveCamera().position));
  assert.ok(camera.quaternion.equals(new PerspectiveCamera().quaternion));
  shake.restore(camera);
  flame.update(30, true); shake.update(30, flame.shakeIntensity);
  assert.equal(shake.activeFrequency, 0);
  flame.update(.1, false); shake.update(.1, flame.shakeIntensity);
  assert.equal(shake.activeFrequency, 0, 'releasing settled boost cannot restart shake');
  flame.update(.065, true); shake.update(.065, flame.shakeIntensity);
  assert.equal(shake.activeFrequency, shake.frequency, 'a new boost re-ignites the transient');
});

for (const fadeDuration of [0.3, 2.8, 8]) {
  test(`shake amount and frequency use the configured fade duration of ${fadeDuration} seconds`, () => {
    const flame = new BoostEnvelope(), shake = new BoostCameraShake(), camera = new PerspectiveCamera();
    flame.fadeDuration = fadeDuration;
    // Hold phase fixed here to measure amplitude independently of the oscillation.
    const amplitude = () => {
      shake.update(0, flame.shakeIntensity); shake.apply(camera, 110);
      const value = camera.position.length(); shake.restore(camera); return value;
    };
    flame.update(.065, true); const peak = amplitude();
    for (let i = 1; i <= 4; i++) {
      flame.update(fadeDuration / 4, false);
      assert.ok(Math.abs(amplitude() / peak - flame.shakeIntensity) < 1e-10);
      assert.equal(shake.activeFrequency, shake.frequency * flame.shakeIntensity);
      const paused = amplitude(); flame.update(0, false); assert.equal(amplitude(), paused);
    }
    flame.update(1e-9, false);
    assert.equal(flame.intensity, 0); assert.equal(amplitude(), 0); assert.equal(shake.activeFrequency, 0);
    flame.update(.065, true); assert.ok(amplitude() > 0);
    flame.reset(); assert.equal(amplitude(), 0); assert.equal(shake.activeFrequency, 0);
  });
}

test('idle time and paused frequency edits do not advance or rephase camera shake', () => {
  const shake = new BoostCameraShake(), reference = new BoostCameraShake(), camera = new PerspectiveCamera();
  shake.update(100, 0);
  shake.update(.1, 1); reference.update(.1, 1);
  shake.apply(camera, 110); const p = camera.position.clone(), q = camera.quaternion.clone(); shake.restore(camera);
  reference.apply(camera, 110); assert.ok(camera.position.equals(p)); assert.ok(camera.quaternion.equals(q)); reference.restore(camera);
  shake.frequency = 25; shake.update(0, 1); shake.apply(camera, 110);
  assert.ok(camera.position.equals(p)); assert.ok(camera.quaternion.equals(q)); shake.restore(camera);
});

test('one-shot Pulse shake reuses the boost ignition attack and bounded decay', () => {
  const envelope = new BoostEnvelope();
  envelope.fadeDuration = 3.6;
  envelope.trigger();
  envelope.update(0, false);
  assert.equal(envelope.shakeIntensity, 0, 'pause freezes the triggered onset');
  envelope.update(0.065, false);
  assert.equal(envelope.shakeIntensity, 1, 'Pulse reaches the same boost-onset peak');
  envelope.update(1.8, false);
  assert.ok(Math.abs(envelope.shakeIntensity - 0.25) < 1e-10);
  envelope.update(1.8 + 1e-9, false);
  assert.equal(envelope.shakeIntensity, 0);
  envelope.trigger();
  envelope.update(0.065, false);
  assert.equal(envelope.shakeIntensity, 1, 'a new Pulse restarts the fixed-capacity envelope');
  envelope.reset();
  assert.equal(envelope.shakeIntensity, 0);
});

for (const fadeDuration of [0.3, 2.8, 8]) {
  test(`held boost keeps its flame while shake ends after ${fadeDuration} seconds`, () => {
    const flame = new BoostEnvelope(), shake = new BoostCameraShake();
    flame.fadeDuration = fadeDuration;
    flame.update(.065, true);
    flame.update(fadeDuration / 2, true); shake.update(fadeDuration / 2, flame.shakeIntensity);
    assert.ok(Math.abs(flame.shakeIntensity - .25) < 1e-10);
    assert.ok(Math.abs(shake.activeFrequency - shake.frequency * .25) < 1e-10);
    // Releasing midway does not restart or extend the camera fade.
    const released = new BoostEnvelope(); released.fadeDuration = fadeDuration;
    released.update(.065, true); released.update(fadeDuration / 2, true);
    released.update(fadeDuration / 2 + 1e-9, false);
    assert.equal(released.shakeIntensity, 0);
    flame.update(fadeDuration / 2 + 1e-9, true); shake.update(fadeDuration / 2, flame.shakeIntensity);
    assert.equal(flame.shakeIntensity, 0); assert.equal(shake.activeFrequency, 0);
    assert.ok(flame.intensity >= .42);
    flame.update(20, true); assert.equal(flame.intensity, .42);
  });
}
