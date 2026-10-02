import assert from 'node:assert/strict';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import {
  Float32MeshBuffer,
  polygonizeDensityLattice,
  sampleCrystalLattice,
  sampleDensityLattice,
} from '../src/world/VolumeMesher.ts';

const terrain = new ProceduralTerrain('crystal-performance');
const chunks = [
  { x: -1, y: 0, z: 2 },
  { x: 0, y: 0, z: 2 },
  { x: 1, y: -1, z: 3 },
];
const output = new Float32MeshBuffer();

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

function measure(run: () => void, samples = 18): number {
  for (let index = 0; index < 3; index += 1) run();
  const times: number[] = [];
  for (let index = 0; index < samples; index += 1) {
    const start = performance.now();
    run();
    times.push(performance.now() - start);
  }
  return median(times);
}

let chunkIndex = 0;
const uncachedRockMs = measure(() => {
  const chunk = chunks[chunkIndex++ % chunks.length];
  polygonizeDensityLattice(sampleDensityLattice(chunk, terrain), output);
});
chunkIndex = 0;
const uncachedCrystalMs = measure(() => {
  const chunk = chunks[chunkIndex++ % chunks.length];
  const density = sampleDensityLattice(chunk, terrain);
  polygonizeDensityLattice(density, output, sampleCrystalLattice(chunk, terrain));
});

const density = sampleDensityLattice(chunks[1], terrain);
const crystal = sampleCrystalLattice(chunks[1], terrain);
const cachedRockMs = measure(() => polygonizeDensityLattice(density, output), 40);
const cachedCrystalMs = measure(() => polygonizeDensityLattice(density, output, crystal), 40);
const uncachedRegression = uncachedCrystalMs / uncachedRockMs - 1;
const cachedRegression = cachedCrystalMs / cachedRockMs - 1;

console.log(JSON.stringify({
  uncachedRockMs,
  uncachedCrystalMs,
  uncachedRegression,
  cachedRockMs,
  cachedCrystalMs,
  cachedRegression,
  vertices: output.vertexCount,
}, null, 2));

// These guardrails intentionally leave headroom for CI variance while catching
// accidental extra noise octaves, allocations, or a second polygonization.
// Cached remeshing is sub-millisecond, so its absolute overhead is more stable
// and useful than a ratio against a roughly 0.15 ms baseline.
assert.ok(uncachedRegression <= 0.35, `uncached crystal generation regressed ${(uncachedRegression * 100).toFixed(1)}%`);
assert.ok(cachedCrystalMs - cachedRockMs <= 0.15,
  `cached crystal remesh added ${(cachedCrystalMs - cachedRockMs).toFixed(3)} ms`);
