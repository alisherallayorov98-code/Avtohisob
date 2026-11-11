// Parol siyosati — PURE.

export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128 // bcrypt 72 baytdan keyin kesadi; juda uzun kirishlarni rad etamiz

/** null = yaroqli, aks holda o'zbekcha xato matni. */
export function validatePassword(p: unknown): string | null {
  if (typeof p !== 'string') return 'Parol matn bo\'lishi kerak'
  if (p.length < MIN_PASSWORD_LENGTH) return `Parol kamida ${MIN_PASSWORD_LENGTH} ta belgidan iborat bo'lishi kerak`
  if (p.length > MAX_PASSWORD_LENGTH) return `Parol ${MAX_PASSWORD_LENGTH} belgidan oshmasligi kerak`
  if (/^\s+$/.test(p)) return 'Parol faqat bo\'sh joydan iborat bo\'la olmaydi'
  return null
}
