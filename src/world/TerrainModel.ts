import { Vector3 } from 'three';
import { TERRAIN } from '../core/config.ts';
import type { FlightPath, FlightPathSample, TerrainSampler } from '../core/types.ts';
import { SeededNoise } from './Noise.ts';
import { interpolateDensityCell } from './VolumeMesher.ts';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function smoothstep(edge0: number, edge1: number, value: number): number {
  const x = clamp((value - edge0) / (edge1 - edge0), 0, 1);
  return x * x * (3 - 2 * x);
}

/**
 * Deterministic alien-world density field.
 *
 * Positive density is rock and negative density is air. A warped porous shell
 * surrounds an endlessly varying 3D route. A small central tube is carved out
 * after every other field operation, guaranteeing that autopilot always has a
 * route even when the surrounding chambers and apertures become extreme.
 */
export class ProceduralTerrain implements TerrainSampler, FlightPath {
  readonly noise: SeededNoise;
  readonly seedText: string;

  constructor(seed: string) {
    this.seedText = seed;
    this.noise = new SeededNoise(seed);
  }

  sample(worldZ: number): FlightPathSample {
    const seedPhase = this.noise.seed * 0.000013;
    const routeX = (z: number): number => (
      this.noise.fbm(z * 0.00175, 19.7, 4) * 245
      + Math.sin(z * 0.0031 + seedPhase) * 72
      + Math.sin(z * 0.00072 - seedPhase * 0.41) * 54
    );
    const routeY = (z: number): number => (
      42
      + this.noise.fbm(z * 0.00082, 41.2, 4) * 118
      + this.noise.fbm(z * 0.0026, -73.8, 3) * 30
      + Math.sin(z * 0.00068 + seedPhase) * 45
    );

    const x = routeX(worldZ);
    const y = routeY(worldZ);
    const look = 2;
    const tangentX = (routeX(worldZ + look) - x) / look;
    const tangentY = (routeY(worldZ + look) - y) / look;
    const chamberSignal = (
      this.noise.fbm(worldZ * 0.00105, -8.4, 4)
      + this.noise.noise2(worldZ * 0.00037 + 71, seedPhase) * 0.45
    );
    const openness = smoothstep(-0.48, 0.58, chamberSignal);
    const constriction = smoothstep(
      0.62,
      0.94,
      Math.abs(this.noise.noise2(worldZ * 0.0033 - 12, seedPhase + 5.1)),
    );
    const width = Math.max(30, 42 + Math.pow(openness, 1.55) * 142 - constriction * 24);
    const height = Math.max(25, 31 + Math.pow(openness, 1.38) * 116 - constriction * 19);

    return {
      x,
      y,
      floorY: y - height,
      tangentX,
      tangentY,
      width,
      height,
      openness,
    };
  }

  densityAt(worldX: number, worldY: number, worldZ: number): number {
    const path = this.sample(worldZ);
    const dx = worldX - path.x;
    const dy = worldY - path.y;
    const normalizedRadius = Math.hypot(dx / path.width, dy / path.height);
    const shellDistance = (normalizedRadius - 1) * Math.min(path.width, path.height);

    // Low-frequency 3D domain warping destroys the tell-tale stacked-noise look.
    const warpScale = 0.00235;
    const warpX = this.noise.noise3(
      worldX * warpScale + 13.1,
      worldY * warpScale - 7.4,
      worldZ * warpScale + 29.7,
    ) * 31;
    const warpY = this.noise.noise3(
      worldX * warpScale - 37.2,
      worldY * warpScale + 19.8,
      worldZ * warpScale - 4.3,
    ) * 25;
    const warpZ = this.noise.noise3(
      worldX * warpScale + 5.7,
      worldY * warpScale + 42.5,
      worldZ * warpScale - 31.6,
    ) * 29;
    const wx = worldX + warpX;
    const wy = worldY + warpY;
    const wz = worldZ + warpZ;

    const broad = this.noise.fbm3(wx * 0.0092, wy * 0.0092, wz * 0.0092, 3) * 11.5;
    const detail = this.noise.noise3(wx * 0.024, wy * 0.024, wz * 0.024) * 3.2;
    const gyroid = (
      Math.sin(wx * 0.031) * Math.cos(wy * 0.027)
      + Math.sin(wy * 0.027) * Math.cos(wz * 0.029)
      + Math.sin(wz * 0.029) * Math.cos(wx * 0.031)
    );
    let density = shellDistance + broad + detail + gyroid * 2.8;

    // Sparse gyroid lobes become freestanding ribs, bridges, and perforated
    // masses inside larger chambers. They are deliberately rarer in narrow
    // passages, and the guaranteed route carve below always wins.
    const formationThreshold = 1.43 - path.openness * 0.2;
    const formationDensity = (Math.abs(gyroid) - formationThreshold) * 8.5
      + this.noise.noise3(wx * 0.013 - 6, wy * 0.013 + 11, wz * 0.013 + 3) * 1.6;
    density = Math.max(density, formationDensity);

    // A second field cuts holes and branching pockets close to the chamber wall.
    if (Math.abs(shellDistance) < 44) {
      const poreField = Math.abs(this.noise.fbm3(
        wx * 0.0061 + 17,
        wy * 0.0061 - 23,
        wz * 0.0061 + 9,
        3,
      ));
      const porousVoid = (poreField - 0.115) * 72 + Math.max(0, Math.abs(shellDistance) - 30);
      density = Math.min(density, porousVoid);
    }

    // Absolute safety invariant: no procedural layer may fill this route core.
    const guaranteedAir = Math.hypot(dx, dy) - 28;
    return Math.min(density, guaranteedAir);
  }

  /** Density interpolation over the exact tetrahedra used by the visible mesh. */
  collisionDensityAt(worldX: number, worldY: number, worldZ: number): number {
    const cellSize = TERRAIN.chunkSize / TERRAIN.segments;
    const x0 = Math.floor(worldX / cellSize) * cellSize;
    const y0 = Math.floor(worldY / cellSize) * cellSize;
    const z0 = Math.floor(worldZ / cellSize) * cellSize;
    const x1 = x0 + cellSize;
    const y1 = y0 + cellSize;
    const z1 = z0 + cellSize;
    const densities = [
      this.densityAt(x0, y0, z0),
      this.densityAt(x1, y0, z0),
      this.densityAt(x1, y1, z0),
      this.densityAt(x0, y1, z0),
      this.densityAt(x0, y0, z1),
      this.densityAt(x1, y0, z1),
      this.densityAt(x1, y1, z1),
      this.densityAt(x0, y1, z1),
    ];
    return interpolateDensityCell(
      densities,
      (worldX - x0) / cellSize,
      (worldY - y0) / cellSize,
      (worldZ - z0) / cellSize,
    );
  }

  densityNormalAt(worldX: number, worldY: number, worldZ: number, target: Vector3): Vector3 {
    const step = 0.75;
    const dx = this.densityAt(worldX + step, worldY, worldZ)
      - this.densityAt(worldX - step, worldY, worldZ);
    const dy = this.densityAt(worldX, worldY + step, worldZ)
      - this.densityAt(worldX, worldY - step, worldZ);
    const dz = this.densityAt(worldX, worldY, worldZ + step)
      - this.densityAt(worldX, worldY, worldZ - step);
    return target.set(dx, dy, dz).normalize();
  }

  routeDistanceAt(worldX: number, worldY: number, worldZ: number): number {
    const path = this.sample(worldZ);
    return Math.hypot(worldX - path.x, worldY - path.y);
  }
}
