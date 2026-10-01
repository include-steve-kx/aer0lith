import { ProceduralTerrain } from './TerrainModel.ts';
import {
  densityLatticeLength,
  Float32MeshBuffer,
  latticeMaximum,
  polygonizeDensityLattice,
  sampleDensityLattice,
} from './VolumeMesher.ts';
import { applyCarveSnapshotToLattice, TERRAIN_CARVE_STRIDE } from './TerrainCarve.ts';
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

  if (!(data.carves instanceof Float64Array) || data.carves.length % TERRAIN_CARVE_STRIDE !== 0) {
    throw new RangeError('Malformed terrain carve snapshot');
  }
  const baseDensity = data.baseDensity?.length === densityLatticeLength()
    ? data.baseDensity
    : sampleDensityLattice(data.chunk, { densityAt: terrain.baseDensityAt.bind(terrain) });
  const baseMaximum = latticeMaximum(baseDensity);
  const density = data.carves.length === 0
    ? baseDensity
    : applyCarveSnapshotToLattice(data.chunk, baseDensity, data.carves, carvedDensity);
  polygonizeDensityLattice(density, output);
  // Transfer only live vertices. The worker keeps its reusable growth buffer;
  // the render thread receives ownership without serializing a large array.
  const vertices = output.data.slice(0, output.length);
  workerScope.postMessage(
    {
      requestId: data.requestId,
      chunk: data.chunk,
      revision: data.revision,
      vertices: vertices.buffer,
      baseDensity: baseDensity.buffer as ArrayBuffer,
      baseMaximum,
    },
    [vertices.buffer, baseDensity.buffer],
  );
};
