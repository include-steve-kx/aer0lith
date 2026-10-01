import { TERRAIN } from '../core/config.ts';
import type { VolumeChunkCoordinate } from './VolumeMesher.ts';

export interface TerrainCarveCapsule {
  id: number;
  ax: number;
  ay: number;
  az: number;
  bx: number;
  by: number;
  bz: number;
  radius: number;
}

export interface TerrainCarveResult {
  applied: boolean;
  affectedChunks: readonly VolumeChunkCoordinate[];
}

type CarveBucket = Set<number>;
const BOUNDARY_EPSILON = 1e-7;
export const TERRAIN_CARVE_STRIDE = 7;

function chunkRange(minimum: number, maximum: number): [number, number] {
  return [
    Math.floor((minimum - BOUNDARY_EPSILON) / TERRAIN.chunkSize),
    Math.floor((maximum + BOUNDARY_EPSILON) / TERRAIN.chunkSize),
  ];
}

export function pointSegmentDistanceSquared(
  x: number, y: number, z: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
): number {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const lengthSquared = abx * abx + aby * aby + abz * abz;
  const t = lengthSquared > 1e-18
    ? Math.max(0, Math.min(1, ((x - ax) * abx + (y - ay) * aby + (z - az) * abz) / lengthSquared))
    : 0;
  const dx = x - (ax + abx * t);
  const dy = y - (ay + aby * t);
  const dz = z - (az + abz * t);
  return dx * dx + dy * dy + dz * dz;
}

function pointAabbDistanceSquared(
  x: number, y: number, z: number,
  minimum: readonly number[], maximum: readonly number[],
): number {
  const dx = Math.max(minimum[0] - x, 0, x - maximum[0]);
  const dy = Math.max(minimum[1] - y, 0, y - maximum[1]);
  const dz = Math.max(minimum[2] - z, 0, z - maximum[2]);
  return dx * dx + dy * dy + dz * dz;
}

/** Exact minimum squared distance between a segment and an axis-aligned box.
 * The distance is a convex piecewise quadratic over segment parameter t; box
 * boundary crossings split the intervals where its coefficients are stable. */
function segmentAabbDistanceSquared(
  capsule: Pick<TerrainCarveCapsule, 'ax' | 'ay' | 'az' | 'bx' | 'by' | 'bz'>,
  minimum: readonly number[], maximum: readonly number[],
): number {
  const start = [capsule.ax, capsule.ay, capsule.az];
  const delta = [capsule.bx - capsule.ax, capsule.by - capsule.ay, capsule.bz - capsule.az];
  const breaks = [0, 1];
  for (let axis = 0; axis < 3; axis += 1) {
    if (Math.abs(delta[axis]) < 1e-18) continue;
    for (const boundary of [minimum[axis], maximum[axis]]) {
      const t = (boundary - start[axis]) / delta[axis];
      if (t > 0 && t < 1) breaks.push(t);
    }
  }
  breaks.sort((a, b) => a - b);
  let best = Math.min(
    pointAabbDistanceSquared(capsule.ax, capsule.ay, capsule.az, minimum, maximum),
    pointAabbDistanceSquared(capsule.bx, capsule.by, capsule.bz, minimum, maximum),
  );
  for (let interval = 0; interval + 1 < breaks.length; interval += 1) {
    const low = breaks[interval], high = breaks[interval + 1];
    const middle = (low + high) * 0.5;
    let quadratic = 0, linear = 0;
    for (let axis = 0; axis < 3; axis += 1) {
      const value = start[axis] + delta[axis] * middle;
      const target = value < minimum[axis]
        ? minimum[axis]
        : value > maximum[axis] ? maximum[axis] : undefined;
      if (target === undefined) continue;
      quadratic += delta[axis] * delta[axis];
      linear += 2 * delta[axis] * (start[axis] - target);
    }
    const t = quadratic > 0
      ? Math.max(low, Math.min(high, -linear / (2 * quadratic)))
      : middle;
    best = Math.min(best, pointAabbDistanceSquared(
      start[0] + delta[0] * t,
      start[1] + delta[1] * t,
      start[2] + delta[2] * t,
      minimum,
      maximum,
    ));
  }
  return best;
}

