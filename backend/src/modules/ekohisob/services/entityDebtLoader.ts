import { queryEntityDebts } from '../lib/reportQueries'
import { resolveEntityDebt, ResolvedDebt } from '../lib/entityDebtResolve'

/**
 * Bir nechta tashkilot uchun kanonik qarz — BITTA SQL (N+1 yo'q).
 * `orgId` berilsa tenant filtri; scheduler/servislar uchun id'lar o'z manbasidan olingan bo'lsa ham
 * orgId berish tavsiya etiladi.
 */
export async function loadEntityDebts(
  entities: { id: string; billingMode: string }[],
  orgId?: string,
  ctx?: { currentMonth?: string; paidCurrentMonth?: boolean },
): Promise<Map<string, ResolvedDebt>> {
  const canon = await queryEntityDebts(entities.map(e => e.id), orgId)
  const out = new Map<string, ResolvedDebt>()
  for (const e of entities) out.set(e.id, resolveEntityDebt(e.billingMode, canon.get(e.id), ctx))
  return out
}
