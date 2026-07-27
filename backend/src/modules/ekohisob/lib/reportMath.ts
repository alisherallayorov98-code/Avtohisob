// EkoHisob hisobot ko'rsatkichlari — sof mantiq (DB'siz, testlanadi).
//
// Bu yerdagi funksiyalar kichik, lekin ular noto'g'ri bo'lsa rahbar noto'g'ri
// qaror qabul qiladi: "yig'im foizi past" deb inspektorni ayblash yoki
// aksincha "hammasi joyida" deb qarzni o'tkazib yuborish.

/**
 * To'lov foizi.
 *
 * MUHIM: maxraj — shu oyda to'lash MAJBURIYATI bo'lgan tashkilotlar soni,
 * barcha faol tashkilotlar emas. Ilgari maxrajda talon (shu oyda ish
 * bo'lmagan) va o'zgaruvchan (oldindan hisoblanadigan summasi yo'q)
 * tashkilotlar ham turardi — ular hech narsa to'lamasligi kerak bo'lsa ham
 * "to'lamagan" deb sanalib, foizni sun'iy pasaytirardi.
 *
 * Majburiyati bo'lgan tashkilot yo'q bo'lsa `null` qaytadi — 0% emas.
 * "0%" degan raqam "hech kim to'lamadi" degan yolg'on xabar beradi.
 */
export function payRate(paid: number, obliged: number): number | null {
  if (!Number.isFinite(obliged) || obliged <= 0) return null
  const rate = (Number(paid) || 0) * 100 / obliged
  return Math.max(0, Math.min(100, Math.round(rate)))
}

/**
 * O'tgan davrga nisbatan o'zgarish foizi.
 *
 * Oldingi qiymat 0 bo'lsa `null` — "cheksiz o'sish" ma'nosiz raqam.
 * Ikkalasi ham 0 bo'lsa ham `null` (o'zgarish yo'q emas — solishtirish mumkin emas).
 */
export function deltaPercent(current: number, previous: number): number | null {
  const prev = Number(previous) || 0
  if (prev === 0) return null
  const cur = Number(current) || 0
  return Math.round(((cur - prev) / prev) * 100)
}

/** Qarz yoshi guruhi — necha oy to'lanmagan. */
export type DebtAgeBucket = 'month1' | 'month2' | 'month3plus'

export const DEBT_AGE_LABEL: Record<DebtAgeBucket, string> = {
  month1: '1 oy',
  month2: '2 oy',
  month3plus: '3+ oy',
}

/** Qarzdor oylar soniga qarab guruh. 0 yoki manfiy → null (qarzdor emas). */
export function debtAgeBucket(months: number): DebtAgeBucket | null {
  const m = Math.floor(Number(months) || 0)
  if (m <= 0) return null
  if (m === 1) return 'month1'
  if (m === 2) return 'month2'
  return 'month3plus'
}

/** Bir kunlik plan: sana ("YYYY-MM-DD") va maqsad. */
export interface PlanDay { date: string; target: number }

export interface PlanSummary {
  /** Plan berilgan kunlar soni */
  daysWithPlan: number
  /** Shu kunlardagi maqsadlar yig'indisi */
  targetTotal: number
  /** Plan berilgan kunlarda haqiqatda kiritilgani */
  doneOnPlanDays: number
  /** Maqsadga yetgan kunlar soni */
  daysMet: number
  /** Bajarilish foizi (doneOnPlanDays / targetTotal). Plan yo'q bo'lsa null. */
  fulfillRate: number | null
}

/**
 * Plan bajarilishini yig'adi.
 *
 * FAQAT plan berilgan kunlar hisobga olinadi. Plan berilmagan kunda inspektor
 * kiritganini "plandan ortiq" deb ko'rsatish adolatsiz taassurot beradi —
 * unga topshiriq berilmagan, o'z tashabbusi bilan ishlagan.
 */
export function summarizePlans(
  plans: PlanDay[],
  createdByDay: Record<string, number>,
): PlanSummary {
  let targetTotal = 0
  let doneOnPlanDays = 0
  let daysMet = 0

  for (const p of plans) {
    const target = Math.max(0, Math.floor(Number(p.target) || 0))
    const done = Math.max(0, Math.floor(Number(createdByDay[p.date]) || 0))
    targetTotal += target
    doneOnPlanDays += done
    if (target > 0 && done >= target) daysMet++
  }

  return {
    daysWithPlan: plans.length,
    targetTotal,
    doneOnPlanDays,
    daysMet,
    fulfillRate: targetTotal > 0 ? Math.round(doneOnPlanDays * 100 / targetTotal) : null,
  }
}

export interface DebtAgeRow {
  bucket: DebtAgeBucket
  label: string
  count: number
  amount: number
}

/**
 * Qarzni yoshi bo'yicha taqsimlaydi.
 *
 * Nega kerak: "142 mln qarz" degan raqam o'zi harakatga chorlamaydi. Uning
 * qanchasi 3+ oylik (deyarli yo'qolgan) va qanchasi 1 oylik (oson qaytariladi)
 * — mana shu farq rahbarning bugungi ishini belgilaydi.
 */
export function groupDebtByAge(
  entities: { debtMonths: number; debtAmount: number }[],
): DebtAgeRow[] {
  const acc: Record<DebtAgeBucket, { count: number; amount: number }> = {
    month1: { count: 0, amount: 0 },
    month2: { count: 0, amount: 0 },
    month3plus: { count: 0, amount: 0 },
  }
  for (const e of entities) {
    const bucket = debtAgeBucket(e.debtMonths)
    if (!bucket) continue
    const amount = Number(e.debtAmount) || 0
    if (amount <= 0) continue
    acc[bucket].count++
    acc[bucket].amount += amount
  }
  return (Object.keys(acc) as DebtAgeBucket[]).map(bucket => ({
    bucket,
    label: DEBT_AGE_LABEL[bucket],
    count: acc[bucket].count,
    amount: acc[bucket].amount,
  }))
}
