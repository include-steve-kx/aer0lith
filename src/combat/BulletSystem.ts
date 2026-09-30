import { Camera, Quaternion, Vector3 } from "three";
import { AIRCRAFT_PARTS, WING_TIPS } from "../core/aircraftGeometry.ts";
import {
  COMBAT_LIMITS,
  DEFAULT_COMBAT,
  type CombatSettings,
} from "./settings.ts";
import { CombatRandom } from "./random.ts";
import { convexShape, hullGeometry } from "./geometry.ts";
import { segmentConvex } from "./collision.ts";
import {
  ProjectileResolver,
  type ProjectileOwner,
} from "./ProjectileResolver.ts";
import type { MeteorSystem } from "./MeteorSystem.ts";
const DEG = Math.PI / 180;
export class BulletState {
  active = false;
  birth = 0;
  age = 0;
  speed = 0;
  diameter = 0;
  length = 0;
  range = 0;
  distance = 0;
  trail = -1;
  wing = 0;
  start = 0;
  readonly position = new Vector3();
  readonly previous = new Vector3();
  readonly direction = new Vector3();
}
export class BulletTrail {
  active = false;
  attached = false;
  birth = 0;
  death = Infinity;
  speed = 0;
  distance = 0;
  readonly origin = new Vector3();
  readonly direction = new Vector3();
}
export class MuzzleFlash {
  birth = -Infinity;
  life = 0.06;
  readonly direction = new Vector3(0, 0, 1); // aircraft-local direction follows its wing
}
export class HitSpark {
  birth = -Infinity;
  readonly position = new Vector3();
}
/** Pure aiming math; no scene raycasts, target lookup, or cosmetic camera shake. */
export class BulletAim {
  readonly point = new Vector3();
  readonly forward = new Vector3();
  readonly direction = new Vector3();
  private readonly offset = new Vector3();
  private readonly side = new Vector3();
  private readonly up = new Vector3();
  update(
    ship: Vector3,
    q: Quaternion,
    cameraOffset: Vector3,
    cameraDirection: Vector3,
    distance: number,
    cone: number,
  ): void {
    this.forward.set(0, 0, 1).applyQuaternion(q);
    const projection = cameraOffset.dot(cameraDirection);
    const disc =
      projection * projection - cameraOffset.lengthSq() + distance * distance;
    const t = disc >= 0 ? -projection + Math.sqrt(disc) : -1;
    this.direction.copy(this.forward);
    if (t > 0)
      this.direction
        .copy(cameraOffset)
        .addScaledVector(cameraDirection, t)
        .normalize();
    const angle = this.direction.angleTo(this.forward),
      limit = cone * DEG;
    if (angle > limit) {
      this.side
        .copy(this.direction)
        .addScaledVector(this.forward, -this.direction.dot(this.forward));
      if (this.side.lengthSq() < 1e-10)
        this.side.set(1, 0, 0).applyQuaternion(q);
      this.side.normalize();
      this.direction
        .copy(this.forward)
        .multiplyScalar(Math.cos(limit))
        .addScaledVector(this.side, Math.sin(limit));
    }
    this.point.copy(ship).addScaledVector(this.direction, distance);
  }
  sample(
    ship: Vector3,
    distance: number,
    spread: number,
    cone: number,
    random: CombatRandom,
    out: Vector3,
  ): void {
    out.copy(this.point);
    if (spread <= 0 || cone <= 0) return;
    this.up.set(
      Math.abs(this.direction.y) < 0.9 ? 0 : 1,
      Math.abs(this.direction.y) < 0.9 ? 1 : 0,
      0,
    );
    this.side.crossVectors(this.direction, this.up).normalize();
    this.up.crossVectors(this.side, this.direction).normalize();
    const radius = distance * Math.tan(spread * DEG),
      minimum = Math.cos(cone * DEG);
    for (let i = 0; i < 16; i++) {
      const r = radius * Math.sqrt(random.next()),
        theta = random.next() * Math.PI * 2;
      out
        .copy(this.point)
        .addScaledVector(this.side, r * Math.cos(theta))
        .addScaledVector(this.up, r * Math.sin(theta));
      this.offset.subVectors(out, ship).normalize();
      if (this.offset.dot(this.forward) >= minimum - 1e-12) return;
    }
    out.copy(this.point);
  }
}
export class BulletSystem implements ProjectileOwner {
  settings: CombatSettings = { ...DEFAULT_COMBAT };
  readonly bullets = Array.from(
    { length: COMBAT_LIMITS.bullets },
    () => new BulletState(),
  );
  readonly trails = Array.from(
    { length: COMBAT_LIMITS.bulletTrails },
    () => new BulletTrail(),
  );
  readonly flashes = Array.from({ length: 4 }, () => new MuzzleFlash());
  readonly sparks = Array.from(
    { length: COMBAT_LIMITS.sparks },
    () => new HitSpark(),
  );
  readonly muzzles = WING_TIPS.map(() => new Vector3());
  readonly aim = new BulletAim();
  readonly cameraOffset = new Vector3(0, 8, -22);
  readonly cameraDirection = new Vector3(0, 0, 1);
  readonly resolver: ProjectileResolver;
  time = 0;
  shots = 0;
  skipped = 0;
  cooldown = 0;
  private readonly launcher: CombatRandom;
  private readonly cadence: CombatRandom;
  private readonly spread: CombatRandom;
  private readonly target = new Vector3();
  private readonly direction = new Vector3();
  private readonly localFrom = new Vector3();
  private readonly localTo = new Vector3();
  private readonly inverse = new Quaternion();
  private readonly identity = new Quaternion();
  private readonly zero = new Vector3();
  private readonly eligible = new Int8Array(4);
  private readonly shapes = AIRCRAFT_PARTS.map((points) => {
    const g = hullGeometry(points),
      s = convexShape(g);
    g.dispose();
    return s;
  });
  private sparkCursor = 0;
  private disposed = false;
  constructor(meteors: MeteorSystem, seed: string) {
    this.resolver = new ProjectileResolver(meteors);
    this.launcher = new CombatRandom(`${seed}:bullet-wings`);
    this.cadence = new CombatRandom(`${seed}:bullet-cadence`);
    this.spread = new CombatRandom(`${seed}:bullet-spread`);
  }
  configure(settings: CombatSettings): void {
    this.cooldown *= this.settings.bulletRate / settings.bulletRate;
    if (this.settings.bulletEnabled && !settings.bulletEnabled) this.reset();
    this.settings = settings;
  }
  setCamera(camera: Camera, origin: Vector3, ship: Vector3): void {
    this.cameraOffset.copy(camera.position).add(origin).sub(ship);
    camera.getWorldDirection(this.cameraDirection);
  }
  sync(ship: Vector3, q: Quaternion): void {
    for (let i = 0; i < 4; i++)
      this.muzzles[i]
        .set(...WING_TIPS[i])
        .applyQuaternion(q)
        .add(ship);
    this.aim.update(
      ship,
      q,
      this.cameraOffset,
      this.cameraDirection,
      this.settings.bulletConvergence,
      this.settings.bulletCone,
    );
  }
  private launch(birth: number, ship: Vector3, q: Quaternion): void {
    let slot = -1,
      trail = -1;
    for (let i = 0; i < this.bullets.length; i++)
      if (!this.bullets[i].active) {
        slot = i;
        break;
      }
    for (let i = 0; i < this.trails.length; i++)
      if (!this.trails[i].active) {
        trail = i;
        break;
      }
    if (slot < 0 || trail < 0) {
      this.skipped++;
      return;
    }
    this.aim.sample(
      ship,
      this.settings.bulletConvergence,
      this.settings.bulletSpread,
      this.settings.bulletCone,
      this.spread,
      this.target,
    );
    this.inverse.copy(q).invert();
    let count = 0;
    for (let i = 0; i < 4; i++) {
      this.direction
        .subVectors(this.target, this.muzzles[i])
        .normalize()
        .applyQuaternion(this.inverse);
      this.localFrom.set(...WING_TIPS[i]).addScaledVector(this.direction, 0.02);
      this.localTo.copy(this.localFrom).addScaledVector(this.direction, 15);
      let blocked = false;
      for (const shape of this.shapes)
        if (
          segmentConvex(
            this.localFrom,
            this.localTo,
            this.zero,
            this.identity,
            1,
            shape,
          ) <= 1
        ) {
          blocked = true;
          break;
        }
      if (!blocked) this.eligible[count++] = i;
    }
    if (!count) {
      this.skipped++;
      return;
    }
    const wing = this.eligible[Math.floor(this.launcher.next() * count)],
      b = this.bullets[slot],
      t = this.trails[trail];
    b.active = true;
    b.birth = birth;
    b.age = 0;
    b.distance = 0;
    b.wing = wing;
    b.trail = trail;
    b.speed = this.settings.bulletSpeed;
    b.diameter = this.settings.bulletDiameter;
    b.length = this.settings.bulletLength;
    b.range = this.settings.bulletRange;
    b.position.copy(this.muzzles[wing]);
    b.previous.copy(b.position);
    b.direction.subVectors(this.target, b.position).normalize();
    t.active = t.attached = true;
    t.birth = birth;
    t.death = Infinity;
    t.speed = b.speed;
    t.distance = 0;
    t.origin.copy(b.position);
    t.direction.copy(b.direction);
    const f = this.flashes[wing];
    f.birth = birth;
    f.life = this.settings.muzzleLife;
    f.direction.copy(b.direction).applyQuaternion(this.inverse);
    this.shots++;
  }
  update(
    dt: number,
    held: boolean,
    ship: Vector3,
    q: Quaternion,
    shared?: ProjectileResolver,
  ): void {
    if (dt <= 0) return;
    const start = this.time;
    this.time += dt;
    this.sync(ship, q);
    for (const t of this.trails)
      if (
        t.active &&
        !t.attached &&
        this.time - t.death >= this.settings.bulletTrailLife
      )
        t.active = false;
    if (!this.settings.bulletEnabled) return;
    const resolver = shared ?? this.resolver;
    if (!shared) resolver.begin();
    if (held) {
      // Minimum supported interval exceeds one simulation step. Preserve fractional births.
      let offset = Math.max(0, this.cooldown);
      let attempts = 0;
      while (offset < dt && attempts++ < 8) {
        this.launch(start + offset, ship, q);
        offset +=
          this.cadence.range(
            1 - this.settings.bulletVariation,
            1 + this.settings.bulletVariation,
          ) / this.settings.bulletRate;
      }
      this.cooldown = Math.max(0, offset - dt);
    } else this.cooldown = Math.max(0, this.cooldown - dt);
    for (let i = 0; i < this.bullets.length; i++) {
      const b = this.bullets[i];
      if (!b.active) continue;
      const born = Math.max(start, b.birth),
        duration = Math.max(
          0,
          Math.min(
            this.time - born,
            4 - b.age,
            (b.range - b.distance) / b.speed,
          ),
        );
      b.start = (born - start) / dt;
      b.previous.copy(b.position);
      b.position.addScaledVector(b.direction, b.speed * duration);
      b.age += duration;
      b.distance += b.speed * duration;
      resolver.submit(
        this,
        i,
        1,
        b.previous,
        b.position,
        b.direction,
        b.diameter * 0.5,
        b.start,
        b.start + duration / dt,
      );
    }
    if (!shared) resolver.resolve();
  }
  valid(slot: number): boolean {
    return this.bullets[slot].active;
  }
  contact(
    slot: number,
    fraction: number,
    result: "invalid" | "damaged" | "destroyed" | "terrain" | "clear",
  ): void {
    const b = this.bullets[slot],
      t = this.trails[b.trail];
    if (result !== "clear") {
      const lost = b.previous.distanceTo(b.position) * (1 - fraction);
      b.distance -= lost;
      b.age -= lost / b.speed;
      b.position.lerpVectors(b.previous, b.position, fraction);
      if (result === "damaged") {
        const spark = this.sparks[this.sparkCursor++ % this.sparks.length];
        spark.birth = b.birth + b.age;
        spark.position.copy(b.position);
      }
    }
    t.distance = b.distance;
    if (
      result !== "clear" ||
      b.age >= 4 - 1e-9 ||
      b.distance >= b.range - 1e-7
    ) {
      b.active = false;
      t.attached = false;
      t.death = b.birth + b.age;
    }
  }
  reset(): void {
    for (const b of this.bullets) b.active = false;
    for (const t of this.trails) t.active = t.attached = false;
    for (const f of this.flashes) f.birth = -Infinity;
    for (const s of this.sparks) s.birth = -Infinity;
    this.time = this.cooldown = 0;
    this.resolver.begin();
  }
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.reset();
  }
}
