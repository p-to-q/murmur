/**
 * Tiny seeded PRNG. Used so an arrangement produced from a given (melody,
 * vibe, seed) is byte-for-byte reproducible — every re-render of the same
 * VibeVersion yields the same bass walk, drum fill, instrument pick, etc.
 *
 * Algorithm: Mulberry32. ~10 lines, indistinguishable from rand() at this
 * scale, zero deps. Seed is a uint32 derived from a string via FNV-1a.
 */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6D2B79F5) | 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 0x811c9dc5; // FNV offset basis
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Legacy djb2-style string hash (may return negative int32).
 *
 * Kept beside the FNV-1a `hashString` because gallery-card gradient /
 * rotation seeds were minted with this function; switching algorithms
 * would silently recolor every existing song's cover. Do not use for new
 * code — prefer `hashString`.
 */
export function hashStringDjb2(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0;
  }
  return hash;
}

/** Pick one element from `arr` using `rng`. */
export function pick<T>(rng: () => number, arr: readonly T[]): T {
  const i = Math.floor(rng() * arr.length);
  return arr[Math.min(i, arr.length - 1)]!;
}
