import { createHash } from 'crypto'

/**
 * Ochiq QR havolasida tashkilotni ajratish uchun qisqa kalit. Hujjat raqami endi
 * faqat tashkilot ichida noyob, shuning uchun havola `?o=<kalit>` ni olib yuradi.
 * orgId'ning o'zi oshkor bo'lmaydi (bir tomonlama hash).
 */
export function orgPublicKey(orgId: string): string {
  return createHash('sha256').update(`savdo:${orgId}`).digest('hex').slice(0, 10)
}
