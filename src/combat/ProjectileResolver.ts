import { Vector3 } from "three";
import { COMBAT_LIMITS } from "./settings.ts";
import { terrainHit } from "./collision.ts";
import type { MeteorSystem } from "./MeteorSystem.ts";
import type { MeteorHandle } from "./types.ts";
export interface ProjectileOwner {
  valid(slot: number): boolean;
  contact(
    slot: number,
    fraction: number,
    result: "invalid" | "damaged" | "destroyed" | "terrain" | "clear",
  ): void;
}
class Contact {
  owner!: ProjectileOwner;
  slot = 0;
  kind = 0;
  radius = 0;
  start = 0;
  end = 1;
  t = Infinity;
  terrain = Infinity;
  meteor = Infinity;
  done = false;
  readonly from = new Vector3();
  readonly to = new Vector3();
  readonly direction = new Vector3();
  readonly handle: MeteorHandle = { slot: -1, generation: 0 };
}
/** Bounded, chronological arbitration shared by all weapons. No event allocations. */
export class ProjectileResolver {
  private readonly entries = Array.from(
    { length: COMBAT_LIMITS.contacts },
    () => new Contact(),
  );
  private readonly point = new Vector3();
  private count = 0;
  readonly meteors: MeteorSystem;
  constructor(meteors: MeteorSystem) {
    this.meteors = meteors;
  }
  begin(): void {
    this.count = 0;
  }
  submit(
    owner: ProjectileOwner,
    slot: number,
    kind: number,
    from: Vector3,
    to: Vector3,
    direction: Vector3,
    radius: number,
    start = 0,
    end = 1,
  ): void {
    if (this.count === this.entries.length)
      throw new Error("Projectile contact budget exceeded");
    const c = this.entries[this.count++];
    c.owner = owner;
    c.slot = slot;
    c.kind = kind;
    c.radius = radius;
    c.start = start;
    c.end = end;
    c.done = false;
    c.from.copy(from);
    c.to.copy(to);
    c.direction.copy(direction);
    c.terrain = terrainHit(this.meteors.terrain, from, to, radius);
    this.query(c);
  }
  private query(c: Contact): void {
    c.handle.slot = -1;
    c.meteor = this.meteors.sweepProjectile(
      c.from,
      c.to,
      c.handle,
      c.radius,
      c.start,
      c.end,
    );
    c.t = Math.min(c.terrain, c.meteor);
  }
  resolve(): void {
    for (let remaining = this.count; remaining > 0; remaining--) {
      let best: Contact | undefined;
      let time = Infinity;
      for (let i = 0; i < this.count; i++) {
        const c = this.entries[i];
        if (c.done) continue;
        if (c.handle.slot >= 0 && !this.meteors.resolve(c.handle))
          this.query(c);
        if (c.t > 1) continue;
        const t = c.start + Math.min(1, c.t) * (c.end - c.start);
        if (
          !best ||
          t < time ||
          (t === time &&
            (c.kind < best.kind ||
              (c.kind === best.kind && c.slot < best.slot)))
        ) {
          best = c;
          time = t;
        }
      }
      if (!best) break;
      best.done = true;
      if (!best.owner.valid(best.slot)) {
        best.owner.contact(best.slot, 0, "invalid");
        continue;
      }
      let result: "invalid" | "damaged" | "destroyed" | "terrain" | "clear" =
        "clear";
      if (best.t <= 1) {
        if (best.meteor <= best.terrain) {
          this.point.lerpVectors(best.from, best.to, best.t);
          result = this.meteors.applyHit(
            best.handle,
            this.point,
            best.direction,
            best.kind === 0,
          );
        } else result = "terrain";
      }
      best.owner.contact(best.slot, Math.min(1, best.t), result);
    }
    // Clear flights require one linear pass, not sorting every no-hit segment.
    for (let i = 0; i < this.count; i++) {
      const c = this.entries[i];
      if (!c.done)
        c.owner.contact(c.slot, 1, c.owner.valid(c.slot) ? "clear" : "invalid");
    }
    this.count = 0;
  }
}
