/** Mini ilova uchun mayda yordamchilar: UZT sanalar, keshlash, masofa. */

const UZT_OFFSET_MS = 5 * 3600 * 1000

/** Bugungi sana O'zbekiston vaqti bilan, 'YYYY-MM-DD'. */
export function todayUzIso(): string {
  return new Date(Date.now() + UZT_OFFSET_MS).toISOString().slice(0, 10)
}

/** 'YYYY-MM-DD' + n kun. */
export function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** Joriy oy (UZT), 'YYYY-MM'. */
export function currentMonthUz(): string {
  return todayUzIso().slice(0, 7)
}

// ── Masofa ───────────────────────────────────────────────────────────────────

export interface LatLon { lat: number; lon: number }

/** Haversine, metrda. */
export function haversineM(a: LatLon, b: LatLon): number {
  const R = 6371000
  const rad = (x: number) => (x * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLon = rad(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** 120 → "120 m", 1450 → "1.5 km". */
export function formatDistance(m: number): string {
  if (m < 1000) return `${Math.max(10, Math.round(m / 10) * 10)} m`
  return `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`
}

// ── Joylashuv ────────────────────────────────────────────────────────────────

export interface GeoFix extends LatLon { accuracy: number; at: number }

let lastFix: GeoFix | null = null

/** Oxirgi ma'lum joylashuv (maxAgeMs dan eskirmagan bo'lsa). */
export function getLastFix(maxAgeMs = 10 * 60 * 1000): GeoFix | null {
  return lastFix && Date.now() - lastFix.at <= maxAgeMs ? lastFix : null
}

export type GeoFailure = 'unsupported' | 'denied' | 'unavailable' | 'timeout'

export class GeoError extends Error {
  constructor(public kind: GeoFailure) { super(kind) }
}

export function geoErrorText(e: unknown): string {
  const k = e instanceof GeoError ? e.kind : 'unavailable'
  if (k === 'unsupported') return "Qurilmada GPS yo'q"
  if (k === 'denied') return 'GPS ruxsati berilmagan. Telegram sozlamalarida joylashuvga ruxsat bering.'
  if (k === 'timeout') return "GPS signali topilmadi. Ochiq joyda qayta urinib ko'ring."
  return "Joylashuvni aniqlab bo'lmadi"
}

/** Aniq joylashuv (enableHighAccuracy, 15s). Muvaffaqiyatda `getLastFix` yangilanadi. */
export function requestFix(opts: { maximumAge?: number; timeout?: number } = {}): Promise<GeoFix> {
  return new Promise((resolve, reject) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) { reject(new GeoError('unsupported')); return }
    navigator.geolocation.getCurrentPosition(
      pos => {
        lastFix = { lat: pos.coords.latitude, lon: pos.coords.longitude, accuracy: pos.coords.accuracy, at: Date.now() }
        resolve(lastFix)
      },
      err => reject(new GeoError(err.code === 1 ? 'denied' : err.code === 3 ? 'timeout' : 'unavailable')),
      { enableHighAccuracy: true, timeout: opts.timeout ?? 15000, maximumAge: opts.maximumAge ?? 0 },
    )
  })
}

/** Ruxsat holati so'rovsiz aniqlanadi (Permissions API bo'lmasa 'unknown'). */
export async function geoPermission(): Promise<'granted' | 'denied' | 'prompt' | 'unknown'> {
  try {
    const p = await navigator.permissions?.query({ name: 'geolocation' as PermissionName })
    return p ? (p.state as 'granted' | 'denied' | 'prompt') : 'unknown'
  } catch {
    // Ba'zi WebView'larda Permissions API yo'q — xato emas, shunchaki noma'lum
    return 'unknown'
  }
}

// ── sessionStorage kesh (oflayn / signal yo'qolganda) ────────────────────────

const PREFIX = 'eko-tg:'

export function cacheRead<T>(key: string): { data: T; t: number } | null {
  try {
    const raw = sessionStorage.getItem(PREFIX + key)
    return raw ? (JSON.parse(raw) as { data: T; t: number }) : null
  } catch {
    // sessionStorage yo'q/buzilgan — kesh ixtiyoriy, ilova kesh'siz ishlayveradi
    return null
  }
}

export function cacheWrite(key: string, data: unknown): number {
  const t = Date.now()
  try {
    sessionStorage.setItem(PREFIX + key, JSON.stringify({ data, t }))
  } catch {
    // Kvota to'lgan bo'lishi mumkin — kesh yozilmasa ham ro'yxat ekranda turadi
  }
  return t
}

export function prefGet(key: string): string | null {
  try { return sessionStorage.getItem(PREFIX + 'pref:' + key) } catch { return null }
}
export function prefSet(key: string, v: string) {
  try { sessionStorage.setItem(PREFIX + 'pref:' + key, v) } catch { /* ixtiyoriy */ }
}

// ── Oxirgi muvaffaqiyatli sinxronlash vaqti (TgApp oflayn chizig'i uchun) ──

let lastSync = 0
const syncListeners = new Set<() => void>()

export function markSynced(t = Date.now()) {
  if (t <= lastSync) return
  lastSync = t
  syncListeners.forEach(fn => fn())
}
export function getLastSync(): number { return lastSync }
export function subscribeSync(fn: () => void): () => void {
  syncListeners.add(fn)
  return () => { syncListeners.delete(fn) }
}
