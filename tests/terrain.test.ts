import assert from 'node:assert/strict';
import test from 'node:test';
import { Scene, Vector3 } from 'three';
import { PROBE, TERRAIN } from '../src/core/config.ts';
import { hashString, SeededNoise } from '../src/world/Noise.ts';
import { dotSpacingFromDensity, TerrainManager } from '../src/world/TerrainManager.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import { DEFAULT_TERRAIN_GENERATION } from '../src/flight/FlightTuning.ts';
import {
  Float32MeshBuffer,
  interpolateDensityCell,
  polygonizeDensityLattice,
  polygonizeDensityChunk,
  sampleCrystalLattice,
} from '../src/world/VolumeMesher.ts';

test('seed hashing and 2D/3D noise are deterministic', () => {
  assert.equal(hashString('vector'), hashString('vector'));
  assert.notEqual(hashString('vector'), hashString('another-vector'));
  const a = new SeededNoise('vector');
  const b = new SeededNoise('vector');
  const c = new SeededNoise('another-vector');
  assert.equal(a.noise2(12.5, -9.25), b.noise2(12.5, -9.25));
  assert.equal(a.noise3(12.5, -9.25, 4.75), b.noise3(12.5, -9.25, 4.75));
  assert.notEqual(a.noise3(12.5, -9.25, 4.75), c.noise3(12.5, -9.25, 4.75));
});

test('projected dot density converts to intuitive world-space spacing', () => {
  assert.equal(dotSpacingFromDensity(1), 10);
  assert.equal(dotSpacingFromDensity(4), 5);
  assert.equal(dotSpacingFromDensity(25), 2);
});

test('density field is stable on shared 3D chunk boundaries', () => {
  const terrain = new ProceduralTerrain('seam-check');
  for (let row = -6; row <= 6; row += 1) {
    const y = row * (TERRAIN.chunkSize / TERRAIN.segments);
    const z = 256 + row * 17.25;
    const fromLeft = terrain.densityAt(TERRAIN.chunkSize, y, z);
    const fromRight = terrain.densityAt(TERRAIN.chunkSize, y, z);
    assert.equal(fromLeft, fromRight);
  }
});

test('crystal material field is deterministic, independent, and finely mottled', () => {
  const a = new ProceduralTerrain('crystal-field');
  const b = new ProceduralTerrain('crystal-field');
  const c = new ProceduralTerrain('other-crystal-field');
  const lattice = sampleCrystalLattice({ x: 0, y: -1, z: 2 }, a);
  assert.deepEqual(lattice, sampleCrystalLattice({ x: 0, y: -1, z: 2 }, b));
  assert.notDeepEqual(lattice, sampleCrystalLattice({ x: 0, y: -1, z: 2 }, c));
  const crystalSamples = lattice.reduce((count, value) => count + Number(value >= 0.9 * 255), 0);
  assert.ok(crystalSamples > lattice.length * 0.02);
  assert.ok(crystalSamples < lattice.length * 0.25);
  assert.ok(new Set(lattice).size > 64, 'field is continuous rather than a binary material mask');
});

test('polygonizer interpolates the crystal field at the same density crossing', () => {
  const points = TERRAIN.segments + 1;
  const density = new Float32Array(points ** 3);
  const crystal = new Uint8Array(points ** 3);
  let index = 0;
  for (let z = 0; z < points; z += 1) {
    for (let y = 0; y < points; y += 1) {
      for (let x = 0; x < points; x += 1) {
        density[index] = x - TERRAIN.segments / 2;
        crystal[index] = Math.round(x / TERRAIN.segments * 255);
        index += 1;
      }
    }
  }
  const mesh = new Float32MeshBuffer();
  polygonizeDensityLattice(density, mesh, crystal);
  assert.ok(mesh.vertexCount > 0);
  for (let vertex = 0; vertex < mesh.vertexCount; vertex += 1) {
    assert.ok(Math.abs(mesh.crystal[vertex] - 128) <= 1);
  }
});

test('flight vein is continuous in 3D and its central route remains open', () => {
  const terrain = new ProceduralTerrain('path-check');
  let minimumWidth = Number.POSITIVE_INFINITY;
  let maximumWidth = Number.NEGATIVE_INFINITY;
  let minimumHeight = Number.POSITIVE_INFINITY;
  let maximumHeight = Number.NEGATIVE_INFINITY;
  for (let z = -512; z <= 4096; z += 32) {
    const path = terrain.sample(z);
    const next = terrain.sample(z + 0.01);
    assert.ok(Math.abs(next.x - path.x) < 1);
    assert.ok(Math.abs(next.y - path.y) < 1);
    assert.ok(terrain.densityAt(path.x, path.y, z) < -12, `route blocked at z=${z}`);
    minimumWidth = Math.min(minimumWidth, path.width);
    maximumWidth = Math.max(maximumWidth, path.width);
    minimumHeight = Math.min(minimumHeight, path.height);
    maximumHeight = Math.max(maximumHeight, path.height);
  }
  assert.ok(maximumWidth - minimumWidth > 50);
  assert.ok(maximumHeight - minimumHeight > 40);
});

