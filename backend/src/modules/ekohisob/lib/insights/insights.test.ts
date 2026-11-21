// EkoHisob robot yordamchi — qoidalar, dvigatel, triage va tekshirish testlari (DB'siz).
import type { Snapshot, EntitySnap, FindingOut } from './types'
import {
  runRules, collapseFindings, applyAccuracy, accuracyOf, isDismissed, visibleCategories,
  fingerprintOf, ruleFingerprint, RULES, COLLAPSE_MIN,
} from './engine'
import { planAutoTasks, verifyDisappeared } from './triage'

const NOW = new Date('2026-11-21T07:00:00Z') // 12:00 UZT, oyning 21-kuni
const D = (days: number) => new Date(NOW.getTime() - days * 86_400_000)

function ent(id: string, over: Partial<EntitySnap> = {}): EntitySnap {
  return {
    id, name: `Tashkilot ${id}`, status: 'active', billingMode: 'monthly_fixed', monthlyFee: 100_000, cubicPrice: 0,
    phone: '998901234567', lat: 41.3, lon: 69.2, mahallId: 'm1', stir: `30${id.padStart(7, '0')}`, entityType: 'legal',
    districtId: 'd1', districtName: 'Chilonzor', debtLevel: 'current', smsOptOut: false, createdAt: D(400),
    debt: 0, debtMonths: 0, oldestDebtMonth: null, ...over,
  }
}

function snap(over: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW, fullScope: true, entities: [], payments: [], everPaid: new Set(), voidedReceipts: [], talons: [],
    chargeMismatches: [], missingCharges: [], visits: [], sms: [], audit: [], users: [], blacklist: [],
    blacklistSuggested: [], evalMonths: [], paidMonths: new Map(),
    org: { smsAutoEnabled: false, smsAutoDay: 10, smsAutoLastMonth: null, smsLimit: 0, smsUsedThisMonth: 0, kpiConfigured: false, prevKpiStatus: null },
    ...over,
  }
}

const keys = (s: Snapshot, rule?: string) => runRules(s).findings.filter(f => !rule || f.ruleKey === rule)

describe('qoidalar reyestri', () => {
  it('kalitlar va raqamlar takrorlanmaydi', () => {
    expect(new Set(RULES.map(r => r.key)).size).toBe(RULES.length)
    expect(new Set(RULES.map(r => r.no)).size).toBe(RULES.length)
  })
  it("bo'sh snapshot — hech qanday savol va xato yo'q", () => {
    const r = runRules(snap())
    expect(r.ruleErrors).toEqual([])
    expect(r.findings).toEqual([])
  })
  it("xodimlar mavzusidagi qoidalar avtomatik yuborilmaydi (tier admin)", () => {
    for (const r of RULES.filter(x => x.category === 'staff' || x.category === 'money')) expect(r.tier).toBe('admin')
  })
})

