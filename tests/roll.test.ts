import assert from 'node:assert/strict';
import test from 'node:test';
import { FlightController } from '../src/flight/FlightController.ts';
import { FLIGHT } from '../src/core/config.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
function terrain(collision = (_x: number, _y: number, _z: number) => -100) {
  return { sample: () => ({ x: 0, y: 40, tangentX: 0, tangentY: 0, width: 150, height: 100, openness: 1 }),
    densityAt: () => -100, collisionDensityAt: collision } as unknown as ProceduralTerrain;
}

for (const direction of [-1, 1] as const) {
  test(`roll ${direction} completes one turn and a lateral dodge with collision checks on every step`, () => {
    let collisionSamples = 0;
    const flight = new FlightController(terrain(() => { collisionSamples++; return -100; }));
    const initial = flight.orientation.clone();
    assert.equal(flight.rollDistance, 44, 'dodge clears a substantially wider obstacle');
    assert.ok(flight.startRoll(direction));
    assert.equal(flight.startRoll(direction), false);
    let steps = 0, maximum = 0, traveledAngle = 0;
    const previous = flight.orientation.clone();
    while (flight.isRolling && steps++ < 180) {
      flight.update(FLIGHT.fixedStep, neutral);
      traveledAngle += previous.angleTo(flight.orientation);
      previous.copy(flight.orientation);
      maximum = Math.max(maximum, Math.abs(flight.maneuverRollAngle));
      assert.ok(flight.cameraOrientation.angleTo(initial) < 1e-8);
    }
    assert.ok(Math.abs(traveledAngle - Math.PI * 2) < 1e-7, `actual rotation was ${traveledAngle * 180 / Math.PI} degrees`);
    assert.ok(maximum > Math.PI * 2 - 0.01);
    assert.equal(flight.isRolling, false);
    assert.ok(steps / 120 >= 0.6 && steps / 120 <= 0.6 + 1 / 120, 'one full dodge takes 0.6 seconds');
    assert.equal(flight.startRoll(direction), false, 'recovery blocks immediate repeat');
    for (let i = 0; i < 16; i++) flight.update(FLIGHT.fixedStep, neutral);
    assert.ok(flight.startRoll(direction), 'recovery completes after 0.125 seconds');
    assert.ok(Math.abs(flight.position.x + direction * flight.rollDistance) < 1e-7);
    assert.ok(flight.orientation.angleTo(initial) < 1e-8);
    assert.ok(collisionSamples >= steps * 4);
  });
}

test('a roll can hit terrain, receive a push, and cancel without recovery; pause freezes motion', () => {
  const flight = new FlightController(terrain(x => x > 9 ? 2 : -100));
  let impacts = 0;
  flight.onImpact = () => { impacts++; };
  flight.startRoll(-1);
  flight.update(FLIGHT.fixedStep, neutral);
  flight.togglePause();
  const before = flight.position.clone(), angle = flight.maneuverRollAngle;
  flight.update(1, neutral);
  assert.ok(flight.position.equals(before)); assert.equal(flight.maneuverRollAngle, angle);
  flight.togglePause();
  for (let i = 0; i < 100 && impacts === 0; i++) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual');
  assert.equal(impacts, 1);
  assert.equal(flight.isRolling, false);
});
