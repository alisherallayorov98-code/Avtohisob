// Testlar uchun deterministik tasodifiy son generatori (mulberry32). Faqat *.test.ts import qiladi.
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const randInt = (rnd: () => number, lo: number, hi: number): number =>
  lo + Math.floor(rnd() * (hi - lo + 1))

export const pick = <T>(rnd: () => number, arr: T[]): T => arr[Math.floor(rnd() * arr.length)]
