import type { Quaternion, Vector3 } from 'three';

export type FlightMode = 'loading' | 'autopilot' | 'manual' | 'crashed' | 'paused';
export type CameraMode = 'cockpit' | 'chase' | 'far-chase';
export type ExperienceMode = 'ambient' | 'analysis';
export type DriftTier = 0 | 1 | 2 | 3;
export type BoostState = 'cruise' | 'normal-boost' | 'drift-boost';
export type EnergyActivity = 'idle' | 'charging' | 'banked' | 'decaying';
export type FlightImpactSource = 'terrain' | 'meteor';

export interface FlightImpactSnapshot {
  readonly point: Vector3;
  readonly localPoint: Vector3;
  readonly normal: Vector3;
  readonly surfaceVelocity: Vector3;
  readonly relativeVelocityBefore: Vector3;
  readonly relativeVelocityAfter: Vector3;
  readonly tangentialDirection: Vector3;
  readonly normalSpeed: number;
  readonly tangentialSpeed: number;
  readonly dissipatedEnergy: number;
  readonly dissipatedSpeed: number;
  readonly severity: number;
  readonly source: FlightImpactSource;
  /** True for the first step of a contact, false while an existing scrape continues. */
  readonly initialContact: boolean;
}

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
  sample(worldZ: number, target?: FlightPathSample): FlightPathSample;
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
  explosionVelocity?: Vector3;
  effectiveVelocity?: Vector3;
  slipVector?: Vector3;
  slipSpeed?: number;
  normalizedSlip?: number;
  slipIntensity?: number;
  driftAngle?: number;
  driftEnergy?: number;
  driftTier?: DriftTier;
  boostState?: BoostState;
  energyActivity?: EnergyActivity;
  currentChargeRate?: number;
  currentDrainRate?: number;
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
  boostHeld?: boolean;
  boostPressed?: boolean;
  boostReleased?: boolean;
}
