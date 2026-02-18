/** Shared noise and PRNG utilities for deterministic world generation. */

/** Seeded PRNG (mulberry32) — returns a function that yields [0, 1) on each call. */
export function seededRng(seed: number) {
  return () => {
    seed |= 0; seed = seed + 0x6D2B79F5 | 0;
    let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/** 2D value noise with smooth (Hermite) interpolation. */
export class ValueNoise2D {
  private grid: number[][];
  private size: number;

  constructor(size: number, seed: number) {
    this.size = size;
    const rand = seededRng(seed);
    this.grid = [];
    for (let y = 0; y <= size; y++) {
      this.grid[y] = [];
      for (let x = 0; x <= size; x++) {
        this.grid[y][x] = rand();
      }
    }
  }

  sample(x: number, y: number): number {
    const xi = Math.max(0, Math.min(Math.floor(x), this.size - 1));
    const yi = Math.max(0, Math.min(Math.floor(y), this.size - 1));
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);

    const x1 = Math.min(xi + 1, this.size);
    const y1 = Math.min(yi + 1, this.size);

    const sx = xf * xf * (3 - 2 * xf);
    const sy = yf * yf * (3 - 2 * yf);

    const top = this.grid[yi][xi] * (1 - sx) + this.grid[yi][x1] * sx;
    const bot = this.grid[y1][xi] * (1 - sx) + this.grid[y1][x1] * sx;
    return top * (1 - sy) + bot * sy;
  }
}
