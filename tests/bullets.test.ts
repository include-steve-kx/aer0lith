import assert from "node:assert/strict";
import test from "node:test";
import { PerspectiveCamera, Quaternion, Vector3 } from "three";
import { BulletAim, BulletSystem } from "../src/combat/BulletSystem.ts";
import { BulletView } from "../src/combat/BulletView.ts";
import { MeteorSystem } from "../src/combat/MeteorSystem.ts";
import { MissileSystem } from "../src/combat/MissileSystem.ts";
import { ImpactSystem } from "../src/combat/ImpactSystem.ts";
import {
  ProjectileResolver,
  type ProjectileOwner,
} from "../src/combat/ProjectileResolver.ts";
import { RockLibrary } from "../src/combat/geometry.ts";
import { CombatRandom } from "../src/combat/random.ts";
import {
  DEFAULT_COMBAT,
  sanitizeCombatSettings,
} from "../src/combat/settings.ts";
import { FlightController } from "../src/flight/FlightController.ts";
import type { ProceduralTerrain } from "../src/world/TerrainModel.ts";
import { FLIGHT } from "../src/core/config.ts";
import { WING_TIPS } from "../src/core/aircraftGeometry.ts";
const zero = new Vector3(),
  q = new Quaternion(),
  forward = new Vector3(0, 0, 1);
