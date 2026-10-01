/** Deterministic CPU profile. Run with:
 * node --experimental-strip-types tests/pulse-cannon-profile.ts
 */
import { performance } from 'node:perf_hooks';
import { Vector3 } from 'three';
import { ImpactSystem } from '../src/combat/ImpactSystem.ts';
import { MeteorSystem } from '../src/combat/MeteorSystem.ts';
import { PulseCannonSystem } from '../src/combat/PulseCannonSystem.ts';
import { PulseCannonView } from '../src/combat/PulseCannonView.ts';
import { RockLibrary } from '../src/combat/geometry.ts';
import { DEFAULT_COMBAT } from '../src/combat/settings.ts';
import { TERRAIN } from '../src/core/config.ts';
import { TerrainCarveField, applyCarveSnapshotToLattice } from '../src/world/TerrainCarve.ts';
import { ProceduralTerrain } from '../src/world/TerrainModel.ts';
import {
  Float32MeshBuffer,
  polygonizeDensityLattice,
  sampleDensityLattice,
} from '../src/world/VolumeMesher.ts';

interface Stats { mean: number; p50: number; p95: number; p99: number; max: number }
function stats(values: number[]): Stats {
  const sorted = [...values].sort((a, b) => a - b);
  const at = (fraction: number): number => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * fraction))] ?? 0;
  return {
    mean: values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length),
    p50: at(0.5), p95: at(0.95), p99: at(0.99), max: sorted.at(-1) ?? 0,
  };
}

function time(runs: number, action: (index: number) => void): Stats {
  const values: number[] = [];
  for (let run = 0; run < runs; run += 1) {
    const start = performance.now();
    action(run);
    values.push(performance.now() - start);
  }
  return stats(values.slice(Math.min(5, Math.floor(runs / 10))));
}

function broadChunkCount(start: Vector3, end: Vector3, radius: number): number {
  const range = (a: number, b: number): number => (
    Math.floor((Math.max(a, b) + radius + 1e-7) / TERRAIN.chunkSize)
    - Math.floor((Math.min(a, b) - radius - 1e-7) / TERRAIN.chunkSize) + 1
  );
  return range(start.x, end.x) * range(start.y, end.y) * range(start.z, end.z);
}

const seed = 'pulse-cannon-profile';
const radii = [16, 30, 60, 80];
const straightStart = new Vector3(0, 0, 60);
const straightEnd = new Vector3(0, 0, 420);
const diagonalDirection = new Vector3(1, 1, 1).normalize();
const diagonalStart = diagonalDirection.clone().multiplyScalar(60);
const diagonalEnd = diagonalDirection.clone().multiplyScalar(420);
const radiusScaling = Object.fromEntries(radii.map((radius) => {
  const straight = new TerrainCarveField().addCapsule(
    straightStart.x, straightStart.y, straightStart.z,
    straightEnd.x, straightEnd.y, straightEnd.z, radius,
  );
  const diagonal = new TerrainCarveField().addCapsule(
    diagonalStart.x, diagonalStart.y, diagonalStart.z,
    diagonalEnd.x, diagonalEnd.y, diagonalEnd.z, radius,
  );
  return [`${radius}m`, {
    straight: { broadCandidates: broadChunkCount(straightStart, straightEnd, radius), exactChunks: straight.affectedChunks.length },
    diagonal: { broadCandidates: broadChunkCount(diagonalStart, diagonalEnd, radius), exactChunks: diagonal.affectedChunks.length },
  }];
}));

const points = Array.from({ length: 20_000 }, (_, index) => ({
  x: Math.sin(index * 0.71) * 90,
  y: Math.cos(index * 0.37) * 90,
  z: 64 + (index % 300) * 0.9,
}));
const fields = [0, 1, 8, 64].map((count) => {
  const field = new TerrainCarveField();
  for (let index = 0; index < count; index += 1) {
    const angle = index * 2.399963229728653;
    const offset = index * 2.1;
    field.addCapsule(
      Math.cos(angle) * 25, Math.sin(angle) * 25, 40 + offset,
      Math.cos(angle) * 25, Math.sin(angle) * 25, 400 + offset,
      16 + index % 5,
    );
  }
  return field;
});
const densityLookupMs = Object.fromEntries(fields.map((field, index) => {
  const count = [0, 1, 8, 64][index];
  return [`${count}Capsules`, time(20, () => {
    for (const point of points) field.applyDensity(20, point.x, point.y, point.z);
  })];
}));

