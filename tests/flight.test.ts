import assert from 'node:assert/strict';
import test from 'node:test';
import { FLIGHT } from '../src/core/config.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { flightInputFromKeys, joystickInputFromOffset } from '../src/flight/InputManager.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

test('keyboard directions map to the intended flight axes', () => {
  assert.equal(flightInputFromKeys(new Set(['KeyW'])).pitch, -1);
  assert.equal(flightInputFromKeys(new Set(['KeyS'])).pitch, 1);
  const left = flightInputFromKeys(new Set(['KeyA']));
  assert.equal(left.roll, -1);
  assert.equal(left.yaw, 1);
  const right = flightInputFromKeys(new Set(['KeyD']));
  assert.equal(right.roll, 1);
  assert.equal(right.yaw, -1);
  assert.equal(flightInputFromKeys(new Set(['KeyQ', 'KeyE'])).yaw, 0);
});

test('touch joystick maps vertical motion to pitch and horizontal motion to roll', () => {
  const upperRight = joystickInputFromOffset(25, -25, 50);
  assert.ok(upperRight.roll > 0);
  assert.ok(upperRight.yaw < 0);
  assert.ok(upperRight.pitch < 0);

  const lowerLeft = joystickInputFromOffset(-25, 25, 50);
  assert.ok(lowerLeft.roll < 0);
  assert.ok(lowerLeft.yaw > 0);
  assert.ok(lowerLeft.pitch > 0);

  const clamped = joystickInputFromOffset(200, 0, 50);
  assert.equal(clamped.roll, 1);
  assert.equal(clamped.pitch, 0);
  assert.equal(Math.hypot(clamped.offsetX, clamped.offsetY), 50);

  const deadZone = joystickInputFromOffset(2, 2, 50);
  assert.equal(deadZone.roll, 0);
  assert.equal(deadZone.pitch, 0);
});

test('autopilot remains finite and clear of terrain across fixed seeds', () => {
  for (let index = 0; index < 10; index += 1) {
    const terrain = new ProceduralTerrain(`autopilot-${index}`);
    const flight = new FlightController(terrain);
    let minimumClearance = Number.POSITIVE_INFINITY;
    for (let step = 0; step < 30 * 120; step += 1) {
      flight.update(FLIGHT.fixedStep, neutral);
      minimumClearance = Math.min(minimumClearance, flight.altitudeAGL);
    }
    assert.equal(flight.mode, 'autopilot');
    assert.ok(Number.isFinite(flight.position.length()));
    assert.ok(minimumClearance > 10, `seed ${index} clearance dropped to ${minimumClearance}`);
  }
});

test('autopilot follows meaningful 3D route altitude changes', () => {
  const terrain = new ProceduralTerrain('altitude-variation');
  const flight = new FlightController(terrain);
  let minimumAltitude = Number.POSITIVE_INFINITY;
  let maximumAltitude = Number.NEGATIVE_INFINITY;
  for (let step = 0; step < 90 * 120; step += 1) {
    flight.update(FLIGHT.fixedStep, neutral);
    minimumAltitude = Math.min(minimumAltitude, flight.position.y);
    maximumAltitude = Math.max(maximumAltitude, flight.position.y);
  }
  assert.ok(maximumAltitude - minimumAltitude > 20);
  assert.equal(flight.mode, 'autopilot');
});

test('manual takeover, autopilot toggle, and pause preserve expected modes', () => {
  const flight = new FlightController(new ProceduralTerrain('mode-test'));
  flight.takeManualControl();
  assert.equal(flight.mode, 'manual');
  flight.toggleAutopilot();
  assert.equal(flight.mode, 'autopilot');
  flight.togglePause();
  assert.equal(flight.mode, 'paused');
  flight.togglePause();
  assert.equal(flight.mode, 'autopilot');
});

