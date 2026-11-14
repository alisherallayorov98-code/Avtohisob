import { answerQuestion, EXAMPLES, parsePeriod, findVehicles, normalizeQuery } from './ask'
import { buildDossier } from './dossier'
import { buildCtx, uzDay } from './context'
import { runRules, RULES, mergeFindings, computePriority, applyDismissals, ruleFingerprint } from './engine'
import { DEFAULT_THRESHOLDS, mergeThresholds, diffFromDefaults } from './thresholds'
import type { Snapshot, VehicleSnap, MaintSnap, FindingOut } from './types'

const NOW = new Date('2026-11-14T07:00:00.000Z')
const DAY = 86400000
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)

function veh(id: string, plate: string, p: Partial<VehicleSnap> = {}): VehicleSnap {
  return {
    id, plate, brand: 'ISUZU', model: 'NPR', year: 2018, fuelType: 'diesel', branchId: 'b1',
    purchaseDate: new Date('2018-05-01'), mileage: 150000, status: 'active', notes: null,
    insuranceExpiry: ago(-10), techInspectionExpiry: ago(-200), gpsUnitName: 'u', lastGpsSignal: ago(0.1),
    fuelNorm: 20, tankCapacity: 150, fuelSensorName: null, lastFuelUpdate: null, oilIntervalKm: null, createdAt: new Date('2025-01-01'), ...p,
  }
}
function maint(id: string, vehicleId: string, date: Date, names: string[], p: Partial<MaintSnap> = {}): MaintSnap {
  return {
    id, vehicleId, date, mileage: 140000, cost: 800000, laborCost: 200000, workerName: 'Usta Karim', isOfficial: true, isPaid: true,
    status: 'approved', notes: null, isOil: false, createdAt: date, evidenceCount: 0,
    parts: names.map((n, i) => ({ sparePartId: `p-${n}`, name: n, category: null, qty: 1 + i, unitCost: 300000 })), ...p,
  }
}

/** Uchta mashina, barcha turdagi ma'lumot bilan — namunalar uchun real o'xshash fikstura */
function fixture(): Snapshot {
  const vehicles = [veh('v1', '30 574 OBA'), veh('v2', '30 575 OBA', { brand: 'MAN', model: 'TGS' }), veh('v3', '01 123 AAA', { status: 'inactive' })]
  const fuel: Snapshot['fuel'] = []
  const dailyKm: Snapshot['dailyKm'] = []
  for (const v of vehicles.slice(0, 2)) {
    for (let k = 0; k < 40; k++) fuel.push({ id: `${v.id}-f${k}`, vehicleId: v.id, fuelType: 'diesel', liters: 70, cost: 840000, odometer: 150000 - k * 300, date: ago(k * 4 + 1), supplierId: null })
    for (let k = 1; k <= 120; k++) dailyKm.push({ vehicleId: v.id, day: uzDay(ago(k)), km: 90 })
  }
  return {
    now: NOW,
    thresholds: DEFAULT_THRESHOLDS,
    org: { gpsConnected: true, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'gps' },
    branches: [{ id: 'b1', name: 'Markaz', managerId: null }],
    vehicles,
    pendingMaintenance: [],
    maintenance: [
      maint('m1', 'v1', new Date('2026-09-12T06:00:00Z'), ['Porshen kolsa', 'Vkladish']),
      maint('m2', 'v1', ago(20), ['Kolodka old', 'Akkumulyator 190']),
      maint('m3', 'v2', ago(5), ['Havo filtri', 'Moy filtri', 'Stseplenie disk']),
      maint('m4', 'v2', ago(40), ['Kolodka orqa']),
    ],
    engine: [{ id: 'e1', vehicleId: 'v2', type: 'overhaul', mileage: 120000, date: ago(300), cost: 9_000_000, nextServiceMileage: null }],
    intervals: [{ vehicleId: 'v1', serviceType: 'oil_change', intervalKm: 7000, intervalDays: 180, warningKm: 500, lastServiceKm: 142000, lastServiceDate: ago(60), nextDueKm: 149000, nextDueDate: ago(-120), serviceOdometerKm: null }],
    serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 142000, date: ago(60), cost: 450000 }],
    fuel, dailyKm,
    fuelAnomalies: [], inspections: [{ vehicleId: 'v1', date: ago(10), overall: 'ok', brakes: 'ok' }],
    warranties: [], tires: [{ id: 't1', serial: 'S1', vehicleId: 'v1', status: 'installed', position: 'Old chap', installedMileageKm: 90000, removedDate: null, actualMileageUsed: null, standardMileageKm: 50000, purchasePrice: 2_000_000, purchaseDate: ago(400), dotCode: null }],
    tireDeductions: [], tireTrackingVehicleIds: [], inventory: [], receipts: [], shippedBatches: [], pendingRequests: [], pendingReturns: [],
    oldDebts: [], suppliers: [],
    waybills: [{ id: 'w1', number: 'WB-1', vehicleId: 'v1', status: 'completed', plannedDeparture: ago(3), actualDeparture: ago(3), actualReturn: ago(2), departureOdometer: 1000, returnOdometer: 1200, fuelIssued: 0, mechanicApproved: true, createdAt: ago(3) }],
    expenses: [{ id: 'x1', vehicleId: 'v1', amount: 300000, date: ago(3), hasReceipt: true, category: 'Yuvish' }],
    budgets: [], fuelImports: [], fuelPrices: [],
  }
}

