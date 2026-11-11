// EkoHisob — to'lov guruhini bekor qilish (storno) uchun pure yordamchilar.

export interface ReversalRow { id: string; month: string; amount: number }

/** Guruh qatorlarini oy bo'yicha yig'adi (bir oyda bir necha qator bo'lishi mumkin). */
export function sumRowsByMonth(rows: ReversalRow[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    out.set(r.month, (out.get(r.month) ?? 0) + Math.max(0, Math.trunc(Number(r.amount) || 0)))
  }
  return out
}
