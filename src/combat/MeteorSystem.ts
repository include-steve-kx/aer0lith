import { Quaternion, Vector3 } from 'three';
import { explosionImpulse } from './ExplosionForce.ts';
import {
  AIRCRAFT_PARTS,
  COCKPIT_COLLISION_POINTS,
} from '../core/aircraftGeometry.ts';
import type { FlightPath, TerrainSampler } from '../core/types.ts';
import {
  COMBAT_LIMITS,
  DEFAULT_COMBAT,
  type CombatSettings,
} from './settings.ts';
import { CombatRandom } from './random.ts';
import { convexShape, hullGeometry, RockLibrary } from './geometry.ts';
import {
  segmentConvex,
  segmentSphere,
  separation,
  ShapePose,
  terrainHit,
} from './collision.ts';
import type {
  DynamicObstacleProvider,
  MeteorHandle,
  ScanSnapshot,
} from './types.ts';
export class MeteorState {
  health = 1;
  maxHealth = 1;
  hitFlash = 0;
  active = false;
  generation = 0;
  variant = 0;
  diameter = 10;
  radius = 5;
  brightness = 1;
  age = 0;
  detected = 0;
  lastScan = -1;
  reserved = -1;
  retry = 0;
  readonly position = new Vector3();
  readonly previous = new Vector3();
  readonly orientation = new Quaternion();
  readonly previousQ = new Quaternion();
  readonly velocity = new Vector3();
  readonly direction = new Vector3();
  readonly spinAxis = new Vector3();
  speedFactor = 1;
  spinFactor = 1;
}
export class MeteorSystem implements DynamicObstacleProvider {
  readonly shipPosition = new Vector3();
  readonly shipVelocity = new Vector3();
  private readonly proximityHandle: MeteorHandle = { slot: -1, generation: 0 };
  private readonly proximityStart = new Vector3();
  private readonly proximityTravel = new Vector3();
  private readonly proximityCenter = new Vector3();
  private readonly proximityDirection = new Vector3(0, 0, 1);

  /** The exact single-explosion impulse used by both physics and scanned arrows.
   * Combined impulses are subsequently capped by FlightController. */
  predictExplosionImpulse(out: Vector3, rock: Pick<MeteorState, 'position' | 'diameter'>): Vector3 {
    return explosionImpulse(out, this.shipPosition, rock.position, this.shipVelocity,
      this.proximityDirection, rock.diameter, this.settings.explosionPush,
      this.settings.explosionShakeRadius, this.settings.explosionVelocityAxisFactor);
  }

  /** Surface clearance drives both the tint and the proximity fuse. */
  dangerIntensity(rock: MeteorState): number {
    if (!this.settings.meteorProximityEnabled) return 0;
    const clearance = Math.max(0, this.shipPosition.distanceTo(rock.position) - rock.radius);
    const trigger = this.settings.meteorTriggerDistance;
    const t = Math.max(0, Math.min(1, (clearance - trigger) / (trigger * 2)));
    return 1 - t * t * (3 - 2 * t);
  }

  updateProximity(dt: number, from: Vector3, to: Vector3, orientation: Quaternion): void {
    if (dt <= 0) return;
    this.shipPosition.copy(to);
    this.shipVelocity.subVectors(to, from).divideScalar(dt);
    this.proximityDirection.set(0, 0, 1).applyQuaternion(orientation);
    if (!this.settings.meteorEnabled || !this.settings.meteorProximityEnabled) return;
    for (let slot = 0; slot < this.rocks.length; slot++) {
      const rock = this.rocks[slot];
      if (!rock.active) continue;
      // Sweep relative motion so a fast dodge cannot skip the fuse radius.
      this.proximityStart.subVectors(from, rock.previous);
      this.proximityTravel.subVectors(to, rock.position).sub(this.proximityStart);
      const lengthSq = this.proximityTravel.lengthSq();
      const t = lengthSq > 1e-12 ? Math.max(0, Math.min(1, -this.proximityStart.dot(this.proximityTravel) / lengthSq)) : 0;
      this.proximityStart.addScaledVector(this.proximityTravel, t);
      const radius = rock.radius + this.settings.meteorTriggerDistance;
      if (this.proximityStart.lengthSq() > radius * radius) continue;
      this.proximityCenter.lerpVectors(rock.previous, rock.position, t);
      this.proximityHandle.slot = slot;
      this.proximityHandle.generation = rock.generation;
      this.applyHit(this.proximityHandle, this.proximityCenter, this.proximityDirection, true);
    }
  }

