// To'lov tasdiq holat mashinasi (pure). Kalit: summa/oy o'zgarsa YANGI kalit
// (eski kalit bilan boshqa summa jimgina replay bo'lib ketmasin); qayta bosish — bir xil kalit.

export type PayStatus = 'amount' | 'confirm' | 'sending' | 'done'

export interface PaySummary {
  receiptNumber: string
  verifyToken: string | null
  remaining: number
  amount: number
  month: string
  allocations: { month: string; amount: number }[]
  talonsClosed: number
}

export interface PayDraft {
  entityId: string
  entityName: string
  month: string
  amount: number | null
  key: string | null
  force: boolean
  status: PayStatus
  debt: number
  monthlyFee: number
  debtMonths: string[]
  summary?: PaySummary
}

export function newPayDraft(base: {
  entityId: string; entityName: string; debt: number; monthlyFee: number; debtMonths: string[]; currentMonth: string
}): PayDraft {
  return {
    entityId: base.entityId, entityName: base.entityName,
    month: base.debtMonths[0] ?? base.currentMonth,
    amount: null, key: null, force: false, status: 'amount',
    debt: base.debt, monthlyFee: base.monthlyFee, debtMonths: base.debtMonths,
  }
}

export function setAmount(d: PayDraft, amount: number, makeKey: () => string): PayDraft {
  const changed = d.amount !== amount || !d.key
  return { ...d, amount, status: 'confirm', force: false, key: changed ? makeKey() : d.key, summary: undefined }
}

export function setMonth(d: PayDraft, month: string, makeKey: () => string): PayDraft {
  if (!d.debtMonths.includes(month)) return d
  const nd = { ...d, month }
  return d.amount != null && d.month !== month ? { ...nd, key: makeKey(), force: false } : nd
}

/** go = yuborish mumkin; busy = yuborilmoqda; done = allaqachon yozilgan; invalid = tayyor emas. */
export function beginSubmit(d: PayDraft): { action: 'go' | 'busy' | 'done' | 'invalid'; draft: PayDraft } {
  if (d.status === 'sending') return { action: 'busy', draft: d }
  if (d.status === 'done') return { action: 'done', draft: d }
  if (d.status !== 'confirm' || d.amount == null || !d.key) return { action: 'invalid', draft: d }
  return { action: 'go', draft: { ...d, status: 'sending' } }
}

export function finishSubmit(d: PayDraft, summary: PaySummary): PayDraft {
  return { ...d, status: 'done', summary }
}

export function failSubmit(d: PayDraft, force = false): PayDraft {
  return { ...d, status: 'confirm', force }
}
