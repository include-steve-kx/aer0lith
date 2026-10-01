import { Vector3 } from 'three';
import {
  DEFAULT_COMBAT,
  type CombatSettings,
  type PulseSettings,
} from './settings.ts';

const DIRECTION_EPSILON_SQUARED = 1e-12;

export interface PulseShot {
  id: number;
  readonly visualStart: Vector3;
  readonly visualEnd: Vector3;
  readonly carveStart: Vector3;
  readonly carveEnd: Vector3;
  readonly direction: Vector3;
  radius: number;
  age: number;
  duration: number;
}

/** Fixed-state Pulse Cannon timing and immutable-per-activation shot geometry. */
export class PulseCannonSystem {
  settings: PulseSettings = { ...DEFAULT_COMBAT };
  readonly shot: PulseShot = {
    id: 0,
    visualStart: new Vector3(),
    visualEnd: new Vector3(),
    carveStart: new Vector3(),
    carveEnd: new Vector3(),
    direction: new Vector3(0, 0, 1),
    radius: DEFAULT_COMBAT.pulseRadius,
    age: DEFAULT_COMBAT.pulseDuration,
    duration: DEFAULT_COMBAT.pulseDuration,
  };
  private pending = false;
  private cooldown = 0;

  configure(settings: CombatSettings): void {
    const wasEnabled = this.settings.pulseEnabled;
    this.settings = settings;
    if (wasEnabled && !settings.pulseEnabled) this.reset();
  }

  requestFire(): void {
    if (this.settings.pulseEnabled && this.cooldown <= 0) this.pending = true;
  }

  clearRequest(): void { this.pending = false; }

  tryFire(
    muzzle: Vector3,
    aimPoint: Vector3,
    terrainReady = true,
  ): PulseShot | undefined {
    if (!this.pending) return;
    this.pending = false;
    if (!this.settings.pulseEnabled || this.cooldown > 0 || !terrainReady) return;
    const shot = this.shot;
    shot.direction.subVectors(aimPoint, muzzle);
    if (!Number.isFinite(shot.direction.lengthSq()) || shot.direction.lengthSq() <= DIRECTION_EPSILON_SQUARED)
      return;
    shot.direction.normalize();
    const range = this.settings.pulseRange;
    const radius = Math.min(this.settings.pulseRadius, range * 0.5);
    shot.id += 1;
    shot.visualStart.copy(muzzle);
    shot.visualEnd.copy(muzzle).addScaledVector(shot.direction, range);
    shot.carveStart.copy(muzzle).addScaledVector(shot.direction, radius);
    shot.carveEnd.copy(muzzle).addScaledVector(shot.direction, range - radius);
    shot.radius = radius;
    shot.age = 0;
    shot.duration = this.settings.pulseDuration;
    this.cooldown = this.settings.pulseCooldown;
    return shot;
  }

  update(dt: number): void {
    if (!(dt > 0)) return;
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.visualActive) this.shot.age = Math.min(this.shot.duration, this.shot.age + dt);
  }

  reset(): void {
    this.pending = false;
    this.cooldown = 0;
    this.shot.age = this.shot.duration;
  }

  get visualActive(): boolean { return this.shot.id > 0 && this.shot.age < this.shot.duration; }
  get ready(): boolean { return this.settings.pulseEnabled && this.cooldown <= 0; }
  get cooldownRemaining(): number { return this.cooldown; }
  get cooldownFraction(): number {
    return this.settings.pulseCooldown > 0
      ? Math.min(1, this.cooldown / this.settings.pulseCooldown)
      : 0;
  }
}
