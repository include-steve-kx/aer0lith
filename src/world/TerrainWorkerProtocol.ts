import type { VolumeChunkCoordinate } from './VolumeMesher.ts';

export interface TerrainWorkerRequest {
  requestId: number;
  seed: string;
  chunk: VolumeChunkCoordinate;
  revision: number;
  carves: Float64Array;
  baseDensity?: Float32Array;
}

export interface TerrainWorkerResponse {
  requestId: number;
  chunk: VolumeChunkCoordinate;
  revision: number;
  vertices: ArrayBuffer;
  baseDensity: ArrayBuffer;
  baseMaximum: number;
}
