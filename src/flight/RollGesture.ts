/** Two separate same-direction strokes; a held key/stick cannot retrigger. */
export class RollGesture {
  private direction = 0;
  private time = -Infinity;
  private stickDirection = 0;
  readonly windowMs = 320;

  tap(direction: -1 | 1, timeMs: number): -1 | 0 | 1 {
    if (direction === this.direction && timeMs - this.time <= this.windowMs) {
      this.direction = 0; this.time = -Infinity;
      return direction;
    }
    this.direction = direction; this.time = timeMs;
    return 0;
  }

  stick(value: number, timeMs: number): -1 | 0 | 1 {
    if (Math.abs(value) < 0.25) this.stickDirection = 0;
    if (Math.abs(value) < 0.65 || Math.sign(value) === this.stickDirection) return 0;
    this.stickDirection = Math.sign(value);
    return this.tap(this.stickDirection as -1 | 1, timeMs);
  }

  releaseStick(): void { this.stickDirection = 0; }
  reset(): void { this.direction = 0; this.time = -Infinity; this.stickDirection = 0; }
}
