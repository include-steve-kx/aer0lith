import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Color,
  DynamicDrawUsage,
  Group,
  Points,
  Quaternion,
  ShaderMaterial,
  Vector3,
} from 'three';
import type { FlightTuningSettings } from '../flight/FlightTuning.ts';

const MAX_PARTICLES = 256;
const TAIL_ANCHOR = new Vector3(0, 0.05, -3.75);

function hash(value: number): number {
  const result = Math.sin(value * 91.713 + 17.17) * 43758.5453;
  return result - Math.floor(result);
}

/** One fixed-capacity draw call for soft, irregular ash emitted only during drift. */
export class DriftTrailView {
  readonly group = new Group();
  private readonly geometry = new BufferGeometry();
  private readonly material: ShaderMaterial;
  private readonly positions = new Float32Array(MAX_PARTICLES * 3);
  private readonly velocities = new Float32Array(MAX_PARTICLES * 3);
  private readonly ages = new Float32Array(MAX_PARTICLES).fill(1);
  private readonly lifetimes = new Float32Array(MAX_PARTICLES).fill(1);
  private readonly sizes = new Float32Array(MAX_PARTICLES);
  private readonly seeds = new Float32Array(MAX_PARTICLES);
  private readonly positionAttribute: BufferAttribute;
  private readonly ageAttribute: BufferAttribute;
  private readonly spawnPoint = new Vector3();
  private readonly travelDirection = new Vector3(0, 0, 1);
  private cursor = 0;
  private serial = 0;
  private spawnAccumulator = 0;
  private enabled = true;
  private rate = 32;
  private size = 4.5;
  private lifetime = 1.4;
  private turbulence = 3.5;
  private live = 0;

  constructor() {
    this.positionAttribute = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    this.ageAttribute = new BufferAttribute(this.ages, 1).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('aAge', this.ageAttribute);
    this.geometry.setAttribute('aSize', new BufferAttribute(this.sizes, 1).setUsage(DynamicDrawUsage));
    this.geometry.setAttribute('aSeed', new BufferAttribute(this.seeds, 1));
    this.geometry.setDrawRange(0, MAX_PARTICLES);
    this.material = new ShaderMaterial({
      uniforms: {
        uColor: { value: new Color('#c8c8c8') },
        uOpacity: { value: 0.55 },
        uTime: { value: 0 },
      },
      transparent: true,
      depthWrite: false,
      depthTest: true,
      blending: AdditiveBlending,
      toneMapped: false,
      vertexShader: `
        attribute float aAge;
        attribute float aSize;
        attribute float aSeed;
        varying float vAge;
        varying float vSeed;
        void main() {
          vec4 view = modelViewMatrix * vec4(position, 1.0);
          float expansion = mix(0.65, 1.55, aAge);
          gl_PointSize = clamp(aSize * expansion * 260.0 / max(1.0, -view.z), 2.0, 86.0);
          gl_Position = projectionMatrix * view;
          vAge = aAge;
          vSeed = aSeed;
        }
      `,
      fragmentShader: `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        varying float vAge;
        varying float vSeed;
        void main() {
          vec2 p = gl_PointCoord * 2.0 - 1.0;
          float radius = length(p);
          float wobble = sin(atan(p.y, p.x) * 7.0 + vSeed * 31.0 + uTime * 2.2) * 0.08;
          float cloud = 1.0 - smoothstep(0.42 + wobble, 1.0, radius);
          float grain = 0.72 + 0.28 * sin((p.x * 17.0 + p.y * 23.0 + vSeed * 47.0) * 3.0);
          float life = (1.0 - smoothstep(0.72, 1.0, vAge)) * smoothstep(0.0, 0.08, vAge);
          float alpha = cloud * grain * life * uOpacity;
          if (alpha < 0.01 || vAge >= 1.0) discard;
          vec3 ember = mix(uColor * 0.42, uColor, grain * (1.0 - vAge));
          gl_FragColor = vec4(ember, alpha);
        }
      `,
    });
    const points = new Points(this.geometry, this.material);
    points.frustumCulled = false;
    points.renderOrder = 3;
    this.group.add(points);
    this.group.visible = false;
  }

