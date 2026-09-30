import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera } from 'three';
import { BoostCameraShake } from '../src/render/BoostCameraShake.ts';

test('boost shake is bounded, deterministic while paused, and never drifts the camera base pose', () => {
  const camera = new PerspectiveCamera(); camera.position.set(20, 8, -22); camera.rotation.set(.2, .4, .1);
  const position = camera.position.clone(), q = camera.quaternion.clone();
  const shake = new BoostCameraShake(); shake.update(1, true);
  shake.apply(camera, 1.234, 110);
  const paused = camera.position.clone(), pausedQ = camera.quaternion.clone();
  assert.ok(camera.position.distanceTo(position) > 0.05);
  assert.ok(camera.position.distanceTo(position) < .3);
  shake.restore(camera);
  assert.ok(camera.position.equals(position)); assert.ok(camera.quaternion.equals(q));
  shake.update(0, false); shake.apply(camera, 1.234, 110);
  assert.ok(camera.position.equals(paused)); assert.ok(camera.quaternion.equals(pausedQ));
  shake.restore(camera); shake.strength = 0; shake.apply(camera, 4, 110);
  assert.ok(camera.position.equals(position)); assert.ok(camera.quaternion.equals(q));
  shake.restore(camera);
});