test('manual pitch and bank-assisted steering follow the displayed controls', () => {
  const simulate = (input: typeof neutral): FlightController => {
    const flight = new FlightController(new ProceduralTerrain('input-direction-test'));
    flight.takeManualControl();
    for (let step = 0; step < 120; step += 1) flight.update(FLIGHT.fixedStep, input);
    return flight;
  };

  const neutralFlight = simulate(neutral);
  const leftFlight = simulate(flightInputFromKeys(new Set(['KeyA'])));
  const rightFlight = simulate(flightInputFromKeys(new Set(['KeyD'])));
  const climbFlight = simulate(flightInputFromKeys(new Set(['KeyW'])));
  const descendFlight = simulate(flightInputFromKeys(new Set(['KeyS'])));

  assert.ok(leftFlight.position.x > neutralFlight.position.x, 'A should steer toward screen-left in chase view');
  assert.ok(rightFlight.position.x < neutralFlight.position.x, 'D should steer toward screen-right in chase view');
  assert.ok(climbFlight.position.y > neutralFlight.position.y, 'W should pitch up');
  assert.ok(descendFlight.position.y < neutralFlight.position.y, 'S should pitch down');
});

test('manual throttle is a temporary boost and returns to cruise speed', () => {
  const openTerrain = {
    sample: () => ({
      x: 0,
      y: 50,
      floorY: -150,
      tangentX: 0,
      tangentY: 0,
      width: 200,
      height: 200,
      openness: 1,
    }),
    densityAt: () => -100,
    collisionDensityAt: () => -100,
  } as unknown as ProceduralTerrain;
  const flight = new FlightController(openTerrain);
  flight.takeManualControl();
  const boost = { ...neutral, throttle: 1 };
  for (let step = 0; step < 8 * 120; step += 1) {
    flight.update(FLIGHT.fixedStep, boost);
  }
  assert.equal(FLIGHT.maxSpeed, 120);
  assert.ok(flight.speed > 115);

  for (let step = 0; step < 8 * 120; step += 1) {
    flight.update(FLIGHT.fixedStep, neutral);
  }
  assert.ok(Math.abs(flight.speed - FLIGHT.nominalSpeed) < 1);
});

test('collision enters recovery and restores autopilot', () => {
  const terrain = new ProceduralTerrain('collision-test');
  const flight = new FlightController(terrain);
  flight.takeManualControl();
  const route = terrain.sample(flight.position.z);
  flight.position.set(route.x + route.width + 80, route.y, flight.position.z);
  flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'crashed');
  for (let step = 0; step < Math.ceil(FLIGHT.crashDuration / FLIGHT.fixedStep) + 2; step += 1) {
    flight.update(FLIGHT.fixedStep, neutral);
  }
  assert.equal(flight.mode, 'autopilot');
  assert.ok(flight.altitudeAGL > 10);
});

test('collision probes remain inside the visible aircraft silhouette', () => {
  const flatTerrain = {
    sample: () => ({ x: 0, y: 20, floorY: 0, tangentX: 0, tangentY: 0, width: 120, height: 20, openness: 1 }),
    densityAt: (_x: number, y: number) => -y,
  } as unknown as ProceduralTerrain;
  const flight = new FlightController(flatTerrain);
  flight.takeManualControl();
  flight.position.y = 0.45;
  flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual', 'aircraft should not collide while its visible underside is clear');

  flight.position.y = 0.15;
  for (let step = 0; step < 8; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'crashed', 'aircraft should collide once its visible underside reaches terrain');
});

test('a single shallow collision sample does not trigger recovery', () => {
  let collisionDensity = 0.13;
  const terrain = {
    sample: () => ({ x: 0, y: 20, floorY: 0, tangentX: 0, tangentY: 0, width: 120, height: 20, openness: 1 }),
    densityAt: () => collisionDensity,
  } as unknown as ProceduralTerrain;
  const flight = new FlightController(terrain);
  flight.takeManualControl();
  flight.position.y = 0.15;
  flight.update(FLIGHT.fixedStep, neutral);
  collisionDensity = -10;
  flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual');
});
