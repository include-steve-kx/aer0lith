import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  EdgesGeometry,
  Triangle,
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
  private readonly impactWeights = new Float32Array(this.positions.length / 3);
  private readonly impactTimers = new Float32Array(this.positions.length / 3);
  private readonly impactDurations = new Float32Array(this.positions.length / 3);
  private readonly impactStrengths = new Float32Array(this.positions.length / 3);
  private readonly impactAttribute: BufferAttribute;
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly c = new Vector3();
  private readonly normal = new Vector3();
  private readonly closestPoint = new Vector3();
  private readonly triangle = new Triangle(this.a, this.b, this.c);

  constructor(wings: WingPose) {
    super();
    this.positions.set(HULL_POSITIONS);
    this.normals.set(HULL_NORMALS);
    this.setAttribute('position', new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage));
    this.setAttribute('normal', new BufferAttribute(this.normals, 3).setUsage(DynamicDrawUsage));
    this.impactAttribute = new BufferAttribute(this.impactWeights, 1).setUsage(DynamicDrawUsage);
    this.setAttribute('aImpact', this.impactAttribute);
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

  flashImpact(localPoint: Vector3, duration: number, severity: number): void {
    let closestTriangle = 0;
    let closestDistanceSq = Number.POSITIVE_INFINITY;
    for (let offset = 0; offset < this.positions.length; offset += 9) {
      this.a.fromArray(this.positions, offset);
      this.b.fromArray(this.positions, offset + 3);
      this.c.fromArray(this.positions, offset + 6);
      this.triangle.closestPointToPoint(localPoint, this.closestPoint);
      const distanceSq = this.closestPoint.distanceToSquared(localPoint);
      if (distanceSq < closestDistanceSq) {
        closestDistanceSq = distanceSq;
        closestTriangle = offset;
      }
    }
    const safeDuration = Math.max(0.05, duration);
    const strength = Math.max(0.15, Math.min(1, severity));
    for (let vertex = 0; vertex < this.impactTimers.length; vertex += 1) {
      const offset = vertex * 3;
      let matches = false;
      for (let selected = 0; selected < 3; selected += 1) {
        const target = closestTriangle + selected * 3;
        const dx = this.positions[offset] - this.positions[target];
        const dy = this.positions[offset + 1] - this.positions[target + 1];
        const dz = this.positions[offset + 2] - this.positions[target + 2];
        if (dx * dx + dy * dy + dz * dz < 1e-8) { matches = true; break; }
      }
      if (!matches) continue;
      this.impactTimers[vertex] = Math.max(this.impactTimers[vertex], safeDuration);
      this.impactDurations[vertex] = safeDuration;
      this.impactStrengths[vertex] = Math.max(this.impactStrengths[vertex], strength);
      this.impactWeights[vertex] = Math.max(this.impactWeights[vertex], strength);
    }
    this.impactAttribute.needsUpdate = true;
  }

  updateImpact(dt: number, frozen = false): void {
    let changed = false;
    for (let vertex = 0; vertex < this.impactTimers.length; vertex += 1) {
      if (this.impactTimers[vertex] <= 0) continue;
      if (!frozen) this.impactTimers[vertex] = Math.max(0, this.impactTimers[vertex] - dt);
      const duration = Math.max(0.05, this.impactDurations[vertex]);
      const remaining = this.impactTimers[vertex] / duration;
      const progress = 1 - remaining;
      const flash = Math.sin(progress * Math.PI * 10) > 0 ? 1 : 0.22;
      this.impactWeights[vertex] = remaining * flash * this.impactStrengths[vertex];
      if (this.impactTimers[vertex] <= 0) this.impactStrengths[vertex] = 0;
      changed = true;
    }
    if (changed) this.impactAttribute.needsUpdate = true;
  }

  get impactVisible(): boolean {
    for (let vertex = 0; vertex < this.impactTimers.length; vertex += 1) {
      if (this.impactTimers[vertex] > 0) return true;
    }
    return false;
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
