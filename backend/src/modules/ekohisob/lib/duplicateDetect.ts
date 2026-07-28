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

export interface DupEntity {
  id: string
  name: string
  stir?: string | null
}

export type DupReason = 'stir' | 'name'

export interface DupGroup {
  /** Nima bo'yicha guruhlandi */
  reason: DupReason
  /** Guruh kaliti (STIR yoki normallashtirilgan nom) */
  key: string
  ids: string[]
}

/** Huquqiy shakl so'zlari — nomni solishtirshda ma'no tashimaydi */
const LEGAL_FORMS = new Set([
  'mchj', 'ooo', 'xk', 'ochj', 'aj', 'oaj', 'yoaj', 'yatt', 'xt', 'mj',
  'llc', 'ltd', 'savdo', 'markazi',
])

/**
 * Nomni solishtirish kalitiga keltiradi:
 * kichik harf, apostrof/qo'shtirnoq/tinish belgilarisiz, huquqiy shaklsiz.
 * `"Oq Yo'l" MChJ` ham, `OQ YOL mchj` ham → "oq yol".
 */
export function normalizeEntityName(name: string): string {
  const words = String(name ?? '')
    .toLowerCase()
    .replace(/[ʻʼ'`’‘]/g, '')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length > 0 && !LEGAL_FORMS.has(w))
  return words.join(' ')
}

/**
 * Takror guruhlarini topadi.
 *
 * STIR guruhlari birinchi (ishonchliroq belgi). Nom guruhlari faqat STIR
 * guruhini AYNAN takrorlamasa qo'shiladi — bitta juftlik ikki marta
 * ko'rsatilib foydalanuvchini chalg'itmasin.
 */
export function findDuplicateGroups(entities: DupEntity[]): DupGroup[] {
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
    groups.push({ reason: 'stir', key: stir, ids: [...ids].sort() })
    reportedSets.add([...ids].sort().join('|'))
  }

  // 2) Normallashtirilgan nom bo'yicha
  const byName = new Map<string, string[]>()
  for (const e of entities) {
    const key = normalizeEntityName(e.name)
    if (key.length < 3) continue    // juda qisqa kalit ("aa") tasodifga to'la
    const list = byName.get(key) ?? []
    list.push(e.id)
    byName.set(key, list)
  }
  for (const [key, ids] of byName) {
    if (ids.length < 2) continue
    const sorted = [...ids].sort()
    if (reportedSets.has(sorted.join('|'))) continue   // STIR guruhi bilan aynan bir xil
    groups.push({ reason: 'name', key, ids: sorted })
  }

  // STIR guruhlari birinchi — ular ishonchliroq
  return groups.sort((a, b) =>
    a.reason === b.reason ? b.ids.length - a.ids.length : a.reason === 'stir' ? -1 : 1)
}
