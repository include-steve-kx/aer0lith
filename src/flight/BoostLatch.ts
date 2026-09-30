/** Shared keyboard/touch hold state. Timing advances only with the simulation. */
export class BoostLatch {
  private readonly held = new Set<string>();
  private heldTime = 0;
  private suppressed = false;
  locked = false;
  readonly holdDelay = 5;
  readonly fillDuration = 2;

  setHeld(source: string, active: boolean): void {
    if (active) {
      if (this.held.has(source)) return;
      this.held.add(source);
      if (this.locked) {
        this.locked = false;
        this.heldTime = 0;
        // The unlocking press must not immediately become another boost.
        this.suppressed = true;
      }
    } else {
      this.held.delete(source);
      if (this.held.size === 0) { this.heldTime = 0; this.suppressed = false; }
    }
  }

  update(dt: number): void {
    if (this.held.size === 0 || this.suppressed || this.locked) return;
    this.heldTime += Math.max(0, dt);
    if (this.heldTime >= this.holdDelay + this.fillDuration - 1e-9) this.locked = true;
  }

  get active(): boolean { return this.locked || (this.held.size > 0 && !this.suppressed); }
  get progress(): number {
    return this.locked ? 1 : Math.max(0, Math.min(1, (this.heldTime - this.holdDelay) / this.fillDuration));
  }
  releaseAll(): void { this.held.clear(); this.heldTime = 0; this.suppressed = false; }
  reset(): void { this.releaseAll(); this.locked = false; }
}
