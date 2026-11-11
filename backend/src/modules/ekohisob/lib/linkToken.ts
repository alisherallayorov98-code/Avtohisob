// Telegram bot ulash tokeni — PURE qism (DB'siz, testlanadi).
//
// Eski token: 6 hex belgi (24 bit) — bir necha daqiqada terib topiladigan. Yangi: 12 belgi
// 32 harfli alifbodan (60 bit), katta harf (bot token'ni toUpperCase qiladi), 48 soat, bir marta.

import crypto from 'crypto'

/** O'xshash belgilarsiz (0/O, 1/I/L yo'q) 32 harf — 256 % 32 == 0, shuning uchun tarqalish tekis. */
export const LINK_TOKEN_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const LINK_TOKEN_LENGTH = 12
export const LINK_TOKEN_TTL_MS = 48 * 60 * 60 * 1000


export function generateLinkTokenValue(randomBytes: (n: number) => Buffer = crypto.randomBytes): string {
  const alphabet = LINK_TOKEN_ALPHABET
  // Modulo bias'siz: bayt qiymatlari alifbo uzunligiga bo'linadigan diapazonda qabul qilinadi
  const limit = 256 - (256 % alphabet.length)
  let out = ''
  while (out.length < LINK_TOKEN_LENGTH) {
    const buf = randomBytes(LINK_TOKEN_LENGTH * 2)
    for (const b of buf) {
      if (b >= limit) continue
      out += alphabet[b % alphabet.length]
      if (out.length === LINK_TOKEN_LENGTH) break
    }
  }
  return out
}

export function computeLinkExpiry(now: Date = new Date()): Date {
  return new Date(now.getTime() + LINK_TOKEN_TTL_MS)
}

/** Kiruvchi matn token shakliga mosmi (eski 6 belgili tokenlar ham muddati tugaguncha ishlaydi). */
export function isWellFormedLinkToken(raw: unknown): boolean {
  return typeof raw === 'string' && /^[A-Z0-9]{6,32}$/.test(raw.trim().toUpperCase())
}

export function maskLinkToken(token: string | null | undefined): string | null {
  if (!token) return null
  if (token.length <= 4) return '••••'
  return `${token.slice(0, 2)}${'•'.repeat(Math.max(4, token.length - 4))}${token.slice(-2)}`
}

export type LinkTokenCheck = 'ok' | 'expired' | 'used'

export function checkLinkTokenRow(
  row: { expiresAt: Date | string; used: boolean },
  now: Date = new Date(),
): LinkTokenCheck {
  if (new Date(row.expiresAt).getTime() < now.getTime()) return 'expired'
  if (row.used) return 'used'
  return 'ok'
}
