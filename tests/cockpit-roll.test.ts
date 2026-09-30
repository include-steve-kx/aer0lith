import assert from 'node:assert/strict';
import test from 'node:test';
import { PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { CockpitRoll } from '../src/render/CockpitRoll.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { COCKPIT_EYE } from '../src/core/aircraftGeometry.ts';
import { FLIGHT } from '../src/core/config.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';

for (const direction of [-1, 1] as const) {
  test(`cockpit follows exactly two full rolls (${direction}) with no camera smoothing or pose drift`, () => {
    const terrain = {
      sample: () => ({ x: 0, y: 40, tangentX: .2, tangentY: .1, width: 150, height: 100, openness: 1 }),
      densityAt: () => -100, collisionDensityAt: () => -100,
    } as unknown as ProceduralTerrain;
    const flight = new FlightController(terrain);
    const camera = new PerspectiveCamera(), roll = new CockpitRoll();
    const cameraFlip = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI);
    const previous = flight.cameraOrientation.clone().multiply(cameraFlip);
    let total = 0;
    flight.startRoll(direction);
    for (let i = 0; flight.isRolling && i < 200; i++) {
      flight.update(FLIGHT.fixedStep, { pitch: 0, roll: 0, yaw: 0, throttle: 0 });
      camera.quaternion.copy(flight.cameraOrientation).multiply(cameraFlip);
      camera.position.copy(flight.position).add(new Vector3(...COCKPIT_EYE).applyQuaternion(flight.cameraOrientation));
      const basePosition = camera.position.clone(), baseOrientation = camera.quaternion.clone();
      roll.apply(camera, flight.cameraOrientation, flight.maneuverRollAngle);
      assert.ok(camera.quaternion.angleTo(flight.orientation.clone().multiply(cameraFlip)) < 1e-7);
      assert.ok(camera.position.distanceTo(flight.position.clone().add(new Vector3(...COCKPIT_EYE).applyQuaternion(flight.orientation))) < 1e-7);
      total += previous.angleTo(camera.quaternion); previous.copy(camera.quaternion);
      const pausedPosition = camera.position.clone(), pausedOrientation = camera.quaternion.clone();
      roll.restore(camera);
      assert.ok(camera.position.equals(basePosition)); assert.ok(camera.quaternion.equals(baseOrientation));
      roll.apply(camera, flight.cameraOrientation, flight.maneuverRollAngle);
      assert.ok(camera.position.equals(pausedPosition)); assert.ok(camera.quaternion.equals(pausedOrientation));
      roll.restore(camera);
    }
    assert.equal(flight.isRolling, false);
    assert.ok(Math.abs(total - Math.PI * 4) < 1e-6, `camera turned ${total * 180 / Math.PI} degrees`);
  });
}
