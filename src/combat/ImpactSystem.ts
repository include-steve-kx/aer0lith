import { Color, Quaternion, Vector3 } from 'three';
import {
  COMBAT_LIMITS,
  DEFAULT_COMBAT,
  type CombatSettings,
} from './settings.ts';
import type { MeteorState } from './MeteorSystem.ts';
import { CombatRandom } from './random.ts';
import type { RockLibrary, ShardTemplate } from './geometry.ts';
export class FragmentState {
  active = false;
  age = 0;
  life = 1;
  scale = 1;
  lifeScale = 1;
  spin = 0;
  template: ShardTemplate | undefined;
  readonly position = new Vector3();
  readonly velocity = new Vector3();
  readonly orientation = new Quaternion();
  readonly axis = new Vector3();
  readonly color = new Color();
  claim = 0;
}
export class ExplosionState {
  active = false;
  age = 0;
  life = 1;
  radius = 1;
  readonly position = new Vector3();
}
class ShakeImpulse {
  active = false;
  age = 0;
  life = 1;
  phase = 0;
  frequency = 18;
  size = 1;
  readonly position = new Vector3();
}
export class ImpactSystem {
  settings: CombatSettings = { ...DEFAULT_COMBAT };
  readonly fragments = Array.from(
    { length: COMBAT_LIMITS.fragments },
    () => new FragmentState(),
  );
  readonly explosions = Array.from(
    { length: COMBAT_LIMITS.explosions },
    () => new ExplosionState(),
  );
  readonly shakes = Array.from(
    { length: COMBAT_LIMITS.shakes },
    () => new ShakeImpulse(),
  );
  readonly shakeTranslation = new Vector3();
  readonly shakeRotation = new Vector3();
  private readonly random: CombatRandom;
  private readonly rotation = new Quaternion();
  private readonly direction = new Vector3();
  private fragmentClaim = 0;
  readonly library: RockLibrary;
  constructor(library: RockLibrary, seed: string) {
    this.library = library;
    this.random = new CombatRandom(`${seed}:impacts`);
  }
  configure(settings: CombatSettings): void {
    this.settings = settings;
    if (!settings.fragmentEnabled)
      this.fragments.forEach((f) => (f.active = false));
    if (settings.explosionShakeStrength === 0) {
      this.shakes.forEach((s) => (s.active = false));
      this.shakeTranslation.set(0, 0, 0);
      this.shakeRotation.set(0, 0, 0);
    }
  }
  spawn(rock: MeteorState, point: Vector3, impactDirection: Vector3): void {
    let explosion = this.explosions.find((e) => !e.active);
    if (!explosion)
      explosion = this.explosions.reduce((a, b) =>
        a.age / a.life > b.age / b.life ? a : b,
      );
    explosion.active = true;
    explosion.age = 0;
    explosion.life = this.settings.explosionLife;
    explosion.radius = Math.min(
      60,
      rock.diameter * this.settings.explosionSize,
    );
    explosion.position.copy(point);
    if (this.settings.explosionShakeStrength > 0) {
      let shake = this.shakes.find((s) => !s.active);
      if (!shake)
        shake = this.shakes.reduce((a, b) =>
          a.age / a.life > b.age / b.life ? a : b,
        );
      shake.active = true;
      shake.age = 0;
      shake.life = this.settings.explosionShakeLife;
      shake.position.copy(point);
      shake.phase = this.random.range(0, Math.PI * 2);
      shake.frequency = this.random.range(0.85, 1.15);
      shake.size = Math.max(0.5, Math.min(1.5, rock.diameter / 12));
    }
    if (!this.settings.fragmentEnabled) return;
    const count = this.settings.fragmentCount >= 12 ? 12
      : this.settings.fragmentCount >= 8 ? 8 : 4;
    const templates = this.library.variants[rock.variant].shards.get(count)!;
    this.fragmentClaim = this.fragmentClaim >= 0x7ffffffe ? 1 : this.fragmentClaim + 1;
    for (const template of templates) {
      let f = this.fragments.find((candidate) => !candidate.active && candidate.claim !== this.fragmentClaim);
      if (!f) {
        f = this.fragments.reduce((oldest, candidate) => {
          if (candidate.claim === this.fragmentClaim) return oldest;
          if (oldest.claim === this.fragmentClaim) return candidate;
          return candidate.age / candidate.life > oldest.age / oldest.life ? candidate : oldest;
        });
      }
      f.claim = this.fragmentClaim;
      f.active = true;
      f.age = 0;
      f.life = this.settings.fragmentLife;
      f.scale = rock.diameter;
      f.lifeScale = 1;
      f.template = template;
      f.orientation.copy(rock.orientation);
      f.position
        .copy(template.center)
        .multiplyScalar(rock.diameter)
        .applyQuaternion(rock.orientation)
        .add(rock.position);
      this.direction
        .copy(template.center)
        .normalize()
        .applyQuaternion(rock.orientation);
      f.velocity
        .copy(rock.velocity)
        .addScaledVector(
          this.direction,
          this.settings.fragmentSpeed *
            this.random.range(0.7, 1.3) *
            Math.sqrt(count / 8),
        )
        .addScaledVector(impactDirection, this.settings.fragmentSpeed * 0.2);
      this.random.direction(f.axis);
      f.spin =
        ((this.settings.fragmentSpin * Math.PI) / 180) *
        this.random.range(0.5, 1.5);
      f.color.set(this.settings.meteorColor).multiplyScalar(rock.brightness);
    }
  }
  update(dt: number, ship: Vector3): void {
    if (dt <= 0) return;
    for (const f of this.fragments) {
      if (!f.active) continue;
      f.age += dt;
      if (f.age >= f.life || f.position.distanceToSquared(ship) > 1200 ** 2) {
        f.active = false;
        continue;
      }
      f.position.addScaledVector(f.velocity, dt);
      f.velocity.multiplyScalar(Math.exp(-0.5 * dt));
      f.orientation
        .multiply(this.rotation.setFromAxisAngle(f.axis, f.spin * dt))
        .normalize();
      const t = Math.min(1, Math.max(0, (f.age / f.life - 0.7) / 0.3));
      f.lifeScale = 1 - t * t * (3 - 2 * t);
    }
    for (const e of this.explosions)
      if (e.active) {
        e.age += dt;
        if (e.age >= e.life || e.position.distanceToSquared(ship) > 1200 ** 2)
          e.active = false;
      }
    this.shakeTranslation.set(0, 0, 0);
    this.shakeRotation.set(0, 0, 0);
    let total = 0;
    for (const s of this.shakes) {
      if (!s.active) continue;
      s.age += dt;
      if (s.age >= s.life) {
        s.active = false;
        continue;
      }
      s.phase +=
        dt * s.frequency * this.settings.explosionShakeFrequency * Math.PI * 2;
      const d = Math.min(
          1,
          ship.distanceTo(s.position) / this.settings.explosionShakeRadius,
        ),
        falloff = 1 - d * d * (3 - 2 * d);
      const t = Math.max(0, (s.age - 0.025) / Math.max(0.001, s.life - 0.025));
      const power =
        Math.min(1, s.age / 0.025) *
        (1 - t) ** 2 *
        falloff *
        s.size *
        this.settings.explosionShakeStrength;
      total += power;
      this.direction.set(
        Math.sin(s.phase),
        Math.sin(s.phase * 1.31 + 1.2),
        Math.sin(s.phase * 0.71) * 0.3,
      );
      this.shakeTranslation.addScaledVector(this.direction, power * 0.3);
      this.shakeRotation.addScaledVector(this.direction, power * 0.012);
    }
    if (total > 1) {
      this.shakeTranslation.divideScalar(total);
      this.shakeRotation.divideScalar(total);
    }
  }
  private disposed = false;
  dispose(): void { if (this.disposed) return; this.disposed = true; this.reset(); }
  reset(): void {
    this.fragments.forEach((f) => (f.active = false));
    this.explosions.forEach((e) => (e.active = false));
    this.shakes.forEach((s) => (s.active = false));
    this.shakeTranslation.set(0, 0, 0);
    this.shakeRotation.set(0, 0, 0);
  }
}
