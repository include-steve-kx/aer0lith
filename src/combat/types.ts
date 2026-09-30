import type { Quaternion, Vector3, Scene, Texture } from 'three';
export interface MeteorHandle {
  slot: number;
  generation: number;
}
export interface ScanSnapshot {
  id: number;
  center: Vector3;
  previousRadius: number;
  radius: number;
  expanding: boolean;
}
export interface DynamicObstacleProvider {
  sweepShip(
    from: Vector3,
    to: Vector3,
    fromQ: Quaternion,
    toQ: Quaternion,
    cockpit: boolean,
  ): boolean;
  clearance(position: Vector3, radius: number): boolean;
  avoidance(
    dt: number,
    position: Vector3,
    speed: number,
    target: Vector3,
  ): boolean;
}
export interface RefractionContributor {
  readonly active: boolean;
  readonly scene: Scene;
  prepare(depth: Texture, width: number, height: number, time: number): void;
}