describe('pul nazorati', () => {
  it('bekor qilingan kvitansiya — bergan va bekor qilgan bitta odam, sabab qisqa → critical', () => {
    const s = snap({
      entities: [ent('e1')],
      voidedReceipts: [{ id: 'r1', receiptNumber: 'EKO-2026-00001', entityId: 'e1', amount: 200_000, month: '2026-11', issuedBy: 'u1', issuedAt: D(3), voidedAt: D(2), voidedBy: 'u1', voidReason: 'xato' }],
    })
    const f = keys(s, 'money.receipt_voided')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('critical')
    expect(f[0].detail).toContain('bitta odam')
  })
  it('30 kundan eski bekor qilish — savol emas', () => {
    const s = snap({ entities: [ent('e1')], voidedReceipts: [{ id: 'r1', receiptNumber: 'X', entityId: 'e1', amount: 1, month: '2026-09', issuedBy: 'u1', issuedAt: D(50), voidedAt: D(40), voidedBy: 'u2', voidReason: 'mijoz qaytardi pulni' }] })
    expect(keys(s, 'money.receipt_voided')).toHaveLength(0)
  })
  it("dublikat to'lov: bir xil summa, bir xodim, 3 daqiqa farq", () => {
    const t = D(5)
    const s = snap({
      entities: [ent('e1')],
      payments: [
        { id: 'p1', entityId: 'e1', month: '2026-11', amount: 100_000, paidAt: t, receivedBy: 'u1', groupId: null, method: 'cash', hasReceipt: true },
        { id: 'p2', entityId: 'e1', month: '2026-11', amount: 100_000, paidAt: new Date(t.getTime() + 3 * 60_000), receivedBy: 'u1', groupId: null, method: 'cash', hasReceipt: true },
      ],
    })
    expect(keys(s, 'money.duplicate_payment')).toHaveLength(1)
  })
  it("bitta kassa operatsiyasining oylari (groupId) dublikat hisoblanmaydi", () => {
    const t = D(5)
    const s = snap({
      entities: [ent('e1')],
      payments: [
        { id: 'p1', entityId: 'e1', month: '2026-10', amount: 100_000, paidAt: t, receivedBy: 'u1', groupId: 'g', method: 'cash', hasReceipt: true },
        { id: 'p2', entityId: 'e1', month: '2026-11', amount: 100_000, paidAt: t, receivedBy: 'u1', groupId: 'g', method: 'cash', hasReceipt: true },
      ],
    })
    expect(keys(s, 'money.duplicate_payment')).toHaveLength(0)
  })
  it("talon to'langan, to'lov o'chirilgan → critical", () => {
    const s = snap({
      entities: [ent('e1', { billingMode: 'talon', cubicPrice: 50_000 })],
      talons: [{ id: 't1', entityId: 'e1', volume: 2, amount: 100_000, date: D(10), paid: true, paidAmount: 100_000, paymentId: 'gone', paymentExists: false, createdBy: 'u1', createdAt: D(10) }],
    })
    const f = keys(s, 'money.talon_paid_no_payment')
    expect(f).toHaveLength(1)
    expect(f[0].impactUzs).toBe(100_000)
  })
  it('oylik summa kamaytirilgan (audit) — kim va qancha', () => {
    const s = snap({
      entities: [ent('e1')],
      audit: [{ id: 'a1', action: 'entity.update', userId: 'u1', userName: 'Ali', targetId: 'e1', targetName: 'Tashkilot e1', details: { changes: { monthlyFee: { from: 300_000, to: 100_000 } } }, createdAt: D(3) }],
    })
    const f = keys(s, 'money.fee_lowered')
    expect(f).toHaveLength(1)
    expect(f[0].impactUzs).toBe(200_000 * 12)
    expect(f[0].staffUserId).toBe('u1')
  })
  it("summa oshirilgani savol emas", () => {
    const s = snap({ entities: [ent('e1')], audit: [{ id: 'a1', action: 'entity.update', userId: 'u1', userName: 'Ali', targetId: 'e1', targetName: null, details: { changes: { monthlyFee: { from: 100, to: 300 } } }, createdAt: D(3) }] })
    expect(keys(s, 'money.fee_lowered')).toHaveLength(0)
  })
})