  configure(settings: FlightTuningSettings): void {
    this.enabled = settings.driftTrailEnabled;
    this.rate = settings.driftTrailRate;
    this.size = settings.driftTrailSize;
    this.lifetime = settings.driftTrailLifetime;
    this.turbulence = settings.driftTrailTurbulence;
    this.material.uniforms.uOpacity.value = settings.driftTrailOpacity;
    this.material.uniforms.uColor.value.set(settings.driftTrailColor);
    if (!this.enabled) this.clear();
  }

  update(
    dt: number,
    planePosition: Vector3,
    orientation: Quaternion,
    travelVelocity: Vector3,
    driftIntensity: number,
    frozen = false,
  ): void {
    if (frozen || dt <= 0) return;
    this.material.uniforms.uTime.value += dt;
    this.live = 0;
    for (let index = 0; index < MAX_PARTICLES; index += 1) {
      if (this.ages[index] >= 1) continue;
      this.ages[index] = Math.min(1, this.ages[index] + dt / this.lifetimes[index]);
      if (this.ages[index] >= 1) continue;
      const offset = index * 3;
      this.positions[offset] += this.velocities[offset] * dt;
      this.positions[offset + 1] += this.velocities[offset + 1] * dt;
      this.positions[offset + 2] += this.velocities[offset + 2] * dt;
      const damping = Math.exp(-0.8 * dt);
      this.velocities[offset] *= damping;
      this.velocities[offset + 1] = this.velocities[offset + 1] * damping + dt * 0.7;
      this.velocities[offset + 2] *= damping;
      this.live++;
    }
    const intensity = this.enabled ? Math.max(0, Math.min(1, driftIntensity)) : 0;
    if (intensity > 0) {
      this.travelDirection.copy(travelVelocity);
      if (this.travelDirection.lengthSq() < 1e-8) this.travelDirection.set(0, 0, 1).applyQuaternion(orientation);
      else this.travelDirection.normalize();
      this.spawnAccumulator += this.rate * intensity * dt;
      while (this.spawnAccumulator >= 1) {
        this.spawn(planePosition, orientation, intensity);
        this.spawnAccumulator -= 1;
      }
    } else {
      this.spawnAccumulator = Math.min(this.spawnAccumulator, 0.99);
    }
    this.group.visible = this.live > 0;
    this.positionAttribute.needsUpdate = true;
    this.ageAttribute.needsUpdate = true;
    this.geometry.attributes.aSize.needsUpdate = true;
  }

  private spawn(planePosition: Vector3, orientation: Quaternion, intensity: number): void {
    const index = this.cursor;
    const offset = index * 3;
    const serial = this.serial++;
    this.cursor = (this.cursor + 1) % MAX_PARTICLES;
    this.spawnPoint.copy(TAIL_ANCHOR).applyQuaternion(orientation).add(planePosition);
    this.positions[offset] = this.spawnPoint.x;
    this.positions[offset + 1] = this.spawnPoint.y;
    this.positions[offset + 2] = this.spawnPoint.z;
    const spread = this.turbulence * (0.45 + intensity * 0.55);
    this.velocities[offset] = (hash(serial * 3 + 1) * 2 - 1) * spread - this.travelDirection.x * 1.5;
    this.velocities[offset + 1] = (hash(serial * 3 + 2) * 2 - 0.65) * spread - this.travelDirection.y * 1.5;
    this.velocities[offset + 2] = (hash(serial * 3 + 3) * 2 - 1) * spread - this.travelDirection.z * 1.5;
    this.ages[index] = 0.001;
    this.lifetimes[index] = this.lifetime * (0.72 + hash(serial + 7) * 0.56);
    this.sizes[index] = this.size * (0.68 + hash(serial + 11) * 0.64);
    this.seeds[index] = hash(serial + 19);
    this.live = Math.min(MAX_PARTICLES, this.live + 1);
  }

  applyOriginShift(shift: Vector3): void {
    for (let index = 0; index < MAX_PARTICLES; index += 1) {
      if (this.ages[index] >= 1) continue;
      const offset = index * 3;
      this.positions[offset] -= shift.x;
      this.positions[offset + 1] -= shift.y;
      this.positions[offset + 2] -= shift.z;
    }
    this.positionAttribute.needsUpdate = true;
  }

  clear(): void {
    this.ages.fill(1);
    this.live = 0;
    this.spawnAccumulator = 0;
    this.group.visible = false;
    this.ageAttribute.needsUpdate = true;
  }

  get activeCount(): number { return this.live; }
  get emittedCount(): number { return this.serial; }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