function ask(q: string, s = fixture()) {
  const c = buildCtx(s)
  const findings = runRules(s).findings.map(f => ({ ...f, priority: computePriority(f) }))
  return answerQuestion(q, c, findings)
}

describe('savol-javob: namunalar', () => {
  it("100 dan ortiq namuna bor va HAR BIRI tushuniladi", () => {
    expect(EXAMPLES.length).toBeGreaterThanOrEqual(100)
    const failed: string[] = []
    for (const e of EXAMPLES) {
      const a = ask(e.q.replace('{plate}', '30 574 OBA'))
      if (!a.understood || a.intent === 'unknown' || a.intent === 'clarify') failed.push(`${e.q} → ${a.intent}`)
    }
    expect(failed).toEqual([])
  })
})

describe('savol-javob: aniq javoblar', () => {
  it("\"30 574 OBA qachon motor remont bo'lgan?\" — pasportda yo'q ta'mirni ko'rsatadi", () => {
    const a = ask("30 574 OBA qachon motor remont bo'lgan?")
    expect(a.intent).toBe('v_engine')
    expect(a.vehicleId).toBe('v1')
    expect(a.text).toContain("pasportga kiritilmagan")
    expect(a.table?.rows.some(r => r.includes("Pasportda YO'Q"))).toBe(true)
  })

  it('kirill yozuvda ham tushunadi', () => {
    const a = ask('30 574 ОБА мотор қачон ремонт бўлган')
    expect(a.intent).toBe('v_engine')
    expect(a.vehicleId).toBe('v1')
  })

  it("faqat raqamning bir qismi yozilsa ham topadi (574)", () => {
    expect(ask('574 moyi qachon almashtirilgan').vehicleId).toBe('v1')
  })

  it("bir nechta mashina mos kelsa aniqlashtirishni so'raydi", () => {
    const a = ask('3057 moyi')
    expect(a.intent).toBe('clarify')
    expect(a.suggestions?.length).toBe(2)
  })

  it("qism bo'yicha: kolodka qachon almashtirilgan", () => {
    const a = ask('30 574 OBA kolodka qachon almashtirilgan?')
    expect(a.intent).toBe('v_part')
    expect(a.text).toContain('Kolodka old')
  })

  it("davr so'zlari sonni mashina raqami deb olmaydi", () => {
    const a = ask("Eng kam yurgan 10 ta mashina")
    expect(a.intent).toBe('f_least_km')
  })

  it("\"yoqilg'i ketdi\" — qism sarfi emas, jami xarajat", () => {
    expect(ask("O'tgan oy qancha yoqilg'i ketdi?").intent).toBe('f_totals')
  })

  it('filtr sarfi — qism bo\'yicha', () => {
    expect(ask('Oxirgi 3 oyda filtr sarfi').intent).toBe('f_part_usage')
  })

  it('tushunilmagan savolga taxmin bilan javob bermaydi', () => {
    const a = ask('ob-havo qanday bugun')
    expect(a.understood).toBe(false)
    expect(a.suggestions?.length).toBeGreaterThan(0)
  })

  it("noma'lum raqam — mashina topilmadi deb aytadi", () => {
    const a = ask('99 999 ZZZ nima gap')
    expect(a.understood).toBe(false)
    expect(a.text).toContain('topilmadi')
  })
})

