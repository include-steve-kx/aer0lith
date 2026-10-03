import assert from 'node:assert/strict';
import test from 'node:test';
import { Color, InstancedBufferAttribute, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { RockLibrary } from '../src/combat/geometry.ts';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { MissileSystem } from '../src/combat/MissileSystem.ts';
import { ImpactSystem } from '../src/combat/ImpactSystem.ts';
import { CombatView } from '../src/combat/CombatView.ts';
import {
  DEFAULT_COMBAT,
  COMBAT_LIMITS,
  sanitizeCombatSettings,
} from '../src/combat/settings.ts';
import { segmentConvex, terrainHit } from '../src/combat/collision.ts';
import { BoostCameraShake } from '../src/render/BoostCameraShake.ts';
import { FlightController } from '../src/flight/FlightController.ts';
import { WING_TIPS } from '../src/core/aircraftGeometry.ts';
import type { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import { inverseCrtPoint } from '../src/ui/CombatHud.ts';

const library = new RockLibrary('combat-tests');
const air = {
  densityAt: () => -1000,
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
const zero = new Vector3(),
  identity = new Quaternion();
const neutral = { pitch: 0, roll: 0, yaw: 0, throttle: 0 };
function systems(seed = 'test', terrain = air) {
  const meteors = new MeteorSystem(terrain, library, seed),
    impacts = new ImpactSystem(library, seed),
    missiles = new MissileSystem(meteors, seed);
  meteors.onDestroyed = (rock, point, direction) => impacts.spawn(rock, point, direction);
  return { meteors, impacts, missiles };
}
function rock(meteors: MeteorSystem, x = 0, z = 100, size = 10) {
  return meteors.spawnAt(new Vector3(x, 0, z), size, 16)!;
}

test('combat settings restore finite defaults, bounds, min/max and nonpersisted debug', () => {
  const s = sanitizeCombatSettings(
    {
      meteorMinDiameter: 30,
      meteorMaxDiameter: 4,
      missileSpeed: Infinity,
      missileCapacity: 99,
      meteorColor: 'javascript:x',
      fragmentCount: 7,
      explosionDebug: true,
    },
    true,
  );
  assert.ok(s.meteorMinDiameter <= s.meteorMaxDiameter);
  assert.equal(s.missileSpeed, DEFAULT_COMBAT.missileSpeed);
  assert.equal(s.missileCapacity, 8);
  assert.equal(s.meteorColor, '#555b5e');
  assert.equal(s.explosionDebug, false);
  assert.ok([4, 8, 12].includes(s.fragmentCount));
});

test('convex variants are unit-diameter and fracture templates reproduce every exterior face with closed edges', () => {
  for (const variant of library.variants) {
    let diameter = 0;
    for (const a of variant.shape.vertices)
      for (const b of variant.shape.vertices)
        diameter = Math.max(diameter, a.distanceTo(b));
    assert.ok(Math.abs(diameter - 1) < 1e-6);
    for (const [count, shards] of variant.shards) {
      assert.equal(shards.length, count);
      let exterior = 0;
      for (const shard of shards) {
        const edges = new Map<string, number>();
        const key = (i: number) =>
          Array.from(shard.positions.slice(i * 3, i * 3 + 3))
            .map((n) => n.toFixed(5))
            .join(',');
        for (let v = 0; v < shard.shades.length; v += 3) {
          if (shard.shades[v] === 1) exterior++;
          for (let e = 0; e < 3; e++) {
            const k = [key(v + e), key(v + ((e + 1) % 3))].sort().join('|');
            edges.set(k, (edges.get(k) ?? 0) + 1);
          }
        }
        for (const uses of edges.values())
          assert.equal(uses, 2, 'every fragment edge is closed');
      }
      assert.equal(
        exterior,
        variant.geometry.getAttribute('position').count / 3,
      );
    }
  }
});

test('encounters are deterministic, bounded, leave a bypass, and reject terrain', () => {
  const a = systems().meteors,
    b = systems().meteors;
  for (let i = 0; i < 500; i++) {
    a.advance(1 / 120, zero, identity);
    b.advance(1 / 120, zero, identity);
  }
  assert.ok(a.activeCount > 0);
  assert.equal(a.activeCount, b.activeCount);
  a.rocks.forEach((m, i) => {
    if (!m.active) return;
    assert.deepEqual(m.position, b.rocks[i].position);
    assert.ok(m.diameter >= DEFAULT_COMBAT.meteorMinDiameter && m.diameter <= DEFAULT_COMBAT.meteorMaxDiameter);
    assert.ok(m.position.z > 290 && m.position.z < 560);
    assert.ok(Math.hypot(m.position.x, m.position.y) > m.radius + 14);
    assert.ok(m.speedFactor >= 0.5 && m.speedFactor <= 1.5);
  });
  const blocked = systems('solid', { ...air, densityAt: () => 100 }).meteors;
  blocked.advance(5, zero, identity);
  assert.equal(blocked.activeCount, 0);
  for (let i = 0; i < 100; i++)
    a.spawnAt(new Vector3(200 + i * 40, 0, 300), 10, 16);
  assert.equal(a.activeCount, COMBAT_LIMITS.meteors);
});

test('birth size stays fixed, rates apply live, pause and generation recycling invalidate stale targets', () => {
  const { meteors } = systems();
  const m = rock(meteors, 30),
    h = { slot: 0, generation: m.generation };
  const q = m.orientation.clone();
  meteors.configure({
    ...DEFAULT_COMBAT,
    meteorMinDiameter: 30,
    meteorMaxDiameter: 36,
    meteorSpeed: 0,
    meteorSpin: 0,
  });
  meteors.advance(1 / 120, zero, identity);
  assert.equal(m.diameter, 10);
  assert.ok(m.orientation.equals(q));
  const p = m.position.clone();
  meteors.advance(0, zero, identity);
  assert.ok(m.position.equals(p));
  meteors.reset();
  rock(meteors);
  assert.equal(meteors.resolve(h), undefined);
});

test('scan volume crossings include surface and target motion, without duplicate refreshes', () => {
  const { meteors } = systems();
  const m = rock(meteors, 0, 100, 18);
  const scan = {
    id: 1,
    center: zero,
    previousRadius: 85,
    radius: 94,
    expanding: true,
  };
  meteors.scan(scan);
  assert.equal(m.detected, 8);
  m.detected = 3;
  meteors.scan(scan);
  assert.equal(m.detected, 3);
  meteors.scan({ ...scan, id: 2, previousRadius: 10, radius: 20 });
  assert.equal(m.detected, 3);
  m.previous.set(0, 0, 120);
  m.position.set(0, 0, 80);
  meteors.scan({ ...scan, id: 2, previousRadius: 98, radius: 99 });
  assert.equal(m.detected, 8);
  m.detected = 0;
  meteors.scan({ ...scan, id: 3, expanding: false });
  assert.equal(m.detected, 0);
});

test('ship and missiles sweep through rocks, with cockpit and rotational contacts', () => {
  const { meteors } = systems();
  rock(meteors, 0, 50);
  const end = new Vector3(0, 0, 100),
    hit = { slot: -1, generation: 0 };
  assert.equal(meteors.sweepShip(zero, end, identity, identity, false), true);
  assert.equal(meteors.sweepShip(zero, end, identity, identity, true), true);
  assert.ok(meteors.sweepMissile(zero, end, hit) < 0.5);
  assert.equal(hit.slot, 0);
  assert.equal(
    meteors.sweepShip(
      new Vector3(30, 0, 0),
      new Vector3(30, 0, 100),
      identity,
      identity,
      false,
    ),
    false,
  );
  meteors.reset();
  const m = rock(meteors, 5.9, -2.9, 2);
  m.position.y = 1.9;
  m.previous.copy(m.position);
  assert.equal(meteors.sweepShip(zero, zero, identity, identity, false), true);
  assert.equal(meteors.sweepShip(zero, zero, identity, identity, true), false);
  assert.equal(
    meteors.sweepShip(
      zero,
      zero,
      new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), Math.PI / 2),
      identity,
      false,
    ),
    true,
  );
});

test('terrain missile sampling is at most one metre and earliest convex surface is returned', () => {
  let previous = -1,
    maxGap = 0;
  const wall = {
    densityAt: (_x: number, _y: number, z: number) => {
      if (previous >= 0) maxGap = Math.max(maxGap, z - previous);
      previous = z;
      return Math.abs(z - 50) < 0.6 ? 1 : -100;
    },
  };
  const t = terrainHit(wall, zero, new Vector3(0, 0, 220));
  assert.ok(t > 0 && t < 0.25);
  assert.ok(maxGap <= 1 + 1e-10);
  const t2 = segmentConvex(
    zero,
    new Vector3(0, 0, 100),
    new Vector3(0, 0, 60),
    identity,
    10,
    library.variants[16].shape,
  );
  assert.ok(t2 > 0.5 && t2 < 0.6);
});

test('meteor collision dissipates relative motion without changing its flight mode', () => {
  for (const manual of [false, true]) {
    const { meteors } = systems();
    const flight = new FlightController(air as unknown as ProceduralTerrain);
    flight.obstacles = meteors;
    if (manual) flight.takeManualControl();
    rock(meteors, 0, 7, 10);
    let impactSource = '';
    let dissipatedEnergy = 0;
    flight.onImpact = impact => {
      impactSource = impact.source;
      dissipatedEnergy = impact.dissipatedEnergy;
    };
    flight.update(1 / 120, neutral);
    assert.equal(flight.mode, manual ? 'manual' : 'autopilot');
    assert.equal(impactSource, 'meteor');
    assert.ok(dissipatedEnergy > 0);
    assert.equal(meteors.activeCount, 1, 'contact does not erase the obstacle field');
  }
});

test('avoidance works without missiles and slows boost without disengaging autopilot', () => {
  const { meteors } = systems();
  rock(meteors, 0, 60, 36);
  const offset = new Vector3();
  assert.equal(meteors.avoidance(0.1, zero, 50, offset), false);
  assert.ok(offset.length() > 10);
  const flight = new FlightController(air as unknown as ProceduralTerrain);
  flight.obstacles = {
    sweepShip: () => false,
    clearance: () => true,
    avoidance: (_dt, _p, _s, out) => {
      out.set(0, 0, 0);
      return true;
    },
  };
  const speed = flight.speed;
  for (let i = 0; i < 120; i++)
    flight.update(1 / 120, { ...neutral, throttle: 1 });
  assert.ok(flight.speed < speed);
  assert.equal(flight.mode, 'autopilot');
  assert.ok(flight.throttle > 0);
});

test('random eligible-wing selection is reproducible, permits repeats, and excludes empty wings', () => {
  function sample() {
    const { meteors, missiles } = systems('random-launch');
    const selected: number[] = [];
    for (let n = 0; n < 160; n++) {
      missiles.clearFlights();
      meteors.reset();
      const m = rock(meteors, 0, 200);
      m.detected = 8;
      missiles.ammunition.fill(3);
      missiles.ammunition[2] = 0;
      missiles.update(0.001, zero, identity);
      const flight = missiles.missiles.find((m) => m.active)!;
      assert.ok(flight);
      selected.push(flight.wing);
    }
    return selected;
  }
  const wings = sample();
  assert.deepEqual(wings, sample());
  assert.ok(wings.some((w, i) => i > 0 && w === wings[i - 1]));
  assert.equal(wings.includes(2), false);
  for (const wing of [0, 1, 3])
    assert.ok(wings.filter((w) => w === wing).length > 25);
});

test('failed launches and pool exhaustion consume nothing; reservations prevent duplicates', () => {
  const { meteors, missiles } = systems();
  const m = rock(meteors, 0, 200);
  m.detected = 8;
  missiles.trails.forEach((t) => {
    t.active = true;
    t.attached = true;
  });
  missiles.update(0.01, zero, identity);
  assert.deepEqual([...missiles.ammunition], [3, 3, 3, 3]);
  assert.equal(m.reserved, -1);
  missiles.clearFlights();
  missiles.update(0.01, zero, identity);
  assert.equal(missiles.launches, 1);
  for (let i = 0; i < 30; i++) missiles.update(0.01, zero, identity);
  assert.equal(missiles.launches, 1);
  const blocked = systems('wall', {
    ...air,
    densityAt: (_x = 0, _y = 0, z = 0) => (z > 20 ? 1 : -1000),
  });
  rock(blocked.meteors, 0, 200).detected = 8;
  blocked.missiles.update(0.01, zero, identity);
  assert.equal(blocked.missiles.launches, 0);
  assert.deepEqual([...blocked.missiles.ammunition], [3, 3, 3, 3]);
});

test('reloads run concurrently, edits preserve progress and added capacity starts empty', () => {
  const { missiles } = systems();
  missiles.ammunition.fill(0);
  missiles.update(1.5, zero, identity);
  assert.deepEqual([...missiles.reload], [0.5, 0.5, 0.5, 0.5]);
  missiles.configure({
    ...DEFAULT_COMBAT,
    missileReload: 6,
    missileCapacity: 5,
  });
  assert.deepEqual([...missiles.reload], [0.5, 0.5, 0.5, 0.5]);
  assert.deepEqual([...missiles.ammunition], [0, 0, 0, 0]);
  missiles.update(3, zero, identity);
  assert.deepEqual([...missiles.ammunition], [1, 1, 1, 1]);
  missiles.update(0, zero, identity);
  assert.deepEqual([...missiles.ammunition], [1, 1, 1, 1]);
  missiles.reset();
  assert.deepEqual([...missiles.ammunition], [5, 5, 5, 5]);
  missiles.configure({ ...DEFAULT_COMBAT, missileCapacity: 2 });
  assert.deepEqual([...missiles.ammunition], [2, 2, 2, 2]);
});

test('wing tip transforms include rolls and guided hits destroy exactly once with detached trails', () => {
  const { meteors, missiles, impacts } = systems();
  const q = new Quaternion().setFromAxisAngle(
      new Vector3(0, 0, 1),
      Math.PI * 0.7,
    ),
    ship = new Vector3(10, 2, 0);
  missiles.syncMuzzles(ship, q);
  for (let i = 0; i < 4; i++)
    assert.ok(
      missiles.muzzle[i].distanceTo(
        new Vector3(...WING_TIPS[i]).applyQuaternion(q).add(ship),
      ) < 1e-9,
    );
  const m = rock(meteors, 8, 80, 12);
  m.detected = 8;
  let previousQ: Quaternion | undefined;
  for (let i = 0; i < 150 && m.active; i++) {
    const flying = missiles.missiles.find((m) => m.active);
    if (flying) previousQ = flying.orientation.clone();
    missiles.update(1 / 120, zero, identity);
    if (flying?.active && previousQ)
      assert.ok(
        previousQ.angleTo(flying.orientation) <=
          (DEFAULT_COMBAT.missileTurn * Math.PI) / 180 / 120 + 1e-7,
      );
  }
  assert.equal(m.active, false);
  assert.equal(impacts.explosions.filter((e) => e.active).length, 1);
  assert.equal(missiles.launches, 1);
  assert.ok(missiles.trails.some((t) => t.active && !t.attached));
  missiles.update(DEFAULT_COMBAT.missileTrailLife + 1, zero, identity);
  assert.equal(
    missiles.trails.some((t) => t.active),
    false,
  );
});

test('invalid target retires guidance without reacquiring; terrain releases reservations', () => {
  const { meteors, missiles } = systems();
  const m = rock(meteors, 0, 200);
  m.detected = 8;
  missiles.update(0.01, zero, identity);
  m.active = false;
  m.generation++;
  missiles.update(0.01, zero, identity);
  assert.equal(
    missiles.missiles.some((m) => m.active),
    false,
  );
  assert.ok(missiles.trails.some((t) => t.active));
  let wall = false;
  const s = systems('terrain', {
    ...air,
    densityAt: (_x = 0, _y = 0, z = 0) => (wall && z > 4 ? 1 : -1000),
  });
  const target = rock(s.meteors, 0, 100);
  target.detected = 8;
  s.missiles.update(0.01, zero, identity);
  wall = true;
  for (let i = 0; i < 10; i++) s.missiles.update(0.01, zero, identity);
  assert.equal(target.active, true);
  assert.equal(target.reserved, -1);
  assert.ok(target.retry > 0);
});

test('fragments begin in parent shape, shrink near expiry, retain templates, and are bounded cosmetic state', () => {
  const { meteors, impacts } = systems();
  const m = rock(meteors, 30);
  impacts.spawn(m, m.position, new Vector3(0, 0, 1));
  const fragments = impacts.fragments.filter((f) => f.active);
  assert.equal(fragments.length, 8);
  for (const f of fragments) {
    const t = f.template!,
      v = new Vector3().fromArray(t.positions),
      actual = v
        .clone()
        .sub(t.center)
        .multiplyScalar(f.scale)
        .applyQuaternion(f.orientation)
        .add(f.position),
      expected = v
        .multiplyScalar(m.diameter)
        .applyQuaternion(m.orientation)
        .add(m.position);
    assert.ok(actual.distanceTo(expected) < 1e-8);
    assert.ok(f.velocity.length() < 30);
  }
  const freshColor = fragments[0].color.clone();
  assert.ok(freshColor.equals(
    new Color(DEFAULT_COMBAT.meteorProximityColor).multiplyScalar(m.brightness),
  ));
  impacts.update(0.3, zero);
  assert.equal(fragments[0].lifeScale, 1);
  assert.ok(fragments[0].color.equals(freshColor), 'fresh fragments stay bright briefly');
  impacts.update(1, zero);
  assert.equal(fragments[0].lifeScale, 1);
  assert.ok(fragments[0].color.r + fragments[0].color.g + fragments[0].color.b
    < freshColor.r + freshColor.g + freshColor.b, 'fragments cool toward dark ash');
  impacts.update(0.6, zero);
  assert.ok(fragments[0].lifeScale > 0 && fragments[0].lifeScale < 1);
  const expectedAsh = new Color(DEFAULT_COMBAT.meteorAshColor).multiplyScalar(m.brightness);
  assert.ok(Math.hypot(
    fragments[0].color.r - expectedAsh.r,
    fragments[0].color.g - expectedAsh.g,
    fragments[0].color.b - expectedAsh.b,
  ) < 1e-12);
  for (let i = 0; i < 80; i++) impacts.spawn(m, m.position, zero);
  assert.equal(impacts.fragments.filter((f) => f.active).length, 576);
  assert.equal(impacts.explosions.filter((e) => e.active).length, 48);
  assert.equal(impacts.shakes.filter((e) => e.active).length, 48);
  assert.equal(meteors.activeCount, 1);
  impacts.configure({ ...DEFAULT_COMBAT, fragmentEnabled: false });
  assert.equal(
    impacts.fragments.some((f) => f.active),
    false,
  );
  impacts.reset();
  assert.equal(
    impacts.explosions.some((e) => e.active),
    false,
  );
});

test('armed meteor keeps its base color and gains a frozen local trigger hotspot', () => {
  const { meteors, impacts, missiles } = systems('meteor-lifecycle-color');
  const settings = {
    ...DEFAULT_COMBAT,
    meteorMinTriggerDistance: 50,
    meteorMaxTriggerDistance: 50,
    meteorMinFuseDelay: 1,
    meteorMaxFuseDelay: 1,
  };
  meteors.configure(settings);
  const view = new CombatView(meteors, missiles, impacts);
  view.configure(settings);
  const meteor = meteors.spawnAt(zero, 12, 0)!;
  const camera = new PerspectiveCamera();
  const instanceColor = new Color();
  const rockMeshes = (view as unknown as { rockMeshes: Array<{
    getColorAt(index: number, color: Color): void;
  }> }).rockMeshes;
  const proximityDirections = (view as unknown as {
    rockProximityDirections: InstancedBufferAttribute[];
  }).rockProximityDirections;
  const colorDistance = (a: Color, b: Color) => Math.hypot(
    a.r - b.r,
    a.g - b.g,
    a.b - b.b,
  );

  meteors.shipPosition.set(
    0,
    0,
    meteor.radius + meteor.proximityTriggerDistance * 2,
  );
  view.sync(zero, camera, false, false);
  const warningDirection = new Vector3().fromBufferAttribute(proximityDirections[0], 0);
  assert.ok(warningDirection.length() > 0 && warningDirection.length() < 1);
  rockMeshes[0].getColorAt(0, instanceColor);
  assert.ok(colorDistance(instanceColor,
    new Color(settings.meteorColor).multiplyScalar(meteor.brightness),
  ) < 1e-6);

  const triggerPoint = new Vector3(0, 0, meteor.radius + meteor.proximityTriggerDistance);
  meteors.updateProximity(0.1, triggerPoint, triggerPoint, identity);
  assert.equal(meteor.fuseArmed, true);
  view.sync(zero, camera, false, false);
  rockMeshes[0].getColorAt(0, instanceColor);
  assert.ok(colorDistance(instanceColor,
    new Color(settings.meteorColor).multiplyScalar(meteor.brightness),
  ) < 1e-6);
  const armedDirection = new Vector3().fromBufferAttribute(proximityDirections[0], 0);
  assert.ok(Math.abs(armedDirection.length() - 1) < 1e-6);
  assert.ok(armedDirection.normalize().dot(meteor.fuseTriggerDirection) > 0.999999);
  const frozenDirection = meteor.fuseTriggerDirection.clone();
  const farAway = new Vector3(1000, 0, 0);
  meteors.updateProximity(0.1, farAway, farAway, identity);
  assert.ok(meteor.fuseTriggerDirection.equals(frozenDirection));
  view.dispose();
  impacts.dispose();
  missiles.dispose();
  meteors.dispose();
});

test('explosion shake depends on ship proximity, freezes, expires exactly, and composes without camera drift', () => {
  const { meteors, impacts } = systems();
  const m = rock(meteors, 0, 0, 12);
  impacts.spawn(m, zero, zero);
  impacts.update(0.05, new Vector3(0, 0, DEFAULT_COMBAT.explosionShakeRadius + 1));
  assert.equal(impacts.shakeTranslation.length(), 0);
  impacts.update(0.01, new Vector3(0, 0, 5));
  assert.ok(impacts.shakeTranslation.length() > 0);
  const frozen = impacts.shakeTranslation.clone();
  impacts.update(0, new Vector3(0, 0, 200));
  assert.ok(impacts.shakeTranslation.equals(frozen));
  const camera = new PerspectiveCamera();
  camera.position.set(10, 20, 30);
  camera.rotation.set(0.3, 0.6, 0.8);
  const p = camera.position.clone(),
    q = camera.quaternion.clone(),
    boost = new BoostCameraShake();
  boost.strength = 1;
  boost.update(0.1, 1);
  boost.apply(camera, 200, new Vector3(4, 5, 6), new Vector3(1, 1, 1));
  assert.ok(camera.position.distanceTo(p) <= 0.450001);
  assert.ok(camera.quaternion.angleTo(q) <= Math.PI / 180 + 1e-7);
  boost.restore(camera);
  assert.ok(camera.position.equals(p));
  assert.ok(camera.quaternion.equals(q));
  impacts.update(1, zero);
  assert.equal(impacts.shakeTranslation.length(), 0);
  assert.equal(impacts.shakeRotation.length(), 0);
});

test('CRT HUD inverse matches forward curvature and rendering resources survive rebase/reset/dispose', () => {
  for (const curvature of [0, 0.1, 0.4]) {
    const [x, y] = inverseCrtPoint(0.6, -0.4, curvature),
      r = x * x + y * y;
    assert.ok(Math.abs(x * (1 + curvature * r) - 0.6) < 1e-6);
    assert.ok(Math.abs(y * (1 + curvature * r) + 0.4) < 1e-6);
  }
  const { meteors, missiles, impacts } = systems();
  const view = new CombatView(meteors, missiles, impacts),
    camera = new PerspectiveCamera();
  camera.position.z = -30;
  camera.lookAt(zero);
  rock(meteors, 30, 60).detected = 8;
  view.configure(DEFAULT_COMBAT);
  view.sync(zero, camera, true, true);
  const resources = view.group.children.length;
  view.sync(new Vector3(0, 0, 3000), camera, true, false);
  assert.equal(view.group.children.length, resources);
  meteors.reset();
  missiles.reset();
  impacts.reset();
  view.sync(zero, camera, true, false);
  assert.equal(view.active, false);
  view.dispose();
  view.dispose();
  assert.equal(view.group.children.length, 0);
});
