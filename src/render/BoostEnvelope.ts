/** Sustained throttle flame with a press flare and a configurable release fade. */
export class BoostEnvelope {
  age = 0;
  fadeDuration = 2.8;
  private held = false;
  private level = 0;
  private releaseLevel = 0;
  private releaseAge = 0;
  private shakeLevel = 0;
  private shakeAge = Infinity;

  get intensity(): number { return this.level; }
  /** Initial acceleration only; the steady flame must not sustain camera shake. */
  get shakeIntensity(): number { return this.shakeLevel; }

  update(dt: number, pressed: boolean): void {
    if (dt <= 0) return;
    if (pressed) {
      if (!this.held) { this.age = 0; this.shakeAge = 0; }
      this.age += dt;
      const attack = Math.min(1, this.age / 0.065);
      const flare = Math.exp(-Math.max(0, this.age - 0.065) / 0.45);
      this.level = attack * (0.42 + 0.58 * flare);
    } else {
      if (this.held) {
        this.releaseLevel = this.level;
        this.releaseAge = 0;
      }
      this.releaseAge += dt;
      const remaining = Math.max(0, 1 - this.releaseAge / this.fadeDuration);
      this.level = this.releaseLevel * remaining * remaining;
    }
    // Camera shake has its own lifetime from ignition, independent of the
    // sustained flame and release. Releasing must not restart this timer.
    this.shakeAge += dt;
    const shakeAttack = Math.min(1, this.shakeAge / 0.065);
    const shakeRemaining = Math.max(0, 1 - Math.max(0, this.shakeAge - 0.065) / this.fadeDuration);
    this.shakeLevel = shakeAttack * shakeRemaining * shakeRemaining;
    this.held = pressed;
  }

  reset(): void {
    this.age = 0;
    this.held = false;
    this.level = 0;
    this.releaseLevel = 0;
    this.releaseAge = 0;
    this.shakeLevel = 0;
    this.shakeAge = Infinity;
  }
}
