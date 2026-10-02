import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  EdgesGeometry,
  Vector3,
} from 'three';
import { ConvexGeometry } from 'three/addons/geometries/ConvexGeometry.js';
import { HULL_POINTS } from '../core/aircraftGeometry.ts';
import { WingPose } from '../flight/WingPose.ts';

const HULL = new ConvexGeometry(HULL_POINTS.map(p => new Vector3(...p)));
const HULL_POSITIONS = new Float32Array(HULL.getAttribute('position').array);
const HULL_NORMALS = new Float32Array(HULL.getAttribute('normal').array);
const hullEdges = new EdgesGeometry(HULL, 18);
const HULL_EDGES = new Float32Array(hullEdges.getAttribute('position').array);
HULL.dispose();
hullEdges.dispose();

/** Dynamic non-indexed airframe: six hull faces plus exactly one face per wing. */
export class AircraftGeometry extends BufferGeometry {
  private readonly positions = new Float32Array(HULL_POSITIONS.length + 4 * 9);
  private readonly normals = new Float32Array(HULL_NORMALS.length + 4 * 9);
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly normal = new Vector3();

  constructor(wings: WingPose) {
    super();
    this.positions.set(HULL_POSITIONS);
    this.normals.set(HULL_NORMALS);
    this.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.setAttribute('normal', new BufferAttribute(this.normals, 3).setUsage(DynamicDrawUsage));
    this.sync(wings);
  }

  sync(wings: WingPose): void {
    let offset = HULL_POSITIONS.length;
    for (const triangle of wings.triangles) {
      this.a.subVectors(triangle[1], triangle[0]);
      this.b.subVectors(triangle[2], triangle[0]);
      this.normal.crossVectors(this.a, this.b).normalize();
      for (const point of triangle) {
        this.positions[offset] = point.x;
        this.positions[offset + 1] = point.y;
        this.positions[offset + 2] = point.z;
        this.normals[offset] = this.normal.x;
        this.normals[offset + 1] = this.normal.y;
        this.normals[offset + 2] = this.normal.z;
        offset += 3;
      }
    }
    this.attributes.position.needsUpdate = true;
    this.attributes.normal.needsUpdate = true;
    this.computeBoundingSphere();
  }
}

export class AircraftEdgeGeometry extends BufferGeometry {
  private readonly positions = new Float32Array(HULL_EDGES.length + 4 * 3 * 2 * 3);

  constructor(wings: WingPose) {
    super();
    this.positions.set(HULL_EDGES);
    this.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.sync(wings);
  }

  sync(wings: WingPose): void {
    let offset = HULL_EDGES.length;
    for (const triangle of wings.triangles) {
      for (let edge = 0; edge < 3; edge++) {
        const a = triangle[edge], b = triangle[(edge + 1) % 3];
        this.positions[offset] = a.x;
        this.positions[offset + 1] = a.y;
        this.positions[offset + 2] = a.z;
        this.positions[offset + 3] = b.x;
        this.positions[offset + 4] = b.y;
        this.positions[offset + 5] = b.z;
        offset += 6;
      }
    }
    this.attributes.position.needsUpdate = true;
    this.computeBoundingSphere();
  }
}

export function createAircraftGeometry(wings = new WingPose()): AircraftGeometry {
  return new AircraftGeometry(wings);
}

export function createAircraftEdgeGeometry(wings = new WingPose()): AircraftEdgeGeometry {
  return new AircraftEdgeGeometry(wings);
}
