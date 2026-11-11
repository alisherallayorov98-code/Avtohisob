// EkoHisob — "Jami qarz" YAGONA ta'rifi (DB'siz, testlanadi).
//
// Ilgari dashboard faqat 'active' tashkilotlar qarzini, hisobot esa HAMMA holatni
// (qora ro'yxat ham) yig'ardi — KPI "jami qarz" bilan tuman yig'indisi mos kelmasdi.
// Endi hamma joyda bitta qoida:
//
//   FAOL qarz          = status 'active' tashkilotlarning ochiq/qisman hisoblari
//                        (expected − paid) + to'lanmagan talonlar (amount − paidAmount);
//   QORA RO'YXAT qarzi = status 'blacklisted' tashkilotlarning shu qarzi — ALOHIDA ko'rsatkich;
//   boshqa (inactive/draft) — hech qaysi KPI'ga kirmaydi (alohida `otherDebt`).
//
// `includeBlacklisted` = true bo'lsa "jami" ga qora ro'yxat ham qo'shiladi. Tuman, mahalla va
// inspektor qatorlari DOIM xuddi shu to'plamdan yig'iladi, shuning uchun
// Σ qatorlar == jami (invariant — testda).

export const NO_MAHALLA = '__no_mahalla__'

export interface DebtGroupRow {
  districtId: string
  mahallId: string | null
  status: string
  /** shu guruhdagi jami qarz (so'm, butun son) */
  debt: number
  /** qarzi bor tashkilotlar soni */
  debtors: number
}

/** Hisobot KPI'lariga kiradigan tashkilot holatlari. */
export function reportStatuses(includeBlacklisted: boolean): string[] {
  return includeBlacklisted ? ['active', 'blacklisted'] : ['active']
}

export interface DebtTotals { debt: number; debtors: number }

export interface DebtSummary {
  activeDebt: number
  activeDebtors: number
  blacklistedDebt: number
  blacklistedDebtors: number
  otherDebt: number
  /** KPI "jami qarz" — includeBlacklisted ga qarab */
  totalDebt: number
  totalDebtors: number
  includeBlacklisted: boolean
}

const int = (v: unknown): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) ? n : 0
}

export function summarizeDebt(rows: DebtGroupRow[], includeBlacklisted = false): DebtSummary {
  let activeDebt = 0, activeDebtors = 0, blacklistedDebt = 0, blacklistedDebtors = 0, otherDebt = 0
  for (const r of rows) {
    const debt = Math.max(0, int(r.debt))
    const debtors = Math.max(0, int(r.debtors))
    if (r.status === 'active') { activeDebt += debt; activeDebtors += debtors }
    else if (r.status === 'blacklisted') { blacklistedDebt += debt; blacklistedDebtors += debtors }
    else otherDebt += debt
  }
  return {
    activeDebt, activeDebtors, blacklistedDebt, blacklistedDebtors, otherDebt,
    totalDebt: activeDebt + (includeBlacklisted ? blacklistedDebt : 0),
    totalDebtors: activeDebtors + (includeBlacklisted ? blacklistedDebtors : 0),
    includeBlacklisted,
  }
}

function inScope(r: DebtGroupRow, includeBlacklisted: boolean): boolean {
  return r.status === 'active' || (includeBlacklisted && r.status === 'blacklisted')
}

/** Tuman bo'yicha qarz (KPI to'plami bilan bir xil holatlar). */
export function debtByDistrict(rows: DebtGroupRow[], includeBlacklisted = false): Map<string, DebtTotals> {
  const out = new Map<string, DebtTotals>()
  for (const r of rows) {
    if (!inScope(r, includeBlacklisted)) continue
    const cur = out.get(r.districtId) ?? { debt: 0, debtors: 0 }
    cur.debt += Math.max(0, int(r.debt))
    cur.debtors += Math.max(0, int(r.debtors))
    out.set(r.districtId, cur)
  }
  return out
}

/** Bitta tuman ichidagi mahalla bo'yicha qarz; mahallasiz → NO_MAHALLA kaliti (haqiqiy qarz, 0 emas). */
export function debtByMahalla(
  rows: DebtGroupRow[], districtId: string, includeBlacklisted = false,
): Map<string, DebtTotals> {
  const out = new Map<string, DebtTotals>()
  for (const r of rows) {
    if (r.districtId !== districtId || !inScope(r, includeBlacklisted)) continue
    const key = r.mahallId ?? NO_MAHALLA
    const cur = out.get(key) ?? { debt: 0, debtors: 0 }
    cur.debt += Math.max(0, int(r.debt))
    cur.debtors += Math.max(0, int(r.debtors))
    out.set(key, cur)
  }
  return out
}

/** Map qiymatlarining yig'indisi — invariant tekshiruvi uchun ham. */
export function sumTotals(m: Map<string, DebtTotals>): DebtTotals {
  let debt = 0, debtors = 0
  for (const v of m.values()) { debt += v.debt; debtors += v.debtors }
  return { debt, debtors }
}

// ─────────────────────────────────────────────────────────────────────────────
// SQL (reportQueries.DR_CTE) ning PURE ekvivalenti.
//
// SQL va bu funksiya BIR XIL mantiqni bajaradi; testda ikkalasi (va debtMath.getEntityBalance)
// tasodifiy stsenariylarda solishtiriladi — SQL o'zgarsa shu funksiya ham o'zgarishi shart.
// Kirish: tashkilotning oylik qatorlari (rejimga qarab: monthly_fixed → charge, talon → oy bo'yicha
// talonlar yig'indisi: ex = Σamount, pd = Σ talonPaidPart). variable → qatorlar yo'q → qarz 0.
// ─────────────────────────────────────────────────────────────────────────────

export interface MonthExPd { month: string; ex: number; pd: number }

export interface EntityDebtAgg {
  debt: number
  advance: number
  months: number
  oldest: string | null
  unpaidMonths: string[]
}

export function entityDebtFromMonthRows(rows: MonthExPd[]): EntityDebtAgg {
  const sorted = [...rows]
    .map(r => ({ month: r.month, ex: Math.max(0, int(r.ex)), pd: Math.max(0, int(r.pd)) }))
    .sort((a, b) => a.month.localeCompare(b.month))
  let surplus = 0
  for (const r of sorted) surplus += Math.max(0, r.pd - r.ex)
  let cum = 0
  let shortTotal = 0
  const unpaidMonths: string[] = []
  for (const r of sorted) {
    const s = Math.max(0, r.ex - r.pd)
    cum += s
    shortTotal += s
    if (s > 0 && cum > surplus) unpaidMonths.push(r.month)
  }
  return {
    debt: Math.max(0, shortTotal - surplus),
    advance: Math.max(0, surplus - shortTotal),
    months: unpaidMonths.length,
    oldest: unpaidMonths[0] ?? null,
    unpaidMonths,
  }
}

/** Tashkilot darajasidagi qarzlarni guruhlarga (tuman × mahalla × holat) yig'adi — SQL queryDebtGroups ekvivalenti. */
export function groupEntityDebts(
  entities: { districtId: string; mahallId: string | null; status: string; debt: number }[],
): DebtGroupRow[] {
  const map = new Map<string, DebtGroupRow>()
  for (const e of entities) {
    const debt = Math.max(0, int(e.debt))
    if (debt <= 0) continue
    const key = `${e.districtId}|${e.mahallId ?? ''}|${e.status}`
    const cur = map.get(key) ?? { districtId: e.districtId, mahallId: e.mahallId, status: e.status, debt: 0, debtors: 0 }
    cur.debt += debt
    cur.debtors += 1
    map.set(key, cur)
  }
  return [...map.values()]
}
