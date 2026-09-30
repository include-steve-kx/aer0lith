/** Shared keyboard/touch latch. Press spacing advances only during simulation. */
export class BoostLatch {
  private readonly held = new Set<string>();
  private tapCount = 0;
  private tapAge = Infinity;
  private suppressed = false;
  locked = false;
  readonly tapWindow = 0.4;

  setHeld(source: string, active: boolean): void {
    if (active) {
      if (this.held.has(source)) return;
      const alreadyHeld = this.held.size > 0;
      this.held.add(source);
      // Overlapping fingers/keys count as a single press, not extra taps.
      if (alreadyHeld) return;
      if (this.locked) {
        this.locked = false;
        this.tapCount = 0;
        this.tapAge = Infinity;
        this.suppressed = true;
      } else {
        this.tapCount = this.tapAge <= this.tapWindow ? this.tapCount + 1 : 1;
        this.tapAge = 0;
        if (this.tapCount === 3) { this.locked = true; this.tapCount = 0; }
      }
    } else {
      this.held.delete(source);
      if (this.held.size === 0) this.suppressed = false;
    }
  }

  update(dt: number): void { this.tapAge += Math.max(0, dt); }
  get active(): boolean { return this.locked || (this.held.size > 0 && !this.suppressed); }
  releaseAll(): void { this.held.clear(); this.tapCount = 0; this.tapAge = Infinity; this.suppressed = false; }
  reset(): void { this.releaseAll(); this.locked = false; }
}
