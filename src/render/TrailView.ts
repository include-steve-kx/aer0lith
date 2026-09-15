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
import { PALETTE } from '../core/config.ts';

const MAX_POINTS = 512;
const MAX_TRAIL_DISTANCE = 360;
const LEFT_WING = new Vector3(-5.7, -0.08, -0.72);
const RIGHT_WING = new Vector3(5.7, -0.08, -0.72);

interface TrailSample {
  left: Vector3;
  right: Vector3;
  distance: number;
}

export class TrailView {
  readonly group = new Group();
  private readonly material: ShaderMaterial;
  private readonly geometries = [new BufferGeometry(), new BufferGeometry()];
  private readonly positions = [new Float32Array(MAX_POINTS * 3), new Float32Array(MAX_POINTS * 3)];
  private readonly strengths = [new Float32Array(MAX_POINTS), new Float32Array(MAX_POINTS)];
  private readonly samples: TrailSample[] = [];
  private readonly lastPoint = new Vector3(Number.POSITIVE_INFINITY, 0, 0);
  private readonly wingPoint = new Vector3();
  private distanceTravelled = 0;

  constructor() {
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
    for (let side = 0; side < 2; side += 1) {
      this.geometries[side].setAttribute('position', new BufferAttribute(this.positions[side], 3));
      this.geometries[side].setAttribute('aStrength', new BufferAttribute(this.strengths[side], 1));
      this.geometries[side].setDrawRange(0, 0);
      const line = new Line(this.geometries[side], this.material);
      line.frustumCulled = false;
      this.group.add(line);
    }
  }

  update(dt: number, throttleActive: boolean): void {
    const current = this.material.uniforms.uThrottle.value as number;
    const response = throttleActive ? 0.16 : 0.5;
    const smoothing = 1 - Math.exp(-dt / response);
    this.material.uniforms.uThrottle.value = current + ((throttleActive ? 1 : 0) - current) * smoothing;
  }

  add(worldPosition: Vector3, orientation: Quaternion, origin: Vector3, force = false): void {
    if (!force && worldPosition.distanceToSquared(this.lastPoint) < 2.25) return;
    if (Number.isFinite(this.lastPoint.x)) this.distanceTravelled += worldPosition.distanceTo(this.lastPoint);
    this.lastPoint.copy(worldPosition);
    const left = this.wingPoint.copy(LEFT_WING).applyQuaternion(orientation).add(worldPosition).clone();
    const right = RIGHT_WING.clone().applyQuaternion(orientation).add(worldPosition);
    this.samples.push({ left, right, distance: this.distanceTravelled });
    while (
      this.samples.length > 1
      && (
        this.samples.length > MAX_POINTS
        || this.distanceTravelled - this.samples[0].distance > MAX_TRAIL_DISTANCE
      )
    ) this.samples.shift();
    this.rebuild(origin);
  }

  rebuild(origin: Vector3): void {
    const firstDistance = this.samples[0]?.distance ?? this.distanceTravelled;
    const span = Math.max(1, this.distanceTravelled - firstDistance);
    for (let index = 0; index < this.samples.length; index += 1) {
      const amount = Math.max(0, Math.min(1, (this.samples[index].distance - firstDistance) / span));
      for (let side = 0; side < 2; side += 1) {
        const point = side === 0 ? this.samples[index].left : this.samples[index].right;
        const offset = index * 3;
        this.positions[side][offset] = point.x - origin.x;
        this.positions[side][offset + 1] = point.y - origin.y;
        this.positions[side][offset + 2] = point.z - origin.z;
        this.strengths[side][index] = amount;
      }
    }
    for (let side = 0; side < 2; side += 1) {
      this.geometries[side].setDrawRange(0, this.samples.length);
      this.geometries[side].attributes.position.needsUpdate = true;
      this.geometries[side].attributes.aStrength.needsUpdate = true;
      this.geometries[side].computeBoundingSphere();
    }
  }

  clear(): void {
    this.samples.length = 0;
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