  onDestroyed?: (rock: MeteorState, point: Vector3, direction: Vector3) => void;
  private readonly destroyed = new MeteorState();
  applyHit(handle: MeteorHandle, point: Vector3, direction: Vector3, lethal = false): 'invalid' | 'damaged' | 'destroyed' {
    const rock = this.resolve(handle);
    if (!rock) return 'invalid';
    rock.health = lethal ? 0 : rock.health - 1;
    rock.hitFlash = 0.1;
    if (rock.health > 0) return 'damaged';
    const snapshot = this.destroyed;
    snapshot.position.copy(rock.position); snapshot.orientation.copy(rock.orientation);
    snapshot.velocity.copy(rock.velocity); snapshot.diameter = rock.diameter;
    snapshot.variant = rock.variant; snapshot.brightness = rock.brightness;
    rock.active = false; rock.generation++; rock.reserved = -1; rock.detected = 0;
    // Synchronous consumers copy into their own fixed pools before this snapshot is reused.
    this.onDestroyed?.(snapshot, point, direction);
    return 'destroyed';
  }
  readonly rocks = Array.from(
    { length: COMBAT_LIMITS.meteors },
    () => new MeteorState(),
  );
  settings: CombatSettings = { ...DEFAULT_COMBAT };
  private readonly random: CombatRandom;
  private remaining = 4;
  private avoidanceTimer = 0;
  private selected = 0;
  private blocked = false;
  private readonly avoidanceOffset = new Vector3();
  private readonly previousCandidate = new Vector3();
  private readonly relativeStart = new Vector3();
  private readonly candidate = new Vector3();
  private readonly forward = new Vector3();
  private readonly delta = new Vector3();
  private readonly rotation = new Quaternion();
  private readonly position = new Vector3();
  private readonly orientation = new Quaternion();
  private readonly rockP = new Vector3();
  private readonly rockQ = new Quaternion();
  private readonly shipShapes: ShapePose[];
  private readonly cockpit: ShapePose;
  private readonly cockpitParts: ShapePose[];
  private readonly rockPoses: ShapePose[];
  readonly terrain: TerrainSampler & FlightPath;
  readonly library: RockLibrary;
  constructor(
    terrain: TerrainSampler & FlightPath,
    library: RockLibrary,
    seed: string,
  ) {
    this.terrain = terrain;
    this.library = library;
    this.random = new CombatRandom(`${seed}:meteors`);
    this.shipShapes = AIRCRAFT_PARTS.map((points) => {
      const g = hullGeometry(points),
        s = new ShapePose(convexShape(g));
      g.dispose();
      return s;
    });
    const g = hullGeometry(COCKPIT_COLLISION_POINTS);
    this.cockpit = new ShapePose(convexShape(g));
    this.cockpitParts = [this.cockpit];
    g.dispose();
    this.rockPoses = library.variants.map((v) => new ShapePose(v.shape));
  }
  resolve(handle: MeteorHandle): MeteorState | undefined {
    const m = this.rocks[handle.slot];
    return m?.active && m.generation === handle.generation ? m : undefined;
  }
  configure(settings: CombatSettings): void {
    const disabled = this.settings.meteorEnabled && !settings.meteorEnabled;
    this.settings = settings;
    if (disabled) this.reset();
  }
  private disposed = false;
  dispose(): void { if (this.disposed) return; this.disposed = true; this.reset(); }
  reset(): void {
    for (const m of this.rocks) {
      m.active = false;
      m.generation++;
      m.detected = 0;
      m.reserved = -1;
    }
    this.remaining = 4;
    this.avoidanceOffset.set(0, 0, 0);
    this.avoidanceTimer = 0;
    this.selected = 0;
    this.blocked = false;
  }
  spawnAt(
    position: Vector3,
    diameter: number,
    variant: number,
  ): MeteorState | undefined {
    const m = this.rocks.find((r) => !r.active);
    if (!m) return;
    m.health = m.maxHealth = Math.max(1, Math.round(this.settings.meteorBulletHits * diameter / 12));
    m.hitFlash = 0;
    m.active = true;
    m.generation++;
    m.position.copy(position);
    m.previous.copy(position);
    m.variant = variant;
    m.diameter = diameter;
    m.radius = this.library.variants[variant].shape.radius * diameter;
    m.brightness = this.random.range(0.78, 1.12);
    this.random.direction(m.spinAxis);
    this.random.direction(m.direction);
    m.speedFactor = this.random.range(0.5, 1.5);
    m.spinFactor = this.random.range(0.5, 1.5);
    m.orientation.setFromAxisAngle(
      m.spinAxis,
      this.random.range(0, Math.PI * 2),
    );
    m.previousQ.copy(m.orientation);
    m.velocity
      .copy(m.direction)
      .multiplyScalar(this.settings.meteorSpeed * m.speedFactor);
    m.age = 0;
    m.detected = 0;
    m.lastScan = -1;
    m.reserved = -1;
    m.retry = 0;
    return m;
  }
  private air(p: Vector3, radius: number): boolean {
    return this.terrain.densityAt(p.x, p.y, p.z) < -radius - 2;
  }
  private coreClear(p: Vector3, radius: number): boolean {
    const path = this.terrain.sample(p.z);
    return Math.hypot(p.x - path.x, p.y - path.y) > radius + 14;
  }
  private spawnEncounter(ship: Vector3, q: Quaternion): void {
    this.forward.set(0, 0, 1).applyQuaternion(q);
    for (let n = 0; n < this.settings.meteorCount; n++)
      for (let attempt = 0; attempt < 16; attempt++) {
        if (this.activeCount >= COMBAT_LIMITS.meteors) return;
        const diameter = this.random.range(
            this.settings.meteorMinDiameter,
            this.settings.meteorMaxDiameter,
          ),
          variant = this.library.index(
            this.settings.meteorIrregularity,
            Math.floor(this.random.next() * 8),
          );
        const radius = this.library.variants[variant].shape.radius * diameter;
        this.candidate
          .copy(ship)
          .addScaledVector(this.forward, this.random.range(300, 550));
        const path = this.terrain.sample(this.candidate.z);
        const angle = this.random.range(0, Math.PI * 2),
          r = this.random.range(
            radius + 15,
            Math.max(radius + 16, this.settings.meteorSpread),
          );
        this.candidate.set(
          path.x + Math.cos(angle) * r,
          path.y + Math.sin(angle) * r,
          this.candidate.z,
        );
        if (
          this.delta.subVectors(this.candidate, ship).dot(this.forward) < 180 ||
          !this.air(this.candidate, radius) ||
          !this.coreClear(this.candidate, radius) ||
          !this.clearance(this.candidate, radius + 3)
        )
          continue;
        this.spawnAt(this.candidate, diameter, variant);
        break;
      }
  }
  advance(dt: number, ship: Vector3, q: Quaternion): void {
    if (dt <= 0 || !this.settings.meteorEnabled) return;
    this.remaining -= dt;
    if (this.remaining <= 0) {
      this.spawnEncounter(ship, q);
      this.remaining =
        this.settings.meteorInterval * this.random.range(0.75, 1.25);
    }
    this.forward.set(0, 0, 1).applyQuaternion(q);
    for (const m of this.rocks) {
      if (!m.active) continue;
      m.previous.copy(m.position);
      m.previousQ.copy(m.orientation);
      m.hitFlash = Math.max(0, m.hitFlash - dt);
      m.age += dt;
      m.detected = Math.max(0, m.detected - dt);
      m.retry = Math.max(0, m.retry - dt);
      m.velocity
        .copy(m.direction)
        .multiplyScalar(this.settings.meteorSpeed * m.speedFactor);
      m.position.addScaledVector(m.velocity, dt);
      let valid =
        this.air(m.position, m.radius) && this.coreClear(m.position, m.radius);
      for (const other of this.rocks)
        if (
          other !== m &&
          other.active &&
          m.position.distanceToSquared(other.position) <
            (m.radius + other.radius + 1) ** 2
        ) {
          valid = false;
          break;
        }
      if (!valid) {
        m.position.copy(m.previous);
        m.direction.negate();
        m.speedFactor = Math.max(0.5, m.speedFactor * 0.9);
        m.velocity
          .copy(m.direction)
          .multiplyScalar(this.settings.meteorSpeed * m.speedFactor);
      }
      m.orientation
        .multiply(
          this.rotation.setFromAxisAngle(
            m.spinAxis,
            ((this.settings.meteorSpin * Math.PI) / 180) * m.spinFactor * dt,
          ),
        )
        .normalize();
      this.delta.subVectors(m.position, ship);
      if (
        m.age > 60 ||
        this.delta.lengthSq() > 1200 ** 2 ||
        this.delta.dot(this.forward) < -350
      ) {
        m.active = false;
        m.generation++;
        m.reserved = -1;
      }
    }
  }
  scan(scan: ScanSnapshot): void {
    if (!scan.expanding) return;
    for (const m of this.rocks) {
      if (!m.active || m.lastScan === scan.id) continue;
      const before = m.previous.distanceTo(scan.center) - scan.previousRadius,
        after = m.position.distanceTo(scan.center) - scan.radius;
      if (
        Math.min(before, after) <= m.radius &&
        Math.max(before, after) >= -m.radius
      ) {
        m.lastScan = scan.id;
        m.detected = this.settings.meteorDetection;
      }
    }
  }
  clearance(position: Vector3, radius: number): boolean {
    for (const m of this.rocks)
      if (
        m.active &&
        m.position.distanceToSquared(position) < (m.radius + radius) ** 2
      )
        return false;
    return true;
  }
  sweepMissile(from: Vector3, to: Vector3, out: MeteorHandle): number {
    return this.sweepProjectile(from, to, out, 0.15);
  }
  sweepProjectile(from: Vector3, to: Vector3, out: MeteorHandle, radius = 0.15, startFraction = 0, endFraction = 1): number {
    let best = Infinity;
    for (let i = 0; i < this.rocks.length; i++) {
      const m = this.rocks[i];
      if (!m.active) continue;
      const rotationalMargin = m.previousQ.angleTo(m.orientation) * m.radius * (endFraction - startFraction);
      this.rockP.lerpVectors(m.previous, m.position, endFraction);
      this.rockQ.slerpQuaternions(m.previousQ, m.orientation, endFraction);
      this.relativeStart.lerpVectors(m.previous, m.position, startFraction);
      this.delta.copy(from).sub(this.relativeStart).add(this.rockP);
      if (
        !segmentSphere(
          this.delta,
          to,
          this.rockP,
          m.radius + radius + rotationalMargin,
        )
      )
        continue;
      const t = segmentConvex(
        this.delta,
        to,
        this.rockP,
        this.rockQ,
        m.diameter,
        this.library.variants[m.variant].shape,
        radius + rotationalMargin,
      );
      if (t < best) {
        best = t;
        out.slot = i;
        out.generation = m.generation;
      }
    }
    return best;
  }
  sweepShip(
    from: Vector3,
    to: Vector3,
    fromQ: Quaternion,
    toQ: Quaternion,
    cockpit: boolean,
  ): boolean {
    for (const m of this.rocks) {
      if (!m.active) continue;
      this.delta.copy(from).sub(m.previous).add(m.position);
      if (!segmentSphere(this.delta, to, m.position, m.radius + 8)) continue;
      const rockPose = this.rockPoses[m.variant],
        parts = cockpit ? this.cockpitParts : this.shipShapes;
      const bound =
        from.distanceTo(to) +
        m.previous.distanceTo(m.position) +
        fromQ.angleTo(toQ) * 8 +
        m.previousQ.angleTo(m.orientation) * m.radius;
      for (const part of parts) {
        let t = 0,
          done = false;
        for (let iteration = 0; iteration < 16; iteration++) {
          this.position.lerpVectors(from, to, t);
          this.orientation.slerpQuaternions(fromQ, toQ, t);
          part.set(this.position, this.orientation, 1);
          this.rockP.lerpVectors(m.previous, m.position, t);
          this.rockQ.slerpQuaternions(m.previousQ, m.orientation, t);
          rockPose.set(this.rockP, this.rockQ, m.diameter);
          const gap = separation(
            part.vertices,
            part.normals,
            part.edges,
            rockPose.vertices,
            rockPose.normals,
            rockPose.edges,
          );
          if (gap <= 0.015) return true;
          if (bound < 1e-9) {
            done = true;
            break;
          }
          t += Math.max(1e-6, (gap / bound) * 0.9);
          if (t > 1) {
            done = true;
            break;
          }
        }
        if (!done) return true;
      }
    }
    return false;
  }
  avoidance(
    dt: number,
    ship: Vector3,
    speed: number,
    target: Vector3,
  ): boolean {
    if (this.activeCount === 0) {
      target.set(0, 0, 0);
      this.avoidanceOffset.set(0, 0, 0);
      this.blocked = false;
      return false;
    }
    this.avoidanceTimer -= dt;
    if (this.avoidanceTimer <= 0) {
      this.avoidanceTimer = 0.1;
      let best = Infinity,
        bestX = 0,
        bestY = 0,
        bestIndex = 0;
      let bypass = 24;
      for (const m of this.rocks)
        if (m.active) bypass = Math.max(bypass, m.radius + 18);
      const localRoute = this.terrain.sample(ship.z);
      for (let index = 0; index < 9; index++) {
        const angle = ((index - 1) * Math.PI) / 4,
          x = index === 0 ? 0 : Math.cos(angle) * bypass,
          y = index === 0 ? 0 : Math.sin(angle) * bypass;
        let safe = true;
        this.previousCandidate.copy(ship);
        for (let s = 1; s <= 12 && safe; s++) {
          const time = (3 * s) / 12,
            path = this.terrain.sample(ship.z + speed * time),
            blend = Math.min(1, time);
          this.candidate.set(
            path.x + x * blend + (ship.x - localRoute.x) * (1 - blend),
            path.y + y * blend + (ship.y - localRoute.y) * (1 - blend),
            ship.z + speed * time,
          );
          if (
            this.terrain.densityAt(
              this.candidate.x,
              this.candidate.y,
              this.candidate.z,
            ) > -9
          ) {
            safe = false;
            break;
          }
          for (const m of this.rocks)
            if (m.active) {
              this.delta.copy(m.position).addScaledVector(m.velocity, time);
              this.relativeStart
                .copy(this.previousCandidate)
                .addScaledVector(m.velocity, 0.25);
              if (
                segmentSphere(
                  this.relativeStart,
                  this.candidate,
                  this.delta,
                  m.radius + 10,
                )
              ) {
                safe = false;
                break;
              }
            }
          this.previousCandidate.copy(this.candidate);
        }
        const score = x * x + y * y + (index === this.selected ? -80 : 0);
        if (safe && score < best) {
          best = score;
          bestX = x;
          bestY = y;
          bestIndex = index;
        }
      }
      this.blocked = !Number.isFinite(best);
      if (!this.blocked) {
        this.avoidanceOffset.set(bestX, bestY, 0);
        this.selected = bestIndex;
      }
    }
    target.copy(this.avoidanceOffset);
    return this.blocked;
  }
  hasLineOfSight(from: Vector3, to: Vector3): boolean {
    return terrainHit(this.terrain, from, to) === Infinity;
  }
  get activeCount(): number {
    let count = 0;
    for (const m of this.rocks) if (m.active) count++;
    return count;
  }
}
