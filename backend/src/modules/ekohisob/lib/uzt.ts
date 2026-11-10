/**
 * EkoHisob — O'zbekiston vaqti (UTC+5, yoz/qish vaqti YO'Q) yagona yadrosi.
 *
 * Nega alohida modul: server qaysi vaqt mintaqasida ishlashidan qat'i nazar
 * "bugun", "joriy oy" va oy chegarasi bir xil bo'lishi shart. Aks holda UZT
 * 00:00–05:00 oralig'ida (UTC bo'yicha hali kechagi kun) to'lov oldingi oyga,
 * talon kechagi sanaga yoziladi. Hamma joyda `new Date().getMonth()`,
 * `toISOString().slice(0,10)` o'rniga SHU funksiyalar ishlatiladi.
 *
 * Hammasi PURE (hozirgi vaqt argument sifatida beriladi) — testlanadi.
 */

export const UZT_OFFSET_MS = 5 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const p2 = (n: number) => String(n).padStart(2, '0')

export interface UztParts {
  year: number
  month: number // 1-12
  day: number // 1-31
  hour: number
  minute: number
  second: number
}

/** Oniy (UTC instant) → O'zbekiston devor soati bo'laklari. Noto'g'ri sana → null. */
export function uztParts(d: Date | string | number): UztParts | null {
  const t = d instanceof Date ? d.getTime() : new Date(d).getTime()
  if (!Number.isFinite(t)) return null
  const u = new Date(t + UZT_OFFSET_MS)
  return {
    year: u.getUTCFullYear(),
    month: u.getUTCMonth() + 1,
    day: u.getUTCDate(),
    hour: u.getUTCHours(),
    minute: u.getUTCMinutes(),
    second: u.getUTCSeconds(),
  }
}

/** UZT bo'yicha bugungi sana "YYYY-MM-DD". */
export function todayUz(now: Date = new Date()): string {
  const p = uztParts(now)!
  return `${p.year}-${p2(p.month)}-${p2(p.day)}`
}

/** UZT bo'yicha joriy oy "YYYY-MM". */
export function currentMonthUz(now: Date = new Date()): string {
  const p = uztParts(now)!
  return `${p.year}-${p2(p.month)}`
}

/** UZT bo'yicha yil (kvitansiya raqami uchun — yangi yil chegarasi to'g'ri). */
export function currentYearUz(now: Date = new Date()): number {
  return uztParts(now)!.year
}

/** Oniy → UZT bo'yicha oy "YYYY-MM". Noto'g'ri sana → null. */
export function monthOfUz(d: Date | string | number): string | null {
  const p = uztParts(d)
  return p ? `${p.year}-${p2(p.month)}` : null
}

/** Oniy → UZT bo'yicha sana "YYYY-MM-DD". Noto'g'ri sana → null. */
export function dayOfUz(d: Date | string | number): string | null {
  const p = uztParts(d)
  return p ? `${p.year}-${p2(p.month)}-${p2(p.day)}` : null
}

/** "YYYY-MM": oy 01..12 oralig'ida (regex yetarli emas: "2026-13" o'tib ketardi). */
export function isValidMonth(m: unknown): m is string {
  if (typeof m !== 'string') return false
  const x = /^(\d{4})-(\d{2})$/.exec(m)
  if (!x) return false
  const mo = Number(x[2])
  return mo >= 1 && mo <= 12 && Number(x[1]) >= 2000 && Number(x[1]) <= 2100
}

/** Oyda nechta kun bor (kabisa yilini hisobga oladi). */
export function daysInMonth(month: string): number {
  if (!isValidMonth(month)) return 0
  const [y, mo] = month.split('-').map(Number)
  return new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/** "YYYY-MM-DD" haqiqiy kalendar sanasimi ("2026-11-31" va "2026-02-30" — yo'q). */
export function isValidIsoDate(s: unknown): s is string {
  if (typeof s !== 'string') return false
  const x = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (!x) return false
  const y = Number(x[1]), mo = Number(x[2]), d = Number(x[3])
  if (mo < 1 || mo > 12 || d < 1) return false
  return d <= new Date(Date.UTC(y, mo, 0)).getUTCDate()
}

/**
 * "YYYY-MM-DD" → `@db.Date` ustuniga yoziladigan Date (UTC yarim tun — kun siljimaydi).
 * Noto'g'ri sana → null (chaqiruvchi 400 qaytaradi, Prisma 500 bermaydi).
 */
export function parseDateOnly(s: unknown): Date | null {
  if (!isValidIsoDate(s)) return null
  return new Date(`${s}T00:00:00.000Z`)
}

/** UZT bo'yicha oyning birinchi onasi (UTC instant) — shu oyga tegishli yozuvlarni filtrlash uchun. */
export function monthStartUz(month: string): Date | null {
  if (!isValidMonth(month)) return null
  const [y, mo] = month.split('-').map(Number)
  return new Date(Date.UTC(y, mo - 1, 1) - UZT_OFFSET_MS)
}

/** UZT bo'yicha oy chegarasi: [start, end) — end KEYINGI oyning boshi (kiritilmaydi). */
export function monthBoundsUz(month: string): { start: Date; end: Date } | null {
  const start = monthStartUz(month)
  if (!start) return null
  const [y, mo] = month.split('-').map(Number)
  const end = new Date(Date.UTC(y, mo, 1) - UZT_OFFSET_MS)
  return { start, end }
}

/** UZT bo'yicha kun chegarasi: [start, end). Noto'g'ri sana → null. */
export function dayBoundsUz(isoDate: string): { start: Date; end: Date } | null {
  if (!isValidIsoDate(isoDate)) return null
  const start = new Date(new Date(`${isoDate}T00:00:00.000Z`).getTime() - UZT_OFFSET_MS)
  return { start, end: new Date(start.getTime() + DAY_MS) }
}

/** Sana oralig'i uchun oxirgi kun (filtr "to=" uchun): oyning haqiqiy oxirgi kuni "YYYY-MM-DD". */
export function lastDayOfMonth(month: string): string | null {
  if (!isValidMonth(month)) return null
  return `${month}-${p2(daysInMonth(month))}`
}

/** "YYYY-MM" ni n oyga siljitadi — Date'siz, sof arifmetika (mahalliy vaqt mintaqasiga bog'liq emas). */
export function shiftMonth(month: string, n: number): string {
  if (!isValidMonth(month)) throw new Error(`Noto'g'ri oy: ${month}`)
  const [y, mo] = month.split('-').map(Number)
  const idx = y * 12 + (mo - 1) + n
  const ny = Math.floor(idx / 12)
  const nm = idx - ny * 12 + 1
  return `${ny}-${p2(nm)}`
}