describe('qarz undirish', () => {
  it("va'da sanasi o'tgan, keyin to'lov yo'q → savol; to'lov bo'lsa → yo'q", () => {
    const base = {
      entities: [ent('e1', { debt: 300_000, debtMonths: 3 })],
      visits: [{ id: 'v1', entityId: 'e1', userId: 'u1', kind: 'promised', promisedDate: '2026-11-10', lat: null, lon: null, createdAt: D(15) }],
    }
    const f = keys(snap(base), 'collection.promise_broken')
    expect(f).toHaveLength(1)
    expect(f[0].severity).toBe('critical') // 11 kun
    const paid = snap({ ...base, payments: [{ id: 'p', entityId: 'e1', month: '2026-11', amount: 1, paidAt: D(5), receivedBy: 'u1', groupId: null, method: 'cash', hasReceipt: true }] })
    expect(keys(paid, 'collection.promise_broken')).toHaveLength(0)
  })
  it("3+ oylik qarzdor, 30 kunda hech narsa yo'q → critical; yaqinda tashrif bo'lsa → yo'q", () => {
    const e = ent('e1', { debt: 500_000, debtMonths: 5, oldestDebtMonth: '2026-06' })
    expect(keys(snap({ entities: [e] }), 'collection.critical_untouched')).toHaveLength(1)
    const visited = snap({ entities: [e], visits: [{ id: 'v', entityId: 'e1', userId: 'u1', kind: 'visited', promisedDate: null, lat: null, lon: null, createdAt: D(3) }] })
    expect(keys(visited, 'collection.critical_untouched')).toHaveLength(0)
  })
  it("o'zgaruvchan rejim, 60+ kun, hech qachon to'lamagan", () => {
    const s = snap({ entities: [ent('e1', { billingMode: 'variable', createdAt: D(90) }), ent('e2', { billingMode: 'variable', createdAt: D(90) })], everPaid: new Set(['e2']) })
    expect(keys(s, 'collection.variable_never_paid').map(f => f.entityId)).toEqual(['e1'])
  })
  it("to'xtagan mijoz: 6 oy to'lab, keyin 3 oy to'lamagan", () => {
    const months = ['2026-02', '2026-03', '2026-04', '2026-05', '2026-06', '2026-07', '2026-08', '2026-09', '2026-10']
    const s = snap({
      entities: [ent('e1')], evalMonths: months,
      paidMonths: new Map([['e1', { months: months.slice(0, 6), avg: 100_000 }]]),
    })
    const f = keys(s, 'collection.stopped_paying')
    expect(f).toHaveLength(1)
    expect(f[0].confidence).toBe('strong')
  })
  it("qora ro'yxatda, qarzi yo'q → chiqarish savoli", () => {
    const s = snap({ entities: [ent('e1', { status: 'blacklisted' })], blacklist: [{ entityId: 'e1', status: 'active', addedAt: D(100) }] })
    expect(keys(s, 'collection.blacklist_no_debt')).toHaveLength(1)
  })
})

describe("ma'lumot va tizim", () => {
  it("qarzdorning telefoni yo'q", () => {
    const s = snap({ entities: [ent('e1', { phone: null, debt: 100, debtMonths: 1 }), ent('e2', { phone: null })] })
    expect(keys(s, 'data.debtor_no_phone').map(f => f.entityId)).toEqual(['e1'])
  })
  it('ketma-ket 2 SMS xato → savol; oxirgisi muvaffaqiyatli bo\'lsa → yo\'q', () => {
    const fail = (d: number) => ({ entityId: 'e1', status: 'failed', createdAt: D(d), error: 'invalid number' })
    expect(keys(snap({ entities: [ent('e1')], sms: [fail(5), fail(2)] }), 'data.sms_failing')).toHaveLength(1)
    expect(keys(snap({ entities: [ent('e1')], sms: [fail(5), fail(4), { entityId: 'e1', status: 'sent', createdAt: D(1), error: null }] }), 'data.sms_failing')).toHaveLength(0)
  })
  it('bir STIR bilan ikki tashkilot', () => {
    const s = snap({ entities: [ent('e1', { stir: '301234567' }), ent('e2', { stir: '301234567', districtId: 'd2' })] })
    const f = keys(s, 'data.duplicate_stir')
    expect(f).toHaveLength(1)
    expect(f[0].evidence?.entityIds).toEqual(expect.arrayContaining(['e1', 'e2']))
  })
  it("oylik hisob yozilmagan — faqat butun korxona ko'zi bilan va oyning 3-kunidan keyin", () => {
    const base = { entities: [ent('e1')], missingCharges: ['e1'] }
    expect(keys(snap(base), 'system.charges_missing')).toHaveLength(1)
    expect(keys(snap({ ...base, fullScope: false }), 'system.charges_missing')).toHaveLength(0)
    expect(keys(snap({ ...base, now: new Date('2026-11-01T07:00:00Z') }), 'system.charges_missing')).toHaveLength(0)
  })
  it('SMS limiti 80% dan oshdi', () => {
    const org = { ...snap().org, smsLimit: 1000, smsUsedThisMonth: 850 }
    expect(keys(snap({ org }), 'system.sms_limit')[0].severity).toBe('warning')
    expect(keys(snap({ org: { ...org, smsUsedThisMonth: 1000 } }), 'system.sms_limit')[0].severity).toBe('critical')
  })
})

