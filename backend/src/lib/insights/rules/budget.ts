// J. Xarajat va byudjet (114–119)
import type { Rule, Finding, Evidence, ExpenseSnap } from '../types'
import { fmtDate, fmtNum, fmtUzs, maintTotal, type Ctx } from '../context'
import { maintEv, fuelEv, expenseEv, table } from '../evidence'

const BUDGET = { label: 'Byudjet', path: '/budget' }
const EXP = { label: 'Xarajatlar', path: '/expenses' }
const CAT_NAME: Record<string, string> = { fuel: "Yoqilg'i", maintenance: "Ta'mir", expense: 'Boshqa xarajatlar', total: 'Umumiy' }

function monthStart(c: Ctx): Date {
  const uz = new Date(c.now.getTime() + 5 * 3600 * 1000)
  return new Date(Date.UTC(uz.getUTCFullYear(), uz.getUTCMonth(), 1) - 5 * 3600 * 1000)
}

function monthActuals(c: Ctx, branchId: string | null): Record<string, number> {
  const from = monthStart(c)
  const inScope = (vid: string) => !branchId || c.vehicle.get(vid)?.branchId === branchId
  const fuel = c.s.fuel.filter(r => r.date >= from && inScope(r.vehicleId)).reduce((s, r) => s + r.cost, 0)
  const maintenance = c.s.maintenance.filter(m => m.status === 'approved' && m.date >= from && inScope(m.vehicleId)).reduce((s, m) => s + maintTotal(m), 0)
  const expense = c.s.expenses.filter(e => e.date >= from && inScope(e.vehicleId)).reduce((s, e) => s + e.amount, 0)
  return { fuel, maintenance, expense, total: fuel + maintenance + expense }
}

/** Byudjet savoli manbasi: shu oy shu kategoriyadagi eng katta yozuvlar */
function monthEvidence(c: Ctx, branchId: string | null, category: string, planned: number, actual: number): Evidence {
  const from = monthStart(c)
  const inScope = (vid: string) => !branchId || c.vehicle.get(vid)?.branchId === branchId
  const note = `Reja ${fmtNum(planned)}, haqiqiy ${fmtNum(actual)} so'm (${fmtDate(from)} dan).`
  if (category === 'fuel') return fuelEv(c.s.fuel.filter(r => r.date >= from && inScope(r.vehicleId)).sort((a, b) => a.cost - b.cost), note + " Eng katta quyishlar.")
  if (category === 'maintenance') return maintEv(c.s.maintenance.filter(m => m.status === 'approved' && m.date >= from && inScope(m.vehicleId)).sort((a, b) => maintTotal(a) - maintTotal(b)), note + " Eng katta ta'mirlar.")
  if (category === 'expense') return expenseEv(c.s.expenses.filter(e => e.date >= from && inScope(e.vehicleId)), note)
  const a = monthActuals(c, branchId)
  return table(['Tur', 'Summa'], [["Yoqilg'i", fmtNum(a.fuel)], ["Ta'mir", fmtNum(a.maintenance)], ['Boshqa xarajat', fmtNum(a.expense)], ['Jami', fmtNum(a.total)]], note)
}

/** Kategoriya bo'yicha yig'indi — "nimaga sarflandi" savoliga javob */
function byCategory(es: ExpenseSnap[]): Array<[string, number]> {
  const m = new Map<string, number>()
  for (const e of es) m.set(e.category || '—', (m.get(e.category || '—') || 0) + e.amount)
  return [...m.entries()].sort((a, b) => b[1] - a[1])
}

