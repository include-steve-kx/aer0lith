import { Quaternion, Vector3 } from 'three';
import type { TerrainSampler } from '../core/types.ts';
import type { ConvexShape } from './geometry.ts';
const a = new Vector3(),
  b = new Vector3(),
  axis = new Vector3(),
  inverse = new Quaternion(),
  localA = new Vector3(),
  localB = new Vector3();
/** First segment contact with a convex volume, expanded by the projectile radius. */
export function segmentConvex(
  from: Vector3,
  to: Vector3,
  position: Vector3,
  q: Quaternion,
  scale: number,
  shape: ConvexShape,
  radius = 0,
): number {
  inverse.copy(q).invert();
  localA.copy(from).sub(position).applyQuaternion(inverse).divideScalar(scale);
  localB.copy(to).sub(position).applyQuaternion(inverse).divideScalar(scale);
  let enter = 0,
    exit = 1;
  for (let i = 0; i < shape.normals.length; i++) {
    const n = shape.normals[i],
      start = n.dot(localA) - shape.planes[i] - radius / scale,
      end = n.dot(localB) - shape.planes[i] - radius / scale;
    if (start > 0 && end > 0) return Infinity;
    if (start <= 0 && end <= 0) continue;
    const t = start / (start - end);
    if (start > 0) enter = Math.max(enter, t);
    else exit = Math.min(exit, t);
    if (enter > exit) return Infinity;
  }
  return enter;
}
export function segmentSphere(
  from: Vector3,
  to: Vector3,
  center: Vector3,
  radius: number,
): boolean {
  a.subVectors(to, from);
  b.subVectors(center, from);
  const t = Math.max(0, Math.min(1, b.dot(a) / Math.max(1e-12, a.lengthSq())));
  return b.addScaledVector(a, -t).lengthSq() <= radius * radius;
}
export function terrainHit(
  terrain: TerrainSampler,
  from: Vector3,
  to: Vector3,
  radius = 0,
): number {
  const steps = Math.max(1, Math.ceil(from.distanceTo(to)));
  for (let i = 0; i <= steps; i++) {
    a.lerpVectors(from, to, i / steps);
    if (
      (terrain.collisionDensityAt?.(a.x, a.y, a.z) ??
        terrain.densityAt(a.x, a.y, a.z)) > -radius
    ) {
      if (i === 0) return 0;
      let lo = (i - 1) / steps, hi = i / steps;
      for (let j = 0; j < 6; j++) {
        const mid = (lo + hi) * 0.5;
        a.lerpVectors(from, to, mid);
        if ((terrain.collisionDensityAt?.(a.x, a.y, a.z) ?? terrain.densityAt(a.x, a.y, a.z)) > -radius) hi = mid;
        else lo = mid;
      }
      return hi;
    }
  }
  return Infinity;
}
/** SAT separation is a conservative lower bound for convex conservative advancement. */
export function separation(
  av: Vector3[],
  an: Vector3[],
  ae: Vector3[],
  bv: Vector3[],
  bn: Vector3[],
  be: Vector3[],
): number {
  let gap = -Infinity;
  const project = (n: Vector3) => {
    let amin = Infinity,
      amax = -Infinity,
      bmin = Infinity,
      bmax = -Infinity;
    for (const p of av) {
      const d = p.dot(n);
      amin = Math.min(amin, d);
      amax = Math.max(amax, d);
    }
    for (const p of bv) {
      const d = p.dot(n);
      bmin = Math.min(bmin, d);
      bmax = Math.max(bmax, d);
    }
    gap = Math.max(gap, bmin - amax, amin - bmax);
  };
  for (const n of an) project(n);
  for (const n of bn) project(n);
  for (const e of ae)
    for (const f of be) {
      axis.crossVectors(e, f);
      if (axis.lengthSq() > 1e-10) project(axis.normalize());
    }
  return gap;
}
export class ShapePose {
  readonly vertices: Vector3[];
  readonly normals: Vector3[];
  readonly edges: Vector3[];
  readonly shape: ConvexShape;
  constructor(shape: ConvexShape) {
    this.shape = shape;
    this.vertices = shape.vertices.map(() => new Vector3());
    this.normals = shape.normals.map(() => new Vector3());
    this.edges = shape.edges.map(() => new Vector3());
  }
  set(p: Vector3, q: Quaternion, scale: number): void {
    this.shape.vertices.forEach((v, i) =>
      this.vertices[i].copy(v).multiplyScalar(scale).applyQuaternion(q).add(p),
    );
    this.shape.normals.forEach((v, i) =>
      this.normals[i].copy(v).applyQuaternion(q),
    );
    this.shape.edges.forEach((v, i) =>
      this.edges[i].copy(v).applyQuaternion(q),
    );
  }
}
