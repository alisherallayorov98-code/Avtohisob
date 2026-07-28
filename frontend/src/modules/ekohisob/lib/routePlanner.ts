// Marshrut rejasi — sof geometrik mantiq (React'siz).
//
// Inspektor xaritada bir nechta tashkilotni tanlaydi, tizim yurish tartibini
// tuzib beradi va tayyor marshrutni Yandex/Google navigatorga uzatadi.
// Marshrut ATAYLAB saqlanmaydi (sessiya ichida yashaydi) — foydalanuvchi
// tanlovi: marshrut odatda bir martalik, jadval/migratsiya ortiqcha.
//
// Eslatma: bu pul mantiqi emas, shuning uchun backend lib'ida emas — u yerda
// jest bor, lekin frontend bu koddan bevosita foydalanadi va ikki nusxa
// vaqt o'tib bir-biridan uzoqlashardi.

export interface RoutePoint {
  id: string
  name: string
  lat: number
  lng: number
  debtAmount?: number
}

export interface LatLng { lat: number; lng: number }

/** Haversine masofa, km. */
export function distKm(a: LatLng, b: LatLng): number {
  const R = 6371
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLng = ((b.lng - a.lng) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

/**
 * Eng yaqin qo'shni tartibi (nearest-neighbour).
 *
 * Optimal TSP emas — 5–15 nuqtali kunlik marshrut uchun bu yetarli va bir
 * zumda hisoblanadi. `start` berilsa (inspektorning GPS joylashuvi) yurish
 * o'sha yerdan boshlanadi; berilmasa birinchi tanlangan nuqtadan.
 */
export function orderNearest(points: RoutePoint[], start?: LatLng | null): RoutePoint[] {
  if (points.length <= 1) return [...points]
  const remaining = [...points]
  const ordered: RoutePoint[] = []
  let cursor: LatLng
  if (start) {
    cursor = start
  } else {
    ordered.push(remaining.shift()!)
    cursor = ordered[0]
  }
  while (remaining.length > 0) {
    let bestIdx = 0
    let bestD = Infinity
    for (let i = 0; i < remaining.length; i++) {
      const d = distKm(cursor, remaining[i])
      if (d < bestD) { bestD = d; bestIdx = i }
    }
    const next = remaining.splice(bestIdx, 1)[0]
    ordered.push(next)
    cursor = next
  }
  return ordered
}

/** Qarz og'irligi bo'yicha tartib — eng katta qarzdor birinchi. */
export function orderByDebt(points: RoutePoint[]): RoutePoint[] {
  return [...points].sort((a, b) => (b.debtAmount ?? 0) - (a.debtAmount ?? 0))
}

/** Tartiblangan marshrutning umumiy uzunligi (start → 1 → 2 → ...), km. */
export function totalKm(ordered: RoutePoint[], start?: LatLng | null): number {
  let sum = 0
  let prev: LatLng | null = start ?? null
  for (const p of ordered) {
    if (prev) sum += distKm(prev, p)
    prev = p
  }
  return sum
}

/**
 * Taxminiy vaqt (daqiqa): shahar yurishi ~22 km/soat + har to'xtashda
 * ~8 daqiqa (to'lov qabul qilish, gaplashish). Bu mo'ljal, va'da emas.
 */
export function estimateMinutes(km: number, stops: number): number {
  return Math.round((km / 22) * 60 + stops * 8)
}

/**
 * Yandex Navigator/Maps ko'p nuqtali marshrut havolasi.
 * rtext=lat,lng~lat,lng~... — O'zbekistonda Yandex eng ko'p ishlatiladi.
 */
export function yandexRouteUrl(ordered: RoutePoint[], start?: LatLng | null): string {
  const pts: LatLng[] = [...(start ? [start] : []), ...ordered]
  const rtext = pts.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('~')
  return `https://yandex.com/maps/?rtext=${rtext}&rtt=auto`
}

/** Google Maps yo'nalish havolasi (path shakli — ko'p nuqtani qabul qiladi). */
export function googleRouteUrl(ordered: RoutePoint[], start?: LatLng | null): string {
  const pts: LatLng[] = [...(start ? [start] : []), ...ordered]
  const path = pts.map(p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`).join('/')
  return `https://www.google.com/maps/dir/${path}`
}