export const budgetRules: Rule[] = [
  {
    key: 'budget.exceeded', no: 114, category: 'budget', name: 'Byudjet oshib ketgan',
    run: (c) => {
      const uzMonth = new Date(c.now.getTime() + 5 * 3600 * 1000).getUTCMonth() + 1
      return c.s.budgets
        .filter(b => b.month === uzMonth && b.amount > 0)
        .map(b => ({ b, actual: monthActuals(c, b.branchId)[b.category] ?? 0 }))
        .filter(x => x.actual > x.b.amount)
        .map(({ b, actual }) => c.f({
          ruleKey: 'budget.exceeded', category: 'budget', severity: 'critical', subjectKey: `${b.category}|${b.branchId || ''}`,
          title: `${CAT_NAME[b.category] || b.category} byudjeti ${Math.round((actual / b.amount - 1) * 100)}% oshib ketdi${b.branchId ? ` (${c.s.branches.find(x => x.id === b.branchId)?.name || 'filial'})` : ''}`,
          detail: `Reja ${fmtUzs(b.amount)}, haqiqiy ${fmtUzs(actual)}. Oy oxirigacha xarajatni nazoratga oling.`,
          action: BUDGET, impactUzs: actual - b.amount, evidence: monthEvidence(c, b.branchId, b.category, b.amount, actual),
        }))
    },
  },
  {
    key: 'budget.pace', no: 115, category: 'budget', name: 'Byudjet muddatidan oldin tugayapti',
    run: (c) => {
      const uz = new Date(c.now.getTime() + 5 * 3600 * 1000)
      const day = uz.getUTCDate()
      if (day > 20) return []
      const uzMonth = uz.getUTCMonth() + 1
      return c.s.budgets
        .filter(b => b.month === uzMonth && b.amount > 0)
        .map(b => ({ b, actual: monthActuals(c, b.branchId)[b.category] ?? 0 }))
        .filter(x => x.actual >= x.b.amount * 0.8 && x.actual <= x.b.amount)
        .map(({ b, actual }) => c.f({
          ruleKey: 'budget.pace', category: 'budget', severity: 'warning', subjectKey: `${b.category}|${b.branchId || ''}`,
          title: `${CAT_NAME[b.category] || b.category} byudjetining ${Math.round((actual / b.amount) * 100)}% i oyning ${day}-kunidayoq sarflandi`,
          detail: `Reja ${fmtUzs(b.amount)}, sarflangan ${fmtUzs(actual)}. Shu sur'atda oy oxiriga yetmaydi.`,
          action: BUDGET, evidence: monthEvidence(c, b.branchId, b.category, b.amount, actual),
        }))
    },
  },
  {
    key: 'budget.no_receipt', no: 116, category: 'budget', name: "Katta xarajat, chek yo'q",
    run: (c) => {
      const out: Finding[] = []
      for (const [vid, es] of c.expensesByV) {
        if (!c.vehicle.has(vid)) continue
        const bad = es.filter(e => e.date >= c.ago(90) && e.amount >= 500_000 && !e.hasReceipt)
        if (!bad.length) continue
        const total = bad.reduce((s, e) => s + e.amount, 0)
        out.push(c.f({
          ruleKey: 'budget.no_receipt', category: 'budget', severity: 'info', vehicleId: vid,
          title: `${c.plate(vid)} — ${bad.length} ta xarajat (${fmtUzs(total)}) chek bilan tasdiqlanmagan`,
          detail: `Masalan: ${bad.slice(0, 2).map(e => `${e.category} ${fmtUzs(e.amount)} (${fmtDate(e.date)})`).join(', ')}.`,
          action: EXP, evidence: expenseEv(bad, '500 000 so\'mdan katta, chek biriktirilmagan xarajatlar (90 kun).'),
        }))
      }
      return out
    },
  },
  {
    key: 'budget.expense_spike', no: 117, category: 'budget', name: "Xarajat o'rtachadan 50%+ oshgan",
    run: (c) => {
      const out: Finding[] = []
      for (const [vid, es] of c.expensesByV) {
        if (!c.vehicle.has(vid)) continue
        const curList = es.filter(e => e.date >= c.ago(30))
        const prevList = es.filter(e => e.date >= c.ago(120) && e.date < c.ago(30))
        const cur = curList.reduce((s, e) => s + e.amount, 0)
        const prev = prevList.reduce((s, e) => s + e.amount, 0) / 3
        if (cur < 1_000_000 || prev <= 0 || cur <= prev * 1.5) continue
        // Qaysi kategoriya o'sdi: joriy oy va oldingi oylar o'rtachasi kategoriya bo'yicha
        const prevBy = new Map(byCategory(prevList).map(([k, s]) => [k, s / 3]))
        const growth = byCategory(curList).map(([k, s]) => ({ k, cur: s, prev: prevBy.get(k) || 0 })).sort((a, b) => (b.cur - b.prev) - (a.cur - a.prev))
        const main = growth[0]
        const biggest = [...curList].sort((a, b) => b.amount - a.amount)[0]
        out.push(c.f({
          ruleKey: 'budget.expense_spike', category: 'budget', severity: 'warning', vehicleId: vid,
          title: `${c.plate(vid)} — bu oy boshqa xarajatlar ${Math.round((cur / prev - 1) * 100)}% oshdi. Asosan "${main.k}"`,
          detail: `Oxirgi 30 kun ${fmtUzs(cur)} (${curList.length} ta yozuv), oldingi oylar o'rtachasi ${fmtUzs(prev)}. ` +
            `"${main.k}": ${fmtUzs(main.cur)} (odatda ${fmtUzs(main.prev)}). Eng katta yozuv: ${fmtUzs(biggest.amount)}, ${fmtDate(biggest.date)}.`,
          action: EXP, impactUzs: cur - prev,
          evidence: {
            ...expenseEv(curList, 'Oxirgi 30 kundagi xarajatlar (eng kattasi birinchi). Kategoriya bo\'yicha: ' +
              growth.slice(0, 4).map(g => `${g.k} ${fmtNum(g.cur)} (odatda ${fmtNum(g.prev)})`).join('; ') + '.'),
          },
        }))
      }
      return out
    },
  },
  {
    key: 'budget.inactive_expense', no: 118, category: 'budget', name: 'Nofaol mashinaga xarajat',
    run: (c) => {
      const out: Finding[] = []
      for (const v of c.vehicles.filter(v => v.status === 'inactive')) {
        const es = (c.expensesByV.get(v.id) || []).filter(e => e.date >= c.ago(60))
        const fuel = (c.fuelByV.get(v.id) || []).filter(r => r.date >= c.ago(60))
        const total = es.reduce((s, e) => s + e.amount, 0) + fuel.reduce((s, r) => s + r.cost, 0)
        if (total <= 0) continue
        out.push(c.f({
          ruleKey: 'budget.inactive_expense', category: 'budget', severity: 'warning', vehicleId: v.id,
          title: `${v.plate} — "nofaol" mashinaga 60 kunda ${fmtUzs(total)} xarajat yozilgan. Qanday qilib?`,
          detail: `${fuel.length ? `${fuel.length} ta yoqilg'i` : ''}${fuel.length && es.length ? ', ' : ''}${es.length ? `${es.length} ta xarajat` : ''}. Mashina ishlayotgan bo'lsa holatini o'zgartiring, aks holda xarajat boshqa mashinaga tegishli.`,
          action: { label: 'Mashina kartochkasi', path: `/vehicles/${v.id}` }, impactUzs: total,
          evidence: table(['Sana', 'Tur', 'Tafsilot', 'Summa'], [
            ...fuel.map(r => [fmtDate(r.date), "Yoqilg'i", `${fmtNum(r.liters, 1)} L`, fmtNum(r.cost)]),
            ...es.map(e => [fmtDate(e.date), 'Xarajat', e.category, fmtNum(e.amount)]),
          ], `Mashina holati: "${v.status}". Oxirgi 60 kun.`, [
            ...fuel.map(r => ({ kind: 'fuel' as const, id: r.id })), ...es.map(e => ({ kind: 'expense' as const, id: e.id })),
          ]),
        }))
      }
      return out
    },
  },
  {
    key: 'budget.maint_spend_up', no: 119, category: 'budget', name: "Ta'mir xarajati oshgan (tashkilot)",
    run: (c) => {
      const sum = (from: Date, to: Date) => c.s.maintenance.filter(m => m.status === 'approved' && m.date >= from && m.date < to).reduce((s, m) => s + maintTotal(m), 0)
      const cur = sum(c.ago(30), c.now)
      const prev = sum(c.ago(60), c.ago(30))
      if (cur < 5_000_000 || prev <= 0 || cur <= prev * 1.3) return []
      // Eng ko'p hissa qo'shgan mashinalar
      const byV = new Map<string, number>()
      for (const m of c.s.maintenance) if (m.status === 'approved' && m.date >= c.ago(30)) byV.set(m.vehicleId, (byV.get(m.vehicleId) || 0) + maintTotal(m))
      const top = [...byV.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3)
      return [c.f({
        ruleKey: 'budget.maint_spend_up', category: 'budget', severity: 'warning',
        title: `Ta'mir xarajati oxirgi 30 kunda ${Math.round((cur / prev - 1) * 100)}% oshdi`,
        detail: `${fmtUzs(cur)} (oldingi 30 kun ${fmtUzs(prev)}). Eng ko'p: ${top.map(([vid, s]) => `${c.plate(vid)} — ${fmtUzs(s)}`).join(', ')}.`,
        action: { label: "Ta'mirlar", path: '/maintenance' }, impactUzs: cur - prev,
        evidence: table(['Mashina', 'Sana', 'Ish / qismlar', 'Summa'],
          c.s.maintenance.filter(m => m.status === 'approved' && m.date >= c.ago(30)).sort((a, b) => maintTotal(b) - maintTotal(a)).slice(0, 25)
            .map(m => [c.plate(m.vehicleId), fmtDate(m.date), (m.parts.map(p => p.name).join(', ') || m.notes || '—').slice(0, 120), fmtNum(maintTotal(m))]),
          'Oxirgi 30 kundagi eng katta ta\'mirlar.',
          c.s.maintenance.filter(m => m.status === 'approved' && m.date >= c.ago(30)).sort((a, b) => maintTotal(b) - maintTotal(a)).slice(0, 25)
            .map(m => ({ kind: 'maintenance' as const, id: m.id }))),
      })]
    },
  },
]
