/** Multi-source hold state with one-shot edges and no tap/lock interpretation. */
export class HoldAction {
  private readonly sources = new Set<string>();
  private pressedPending = false;
  private releasedPending = false;

  get active(): boolean { return this.sources.size > 0; }

  setHeld(source: string, active: boolean): void {
    const wasActive = this.active;
    if (active) this.sources.add(source);
    else this.sources.delete(source);
    if (!wasActive && this.active) this.pressedPending = true;
    if (wasActive && !this.active) this.releasedPending = true;
  }

  consumePressed(): boolean {
    const value = this.pressedPending;
    this.pressedPending = false;
    return value;
  }

  consumeReleased(): boolean {
    const value = this.releasedPending;
    this.releasedPending = false;
    return value;
  }

  releaseAll(): void {
    const wasActive = this.active;
    this.sources.clear();
    if (wasActive) this.releasedPending = true;
    this.pressedPending = false;
  }

  reset(): void {
    this.sources.clear();
    this.pressedPending = false;
    this.releasedPending = false;
  }
}
