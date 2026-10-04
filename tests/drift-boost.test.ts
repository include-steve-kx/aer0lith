import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { FLIGHT } from '../src/core/config.ts';
import type { FlightInput } from '../src/core/types.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { DEFAULT_FLIGHT_TUNING } from '../src/flight/FlightTuning.ts';
import { buildSlipCurveLookup, evaluateSlipCurve } from '../src/flight/SlipResponse.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const neutral: FlightInput = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };

function openTerrain(): ProceduralTerrain {
  return {
    sample: () => ({ x: 0, y: 50, floorY: -150, tangentX: 0, tangentY: 0,
      width: 500, height: 500, openness: 1 }),
    densityAt: () => -100,
    collisionDensityAt: () => -100,
  } as unknown as ProceduralTerrain;
}

function manualFlight(overrides: Partial<typeof DEFAULT_FLIGHT_TUNING> = {}): FlightController {
  const flight = new FlightController(openTerrain());
  flight.configure({ ...DEFAULT_FLIGHT_TUNING, ...overrides });
  flight.takeManualControl();
  return flight;
}

function forceMaximumSlip(flight: FlightController, seconds: number): void {
  for (let step = 0; step < seconds / FLIGHT.fixedStep; step += 1) {
    flight.controlVelocity.set(130, 0, 0);
    flight.speed = 130;
    flight.update(FLIGHT.fixedStep, neutral);
  }
}

test('curve presets retain exact endpoints and distinct midpoint response', () => {
  const curve = (preset: 's-curve' | 'linear' | 'early-plateau') => buildSlipCurveLookup({
    preset, x1: 1 / 3, y1: 0, x2: 2 / 3, y2: 1,
  });
  const smooth = curve('s-curve');
  const linear = curve('linear');
  const plateau = curve('early-plateau');
  for (const lookup of [smooth, linear, plateau]) {
    assert.equal(evaluateSlipCurve(lookup, 0), 0);
    assert.equal(evaluateSlipCurve(lookup, 1), 1);
  }
  assert.ok(Math.abs(evaluateSlipCurve(linear, 0.5) - 0.5) < 1e-4);
  assert.ok(Math.abs(evaluateSlipCurve(smooth, 0.5) - 0.5) < 1e-4);
  assert.ok(evaluateSlipCurve(smooth, 0.1) < evaluateSlipCurve(linear, 0.1));
  assert.ok(evaluateSlipCurve(plateau, 0.25) > evaluateSlipCurve(linear, 0.25));
});

test('automatic slip fills the default bank in about five seconds without a drift input', () => {
  const flight = manualFlight();
  forceMaximumSlip(flight, 5);
  assert.ok(flight.driftEnergy > 99.5, `expected a full bank, got ${flight.driftEnergy}`);
  assert.equal(flight.energyActivity, 'charging');
  assert.equal(flight.driftTier, 3);
  assert.ok(flight.slipSpeed >= flight.settings.slipFullSpeed);
  assert.ok(flight.driftAngle > 45);
});

test('explosion velocity contributes to automatic slip and energy in manual and autopilot', () => {
  for (const manual of [false, true]) {
    const flight = new FlightController(openTerrain());
    if (manual) flight.takeManualControl();
    flight.applyExternalImpulse(new Vector3(140, 0, 0), 2);
    flight.update(FLIGHT.fixedStep, neutral);
    flight.update(FLIGHT.fixedStep, neutral);
    assert.ok(flight.slipIntensity > 0.9);
    assert.ok(flight.driftEnergy > 0);
    assert.equal(flight.energyActivity, 'charging');
  }
});

test('dodge and collision-suppressed controllable slip cannot manufacture energy', () => {
  const rolling = manualFlight({ slipStartSpeed: 0, slipFullSpeed: 5 });
  rolling.startRoll(1);
  rolling.controlVelocity.set(130, 0, 0);
  rolling.speed = 130;
  rolling.update(FLIGHT.fixedStep, neutral);
  assert.equal(rolling.currentChargeRate, 0);
  assert.equal(rolling.driftEnergy, 0);

  const contact = manualFlight({ slipStartSpeed: 0, slipFullSpeed: 5 });
  (contact as unknown as { collisionChargeSuppression: number }).collisionChargeSuppression = 0.35;
  contact.controlVelocity.set(130, 0, 0);
  contact.speed = 130;
  contact.update(FLIGHT.fixedStep, neutral);
  assert.equal(contact.currentChargeRate, 0);
  assert.ok(contact.slipIntensity > 0.9, 'collision slip remains available to visuals');
});

