/**
 * Login identifikatorini normallashtiradi — email yoki telefon.
 * Telefon bo'lsa faqat raqamlar (998901234567), email bo'lsa kichik harf.
 * Bir xil natija saqlash va qidirishda ishlatiladi (login mosligi uchun).
 */
export function normalizeLogin(raw: string): string {
  const s = String(raw).trim()
  const digits = s.replace(/\D/g, '')
  const looksPhone = /^[+()\d\s-]{7,20}$/.test(s) && digits.length >= 7 && digits.length <= 15
  if (looksPhone) {
    if (digits.length === 9) return '998' + digits
    return digits
  }
  return s.toLowerCase()
}
