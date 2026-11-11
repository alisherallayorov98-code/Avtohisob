// EkoHisob — kvitansiya raqami va tekshiruv tokeni (pure + tranzaksiyaga bog'langan helper).

import { randomBytes } from 'crypto'
import { currentYearUz } from './uzt'

export function formatReceiptNumber(year: number, n: number): string {
  return `EKO-${year}-${String(Math.max(1, Math.trunc(n))).padStart(5, '0')}`
}

export function parseReceiptNumber(s: unknown): { year: number; num: number } | null {
  const m = /^EKO-(\d{4})-(\d{1,8})$/.exec(String(s ?? '').trim().toUpperCase())
  return m ? { year: Number(m[1]), num: Number(m[2]) } : null
}

/** Ochiq tekshiruv tokeni: 18 tasodifiy bayt (crypto) → 24 belgi base64url (144 bit). */
export function generateVerifyToken(): string {
  return randomBytes(18).toString('base64url')
}

export function isValidVerifyToken(t: unknown): t is string {
  return typeof t === 'string' && /^[A-Za-z0-9_-]{16,64}$/.test(t)
}

/**
 * Keyingi raqamni TRANZAKSIYA ichida oladi (`tx` — Prisma tranzaksiya klienti).
 * Tranzaksiya bekor qilinsa raqam ham qaytadi → raqamlarda teshik bo'lmaydi.
 * Qator qulfi tranzaksiya oxirigacha ushlanadi, shuning uchun chaqiruvchi buni
 * tranzaksiyaning ENG OXIRIDA chaqirishi kerak. Yil — O'zbekiston vaqti bo'yicha.
 */
export async function nextReceiptNumberTx(tx: any, orgId: string, now: Date = new Date()): Promise<string> {
  const year = currentYearUz(now)
  const rows: any[] = await tx.$queryRawUnsafe(`
    INSERT INTO ekohisob_receipt_seq ("orgId", year, "lastNum")
    VALUES ($1, $2, 1)
    ON CONFLICT ("orgId") DO UPDATE
    SET "lastNum" = CASE
      WHEN ekohisob_receipt_seq.year = $2 THEN ekohisob_receipt_seq."lastNum" + 1
      ELSE 1
    END,
    year = $2
    RETURNING "lastNum"
  `, orgId, year)
  const num = Number(rows[0]?.lastNum ?? rows[0]?.lastnum ?? 1)
  return formatReceiptNumber(year, num)
}
