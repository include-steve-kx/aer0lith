import {
  BufferAttribute,
  BufferGeometry,
  IcosahedronGeometry,
  Vector3,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { CombatRandom } from './random.ts';
export interface ConvexShape {
  vertices: Vector3[];
  normals: Vector3[];
  edges: Vector3[];
  planes: number[];
  radius: number;
}
export interface ShardTemplate {
  positions: Float32Array;
  normals: Float32Array;
  shades: Float32Array;
  center: Vector3;
}
export interface RockVariant {
  geometry: BufferGeometry;
  shape: ConvexShape;
  shards: Map<number, ShardTemplate[]>;
}
const key = (v: Vector3) =>
  `${v.x.toFixed(6)},${v.y.toFixed(6)},${v.z.toFixed(6)}`;
export function convexShape(geometry: BufferGeometry): ConvexShape {
  const p = geometry.getAttribute('position'),
    vertices: Vector3[] = [],
    normals: Vector3[] = [],
    edges: Vector3[] = [],
    planes: number[] = [];
  const seen = new Set<string>(),
    a = new Vector3(),
    b = new Vector3(),
    c = new Vector3(),
    edge = new Vector3(),
    normal = new Vector3();
  let radius = 0;
  const addAxis = (axes: Vector3[], v: Vector3) => {
    if (v.lengthSq() < 1e-12) return;
    v.normalize();
    if (!axes.some((n) => Math.abs(n.dot(v)) > 0.99999)) axes.push(v.clone());
  };
  for (let i = 0; i < p.count; i += 3) {
    a.fromBufferAttribute(p, i);
    b.fromBufferAttribute(p, i + 1);
    c.fromBufferAttribute(p, i + 2);
    for (const v of [a, b, c]) {
      if (!seen.has(key(v))) {
        seen.add(key(v));
        vertices.push(v.clone());
      }
      radius = Math.max(radius, v.length());
    }
    normal.subVectors(b, a).cross(edge.subVectors(c, a)).normalize();
    if (!normals.some((n) => n.dot(normal) > 0.99999)) {
      normals.push(normal.clone());
      planes.push(normal.dot(a));
    }
    addAxis(edges, edge.subVectors(b, a));
    addAxis(edges, edge.subVectors(c, b));
    addAxis(edges, edge.subVectors(a, c));
  }
  return { vertices, normals, edges, planes, radius };
}
export function hullGeometry(
  points: readonly (readonly number[])[],
): BufferGeometry {
  return new ConvexGeometry(points.map((p) => new Vector3(p[0], p[1], p[2])));
}
function fracture(geometry: BufferGeometry, count: number): ShardTemplate[] {
  const p = geometry.getAttribute('position'),
    faces: Vector3[][] = [],
    centers: Vector3[] = [];
  for (let i = 0; i < p.count; i += 3) {
    const face = [0, 1, 2].map((j) =>
      new Vector3().fromBufferAttribute(p, i + j),
    );
    faces.push(face);
    centers.push(face[0].clone().add(face[1]).add(face[2]).divideScalar(3));
  }
  const edgeFaces = new Map<string, number[]>(),
    neighbours = faces.map(() => [] as number[]);
  faces.forEach((face, i) =>
    face.forEach((v, j) => {
      const e = [key(v), key(face[(j + 1) % 3])].sort().join('|');
      const uses = edgeFaces.get(e) ?? [];
      uses.push(i);
      edgeFaces.set(e, uses);
    }),
  );
  for (const uses of edgeFaces.values())
    if (uses.length === 2) {
      neighbours[uses[0]].push(uses[1]);
      neighbours[uses[1]].push(uses[0]);
    }
  const seeds = [0];
  while (seeds.length < count) {
    let best = 0,
      score = -1;
    centers.forEach((c, i) => {
      const d = Math.min(...seeds.map((s) => c.distanceToSquared(centers[s])));
      if (d > score) {
        score = d;
        best = i;
      }
    });
    seeds.push(best);
  }
  const owner = new Int16Array(faces.length).fill(-1),
    queue: number[] = [];
  seeds.forEach((f, g) => {
    owner[f] = g;
    queue.push(f);
  });
  for (let q = 0; q < queue.length; q++)
    for (const n of neighbours[queue[q]])
      if (owner[n] < 0) {
        owner[n] = owner[queue[q]];
        queue.push(n);
      }
  return seeds.map((_, group) => {
    const positions: number[] = [],
      shades: number[] = [],
      boundary = new Map<string, Vector3[]>(),
      center = new Vector3();
    let exterior = 0;
    faces.forEach((face, i) => {
      if (owner[i] !== group) return;
      for (const v of face) {
        positions.push(v.x, v.y, v.z);
        shades.push(1);
        center.add(v);
        exterior++;
      }
      face.forEach((v, j) => {
        const b = face[(j + 1) % 3],
          e = [key(v), key(b)].sort().join('|');
        if (boundary.has(e)) boundary.delete(e);
        else boundary.set(e, [v, b]);
      });
    });
    center.divideScalar(exterior);
    for (const [a, b] of boundary.values()) {
      positions.push(b.x, b.y, b.z, a.x, a.y, a.z, 0, 0, 0);
      shades.push(0.65, 0.65, 0.65);
    }
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(positions), 3),
    );
    g.computeVertexNormals();
    const result = {
      positions: new Float32Array(positions),
      normals: new Float32Array(g.getAttribute('normal').array),
      shades: new Float32Array(shades),
      center,
    };
    g.dispose();
    return result;
  });
}
/** Five immutable irregularity levels avoid rebuilding geometry on spawn or mutating live rocks. */
export class RockLibrary {
  readonly variants: RockVariant[] = [];
  private disposed = false;
  constructor(seed: string) {
    const sphere = new IcosahedronGeometry(1, 1),
      raw = sphere.getAttribute('position'),
      unique = new Map<string, Vector3>();
    for (let i = 0; i < raw.count; i++) {
      const v = new Vector3().fromBufferAttribute(raw, i);
      unique.set(key(v), v);
    }
    for (let level = 0; level < 5; level++)
      for (let variant = 0; variant < 8; variant++) {
        const random = new CombatRandom(`${seed}:rock:${variant}`);
        const points = [...unique.values()].map((v) =>
          v.clone().multiplyScalar(1 + (random.range(-0.32, 0.32) * level) / 4),
        );
        const geometry = new ConvexGeometry(points);
        const shape0 = convexShape(geometry);
        let diameter = 0;
        for (const a of shape0.vertices)
          for (const b of shape0.vertices)
            diameter = Math.max(diameter, a.distanceTo(b));
        geometry.scale(1 / diameter, 1 / diameter, 1 / diameter);
        geometry.computeBoundingSphere();
        geometry.computeBoundingBox();
        this.variants.push({
          geometry,
          shape: convexShape(geometry),
          shards: new Map([4, 8, 12].map((n) => [n, fracture(geometry, n)])),
        });
      }
    sphere.dispose();
  }
  index(irregularity: number, variant: number): number {
    return Math.round(irregularity / 0.125) * 8 + variant;
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.variants.forEach((v) => v.geometry.dispose());
  }
}
