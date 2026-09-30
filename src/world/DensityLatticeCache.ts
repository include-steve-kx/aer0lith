/** Bounded, seed-local memoization of immutable terrain lattice vertices.
 * Exact coordinate keys make hash collisions a cache miss, never a wrong density.
 * World coordinates remain valid across rendering-origin changes.
 */
export class DensityLatticeCache {
  static readonly capacity = 32_768;
  private readonly x = new Float64Array(DensityLatticeCache.capacity);
  private readonly y = new Float64Array(DensityLatticeCache.capacity);
  private readonly z = new Float64Array(DensityLatticeCache.capacity);
  private readonly value = new Float64Array(DensityLatticeCache.capacity);
  private readonly valid = new Uint8Array(DensityLatticeCache.capacity);

  get(x: number, y: number, z: number, sample: (x: number, y: number, z: number) => number): number {
    const slot = (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & (DensityLatticeCache.capacity - 1);
    if (this.valid[slot] && this.x[slot] === x && this.y[slot] === y && this.z[slot] === z) return this.value[slot];
    const value = sample(x, y, z);
    this.x[slot] = x; this.y[slot] = y; this.z[slot] = z;
    this.value[slot] = value; this.valid[slot] = 1;
    return value;
  }
}
