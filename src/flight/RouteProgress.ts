/** Debounces route-progress direction so brief drift and impact motion do not warn. */
export class RouteProgress {
  wrongWay = false;
  progressSpeed = 0;
  private previousZ = 0;
  private ready = false;
  private backwardTime = 0;
  private forwardTime = 0;

  reset(worldZ: number): void {
    this.previousZ = worldZ;
    this.ready = true;
    this.wrongWay = false;
    this.progressSpeed = 0;
    this.backwardTime = 0;
    this.forwardTime = 0;
  }

  update(dt: number, worldZ: number, enabled: boolean, warningDelay: number): boolean {
    if (dt <= 0) return this.wrongWay;
    if (!this.ready) { this.reset(worldZ); return false; }
    this.progressSpeed = (worldZ - this.previousZ) / dt;
    this.previousZ = worldZ;
    if (!enabled) {
      this.wrongWay = false;
      this.backwardTime = 0;
      this.forwardTime = 0;
      return false;
    }
    if (this.progressSpeed < -5) {
      this.backwardTime += dt;
      this.forwardTime = 0;
      if (this.backwardTime + 1e-9 >= warningDelay) this.wrongWay = true;
    } else if (this.progressSpeed > 5) {
      this.forwardTime += dt;
      this.backwardTime = 0;
      if (this.forwardTime + 1e-9 >= 0.25) this.wrongWay = false;
    } else {
      this.backwardTime = 0;
      this.forwardTime = 0;
    }
    return this.wrongWay;
  }
}