function capsuleIntersectsChunk(
  capsule: TerrainCarveCapsule,
  chunk: VolumeChunkCoordinate,
): boolean {
  const minimum = [
    chunk.x * TERRAIN.chunkSize,
    chunk.y * TERRAIN.chunkSize,
    chunk.z * TERRAIN.chunkSize,
  ];
  const maximum = minimum.map(value => value + TERRAIN.chunkSize);
  return segmentAabbDistanceSquared(capsule, minimum, maximum)
    <= capsule.radius * capsule.radius + BOUNDARY_EPSILON;
}

function capsuleContains(outer: TerrainCarveCapsule, inner: TerrainCarveCapsule): boolean {
  const allowance = outer.radius - inner.radius;
  if (allowance < -BOUNDARY_EPSILON) return false;
  const limit = (allowance + BOUNDARY_EPSILON) ** 2;
  return pointSegmentDistanceSquared(
    inner.ax, inner.ay, inner.az,
    outer.ax, outer.ay, outer.az, outer.bx, outer.by, outer.bz,
  ) <= limit && pointSegmentDistanceSquared(
    inner.bx, inner.by, inner.bz,
    outer.ax, outer.ay, outer.az, outer.bx, outer.by, outer.bz,
  ) <= limit;
}

/** Sparse, session-local subtractive capsules indexed by terrain chunk. */
export class TerrainCarveField {
  private readonly capsules = new Map<number, TerrainCarveCapsule>();
  private readonly index = new Map<number, Map<number, Map<number, CarveBucket>>>();
  private readonly revisions = new Map<number, Map<number, Map<number, number>>>();
  private nextId = 1;
  private nextRevision = 1;

  applyDensity(baseDensity: number, x: number, y: number, z: number): number {
    const bucket = this.bucketAt(
      Math.floor(x / TERRAIN.chunkSize),
      Math.floor(y / TERRAIN.chunkSize),
      Math.floor(z / TERRAIN.chunkSize),
      false,
    );
    if (!bucket) return baseDensity;
    let density = baseDensity;
    for (const id of bucket) {
      const capsule = this.capsules.get(id);
      if (!capsule) continue;
      const influence = capsule.radius + density;
      if (influence <= 0) continue;
      const distanceSquared = pointSegmentDistanceSquared(
        x, y, z,
        capsule.ax, capsule.ay, capsule.az,
        capsule.bx, capsule.by, capsule.bz,
      );
      if (distanceSquared >= influence * influence) continue;
      density = Math.sqrt(distanceSquared) - capsule.radius;
    }
    return density;
  }

  addCapsule(
    ax: number, ay: number, az: number,
    bx: number, by: number, bz: number,
    radius: number,
  ): TerrainCarveResult {
    if (![ax, ay, az, bx, by, bz, radius].every(Number.isFinite) || radius <= 0) {
      return { applied: false, affectedChunks: [] };
    }
    const candidate: TerrainCarveCapsule = {
      id: this.nextId, ax, ay, az, bx, by, bz, radius,
    };
    const chunks = this.chunksForCapsule(candidate);
    const nearby = new Set<number>();
    for (const chunk of chunks) {
      const bucket = this.bucketAt(chunk.x, chunk.y, chunk.z, false);
      if (bucket) for (const id of bucket) nearby.add(id);
    }
    for (const id of nearby) {
      const existing = this.capsules.get(id);
      if (existing && capsuleContains(existing, candidate)) {
        return { applied: false, affectedChunks: [] };
      }
    }
    for (const id of nearby) {
      const existing = this.capsules.get(id);
      if (existing && capsuleContains(candidate, existing)) this.removeCapsule(existing);
    }
    this.nextId += 1;
    this.capsules.set(candidate.id, candidate);
    for (const chunk of chunks) this.bucketAt(chunk.x, chunk.y, chunk.z, true)!.add(candidate.id);
    for (const chunk of chunks) this.bumpRevision(chunk.x, chunk.y, chunk.z);
    return { applied: true, affectedChunks: chunks };
  }

  snapshotForChunk(chunk: VolumeChunkCoordinate): Float64Array {
    const bucket = this.bucketAt(chunk.x, chunk.y, chunk.z, false);
    if (!bucket) return new Float64Array();
    const output = new Float64Array(bucket.size * TERRAIN_CARVE_STRIDE);
    let offset = 0;
    for (const id of bucket) {
      const c = this.capsules.get(id);
      if (!c) continue;
      output[offset++] = c.ax; output[offset++] = c.ay; output[offset++] = c.az;
      output[offset++] = c.bx; output[offset++] = c.by; output[offset++] = c.bz;
      output[offset++] = c.radius;
    }
    return offset === output.length ? output : output.slice(0, offset);
  }

