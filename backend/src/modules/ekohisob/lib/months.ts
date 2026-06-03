/**
 * EkoHisob — oy bilan ishlash yordamchilari. Oy formati: "YYYY-MM".
 * Tizim asosan oylar bilan hisoblaydi (qaysi tashkilot qaysi oy uchun to'ladi).
 */

export function getCurrentMonth(): string {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

export function isValidMonth(m: string): boolean {
  return /^\d{4}-\d{2}$/.test(m)
}

/** "YYYY-MM" → {year, month(1-12)} */
function parse(m: string): { y: number; mo: number } {
  const [y, mo] = m.split('-').map(Number)
  return { y, mo }
}

/** Oyni n oyga siljitadi (n manfiy bo'lishi mumkin). */
export function addMonths(month: string, n: number): string {
  const { y, mo } = parse(month)
  const d = new Date(y, mo - 1 + n, 1)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * start dan end gacha (ikkalasi ham kiritilgan) oylar ro'yxati, o'sish tartibida.
 * start > end bo'lsa bo'sh massiv.
 */
export function monthsBetween(start: string, end: string): string[] {
  if (!isValidMonth(start) || !isValidMonth(end)) return []
  const result: string[] = []
  let cur = start
  let guard = 0
  while (cur <= end && guard < 600) {
    result.push(cur)
    cur = addMonths(cur, 1)
    guard++
  }
  return result
}

/** Eng so'nggi N oy (joriy oydan orqaga), o'sish tartibida. */
export function lastNMonths(n: number, end: string = getCurrentMonth()): string[] {
  const start = addMonths(end, -(n - 1))
  return monthsBetween(start, end)
}
