// To'lov xatti-harakati tahlili — sof mantiq (DB'siz, testlanadi).
//
// Maqsad: "to'lashni TO'XTATGAN" mijozni "doim qarzdor" mijozdan ajratish.
// Bu ikkisi butunlay boshqa hodisa:
//  - doimiy qarzdor — hech qachon yaxshi to'lamagan, uni undirish qiyin;
//  - to'xtatgan mijoz — oldin muntazam to'lagan, keyin to'xtagan. Sabab bor
//    (biznes yopildi, xizmatdan norozi, boshqa firmaga o'tdi). Erta aniqlansa
//    qaytarish ancha oson.
// Hozirgi qarzdorlar ro'yxatida ikkinchisi birinchisining orasida yo'qoladi.

export interface BehaviorInput {
  /** Tekshiriladigan oylar, o'sish tartibida ("YYYY-MM") */
  months: string[]
  /** Shu tashkilot to'lov qilgan oylar (to'plam) */
  paidMonths: Set<string>
  /** Muntazam deb hisoblash uchun minimal to'langan oy soni */
  minHistory?: number
  /** To'xtagan deb hisoblash uchun minimal uzilish (oy) */
  minGap?: number
}

export interface BehaviorResult {
  /** Muntazam to'lagan, keyin to'xtagan */
  stopped: boolean
  /** Oxirgi to'langan oy ("YYYY-MM") yoki null */
  lastPaidMonth: string | null
  /** Oxirgi to'lovdan keyin necha oy to'lov yo'q */
  gapMonths: number
  /** Uzilishgacha necha oy to'langan */
  paidBeforeGap: number
  /** To'lov muntazamligi: to'langan oylar / tekshirilgan oylar (0–100) */
  regularity: number
}

const DEFAULT_MIN_HISTORY = 3
const DEFAULT_MIN_GAP = 2

/**
 * Mijoz to'lashni to'xtatganini aniqlaydi.
 *
 * Shartlar (hammasi bajarilishi kerak):
 *  1. Oxirgi `minGap` oyda umuman to'lov yo'q;
 *  2. Undan oldin kamida `minHistory` oy to'lagan;
 *  3. Umuman to'lov qilmagan mijoz bu ro'yxatga TUSHMAYDI — u "to'xtatgan"
 *     emas, "hech qachon boshlamagan". Uni oddiy qarzdorlar ro'yxati qamraydi.
 */
export function detectStoppedPaying(input: BehaviorInput): BehaviorResult {
  const { months, paidMonths } = input
  const minHistory = input.minHistory ?? DEFAULT_MIN_HISTORY
  const minGap = input.minGap ?? DEFAULT_MIN_GAP

  const paidCount = months.filter(m => paidMonths.has(m)).length
  const regularity = months.length > 0 ? Math.round(paidCount * 100 / months.length) : 0

  // Oxirgi to'langan oyni topamiz (oxiridan boshiga)
  let lastPaidIndex = -1
  for (let i = months.length - 1; i >= 0; i--) {
    if (paidMonths.has(months[i])) { lastPaidIndex = i; break }
  }

  if (lastPaidIndex < 0) {
    // Hech qachon to'lamagan — "to'xtatgan" emas
    return { stopped: false, lastPaidMonth: null, gapMonths: months.length, paidBeforeGap: 0, regularity }
  }

  const gapMonths = months.length - 1 - lastPaidIndex
  // Uzilishgacha bo'lgan davrda nechta oy to'langan
  const paidBeforeGap = months.slice(0, lastPaidIndex + 1).filter(m => paidMonths.has(m)).length

  return {
    stopped: gapMonths >= minGap && paidBeforeGap >= minHistory,
    lastPaidMonth: months[lastPaidIndex],
    gapMonths,
    paidBeforeGap,
    regularity,
  }
}

export interface StoppedCandidate {
  entityId: string
  months: string[]
  paidMonths: Set<string>
  /** Tarixiy o'rtacha oylik to'lov — yo'qotilayotgan qiymatni baholash uchun */
  avgPayment: number
}

export interface StoppedRow extends BehaviorResult {
  entityId: string
  avgPayment: number
  /** Uzilish davrida yo'qotilgan taxminiy summa (o'rtacha × uzilish oylari) */
  estimatedLoss: number
}

/**
 * Bir nechta tashkilotni tekshiradi va to'xtatganlarini qaytaradi.
 * Tartib: yo'qotilgan summa bo'yicha (eng qimmatlisi birinchi) — rahbar
 * cheklangan vaqtini eng qimmat mijozlarga sarflashi uchun.
 */
export function findStoppedPaying(
  candidates: StoppedCandidate[],
  opts: { minHistory?: number; minGap?: number } = {},
): StoppedRow[] {
  const out: StoppedRow[] = []
  for (const c of candidates) {
    const r = detectStoppedPaying({
      months: c.months, paidMonths: c.paidMonths,
      minHistory: opts.minHistory, minGap: opts.minGap,
    })
    if (!r.stopped) continue
    out.push({
      ...r,
      entityId: c.entityId,
      avgPayment: Math.round(c.avgPayment),
      estimatedLoss: Math.round(c.avgPayment * r.gapMonths),
    })
  }
  return out.sort((a, b) => b.estimatedLoss - a.estimatedLoss)
}
