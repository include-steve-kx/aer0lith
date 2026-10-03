import assert from 'node:assert/strict';
import test from 'node:test';
import { Color, Mesh, ShaderMaterial, Vector3 } from 'three';
import { AircraftView } from '../src/render/AircraftView.ts';

test('occluded body has independent color/opacity and a fully opaque outline', () => {
  const ship = new AircraftView();
  const ghost = ship.group.children[1];
  const body = (ghost.children[0] as Mesh).material as ShaderMaterial;
  const outline = (ghost.children[1] as Mesh).material as ShaderMaterial;
  assert.equal(body.uniforms.uOpacity.value, 0.5);
  assert.ok(body.uniforms.uColor.value.equals(new Color('#ffee66')));
  for (const opacity of [0, 0.25, 0.5, 1]) {
    ship.setOcclusionSettings(true, opacity, '#ffaa33');
    assert.equal(ghost.visible, true);
    assert.equal(body.uniforms.uOpacity.value, opacity);
    assert.equal(outline.uniforms.uOpacity.value, 1);
    assert.ok(body.uniforms.uColor.value.equals(new Color('#ffaa33')));
  }
  ship.setOcclusionSettings(false, 0.5); assert.equal(ghost.visible, false);
});

test('visible ship is marked only after terrain and flocks have populated depth', () => {
  const ship = new AircraftView();
  // Terrain chunks draw at 1, flock bodies at 2. A tie permits material sorting
  // to draw the ship first and leaves stale stencil over its occluded interior.
  assert.ok(ship.group.children[0].renderOrder > 2);
  assert.ok(ship.group.children[1].children[0].renderOrder > ship.group.children[0].renderOrder);
});

test('impact feedback flashes at the struck aircraft-local point and expires', () => {
  const ship = new AircraftView();
  const point = new Vector3(5.5, 1.8, -2.9);
  ship.flashImpact(point, 0.5, 0.8);
  assert.equal(ship.group.children.length, 2, 'impact feedback adds no sphere mesh');
  const body = ship.group.children[0] as Mesh;
  const impactWeights = body.geometry.getAttribute('aImpact');
  const highlighted = Array.from({ length: impactWeights.count }, (_, index) => impactWeights.getX(index))
    .filter(weight => weight > 0);
  assert.ok(highlighted.length >= 3);
  assert.ok(highlighted.length < impactWeights.count, 'only the nearest triangle and duplicate vertices flash');
  assert.equal(ship.impactVisible, true);
  assert.deepEqual(ship.impactPosition.toArray(), point.toArray());
  ship.updateImpact(0.25);
  assert.equal(ship.impactVisible, true);
  ship.updateImpact(0.25);
  assert.equal(ship.impactVisible, false);
  ship.dispose();
});
