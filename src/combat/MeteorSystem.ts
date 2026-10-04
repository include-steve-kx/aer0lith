import { Quaternion, Vector3 } from 'three';
import { explosionImpulse } from './ExplosionForce.ts';
import {
  COCKPIT_COLLISION_POINTS,
  HULL_POINTS,
} from '../core/aircraftGeometry.ts';
import { WingPose } from '../flight/WingPose.ts';
import type { FlightPath, TerrainSampler } from '../core/types.ts';
import {
  COMBAT_LIMITS,
  DEFAULT_COMBAT,
  type CombatSettings,
} from './settings.ts';
import { CombatRandom } from './random.ts';
import { convexShape, hullGeometry, RockLibrary, triangleShape, updateTriangleShape } from './geometry.ts';
import {
  segmentConvex,
  segmentSphere,
  separation,
  ShapePose,
  terrainHit,
} from './collision.ts';
import type {
  DynamicObstacleHit,
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
  proximityTriggerDistance = 50;
  proximityDelay = 0;
  fuseRemaining = 0;
  fuseArmed = false;
  /** Frozen meteor-local direction toward the ship at the arming instant. */
  readonly fuseTriggerDirection = new Vector3();
}
export class MeteorSystem implements DynamicObstacleProvider {
  readonly shipPosition = new Vector3();
  readonly shipVelocity = new Vector3();
  private readonly proximityHandle: MeteorHandle = { slot: -1, generation: 0 };
  private readonly proximityStart = new Vector3();
  private readonly proximityTravel = new Vector3();
  private readonly proximityCenter = new Vector3();
  private readonly proximityShipAtEntry = new Vector3();
  private readonly proximityDirection = new Vector3(0, 0, 1);
  private readonly predictedShipPosition = new Vector3();
  private readonly predictedMeteorPosition = new Vector3();
  private readonly pulseAxis = new Vector3();
  private readonly pulseOffset = new Vector3();
  private readonly pulseClosest = new Vector3();
  private readonly pulseHandle: MeteorHandle = { slot: -1, generation: 0 };

  /** The exact single-explosion impulse used by both physics and scanned arrows.
   * Combined impulses are subsequently capped by FlightController. */
  predictExplosionImpulse(out: Vector3, rock: Pick<MeteorState, 'position' | 'diameter'>): Vector3 {
    return explosionImpulse(out, this.shipPosition, rock.position, this.shipVelocity,
      this.proximityDirection, rock.diameter, this.settings.explosionPush,
      this.settings.explosionShakeRadius, this.settings.explosionVelocityAxisFactor);
  }

