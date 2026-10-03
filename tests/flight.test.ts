import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { FLIGHT } from '../src/core/config.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { flightInputFromKeys, joystickInputFromOffset } from '../src/flight/InputManager.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

function openTerrain(): ProceduralTerrain {
  return {
    sample: () => ({ x: 0, y: 50, floorY: -150, tangentX: 0, tangentY: 0,
      width: 200, height: 200, openness: 1 }),
    densityAt: () => -100,
    collisionDensityAt: () => -100,
  } as unknown as ProceduralTerrain;
}

test('render pose interpolates fixed physics steps without visible position stair-steps', () => {
  const flight = new FlightController(openTerrain());
  flight.takeManualControl();
  const rendered = new Vector3(), orientation = new Quaternion(), camera = new Quaternion();
  let accumulator = 0;
  const positions: number[] = [];
  for (let frame = 0; frame < 180; frame++) {
    accumulator += 1 / 144;
    while (accumulator >= FLIGHT.fixedStep) {
      flight.update(FLIGHT.fixedStep, neutral);
      accumulator -= FLIGHT.fixedStep;
    }
    flight.sampleRenderPose(accumulator / FLIGHT.fixedStep, rendered, orientation, camera);
    positions.push(rendered.z);
  }
  const deltas = positions.slice(4).map((position, index) => position - positions[index + 3]);
  const expected = FLIGHT.nominalSpeed / 144;
  for (const delta of deltas) assert.ok(Math.abs(delta - expected) < 1e-8, `${delta} != ${expected}`);
});

test('render interpolation preserves the final degrees of a complete cockpit roll', () => {
  const flight = new FlightController(openTerrain());
  flight.startRoll(1);
  while (flight.isRolling) flight.update(FLIGHT.fixedStep, neutral);
  const angle = flight.sampleRenderPose(0.5, new Vector3(), new Quaternion(), new Quaternion());
  assert.ok(angle > Math.PI * 1.9, `roll wrapped backward through ${angle}`);
});

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
  assert.equal(flightInputFromKeys(new Set(['ControlLeft', 'ControlRight'])).throttle, 0);
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

test('collision loses energy and separates without recovery or mode changes', () => {
  const terrain = new ProceduralTerrain('collision-test');
  const flight = new FlightController(terrain);
  flight.takeManualControl();
  let impactCount = 0;
  let separation = 0;
  let dissipated = 0;
  flight.onImpact = impact => {
    impactCount++;
    separation = impact.relativeVelocityAfter.dot(impact.normal);
    dissipated = impact.dissipatedEnergy;
  };
  const route = terrain.sample(flight.position.z);
  flight.position.set(route.x + route.width + 80, route.y, flight.position.z);
  flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual');
  assert.equal(impactCount, 1);
  assert.ok(separation >= flight.settings.collisionSeparationSpeed);
  assert.ok(dissipated > 0);
  assert.ok(flight.controlVelocity.length() < FLIGHT.nominalSpeed, 'contact removes kinetic energy');
});

test('collision probes remain inside the visible aircraft silhouette', () => {
  const flatTerrain = {
    sample: () => ({ x: 0, y: 20, floorY: 0, tangentX: 0, tangentY: 0, width: 120, height: 20, openness: 1 }),
    densityAt: (_x: number, y: number) => -y,
  } as unknown as ProceduralTerrain;
  const flight = new FlightController(flatTerrain);
  flight.takeManualControl();
  let impacts = 0;
  flight.onImpact = () => { impacts++; };
  flight.position.y = 2.05;
  flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual', 'aircraft should not collide while its visible underside is clear');
  assert.equal(impacts, 0);

  flight.position.y = 1.65;
  for (let step = 0; step < 8; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual');
  assert.equal(impacts, 1, 'visible underside contact produces one debounced impact');
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

test('boost changes speed without disengaging autopilot; negative throttle is neutral and steering takes over', () => {
  const terrain = {
    sample: () => ({ x: 0, y: 50, tangentX: 0, tangentY: 0, width: 200, height: 200, openness: 1 }),
    densityAt: () => -100, collisionDensityAt: () => -100,
  } as unknown as ProceduralTerrain;
  const flight = new FlightController(terrain);
  const coast = new FlightController(terrain);
  for (let i = 0; i < 8 * 120; i++) flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1 });
  for (let i = 0; i < 8 * 120; i++) coast.update(FLIGHT.fixedStep, { ...neutral, throttle: 1 });
  assert.equal(flight.mode, 'autopilot'); assert.ok(flight.speed > 115);
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: -1 });
  coast.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.speed, coast.speed, 'negative throttle no longer applies braking');
  assert.equal(flight.throttle, coast.throttle);
  flight.update(FLIGHT.fixedStep, { ...neutral, roll: 0.1, throttle: 1 });
  assert.equal(flight.mode, 'manual');
});

test('cockpit uses compact bounds, still collides head-on, and camera switching restores full wings', () => {
  const terrain = {
    sample: () => ({ x: 0, y: 0, tangentX: 0, tangentY: 0, width: 200, height: 200, openness: 1 }),
    densityAt: () => -100,
    collisionDensityAt: (x: number) => Math.abs(x) - 3,
  } as unknown as ProceduralTerrain;
  const flight = new FlightController(terrain);
  let impacts = 0;
  flight.onImpact = () => { impacts++; };
  flight.takeManualControl(); flight.setCockpitCollision(true);
  for (let i = 0; i < 12; i++) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual', 'compact cockpit fits a six metre passage');
  flight.setCockpitCollision(false); flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'manual');
  assert.equal(impacts, 1, 'full wings hit the same narrow passage');
  const wall = { ...terrain, collisionDensityAt: (_x: number, _y: number, z: number) => z - 6 } as ProceduralTerrain;
  const headOn = new FlightController(wall);
  let headOnImpacts = 0;
  headOn.onImpact = () => { headOnImpacts++; };
  headOn.takeManualControl(); headOn.setCockpitCollision(true);
  for (let i = 0; i < 12 && headOnImpacts === 0; i++) headOn.update(FLIGHT.fixedStep, neutral);
  assert.equal(headOn.mode, 'manual');
  assert.equal(headOnImpacts, 1, 'cockpit assistance never disables collision response');
});