  revisionForChunk(chunk: VolumeChunkCoordinate): number {
    return this.revisions.get(chunk.x)?.get(chunk.y)?.get(chunk.z) ?? 0;
  }

  chunksForCapsule(capsule: TerrainCarveCapsule): VolumeChunkCoordinate[] {
    const [minX, maxX] = chunkRange(Math.min(capsule.ax, capsule.bx) - capsule.radius, Math.max(capsule.ax, capsule.bx) + capsule.radius);
    const [minY, maxY] = chunkRange(Math.min(capsule.ay, capsule.by) - capsule.radius, Math.max(capsule.ay, capsule.by) + capsule.radius);
    const [minZ, maxZ] = chunkRange(Math.min(capsule.az, capsule.bz) - capsule.radius, Math.max(capsule.az, capsule.bz) + capsule.radius);
    const chunks: VolumeChunkCoordinate[] = [];
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let y = minY; y <= maxY; y += 1) {
        for (let x = minX; x <= maxX; x += 1) {
          const chunk = { x, y, z };
          if (capsuleIntersectsChunk(capsule, chunk)) chunks.push(chunk);
        }
      }
    }
    return chunks;
  }

  get size(): number { return this.capsules.size; }

  get indexReferenceCount(): number {
    let count = 0;
    for (const ys of this.index.values()) {
      for (const zs of ys.values()) {
        for (const bucket of zs.values()) count += bucket.size;
      }
    }
    return count;
  }

  private removeCapsule(capsule: TerrainCarveCapsule): void {
    if (!this.capsules.delete(capsule.id)) return;
    for (const chunk of this.chunksForCapsule(capsule)) {
      const bucket = this.bucketAt(chunk.x, chunk.y, chunk.z, false);
      bucket?.delete(capsule.id);
      if (bucket?.size === 0) this.deleteBucket(chunk.x, chunk.y, chunk.z);
    }
  }

  private bucketAt(x: number, y: number, z: number, create: boolean): CarveBucket | undefined {
    let ys = this.index.get(x);
    if (!ys && create) { ys = new Map(); this.index.set(x, ys); }
    let zs = ys?.get(y);
    if (!zs && create) { zs = new Map(); ys!.set(y, zs); }
    let bucket = zs?.get(z);
    if (!bucket && create) { bucket = new Set(); zs!.set(z, bucket); }
    return bucket;
  }

  private deleteBucket(x: number, y: number, z: number): void {
    const ys = this.index.get(x), zs = ys?.get(y);
    zs?.delete(z);
    if (zs?.size === 0) ys?.delete(y);
    if (ys?.size === 0) this.index.delete(x);
  }

  private bumpRevision(x: number, y: number, z: number): void {
    let ys = this.revisions.get(x);
    if (!ys) { ys = new Map(); this.revisions.set(x, ys); }
    let zs = ys.get(y);
    if (!zs) { zs = new Map(); ys.set(y, zs); }
    zs.set(z, this.nextRevision++);
  }
}

function applyOneCapsuleValues(
  density: number,
  x: number, y: number, z: number,
  ax: number, ay: number, az: number,
  bx: number, by: number, bz: number,
  radius: number,
): number {
  const influence = radius + density;
  if (influence <= 0) return density;
  if (
    x < Math.min(ax, bx) - influence || x > Math.max(ax, bx) + influence
    || y < Math.min(ay, by) - influence || y > Math.max(ay, by) + influence
    || z < Math.min(az, bz) - influence || z > Math.max(az, bz) + influence
  ) return density;
  const distanceSquared = pointSegmentDistanceSquared(
    x, y, z,
    ax, ay, az, bx, by, bz,
  );
  return distanceSquared < influence * influence
    ? Math.sqrt(distanceSquared) - radius
    : density;
}

export function isValidCarveSnapshot(snapshot: Float64Array): boolean {
  if (snapshot.length % TERRAIN_CARVE_STRIDE !== 0) return false;
  for (let offset = 0; offset < snapshot.length; offset += TERRAIN_CARVE_STRIDE) {
    for (let component = 0; component < 6; component += 1) {
      if (!Number.isFinite(snapshot[offset + component])) return false;
    }
    if (!(snapshot[offset + 6] > 0) || !Number.isFinite(snapshot[offset + 6])) return false;
  }
  return true;
}