test('default terrain route is 15 percent gentler and 10 percent wider than legacy generation', () => {
  const gentler = new ProceduralTerrain('route-tuning');
  const legacy = new ProceduralTerrain('route-tuning', {
    routeHorizontalTurns: 1,
    routeVerticalTurns: 1,
    routeClearance: 1,
  });
  assert.deepEqual(gentler.generationSettings, DEFAULT_TERRAIN_GENERATION);
  for (let z = -1000; z <= 5000; z += 137) {
    const current = gentler.sample(z);
    const before = legacy.sample(z);
    assert.ok(Math.abs(current.x - before.x * 0.85) < 1e-9);
    assert.ok(Math.abs((current.y - 42) - (before.y - 42) * 0.85) < 1e-9);
    assert.ok(Math.abs(current.tangentX - before.tangentX * 0.85) < 1e-9);
    assert.ok(Math.abs(current.tangentY - before.tangentY * 0.85) < 1e-9);
    assert.ok(Math.abs(current.width - before.width * 1.1) < 1e-9);
    assert.ok(Math.abs(current.height - before.height * 1.1) < 1e-9);
  }
});

test('polygonizer extracts a 3D isosurface and joins neighboring chunks', () => {
  const sphereField = {
    densityAt: (x: number, y: number, z: number) => 50 - Math.hypot(x - 128, y - 64, z - 64),
  } as unknown as ProceduralTerrain;
  const left = new Float32MeshBuffer();
  const right = new Float32MeshBuffer();
  polygonizeDensityChunk({ x: 0, y: 0, z: 0 }, sphereField, left);
  polygonizeDensityChunk({ x: 1, y: 0, z: 0 }, sphereField, right);
  assert.ok(left.vertexCount > 0);
  assert.ok(right.vertexCount > 0);
  assert.equal(left.vertexCount % 3, 0);
  assert.equal(right.vertexCount % 3, 0);

  const seam = (buffer: Float32MeshBuffer, localX: number): string[] => {
    const values = new Set<string>();
    for (let offset = 0; offset < buffer.length; offset += 3) {
      if (Math.abs(buffer.data[offset] - localX) > 1e-4) continue;
      values.add(`${buffer.data[offset + 1].toFixed(4)},${buffer.data[offset + 2].toFixed(4)}`);
    }
    return [...values].sort();
  };
  assert.deepEqual(seam(left, TERRAIN.chunkSize), seam(right, 0));
});

test('collision interpolation matches the polygonizer tetrahedral field', () => {
  const densities = [-1, 1, -2, -4, 3, 5, 2, 0];
  for (const [x, y, z] of [
    [0.1, 0.2, 0.3],
    [0.8, 0.25, 0.4],
    [0.45, 0.7, 0.9],
    [0.5, 0.5, 0.5],
  ] as const) {
    const expected = 2 * x - 3 * y + 4 * z - 1;
    assert.ok(Math.abs(interpolateDensityCell(densities, x, y, z) - expected) < 1e-6);
  }
});

test('terrain chunk recycling and probe state stay bounded', () => {
  const scene = new Scene();
  const terrain = new ProceduralTerrain('mesh-pool');
  const manager = new TerrainManager(scene, terrain, { synchronousBudget: Number.POSITIVE_INFINITY });
  const origin = new Vector3();
  const expectedCount = TERRAIN.columns * TERRAIN.verticalLayers * TERRAIN.rows;

  for (let index = 0; index < 5; index += 1) {
    const route = terrain.sample(index * TERRAIN.chunkSize);
    manager.update(new Vector3(route.x, route.y, index * TERRAIN.chunkSize), origin);
    assert.equal(manager.activeCount, expectedCount);
    assert.equal(manager.chunkCount, expectedCount);
  }

  manager.triggerProbe(new Vector3());
  manager.updateProbe(0.5, origin);
  assert.equal(manager.currentProbeRadius, PROBE.speed * 0.5);
  assert.equal(manager.isProbeActive, true);
  manager.updateProbe(10, origin);
  assert.equal(manager.currentProbeRadius, 720);
  assert.equal(manager.isProbeExpanding, false);
  assert.equal(manager.isProbeActive, true);
  manager.updateProbe(PROBE.afterglowDuration + 0.1, origin);
  assert.equal(manager.isProbeActive, false);
});

test('active terrain chunks remesh in place at the latest coalesced carve revision', () => {
  class WallTerrain extends ProceduralTerrain {
    override baseDensityAt(x: number): number { return x; }
  }
  const scene = new Scene();
  const terrain = new WallTerrain('remesh-in-place');
  const manager = new TerrainManager(scene, terrain, { synchronousBudget: Number.POSITIVE_INFINITY });
  const position = new Vector3();
  manager.update(position, position);
  const active = (manager as unknown as { active: Map<string, { revision: number }> }).active;
  const chunk = active.get('0,0,0');
  assert.ok(chunk);
  const initialRevision = chunk.revision;

  assert.equal(manager.applyPulseCarve(new Vector3(-8, 0, -20), new Vector3(-8, 0, 20), 16).applied, true);
  assert.equal(manager.applyPulseCarve(new Vector3(-8, 20, -20), new Vector3(-8, 20, 20), 16).applied, true);
  assert.equal(chunk.revision, initialRevision, 'old visible mesh stays installed until regeneration');
  assert.ok(manager.generationStats.coalescedRequests > 0);

  manager.update(position, position);
  assert.equal(active.get('0,0,0'), chunk);
  assert.ok(chunk.revision > initialRevision);
  assert.equal(manager.generationStats.queued, 0);
  manager.dispose();
});

test('route center has meaningful absolute altitude variation', () => {
  const terrain = new ProceduralTerrain('altitude-variation');
  const samples = Array.from({ length: 161 }, (_, index) => terrain.sample(index * 125).y);
  assert.ok(Math.max(...samples) - Math.min(...samples) > 45);
});
