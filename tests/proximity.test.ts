import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { RockLibrary } from '../src/combat/geometry.ts';
import { DEFAULT_COMBAT, migrateCombatSettings, sanitizeCombatSettings, METEOR_CONTROLS, MISSILE_CONTROLS, DESTRUCTION_CONTROLS, PULSE_CONTROLS, BULLET_CONTROLS } from '../src/combat/settings.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { FLIGHT } from '../src/core/config.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const air = { densityAt: () => -1000, collisionDensityAt: () => -1000,
  sample: () => ({ x: 0, y: 0, tangentX: 0, tangentY: 0, openness: 1, width: 200, height: 200, floorY: -100 }) };
const library = new RockLibrary('proximity-tests');
const q = new Quaternion();
const zero = new Vector3();
test.after(() => library.dispose());

test('surface entry arms a sampled fuse that explodes once after its delay even if the ship leaves', () => {
  const system = new MeteorSystem(air, library, 'fuse');
  system.configure({
    ...DEFAULT_COMBAT,
    meteorMinTriggerDistance: 50,
    meteorMaxTriggerDistance: 50,
    meteorMinFuseDelay: 1,
    meteorMaxFuseDelay: 1,
  });
  const rock = system.spawnAt(zero, 24, 0)!;
  const handle = { slot: 0, generation: rock.generation };
  rock.reserved = 2;
  assert.equal(rock.proximityTriggerDistance, 50);
  assert.equal(rock.proximityDelay, 1);
  const edge = new Vector3(0, 0, rock.radius + rock.proximityTriggerDistance);
  let destroyed = 0;
  system.onDestroyed = (snapshot, center) => { destroyed++; assert.ok(center.equals(zero)); assert.equal(snapshot.diameter, 24); };
  system.updateProximity(0, edge, edge, q);
  assert.equal(rock.fuseArmed, false, 'pause cannot arm or age nearby meteors');
  system.updateProximity(0.25, edge, edge, q);
  assert.equal(rock.fuseArmed, true);
  assert.ok(Math.abs(rock.fuseRemaining - 0.75) < 1e-9);
  const farAway = new Vector3(0, 0, 500);
  system.updateProximity(0.5, farAway, farAway, q);
  assert.equal(rock.active, true);
  assert.ok(Math.abs(rock.fuseRemaining - 0.25) < 1e-9);
  system.updateProximity(0.25, farAway, farAway, q);
  assert.equal(destroyed, 1);
  assert.equal(system.resolve(handle), undefined);
  assert.equal(rock.reserved, -1);
  system.updateProximity(1 / 120, farAway, farAway, q);
  assert.equal(destroyed, 1);
});

test('relative proximity sweep catches fast dodges and moving rocks, while disabled fuse is inert', () => {
  const system = new MeteorSystem(air, library, 'sweep');
  system.configure({ ...DEFAULT_COMBAT, meteorProximityEnabled: false });
  let rock = system.spawnAt(zero, 12, 0)!;
  system.updateProximity(1 / 120, new Vector3(-200, 0, 0), new Vector3(200, 0, 0), q);
  assert.equal(rock.active, true);
  assert.equal(rock.fuseArmed, false);
  system.configure({ ...DEFAULT_COMBAT, meteorMinFuseDelay: 0, meteorMaxFuseDelay: 0 });
  rock.proximityDelay = 0;
  system.updateProximity(1 / 120, new Vector3(-200, 0, 0), new Vector3(200, 0, 0), q);
  assert.equal(rock.active, false);
  rock = system.spawnAt(new Vector3(200, 0, 0), 12, 0)!;
  rock.previous.set(-200, 0, 0);
  system.updateProximity(1 / 120, zero, zero, q);
  assert.equal(rock.active, false);
});