const air = {
  densityAt: () => -1000,
  collisionDensityAt: (_x: number, _y: number, _z: number) => -1000,
  sample: () => ({
    x: 0,
    y: 0,
    tangentX: 0,
    tangentY: 0,
    openness: 1,
    width: 100,
    height: 100,
    floorY: -100,
  }),
};
const library = new RockLibrary("bullet-tests");
const neutral = { pitch: 0, yaw: 0, roll: 0, throttle: 0 };
function setup(terrain = air) {
  const meteors = new MeteorSystem(terrain, library, "bullets"),
    bullets = new BulletSystem(meteors, "bullets");
  return { meteors, bullets };
}
test("nominal aim intersects cross ray, clamps rear orbit, and survives missed sphere and zero cone", () => {
  const aim = new BulletAim();
  aim.update(zero, q, new Vector3(0, 8, -22), forward, 400, 20);
  assert.ok(Math.abs(aim.point.length() - 400) < 1e-8);
  assert.equal(aim.point.y, 8);
  aim.update(zero, q, new Vector3(), new Vector3(0, 0, -1), 400, 20);
  assert.ok(aim.direction.angleTo(forward) <= Math.PI / 9 + 1e-9);
  aim.update(zero, q, new Vector3(1000, 0, 0), forward, 100, 20);
  assert.deepEqual(aim.point.toArray(), [0, 0, 100]);
  aim.update(zero, q, new Vector3(), new Vector3(1, 0, 0), 400, 0);
  assert.deepEqual(aim.point.toArray(), [0, 0, 400]);
});
test("spread is reproducible, uniform by area, bounded, independent, and zero is exact", () => {
  const aim = new BulletAim(),
    rng = new CombatRandom("spread"),
    duplicate = new CombatRandom("spread"),
    p = new Vector3(),
    other = new Vector3();
  aim.update(zero, q, zero, forward, 400, 20);
  let sum = 0,
    x = 0,
    y = 0;
  const radius = 400 * Math.tan((0.35 * Math.PI) / 180);
  for (let i = 0; i < 10000; i++) {
    aim.sample(zero, 400, 0.35, 20, rng, p);
    aim.sample(zero, 400, 0.35, 20, duplicate, other);
    assert.deepEqual(p, other);
    const r2 = p.x * p.x + p.y * p.y;
    assert.ok(r2 <= radius * radius + 1e-8);
    sum += r2;
    x += p.x;
    y += p.y;
  }
  assert.ok(Math.abs(sum / 10000 / (radius * radius) - 0.5) < 0.015);
  assert.ok(Math.abs(x / 10000) < 0.05 && Math.abs(y / 10000) < 0.05);
  aim.sample(zero, 400, 0, 20, rng, p);
  assert.deepEqual(p, aim.point);
  aim.sample(zero, 400, 2, 0, rng, p);
  assert.deepEqual(p, aim.point);
  aim.update(zero, q, zero, new Vector3(1, 0, 0), 400, 20);
  for (let i = 0; i < 100; i++) {
    aim.sample(zero, 400, 2, 20, rng, p);
    assert.ok(p.angleTo(forward) <= Math.PI / 9 + 1e-9);
  }
});
test("four transformed muzzles and randomized cadence do not depend on spread", () => {
  const a = setup().bullets,
    b = setup().bullets;
  b.configure({ ...DEFAULT_COMBAT, bulletSpread: 2 });
  const sequenceA: number[] = [],
    sequenceB: number[] = [],
    times: number[] = [];
  let last = 0;
  for (let i = 0; i < 1200; i++) {
    a.update(1 / 120, true, zero, q);
    b.update(1 / 120, true, zero, q);
    if (a.shots !== last) {
      const shot = a.bullets.find(
        (v) => v.active && v.birth > a.time - 1 / 120 - 1e-8,
      )!;
      const other = b.bullets.find(
        (v) => v.active && v.birth > b.time - 1 / 120 - 1e-8,
      )!;
      sequenceA.push(shot.wing);
      sequenceB.push(other.wing);
      times.push(shot.birth);
      last = a.shots;
    }
  }
  assert.deepEqual(sequenceA, sequenceB);
  assert.equal(new Set(sequenceA).size, 4);
  assert.ok(sequenceA.some((v, i) => i && v === sequenceA[i - 1]));
  assert.ok(Math.abs(a.shots - DEFAULT_COMBAT.bulletRate * 10) < DEFAULT_COMBAT.bulletRate);
  assert.ok(
    new Set(times.slice(1).map((t, i) => Math.round((t - times[i]) * 10000)))
      .size > 10,
  );
  const rot = new Quaternion().setFromAxisAngle(forward, 1.6),
    ship = new Vector3(100, 20, 700);
  a.sync(ship, rot);
  for (let i = 0; i < 4; i++)
    assert.ok(
      a.muzzles[i].distanceTo(
        new Vector3(...WING_TIPS[i]).applyQuaternion(rot).add(ship),
      ) < 1e-9,
    );
});
test("straight bullet birth properties stay fixed, no paused shots or cooldown bypass, trails detach", () => {
  const { bullets } = setup();
  bullets.update(0.008, true, zero, q);
  const b = bullets.bullets.find((b) => b.active)!;
  assert.ok(b);
  const dir = b.direction.clone();
  const speed = b.speed;
  const shots = bullets.shots;
  bullets.update(0, true, zero, q);
  assert.equal(bullets.shots, shots);
  bullets.update(0.001, false, zero, q);
  bullets.update(0.001, true, zero, q);
  assert.equal(bullets.shots, shots);
  bullets.configure({ ...DEFAULT_COMBAT, bulletSpread: 2, bulletSpeed: 1200 });
  bullets.update(
    0.1,
    false,
    zero,
    new Quaternion().setFromAxisAngle(forward, 2),
  );
  assert.deepEqual(b.direction, dir);
  assert.equal(b.speed, speed);
  for (let i = 0; i < 250; i++) bullets.update(0.01, false, zero, q);
  assert.equal(b.active, false);
  assert.equal(
    bullets.trails.some((t) => t.active),
    false,
  );
});
test("health scales at birth, hits are exactly once, snapshot is independent of recycled slot", () => {
  const { meteors } = setup();
  meteors.configure({ ...DEFAULT_COMBAT, meteorBulletHits: 5 });
  const rock = meteors.spawnAt(new Vector3(0, 0, 100), 18, 0)!;
  assert.equal(rock.health, 8);
  const handle = {
    slot: meteors.rocks.indexOf(rock),
    generation: rock.generation,
  };
  let events = 0;
  meteors.onDestroyed = (snapshot) => {
    events++;
    assert.notEqual(snapshot, rock);
    assert.equal(snapshot.diameter, 18);
  };
  meteors.configure({ ...DEFAULT_COMBAT, meteorBulletHits: 1 });
  assert.equal(rock.health, 8);
  for (let i = 0; i < 7; i++)
    assert.equal(meteors.applyHit(handle, zero, forward), "damaged");
  assert.equal(meteors.applyHit(handle, zero, forward), "destroyed");
  assert.equal(meteors.applyHit(handle, zero, forward), "invalid");
  assert.equal(events, 1);
  meteors.spawnAt(new Vector3(0, 0, 100), 6, 0);
  assert.equal(meteors.resolve(handle), undefined);
});
test("shared resolver orders weapons by impact time and recalculates stale meteor contacts", () => {
  const { meteors } = setup(),
    resolver = new ProjectileResolver(meteors);
  meteors.configure({ ...DEFAULT_COMBAT, meteorBulletHits: 1 });
  meteors.spawnAt(new Vector3(0, 0, 20), 4, 0);
  meteors.spawnAt(new Vector3(0, 0, 40), 4, 0);
  const results: string[] = [];
  const owner: ProjectileOwner = {
    valid: () => true,
    contact: (slot, _t, result) => results.push(`${slot}:${result}`),
  };
  resolver.begin();
  resolver.submit(
    owner,
    0,
    0,
    zero,
    new Vector3(0, 0, 50),
    forward,
    0.1,
    0.5,
    1,
  );
  resolver.submit(owner, 1, 1, zero, new Vector3(0, 0, 30), forward, 0.1);
  resolver.resolve();
  assert.deepEqual(results, ["1:destroyed", "0:destroyed"]);
  assert.equal(meteors.activeCount, 0);
});
test("terrain blocks high speed shots before meteors and bullets hit without scanning", () => {
  const terrain = {
    ...air,
    collisionDensityAt: (_x: number, _y: number, z: number) =>
      z > 10 ? 100 : -1000,
  };
  const { meteors, bullets } = setup(terrain);
  const rock = meteors.spawnAt(new Vector3(0, 0, 100), 36, 0)!;
  for (let i = 0; i < 30; i++) bullets.update(1 / 120, true, zero, q);
  assert.equal(rock.health, rock.maxHealth);
  assert.equal(
    bullets.bullets.some((b) => b.active && b.position.z > 10.1),
    false,
  );
  const open = setup();
  const target = open.meteors.spawnAt(new Vector3(0, 0, 100), 36, 0)!;
  for (let i = 0; i < 120; i++) open.bullets.update(1 / 120, true, zero, q);
  assert.ok(target.health < target.maxHealth);
  assert.equal(target.detected, 0);
});
test("bullet kill invalidates a reserved missile and disabling missiles keeps impacts alive", () => {
  const { meteors, bullets } = setup(),
    impacts = new ImpactSystem(library, "impacts"),
    missiles = new MissileSystem(meteors, "missiles");
  meteors.onDestroyed = (rock, point, direction) =>
    impacts.spawn(rock, point, direction);
  const m = meteors.spawnAt(new Vector3(0, 0, 150), 12, 0)!;
  m.detected = 8;
  missiles.update(0.01, zero, q);
  assert.ok(m.reserved >= 0);
  const handle = { slot: meteors.rocks.indexOf(m), generation: m.generation };
  meteors.applyHit(handle, m.position, forward, true);
  missiles.update(0.01, zero, q);
  assert.equal(
    missiles.missiles.some((m) => m.active),
    false,
  );
  assert.ok(impacts.explosions.some((e) => e.active));
  missiles.configure({ ...DEFAULT_COMBAT, missileEnabled: false });
  assert.ok(impacts.explosions.some((e) => e.active));
  bullets.configure({ ...DEFAULT_COMBAT, bulletEnabled: false });
  assert.ok(impacts.explosions.some((e) => e.active));
});
test("resource exhaustion skips opportunities, reset and disposal clear fixed pools", () => {
  const { bullets } = setup();
  for (const t of bullets.trails) t.active = t.attached = true;
  bullets.update(0.01, true, zero, q);
  assert.equal(bullets.shots, 0);
  assert.equal(bullets.skipped, 1);
  bullets.reset();
  assert.equal(
    bullets.trails.some((t) => t.active),
    false,
  );
  bullets.update(0.01, true, zero, q);
  assert.equal(bullets.shots, 1);
  const view = new BulletView(bullets),
    camera = new PerspectiveCamera();
  camera.position.set(0, 8, -22);
  camera.lookAt(0, 0, 100);
  view.sync(zero, camera, q);
  assert.equal(view.active, true);
  bullets.configure({ ...DEFAULT_COMBAT, muzzleDebug: true });
  view.sync(zero, camera, q);
  assert.equal(view.active, false);
  bullets.configure(DEFAULT_COMBAT);
  view.sync(zero, camera, q);
  assert.equal(view.active, true);
  view.dispose();
  view.dispose();
  bullets.dispose();
  bullets.dispose();
  assert.equal(
    bullets.bullets.some((b) => b.active),
    false,
  );
});
test("blast impulses retain autopilot, combine before clamp, settle exactly and reset", () => {
  const flight = new FlightController(air as unknown as ProceduralTerrain),
    before = flight.position.clone();
  flight.applyExternalImpulse(new Vector3(100, 0, 0));
  flight.applyExternalImpulse(new Vector3(-90, 0, 0));
  flight.update(0.01, neutral);
  assert.equal(flight.mode, "autopilot");
  assert.ok(flight.position.x > before.x);
  assert.ok(flight.externalVelocity.x > 9 && flight.externalVelocity.x < 10);
  flight.applyExternalImpulse(new Vector3(1000, 0, 0));
  flight.update(0.01, neutral);
  assert.ok(Math.abs(flight.externalVelocity.length() - FLIGHT.maxExternalSpeed * (1 - 0.01 / 0.8)) < 1e-8);
  for (let i = 0; i < 120; i++) flight.update(0.01, neutral);
  assert.equal(flight.externalVelocity.length(), 0);
  flight.applyExternalImpulse(new Vector3(10, 0, 0));
  flight.reset();
  flight.update(0.01, neutral);
  assert.equal(flight.externalVelocity.length(), 0);
});
test("blast-displaced autopilot checks terrain and receives frictional contact response", () => {
  const terrain = {
    ...air,
    collisionDensityAt: (x: number) => (x > 6.05 ? 1 : -1000),
  };
  const flight = new FlightController(terrain as unknown as ProceduralTerrain);
  let impact: { normal: Vector3; after: Vector3 } | undefined;
  flight.onImpact = hit => { impact = { normal: hit.normal.clone(), after: hit.relativeVelocityAfter.clone() }; };
  flight.applyExternalImpulse(new Vector3(30, 0, 0));
  flight.update(0.01, neutral);
  assert.equal(flight.mode, "autopilot");
  assert.ok(impact);
  assert.ok(impact.normal.x < -0.9);
  assert.ok(impact.after.dot(impact.normal) > 0);
});
test("new settings preserve old explosion keys and reset nonpersisted debug", () => {
  const settings = sanitizeCombatSettings(
    {
      bulletSpread: Infinity,
      bulletSpeed: 9000,
      muzzleDebug: true,
      explosionShakeRadius: 200,
    },
    true,
  );
  assert.equal(settings.bulletSpread, 0.35);
  assert.equal(settings.bulletSpeed, 1200);
  assert.equal(settings.muzzleDebug, false);
  assert.equal(settings.explosionShakeRadius, 200);
});
test("opposing residual impulse settles without blocking future checkpoints", () => {
  const flight = new FlightController(air as unknown as ProceduralTerrain);
  flight.applyExternalImpulse(new Vector3(12, 0, 0));
  flight.update(0.01, neutral);
  flight.applyExternalImpulse(flight.externalVelocity.clone().negate());
  flight.update(0.01, neutral);
  assert.equal(flight.externalVelocity.length(), 0);
  flight.applyExternalImpulse(new Vector3(0, 2, 0));
  flight.update(0.01, neutral);
  assert.ok(flight.externalVelocity.y > 0);
});
test("detached trails retain world endpoints after slot reuse and origin changes", () => {
  const { bullets } = setup();
  bullets.update(0.008, true, zero, q);
  const b = bullets.bullets.find((b) => b.active)!,
    t = bullets.trails[b.trail];
  bullets.contact(bullets.bullets.indexOf(b), 0.5, "terrain");
  const p = t.origin.clone(),
    d = t.direction.clone(),
    distance = t.distance;
  bullets.cooldown = 0;
  bullets.update(0.008, true, new Vector3(1000, 0, 0), q);
  assert.deepEqual(t.origin, p);
  assert.deepEqual(t.direction, d);
  assert.equal(t.distance, distance);
  assert.equal(t.attached, false);
});
test("moving meteor partial-step sweeps exclude motion before bullet birth", () => {
  const { meteors } = setup(),
    m = meteors.spawnAt(new Vector3(0, 0, 20), 4, 0)!;
  m.previous.set(-40, 0, 20);
  m.position.set(40, 0, 20);
  const hit = { slot: -1, generation: 0 };
  // The meteor crossed x=0 before this late-born bullet existed.
  assert.equal(
    meteors.sweepProjectile(
      new Vector3(0, 0, 10),
      new Vector3(0, 0, 30),
      hit,
      0.1,
      0.9,
      1,
    ),
    Infinity,
  );
});

