import { Vector3 } from 'three';
import { hashString } from '../world/Noise.ts';
export class CombatRandom {
  private state: number;
  constructor(seed: string) {
    this.state = hashString(seed) || 1;
  }
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let v = this.state;
    v = Math.imul(v ^ (v >>> 15), v | 1);
    v ^= v + Math.imul(v ^ (v >>> 7), v | 61);
    return ((v ^ (v >>> 14)) >>> 0) / 4294967296;
  }
  range(a: number, b: number): number {
    return a + (b - a) * this.next();
  }
  direction(out: Vector3): Vector3 {
    const z = this.range(-1, 1),
      a = this.range(0, Math.PI * 2),
      r = Math.sqrt(1 - z * z);
    return out.set(r * Math.cos(a), r * Math.sin(a), z);
  }
}
