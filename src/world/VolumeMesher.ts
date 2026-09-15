import { TERRAIN } from '../core/config.ts';
import type { ProceduralTerrain } from './TerrainModel.ts';

const CUBE_CORNERS = [
  [0, 0, 0], [1, 0, 0], [1, 1, 0], [0, 1, 0],
  [0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1],
] as const;

// Six tetrahedra sharing the 0 -> 6 cube diagonal. This avoids the large
// Marching Cubes case table while retaining interpolated 3D isosurfaces.
const TETRAHEDRA = [
  [0, 5, 1, 6],
  [0, 1, 2, 6],
  [0, 2, 3, 6],
  [0, 3, 7, 6],
  [0, 7, 4, 6],
  [0, 4, 5, 6],
] as const;

const TETRA_EDGES = [
  [0, 1], [1, 2], [2, 0], [0, 3], [1, 3], [2, 3],
] as const;

const TRIANGLE_EDGES: readonly (readonly number[])[] = [
  [], [0, 3, 2], [0, 1, 4], [1, 4, 2, 2, 4, 3],
  [1, 2, 5], [0, 3, 5, 0, 5, 1], [0, 2, 5, 0, 5, 4], [5, 4, 3],
  [3, 4, 5], [4, 5, 0, 5, 2, 0], [1, 5, 0, 5, 3, 0], [5, 2, 1],
  [3, 4, 2, 2, 4, 1], [4, 1, 0], [2, 3, 0], [],
];

function determinant3(
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  cx: number, cy: number, cz: number,
): number {
  return ax * (by * cz - bz * cy)
    - bx * (ay * cz - az * cy)
    + cx * (ay * bz - az * by);
}

/** Piecewise-linear density interpolation matching the tetrahedra used by
 * polygonizeDensityChunk. The returned zero crossing therefore agrees with
 * the visible triangle planes, including ceilings and side walls.
 */
export function interpolateDensityCell(
  densities: ArrayLike<number>,
  tx: number,
  ty: number,
  tz: number,
): number {
  for (const tetrahedron of TETRAHEDRA) {
    const a = CUBE_CORNERS[tetrahedron[0]];
    const b = CUBE_CORNERS[tetrahedron[1]];
    const c = CUBE_CORNERS[tetrahedron[2]];
    const d = CUBE_CORNERS[tetrahedron[3]];
    const bax = b[0] - a[0]; const bay = b[1] - a[1]; const baz = b[2] - a[2];
    const cax = c[0] - a[0]; const cay = c[1] - a[1]; const caz = c[2] - a[2];
    const dax = d[0] - a[0]; const day = d[1] - a[1]; const daz = d[2] - a[2];
    const pax = tx - a[0]; const pay = ty - a[1]; const paz = tz - a[2];
    const determinant = determinant3(bax, bay, baz, cax, cay, caz, dax, day, daz);
    const wb = determinant3(pax, pay, paz, cax, cay, caz, dax, day, daz) / determinant;
    const wc = determinant3(bax, bay, baz, pax, pay, paz, dax, day, daz) / determinant;
    const wd = determinant3(bax, bay, baz, cax, cay, caz, pax, pay, paz) / determinant;
    const wa = 1 - wb - wc - wd;
    if (wa < -1e-7 || wb < -1e-7 || wc < -1e-7 || wd < -1e-7) continue;
    return densities[tetrahedron[0]] * wa
      + densities[tetrahedron[1]] * wb
      + densities[tetrahedron[2]] * wc
      + densities[tetrahedron[3]] * wd;
  }
  // Floating-point edge case only; the cube diagonal belongs to all six tets.
  return densities[0];
}

export class Float32MeshBuffer {
  data = new Float32Array(4_096);
  length = 0;

  reset(): void {
    this.length = 0;
  }

  copyFrom(source: Float32Array): void {
    if (this.data.length < source.length) {
      let capacity = this.data.length;
      while (capacity < source.length) capacity *= 2;
      this.data = new Float32Array(capacity);
    }
    this.data.set(source, 0);
    this.length = source.length;
  }

  push(x: number, y: number, z: number): void {
    if (this.length + 3 > this.data.length) {
      const next = new Float32Array(this.data.length * 2);
      next.set(this.data);
      this.data = next;
    }
    this.data[this.length] = x;
    this.data[this.length + 1] = y;
    this.data[this.length + 2] = z;
    this.length += 3;
  }

  get vertexCount(): number {
    return this.length / 3;
  }
}

export interface VolumeChunkCoordinate {
  x: number;
  y: number;
  z: number;
}

export function polygonizeDensityChunk(
  chunk: VolumeChunkCoordinate,
  terrain: ProceduralTerrain,
  output: Float32MeshBuffer,
): void {
  output.reset();
  const resolution = TERRAIN.segments;
  const pointsPerAxis = resolution + 1;
  const cellSize = TERRAIN.chunkSize / resolution;
  const baseX = chunk.x * TERRAIN.chunkSize;
  const baseY = chunk.y * TERRAIN.chunkSize;
  const baseZ = chunk.z * TERRAIN.chunkSize;
  const densities = new Float32Array(pointsPerAxis ** 3);
  const sampleIndex = (x: number, y: number, z: number): number => (
    x + pointsPerAxis * (y + pointsPerAxis * z)
  );

  for (let z = 0; z <= resolution; z += 1) {
    const worldZ = baseZ + z * cellSize;
    for (let y = 0; y <= resolution; y += 1) {
      const worldY = baseY + y * cellSize;
      for (let x = 0; x <= resolution; x += 1) {
        densities[sampleIndex(x, y, z)] = terrain.densityAt(
          baseX + x * cellSize,
          worldY,
          worldZ,
        );
      }
    }
  }

  const cubeDensity = new Float32Array(8);
  for (let z = 0; z < resolution; z += 1) {
    for (let y = 0; y < resolution; y += 1) {
      for (let x = 0; x < resolution; x += 1) {
        let insideCount = 0;
        for (let corner = 0; corner < 8; corner += 1) {
          const offset = CUBE_CORNERS[corner];
          const density = densities[sampleIndex(x + offset[0], y + offset[1], z + offset[2])];
          cubeDensity[corner] = density;
          if (density > 0) insideCount += 1;
        }
        if (insideCount === 0 || insideCount === 8) continue;

        for (const tetrahedron of TETRAHEDRA) {
          let caseIndex = 0;
          for (let vertex = 0; vertex < 4; vertex += 1) {
            if (cubeDensity[tetrahedron[vertex]] > 0) caseIndex |= 1 << vertex;
          }
          const triangleEdges = TRIANGLE_EDGES[caseIndex];
          for (const edgeIndex of triangleEdges) {
            const edge = TETRA_EDGES[edgeIndex];
            const cornerA = tetrahedron[edge[0]];
            const cornerB = tetrahedron[edge[1]];
            const densityA = cubeDensity[cornerA];
            const densityB = cubeDensity[cornerB];
            const denominator = densityA - densityB;
            const amount = Math.abs(denominator) < 1e-8 ? 0.5 : densityA / denominator;
            const a = CUBE_CORNERS[cornerA];
            const b = CUBE_CORNERS[cornerB];
            output.push(
              (x + a[0] + (b[0] - a[0]) * amount) * cellSize,
              (y + a[1] + (b[1] - a[1]) * amount) * cellSize,
              (z + a[2] + (b[2] - a[2]) * amount) * cellSize,
            );
          }
        }
      }
    }
  }
}