describe('xodimlar', () => {
  const u = (over: any = {}) => ({ id: 'u1', fullName: 'Ali', role: 'inspector', isActive: true, districtIds: ['d1'], botLinked: true, createdAt: D(30), lastActivityAt: D(1), ...over })
  it("botga ulanmagan va tumani yo'q inspektor", () => {
    expect(keys(snap({ users: [u({ botLinked: false })] }), 'staff.no_bot')).toHaveLength(1)
    expect(keys(snap({ users: [u({ districtIds: [] })] }), 'staff.no_district')).toHaveLength(1)
  })
  it("tashrif qaydi 3 km uzoqda — taxmin (guess), xodimga bog'langan", () => {
    const s = snap({
      entities: [ent('e1', { lat: 41.3, lon: 69.2 })],
      visits: [{ id: 'v1', entityId: 'e1', userId: 'u1', kind: 'visited', promisedDate: null, lat: 41.327, lon: 69.2, createdAt: D(2) }],
      users: [u()],
    })
    const f = keys(s, 'staff.visit_far')
    expect(f).toHaveLength(1)
    expect(f[0].confidence).toBe('guess')
    expect(f[0].staffUserId).toBe('u1')
  })
})

describe('dvigatel', () => {
  it("rol bo'yicha mavzular: inspektor pul va xodimlarni ko'rmaydi", () => {
    expect(visibleCategories('inspector')).toEqual(['collection', 'data'])
    expect(visibleCategories('supervisor')).not.toContain('staff')
    expect(visibleCategories('admin')).toContain('staff')
  })
  it('fingerprint barqaror', () => {
    expect(fingerprintOf({ ruleKey: 'a', entityId: 'e', subjectKey: 's' })).toBe('a|e|s')
    expect(ruleFingerprint('a')).toBe('rule:a')
  })
  it("ko'p tashkilotda chiqqan qoida bitta tizimli savolga yig'iladi", () => {
    const es = Array.from({ length: COLLAPSE_MIN + 2 }, (_, i) => ent(`e${i}`, { monthlyFee: 0 }))
    const raw = runRules(snap({ entities: es })).findings
    expect(raw.filter(f => f.ruleKey === 'data.fixed_no_fee')).toHaveLength(es.length)
    const col = collapseFindings(raw).filter(f => f.ruleKey === 'data.fixed_no_fee')
    expect(col).toHaveLength(1)
    expect(col[0].subjectKey).toBe('collapsed')
    expect(col[0].evidence?.rows).toHaveLength(es.length)
  })
  it("topshirig'i bor savol yig'ilmaydi", () => {
    const es = Array.from({ length: COLLAPSE_MIN + 2 }, (_, i) => ent(`e${i}`, { monthlyFee: 0 }))
    const raw = runRules(snap({ entities: es })).findings
    raw[0].task = { id: 't', status: 'open', assigneeId: 'u', assigneeName: null, dueDate: null, overdue: false, answer: null, autoSent: true, verifyNote: null }
    const col = collapseFindings(raw).filter(f => f.ruleKey === 'data.fixed_no_fee')
    expect(col).toHaveLength(2)
  })
  it('aniqligi past qoida "Taxmin"ga tushadi', () => {
    expect(accuracyOf(1, 3, 0).low).toBe(true)
    expect(accuracyOf(5, 1, 0).pct).toBe(83)
    expect(accuracyOf(1, 1, 0).pct).toBeNull()
    const f = runRules(snap({ entities: [ent('e1', { phone: null, debt: 1, debtMonths: 1 })] })).findings
    const out = applyAccuracy(f, new Map([['data.debtor_no_phone', accuracyOf(0, 4, 0)]]))
    expect(out[0].confidence).toBe('guess')
    expect(out[0].lowAccuracy).toBe(true)
  })
  it("yashirish: bitta savol, butun qoida, muddati o'tgani", () => {
    const f = { fingerprint: 'r|e|s', ruleKey: 'r' }
    expect(isDismissed(f, [{ fingerprint: 'r|e|s', until: null }], NOW)).toBe(true)
    expect(isDismissed(f, [{ fingerprint: 'rule:r', until: null }], NOW)).toBe(true)
    expect(isDismissed(f, [{ fingerprint: 'r|e|s', until: D(1) }], NOW)).toBe(false)
  })
})