describe('davr va mashina aniqlash', () => {
  it('davrlar', () => {
    expect(parsePeriod('bu oy', NOW)?.label).toBe('bu oy')
    expect(parsePeriod("o'tgan oy", NOW)?.from.toISOString()).toBe('2026-09-30T19:00:00.000Z')
    expect(parsePeriod('oxirgi 30 kunda', NOW)?.label).toBe('oxirgi 30 kun')
    expect(parsePeriod('aprel oyida', NOW)?.from.toISOString()).toBe('2026-03-31T19:00:00.000Z')
    expect(parsePeriod('dekabr', NOW)?.from.getUTCFullYear()).toBe(2025)
    expect(parsePeriod('2 marta almashtirilgan', NOW)).toBeNull() // "marta" mart oyi emas
  })

  it('mashina: bo\'sh joysiz, kichik harf', () => {
    const vs = fixture().vehicles
    expect(findVehicles(normalizeQuery('30574oba sarfi'), vs).map(v => v.id)).toEqual(['v1'])
    expect(findVehicles(normalizeQuery('oxirgi 30 kun'), vs)).toEqual([])
  })
})

describe('birlashtirish va ustuvorlik', () => {
  const base = { category: 'fuel' as const, subjectKey: '', action: { label: '', path: '' }, plate: 'A', branchId: null, detail: 'd' }
  it("bir mashinadagi yoqilg'i sarfi savollari bittaga birlashadi, pul ta'siri qo'shilmaydi", () => {
    const xs: FindingOut[] = [
      { ...base, ruleKey: 'fuel.over_norm', severity: 'warning', vehicleId: 'v1', title: 'norma', fingerprint: 'a', impactUzs: 500 },
      { ...base, ruleKey: 'fuel.above_own_avg', severity: 'critical', vehicleId: 'v1', title: "o'rtacha", fingerprint: 'b', impactUzs: 300 },
      { ...base, ruleKey: 'fuel.over_norm', severity: 'warning', vehicleId: 'v2', title: 'boshqa', fingerprint: 'c' },
    ]
    const groups = new Map(RULES.filter(r => r.mergeGroup).map(r => [r.key, r.mergeGroup!]))
    const out = mergeFindings(xs, groups)
    expect(out).toHaveLength(2)
    const merged = out.find(f => f.vehicleId === 'v1')!
    expect(merged.title).toBe("o'rtacha") // eng og'iri asosiy
    expect(merged.fingerprint).toBe('merge:fuel-consumption|v1')
    expect(merged.extra).toHaveLength(1)
    expect(merged.impactUzs).toBe(500)
  })

  it('birlashtirilgan savol — barcha qoidalari yashirilgandagina yashirinadi', () => {
    const f = { fingerprint: 'merge:g|v1', ruleKey: 'r1', mergedFrom: ['r1', 'r2'] }
    expect(applyDismissals([f], [{ fingerprint: ruleFingerprint('r1'), until: null }], NOW).visible).toHaveLength(1)
    expect(applyDismissals([f], [{ fingerprint: ruleFingerprint('r1'), until: null }, { fingerprint: ruleFingerprint('r2'), until: null }], NOW).visible).toHaveLength(0)
  })

  it("ustuvorlik: kritik > pul > yangi; topshirilgani pastga tushadi", () => {
    const crit = computePriority({ severity: 'critical', vehicleId: 'v' })
    const warnMoney = computePriority({ severity: 'warning', impactUzs: 50_000_000, vehicleId: 'v' })
    expect(crit).toBeGreaterThan(warnMoney)
    expect(computePriority({ severity: 'warning', isNew: true, vehicleId: 'v' })).toBeGreaterThan(computePriority({ severity: 'warning', vehicleId: 'v' }))
    const delegated = computePriority({ severity: 'critical', vehicleId: 'v', assignment: { id: '1', assigneeId: 'u', assigneeName: null, dueDate: null, overdue: false, note: null } })
    const overdue = computePriority({ severity: 'critical', vehicleId: 'v', assignment: { id: '1', assigneeId: 'u', assigneeName: null, dueDate: null, overdue: true, note: null } })
    expect(delegated).toBeLessThan(crit)
    expect(overdue).toBeGreaterThan(crit)
  })
})

