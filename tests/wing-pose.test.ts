import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Vector3 } from 'three';
import { WING_PARTS } from '../src/core/aircraftGeometry.ts';
import { WingPose } from '../src/flight/WingPose.ts';
import { createAircraftGeometry } from '../src/render/createAircraftGeometry.ts';
import { TrailView } from '../src/render/TrailView.ts';
import { MissileSystem } from '../src/combat/MissileSystem.ts';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { RockLibrary } from '../src/combat/geometry.ts';

const settings = { wingSweepBack: 28, wingTuckIn: 18, wingFoldSpeed: 1 };

test('aircraft uses exactly one rendered triangle per wing', () => {
  assert.deepEqual(WING_PARTS.map(part => part.length), [3, 3, 3, 3]);
  const geometry = createAircraftGeometry(new WingPose());
  assert.equal(geometry.getAttribute('position').count / 3, 10);
  geometry.dispose();
});

test('physical boost folds backward and centerward with deliberate lag', () => {
  const wings = new WingPose();
  wings.configure(settings);
  const neutral = wings.tips.map(tip => tip.clone());
  wings.update(1.2, 1);
  assert.ok(wings.fold > 0.25 && wings.fold < 0.8, `unexpected fold ${wings.fold}`);
  wings.tips.forEach((tip, index) => {
    assert.ok(tip.z < neutral[index].z);
    assert.ok(Math.abs(tip.x) < Math.abs(neutral[index].x));
    assert.ok(Math.abs(tip.y) < Math.abs(neutral[index].y));
  });
  for (let i = 0; i < 600; i++) wings.update(1 / 120, 1);
  assert.ok(wings.fold > 0.99);
});

test('cruise and below never fold, while animation speed changes response only', () => {
  const slow = new WingPose(), fast = new WingPose();
  slow.configure({ ...settings, wingFoldSpeed: 0.25 });
  fast.configure({ ...settings, wingFoldSpeed: 4 });
  for (let i = 0; i < 120; i++) {
    slow.update(1 / 120, 2 / 3);
    fast.update(1 / 120, 0.2);
  }
  assert.equal(slow.fold, 0);
  assert.equal(fast.fold, 0);
  for (let i = 0; i < 120; i++) {
    slow.update(1 / 120, 1);
    fast.update(1 / 120, 1);
  }
  assert.ok(fast.fold > slow.fold * 2);
});

test('trails, wake mouths, collision probes, missiles and HUD anchors share the folded tips', () => {
  const wings = new WingPose();
  wings.configure(settings);
  for (let i = 0; i < 240; i++) wings.update(1 / 120, 1);
  const trail = new TrailView(wings);
  trail.add(new Vector3(), new Quaternion(), new Vector3(), true);
  const sample = trail.pathSamples[0];
  sample.tips.forEach((tip, index) => assert.ok(tip.distanceTo(wings.trailAnchors[index]) < 1e-10));
  assert.ok(Math.abs(sample.rootHeight - wings.trailAnchors[0].distanceTo(wings.trailAnchors[1])) < 1e-10);

  const missiles = new MissileSystem({} as MeteorSystem, 'wing-pose', wings);
  missiles.syncMuzzles(new Vector3(), new Quaternion());
  missiles.muzzle.forEach((muzzle, index) => assert.ok(muzzle.distanceTo(wings.tips[index]) < 1e-10));
  assert.ok(wings.collisionProbes.some(probe => probe.distanceTo(wings.tips[0]) < 1e-10));
  missiles.dispose();
});

test('meteor collision follows the animated wing surface', () => {
  const wings = new WingPose();
  wings.configure(settings);
  for (let i = 0; i < 600; i++) wings.update(1 / 120, 1);
  const air = {
    densityAt: () => -100,
    collisionDensityAt: () => -100,
    sample: (z: number) => ({ x: 0, y: 0, z, tangentX: 0, tangentY: 0, width: 100,
      height: 100, openness: 1, floorY: -50 }),
  };
  const library = new RockLibrary('folded-wing-collision');
  const meteors = new MeteorSystem(air, library, 'folded-wing-collision', wings);
  meteors.spawnAt(wings.tips[0].clone(), 4, 0);
  const zero = new Vector3(), identity = new Quaternion();
  assert.equal(meteors.sweepShip(zero, zero, identity, identity, false), true);
  meteors.dispose();
  library.dispose();
});
