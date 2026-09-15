import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { CameraRig } from '../src/render/CameraRig.ts';

function fakeElement(): HTMLElement {
  const documentTarget = {
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  };
  return {
    style: {},
    clientWidth: 1280,
    clientHeight: 720,
    ownerDocument: documentTarget,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    getRootNode: () => documentTarget,
  } as unknown as HTMLElement;
}

test('floating-origin shift preserves an orbiting camera relative to the aircraft', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const orientation = new Quaternion();
  const planeBefore = new Vector3(140, 62, 2052);
  rig.update(1, planeBefore, orientation, 0);
  rig.controls.dispatchEvent({ type: 'start' });
  rig.controls.dispatchEvent({ type: 'end' });

  const relativeCameraBefore = rig.camera.position.clone().sub(planeBefore);
  const relativeTargetBefore = rig.controls.target.clone().sub(planeBefore);
  const shift = new Vector3(0, 0, 2048);
  const planeAfter = planeBefore.clone().sub(shift);

  rig.applyOriginShift(shift);
  rig.update(1 / 60, planeAfter, orientation, 0);

  assert.ok(rig.camera.position.clone().sub(planeAfter).distanceTo(relativeCameraBefore) < 1e-9);
  assert.ok(rig.controls.target.clone().sub(planeAfter).distanceTo(relativeTargetBefore) < 1e-9);
});

test('camera slots map to cockpit, default chase, and far chase', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const plane = new Vector3(0, 60, 0);
  const orientation = new Quaternion();

  assert.equal(rig.mode, 'chase');
  assert.equal(rig.select(0), 'cockpit');
  assert.equal(rig.select(1), 'chase');
  rig.update(1, plane, orientation, 0);
  const chaseOffset = rig.camera.position.clone().sub(plane);

  assert.equal(rig.select(2), 'far-chase');
  for (let frame = 0; frame < 180; frame += 1) {
    rig.update(1 / 60, plane, orientation, 0);
  }
  const farChaseOffset = rig.camera.position.clone().sub(plane);

  assert.ok(farChaseOffset.length() > chaseOffset.length());
  assert.ok(Math.abs(farChaseOffset.length() - rig.controls.maxDistance) < 1e-6);
  assert.ok(farChaseOffset.y > chaseOffset.y);
  assert.ok(Math.abs(farChaseOffset.x) < 1e-9, 'far chase should stay directly behind the plane');
});

test('camera modes remain smoothly animated', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const plane = new Vector3(0, 60, 0);
  const orientation = new Quaternion();

  rig.update(1 / 60, plane, orientation, 0);
  const chaseDistance = rig.camera.position.distanceTo(plane);
  rig.select(2);
  rig.update(1 / 60, plane, orientation, 0);
  const firstTransitionDistance = rig.camera.position.distanceTo(plane);

  assert.ok(firstTransitionDistance > chaseDistance, 'transition should begin on the first frame');
  assert.ok(firstTransitionDistance < rig.controls.maxDistance, 'transition should not snap to its endpoint');
});

test('starting an orbit preserves the current camera aim', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const plane = new Vector3(12, 60, 30);
  const orientation = new Quaternion();
  rig.update(1 / 60, plane, orientation, 0);
  const quaternionBefore = rig.camera.quaternion.clone();

  rig.controls.dispatchEvent({ type: 'start' });
  rig.controls.update(0);

  assert.ok(rig.camera.quaternion.angleTo(quaternionBefore) < 1e-7);
  const cameraDirection = new Vector3();
  rig.camera.getWorldDirection(cameraDirection);
  const targetDirection = rig.controls.target.clone().sub(rig.camera.position).normalize();
  assert.ok(cameraDirection.dot(targetDirection) > 1 - 1e-12);
});

test('active throttle smoothly widens and then restores camera FOV', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const plane = new Vector3(0, 60, 0);
  const orientation = new Quaternion();
  rig.update(1 / 60, plane, orientation, 0, false);
  const baseFov = rig.camera.fov;

  for (let frame = 0; frame < 45; frame += 1) {
    rig.update(1 / 60, plane, orientation, 0, true);
  }
  assert.ok(rig.camera.fov > baseFov + 18);

  for (let frame = 0; frame < 300; frame += 1) {
    rig.update(1 / 60, plane, orientation, 0, false);
  }
  assert.ok(Math.abs(rig.camera.fov - baseFov) < 0.05);
});