const terrain = new ProceduralTerrain(seed);
const path = terrain.sample(0);
let wallX = path.x;
for (let offset = 0; offset < 320; offset += 2) {
  if (terrain.baseDensityAt(path.x + offset, path.y, 0) >= 0) { wallX = path.x + offset; break; }
}
const chunk = {
  x: Math.floor(wallX / TERRAIN.chunkSize),
  y: Math.floor(path.y / TERRAIN.chunkSize),
  z: 0,
};
const baseLattice = sampleDensityLattice(chunk, { densityAt: terrain.baseDensityAt.bind(terrain) });
const oneField = new TerrainCarveField();
oneField.addCapsule(wallX - 30, path.y, -40, wallX - 30, path.y, 180, 60);
const manyField = new TerrainCarveField();
for (let index = 0; index < 8; index += 1) {
  manyField.addCapsule(wallX - 30 + index * 2.5, path.y + index * 2.1, -40, wallX - 30 + index * 2.5, path.y + index * 2.1, 180, 38);
}
const oneSnapshot = oneField.snapshotForChunk(chunk);
const manySnapshot = manyField.snapshotForChunk(chunk);
const carved = new Float32Array(baseLattice.length);
const mesh = new Float32MeshBuffer();
const polygonizationMs = {
  cachedBase: time(60, () => polygonizeDensityLattice(baseLattice, mesh)),
  cachedOneCapsule: time(60, () => {
    applyCarveSnapshotToLattice(chunk, baseLattice, oneSnapshot, carved);
    polygonizeDensityLattice(carved, mesh);
  }),
  cachedEightCapsules: time(60, () => {
    applyCarveSnapshotToLattice(chunk, baseLattice, manySnapshot, carved);
    polygonizeDensityLattice(carved, mesh);
  }),
  uncachedOneCapsule: time(30, () => {
    const uncached = sampleDensityLattice(chunk, { densityAt: terrain.baseDensityAt.bind(terrain) });
    applyCarveSnapshotToLattice(chunk, uncached, oneSnapshot, carved);
    polygonizeDensityLattice(carved, mesh);
  }),
};

const activationMs = Object.fromEntries(radii.map((radius) => [`${radius}m`, time(200, (index) => {
  const field = new TerrainCarveField();
  field.addCapsule(index * 1000, 0, 60, index * 1000, 0, 420, radius);
})]));

const air = {
  densityAt: () => -1000,
  sample: () => ({ x: 0, y: 0, tangentX: 0, tangentY: 0, openness: 1, width: 100, height: 100, floorY: -100 }),
};
const library = new RockLibrary(seed);
const meteorIntersectionMs = Object.fromEntries([0, 12, 48].map((count) => {
  const meteors = new MeteorSystem(air, library, `${seed}:${count}`);
  const result = time(count === 48 ? 80 : 250, () => {
    meteors.reset();
    for (let index = 0; index < count; index += 1) {
      const angle = index * Math.PI * 2 / Math.max(1, count);
      meteors.spawnAt(new Vector3(Math.cos(angle) * 40, Math.sin(angle) * 40, 80 + index * 6), 12, index % library.variants.length);
    }
    meteors.destroyInCapsule(straightStart, straightEnd, 60, new Vector3(0, 0, 1));
  });
  meteors.dispose();
  return [`${count}Meteors`, result];
}));

const pulse = new PulseCannonSystem();
pulse.configure({ ...DEFAULT_COMBAT, pulseDuration: 100, pulseRadius: 80 });
pulse.requestFire();
pulse.tryFire(new Vector3(), new Vector3(0, 0, 1));
const pulseView = new PulseCannonView(pulse, seed);
const beamSyncMs = time(5_000, (index) => {
  pulse.shot.age = index / 120 % 1;
  pulseView.sync(new Vector3(index % 20 === 0 ? 128 : 0, 0, 0));
});

const impacts = new ImpactSystem(library, seed);
impacts.configure({ ...DEFAULT_COMBAT, fragmentCount: 12, fragmentLife: 100 });
const effectMeteors = new MeteorSystem(air, library, `${seed}:effects`);
const source = effectMeteors.spawnAt(new Vector3(), 12, 0)!;
for (let index = 0; index < 48; index += 1) impacts.spawn(source, new Vector3(), new Vector3(0, 0, 1));
const effectsUpdateMs = time(2_000, () => impacts.update(1 / 120, new Vector3()));

const soakField = new TerrainCarveField();
const soakMs = time(1, () => {
  for (let index = 0; index < 1_000; index += 1) {
    soakField.addCapsule(index * 150, 0, 0, index * 150, 0, 360, 60);
  }
});
const retainedBytesEstimate = soakField.size * 72 + soakField.indexReferenceCount * 8;

const heap = process.memoryUsage();
console.log(JSON.stringify({
  environment: {
    node: process.version,
    platform: process.platform,
    arch: process.arch,
    cpuProfileScope: 'CPU-only Node profile; excludes WebGL GPU, worker transfer, browser scheduling, and device thermal behavior',
  },
  seed,
  samples: {
    densityQueriesPerPass: points.length,
    latticeSamples: baseLattice.length,
    polygonizationRuns: 60,
    beamSyncFrames: 5_000,
    effectsFrames: 2_000,
  },
  radiusScaling,
  activationMs,
  densityLookupMs,
  polygonizationMs,
  oneCapsuleCachedOverheadPercent: (polygonizationMs.cachedOneCapsule.mean / polygonizationMs.cachedBase.mean - 1) * 100,
  meteorIntersectionMs,
  beamSimulationAndUploadMs: beamSyncMs,
  fullEffectsUpdateMs: effectsUpdateMs,
  persistentHistory: {
    shots: soakField.size,
    indexReferences: soakField.indexReferenceCount,
    estimatedBytes: retainedBytesEstimate,
    estimatedBytesPerShot: retainedBytesEstimate / soakField.size,
    insertionMs: soakMs,
  },
  heapBytes: { rss: heap.rss, heapUsed: heap.heapUsed },
}, null, 2));

pulseView.dispose();
impacts.dispose();
effectMeteors.dispose();
library.dispose();
