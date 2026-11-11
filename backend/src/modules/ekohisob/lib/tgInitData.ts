import crypto from 'crypto'

/** initData eskirish oynasi: 2 soat (qayta yuborish hujumidan himoya; ilgari 24 soat edi). */
export const TG_AUTH_MAX_AGE_SEC = 2 * 60 * 60

/**
 * Telegram Mini App (Web App) initData ni tekshiradi.
 * Telegram imzosini bot token bilan tasdiqlaymiz — soxta so'rovlardan himoya.
 * Hujjat: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 * `nowSec` — testlash uchun.
 */
export function verifyTelegramWebApp(initData: string, botToken: string, nowSec: number = Date.now() / 1000): any | null {
  try {
    if (initData.length > 8192) return null
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')
    if (!hash || !/^[0-9a-f]{64}$/i.test(hash)) return null
    params.delete('hash')

    const dataCheckString = [...params.entries()]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${k}=${v}`)
      .join('\n')

    const secretKey = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest()
    const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest()
    const given = Buffer.from(hash, 'hex')
    // Vaqt bo'yicha doimiy solishtirish (timing hujumidan himoya)
    if (given.length !== computed.length || !crypto.timingSafeEqual(given, computed)) return null

    // auth_date — 2 soatdan eski yoki kelajakdagi (soat siljishidan >1 daqiqa) bo'lmasin
    const authDate = Number(params.get('auth_date'))
    if (!authDate || nowSec - authDate > TG_AUTH_MAX_AGE_SEC || authDate - nowSec > 60) return null

    const userStr = params.get('user')
    return userStr ? JSON.parse(userStr) : null
  } catch {
    return null
  }
}

