import assert from 'node:assert/strict';
import test from 'node:test';
import { Matrix4, MeshBasicMaterial, Quaternion, Scene, Vector3 } from 'three';
import { FLOCK } from '../src/core/config.ts';
import type { FlightPath, TerrainSampler } from '../src/core/types.ts';
import { fibonacciSpherePoint, FlockSystem, probeEncounterStrength } from '../src/world/FlockSystem.ts';

const openTerrain: TerrainSampler & FlightPath = {
  densityAt: () => -100,
  sample: (_z) => ({
    x: 0,
    y: 40,
    floorY: -40,
    tangentX: 0,
    tangentY: 0,
    width: 100,
    height: 80,
    openness: 1,
  }),
};

test('Fibonacci sphere points are deterministic, finite, and unit length', () => {
  for (let index = 0; index < 32; index += 1) {
    const point = fibonacciSpherePoint(index, 32);
    assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y) && Number.isFinite(point.z));
    assert.ok(Math.abs(point.length() - 1) < 1e-10);
    assert.deepEqual(point, fibonacciSpherePoint(index, 32));
  }
});

test('probe encounter is limited to the expanding spherical scan band', () => {
  assert.equal(probeEncounterStrength(100, 100, 12, true), 1);
  assert.equal(probeEncounterStrength(106, 100, 12, true), 0.5);
  assert.equal(probeEncounterStrength(112, 100, 12, true), 0);
  assert.equal(probeEncounterStrength(100, 100, 12, false), 0);
});

test('a seeded flock randomizes its active amount within the configured range', () => {
  const flocks = new FlockSystem(new Scene(), openTerrain, 'amount-range');
  flocks.applyVisualSettings({
    flockEnabled: true,
    flockMinSize: 7,
    flockMaxSize: 11,
    flockSpawnDistanceMin: 260,
    flockSpawnDistanceMax: 430,
    flockInterval: 1,
    flockSpread: 30,
    flockSpeed: 34,
    flockColor: '#ffffff',
    flockTargetColor: '#ffffff',
    flockTargetThickness: 0.085,
  });
  const plane = new Vector3(0, 40, 0);
  const orientation = new Quaternion();
  const origin = new Vector3();
  for (let frame = 0; frame < 84; frame += 1) {
    plane.z += 55 / 60;
    flocks.update(1 / 60, plane, orientation, 55, origin);
  }
  assert.ok(flocks.activeBoidCount >= 7 && flocks.activeBoidCount <= 11);
});

test('flock spawn-ahead distance setting controls where a new encounter appears', () => {
  const flocks = new FlockSystem(new Scene(), openTerrain, 'spawn-distance');
  flocks.applyVisualSettings({
    flockEnabled: true,
    flockMinSize: 1,
    flockMaxSize: 1,
    flockSpawnDistanceMin: 200,
    flockSpawnDistanceMax: 200,
    flockInterval: 8,
    flockSpread: 2,
    flockSpeed: 4,
    flockColor: '#ffffff',
    flockTargetColor: '#ffffff',
    flockTargetThickness: 0.05,
  });
  const birds = flocks.group.children[0] as import('three').InstancedMesh;
  flocks.update(4, new Vector3(0, 40, 0), new Quaternion(), 55, new Vector3());
  assert.equal(flocks.activeBoidCount, 1);
  const matrix = new Matrix4();
  birds.getMatrixAt(0, matrix);
  const position = new Vector3().setFromMatrixPosition(matrix);
  assert.ok(position.z > 195 && position.z < 205, `expected flock near 200 m, got ${position.z}`);
});

