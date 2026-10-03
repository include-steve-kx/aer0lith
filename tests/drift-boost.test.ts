import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { FLIGHT } from '../src/core/config.ts';
import type { FlightInput } from '../src/core/types.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { HoldAction } from '../src/flight/HoldAction.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const neutral: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

function openTerrain(): ProceduralTerrain {
  return {
    sample: () => ({ x: 0, y: 50, floorY: -150, tangentX: 0, tangentY: 0,
      width: 10000, height: 10000, openness: 1 }),
    densityAt: () => -1000,
    collisionDensityAt: () => -1000,
  } as unknown as ProceduralTerrain;
}

function earnEnergy(flight: FlightController, seconds = 4): void {
  flight.takeManualControl();
  const drift: FlightInput = {
    ...neutral,
    roll: -1,
    yaw: 1,
    driftHeld: true,
  };
  for (let step = 0; step < seconds / FLIGHT.fixedStep; step += 1) {
    flight.update(FLIGHT.fixedStep, drift);
  }
  flight.update(FLIGHT.fixedStep, neutral);
}

test('hold actions merge sources and emit one edge without tap locking', () => {
  const action = new HoldAction();
  action.setHeld('keyboard', true);
  action.setHeld('keyboard', true);
  assert.equal(action.active, true);
  assert.equal(action.consumePressed(), true);
  assert.equal(action.consumePressed(), false);
  action.setHeld('touch', true);
  action.setHeld('keyboard', false);
  assert.equal(action.active, true);
  assert.equal(action.consumeReleased(), false);
  action.setHeld('touch', false);
  assert.equal(action.active, false);
  assert.equal(action.consumeReleased(), true);
});

test('drift angle is nose versus controllable velocity and charges three-tier energy', () => {
  const flight = new FlightController(openTerrain());
  earnEnergy(flight, 4);
  assert.ok(flight.driftAngle > flight.settings.driftMinAngle);
  assert.ok(flight.driftEnergy > 70, `expected tier III energy, got ${flight.driftEnergy}`);
  assert.equal(flight.driftTier, 3);
  assert.equal(flight.driftState, 'banked');

  const control = new FlightController(openTerrain());
  earnEnergy(control, 4);
  const energy = flight.driftEnergy;
  flight.applyExternalImpulse(new Vector3(180, 0, 0), 1);
  flight.update(FLIGHT.fixedStep, neutral);
  control.update(FLIGHT.fixedStep, neutral);
  assert.ok(Math.abs(flight.driftAngle - control.driftAngle) < 1e-8, 'blast displacement is excluded from drift angle');
  assert.ok(flight.driftEnergy <= energy, 'blast cannot create drift energy');
});

test('one boost hold selects, drains, and live-downgrades the earned tier', () => {
  const flight = new FlightController(openTerrain());
  earnEnergy(flight, 4);
  const startEnergy = flight.driftEnergy;
  const boost = { ...neutral, throttle: 1, boostHeld: true };
  flight.update(FLIGHT.fixedStep, boost);
  assert.equal(flight.driftState, 'drift-boost');
  assert.equal(flight.boostKickAvailable, false);
  assert.ok(flight.driftEnergy < startEnergy);
  assert.ok(flight.speed > FLIGHT.nominalSpeed);

  let sawTierTwo = false;
  let sawTierOne = false;
  const currentState = () => flight.driftState;
  for (let step = 0; step < 8 / FLIGHT.fixedStep; step += 1) {
    flight.update(FLIGHT.fixedStep, boost);
    sawTierTwo ||= flight.driftTier === 2;
    sawTierOne ||= flight.driftTier === 1;
    if (currentState() === 'normal-boost') break;
  }
  assert.equal(sawTierTwo, true);
  assert.equal(sawTierOne, true);
  assert.equal(flight.driftState, 'normal-boost');
  assert.equal(flight.driftEnergy, 0);
  assert.ok(flight.speed <= flight.settings.driftBoostSpeedThree + 10);
});

test('reholding cannot repeat a bank ignition kick', () => {
  const flight = new FlightController(openTerrain());
  flight.configure({
    ...flight.settings,
    driftBoostKickOne: 20,
    driftBoostKickTwo: 20,
    driftBoostKickThree: 20,
    driftBoostAccelerationOne: 0,
    driftBoostAccelerationTwo: 0,
    driftBoostAccelerationThree: 0,
  });
  earnEnergy(flight, 3);
  const boost = { ...neutral, throttle: 1, boostHeld: true };
  flight.update(FLIGHT.fixedStep, boost);
  const afterKick = flight.speed;
  assert.equal(flight.boostKickAvailable, false, 'first hold consumes the armed kick');
  flight.update(FLIGHT.fixedStep, neutral);
  const beforeRehold = flight.speed;
  flight.update(FLIGHT.fixedStep, boost);
  const reholdGain = flight.speed - beforeRehold;
  assert.ok(reholdGain < 0.01, 'rehold does not receive another ignition kick');
  assert.ok(Number.isFinite(afterKick));
});

test('drift cancels boost, clears its bank, and suppresses held boost until repress', () => {
  const flight = new FlightController(openTerrain());
  earnEnergy(flight, 3);
  const boost = { ...neutral, throttle: 1, boostHeld: true };
  flight.update(FLIGHT.fixedStep, boost);
  assert.equal(flight.driftState, 'drift-boost');

  flight.update(FLIGHT.fixedStep, { ...boost, driftHeld: true });
  assert.equal(flight.driftState, 'drift');
  assert.ok(flight.driftEnergy < 0.5, 'old bank is cleared before the fresh drift starts charging');
  flight.update(FLIGHT.fixedStep, { ...boost, driftHeld: false });
  assert.notEqual(flight.driftState, 'normal-boost', 'held K stays suppressed');
  flight.update(FLIGHT.fixedStep, neutral);
  flight.update(FLIGHT.fixedStep, boost);
  assert.equal(flight.driftState, 'drift-boost', 'freshly earned energy is selected after K is re-pressed');
});

test('passive energy grace and decay advance only with simulation time', () => {
  const flight = new FlightController(openTerrain());
  earnEnergy(flight, 2);
  const banked = flight.driftEnergy;
  flight.update(0, neutral);
  assert.equal(flight.driftEnergy, banked);
  for (let step = 0; step < 0.3 / FLIGHT.fixedStep; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.driftEnergy, banked);
  for (let step = 0; step < 0.3 / FLIGHT.fixedStep; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.ok(flight.driftEnergy < banked);
});

test('tier-speed terrain sweep catches a thin wall between fixed-step endpoints', () => {
  const terrain = {
    sample: () => ({ x: 0, y: 50, floorY: -150, tangentX: 0, tangentY: 0,
      width: 10000, height: 10000, openness: 1 }),
    densityAt: (_x: number, _y: number, z: number) => Math.abs(z - 2.1) < 0.04 ? 2 : -1000,
    collisionDensityAt: (_x: number, _y: number, z: number) => Math.abs(z - 2.1) < 0.04 ? 2 : -1000,
  } as unknown as ProceduralTerrain;
  const flight = new FlightController(terrain);
  flight.takeManualControl();
  flight.speed = 180;
  flight.controlVelocity.set(0, 0, 180);
  flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.mode, 'crashed');
});
