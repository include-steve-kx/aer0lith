import { PROBE } from '../core/config.ts';

export class ProbeScheduler {
  private remaining = 0;
  private readonly random: () => number;

  constructor(random: () => number = Math.random) {
    this.random = random;
    this.reset();
  }

  update(dt: number, enabled = true): boolean {
    if (!enabled) return false;
    this.remaining -= Math.max(0, dt);
    return this.remaining <= 0;
  }

  reset(): void {
    const random = Math.min(1, Math.max(0, this.random()));
    this.remaining = PROBE.minInterval + random * (PROBE.maxInterval - PROBE.minInterval);
  }

  get secondsUntilNext(): number {
    return this.remaining;
  }
}
