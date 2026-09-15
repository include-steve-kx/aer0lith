export function hashString(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export class SeededNoise {
  readonly seed: number;

  constructor(seed: string | number) {
    this.seed = typeof seed === 'string' ? hashString(seed) : seed >>> 0;
  }

  private hash(x: number, y: number, z = 0): number {
    let h = this.seed
      ^ Math.imul(x, 0x27d4eb2d)
      ^ Math.imul(y, 0x165667b1)
      ^ Math.imul(z, 0x9e3779b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) >>> 0;
  }

  private gradient(ix: number, iy: number, x: number, y: number): number {
    const angle = (this.hash(ix, iy) / 0xffffffff) * Math.PI * 2;
    return Math.cos(angle) * x + Math.sin(angle) * y;
  }

  noise2(x: number, y: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const tx = x - x0;
    const ty = y - y0;
    const u = fade(tx);
    const v = fade(ty);

    const n00 = this.gradient(x0, y0, tx, ty);
    const n10 = this.gradient(x0 + 1, y0, tx - 1, ty);
    const n01 = this.gradient(x0, y0 + 1, tx, ty - 1);
    const n11 = this.gradient(x0 + 1, y0 + 1, tx - 1, ty - 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.4142;
  }

  private gradient3(ix: number, iy: number, iz: number, x: number, y: number, z: number): number {
    const gradients = [
      [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
      [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
      [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
    ] as const;
    const gradient = gradients[this.hash(ix, iy, iz) % gradients.length];
    return gradient[0] * x + gradient[1] * y + gradient[2] * z;
  }

  noise3(x: number, y: number, z: number): number {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const z0 = Math.floor(z);
    const tx = x - x0;
    const ty = y - y0;
    const tz = z - z0;
    const u = fade(tx);
    const v = fade(ty);
    const w = fade(tz);

    const n000 = this.gradient3(x0, y0, z0, tx, ty, tz);
    const n100 = this.gradient3(x0 + 1, y0, z0, tx - 1, ty, tz);
    const n010 = this.gradient3(x0, y0 + 1, z0, tx, ty - 1, tz);
    const n110 = this.gradient3(x0 + 1, y0 + 1, z0, tx - 1, ty - 1, tz);
    const n001 = this.gradient3(x0, y0, z0 + 1, tx, ty, tz - 1);
    const n101 = this.gradient3(x0 + 1, y0, z0 + 1, tx - 1, ty, tz - 1);
    const n011 = this.gradient3(x0, y0 + 1, z0 + 1, tx, ty - 1, tz - 1);
    const n111 = this.gradient3(x0 + 1, y0 + 1, z0 + 1, tx - 1, ty - 1, tz - 1);

    const z0Value = lerp(lerp(n000, n100, u), lerp(n010, n110, u), v);
    const z1Value = lerp(lerp(n001, n101, u), lerp(n011, n111, u), v);
    return lerp(z0Value, z1Value, w) * 0.92;
  }

  fbm(x: number, y: number, octaves: number, lacunarity = 2, gain = 0.5): number {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let normalization = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += this.noise2(x * frequency, y * frequency) * amplitude;
      normalization += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / normalization;
  }

  ridged(x: number, y: number, octaves: number): number {
    let amplitude = 0.55;
    let frequency = 1;
    let sum = 0;
    let normalization = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      const ridge = 1 - Math.abs(this.noise2(x * frequency, y * frequency));
      sum += ridge * ridge * amplitude;
      normalization += amplitude;
      amplitude *= 0.5;
      frequency *= 2.13;
    }
    return sum / normalization;
  }

  fbm3(
    x: number,
    y: number,
    z: number,
    octaves: number,
    lacunarity = 2.03,
    gain = 0.5,
  ): number {
    let amplitude = 0.5;
    let frequency = 1;
    let sum = 0;
    let normalization = 0;
    for (let octave = 0; octave < octaves; octave += 1) {
      sum += this.noise3(x * frequency, y * frequency, z * frequency) * amplitude;
      normalization += amplitude;
      amplitude *= gain;
      frequency *= lacunarity;
    }
    return sum / normalization;
  }
}
