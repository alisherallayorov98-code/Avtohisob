/**
 * EkoHisob — oy bilan ishlash yordamchilari. Oy formati: "YYYY-MM".
 * Tizim asosan oylar bilan hisoblaydi (qaysi tashkilot qaysi oy uchun to'ladi).
 *
 * Hammasi O'zbekiston vaqti (UTC+5) bo'yicha — server mintaqasiga bog'liq emas (lib/uzt.ts).
 */
import { currentMonthUz, isValidMonth as isValidMonthStrict, shiftMonth } from './uzt'

export function getCurrentMonth(now: Date = new Date()): string {
  return currentMonthUz(now)
}

/** "YYYY-MM" va oy 01..12 (ilgari "2026-13" ham o'tib ketardi). */
export function isValidMonth(m: string): boolean {
  return isValidMonthStrict(m)
}

/** Oyni n oyga siljitadi (n manfiy bo'lishi mumkin). Date ishlatilmaydi — mintaqaga bog'liq emas. */
export function addMonths(month: string, n: number): string {
  return shiftMonth(month, n)
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