describe('tez javob formasi va dalil', () => {
  it("1-qoida: pasportga kiritish formasi ta'mir ma'lumoti bilan oldindan to'ldiriladi", () => {
    const f = runRules(fixture(), RULES.filter(r => r.key === 'engine.parts_without_passport')).findings[0]
    expect(f.quick).toMatchObject({ kind: 'engine_record', prefill: { date: '2026-09-12', mileage: 140000 } })
    expect(f.evidence?.rows.map(r => r[0])).toEqual(['Porshen kolsa', 'Vkladish'])
  })
})

describe('chegaralar', () => {
  it("noto'g'ri qiymatlar rad etiladi, to'g'rilari qabul qilinadi", () => {
    const t = mergeThresholds({ fuelOverNormPct: '35', gpsNoSignalDays: 999, idleDays: -1, foo: 1 })
    expect(t.fuelOverNormPct).toBe(35)
    expect(t.gpsNoSignalDays).toBe(DEFAULT_THRESHOLDS.gpsNoSignalDays)
    expect(t.idleDays).toBe(DEFAULT_THRESHOLDS.idleDays)
    expect(diffFromDefaults(t)).toEqual({ fuelOverNormPct: 35 })
  })

  it("chegara o'zgarsa qoida natijasi o'zgaradi", () => {
    const s = fixture()
    s.vehicles[0].lastGpsSignal = ago(4)
    const key = RULES.filter(r => r.key === 'gps.no_signal')
    expect(runRules(s, key).findings).toHaveLength(1)
    expect(runRules({ ...s, thresholds: { ...DEFAULT_THRESHOLDS, gpsNoSignalDays: 5 } }, key).findings).toHaveLength(0)
  })
})

describe('mashina dosyesi', () => {
  it("vaqt chizig'i, oylik qatorlar va solishtirish", () => {
    const s = fixture()
    const d = buildDossier(buildCtx(s), 'v1', [])!
    expect(d.vehicle.plate).toBe('30 574 OBA')
    expect(d.monthly).toHaveLength(12)
    expect(d.timeline[0].date >= d.timeline[d.timeline.length - 1].date).toBe(true)
    expect(d.timeline.some(e => e.kind === 'repair' && e.flag === 'warning')).toBe(true) // porshen
    expect(d.metrics.find(m => m.label.startsWith('Oxirgi 30'))?.value).toBe(2700)
    expect(buildDossier(buildCtx(s), 'yoq', [])).toBeNull()
  })
})

describe("filialga so'rov va ustuvorlik", () => {
  const req = (status: 'open' | 'answered', overdue = false) => ({ id: 'r', status, branchId: 'b', branchName: null, dueDate: null, overdue, answer: null })
  it("javob kutilayotgan savol pastga, muddati o'tgani va javob kelgani yuqoriga", () => {
    const base = computePriority({ severity: 'warning', vehicleId: 'v' })
    expect(computePriority({ severity: 'warning', vehicleId: 'v', request: req('open') })).toBeLessThan(base)
    expect(computePriority({ severity: 'warning', vehicleId: 'v', request: req('open', true) })).toBeGreaterThan(base)
    expect(computePriority({ severity: 'warning', vehicleId: 'v', request: req('answered') })).toBeGreaterThan(base)
  })
})
