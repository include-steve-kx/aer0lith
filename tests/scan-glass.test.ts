import assert from 'node:assert/strict';
import test from 'node:test';
import { Texture, Vector3 } from 'three';
import { PROBE } from '../src/core/config.ts';
import { ScanGlass } from '../src/render/ScanGlass.ts';

const zero = new Vector3();

test('scan shell follows the probe center/radius through a rebase and is reused on every restart', () => {
  const scan = new ScanGlass();
  const mesh = scan.mesh, geometry = mesh.geometry, material = mesh.material;
  const launch = new Vector3(2100, 60, 4200), origin = new Vector3(2048, 0, 4096);
  scan.sync(launch, origin, 160, true);
  assert.equal(scan.active, true);
  assert.deepEqual(mesh.position.toArray(), [52, 60, 104]);
  assert.deepEqual(mesh.scale.toArray(), [160, 160, 160]);
  scan.sync(launch, new Vector3(4096, 0, 4096), 320, true);
  assert.deepEqual(mesh.position.toArray(), [-1996, 60, 104]);
  for (let i = 0; i < 100; i++) {
    scan.sync(new Vector3(i, 10, 20), zero, 0, true);
    assert.equal(scan.active, false);
    scan.sync(new Vector3(i, 10, 20), zero, 40, true);
    assert.equal(scan.mesh, mesh); assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material);
    assert.equal(scan.scene.children.length, 1);
    assert.equal(mesh.scale.x, 40);
  }
  scan.sync(launch, origin, PROBE.maxRadius, false);
  assert.equal(scan.active, false);
  scan.dispose();
});

test('shell finishes cleanly, settings stay live on pause, and animation uses simulation time', () => {
  const scan = new ScanGlass(), depth = new Texture();
  scan.sync(zero, zero, 160, true);
  scan.prepare(depth, 800, 600, 2);
  scan.mesh.updateMatrix();
  const pose = scan.mesh.matrix.clone();
  scan.configure(true, 2, 0.3, 1);
  scan.prepare(depth, 1600, 900, 2);
  scan.mesh.updateMatrix();
  assert.ok(scan.mesh.matrix.equals(pose));
  assert.equal(scan.mesh.material.uniforms.uFlutterTime.value, 0);
  assert.equal(scan.mesh.material.uniforms.uRefraction.value, 2);
  assert.equal(scan.mesh.material.uniforms.uDispersion.value, 0.3);
  assert.deepEqual(scan.mesh.material.uniforms.uResolution.value.toArray(), [1600, 900]);
  scan.sync(zero, zero, PROBE.maxRadius - PROBE.speed / 2, true);
  assert.equal(scan.mesh.material.uniforms.uFade.value, 0.5);
  scan.configure(false, 2, 0.3, 1); assert.equal(scan.active, false);
  scan.configure(true, 2, 0.3, 1); assert.equal(scan.active, true);
  scan.sync(zero, zero, PROBE.maxRadius, true); assert.equal(scan.active, false);
  scan.sync(zero, zero, 40, false); assert.equal(scan.active, false);
  scan.dispose(); depth.dispose();
});

test('shell disposal releases both GPU resources exactly once and detaches its mesh', () => {
  const scan = new ScanGlass();
  let geometryDisposals = 0, materialDisposals = 0;
  scan.mesh.geometry.addEventListener('dispose', () => geometryDisposals++);
  scan.mesh.material.addEventListener('dispose', () => materialDisposals++);
  scan.sync(zero, zero, 40, true);
  scan.dispose(); scan.dispose();
  assert.equal(geometryDisposals, 1); assert.equal(materialDisposals, 1);
  assert.equal(scan.scene.children.length, 0); assert.equal(scan.active, false);
  scan.sync(zero, zero, 40, true); assert.equal(scan.active, false);
});


test('flutter rate changes without phase jumps, freezes during pause, and resets on restart', () => {
  const scan = new ScanGlass(), depth = new Texture();
  const uniforms = scan.mesh.material.uniforms;
  scan.sync(zero, zero, 80, true);
  scan.prepare(depth, 800, 600, 10);
  scan.prepare(depth, 800, 600, 11);
  assert.equal(uniforms.uFlutterTime.value, 1);
  scan.configure(true, 1, 0.12, 0.8, 0.08, 3);
  scan.prepare(depth, 800, 600, 11);
  assert.equal(uniforms.uFlutterTime.value, 1, 'paused speed edit must not jump phase');
  assert.equal(uniforms.uFlutter.value, 0.08);
  scan.prepare(depth, 800, 600, 12);
  assert.equal(uniforms.uFlutterTime.value, 4);
  scan.configure(true, 1, 0.12, 0.8, 0, 0);
  scan.prepare(depth, 800, 600, 13);
  assert.equal(uniforms.uFlutterTime.value, 4);
  assert.equal(uniforms.uFlutter.value, 0, 'zero strength removes deformation and surface flutter');
  scan.sync(zero, new Vector3(2048, 0, 0), 160, true);
  assert.equal(uniforms.uFlutterTime.value, 4, 'rebasing must not restart animation');
  scan.sync(new Vector3(10, 0, 0), zero, 20, true);
  assert.equal(uniforms.uFlutterTime.value, 0, 'new scan restarts the pooled membrane');
  scan.configure(true, 1, 0.12, 0.8, 10, 1);
  assert.equal(uniforms.uFlutter.value, 0.12);
  assert.ok(scan.mesh.geometry.boundingSphere!.radius >= 1 + uniforms.uFlutter.value);
  scan.dispose(); depth.dispose();
});
