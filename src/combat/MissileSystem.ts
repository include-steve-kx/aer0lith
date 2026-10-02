import { Quaternion, Vector3 } from 'three';
import { WING_TIPS } from '../core/aircraftGeometry.ts';
import { WingPose } from '../flight/WingPose.ts';
import {
  COMBAT_LIMITS,
  DEFAULT_COMBAT,
  type CombatSettings,
} from './settings.ts';
import type { MeteorHandle } from './types.ts';
import { MeteorSystem } from './MeteorSystem.ts';
import { ProjectileResolver, type ProjectileOwner } from './ProjectileResolver.ts';
import { CombatRandom } from './random.ts';
import { terrainHit } from './collision.ts';
export class MissileState {
  active = false;
  age = 0;
  distance = 0;
  speedFactor = 1;
  trail = -1;
  wing = -1;
  readonly target: MeteorHandle = { slot: -1, generation: 0 };
  readonly position = new Vector3();
  readonly previous = new Vector3();
  readonly direction = new Vector3();
  readonly orientation = new Quaternion();
}
export class MissileTrail {
  active = false;
  attached = false;
  count = 0;
  head = 0;
  lastSample = -Infinity;
  readonly positions = new Float64Array(COMBAT_LIMITS.samples * 3);
  readonly times = new Float64Array(COMBAT_LIMITS.samples);
  append(position: Vector3, time: number, force = false): void {
    if (!force && time - this.lastSample < 0.025 && this.count > 0) return;
    this.head = (this.head + 1) % COMBAT_LIMITS.samples;
    this.positions[this.head * 3] = position.x;
    this.positions[this.head * 3 + 1] = position.y;
    this.positions[this.head * 3 + 2] = position.z;
    this.times[this.head] = time;
    this.count = Math.min(COMBAT_LIMITS.samples, this.count + 1);
    this.lastSample = time;
  }
}
export class MissileSystem implements ProjectileOwner {
  settings: CombatSettings = { ...DEFAULT_COMBAT };
  time = 0;
  launches = 0;
  readonly missiles = Array.from(
    { length: COMBAT_LIMITS.missiles },
    () => new MissileState(),
  );
  readonly trails = Array.from(
    { length: COMBAT_LIMITS.trails },
    () => new MissileTrail(),
  );
  readonly ammunition = new Uint8Array(4).fill(3);
  readonly reload = new Float64Array(4);
  readonly reloadFactors = new Float64Array(4).fill(1);
  readonly muzzle = WING_TIPS.map(() => new Vector3());
  private readonly launcher: CombatRandom;
  private readonly random: CombatRandom;
  private cooldown = 0;
  private readonly eligible = new Int8Array(4);
  private readonly aim = new Vector3();
  private readonly forward = new Vector3();
  private readonly end = new Vector3();
  readonly resolver: ProjectileResolver;
  private readonly desiredQ = new Quaternion();
  private readonly hit: MeteorHandle = { slot: -1, generation: 0 };
  private readonly z = new Vector3(0, 0, 1);
  readonly meteors: MeteorSystem;
  private readonly wings: WingPose;
  constructor(meteors: MeteorSystem, seed: string, wings = new WingPose()) {
    this.wings = wings;
    this.meteors = meteors;
    this.resolver = new ProjectileResolver(meteors);
    this.launcher = new CombatRandom(`${seed}:launchers`);
    this.random = new CombatRandom(`${seed}:missiles`);
  }
  configure(settings: CombatSettings): void {
    const wasEnabled = this.settings.missileEnabled;
    this.settings = settings;
    for (let i = 0; i < 4; i++) {
      this.ammunition[i] = Math.min(
        settings.missileCapacity,
        this.ammunition[i],
      );
      if (this.ammunition[i] === settings.missileCapacity) this.reload[i] = 0;
    }
    if (wasEnabled && !settings.missileEnabled) this.clearFlights();
  }
  syncMuzzles(ship: Vector3, q: Quaternion): void {
    this.wings.tips.forEach((tip, i) =>
      this.muzzle[i]
        .copy(tip)
        .applyQuaternion(q)
        .add(ship),
    );
  }
  private retire(m: MissileState): void {
    const target = this.meteors.resolve(m.target);
    if (target && target.reserved === this.missiles.indexOf(m)) {
      target.reserved = -1;
      target.retry = 0.5;
    }
    if (m.trail >= 0) this.trails[m.trail].attached = false;
    m.active = false;
  }
  private launch(ship: Vector3, q: Quaternion): void {
    const missileIndex = this.missiles.findIndex((m) => !m.active),
      trailIndex = this.trails.findIndex((t) => !t.active);
    if (missileIndex < 0 || trailIndex < 0) return;
    this.forward.set(0, 0, 1).applyQuaternion(q);
    let best = -1,
      bestScore = Infinity;
    for (let i = 0; i < this.meteors.rocks.length; i++) {
      const rock = this.meteors.rocks[i];
      if (
        !rock.active ||
        rock.detected <= 0 ||
        rock.reserved >= 0 ||
        rock.retry > 0
      )
        continue;
      this.aim.subVectors(rock.position, ship);
      const distance = this.aim.length(),
        ahead = this.aim.dot(this.forward);
      if (
        distance > 650 ||
        distance < rock.radius + 8 ||
        ahead / Math.max(0.001, distance) < Math.cos((70 * Math.PI) / 180)
      )
        continue;
      const lateral = Math.sqrt(
        Math.max(0, distance * distance - ahead * ahead),
      );
      const score = distance + (lateral < rock.radius + 14 ? -500 : 0);
      if (score < bestScore) {
        best = i;
        bestScore = score;
      }
    }
    if (best < 0) return;
    const target = this.meteors.rocks[best];
    if (!this.meteors.hasLineOfSight(ship, target.position)) {
      target.retry = 0.5;
      return;
    }
    let count = 0;
    for (let i = 0; i < 4; i++)
      if (this.ammunition[i] > 0) {
        this.end.copy(this.muzzle[i]).addScaledVector(this.forward, 3);
        if (
          terrainHit(this.meteors.terrain, this.muzzle[i], this.end, 0.2) !==
          Infinity
        )
          continue;
        if (
          this.meteors.sweepMissile(this.muzzle[i], this.end, this.hit) !==
          Infinity
        )
          continue;
        this.eligible[count++] = i;
      }
    if (!count) return;
    const wing = this.eligible[Math.floor(this.launcher.next() * count)],
      m = this.missiles[missileIndex],
      trail = this.trails[trailIndex];
    m.active = true;
    m.age = 0;
    m.distance = 0;
    m.speedFactor = this.random.range(0.9, 1.1);
    m.trail = trailIndex;
    m.wing = wing;
    m.target.slot = best;
    m.target.generation = target.generation;
    m.position.copy(this.muzzle[wing]);
    m.previous.copy(m.position);
    m.direction.copy(this.forward);
    m.orientation.setFromUnitVectors(this.z, m.direction);
    trail.active = true;
    trail.attached = true;
    trail.count = 0;
    trail.head = 0;
    trail.lastSample = -Infinity;
    trail.append(m.position, this.time);
    target.reserved = missileIndex;
    if (this.ammunition[wing] === this.settings.missileCapacity) this.reloadFactors[wing] = this.random.range(.9, 1.1);
    this.ammunition[wing]--;
    this.cooldown = this.settings.missileInterval;
    this.launches++;
  }
  update(dt: number, ship: Vector3, q: Quaternion, shared?: ProjectileResolver): void {
    if (dt <= 0) return;
    const resolver = shared ?? this.resolver;
    if (!shared) resolver.begin();
    this.time += dt;
    this.syncMuzzles(ship, q);
    for (const t of this.trails)
      if (
        t.active &&
        !t.attached &&
        this.time - t.lastSample >= this.settings.missileTrailLife
      )
        t.active = false;
    if (!this.settings.missileEnabled || !this.settings.meteorEnabled) return;
    for (let i = 0; i < 4; i++)
      if (this.ammunition[i] < this.settings.missileCapacity) {
        this.reload[i] +=
          dt / (this.settings.missileReload * this.reloadFactors[i]);
        if (this.reload[i] >= 1) {
          this.reload[i] -= 1;
          this.ammunition[i]++;
          this.reloadFactors[i] = this.random.range(0.9, 1.1);
          if (this.ammunition[i] === this.settings.missileCapacity)
            this.reload[i] = 0;
        }
      }
    this.cooldown -= dt;
    if (this.cooldown <= 0) {
      this.cooldown = 0.05;
      this.launch(ship, q);
    }
    for (const m of this.missiles) {
      if (!m.active) continue;
      const target = this.meteors.resolve(m.target);
      if (!target) {
        this.retire(m);
        continue;
      }
      const speed = this.settings.missileSpeed * m.speedFactor;
      m.age += dt;
      m.previous.copy(m.position);
      if (m.distance > 3) {
        const lead = Math.min(
          2,
          m.position.distanceTo(target.position) / speed,
        );
        this.aim
          .copy(target.position)
          .addScaledVector(target.velocity, lead)
          .sub(m.position);
        if (this.aim.lengthSq() > 1e-10) {
          this.aim.normalize();
          this.desiredQ.setFromUnitVectors(this.z, this.aim);
          m.orientation.rotateTowards(
            this.desiredQ,
            ((this.settings.missileTurn * Math.PI) / 180) * dt,
          );
          m.direction.copy(this.z).applyQuaternion(m.orientation);
        }
      }
      m.position.addScaledVector(m.direction, speed * dt);
      m.distance += speed * dt;
      resolver.submit(this, this.missiles.indexOf(m), 0, m.previous, m.position, m.direction, 0.12);
    }
    if (!shared) resolver.resolve();
  }
  valid(slot: number): boolean { return this.missiles[slot].active && !!this.meteors.resolve(this.missiles[slot].target); }
  contact(slot: number, fraction: number, result: 'invalid' | 'damaged' | 'destroyed' | 'terrain' | 'clear'): void {
    const m = this.missiles[slot];
    // A missile that caused destruction has already invalidated its own target.
    if (result === 'invalid') { this.retire(m); return; }
    if (result !== 'clear') m.position.lerpVectors(m.previous, m.position, fraction);
    this.trails[m.trail].append(m.position, this.time, result !== 'clear');
    if (result !== 'clear' || m.age >= 8 || m.distance >= 1800) this.retire(m);
  }
  clearFlights(): void {
    for (const m of this.missiles) if (m.active) this.retire(m);
    this.trails.forEach((t) => {
      t.active = false;
      t.attached = false;
      t.count = 0;
    });
    this.cooldown = 0;
  }
  private disposed = false;
  dispose(): void { if (this.disposed) return; this.disposed = true; this.reset(); }
  reset(): void {
    this.clearFlights();
    this.time = 0;
    this.ammunition.fill(this.settings.missileCapacity);
    this.reload.fill(0);
    this.reloadFactors.fill(1);
  }
}
