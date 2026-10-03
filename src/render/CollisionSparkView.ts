import { Color, Group, PerspectiveCamera, Vector3 } from 'three';
import type { FlightImpactSnapshot } from '../core/types.ts';
import type { FlightTuningSettings } from '../flight/FlightTuning.ts';
import { RibbonBatch } from '../combat/CombatView.ts';

const MAX_SPARKS = 256;

function hash(value: number): number {
  const result = Math.sin(value * 78.233 + 19.19) * 43758.5453;
  return result - Math.floor(result);
}

/** Fixed-capacity, one-draw collision sparks stored in floating-origin render space. */
export class CollisionSparkView {
  readonly group = new Group();
  private readonly ribbons = new RibbonBatch(MAX_SPARKS * 6);
  private readonly positions = new Float32Array(MAX_SPARKS * 3);
  private readonly velocities = new Float32Array(MAX_SPARKS * 3);
  private readonly ages = new Float32Array(MAX_SPARKS).fill(1);
  private readonly lifetimes = new Float32Array(MAX_SPARKS).fill(1);
  private readonly sparkLengths = new Float32Array(MAX_SPARKS);
  private readonly point = new Vector3();
  private readonly tail = new Vector3();
  private readonly side = new Vector3();
  private readonly direction = new Vector3();
  private readonly view = new Vector3();
  private readonly a = new Vector3();
  private readonly b = new Vector3();
  private readonly color = new Color('#ffbf3f');
  private cursor = 0;
  private serial = 0;
  private live = 0;
  private enabled = true;
  private amount = 1;
  private thickness = 0.045;
  private length = 1.4;
  private launchSpeed = 22;
  private lifetime = 0.22;
  private spread = 0.65;

  constructor() {
    this.group.add(this.ribbons.mesh);
    this.ribbons.mesh.name = 'bounded world-space collision sparks';
  }

  configure(settings: FlightTuningSettings): void {
    this.enabled = settings.collisionSparksEnabled;
    this.amount = settings.collisionSparkAmount;
    this.color.set(settings.collisionSparkColor);
    this.thickness = settings.collisionSparkThickness;
    this.length = settings.collisionSparkLength;
    this.launchSpeed = settings.collisionSparkSpeed;
    this.lifetime = settings.collisionSparkLifetime;
    this.spread = settings.collisionSparkSpread;
    if (!this.enabled) this.clear();
  }

  emit(impact: FlightImpactSnapshot, renderOrigin: Vector3): number {
    if (!this.enabled || impact.dissipatedSpeed <= 0.05) return 0;
    const count = Math.max(0, Math.min(48,
      Math.round((2 + impact.dissipatedSpeed * 0.35) * this.amount)));
    for (let spark = 0; spark < count; spark += 1) {
      const index = this.cursor;
      const offset = index * 3;
      const serial = this.serial++;
      this.cursor = (this.cursor + 1) % MAX_SPARKS;
      this.positions[offset] = impact.point.x - renderOrigin.x;
      this.positions[offset + 1] = impact.point.y - renderOrigin.y;
      this.positions[offset + 2] = impact.point.z - renderOrigin.z;

      // Most energy follows opposite the scrape, with enough surface-normal and
      // irregular spread to read as a dense shower rather than a reflected beam.
      this.direction.copy(impact.tangentialDirection).negate().multiplyScalar(0.75)
        .addScaledVector(impact.normal, 0.25 + hash(serial * 5 + 1) * 0.55);
      this.direction.x += (hash(serial * 5 + 2) * 2 - 1) * this.spread;
      this.direction.y += (hash(serial * 5 + 3) * 2 - 1) * this.spread;
      this.direction.z += (hash(serial * 5 + 4) * 2 - 1) * this.spread;
      const outward = this.direction.dot(impact.normal);
      if (outward < 0.08) this.direction.addScaledVector(impact.normal, 0.08 - outward);
      if (this.direction.lengthSq() < 1e-8) this.direction.copy(impact.normal);
      this.direction.normalize();
      const speed = this.launchSpeed * (0.55 + hash(serial * 7 + 5) * 0.9);
      this.velocities[offset] = this.direction.x * speed;
      this.velocities[offset + 1] = this.direction.y * speed;
      this.velocities[offset + 2] = this.direction.z * speed;
      this.ages[index] = 0;
      this.lifetimes[index] = this.lifetime * (0.65 + hash(serial * 11 + 6) * 0.7);
      this.sparkLengths[index] = this.length * (0.6 + hash(serial * 13 + 7) * 0.8);
    }
    this.live = Math.min(MAX_SPARKS, this.live + count);
    return count;
  }

  update(dt: number, camera: PerspectiveCamera, frozen = false): void {
    this.ribbons.count = 0;
    this.live = 0;
    camera.getWorldDirection(this.view);
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      if (this.ages[index] >= 1) continue;
      const offset = index * 3;
      if (!frozen && dt > 0) {
        this.ages[index] = Math.min(1, this.ages[index] + dt / this.lifetimes[index]);
        if (this.ages[index] >= 1) continue;
        this.velocities[offset + 1] -= 18 * dt;
        this.positions[offset] += this.velocities[offset] * dt;
        this.positions[offset + 1] += this.velocities[offset + 1] * dt;
        this.positions[offset + 2] += this.velocities[offset + 2] * dt;
      }
      this.direction.set(
        this.velocities[offset],
        this.velocities[offset + 1],
        this.velocities[offset + 2],
      );
      const speed = this.direction.length();
      if (speed < 1e-6) continue;
      this.direction.divideScalar(speed);
      this.point.set(this.positions[offset], this.positions[offset + 1], this.positions[offset + 2]);
      this.tail.copy(this.point).addScaledVector(
        this.direction,
        -this.sparkLengths[index] * (1 - this.ages[index]),
      );
      this.side.crossVectors(this.direction, this.view);
      if (this.side.lengthSq() < 1e-8) this.side.set(0, 1, 0).cross(this.direction);
      this.side.normalize().multiplyScalar(this.thickness * (1 - this.ages[index]));
      const alpha = (1 - this.ages[index]) * 0.95;
      this.a.copy(this.point).add(this.side); this.b.copy(this.point).sub(this.side);
      this.ribbons.vertex(this.a, this.color, alpha);
      this.ribbons.vertex(this.b, this.color, alpha);
      this.a.copy(this.tail).add(this.side); this.ribbons.vertex(this.a, this.color, 0);
      this.a.copy(this.tail).add(this.side); this.ribbons.vertex(this.a, this.color, 0);
      this.ribbons.vertex(this.b, this.color, alpha);
      this.a.copy(this.tail).sub(this.side); this.ribbons.vertex(this.a, this.color, 0);
      this.live += 1;
    }
    this.ribbons.finish(true);
  }

  applyOriginShift(shift: Vector3): void {
    for (let index = 0; index < MAX_SPARKS; index += 1) {
      if (this.ages[index] >= 1) continue;
      const offset = index * 3;
      this.positions[offset] -= shift.x;
      this.positions[offset + 1] -= shift.y;
      this.positions[offset + 2] -= shift.z;
    }
  }

  clear(): void {
    this.ages.fill(1);
    this.live = 0;
    this.ribbons.count = 0;
    this.ribbons.finish(true);
  }

  get activeCount(): number { return this.live; }
  get capacity(): number { return MAX_SPARKS; }

  dispose(): void { this.ribbons.dispose(); }
}