test('explosion push uses ship distance, shared radius and outward direction independent of camera', async () => {
  const { explosionImpulse } = await import('../src/combat/ExplosionForce.ts');
  const out = new Vector3(), velocity = new Vector3(0,0,90);
  explosionImpulse(out,new Vector3(60,0,0),zero,velocity,forward,12,12,120,.5);
  assert.deepEqual(out.toArray(),[6,0,0]);
  explosionImpulse(out,new Vector3(120,0,0),zero,velocity,forward,12,12,120,.5); assert.equal(out.length(),0);
  explosionImpulse(out,new Vector3(121,0,0),zero,velocity,forward,12,12,120,.5); assert.equal(out.length(),0);
  explosionImpulse(out,zero,zero,velocity,forward,12,12,120,.5); assert.equal(out.z,-6); assert.equal(Math.hypot(out.x,out.y),0);
  explosionImpulse(out,new Vector3(0,0,-60),zero,velocity,forward,36,12,120,.5); assert.equal(out.z,-4.5);
  explosionImpulse(out,new Vector3(60,0,0),zero,velocity,forward,12,0,120,.5); assert.equal(out.length(),0);
});

test('velocity-axis push factor scales only the component parallel to ship travel', async () => {
  const { explosionImpulse } = await import('../src/combat/ExplosionForce.ts');
  const out = new Vector3(), velocity = new Vector3(0,0,90), ship = new Vector3(60,0,-60);
  explosionImpulse(out,ship,zero,velocity,forward,12,12,1e9,.5);
  assert.ok(Math.abs(out.x - 12 / Math.sqrt(2)) < 1e-6);
  assert.ok(Math.abs(out.z + 6 / Math.sqrt(2)) < 1e-6);
  explosionImpulse(out,ship,zero,velocity,forward,12,12,1e9,0);
  assert.ok(Math.abs(out.x - 12 / Math.sqrt(2)) < 1e-6);
  assert.ok(Math.abs(out.z) < 1e-8);
});


test("tuned explosion push scales with size without clipping and settles in two seconds", () => {
  const flight = new FlightController(air as unknown as ProceduralTerrain);
  const initialPush = DEFAULT_COMBAT.explosionPush * 1.5;
  flight.applyExternalImpulse(new Vector3(initialPush, 0, 0), DEFAULT_COMBAT.explosionPushLife);
  flight.update(0.01, neutral);
  assert.ok(Math.abs(
    flight.externalVelocity.x
      - initialPush * (1 - 0.01 / DEFAULT_COMBAT.explosionPushLife),
  ) < 1e-8);
  assert.equal(flight.mode, "autopilot");
  for (let i = 1; i < 200; i++) flight.update(0.01, neutral);
  assert.equal(flight.externalVelocity.length(), 0);
});
