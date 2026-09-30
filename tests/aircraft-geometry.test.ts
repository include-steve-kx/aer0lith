import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import { ConvexHull } from 'three/addons/math/ConvexHull.js';
import { AIRCRAFT_PARTS, HULL_POINTS, WING_PARTS, WING_TIPS, AIRCRAFT_COLLISION_PROBES } from '../src/core/aircraftGeometry.ts';
import { COLLISION_PROBES } from '../src/core/config.ts';

test('all four leading and trailing wing roots lie inside the fuselage', () => {
  const hull = new ConvexHull().setFromPoints(HULL_POINTS.map(p => new Vector3(...p)));
  for (const wing of WING_PARTS) {
    for (const root of wing.slice(0, 2)) assert.ok(hull.containsPoint(new Vector3(...root)));
  }
});

test('collision samples cover the new extremities and never bridge empty space between wings', () => {
  assert.equal(COLLISION_PROBES, AIRCRAFT_COLLISION_PROBES);
  for (const point of [...HULL_POINTS, ...WING_TIPS]) {
    assert.ok(COLLISION_PROBES.some(p => p.every((value, axis) => value === point[axis])));
  }
  const hulls = AIRCRAFT_PARTS.map(part => new ConvexHull().setFromPoints(part.map(p => new Vector3(...p))));
  // The hull tolerance accepts points exactly on the shared visible surfaces.
  for (const p of COLLISION_PROBES) {
    assert.ok(hulls.some(hull => hull.containsPoint(new Vector3(...p))));
  }
});

test('cockpit debug displays exactly the active compact collision bounds', async () => {
  const { COCKPIT_COLLISION_POINTS, COCKPIT_COLLISION_PROBES } = await import('../src/core/aircraftGeometry.ts');
  const { CollisionDebugView } = await import('../src/render/CollisionDebugView.ts');
  const view = new CollisionDebugView();
  view.setCockpitMode(true);
  const [aircraft, cockpit] = view.group.children;
  assert.equal(aircraft.visible, false); assert.equal(cockpit.visible, true);
  assert.equal(cockpit.children.length, COCKPIT_COLLISION_PROBES.length + 1);
  COCKPIT_COLLISION_PROBES.forEach((point, i) => {
    assert.deepEqual(cockpit.children[i + 1].position.toArray(), point);
  });
  const hull = new ConvexHull().setFromPoints(COCKPIT_COLLISION_POINTS.map(p => new Vector3(...p)));
  for (const point of COCKPIT_COLLISION_PROBES) assert.ok(hull.containsPoint(new Vector3(...point)));
  view.setCockpitMode(false);
  assert.equal(aircraft.visible, true); assert.equal(cockpit.visible, false);
});