describe('triage (inspektorga taqsimlash)', () => {
  const finding = (id: string, district: string, tier: 'auto' | 'admin' = 'auto', priority = 1): FindingOut => ({
    ruleKey: 'collection.critical_untouched', category: 'collection', severity: 'critical', entityId: id, subjectKey: 'org',
    title: id, detail: '', fingerprint: `x|${id}|org`, entityName: id, districtId: district, districtName: null, tier, priority,
  })
  it('tuman inspektoriga, eng kam yuklanganiga; admin savollari yuborilmaydi', () => {
    const plan = planAutoTasks(
      [finding('e1', 'd1'), finding('e2', 'd1'), finding('e3', 'd2'), finding('e4', 'd1', 'admin')],
      new Set(),
      [{ id: 'i1', districtIds: ['d1'], openTasks: 5, botLinked: true }, { id: 'i2', districtIds: ['d1', 'd2'], openTasks: 0, botLinked: false }],
    )
    expect(plan.map(p => p.finding.entityId).sort()).toEqual(['e1', 'e2', 'e3'])
    expect(plan.find(p => p.finding.entityId === 'e3')!.assigneeId).toBe('i2')
  })
  it("mavjud topshiriq qayta yuborilmaydi; tumanida inspektor yo'q — o'tkaziladi; kunlik limit", () => {
    const fs = Array.from({ length: 15 }, (_, i) => finding(`e${i}`, 'd1'))
    const plan = planAutoTasks([...fs, finding('z', 'd9')], new Set(['x|e0|org']), [{ id: 'i1', districtIds: ['d1'], openTasks: 0, botLinked: true }], { perInspectorDaily: 10 })
    expect(plan).toHaveLength(10)
    expect(plan.some(p => p.finding.entityId === 'e0' || p.finding.entityId === 'z')).toBe(false)
  })
})

describe("tekshirish (savol yo'qolganda)", () => {
  const facts = (over = {}) => ({ entityStatus: 'active', paymentAfter: false, visitAfter: false, smsAfter: false, newPromise: null, ...over })
  it("va'da: to'lov → hal; yangi va'da → hal; hech narsa → shubhali", () => {
    expect(verifyDisappeared('collection.promise_broken', facts({ paymentAfter: true })).status).toBe('resolved')
    expect(verifyDisappeared('collection.promise_broken', facts({ newPromise: '2026-11-30' })).note).toContain('30.11.2026')
    expect(verifyDisappeared('collection.promise_broken', facts()).status).toBe('suspicious')
  })
  it("tashkilotni nofaol qilish qarz undirilgani emas → shubhali", () => {
    expect(verifyDisappeared('collection.critical_untouched', facts({ entityStatus: 'inactive' })).status).toBe('suspicious')
    expect(verifyDisappeared('data.debtor_no_phone', facts({ entityStatus: null })).status).toBe('suspicious')
  })
  it("ma'lumot savoli yo'qoldi → hal", () => {
    expect(verifyDisappeared('data.debtor_no_phone', facts()).status).toBe('resolved')
  })
})
