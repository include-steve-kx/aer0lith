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
  assert.ok(Math.abs(farChaseOffset.length() - rig.controls.maxDistance) < 1e-4);
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

test('pause holds the current camera and boost FOV, but permits selecting a new view', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const plane = new Vector3(0, 60, 0);
  const orientation = new Quaternion();
  rig.update(1 / 60, plane, orientation, 0, true);
  rig.select(2);
  rig.update(1 / 60, plane, orientation, 0, true);
  rig.setPaused();
  const position = rig.camera.position.clone();
  const rotation = rig.camera.quaternion.clone();
  const fov = rig.camera.fov;
  for (let i = 0; i < 300; i++) rig.update(1 / 60, plane, orientation, 1, false, true);
  assert.deepEqual(rig.camera.position, position);
  assert.deepEqual(rig.camera.quaternion.toArray(), rotation.toArray());
  assert.equal(rig.camera.fov, fov);
  rig.select(0);
  rig.update(1 / 60, plane, orientation, 0, false, true);
  assert.ok(rig.camera.position.distanceTo(position) > 0.1);
});

test('a paused orbit does not return to chase after the normal delay', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const plane = new Vector3(0, 60, 0);
  const orientation = new Quaternion();
  rig.update(1 / 60, plane, orientation, 0);
  rig.setPaused();
  rig.controls.dispatchEvent({ type: 'start' });
  rig.camera.position.set(18, 66, 0);
  rig.controls.update(0);
  rig.controls.dispatchEvent({ type: 'end' });
  const position = rig.camera.position.clone();
  for (let i = 0; i < 600; i++) rig.update(1 / 60, plane, orientation, 0, false, true);
  assert.ok(rig.camera.position.distanceTo(position) < 1e-7);
});

test('camera orbit keeps its native Shift gesture now that boost uses K', () => {
  type Listener = (event: PointerEvent) => void;
  const listeners: { type: string; fn: Listener; capture: boolean }[] = [];
  const documentListeners = new Map<string, Listener>();
  const doc = {
    addEventListener: (type: string, fn: Listener) => documentListeners.set(type, fn),
    removeEventListener: (type: string) => documentListeners.delete(type),
  };
  const element = {
    style: {}, clientWidth: 1280, clientHeight: 720, ownerDocument: doc,
    setPointerCapture: () => {}, releasePointerCapture: () => {},
    getRootNode: () => doc,
    addEventListener: (type: string, fn: Listener, options?: {capture?: boolean}) => listeners.push({type, fn, capture: !!options?.capture}),
    removeEventListener: () => {},
  } as unknown as HTMLElement;
  const rig = new CameraRig(16 / 9, element);
  rig.controls.enableDamping = false;
  const down = (button: number, shiftKey: boolean) => {
    const event = { button, shiftKey, ctrlKey: false, metaKey: false, pointerId: 1,
      pointerType: 'mouse', clientX: 400, clientY: 300, preventDefault: () => {} } as PointerEvent;
    for (const listener of listeners.filter(l => l.type === 'pointerdown').sort((a, b) => Number(b.capture) - Number(a.capture))) listener.fn(event);
    const target = rig.controls.target.clone(), orientation = rig.camera.quaternion.clone();
    documentListeners.get('pointermove')!({ ...event, clientX: 460, clientY: 325 });
    const result = { pan: target.distanceTo(rig.controls.target), turn: orientation.angleTo(rig.camera.quaternion) };
    documentListeners.get('pointerup')!(event);
    return result;
  };
  const orbit = down(0, false), pan = down(2, false), shiftPan = down(0, true);
  assert.ok(orbit.pan < 1e-8 && orbit.turn > 0.01, 'left-drag orbits');
  assert.ok(pan.pan > 0.1 && pan.turn < 1e-7, 'right-drag pans');
  assert.ok(shiftPan.pan > 0.1 && shiftPan.turn < 1e-7, 'Shift-left-drag retains native pan');
});

test('hybrid chase frame reveals the aircraft side during a large drift', () => {
  const rig = new CameraRig(16 / 9, fakeElement());
  const plane = new Vector3(0, 60, 0);
  const orientation = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI / 2);
  const travel = new Vector3(0, 0, 90);
  for (let frame = 0; frame < 240; frame += 1) {
    rig.update(1 / 60, plane, orientation, 0, false, false, travel, 'drift');
  }
  const cameraOffset = rig.camera.position.clone().sub(plane).normalize();
  const rearOfNose = new Vector3(0, 0, -1).applyQuaternion(orientation).normalize();
  const sideAngle = cameraOffset.angleTo(rearOfNose) * 180 / Math.PI;
  assert.ok(sideAngle > 20, `expected a restrained rear-side view, got ${sideAngle.toFixed(1)} degrees`);
  assert.ok(sideAngle < 40, 'tighter configured maximum lag remains bounded');
});
