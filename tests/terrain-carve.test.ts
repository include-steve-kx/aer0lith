import assert from 'node:assert/strict';
import test from 'node:test';
import { Vector3 } from 'three';
import {
  TerrainCarveField,
  applyCarveSnapshot,
  applyCarveSnapshotToLattice,
  isValidCarveSnapshot,
  pointSegmentDistanceSquared,
} from '../src/world/TerrainCarve.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import { densityLatticeLength } from '../src/world/VolumeMesher.ts';

class PlaneTerrain extends ProceduralTerrain {
  override baseDensityAt(x: number): number { return x; }
}

test('capsules subtract density along their side and rounded caps', () => {
  const field = new TerrainCarveField();
  assert.equal(field.addCapsule(0, 0, 0, 20, 0, 0, 10).applied, true);
  assert.equal(field.applyDensity(100, 10, 0, 0), -10);
  assert.equal(field.applyDensity(100, 10, 10, 0), 0);
  assert.equal(field.applyDensity(100, -10, 0, 0), 0);
  assert.equal(field.applyDensity(7, 100, 0, 0), 7);
  assert.equal(pointSegmentDistanceSquared(10, 4, 0, 0, 0, 0, 20, 0, 0), 16);
});

test('zero-length capsules behave as spheres and invalid values are rejected', () => {
  const field = new TerrainCarveField();
  assert.equal(field.addCapsule(0, 0, 0, 0, 0, 0, 6).applied, true);
  assert.equal(field.applyDensity(100, 0, 0, 0), -6);
  assert.equal(field.applyDensity(100, 6, 0, 0), 0);
  assert.equal(field.addCapsule(0, 0, 0, 1, 0, 0, 0).applied, false);
  assert.equal(field.addCapsule(Number.NaN, 0, 0, 1, 0, 0, 2).applied, false);
});

test('chunk indexing covers negative coordinates and both sides of exact seams', () => {
  const field = new TerrainCarveField();
  const result = field.addCapsule(0, -128, 128, 0, -128, 128, 0.5);
  const keys = new Set(result.affectedChunks.map(({ x, y, z }) => `${x},${y},${z}`));
  assert.equal(keys.size, 8);
  assert.ok(keys.has('-1,-2,0'));
  assert.ok(keys.has('0,-1,1'));
  assert.equal(field.applyDensity(1, -0.25, -128, 128), -0.25);
  assert.equal(field.applyDensity(1, 0.25, -128, 128), -0.25);
});

test('exact capsule admission rejects AABB corner chunks', () => {
  const field = new TerrainCarveField();
  const result = field.addCapsule(64, 64, 64, 448, 64, 64, 60);
  const keys = new Set(result.affectedChunks.map(({ x, y, z }) => `${x},${y},${z}`));
  assert.ok(keys.has('0,0,0'));
  assert.ok(keys.has('3,0,0'));
  assert.equal(keys.has('0,1,1'), false);
});

test('contained capsules compact without changing the field', () => {
  const field = new TerrainCarveField();
  field.addCapsule(0, 0, 0, 20, 0, 0, 4);
  assert.equal(field.addCapsule(2, 0, 0, 18, 0, 0, 2).applied, false);
  assert.equal(field.size, 1);
  field.addCapsule(-4, 0, 0, 24, 0, 0, 8);
  assert.equal(field.size, 1);
  assert.equal(field.applyDensity(100, 10, 3, 0), -5);
});

test('snapshots reproduce indexed fields and the one-capsule fast path', () => {
  const field = new TerrainCarveField();
  const chunk = { x: 0, y: 0, z: 0 };
  field.addCapsule(12, 15, 18, 70, 15, 18, 9);
  const snapshot = field.snapshotForChunk(chunk);
  assert.equal(snapshot.length, 7);
  assert.equal(
    applyCarveSnapshot(100, 30, 15, 18, snapshot),
    field.applyDensity(100, 30, 15, 18),
  );
  assert.ok(field.revisionForChunk(chunk) > 0);
  assert.equal(isValidCarveSnapshot(snapshot), true);
  assert.equal(isValidCarveSnapshot(new Float64Array([0, 0, 0, 1, 1, Number.NaN, 2])), false);
  assert.equal(isValidCarveSnapshot(new Float64Array([0, 0, 0, 1, 1, 1, 0])), false);
  assert.equal(isValidCarveSnapshot(new Float64Array(8)), false);
});

test('collision cache keeps base corners while carving applies immediately', () => {
  const terrain = new PlaneTerrain('carve-cache');
  assert.ok(terrain.collisionDensityAt(2, 0, 0) > 0);
  terrain.applyCarveCapsule(new Vector3(0, 0, -20), new Vector3(0, 0, 20), 16);
  assert.ok(terrain.collisionDensityAt(2, 0, 0) < 0);
});

test('lattice carving matches direct snapshot evaluation', () => {
  const chunk = { x: -1, y: 0, z: 0 };
  const base = new Float32Array(densityLatticeLength()).fill(20);
  const snapshot = new Float64Array([-64, 0, 0, 64, 0, 0, 60]);
  const carved = applyCarveSnapshotToLattice(chunk, base, snapshot);
  assert.ok(carved.some(value => value < 0));
  assert.ok(carved.every(value => value <= 20));
  const generic = applyCarveSnapshotToLattice(
    chunk,
    base,
    new Float64Array([
      -64, 0, 0, 64, 0, 0, 60,
      10_000, 10_000, 10_000, 10_001, 10_001, 10_001, 1,
    ]),
  );
  assert.deepEqual(carved, generic, 'specialized one-capsule evaluation matches the generic union');
});

test('session history retains unique capsules without pruning', () => {
  const field = new TerrainCarveField();
  for (let index = 0; index < 1_000; index += 1) {
    field.addCapsule(index * 150, 0, 0, index * 150 + 40, 0, 0, 16);
  }
  assert.equal(field.size, 1_000);
  assert.ok(field.indexReferenceCount >= field.size);
});
