import assert from 'node:assert/strict';
import test from 'node:test';
import { Quaternion, Scene, Vector3 } from 'three';
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

test('flocks reuse a fixed-capacity pool during repeated appearances', () => {
  const scene = new Scene();
  const flocks = new FlockSystem(scene, openTerrain, 'pool-check');
  flocks.applyVisualSettings({
    flockEnabled: true,
    flockMinSize: FLOCK.maxBirdsPerFlock,
    flockMaxSize: FLOCK.maxBirdsPerFlock,
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
