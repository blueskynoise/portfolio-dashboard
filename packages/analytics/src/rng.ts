/** Deterministic PRNG (mulberry32): the same seed always builds the same company. */
export type Rng = () => number;

export function createRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pick = <T>(rng: Rng, items: readonly T[]): T => items[Math.floor(rng() * items.length)] as T;
export const between = (rng: Rng, min: number, max: number): number => min + Math.floor(rng() * (max - min + 1));

export function weighted<T>(rng: Rng, options: readonly (readonly [T, number])[]): T {
  let roll = rng() * options.reduce((sum, [, weight]) => sum + weight, 0);
  for (const [value, weight] of options) {
    roll -= weight;
    if (roll < 0) return value;
  }
  return (options[options.length - 1] as readonly [T, number])[0];
}

/** Number of events in one period for a given mean rate (Knuth's method; fine for small means). */
export function poisson(rng: Rng, mean: number): number {
  const limit = Math.exp(-mean);
  let count = 0;
  let product = rng();
  while (product > limit) {
    count++;
    product *= rng();
  }
  return count;
}