export function applyCarveSnapshot(
  baseDensity: number,
  x: number, y: number, z: number,
  snapshot: Float64Array,
): number {
  if (snapshot.length === TERRAIN_CARVE_STRIDE) {
    return applyOneCapsuleValues(
      baseDensity, x, y, z,
      snapshot[0], snapshot[1], snapshot[2],
      snapshot[3], snapshot[4], snapshot[5], snapshot[6],
    );
  }
  let density = baseDensity;
  for (let offset = 0; offset + 6 < snapshot.length; offset += TERRAIN_CARVE_STRIDE) {
    density = applyOneCapsuleValues(
      density, x, y, z,
      snapshot[offset], snapshot[offset + 1], snapshot[offset + 2],
      snapshot[offset + 3], snapshot[offset + 4], snapshot[offset + 5],
      snapshot[offset + 6],
    );
  }
  return density;
}

export function applyCarveSnapshotToLattice(
  chunk: VolumeChunkCoordinate,
  baseDensity: Float32Array,
  snapshot: Float64Array,
  output = new Float32Array(baseDensity.length),
): Float32Array {
  if (output.length !== baseDensity.length) throw new RangeError('Density lattice lengths must match');
  const pointsPerAxis = TERRAIN.segments + 1;
  if (baseDensity.length !== pointsPerAxis ** 3) throw new RangeError('Unexpected density lattice length');
  const cellSize = TERRAIN.chunkSize / TERRAIN.segments;
  const baseX = chunk.x * TERRAIN.chunkSize;
  const baseY = chunk.y * TERRAIN.chunkSize;
  const baseZ = chunk.z * TERRAIN.chunkSize;
  if (snapshot.length === TERRAIN_CARVE_STRIDE) {
    const ax = snapshot[0], ay = snapshot[1], az = snapshot[2];
    const bx = snapshot[3], by = snapshot[4], bz = snapshot[5];
    const radius = snapshot[6];
    const abx = bx - ax, aby = by - ay, abz = bz - az;
    const segmentLengthSquared = abx * abx + aby * aby + abz * abz;
    const minimumX = Math.min(ax, bx), maximumX = Math.max(ax, bx);
    const minimumY = Math.min(ay, by), maximumY = Math.max(ay, by);
    const minimumZ = Math.min(az, bz), maximumZ = Math.max(az, bz);
    let index = 0;
    for (let z = 0; z < pointsPerAxis; z += 1) {
      const worldZ = baseZ + z * cellSize;
      for (let y = 0; y < pointsPerAxis; y += 1) {
        const worldY = baseY + y * cellSize;
        for (let x = 0; x < pointsPerAxis; x += 1) {
          const worldX = baseX + x * cellSize;
          const density = baseDensity[index];
          const influence = radius + density;
          let next = density;
          if (
            influence > 0
            && worldX >= minimumX - influence && worldX <= maximumX + influence
            && worldY >= minimumY - influence && worldY <= maximumY + influence
            && worldZ >= minimumZ - influence && worldZ <= maximumZ + influence
          ) {
            const projection = segmentLengthSquared > 1e-18
              ? Math.max(0, Math.min(1, (
                  (worldX - ax) * abx + (worldY - ay) * aby + (worldZ - az) * abz
                ) / segmentLengthSquared))
              : 0;
            const dx = worldX - (ax + abx * projection);
            const dy = worldY - (ay + aby * projection);
            const dz = worldZ - (az + abz * projection);
            const distanceSquared = dx * dx + dy * dy + dz * dz;
            if (distanceSquared < influence * influence) next = Math.sqrt(distanceSquared) - radius;
          }
          output[index] = next;
          index += 1;
        }
      }
    }
    return output;
  }
  let index = 0;
  for (let z = 0; z < pointsPerAxis; z += 1) {
    const worldZ = baseZ + z * cellSize;
    for (let y = 0; y < pointsPerAxis; y += 1) {
      const worldY = baseY + y * cellSize;
      for (let x = 0; x < pointsPerAxis; x += 1) {
        const worldX = baseX + x * cellSize;
        output[index] = applyCarveSnapshot(baseDensity[index], worldX, worldY, worldZ, snapshot);
        index += 1;
      }
    }
  }
  return output;
}
