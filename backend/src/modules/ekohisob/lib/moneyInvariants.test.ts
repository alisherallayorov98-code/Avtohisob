// EkoHisob PUL YADROSI — PROPERTY / INVARIANT testlar (seeded PRNG, fast-check yo'q).
//
// Har bir property 300+ tasodifiy stsenariyda tekshiriladi. Seed qat'iy — test
// barqaror; xato chiqsa seed+iteratsiya raqami xabarda ko'rinadi.

import { allocatePayment, DebtMonth } from './paymentAllocation'
import {
  computeEntityDebt, getEntityBalance, talonMonth, talonPaidPart,
} from './debtMath'
import {
  applyPlanToState, ChargeState, planPayment, planReversal,
} from './paymentPlan'
import { applyToTalons, reduceTalonPaid, TalonRow } from './talonPay'
import { buildReconciliation } from './reconciliation'
import { buildMonthlyReport } from './monthlyReport'
import { parseIdempotencyKey, parseMoneyAmount } from './money'

// ── deterministik PRNG ──
function mulberry32(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const RUNS = 400
function forAll(name: string, seed: number, body: (r: () => number, i: number) => void) {
  it(`${name} (${RUNS} stsenariy, seed ${seed})`, () => {
    const r = mulberry32(seed)
    for (let i = 0; i < RUNS; i++) {
      try { body(r, i) } catch (e: any) {
        e.message = `[seed=${seed} iter=${i}] ${e.message}`
        throw e
      }
    }
  })
}
const int = (r: () => number, lo: number, hi: number) => lo + Math.floor(r() * (hi - lo + 1))
const money = (r: () => number) => int(r, 1, 60) * 5_000       // 5 000 .. 300 000
const MONTHS = ['2026-01', '2026-02', '2026-03', '2026-04', '2026-05', '2026-06']
const pick = <T,>(r: () => number, a: T[]): T => a[int(r, 0, a.length - 1)]
const sumOf = (xs: number[]) => xs.reduce((s, x) => s + x, 0)

// ─────────────────────────────────────────────────────────────────────────────
describe('(i)(ii) paymentAllocation — yig\'indi aynan to\'lovga teng, qarzdan oshmaydi', () => {
  forAll('taqsimot', 101, (r) => {
    const debts: DebtMonth[] = []
    const n = int(r, 0, 6)
    for (let k = 0; k < n; k++) {
      // takroriy oylar, 0 va manfiy qarzlar ham bo'lsin
      debts.push({ month: pick(r, MONTHS), debt: r() < 0.2 ? -int(r, 0, 5) * 1000 : r() < 0.2 ? 0 : money(r) })
    }
    const amount = r() < 0.1 ? int(r, 1, 999) : money(r) * int(r, 1, 6)
    const selected = pick(r, MONTHS)

    const res = allocatePayment(amount, selected, debts)

    // (i) Σ == amount aynan
    expect(sumOf(res.allocations.map(a => a.amount))).toBe(amount)
    // butun, musbat, NaN yo'q
    for (const a of res.allocations) {
      expect(Number.isInteger(a.amount)).toBe(true)
      expect(a.amount).toBeGreaterThan(0)
    }
    expect(Number.isInteger(res.advance) && res.advance >= 0).toBe(true)
    expect(Number.isInteger(res.appliedToOlder) && res.appliedToOlder >= 0).toBe(true)

    // (ii) qarzdan oshmaydi (tanlangan oy: qarz + avans)
    const debtBy = new Map<string, number>()
    for (const d of debts) if (d.debt > 0) debtBy.set(d.month, (debtBy.get(d.month) ?? 0) + d.debt)
    for (const a of res.allocations) {
      const cap = (debtBy.get(a.month) ?? 0) + (a.month === selected ? res.advance : 0)
      expect(a.amount).toBeLessThanOrEqual(cap)
    }
    // avans faqat barcha qarz yopilgandagina
    if (res.advance > 0) {
      for (const [m, d] of debtBy) {
        const got = res.allocations.find(a => a.month === m)?.amount ?? 0
        expect(got - (m === selected ? res.advance : 0)).toBe(d)
      }
    }
    // appliedToOlder = tanlangan oydan boshqa oylarga ketgan yig'indi
    expect(res.appliedToOlder).toBe(sumOf(res.allocations.filter(a => a.month !== selected).map(a => a.amount)))
    // FIFO: boshqa oylarda eski oy to'liq yopilmasdan yangisiga o'tilmaydi
    const others = res.allocations.filter(a => a.month !== selected).map(a => a.month).sort()
    const olderDebtMonths = [...debtBy.keys()].filter(m => m !== selected).sort()
    others.forEach((m, idx) => {
      if (idx < others.length - 1) expect(res.allocations.find(a => a.month === m)!.amount).toBe(debtBy.get(m))
      expect(olderDebtMonths.slice(0, idx + 1)).toContain(m)
    })
  })

  it('NaN / Infinity / manfiy / matn kirishlar xavfsiz', () => {
    for (const bad of [NaN, Infinity, -5, 0, '', 'abc', null as any, undefined as any]) {
      const r = allocatePayment(bad as any, '2026-01', [{ month: '2026-01', debt: 100 }])
      expect(r.allocations).toEqual([])
    }
    const r = allocatePayment(100, '2026-01', [{ month: '2026-01', debt: NaN as any }, { month: '2026-02', debt: Infinity as any }])
    expect(sumOf(r.allocations.map(a => a.amount))).toBe(100)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
function randomFixedState(r: () => number) {
  const fee = money(r)
  const charges: ChargeState[] = []
  for (const m of MONTHS) {
    if (r() < 0.25) continue                         // hisobi yo'q oy
    const expected = r() < 0.3 ? fee : money(r)
    const kind = r()
    const paid = kind < 0.3 ? 0 : kind < 0.55 ? expected : kind < 0.8 ? int(r, 1, expected / 1000) * 1000 : expected + money(r)
    charges.push({ month: m, expectedAmount: expected, paidAmount: Math.min(paid, expected * 3) })
  }
  return { fee, charges }
}

describe('(iii) round trip: to\'lov + bekor qilish = dastlabki holat', () => {
  forAll('monthly_fixed', 202, (r) => {
    const { fee, charges } = randomFixedState(r)
    const amount = money(r) * int(r, 1, 4)
    const selected = pick(r, MONTHS)
    const plan = planPayment({ billingMode: 'monthly_fixed', monthlyFee: fee, selectedMonth: selected, amount, charges })
    expect(sumOf(plan.allocations.map(a => a.amount))).toBe(amount)

    const after = applyPlanToState({ charges, talons: [] }, plan, fee)
    const rows = plan.allocations.map((a, i) => ({ id: 'p' + i, month: a.month, amount: a.amount }))
    const rev = planReversal({ billingMode: 'monthly_fixed', rows, charges: after.charges })

    const restored = after.charges.map(c => ({ ...c }))
    for (const op of rev.chargeOps) restored.find(c => c.month === op.month)!.paidAmount = op.paidAmount

    // dastlabki hisoblar o'z qiymatiga qaytadi; yangi yaratilgan hisoblar paid=0 bo'ladi
    for (const c of charges) {
      expect(restored.find(x => x.month === c.month)!.paidAmount).toBe(c.paidAmount)
    }
    for (const c of restored) {
      if (!charges.some(x => x.month === c.month)) expect(c.paidAmount).toBe(0)
      expect(c.paidAmount).toBeGreaterThanOrEqual(0)
    }
    // qarz ham aynan dastlabkiga qaytadi (yangi hisoblar bundan mustasno bo'lishi mumkin)
    expect(rev.totalAmount).toBe(amount)

    // pul saqlanishi: to'lovdan keyin qarz = max(0, oldingi qarz − summa) (tanlangan oyda hisob bor bo'lsa)
    if (charges.some(c => c.month === selected)) {
      const d0 = computeEntityDebt({ billingMode: 'monthly_fixed', charges }).totalDebt
      const b1 = getEntityBalance({ billingMode: 'monthly_fixed', charges: after.charges })
      expect(b1.totalDebt).toBe(Math.max(0, d0 - amount))
      const b0 = getEntityBalance({ billingMode: 'monthly_fixed', charges })
      expect(b1.advance).toBe(Math.max(0, b0.advance + amount - d0))
    }
  })

  forAll('talon', 203, (r) => {
    // izchil boshlang'ich holat: har oyda S_m = T_m (+ faqat oy to'liq yopilgan bo'lsa avans)
    const talons: TalonRow[] = []
    let id = 0
    for (const m of MONTHS) {
      const k = int(r, 0, 3)
      for (let j = 0; j < k; j++) {
        const amount = money(r)
        const st = r()
        const paidAmount = st < 0.4 ? 0 : st < 0.7 ? amount : int(r, 1, amount / 1000 - 1 || 1) * 1000
        talons.push({ id: `t${id++}`, date: `${m}-${String(int(r, 1, 28)).padStart(2, '0')}`, amount, paidAmount: Math.min(paidAmount, amount), paid: paidAmount >= amount })
      }
    }
    const paymentsBy = new Map<string, number>()
    for (const m of MONTHS) {
      const ts = talons.filter(t => talonMonth(t.date) === m)
      let S = sumOf(ts.map(t => talonPaidPart(t)))
      if (ts.length && ts.every(t => talonPaidPart(t) >= t.amount) && r() < 0.3) S += money(r) // avans
      paymentsBy.set(m, S)
    }

    const amount = money(r) * int(r, 1, 3)
    const selected = pick(r, MONTHS)
    const plan = planPayment({ billingMode: 'talon', monthlyFee: 0, selectedMonth: selected, amount, talons })
    const after = applyPlanToState({ charges: [], talons }, plan, 0)

    // talonlar hech qachon amount dan oshmaydi
    for (const t of after.talons) expect(talonPaidPart(t)).toBeLessThanOrEqual(t.amount)

    const rows = plan.allocations.map((a, i) => ({ id: 'p' + i, month: a.month, amount: a.amount }))
    const rev = planReversal({
      billingMode: 'talon', rows, talons: after.talons, remainingPaymentsByMonth: paymentsBy,
    })
    const restored = after.talons.map(t => ({ ...t }))
    for (const op of rev.talonOps) {
      const t = restored.find(x => x.id === op.id)!
      t.paidAmount = op.paidAmount; t.paid = op.paid
    }
    // har oy bo'yicha jami to'langan summa dastlabkiga teng
    for (const m of MONTHS) {
      const before = sumOf(talons.filter(t => talonMonth(t.date) === m).map(t => talonPaidPart(t)))
      const afterRestore = sumOf(restored.filter(t => talonMonth(t.date) === m).map(t => talonPaidPart(t)))
      expect(afterRestore).toBe(before)
    }
    for (const t of restored) expect(talonPaidPart(t)).toBeGreaterThanOrEqual(0)
  })

  it('qayta bekor qilish manfiy qiymat bermaydi (idempotent chegarasi)', () => {
    const charges: ChargeState[] = [{ month: '2026-01', expectedAmount: 100000, paidAmount: 0 }]
    const rev = planReversal({
      billingMode: 'monthly_fixed', rows: [{ id: 'x', month: '2026-01', amount: 70000 }], charges,
    })
    expect(rev.chargeOps[0].paidAmount).toBe(0)
    expect(rev.chargeOps[0].status).toBe('open')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('(iv) bir dataset → bir qarz: computeEntityDebt == akt sverka == oylik hisobot', () => {
  const dayOf = (m: string, d: number) => `${m}-${String(d).padStart(2, '0')}T08:00:00.000Z`

  forAll('monthly_fixed', 301, (r) => {
    const charges: { month: string; expectedAmount: number; paidAmount: number }[] = []
    const payments: { paidAt: string; amount: number; month: string }[] = []
    for (const m of MONTHS) {
      if (r() < 0.2) continue
      const expected = money(r)
      const kind = r()
      const paid = kind < 0.3 ? 0 : kind < 0.55 ? expected : kind < 0.8 ? int(r, 1, expected / 1000) * 1000 : expected + money(r)
      charges.push({ month: m, expectedAmount: expected, paidAmount: paid })
      // to'lov bir necha qismga bo'linadi (izchil: Σ to'lovlar = paidAmount)
      let left = paid
      while (left > 0) {
        const part = r() < 0.5 ? left : Math.max(1, Math.min(left, int(r, 1, left)))
        payments.push({ paidAt: dayOf(m, int(r, 1, 27)), amount: part, month: m })
        left -= part
      }
    }

    const debt = computeEntityDebt({ billingMode: 'monthly_fixed', charges })
    const recon = buildReconciliation({ billingMode: 'monthly_fixed', charges, payments })
    const bal = getEntityBalance({ billingMode: 'monthly_fixed', charges, payments })
    const balNoPay = getEntityBalance({ billingMode: 'monthly_fixed', charges })

    // akt sverka yakuniy saldosi == qarz − avans
    expect(recon.closingBalance).toBe(debt.totalDebt - balNoPay.advance)
    expect(recon.closingDebt).toBe(debt.totalDebt)
    expect(recon.closingAdvance).toBe(balNoPay.advance)
    // to'lovlardan hisoblangan balans ham aynan shu
    expect(bal.totalDebt).toBe(debt.totalDebt)
    expect(bal.advance).toBe(balNoPay.advance)
    // qarz va avans bir vaqtda mavjud bo'lmaydi
    expect(debt.totalDebt === 0 || bal.advance === 0).toBe(true)
    // oylar bo'yicha taqsimot yig'indisi == jami
    expect(sumOf(bal.months.map(m => m.debt))).toBe(debt.totalDebt)

    // oylik hisobot: har oy max(0, kutilgan−to'langan) yig'indisi; avansni ayirsak qarz bilan mos
    const agg = new Map<string, any>()
    for (const c of charges) agg.set(c.month, { chargeExpected: c.expectedAmount, chargePaid: c.paidAmount })
    const rep = buildMonthlyReport(MONTHS, agg)
    const surplus = sumOf(charges.map(c => Math.max(0, c.paidAmount - c.expectedAmount)))
    expect(Math.max(0, rep.totals.debt - surplus)).toBe(debt.totalDebt)
    if (surplus === 0) expect(rep.totals.debt).toBe(debt.totalDebt)
  })

  forAll('talon', 302, (r) => {
    const talons: TalonRow[] = []
    let id = 0
    for (const m of MONTHS) {
      for (let j = int(r, 0, 3); j > 0; j--) {
        talons.push({ id: `t${id++}`, date: `${m}-${String(int(r, 1, 28)).padStart(2, '0')}`, amount: money(r), paidAmount: 0, paid: false })
      }
    }
    // izchil to'lovlar: har to'lov planPayment orqali; Σ to'lov ≤ Σ talon (avanssiz)
    const total = sumOf(talons.map(t => t.amount))
    let state = { charges: [] as ChargeState[], talons }
    const payments: { paidAt: string; amount: number; month: string }[] = []
    let left = total ? int(r, 0, total / 1000) * 1000 : 0
    while (left > 0) {
      const amount = Math.min(left, money(r) * int(r, 1, 2))
      const selected = pick(r, MONTHS)
      const plan = planPayment({ billingMode: 'talon', monthlyFee: 0, selectedMonth: selected, amount, talons: state.talons })
      if (plan.advance > 0) break                         // avans hosil bo'ldi — bu stsenariy qarz tengligi uchun emas
      state = applyPlanToState(state, plan, 0)
      for (const a of plan.allocations) {
        payments.push({ paidAt: dayOf(a.month, int(r, 1, 27)), amount: a.amount, month: a.month })
      }
      left -= amount
    }

    const debt = computeEntityDebt({ billingMode: 'talon', talons: state.talons })
    const recon = buildReconciliation({ billingMode: 'talon', talons: state.talons.map(t => ({ date: t.date, amount: t.amount })), payments })
    const bal = getEntityBalance({ billingMode: 'talon', talons: state.talons, payments })

    expect(recon.closingBalance).toBe(debt.totalDebt)
    expect(bal.totalDebt).toBe(debt.totalDebt)
    expect(bal.advance).toBe(0)
    expect(sumOf(bal.months.map(m => m.debt))).toBe(debt.totalDebt)

    // oylik hisobot talon qarzi
    const agg = new Map<string, any>()
    for (const m of MONTHS) {
      const ts = state.talons.filter(t => talonMonth(t.date) === m)
      agg.set(m, { talonExpected: sumOf(ts.map(t => t.amount)), talonUnpaid: sumOf(ts.map(t => t.amount - talonPaidPart(t))) })
    }
    expect(buildMonthlyReport(MONTHS, agg).totals.debt).toBe(debt.totalDebt)
  })

  forAll('variable', 303, (r) => {
    const payments = Array.from({ length: int(r, 0, 5) }, () => ({
      paidAt: dayOf(pick(r, MONTHS), int(r, 1, 27)), amount: money(r), month: pick(r, MONTHS),
    }))
    const debt = computeEntityDebt({ billingMode: 'variable', paidCurrentMonth: true, currentMonth: '2026-06' })
    const bal = getEntityBalance({ billingMode: 'variable', payments })
    expect(debt.totalDebt).toBe(0)
    expect(bal.totalDebt).toBe(0)
    // ortiqcha to'lov avans balansi: variable'da barcha to'lov kredit
    expect(bal.advance).toBe(sumOf(payments.map(p => p.amount)))
    const recon = buildReconciliation({ billingMode: 'variable', payments })
    expect(recon.mode).toBe('payments_only')
    expect(recon.totals.credit).toBe(bal.advance)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('(v) talon qisman to\'lovlar', () => {
  forAll('qisman to\'lovlar yig\'indisi talon holatiga teng', 401, (r) => {
    const talons: TalonRow[] = Array.from({ length: int(r, 1, 6) }, (_, k) => ({
      id: 't' + k, date: `2026-0${int(r, 1, 3)}-${String(int(r, 1, 28)).padStart(2, '0')}`, amount: money(r), paidAmount: 0, paid: false,
    }))
    const total = sumOf(talons.map(t => t.amount))
    let state = talons
    let paidIn = 0
    let leftover = 0
    for (let k = int(r, 1, 6); k > 0; k--) {
      const amount = int(r, 1, 80) * 1000
      const res = applyToTalons(state, amount)
      expect(res.applied + res.leftover).toBe(amount)
      for (const u of res.updates) {
        const t = state.find(x => x.id === u.id)!
        expect(u.paidAmount).toBeLessThanOrEqual(t.amount)
        expect(u.paid).toBe(u.paidAmount >= t.amount)
        expect(u.delta).toBeGreaterThan(0)
      }
      state = state.map(t => {
        const u = res.updates.find(x => x.id === t.id)
        return u ? { ...t, paidAmount: u.paidAmount, paid: u.paid } : t
      })
      paidIn += res.applied
      leftover += res.leftover
    }
    expect(sumOf(state.map(t => talonPaidPart(t)))).toBe(paidIn)
    expect(paidIn + leftover).toBeGreaterThan(0)
    expect(paidIn).toBeLessThanOrEqual(total)
    // qarz = jami − to'langan
    const debt = computeEntityDebt({ billingMode: 'talon', talons: state })
    expect(debt.totalDebt).toBe(total - paidIn)
    // FIFO: to'liq yopilgan talondan keyin sanasi ERTA talon ochiq qolmaydi (qisman bo'lishi mumkin faqat bitta)
    const sorted = [...state].sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id.localeCompare(b.id))
    const firstOpen = sorted.findIndex(t => talonPaidPart(t) < t.amount)
    if (firstOpen >= 0) {
      for (const t of sorted.slice(firstOpen + 1)) expect(talonPaidPart(t)).toBe(0)
    }
  })

  forAll('reduceTalonPaid manfiy bo\'lmaydi va ko\'p ayirmaydi', 402, (r) => {
    const talons: TalonRow[] = Array.from({ length: int(r, 1, 5) }, (_, k) => {
      const amount = money(r)
      return { id: 't' + k, date: `2026-01-${String(k + 1).padStart(2, '0')}`, amount, paidAmount: int(r, 0, amount / 1000) * 1000, paid: false }
    })
    const want = int(r, 0, 800) * 1000
    const res = reduceTalonPaid(talons, want)
    expect(res.reduced).toBeLessThanOrEqual(want)
    expect(res.reduced).toBeLessThanOrEqual(sumOf(talons.map(t => talonPaidPart(t))))
    for (const u of res.updates) expect(u.paidAmount).toBeGreaterThanOrEqual(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
describe('(vi) idempotentlik — pure qismlar', () => {
  forAll('bir xil kirish → bir xil reja (deterministik)', 501, (r) => {
    const { fee, charges } = randomFixedState(r)
    const input = {
      billingMode: 'monthly_fixed', monthlyFee: fee, selectedMonth: pick(r, MONTHS),
      amount: money(r) * int(r, 1, 3), charges,
    }
    expect(planPayment(input)).toEqual(planPayment(JSON.parse(JSON.stringify(input))))
  })

  it('kalit store: bir kalit ikki marta = bitta to\'lov', () => {
    // yadroning "kalit bo'yicha mavjud bo'lsa o'shani qaytar" qoidasi (pure model)
    const store = new Map<string, number>()
    let created = 0
    const record = (key: string, amount: number) => {
      if (store.has(key)) return store.get(key)!
      created++
      store.set(key, amount)
      return amount
    }
    const k = parseIdempotencyKey('  web-1730000000-abcdef  ')!
    expect(k).toBe('web-1730000000-abcdef')
    expect(record(k, 150000)).toBe(150000)
    expect(record(k, 150000)).toBe(150000)
    expect(created).toBe(1)
    expect(parseIdempotencyKey('short')).toBeNull()
    expect(parseIdempotencyKey('has space in key!')).toBeNull()
  })

  it('summa qat\'iy: faqat musbat butun son', () => {
    for (const ok of [1, 1500, '150000', ' 2000 ']) expect(parseMoneyAmount(ok)).not.toBeNull()
    for (const bad of ['1500.75', '1e6', '12 000', '0x10', '-5', '+5', '', ' ', 0, -1, 1.5, NaN, Infinity,
      '1,5', null, undefined, {}, [], true, '99999999999999999999']) {
      expect(parseMoneyAmount(bad as any)).toBeNull()
    }
  })
})
