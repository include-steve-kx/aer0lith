import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { RockLibrary } from '../src/combat/geometry.ts';
import { DEFAULT_COMBAT, sanitizeCombatSettings, METEOR_CONTROLS, MISSILE_CONTROLS, DESTRUCTION_CONTROLS, PULSE_CONTROLS, BULLET_CONTROLS } from '../src/combat/settings.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { FLIGHT } from '../src/core/config.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';

const air = { densityAt: () => -1000, collisionDensityAt: () => -1000,
  sample: () => ({ x: 0, y: 0, tangentX: 0, tangentY: 0, openness: 1, width: 200, height: 200, floorY: -100 }) };
const library = new RockLibrary('proximity-tests');
const q = new Quaternion();
const zero = new Vector3();
test.after(() => library.dispose());

test('proximity tint reaches full intensity at the surface fuse and destroys exactly once without scanning', () => {
  const system = new MeteorSystem(air, library, 'fuse');
  const rock = system.spawnAt(zero, 24, 0)!;
  const handle = { slot: 0, generation: rock.generation };
  rock.reserved = 2;
  const trigger = system.settings.meteorTriggerDistance;
  system.shipPosition.set(0, 0, rock.radius + trigger * 3);
  assert.equal(system.dangerIntensity(rock), 0);
  system.shipPosition.set(0, 0, rock.radius + trigger * 2);
  assert.ok(Math.abs(system.dangerIntensity(rock) - 0.5) < 1e-9);
  const edge = new Vector3(0, 0, rock.radius + trigger);
  system.shipPosition.copy(edge);
  assert.equal(system.dangerIntensity(rock), 1);
  let destroyed = 0;
  system.onDestroyed = (snapshot, center) => { destroyed++; assert.ok(center.equals(zero)); assert.equal(snapshot.diameter, 24); };
  system.updateProximity(0, edge, edge, q);
  assert.equal(rock.active, true, 'pause cannot explode nearby meteors');
  system.updateProximity(1 / 120, edge, edge, q);
  assert.equal(destroyed, 1);
  assert.equal(system.resolve(handle), undefined);
  assert.equal(rock.reserved, -1);
  system.updateProximity(1 / 120, edge, edge, q);
  assert.equal(destroyed, 1);
});

test('relative proximity sweep catches fast dodges and moving rocks, while disabled fuse is inert', () => {
  const system = new MeteorSystem(air, library, 'sweep');
  let rock = system.spawnAt(zero, 12, 0)!;
  system.configure({ ...DEFAULT_COMBAT, meteorProximityEnabled: false });
  system.updateProximity(1 / 120, new Vector3(-200, 0, 0), new Vector3(200, 0, 0), q);
  assert.equal(rock.active, true);
  assert.equal(system.dangerIntensity(rock), 0);
  system.configure({ ...DEFAULT_COMBAT });
  system.updateProximity(1 / 120, new Vector3(-200, 0, 0), new Vector3(200, 0, 0), q);
  assert.equal(rock.active, false);
  rock = system.spawnAt(new Vector3(200, 0, 0), 12, 0)!;
  rock.previous.set(-200, 0, 0);
  system.updateProximity(1 / 120, zero, zero, q);
  assert.equal(rock.active, false);
});

test('danger appearance edits remain live without advancing or exploding paused rocks', () => {
  const system = new MeteorSystem(air, library, 'paused');
  const rock = system.spawnAt(zero, 12, 0)!;
  system.shipPosition.set(0, 0, rock.radius + 60);
  const before = system.dangerIntensity(rock);
  system.configure({ ...DEFAULT_COMBAT, meteorTriggerDistance: 60 });
  assert.ok(system.dangerIntensity(rock) > before);
  assert.equal(rock.active, true);
  system.reset();
  assert.equal(system.activeCount, 0);
});

test('new defaults fit slider bounds and restoration preserves saved custom settings', () => {
  assert.equal(DEFAULT_COMBAT.explosionShakeRadius, 400);
  assert.equal(DEFAULT_COMBAT.bulletRate, 36);
  assert.equal(DEFAULT_COMBAT.explosionPush, 30);
  assert.equal(DEFAULT_COMBAT.explosionVelocityAxisFactor, 0.5);
  assert.equal(DEFAULT_COMBAT.explosionPushLife, 2);
  assert.equal(DEFAULT_COMBAT.meteorMaxDiameter, 36);
  assert.equal(DEFAULT_COMBAT.meteorCount, 12);
  assert.equal(DEFAULT_COMBAT.missileTrailLife, 6);
  const restored = sanitizeCombatSettings({ explosionShakeRadius: 200, meteorTriggerDistance: NaN });
  assert.equal(restored.explosionShakeRadius, 200);
  assert.equal(restored.meteorTriggerDistance, 50);
  assert.equal(DEFAULT_COMBAT.pulseRange, 480);
  assert.equal(DEFAULT_COMBAT.pulseRadius, 60);
  assert.equal(DEFAULT_COMBAT.pulseCooldown, 5);
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
