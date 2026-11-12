// QQS (ixtiyoriy). Qator narxlari QQSsiz; QQS ustiga qo'shiladi.
const r2 = (n: number): number => Math.round(n * 100) / 100

export function normalizeVatRate(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return null
  if (n > 100) throw new Error('QQS foizi noto\'g\'ri')
  return n
}

export function applyVat(subtotal: number, rate: number | null): { vatAmount: number; total: number } {
  if (!rate) return { vatAmount: 0, total: r2(subtotal) }
  const vatAmount = r2((subtotal * rate) / 100)
  return { vatAmount, total: r2(subtotal + vatAmount) }
}
