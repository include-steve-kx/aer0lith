import {
  BufferAttribute,
  BufferGeometry,
  Color,
  Group,
  Line,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import { TRAIL_ANCHORS } from '../core/aircraftGeometry.ts';
import { PALETTE } from '../core/config.ts';
import { WingPose } from '../flight/WingPose.ts';

const MAX_POINTS = 512;
const MAX_TRAIL_DISTANCE = 360;
const ANCHORS = TRAIL_ANCHORS.map(p => new Vector3(...p));

export interface TrailSample {
  tips: Vector3[];
  across: Vector3;
  left: Vector3;
  right: Vector3;
  rootHeight: number;
  distance: number;
  up: Vector3;
}

export class TrailView {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly geometries = ANCHORS.map(() => new BufferGeometry());
  private readonly positions = ANCHORS.map(() => new Float32Array(MAX_POINTS * 3));
  private readonly strengths = ANCHORS.map(() => new Float32Array(MAX_POINTS));
  private readonly samples: TrailSample[] = [];
  private readonly lastPoint = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly wings: WingPose;
  private distanceTravelled = 0;
  private hasLiveHead = false;
  revision = 0;

  get pathSamples(): readonly TrailSample[] { return this.samples; }

  constructor(wings = new WingPose()) {
    this.wings = wings;
    this.material = new ShaderMaterial({
      uniforms: {
        uBright: { value: new Color(PALETTE.offWhite) },
        uDark: { value: new Color(PALETTE.graphite) },
        uThrottle: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: `
        attribute float aStrength;
        varying float vStrength;
        void main() {
          vStrength = aStrength;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: `
        uniform vec3 uBright;
        uniform vec3 uDark;
        uniform float uThrottle;
        varying float vStrength;
        void main() {
          float alpha = pow(clamp(vStrength, 0.0, 1.0), 1.7)
            * mix(0.72, 1.35, uThrottle);
          if (alpha < 0.004) discard;
          float brightness = clamp(vStrength + uThrottle * 0.2, 0.0, 1.0);
          gl_FragColor = vec4(mix(uDark, uBright, brightness), alpha);
        }
      `,
    });
    for (let side = 0; side < ANCHORS.length; side += 1) {
      this.geometries[side].setAttribute('position', new BufferAttribute(this.positions[side], 3));
      this.geometries[side].setAttribute('aStrength', new BufferAttribute(this.strengths[side], 1));
      this.geometries[side].setDrawRange(0, 0);
      const line = new Line(this.geometries[side], this.material);
      line.frustumCulled = false;
      this.group.add(line);
    }
  }

  update(dt: number, activity: boolean | number): void {
    const target = typeof activity === 'number'
      ? Math.max(0, Math.min(1, activity))
      : activity ? 1 : 0;
    const current = this.material.uniforms.uThrottle.value as number;
    const response = target > current ? 0.16 : 0.5;
    const smoothing = 1 - Math.exp(-dt / response);
    this.material.uniforms.uThrottle.value = current + (target - current) * smoothing;
  }

  add(worldPosition: Vector3, orientation: Quaternion, origin: Vector3, force = false): void {
    const hasAnchor = Number.isFinite(this.lastPoint.x);
    const distance = hasAnchor ? worldPosition.distanceTo(this.lastPoint) : 0;
    if (!force && hasAnchor && distance < 0.000001) return;
    // Keep a live endpoint on each tip between the 1.5 m history samples.
    // Replacing that endpoint avoids both detached trails and unbounded history.
    if (this.hasLiveHead) this.samples.pop();
    const commit = force || !hasAnchor || distance >= 1.5;
    if (commit) {
      this.distanceTravelled += distance;
      this.lastPoint.copy(worldPosition);
    }
    this.hasLiveHead = !commit;
    const headDistance = this.distanceTravelled + (commit ? 0 : distance);
    const tips = this.wings.trailAnchors.map(anchor => anchor.clone().applyQuaternion(orientation).add(worldPosition));
    // Side sheets span the upper/lower trails, with one sheet per wing pair.
    const left = tips[0].clone().lerp(tips[1], 0.5);
    const right = tips[2].clone().lerp(tips[3], 0.5);
    const up = tips[1].clone().sub(tips[0]);
    const rootHeight = up.length();
    if (rootHeight > 1e-8) up.divideScalar(rootHeight);
    else up.set(0, 1, 0).applyQuaternion(orientation);
    this.samples.push({ tips, left, right, rootHeight, distance: headDistance,
      across: right.clone().sub(left).normalize(), up });
    while (
      this.samples.length > 1
      && (
        this.samples.length > MAX_POINTS
        || headDistance - this.samples[0].distance > MAX_TRAIL_DISTANCE
      )
    ) this.samples.shift();
    this.rebuild(origin);
  }

  rebuild(origin: Vector3): void {
    this.revision++;
    const firstDistance = this.samples[0]?.distance ?? this.distanceTravelled;
    const span = Math.max(1, (this.samples.at(-1)?.distance ?? this.distanceTravelled) - firstDistance);
    for (let index = 0; index < this.samples.length; index += 1) {
      const amount = Math.max(0, Math.min(1, (this.samples[index].distance - firstDistance) / span));
      for (let side = 0; side < ANCHORS.length; side += 1) {
        const point = this.samples[index].tips[side];
        const offset = index * 3;
        this.positions[side][offset] = point.x - origin.x;
        this.positions[side][offset + 1] = point.y - origin.y;
        this.positions[side][offset + 2] = point.z - origin.z;
        this.strengths[side][index] = amount;
      }
    }
    for (let side = 0; side < ANCHORS.length; side += 1) {
      this.geometries[side].setDrawRange(0, this.samples.length);
      this.geometries[side].attributes.position.needsUpdate = true;
      this.geometries[side].attributes.aStrength.needsUpdate = true;
      this.geometries[side].computeBoundingSphere();
    }
  }

  clear(): void {
    this.revision++;
    this.samples.length = 0;
    this.hasLiveHead = false;
    this.distanceTravelled = 0;
    this.lastPoint.set(Number.POSITIVE_INFINITY, 0, 0);
    for (const geometry of this.geometries) geometry.setDrawRange(0, 0);
  }

  get sampleCount(): number {
    return this.samples.length;
  }

  get distanceSpan(): number {
    if (this.samples.length < 2) return 0;
    return this.samples[this.samples.length - 1].distance - this.samples[0].distance;
  }

  get throttleIntensity(): number {
    return this.material.uniforms.uThrottle.value as number;
  }
}