  /** Forecast the displayed impulse while an armed meteor counts down. The
   * physical impulse still uses the actual positions at destruction time. */
  predictProximityImpulse(out: Vector3, rock: MeteorState): Vector3 {
    if (!rock.fuseArmed || rock.fuseRemaining <= 0)
      return this.predictExplosionImpulse(out, rock);
    this.predictedShipPosition
      .copy(this.shipPosition)
      .addScaledVector(this.shipVelocity, rock.fuseRemaining);
    this.predictedMeteorPosition
      .copy(rock.position)
      .addScaledVector(rock.velocity, rock.fuseRemaining);
    return explosionImpulse(out, this.predictedShipPosition, this.predictedMeteorPosition,
      this.shipVelocity, this.proximityDirection, rock.diameter,
      this.settings.explosionPush, this.settings.explosionShakeRadius,
      this.settings.explosionVelocityAxisFactor);
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
      if (rock.fuseArmed) {
        const remainingBeforeStep = rock.fuseRemaining;
        rock.fuseRemaining = Math.max(0, remainingBeforeStep - dt);
        if (remainingBeforeStep > dt) continue;
        const detonationFraction = Math.max(0, Math.min(1, remainingBeforeStep / dt));
        this.proximityCenter.lerpVectors(rock.previous, rock.position, detonationFraction);
        this.shipPosition.lerpVectors(from, to, detonationFraction);
        this.proximityHandle.slot = slot;
        this.proximityHandle.generation = rock.generation;
        this.applyHit(this.proximityHandle, this.proximityCenter, this.proximityDirection, true);
        continue;
      }
      // Find the earliest relative-motion entry so fast passes cannot skip a
      // meteor's individually sampled surface trigger distance.
      this.proximityStart.subVectors(from, rock.previous);
      this.proximityTravel.subVectors(to, rock.position).sub(this.proximityStart);
      const radius = rock.radius + rock.proximityTriggerDistance;
      const c = this.proximityStart.lengthSq() - radius * radius;
      let entryFraction = 0;
      if (c > 0) {
        const a = this.proximityTravel.lengthSq();
        if (a <= 1e-12) continue;
        const b = this.proximityStart.dot(this.proximityTravel);
        const discriminant = b * b - a * c;
        if (discriminant < 0) continue;
        entryFraction = (-b - Math.sqrt(discriminant)) / a;
        if (entryFraction < 0 || entryFraction > 1) continue;
      }
      rock.fuseArmed = true;
      this.proximityCenter.lerpVectors(rock.previous, rock.position, entryFraction);
      this.proximityShipAtEntry.lerpVectors(from, to, entryFraction);
      rock.fuseTriggerDirection.subVectors(
        this.proximityShipAtEntry,
        this.proximityCenter,
      );
      if (rock.fuseTriggerDirection.lengthSq() > 1e-12)
        rock.fuseTriggerDirection.normalize();
      else rock.fuseTriggerDirection.copy(this.proximityDirection).negate();
      this.rockQ.slerpQuaternions(
        rock.previousQ,
        rock.orientation,
        entryFraction,
      ).invert();
      rock.fuseTriggerDirection.applyQuaternion(this.rockQ).normalize();
      const elapsedAfterEntry = (1 - entryFraction) * dt;
      if (rock.proximityDelay > elapsedAfterEntry) {
        rock.fuseRemaining = rock.proximityDelay - elapsedAfterEntry;
        continue;
      }
      rock.fuseRemaining = 0;
      const detonationFraction = Math.max(0, Math.min(
        1,
        entryFraction + rock.proximityDelay / dt,
      ));
      this.proximityCenter.lerpVectors(rock.previous, rock.position, detonationFraction);
      this.shipPosition.lerpVectors(from, to, detonationFraction);
      this.proximityHandle.slot = slot;
      this.proximityHandle.generation = rock.generation;
      this.applyHit(this.proximityHandle, this.proximityCenter, this.proximityDirection, true);
    }
    this.shipPosition.copy(to);
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