test('flocks reuse a fixed-capacity pool during repeated appearances', () => {
  const scene = new Scene();
  const flocks = new FlockSystem(scene, openTerrain, 'pool-check');
  flocks.applyVisualSettings({
    flockEnabled: true,
    flockMinSize: FLOCK.maxBirdsPerFlock,
    flockMaxSize: FLOCK.maxBirdsPerFlock,
    flockSpawnDistanceMin: 260,
    flockSpawnDistanceMax: 430,
    flockInterval: 1,
    flockSpread: 18,
    flockSpeed: 34,
    flockColor: '#ffffff',
    flockTargetColor: '#ffffff',
    flockTargetThickness: 0.085,
  });
  const plane = new Vector3(0, 40, 0);
  const orientation = new Quaternion();
  const origin = new Vector3();

  for (let frame = 0; frame < 1_500; frame += 1) {
    plane.z += 55 / 60;
    flocks.update(1 / 60, plane, orientation, 55, origin);
    assert.ok(flocks.activeFlockCount <= FLOCK.maxFlocks);
    assert.ok(flocks.activeBoidCount <= flocks.capacity);
  }

  assert.equal(flocks.capacity, FLOCK.maxFlocks * FLOCK.maxBirdsPerFlock);
  assert.equal(flocks.targetPoolCapacity, flocks.capacity * 24);
  assert.ok(flocks.activeFlockCount > 0);
});

test('scanned brackets fade in alpha, keep their tint, and freeze with the birds', () => {
  const flocks = new FlockSystem(new Scene(), openTerrain, 'fade-freeze');
  const plane = new Vector3(0, 40, 0);
  const orientation = new Quaternion();
  const origin = new Vector3();
  for (let frame = 0; frame < 300; frame++) flocks.update(1 / 60, plane, orientation, 55, origin);
  // Locate an actual active bird from the public instance matrices.
  const birds = flocks.group.children[0] as import('three').InstancedMesh;
  const targets = flocks.group.children[1] as import('three').InstancedMesh;
  const matrix = new Matrix4();
  birds.getMatrixAt(0, matrix);
  const birdPosition = new Vector3().setFromMatrixPosition(matrix);
  const probe = birdPosition.clone().add(new Vector3(0, 0, -30));
  flocks.update(0, plane, orientation, 55, origin, false, probe, 30, true, true);
  assert.ok(targets.count > 0);
  const alpha = targets.geometry.getAttribute('instanceAlpha');
  const initialAlpha = alpha.getX(0);
  const tint = (targets.material as MeshBasicMaterial).color.clone();
  const matrices = Array.from(birds.instanceMatrix.array);
  for (let frame = 0; frame < 120; frame++) flocks.update(1 / 60, plane, orientation, 55, origin, true);
  assert.deepEqual(Array.from(birds.instanceMatrix.array), matrices);
  assert.equal(alpha.getX(0), initialAlpha);
  for (let frame = 0; frame < 145; frame++) flocks.update(1 / 60, plane, orientation, 55, origin);
  assert.ok(alpha.getX(0) < initialAlpha * 0.5);
  assert.deepEqual((targets.material as MeshBasicMaterial).color, tint);
  assert.equal(targets.instanceColor, null, 'RGB must not be used for fading');
  assert.equal((targets.material as MeshBasicMaterial).depthWrite, false);
});

test('ambient presentation hides scanned flock brackets across settings changes', () => {
  const flocks = new FlockSystem(new Scene(), openTerrain, 'presentation');
  const targets = flocks.group.children[1] as import('three').InstancedMesh;
  const settings = {
    flockEnabled: true,
    flockMinSize: 10,
    flockMaxSize: 26,
    flockSpawnDistanceMin: 260,
    flockSpawnDistanceMax: 430,
    flockInterval: 8,
    flockSpread: 30,
    flockSpeed: 34,
    flockColor: '#ffffff',
    flockTargetColor: '#ffffff',
    flockTargetThickness: 0.05,
  };

  flocks.applyVisualSettings(settings);
  assert.equal(targets.visible, true);
  flocks.setTargetPresentationVisible(false);
  assert.equal(targets.visible, false);
  flocks.applyVisualSettings({ ...settings, flockTargetColor: '#8bdcff' });
  assert.equal(targets.visible, false, 'live settings must not reveal Ambient targets');
  flocks.setTargetPresentationVisible(true);
  assert.equal(targets.visible, true);
  flocks.applyVisualSettings({ ...settings, flockEnabled: false });
  assert.equal(targets.visible, false);
});
