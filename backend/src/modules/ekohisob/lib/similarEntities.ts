// O'xshash (ehtimoliy takror) tashkilotlarni topish — pure.
//
// Nega: STIR bo'lmagan tashkilotlar (jismoniy shaxslar) uchun takrorni STIR ushlay olmaydi.
// Telefon, joylashuv va nom qoladi. Kirillcha yozilgan "Нур" va lotincha "Nur" bitta nom.
// Natija FAQAT ogohlantirish — bloklamaydi (bir telefonda ikkita haqiqiy tashkilot bo'lishi mumkin).

import { nameKey } from './duplicateDetect'
import { cyrToLatin } from './translit'

export { cyrToLatin, nameKey }

/** Levenshtein masofasi bo'yicha o'xshashlik 0..1. */
export function similarity(a: string, b: string): number {
  if (a === b) return a ? 1 : 0
  if (!a || !b) return 0
  const m = a.length, n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

/** Telefon: oxirgi 9 raqam (998 prefiksi va formatlash farqi hisobga olinmaydi). */
export function phoneKey(phone: string | null | undefined): string {
  const d = String(phone ?? '').replace(/\D/g, '')
  return d.length >= 9 ? d.slice(-9) : ''
}

export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const rad = (d: number) => (d * Math.PI) / 180
  const dLat = rad(lat2 - lat1), dLon = rad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(a))
}

export interface SimilarCandidate {
  name?: string | null
  phone?: string | null
  lat?: number | null
  lon?: number | null
  districtId?: string | null
}

export interface SimilarEntity {
  id: string
  name: string
  phone?: string | null
  lat?: number | null
  lon?: number | null
  districtId?: string | null
  status?: string | null
}

export type SimilarReason = 'phone' | 'nearby' | 'name'

export interface SimilarMatch {
  id: string
  name: string
  status?: string | null
  reasons: SimilarReason[]
  /** Saralash uchun: yuqori — ishonchliroq */
  score: number
  distanceM?: number
}

/** Yaqinlik chegarasi (metr) — bir bino/hovli */
export const NEAR_METERS = 40
const NAME_SIMILAR = 0.8

/**
 * Nomzodga o'xshash tashkilotlar. Belgilar:
 *  - phone  : telefon bir xil (kuchli);
 *  - nearby : ≤40 m ichida VA nomi o'xshash (≥80%) (kuchli);
 *  - name   : bir tumanda nom kaliti aynan bir xil (o'rtacha).
 * Faqat joylashuv yaqin, lekin nomi boshqa bo'lsa — takror emas (qo'shni do'konlar).
 */
export function findSimilar(candidate: SimilarCandidate, existing: SimilarEntity[]): SimilarMatch[] {
  const myName = nameKey(candidate.name ?? '')
  const myPhone = phoneKey(candidate.phone)
  const hasGeo = candidate.lat != null && candidate.lon != null
  const out: SimilarMatch[] = []

  for (const e of existing) {
    const reasons: SimilarReason[] = []
    let score = 0
    let distanceM: number | undefined

    if (myPhone && phoneKey(e.phone) === myPhone) { reasons.push('phone'); score += 3 }

    const eName = nameKey(e.name)
    const nameSim = myName && eName ? similarity(myName, eName) : 0

    if (hasGeo && e.lat != null && e.lon != null) {
      const d = distanceMeters(candidate.lat as number, candidate.lon as number, e.lat, e.lon)
      if (d <= NEAR_METERS && nameSim >= NAME_SIMILAR) { reasons.push('nearby'); score += 2 + nameSim; distanceM = Math.round(d) }
    }

    if (
      !reasons.includes('nearby') && myName && eName === myName &&
      candidate.districtId && e.districtId === candidate.districtId
    ) { reasons.push('name'); score += 1 }

    if (reasons.length) out.push({ id: e.id, name: e.name, status: e.status, reasons, score, distanceM })
  }

  return out.sort((a, b) => b.score - a.score).slice(0, 5)
}