test('spawned meteors retain sampled lifecycle values while later settings affect new rocks', () => {
  const system = new MeteorSystem(air, library, 'sampled-fuses');
  system.configure({
    ...DEFAULT_COMBAT,
    meteorMinTriggerDistance: 50,
    meteorMaxTriggerDistance: 50,
    meteorMinFuseDelay: 2,
    meteorMaxFuseDelay: 2,
  });
  const first = system.spawnAt(zero, 12, 0)!;
  system.configure({
    ...DEFAULT_COMBAT,
    meteorMinTriggerDistance: 80,
    meteorMaxTriggerDistance: 80,
    meteorMinFuseDelay: 0,
    meteorMaxFuseDelay: 0,
  });
  const second = system.spawnAt(new Vector3(200, 0, 0), 12, 0)!;
  assert.deepEqual([first.proximityTriggerDistance, first.proximityDelay], [50, 2]);
  assert.deepEqual([second.proximityTriggerDistance, second.proximityDelay], [80, 0]);
  system.reset();
  assert.equal(system.activeCount, 0);
});

test('new defaults fit slider bounds and restoration preserves saved custom settings', () => {
  assert.equal(DEFAULT_COMBAT.explosionShakeRadius, 400);
  assert.equal(DEFAULT_COMBAT.bulletRate, 36);
  assert.equal(DEFAULT_COMBAT.explosionPush, 20);
  assert.equal(DEFAULT_COMBAT.explosionVelocityAxisFactor, 0.5);
  assert.equal(DEFAULT_COMBAT.explosionPushLife, 2);
  assert.equal(DEFAULT_COMBAT.meteorMaxDiameter, 36);
  assert.equal(DEFAULT_COMBAT.meteorMinTriggerDistance, 50);
  assert.equal(DEFAULT_COMBAT.meteorMaxTriggerDistance, 65);
  assert.equal(DEFAULT_COMBAT.meteorMinFuseDelay, 0);
  assert.equal(DEFAULT_COMBAT.meteorMaxFuseDelay, 0.5);
  assert.equal(DEFAULT_COMBAT.meteorColor, '#555b5e');
  assert.equal(DEFAULT_COMBAT.meteorProximityColor, '#ffffff');
  assert.equal(DEFAULT_COMBAT.meteorProximityFalloff, 1);
  assert.equal(DEFAULT_COMBAT.meteorAshColor, '#303638');
  assert.equal('meteorDangerColor' in DEFAULT_COMBAT, false);
  assert.equal(migrateCombatSettings({ meteorColor: '#8b8f92' }).meteorColor, '#555b5e');
  assert.equal(migrateCombatSettings({ meteorColor: '#123456' }).meteorColor, '#123456');
  assert.equal(
    migrateCombatSettings({ meteorArmedColor: '#e8f6f7' } as never).meteorProximityColor,
    '#ffffff',
  );
  assert.equal(
    migrateCombatSettings({ meteorArmedColor: '#123456' } as never).meteorProximityColor,
    '#123456',
  );
  assert.equal(DEFAULT_COMBAT.meteorCount, 12);
  assert.equal(DEFAULT_COMBAT.meteorInterval, 10);
  assert.equal(DEFAULT_COMBAT.meteorSpeed, 6.5);
  assert.equal(DEFAULT_COMBAT.meteorSpin, 40);
  assert.equal(DEFAULT_COMBAT.missileTrailLife, 6);
  const restored = sanitizeCombatSettings({
    explosionShakeRadius: 200,
    meteorMinTriggerDistance: 90,
    meteorMaxTriggerDistance: 40,
    meteorMinFuseDelay: 6,
    meteorMaxFuseDelay: 1,
  });
  assert.equal(restored.explosionShakeRadius, 200);
  assert.equal(restored.meteorMinTriggerDistance, 40);
  assert.equal(restored.meteorMaxTriggerDistance, 40);
  assert.equal(restored.meteorMinFuseDelay, 1);
  assert.equal(restored.meteorMaxFuseDelay, 1);
  assert.equal(DEFAULT_COMBAT.pulseRange, 800);
  assert.equal(DEFAULT_COMBAT.pulseRadius, 40);
  assert.equal(DEFAULT_COMBAT.pulsePlasmaRadius, 8);
  assert.equal(DEFAULT_COMBAT.pulseCooldown, 1);
  assert.equal(DEFAULT_COMBAT.pulseDuration, 0.6);
  assert.equal('pulsePlasmaWidth' in DEFAULT_COMBAT, false);
  const minimumPulseRadii = sanitizeCombatSettings({ pulseRadius: 4, pulsePlasmaRadius: 4 });
  assert.equal(minimumPulseRadii.pulseRadius, 4);
  assert.equal(minimumPulseRadii.pulsePlasmaRadius, 4);
  assert.equal(DEFAULT_COMBAT.pulseShakeStrength, 1.3);
  assert.equal(DEFAULT_COMBAT.pulseShakeFrequency, 20);
  assert.equal(DEFAULT_COMBAT.pulseShakeDuration, 3.6);
  assert.equal(DEFAULT_COMBAT.pulseGlassWidth, 2);
  assert.equal(DEFAULT_COMBAT.pulseElectricStrength, 2);
  assert.equal(DEFAULT_COMBAT.pulseElectricTravelTime, 0.7);
  assert.equal(DEFAULT_COMBAT.pulseElectricSpread, 1.3);
  assert.equal(DEFAULT_COMBAT.pulseElectricTrail, 0.19);
  assert.equal(DEFAULT_COMBAT.pulseBeamLightIntensity, 175);
  assert.equal(DEFAULT_COMBAT.pulseBeamLightRange, 100);
  assert.equal(DEFAULT_COMBAT.pulseElectricLightIntensity, 875);
  assert.equal(DEFAULT_COMBAT.pulseElectricLightRange, 210);
  assert.equal(DEFAULT_COMBAT.pulseRefraction, 1.65);
  assert.equal(DEFAULT_COMBAT.pulseDispersion, 0.8);
  assert.equal(DEFAULT_COMBAT.pulseTerrainTintStrength, 0.55);
  assert.equal(DEFAULT_COMBAT.pulseTerrainTintWidth, 18);
  const restoredDebug = sanitizeCombatSettings({
    pulsePlasmaDebug: true,
    pulseGlassDebug: true,
    pulseElectricDebug: true,
  }, true);
  assert.equal(restoredDebug.pulsePlasmaDebug, false);
  assert.equal(restoredDebug.pulseGlassDebug, false);
  assert.equal(restoredDebug.pulseElectricDebug, false);
  for (const [key, , min, max, step] of [...METEOR_CONTROLS, ...MISSILE_CONTROLS, ...DESTRUCTION_CONTROLS, ...PULSE_CONTROLS, ...BULLET_CONTROLS]) {
    const value = DEFAULT_COMBAT[key];
    if (typeof value !== 'number') continue;
    assert.ok(value >= min! && value <= max!, key);
    const steps = (value - min!) / step!;
    assert.ok(Math.abs(steps - Math.round(steps)) < 1e-8, `${key} must be representable by its slider`);
  }
});

test('manual and autopilot cruise at 90 on a straight route and boost still caps at 120', () => {
  assert.equal(FLIGHT.nominalSpeed, 90);
  const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
  for (const manual of [false, true]) {
    const flight = new FlightController(air as unknown as ProceduralTerrain);
    if (manual) flight.takeManualControl();
    for (let i = 0; i < 1200; i++) flight.update(FLIGHT.fixedStep, neutral);
    assert.ok(Math.abs(flight.speed - 90) < 1e-8);
    for (let i = 0; i < 1200; i++) flight.update(FLIGHT.fixedStep, { ...neutral, throttle: 1 });
    assert.equal(flight.speed, 120);
    assert.equal(flight.mode, manual ? 'manual' : 'autopilot');
  }
});
