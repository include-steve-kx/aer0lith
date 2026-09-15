import { ProceduralTerrain } from './TerrainModel.ts';
import {
  Float32MeshBuffer,
  polygonizeDensityChunk,
  type VolumeChunkCoordinate,
} from './VolumeMesher.ts';

interface TerrainWorkerRequest {
  requestId: number;
  seed: string;
  chunk: VolumeChunkCoordinate;
}

interface TerrainWorkerResponse {
  requestId: number;
  chunk: VolumeChunkCoordinate;
  vertices: ArrayBuffer;
}

interface WorkerScope {
  onmessage: ((event: MessageEvent<TerrainWorkerRequest>) => void) | null;
  postMessage(message: TerrainWorkerResponse, transfer: Transferable[]): void;
}

const workerScope = self as unknown as WorkerScope;
const output = new Float32MeshBuffer();
let activeSeed = '';
let terrain: ProceduralTerrain | undefined;

workerScope.onmessage = ({ data }): void => {
  if (!terrain || data.seed !== activeSeed) {
    activeSeed = data.seed;
    terrain = new ProceduralTerrain(activeSeed);
  }

  polygonizeDensityChunk(data.chunk, terrain, output);
  // Transfer only live vertices. The worker keeps its reusable growth buffer;
  // the render thread receives ownership without serializing a large array.
  const vertices = output.data.slice(0, output.length);
  workerScope.postMessage(
    {
      requestId: data.requestId,
      chunk: data.chunk,
      vertices: vertices.buffer,
    },
    [vertices.buffer],
  );
};

