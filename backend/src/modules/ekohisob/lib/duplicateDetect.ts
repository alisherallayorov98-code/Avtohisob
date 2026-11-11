// Takroriy tashkilot aniqlash — sof mantiq (DB'siz, testlanadi).
//
// Nega muhim: bitta tashkilot ikki marta kiritilsa (masalan ikki inspektor
// bir-biridan bexabar, yoki import + qo'lda kiritish), unga HAR OY IKKI MARTA
// hisob yoziladi — mijoz ikki marta qarzdor ko'rinadi, SMS ikki marta boradi,
// akt sverkada janjal chiqadi. Bu ma'lumot sog'ligining eng qimmat turdagi
// buzilishi, chunki u jimgina pul hisobini buzadi.
//
// Aniqlash ikki belgida:
//  1. STIR bir xil — deyarli aniq takror (STIR yagona soliq raqami);
//  2. normallashtirilgan nom bir xil — ehtimoliy takror (imlo/shakl farqi:
//     `"Oq Yo'l" MChJ` va `OQ YOL mchj` bitta tashkilot).

import { cyrToLatin } from './translit'

export interface DupEntity {
  id: string
  name: string
  stir?: string | null
  /** Tuman — bir xil nom turli tumanda takror hisoblanmasligi uchun. Berilmasa tuman hisobga olinmaydi. */
  districtId?: string | null
}

export type DupReason = 'stir' | 'name'

export interface DupGroup {
  /** Nima bo'yicha guruhlandi */
  reason: DupReason
  /** Guruh kaliti (STIR yoki normallashtirilgan nom) */
  key: string
  ids: string[]
  /**
   * Ishonch darajasi: 'high' — STIR bir xil; 'medium' — bir tumanda nom mos;
   * 'low' — turli tumanlarda nom mos (faqat includeCrossDistrict bilan, ogohlantirish).
   */
  level: 'high' | 'medium' | 'low'
}

/** Huquqiy shakl so'zlari — nomni solishtirshda ma'no tashimaydi */
const LEGAL_FORMS = new Set([
  'mchj', 'ooo', 'xk', 'ochj', 'aj', 'oaj', 'yoaj', 'yatt', 'xt', 'mj',
  'llc', 'ltd', 'ip', 'fx',
])

/**
 * Nomni solishtirish kalitiga keltiradi:
 * kirill→lotin, kichik harf, apostrof/qo'shtirnoq/tinish belgilarisiz, huquqiy shaklsiz.
 * `"Oq Yo'l" MChJ`, `OQ YOL mchj` va `«Оқ йўл» МЧЖ` → "oq yol".
 * "Savdo", "Markazi" kabi mazmunli so'zlar OLIB TASHLANMAYDI ("Bahor savdo markazi" ≠ "Bahor").
 */
export function normalizeEntityName(name: string): string {
  const words = cyrToLatin(String(name ?? ''))
    .replace(/[ʻʼ'`’‘]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !LEGAL_FORMS.has(w))
  return words.join(' ')
}

/**
 * Yagona taqqoslash kaliti (similarEntities ham shuni ishlatadi): normalizeEntityName +
 * h/x, w/v va qo'sh harf farqlari tenglashtiriladi (eshitib yozishda eng ko'p uchraydi).
 */
export function nameKey(name: string): string {
  return normalizeEntityName(name)
    .replace(/h/g, 'x')
    .replace(/w/g, 'v')
    .replace(/(.)\1+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Takror guruhlarini topadi.
 *
 * STIR guruhlari birinchi (ishonchliroq belgi). Nom guruhlari faqat STIR
 * guruhini AYNAN takrorlamasa qo'shiladi — bitta juftlik ikki marta
 * ko'rsatilib foydalanuvchini chalg'itmasin.
 */
export function findDuplicateGroups(
  entities: DupEntity[],
  opts: { includeCrossDistrict?: boolean } = {},
): DupGroup[] {
  const groups: DupGroup[] = []

  // 1) STIR bo'yicha
  const byStir = new Map<string, string[]>()
  for (const e of entities) {
    const stir = String(e.stir ?? '').replace(/\D/g, '')
    if (stir.length < 9) continue   // qisqa/yo'q STIR guruhlamaydi
    const list = byStir.get(stir) ?? []
    list.push(e.id)
    byStir.set(stir, list)
  }
  const reportedSets = new Set<string>()
  for (const [stir, ids] of byStir) {
    if (ids.length < 2) continue
    groups.push({ reason: 'stir', key: stir, ids: [...ids].sort(), level: 'high' })
    reportedSets.add([...ids].sort().join('|'))
  }

  // 2) Normallashtirilgan nom bo'yicha — BIR TUMAN ichida (tuman berilmagan bo'lsa bitta chelak)
  const byName = new Map<string, string[]>()
  const byNameAll = new Map<string, { ids: string[]; districts: Set<string> }>()
  for (const e of entities) {
    const key = nameKey(e.name)
    if (key.length < 3) continue    // juda qisqa kalit ("aa") tasodifga to'la
    const bucket = `${key}|${e.districtId ?? ''}`
    const list = byName.get(bucket) ?? []
    list.push(e.id)
    byName.set(bucket, list)
    const all = byNameAll.get(key) ?? { ids: [], districts: new Set<string>() }
    all.ids.push(e.id)
    all.districts.add(e.districtId ?? '')
    byNameAll.set(key, all)
  }
  const sameDistrictSets = new Set<string>()
  for (const [bucket, ids] of byName) {
    if (ids.length < 2) continue
    const key = bucket.slice(0, bucket.lastIndexOf('|'))
    const sorted = [...ids].sort()
    sameDistrictSets.add(sorted.join('|'))
    if (reportedSets.has(sorted.join('|'))) continue   // STIR guruhi bilan aynan bir xil
    groups.push({ reason: 'name', key, ids: sorted, level: 'medium' })
  }

  // 3) Turli tumanlarda bir xil nom — takror EMAS, faqat ogohlantirish (so'ralganda)
  if (opts.includeCrossDistrict) {
    for (const [key, all] of byNameAll) {
      if (all.ids.length < 2 || all.districts.size < 2) continue
      const sorted = [...all.ids].sort()
      if (reportedSets.has(sorted.join('|')) || sameDistrictSets.has(sorted.join('|'))) continue
      groups.push({ reason: 'name', key, ids: sorted, level: 'low' })
    }
  }

  // STIR guruhlari birinchi — ular ishonchliroq
  const rank = { high: 0, medium: 1, low: 2 } as const
  return groups.sort((a, b) =>
    a.level === b.level ? b.ids.length - a.ids.length : rank[a.level] - rank[b.level])
}
