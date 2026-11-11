// EkoHisob — og'ir hisobotlar uchun qisqa muddatli (TTL) xotira keshi.
//
// XAVFSIZLIK: kalit tenant (orgId), foydalanuvchi, rol va tuman doirasini O'Z ICHIGA OLADI —
// bir korxona/foydalanuvchi boshqasining keshini ko'ra olmaydi (tenant leak bo'lmasin).
// To'lov yozilganda kesh tozalanmaydi — shuning uchun TTL qisqa (60 s).

export interface CacheScope {
  orgId: string
  userId: string
  role: string
  districtIds: string[]
}

export const REPORT_CACHE_TTL_MS = 60_000
const MAX_ENTRIES = 300

/** Kalit: hamma doira komponentlari + so'rov parametrlari (tartiblangan, shuning uchun barqaror). */
export function reportCacheKey(kind: string, scope: CacheScope, params: Record<string, unknown>): string {
  const districts = [...(scope.districtIds ?? [])].sort().join(',')
  const p = Object.keys(params).sort().map(k => `${k}=${String(params[k])}`).join('&')
  return [kind, scope.orgId, scope.userId, scope.role, districts, p].join('|')
}

export class TtlCache<T> {
  private store = new Map<string, { at: number; value: T }>()
  constructor(private ttlMs = REPORT_CACHE_TTL_MS, private max = MAX_ENTRIES) {}

  get(key: string, now = Date.now()): T | undefined {
    const e = this.store.get(key)
    if (!e) return undefined
    if (now - e.at >= this.ttlMs) { this.store.delete(key); return undefined }
    return e.value
  }

  set(key: string, value: T, now = Date.now()): void {
    if (this.store.size >= this.max) {
      // avval muddati o'tganlar, hali ham to'la bo'lsa — eng eskisi
      for (const [k, e] of this.store) if (now - e.at >= this.ttlMs) this.store.delete(k)
      if (this.store.size >= this.max) {
        const oldest = this.store.keys().next().value
        if (oldest !== undefined) this.store.delete(oldest)
      }
    }
    this.store.set(key, { at: now, value })
  }

  get size(): number { return this.store.size }
  clear(): void { this.store.clear() }
  delete(key: string): void { this.store.delete(key) }
}

/** Kesh orqali hisoblaydi (parallel bir xil so'rovlar ham bitta hisobga birlashadi). */
export async function cached<T>(
  cache: TtlCache<Promise<T>>, key: string, compute: () => Promise<T>,
): Promise<T> {
  const hit = cache.get(key)
  if (hit) return hit
  const p = compute()
  cache.set(key, p)
  // Xato keshda qolmasin
  p.catch(() => { cache.delete(key) })
  return p
}
