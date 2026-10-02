import { ProceduralTerrain } from './TerrainModel.ts';
import {
  densityLatticeLength,
  Float32MeshBuffer,
  latticeMaximum,
  polygonizeDensityLattice,
  sampleDensityLattice,
  sampleCrystalLattice,
} from './VolumeMesher.ts';
import { applyCarveSnapshotToLattice, isValidCarveSnapshot } from './TerrainCarve.ts';
import type { TerrainWorkerRequest, TerrainWorkerResponse } from './TerrainWorkerProtocol.ts';

interface WorkerScope {
  onmessage: ((event: MessageEvent<TerrainWorkerRequest>) => void) | null;
  postMessage(message: TerrainWorkerResponse, transfer: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;
const output = new Float32MeshBuffer();
const carvedDensity = new Float32Array(densityLatticeLength());
let activeSeed = '';
let terrain: ProceduralTerrain | undefined;

workerScope.onmessage = ({ data }): void => {
  if (!terrain || data.seed !== activeSeed) {
    activeSeed = data.seed;
    terrain = new ProceduralTerrain(activeSeed);
  }

  if (
    !Number.isInteger(data.requestId)
    || !Number.isInteger(data.revision)
    || !data.chunk
    || !Number.isInteger(data.chunk.x)
    || !Number.isInteger(data.chunk.y)
    || !Number.isInteger(data.chunk.z)
    || !(data.carves instanceof Float64Array)
    || !isValidCarveSnapshot(data.carves)
  ) {
    throw new RangeError('Malformed terrain carve snapshot');
  }
  const baseDensity = data.baseDensity?.length === densityLatticeLength()
    ? data.baseDensity
    : sampleDensityLattice(data.chunk, { densityAt: terrain.baseDensityAt.bind(terrain) });
  const baseMaximum = latticeMaximum(baseDensity);
  const baseCrystal = data.baseCrystal?.length === densityLatticeLength()
    ? data.baseCrystal
    : sampleCrystalLattice(data.chunk, terrain);
  const density = data.carves.length === 0
    ? baseDensity
    : applyCarveSnapshotToLattice(data.chunk, baseDensity, data.carves, carvedDensity);
  polygonizeDensityLattice(density, output, baseCrystal);
  // Transfer only live vertices. The worker keeps its reusable growth buffer;
  // the render thread receives ownership without serializing a large array.
  const vertices = output.data.slice(0, output.length);
  const crystal = output.crystal.slice(0, output.vertexCount);
  workerScope.postMessage(
    {
      requestId: data.requestId,
      chunk: data.chunk,
      revision: data.revision,
      vertices: vertices.buffer,
      baseDensity: baseDensity.buffer as ArrayBuffer,
      baseCrystal: baseCrystal.buffer as ArrayBuffer,
      crystal: crystal.buffer,
      baseMaximum,
    },
    [vertices.buffer, crystal.buffer, baseDensity.buffer, baseCrystal.buffer],
  );
};
