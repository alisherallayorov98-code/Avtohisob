/**
 * Login identifikatorini normallashtiradi — email yoki telefon.
 * Telefon bo'lsa faqat raqamlar (998901234567), email bo'lsa kichik harf.
 * Bir xil natija saqlash va qidirishda ishlatiladi (login mosligi uchun).
 */
export function normalizeLogin(raw: string): string {
  const s = String(raw).trim()
  // Telefon: + bilan yoki faqat raqam/probel/qavs/chiziq, 7-15 ta raqam
  const digits = s.replace(/\D/g, '')
  const looksPhone = /^[+()\d\s-]{7,20}$/.test(s) && digits.length >= 7 && digits.length <= 15
  if (looksPhone) {
    // 9 xonali (901234567) → 998 bilan to'ldirish
    if (digits.length === 9) return '998' + digits
    return digits
  }
  return s.toLowerCase()
}

/** Ko'rsatish uchun: telefon bo'lsa +998 90 ..., email bo'lsa o'zi */
export function isPhoneLogin(login: string): boolean {
  return /^\d{9,15}$/.test(login)
}