test('stored energy enters one drift boost, drains through tiers, and falls back to normal boost', () => {
  const flight = manualFlight({ slipChargeRate: 29 });
  forceMaximumSlip(flight, 3.5);
  const startingEnergy = flight.driftEnergy;
  flight.controlVelocity.set(0, 0, flight.speed);
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true, boostPressed: true });
  assert.equal(flight.boostState, 'drift-boost');
  assert.equal(flight.boostKickAvailable, false);
  assert.ok(flight.driftEnergy < startingEnergy);
  let sawTwo = false;
  let sawOne = false;
  for (let step = 0; step < 10 * 120; step += 1) {
    flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true });
    sawTwo ||= flight.driftTier === 2;
    sawOne ||= flight.driftTier === 1;
    if (String(flight.boostState) === 'normal-boost') break;
  }
  assert.ok(sawTwo && sawOne);
  assert.equal(flight.boostState, 'normal-boost');
  assert.equal(flight.driftEnergy, 0);
});

test('normal boost waits for a release and quick re-press before upgrading', () => {
  const flight = manualFlight({ slipStartSpeed: 0, slipFullSpeed: 5 });
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true, boostPressed: true });
  assert.equal(flight.boostState, 'normal-boost');
  for (let step = 0; step < 30; step += 1) {
    flight.controlVelocity.set(130, 0, 0);
    flight.speed = 130;
    flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true });
  }
  assert.ok(flight.driftEnergy > 0);
  assert.equal(flight.boostState, 'normal-boost', 'held boost never upgrades itself');
  flight.update(FLIGHT.fixedStep, { ...neutral, boostHeld: false, boostReleased: true });
  assert.equal(flight.boostState, 'normal-boost', 'release latch preserves thrust');
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true, boostPressed: true });
  assert.equal(flight.boostState, 'drift-boost');
});

test('drift boost releases immediately while an expired normal latch returns to cruise', () => {
  const flight = manualFlight();
  flight.driftEnergy = 20;
  flight.configure(flight.settings);
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true, boostPressed: true });
  assert.equal(flight.boostState, 'drift-boost');
  flight.update(FLIGHT.fixedStep, { ...neutral, boostHeld: false, boostReleased: true });
  assert.equal(flight.boostState, 'cruise');

  flight.boostState = 'normal-boost';
  flight.update(FLIGHT.fixedStep, { ...neutral, boostHeld: false, boostReleased: true });
  assert.equal(flight.boostState, 'normal-boost');
  for (let step = 0; step < 30; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.boostState, 'cruise');
});

test('banked energy observes grace then naturally decays', () => {
  const flight = manualFlight({ driftGraceTime: 0.1, driftPassiveDecay: 20 });
  forceMaximumSlip(flight, FLIGHT.fixedStep);
  flight.driftEnergy = 50;
  flight.controlVelocity.set(0, 0, 130);
  flight.speed = 130;
  flight.configure(flight.settings);
  for (let step = 0; step < 0.08 / FLIGHT.fixedStep; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.equal(flight.driftEnergy, 50);
  for (let step = 0; step < 0.5 / FLIGHT.fixedStep; step += 1) flight.update(FLIGHT.fixedStep, neutral);
  assert.ok(flight.driftEnergy < 42);
  assert.equal(flight.energyActivity, 'decaying');
});

test('one kick is available per earned bank and reholding cannot duplicate it', () => {
  const flight = manualFlight({
    slipStartSpeed: 0, slipFullSpeed: 5, slipChargeRate: 20,
    driftBoostKickOne: 20, driftBoostKickTwo: 20, driftBoostKickThree: 20,
    driftBoostAccelerationOne: 0, driftBoostAccelerationTwo: 0, driftBoostAccelerationThree: 0,
  });
  forceMaximumSlip(flight, 0.2);
  assert.equal(flight.boostKickAvailable, true);
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true, boostPressed: true });
  assert.equal(flight.boostKickAvailable, false);
  flight.update(FLIGHT.fixedStep, { ...neutral, boostHeld: false, boostReleased: true });
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true, boostPressed: true });
  assert.equal(flight.boostKickAvailable, false);
});

test('reset clears automatic slip, bank, propulsion, and latches', () => {
  const flight = manualFlight();
  forceMaximumSlip(flight, 0.5);
  flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1, boostHeld: true, boostPressed: true });
  flight.reset();
  assert.equal(flight.driftEnergy, 0);
  assert.equal(flight.slipIntensity, 0);
  assert.equal(flight.visualSlipIntensity, 0);
  assert.equal(flight.boostState, 'cruise');
  assert.equal(flight.energyActivity, 'idle');
});

test('autopilot toggles preserve bank and velocity while using the same explosion charging rule', () => {
  const flight = manualFlight();
  flight.driftEnergy = 25;
  const velocity = flight.controlVelocity.clone();
  flight.toggleAutopilot();
  assert.equal(flight.mode, 'autopilot');
  assert.equal(flight.driftEnergy, 25);
  assert.ok(flight.controlVelocity.equals(velocity));
  flight.applyExternalImpulse(new Vector3(140, 0, 0), 2);
  flight.update(FLIGHT.fixedStep, neutral);
  flight.update(FLIGHT.fixedStep, neutral);
  assert.ok(flight.driftEnergy > 25);
});