  /** Destroy every active meteor intersecting a finite, rounded beam capsule. */
  destroyInCapsule(
    start: Vector3,
    end: Vector3,
    radius: number,
    direction: Vector3,
  ): number {
    if (!(radius > 0) || !Number.isFinite(radius)) return 0;
    this.pulseAxis.subVectors(end, start);
    const axisLengthSquared = this.pulseAxis.lengthSq();
    if (!Number.isFinite(axisLengthSquared)) return 0;
    let destroyed = 0;
    for (let slot = 0; slot < this.rocks.length; slot += 1) {
      const rock = this.rocks[slot];
      if (!rock.active) continue;
      this.pulseOffset.subVectors(rock.position, start);
      const t = axisLengthSquared > 1e-12
        ? Math.max(0, Math.min(1, this.pulseOffset.dot(this.pulseAxis) / axisLengthSquared))
        : 0;
      this.pulseClosest.copy(start).addScaledVector(this.pulseAxis, t);
      const hitRadius = radius + rock.radius;
      if (rock.position.distanceToSquared(this.pulseClosest) > hitRadius * hitRadius) continue;
      this.pulseHandle.slot = slot;
      this.pulseHandle.generation = rock.generation;
      if (this.applyHit(this.pulseHandle, this.pulseClosest, direction, true) === 'destroyed')
        destroyed += 1;
    }
    return destroyed;
  }
  readonly rocks = Array.from(
    { length: COMBAT_LIMITS.meteors },
    () => new MeteorState(),
  );
  settings: CombatSettings = { ...DEFAULT_COMBAT };
  private readonly random: CombatRandom;
  private readonly fuseRandom: CombatRandom;
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
  private readonly impactDirection = new Vector3();
  private readonly impactLocal = new Vector3();
  private readonly impactWorld = new Vector3();
  private readonly shipShapes: ShapePose[];
  private readonly wings: WingPose;
  private readonly wingSweepTriangles: Vector3[][];
  private readonly cockpit: ShapePose;
  private readonly cockpitParts: ShapePose[];
  private readonly rockPoses: ShapePose[];
  readonly terrain: TerrainSampler & FlightPath;
  readonly library: RockLibrary;
  constructor(
    terrain: TerrainSampler & FlightPath,
    library: RockLibrary,
    seed: string,
    wings = new WingPose(),
  ) {
    this.wings = wings;
    this.terrain = terrain;
    this.library = library;
    this.random = new CombatRandom(`${seed}:meteors`);
    this.fuseRandom = new CombatRandom(`${seed}:meteor-fuses`);
    const hull = hullGeometry(HULL_POINTS);
    this.shipShapes = [new ShapePose(convexShape(hull)),
      ...this.wings.triangles.map(points => new ShapePose(triangleShape(points)))];
    this.wingSweepTriangles = this.wings.triangles.map(points => points.map(() => new Vector3()));
    hull.dispose();
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
    const proximityDisabled = this.settings.meteorProximityEnabled && !settings.meteorProximityEnabled;
    this.settings = settings;
    if (proximityDisabled) {
      for (const meteor of this.rocks) {
        meteor.fuseArmed = false;
        meteor.fuseRemaining = meteor.proximityDelay;
        meteor.fuseTriggerDirection.set(0, 0, 0);
      }
    }
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
      m.fuseArmed = false;
      m.fuseRemaining = 0;
      m.fuseTriggerDirection.set(0, 0, 0);
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
    m.proximityTriggerDistance = this.fuseRandom.range(
      this.settings.meteorMinTriggerDistance,
      this.settings.meteorMaxTriggerDistance,
    );
    m.proximityDelay = this.fuseRandom.range(
      this.settings.meteorMinFuseDelay,
      this.settings.meteorMaxFuseDelay,
    );
    m.fuseRemaining = m.proximityDelay;
    m.fuseArmed = false;
    m.fuseTriggerDirection.set(0, 0, 0);
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
    const count = this.settings.meteorCountMin + Math.floor(
      this.random.next() * (this.settings.meteorCountMax - this.settings.meteorCountMin + 1),
    );
    for (let n = 0; n < count; n++)
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
          .addScaledVector(
            this.forward,
            this.random.range(
              this.settings.meteorSpawnDistanceMin,
              this.settings.meteorSpawnDistanceMax,
            ),
          );
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
        this.delta.lengthSq() > Math.max(1200, this.settings.meteorSpawnDistanceMax + 400) ** 2 ||
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
    hit?: DynamicObstacleHit,
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
        m.previousQ.angleTo(m.orientation) * m.radius +
        Math.abs(this.wings.fold - this.wings.previousFold) * 12;
      for (let partIndex = 0; partIndex < parts.length; partIndex++) {
        const part = parts[partIndex];
        let t = 0,
          done = false;
        for (let iteration = 0; iteration < 16; iteration++) {
          this.position.lerpVectors(from, to, t);
          this.orientation.slerpQuaternions(fromQ, toQ, t);
          if (!cockpit && partIndex > 0) {
            const fold = this.wings.previousFold
              + (this.wings.fold - this.wings.previousFold) * t;
            const triangle = this.wings.sampleTriangle(partIndex - 1, fold,
              this.wingSweepTriangles[partIndex - 1]);
            updateTriangleShape(part.shape, triangle);
          }
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
          if (gap <= 0.015) {
            this.captureShipHit(hit, part, m.velocity);
            return true;
          }
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
        if (!done) {
          this.captureShipHit(hit, part, m.velocity);
          return true;
        }
      }
    }
    return false;
  }

  private captureShipHit(hit: DynamicObstacleHit | undefined, part: ShapePose, surfaceVelocity: Vector3): void {
    if (!hit) return;
    this.impactDirection.subVectors(this.rockP, this.position);
    this.rotation.copy(this.orientation).invert();
    this.impactDirection.applyQuaternion(this.rotation);
    let best = part.shape.vertices[0];
    let score = -Infinity;
    for (const vertex of part.shape.vertices) {
      const next = vertex.dot(this.impactDirection);
      if (next > score) { score = next; best = vertex; }
    }
    this.impactLocal.copy(best);
    this.impactWorld.copy(best).applyQuaternion(this.orientation).add(this.position);
    hit.localPoint.copy(this.impactLocal);
    hit.point.copy(this.impactWorld);
    hit.normal.subVectors(this.impactWorld, this.rockP);
    if (hit.normal.lengthSq() < 1e-8) hit.normal.subVectors(this.position, this.rockP);
    if (hit.normal.lengthSq() < 1e-8) hit.normal.set(0, 1, 0);
    else hit.normal.normalize();
    hit.surfaceVelocity.copy(surfaceVelocity);
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
