import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { ImpactSystem } from '../src/combat/ImpactSystem.ts';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { PulseCannonSystem } from '../src/combat/PulseCannonSystem.ts';
import { RockLibrary } from '../src/combat/geometry.ts';
import { DEFAULT_COMBAT } from '../src/combat/settings.ts';

const air = {
  densityAt: () => -1000,
  sample: () => ({
    x: 0, y: 0, tangentX: 0, tangentY: 0, openness: 1,
    width: 100, height: 100, floorY: -100,
  }),
};

test('Pulse Cannon snapshots a 480 m shot whose 60 m capsule reaches both visual ends', () => {
  const pulse = new PulseCannonSystem();
  const muzzle = new Vector3(10, 20, 30);
  const aim = new Vector3(110, 20, 1030);
  pulse.requestFire();
  const shot = pulse.tryFire(muzzle, aim)!;
  assert.ok(shot);
  assert.equal(shot.radius, 60);
  assert.ok(Math.abs(shot.visualStart.distanceTo(shot.visualEnd) - 480) < 1e-9);
  assert.ok(Math.abs(shot.visualStart.distanceTo(shot.carveStart) - 60) < 1e-9);
  assert.ok(Math.abs(shot.visualStart.distanceTo(shot.carveEnd) - 420) < 1e-9);
  assert.ok(Math.abs(shot.carveStart.distanceTo(shot.carveEnd) - 360) < 1e-9);
  assert.equal(pulse.visualActive, true);
  assert.equal(pulse.ready, false);
  pulse.update(DEFAULT_COMBAT.pulseDuration);
  assert.equal(pulse.visualActive, false);
  pulse.update(DEFAULT_COMBAT.pulseCooldown - DEFAULT_COMBAT.pulseDuration);
  assert.equal(pulse.ready, true);
});

test('Pulse Cannon rejects invalid, disabled, cooling, and terrain-busy requests without false activations', () => {
  const pulse = new PulseCannonSystem();
  const muzzle = new Vector3();
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, muzzle), undefined);
  assert.equal(pulse.ready, true);
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, new Vector3(0, 0, 1), false), undefined);
  assert.equal(pulse.ready, true);
  pulse.configure({ ...DEFAULT_COMBAT, pulseEnabled: false });
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, new Vector3(0, 0, 1)), undefined);
  pulse.configure({ ...DEFAULT_COMBAT, pulseRange: 800, pulseRadius: 80 });
  pulse.requestFire();
  const shot = pulse.tryFire(muzzle, new Vector3(0, 0, 1))!;
  assert.equal(shot.visualEnd.z, 800);
  assert.equal(shot.radius, 80);
  pulse.requestFire();
  assert.equal(pulse.tryFire(muzzle, new Vector3(0, 0, 1)), undefined);
  pulse.reset();
  assert.equal(pulse.ready, true);
  assert.equal(pulse.visualActive, false);
});

test('meteor capsule hits include sides, tangency, and rounded ends while misses survive', () => {
  const library = new RockLibrary('pulse-capsule');
  const meteors = new MeteorSystem(air, library, 'pulse-capsule');
  let callbacks = 0;
  meteors.onDestroyed = () => { callbacks += 1; };
  const side = meteors.spawnAt(new Vector3(0, 0, 240), 12, 0)!;
  side.position.x = 60 + side.radius;
  const nearCap = meteors.spawnAt(new Vector3(0, 0, 0), 12, 1)!;
  const farCap = meteors.spawnAt(new Vector3(0, 0, 480), 12, 2)!;
  const miss = meteors.spawnAt(new Vector3(0, 0, 240), 12, 3)!;
  miss.position.x = 60 + miss.radius + 0.001;
  const destroyed = meteors.destroyInCapsule(
    new Vector3(0, 0, 60),
    new Vector3(0, 0, 420),
    60,
    new Vector3(0, 0, 1),
  );
  assert.equal(destroyed, 3);
  assert.equal(callbacks, 3);
  assert.equal(side.active, false);
  assert.equal(nearCap.active, false);
  assert.equal(farCap.active, false);
  assert.equal(miss.active, true);
  assert.equal(meteors.destroyInCapsule(new Vector3(), new Vector3(), -1, new Vector3()), 0);
  meteors.dispose();
  library.dispose();
});

test('a maximum Pulse burst destroys 48 meteors once and fills bounded cosmetic pools', () => {
  const library = new RockLibrary('pulse-burst');
  const meteors = new MeteorSystem(air, library, 'pulse-burst');
  const impacts = new ImpactSystem(library, 'pulse-burst');
  impacts.configure({ ...DEFAULT_COMBAT, fragmentCount: 12 });
  meteors.onDestroyed = (rock, point, direction) => impacts.spawn(rock, point, direction);
  for (let index = 0; index < 48; index += 1) {
    const angle = index * Math.PI * 2 / 48;
    meteors.spawnAt(
      new Vector3(Math.cos(angle) * 30, Math.sin(angle) * 30, 80 + index * 6),
      12,
      index % library.variants.length,
    );
  }
  const destroyed = meteors.destroyInCapsule(
    new Vector3(0, 0, 60),
    new Vector3(0, 0, 420),
    60,
    new Vector3(0, 0, 1),
  );
  assert.equal(destroyed, 48);
  assert.equal(meteors.activeCount, 0);
  assert.equal(impacts.explosions.filter((entry) => entry.active).length, 48);
  assert.equal(impacts.fragments.filter((entry) => entry.active).length, 576);
  assert.equal(meteors.destroyInCapsule(new Vector3(0, 0, 60), new Vector3(0, 0, 420), 60, new Vector3(0, 0, 1)), 0);
  impacts.dispose();
  meteors.dispose();
  library.dispose();
});
