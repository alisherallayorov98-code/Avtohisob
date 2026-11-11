// Korxona bo'yicha PostgreSQL advisory lock (tranzaksiya darajasida).
// STIR takrorini DB indeksi bilan emas (indeks qo'shilmaydi), dastur darajasida poygadan
// himoyalash uchun: "tekshir → yarat" ketma-ketligi bir korxonada bir vaqtda faqat bitta tranzaksiyada.

import { prisma } from '../../../lib/prisma'

export async function withOrgLock<T>(
  orgId: string,
  scope: string,
  fn: (tx: any) => Promise<T>,
  timeoutMs = 30_000,
): Promise<T> {
  return (prisma as any).$transaction(
    async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`eko:${scope}:${orgId}`}))`
      return fn(tx)
    },
    { timeout: timeoutMs, maxWait: 10_000 },
  )
}
