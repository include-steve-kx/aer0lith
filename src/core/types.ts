import type { Quaternion, Vector3 } from 'three';

export type FlightMode = 'loading' | 'autopilot' | 'manual' | 'crashed' | 'paused';
export type CameraMode = 'cockpit' | 'chase' | 'far-chase';
export type ExperienceMode = 'ambient' | 'analysis';
export type DriftTier = 0 | 1 | 2 | 3;
export type DriftState = 'cruise' | 'drift' | 'banked' | 'drift-boost' | 'normal-boost';

export interface FlightPathSample {
  x: number;
  /** Centre altitude of the guaranteed navigable air vein. */
  y: number;
  floorY: number;
  tangentX: number;
  tangentY: number;
  width: number;
  height: number;
  openness: number;
}

export interface FlightPath {
  sample(worldZ: number): FlightPathSample;
}

export interface TerrainSampler {
  /** Positive values are solid; negative values are navigable air. */
  densityAt(worldX: number, worldY: number, worldZ: number): number;
  collisionDensityAt?(worldX: number, worldY: number, worldZ: number): number;
}

export interface FlightSnapshot {
  mode: FlightMode;
  camera: CameraMode;
  position: Vector3;
  orientation: Quaternion;
  speed: number;
  throttle: number;
  altitude: number;
  seed: string;
  audioEnabled: boolean;
  controlVelocity?: Vector3;
  driftAngle?: number;
  driftEnergy?: number;
  driftTier?: DriftTier;
  driftState?: DriftState;
  boostKickAvailable?: boolean;
}

export interface SafeCheckpoint {
  position: Vector3;
  yaw: number;
  pitch: number;
  roll: number;
  speed: number;
  throttle: number;
}

export interface FlightInput {
  pitch: number;
  roll: number;
  yaw: number;
  throttle: number;
  driftHeld?: boolean;
  driftPressed?: boolean;
  boostHeld?: boolean;
  boostPressed?: boolean;
  boostReleased?: boolean;
}
