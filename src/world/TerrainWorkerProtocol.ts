import type { VolumeChunkCoordinate } from './VolumeMesher.ts';
import type { TerrainGenerationSettings } from '../flight/FlightTuning.ts';

export interface TerrainWorkerRequest {
  requestId: number;
  seed: string;
  generationSettings: TerrainGenerationSettings;
  chunk: VolumeChunkCoordinate;
  revision: number;
  carves: Float64Array;
  baseDensity?: Float32Array;
  baseCrystal?: Uint8Array;
}

export interface TerrainWorkerResponse {
  requestId: number;
  chunk: VolumeChunkCoordinate;
  revision: number;
  vertices: ArrayBuffer;
  baseDensity: ArrayBuffer;
  baseCrystal: ArrayBuffer;
  crystal: ArrayBuffer;
  baseMaximum: number;
}
