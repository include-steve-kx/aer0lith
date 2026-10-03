import { Vector3 } from 'three';
import {
  HULL_COLLISION_PROBES,
  TRAIL_ANCHORS,
  WING_PARTS,
} from '../core/aircraftGeometry.ts';
import { FLIGHT } from '../core/config.ts';

const DEG = Math.PI / 180;
const CRUISE_THROTTLE = (FLIGHT.nominalSpeed - FLIGHT.minSpeed) / (FLIGHT.maxSpeed - FLIGHT.minSpeed);
const Y_AXIS = new Vector3(0, 1, 0);
const X_AXIS = new Vector3(1, 0, 0);

export interface WingPoseSettings {
  wingSweepBack: number;
  wingTuckIn: number;
  wingFoldSpeed: number;
}

export const DEFAULT_WING_POSE: WingPoseSettings = {
  wingSweepBack: 40,
  wingTuckIn: 12,
  wingFoldSpeed: 1,
};

/** One authoritative, aircraft-local pose for every wing-attached system. */
export class WingPose {
  readonly triangles = WING_PARTS.map(part => part.map(p => new Vector3(...p)));
  readonly tips = WING_PARTS.map(() => new Vector3());
  readonly trailAnchors = TRAIL_ANCHORS.map(() => new Vector3());
  readonly collisionProbes = [
    ...HULL_COLLISION_PROBES.map(p => new Vector3(...p)),
    ...Array.from({ length: WING_PARTS.length * 7 }, () => new Vector3()),
  ];
  fold = 0;
  previousFold = 0;
  revision = 0;
  private settings: WingPoseSettings = { ...DEFAULT_WING_POSE };
  private readonly pivot = new Vector3();

  constructor() { this.rebuild(); }

  configure(settings: WingPoseSettings): void {
    this.settings = {
      wingSweepBack: Math.max(0, Math.min(60, settings.wingSweepBack)),
      wingTuckIn: Math.max(0, Math.min(45, settings.wingTuckIn)),
      wingFoldSpeed: Math.max(0.1, Math.min(4, settings.wingFoldSpeed)),
    };
    this.rebuild();
  }

  /** Boost below cruise is not physical boost and therefore never folds wings. */
  update(dt: number, throttle: number): void {
    this.previousFold = this.fold;
    const target = Math.max(0, Math.min(1, (throttle - CRUISE_THROTTLE) / (1 - CRUISE_THROTTLE)));
    const response = 1 - Math.exp(-dt * this.settings.wingFoldSpeed / 0.9);
    this.fold += (target - this.fold) * response;
    if (Math.abs(this.fold - this.previousFold) > 1e-8) this.rebuild();
  }

  reset(throttle = CRUISE_THROTTLE): void {
    this.fold = Math.max(0, Math.min(1, (throttle - CRUISE_THROTTLE) / (1 - CRUISE_THROTTLE)));
    this.previousFold = this.fold;
    this.rebuild();
  }

  sampleTriangle(index: number, fold: number, out = this.triangles[index]): readonly Vector3[] {
    const base = WING_PARTS[index];
    out[0].set(...base[0]);
    out[1].set(...base[1]);
    const side = Math.sign(base[2][0]);
    const tier = Math.sign(base[2][1]);
    this.pivot.copy(out[0]).add(out[1]).multiplyScalar(0.5);
    const tip = out[2].set(...base[2]).sub(this.pivot);
    tip.applyAxisAngle(Y_AXIS, side * this.settings.wingSweepBack * DEG * fold);
    tip.applyAxisAngle(X_AXIS, -tier * this.settings.wingTuckIn * DEG * fold);
    tip.add(this.pivot);
    return out;
  }

  private rebuild(): void {
    for (let i = 0; i < this.triangles.length; i++) {
      const triangle = this.sampleTriangle(i, this.fold);
      this.tips[i].copy(triangle[2]);
      this.trailAnchors[i].copy(triangle[2]);
      this.trailAnchors[i].z -= 0.06;
    }
    let probe = HULL_COLLISION_PROBES.length;
    for (const triangle of this.triangles) {
      for (const point of triangle) this.collisionProbes[probe++].copy(point);
      for (let i = 0; i < 3; i++)
        this.collisionProbes[probe++].copy(triangle[i]).lerp(triangle[(i + 1) % 3], 0.5);
      this.collisionProbes[probe++].copy(triangle[0]).add(triangle[1]).add(triangle[2]).divideScalar(3);
    }
    this.revision++;
  }
}
