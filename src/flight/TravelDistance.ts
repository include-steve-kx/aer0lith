export interface TravelPosition {
  x: number;
  y: number;
  z: number;
}

/** Tracks real aircraft travel independently from render-origin rebases. */
export class TravelDistance {
  total = 0;
  private x = 0;
  private y = 0;
  private z = 0;
  private anchored = false;

  reset(position: TravelPosition): void {
    this.total = 0;
    this.reanchor(position);
  }

  reanchor(position: TravelPosition): void {
    this.x = position.x;
    this.y = position.y;
    this.z = position.z;
    this.anchored = true;
  }

  update(position: TravelPosition): number {
    if (![position.x, position.y, position.z].every(Number.isFinite)) return this.total;
    if (!this.anchored) {
      this.reanchor(position);
      return this.total;
    }
    const dx = position.x - this.x;
    const dy = position.y - this.y;
    const dz = position.z - this.z;
    const distance = Math.hypot(dx, dy, dz);
    this.total += distance;
    this.reanchor(position);
    return this.total;
  }
}
