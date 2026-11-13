import { RULES, runRules, applyDismissals, diffFingerprints, fingerprintOf, ruleFingerprint, summarize, scoreVehicles, collapseThreshold } from './engine'
import type { Snapshot, VehicleSnap, MaintSnap, Rule } from './types'
import { fmtNum, fmtDate, uzDay } from './context'
import { isEnginePart, normalizePlate, isSoldNote } from './keywords'

const NOW = new Date('2026-11-13T07:00:00.000Z')
const DAY = 86400000
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)

function snap(p: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW,
    org: { gpsConnected: false, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'manual' },
    branches: [], vehicles: [], maintenance: [], engine: [], intervals: [], serviceRecords: [], fuel: [], dailyKm: [],
    fuelAnomalies: [], inspections: [], warranties: [], tires: [], tireDeductions: [], tireTrackingVehicleIds: [],
    inventory: [], receipts: [], shippedBatches: [], pendingRequests: [], pendingReturns: [], oldDebts: [], suppliers: [],
    waybills: [], expenses: [], budgets: [], fuelImports: [], fuelPrices: [],
    ...p,
  }
}

function veh(id: string, p: Partial<VehicleSnap> = {}): VehicleSnap {
  return {
    id, plate: `30 ${id} OBA`, brand: 'ISUZU', model: 'NPR', year: 2018, fuelType: 'diesel', branchId: 'b1',
    purchaseDate: new Date('2018-05-01'), mileage: 150000, status: 'active', notes: null,
    insuranceExpiry: new Date('2027-06-01'), techInspectionExpiry: new Date('2027-06-01'),
    gpsUnitName: null, lastGpsSignal: null, fuelNorm: 20, tankCapacity: 150, fuelSensorName: null, lastFuelUpdate: null,
    oilIntervalKm: null, createdAt: new Date('2025-01-01'), ...p,
  }
}

function maint(id: string, vehicleId: string, date: Date, p: Partial<MaintSnap> = {}): MaintSnap {
  return {
    id, vehicleId, date, mileage: 140000, cost: 500000, laborCost: 100000, workerName: 'Usta Karim', isOfficial: true,
    isPaid: true, status: 'approved', notes: null, isOil: false, createdAt: date, evidenceCount: 0, parts: [], ...p,
  }
}

const only = (s: Snapshot, key: string) => runRules(s, RULES.filter(r => r.key === key)).findings

describe('qoidalar registri', () => {
  it('126 ta qoida, raqamlar 1..126 va kalitlar takrorlanmaydi', () => {
    expect(RULES).toHaveLength(126)
    expect(RULES.map(r => r.no)).toEqual(Array.from({ length: 126 }, (_, i) => i + 1))
    expect(new Set(RULES.map(r => r.key)).size).toBe(126)
  })

  it("bo'sh tashkilotda hech bir qoida yiqilmaydi va savol bermaydi", () => {
    const res = runRules(snap())
    expect(res.ruleErrors).toEqual([])
    expect(res.findings).toEqual([])
  })

  it("to'liq ma'lumotli tashkilotda ham barcha qoidalar xatosiz ishlaydi", () => {
    const v = veh('574', { gpsUnitName: 'u1', lastGpsSignal: ago(0.1) })
    const s = snap({
      org: { gpsConnected: true, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'gps' },
      vehicles: [v, veh('575'), veh('576', { status: 'inactive' })],
      maintenance: [maint('m1', '574', ago(10), { parts: [{ sparePartId: 'p1', name: 'Porshen kolsa', category: 'engine', qty: 1, unitCost: 300000 }] })],
      fuel: [{ id: 'f1', vehicleId: '574', fuelType: 'diesel', liters: 50, cost: 600000, odometer: 0, date: ago(5), supplierId: null }],
      dailyKm: Array.from({ length: 40 }, (_, i) => ({ vehicleId: '574', day: uzDay(ago(i + 1)), km: 100 })),
    })
    expect(runRules(s).ruleErrors).toEqual([])
  })
})

describe('1-qoida: dvigatel detali o\'rnatilgan, pasportda yo\'q (kiritsa o\'chadi)', () => {
  const v = veh('574')
  const m = maint('m1', '574', new Date('2026-09-12T06:00:00Z'), {
    cost: 2_200_000, laborCost: 300_000,
    parts: [
      { sparePartId: 'p1', name: 'Porshen kolsa', category: 'engine', qty: 1, unitCost: 1_200_000 },
      { sparePartId: 'p2', name: 'Vkladish korennoy', category: 'engine', qty: 1, unitCost: 1_000_000 },
    ],
  })

  it('pasportda yozuv bo\'lmasa — savol beradi (2.5 mln → kritik)', () => {
    const fs = only(snap({ vehicles: [v], maintenance: [m] }), 'engine.parts_without_passport')
    expect(fs).toHaveLength(1)
    expect(fs[0].severity).toBe('critical')
    expect(fs[0].title).toContain('30 574 OBA')
    expect(fs[0].detail).toContain('12.09.2026')
    expect(fs[0].action.path).toBe('/engine-monitor')
  })

  it('pasportga ±30 kun ichida yozuv kiritilsa — savol yo\'qoladi', () => {
    const s = snap({
      vehicles: [v], maintenance: [m],
      engine: [{ id: 'e1', vehicleId: '574', type: 'overhaul', mileage: 140000, date: new Date('2026-09-20T06:00:00Z'), cost: 2_500_000, nextServiceMileage: null }],
    })
    expect(only(s, 'engine.parts_without_passport')).toHaveLength(0)
  })

  it('EGR/tormoz "klapan"i dvigatel ta\'miri deb hisoblanmaydi', () => {
    const m2 = maint('m2', '574', ago(20), { parts: [{ sparePartId: 'p3', name: 'Tormoz klapan', category: 'brake', qty: 1, unitCost: 200000 }] })
    expect(only(snap({ vehicles: [v], maintenance: [m2] }), 'engine.parts_without_passport')).toHaveLength(0)
  })

  it('rad etilgan ta\'mir hisobga olinmaydi', () => {
    expect(only(snap({ vehicles: [v], maintenance: [{ ...m, status: 'rejected' }] }), 'engine.parts_without_passport')).toHaveLength(0)
  })
})

describe('moy xizmati', () => {
  it('GPS langari bilan km bo\'yicha muddat o\'tganini to\'g\'ri hisoblaydi', () => {
    // Foydalanuvchi shkalasi: 100 000 km da almashtirilgan; Wialon odometri 50 000 → hozir 58 500 (8 500 yurgan)
    const v = veh('1', { mileage: 58500, gpsUnitName: 'u' })
    const s = snap({
      vehicles: [v],
      intervals: [{ vehicleId: '1', serviceType: 'oil_change', intervalKm: 7000, intervalDays: 180, warningKm: 500, lastServiceKm: 100000, lastServiceDate: ago(60), nextDueKm: 107000, nextDueDate: ago(-120), serviceOdometerKm: 50000 }],
    })
    const fs = only(s, 'service.oil_overdue_km')
    expect(fs).toHaveLength(1)
    expect(fs[0].title).toContain('1 500 km')
    expect(fs[0].severity).toBe('critical')
  })

  it("muddat o'tmagan bo'lsa jim", () => {
    const v = veh('1', { mileage: 52000, gpsUnitName: 'u' })
    const s = snap({
      vehicles: [v],
      intervals: [{ vehicleId: '1', serviceType: 'oil_change', intervalKm: 7000, intervalDays: 180, warningKm: 500, lastServiceKm: 100000, lastServiceDate: ago(20), nextDueKm: 107000, nextDueDate: ago(-160), serviceOdometerKm: 50000 }],
    })
    expect(only(s, 'service.oil_overdue_km')).toHaveLength(0)
  })
})

describe('shovqin qorovuli (collapse)', () => {
  it("mashinalarning ko'pchiligida bo'lsa — bitta umumiy savol", () => {
    const vehicles = Array.from({ length: 12 }, (_, i) => veh(String(100 + i)))
    const fs = only(snap({ vehicles }), 'service.no_oil_interval')
    expect(fs).toHaveLength(1)
    expect(fs[0].vehicleId).toBeNull()
    expect(fs[0].title).toContain('12 ta mashinada')
  })

  it("bir nechta mashinada bo'lsa — har biriga alohida savol", () => {
    const vehicles = Array.from({ length: 20 }, (_, i) => veh(String(100 + i)))
    const intervals = vehicles.slice(3).map(v => ({ vehicleId: v.id, serviceType: 'oil_change', intervalKm: 7000, intervalDays: 180, warningKm: 500, lastServiceKm: 0, lastServiceDate: ago(10), nextDueKm: 999999, nextDueDate: ago(-100), serviceOdometerKm: null }))
    const fs = only(snap({ vehicles, intervals }), 'service.no_oil_interval')
    expect(fs).toHaveLength(3)
    expect(fs.every(f => f.vehicleId)).toBe(true)
  })

  it('chegara kamida 10 ta', () => {
    expect(collapseThreshold(5)).toBe(10)
    expect(collapseThreshold(100)).toBe(60)
  })
})

describe('GPS qoidalari', () => {
  it('GPS ulanmagan tashkilotda jim', () => {
    const s = snap({ vehicles: [veh('1', { lastGpsSignal: ago(10) })] })
    expect(only(s, 'gps.not_linked')).toHaveLength(0)
    expect(only(s, 'gps.no_signal')).toHaveLength(0)
  })

  it('signal 7+ kun yo\'q — kritik', () => {
    const s = snap({
      org: { gpsConnected: true, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'gps' },
      vehicles: [veh('1', { gpsUnitName: 'u', lastGpsSignal: ago(8) })],
    })
    const fs = only(s, 'gps.no_signal')
    expect(fs).toHaveLength(1)
    expect(fs[0].severity).toBe('critical')
  })
})

describe("yoqilg'i qoidalari", () => {
  const gpsOrg = { gpsConnected: true, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'gps' }

  it("turgan mashinaga quyish: treker tirik, quyish atrofida 0 km → savol", () => {
    const v = veh('1', { gpsUnitName: 'u', lastGpsSignal: ago(0.1) })
    const fillDate = ago(20)
    // quyishdan ±3 kun tashqarida harakat bor (treker tirik), ichida yo'q
    const dailyKm = Array.from({ length: 60 }, (_, i) => ago(i + 1))
      .filter(d => Math.abs(d.getTime() - fillDate.getTime()) > 4 * DAY)
      .map(d => ({ vehicleId: '1', day: uzDay(d), km: 120 }))
    const s = snap({ org: gpsOrg, vehicles: [v], dailyKm, fuel: [{ id: 'f1', vehicleId: '1', fuelType: 'diesel', liters: 80, cost: 960000, odometer: 0, date: fillDate, supplierId: null }] })
    const fs = only(s, 'fuel.fuel_while_parked')
    expect(fs).toHaveLength(1)
    expect(fs[0].severity).toBe('critical')
    expect(fs[0].impactUzs).toBe(960000)
  })

  it("treker o'sha paytda o'lik bo'lsa — yolg'on signal bermaydi", () => {
    const v = veh('1', { gpsUnitName: 'u', lastGpsSignal: ago(0.1) })
    const fillDate = ago(20)
    const dailyKm = Array.from({ length: 5 }, (_, i) => ({ vehicleId: '1', day: uzDay(ago(i + 1)), km: 100 }))
    // eski kunlar ham keshda bor (boshqa mashina) — kesh oralig'i qamrab olinsin
    dailyKm.push({ vehicleId: '2', day: uzDay(ago(60)), km: 50 })
    const s = snap({ org: gpsOrg, vehicles: [v, veh('2', { gpsUnitName: 'u2' })], dailyKm, fuel: [{ id: 'f1', vehicleId: '1', fuelType: 'diesel', liters: 80, cost: 960000, odometer: 0, date: fillDate, supplierId: null }] })
    expect(only(s, 'fuel.fuel_while_parked')).toHaveLength(0)
  })

  it('normadan ortiq sarf va pul ta\'siri', () => {
    const v = veh('1', { fuelNorm: 20 })
    // odometr bo'yicha: 1000 km, birinchi quyishdan keyin 300 L → 30 L/100km
    const fuel = [
      { id: 'a', vehicleId: '1', fuelType: 'diesel', liters: 100, cost: 1_200_000, odometer: 10000, date: ago(25), supplierId: null },
      { id: 'b', vehicleId: '1', fuelType: 'diesel', liters: 150, cost: 1_800_000, odometer: 10500, date: ago(15), supplierId: null },
      { id: 'c', vehicleId: '1', fuelType: 'diesel', liters: 150, cost: 1_800_000, odometer: 11000, date: ago(5), supplierId: null },
    ]
    const fs = only(snap({ vehicles: [v], fuel }), 'fuel.over_norm')
    expect(fs).toHaveLength(1)
    expect(fs[0].title).toContain('50%')
    expect(fs[0].impactUzs).toBe(1_200_000) // 100 L ortiqcha × 12 000 so'm
  })

  it('odometr orqaga ketishi', () => {
    const fuel = [
      { id: 'a', vehicleId: '1', fuelType: 'diesel', liters: 50, cost: 0, odometer: 12000, date: ago(20), supplierId: null },
      { id: 'b', vehicleId: '1', fuelType: 'diesel', liters: 50, cost: 0, odometer: 11000, date: ago(10), supplierId: null },
    ]
    expect(only(snap({ vehicles: [veh('1')], fuel }), 'fuel.odometer_regress')).toHaveLength(1)
  })

  it('bakdan ko\'p quyish', () => {
    const fuel = [{ id: 'a', vehicleId: '1', fuelType: 'diesel', liters: 200, cost: 2_400_000, odometer: 0, date: ago(3), supplierId: null }]
    const fs = only(snap({ vehicles: [veh('1', { tankCapacity: 150 })], fuel }), 'fuel.over_tank')
    expect(fs).toHaveLength(1)
    expect(fs[0].impactUzs).toBe(600000)
  })
})

describe("ma'lumot to'liqligi", () => {
  it('takroriy davlat raqami (bo\'sh joy, kirill harflar)', () => {
    const fs = only(snap({ vehicles: [veh('1', { plate: '30 574 OBA' }), veh('2', { plate: '30574ОВА' })] }), 'data.duplicate_plate')
    expect(fs).toHaveLength(1)
  })

  it('"sotilgan" izohli faol mashina', () => {
    const fs = only(snap({ vehicles: [veh('1', { notes: '2026-yil sotildi' })] }), 'data.sold_but_active')
    expect(fs).toHaveLength(1)
  })
})

describe('byudjet', () => {
  it('oylik reja oshsa kritik savol', () => {
    const s = snap({
      vehicles: [veh('1')],
      budgets: [{ month: 11, category: 'fuel', amount: 1_000_000, branchId: null }],
      fuel: [{ id: 'a', vehicleId: '1', fuelType: 'diesel', liters: 100, cost: 1_500_000, odometer: 0, date: new Date('2026-11-05T06:00:00Z'), supplierId: null }],
    })
    const fs = only(s, 'budget.exceeded')
    expect(fs).toHaveLength(1)
    expect(fs[0].impactUzs).toBe(500000)
  })
})

describe('dvigatel infratuzilmasi', () => {
  it("xato qoida butun tahlilni yiqitmaydi", () => {
    const bad: Rule = { key: 'x.bad', no: 999, category: 'data', name: 'bad', run: () => { throw new Error('boom') } }
    const good: Rule = { key: 'x.good', no: 1000, category: 'data', name: 'good', run: (c) => [c.f({ ruleKey: 'x.good', category: 'data', severity: 'info', title: 't', detail: 'd', action: { label: 'l', path: '/' } })] }
    const res = runRules(snap(), [bad, good])
    expect(res.ruleErrors).toEqual([{ ruleKey: 'x.bad', error: 'boom' }])
    expect(res.findings).toHaveLength(1)
  })

  it('fingerprint barqaror', () => {
    expect(fingerprintOf({ ruleKey: 'a.b', vehicleId: 'v1', subjectKey: 'm1' })).toBe('a.b|v1|m1')
    expect(fingerprintOf({ ruleKey: 'a.b', vehicleId: null, subjectKey: '' })).toBe('a.b||')
  })

  it("yashirish: bitta savol, butun qoida, muddati o'tgani qaytadi", () => {
    const fs = [
      { fingerprint: 'r1|v1|', ruleKey: 'r1' },
      { fingerprint: 'r1|v2|', ruleKey: 'r1' },
      { fingerprint: 'r2|v1|', ruleKey: 'r2' },
      { fingerprint: 'r3|v1|', ruleKey: 'r3' },
    ]
    const res = applyDismissals(fs, [
      { fingerprint: 'r1|v1|', until: null },
      { fingerprint: ruleFingerprint('r2'), until: new Date(NOW.getTime() + DAY) },
      { fingerprint: 'r3|v1|', until: ago(1) }, // muddati o'tgan → yana ko'rinadi
    ], NOW)
    expect(res.visible.map(f => f.fingerprint)).toEqual(['r1|v2|', 'r3|v1|'])
    expect(res.hidden).toBe(2)
  })

  it('kechagi holat bilan solishtirish', () => {
    const d = diffFingerprints(['a', 'b', 'c'], ['b', 'c', 'd', 'e'])
    expect([...d.newSet]).toEqual(['a'])
    expect(d.resolved).toBe(2)
    expect(diffFingerprints(['a'], null)).toEqual({ newSet: new Set(), resolved: 0 })
  })

  it('xulosa va mashina reytingi', () => {
    const base = { category: 'fuel' as const, ruleKey: 'r', subjectKey: '', title: '', detail: '', action: { label: '', path: '' }, branchId: null }
    const fs = [
      { ...base, severity: 'critical' as const, vehicleId: 'v1', plate: 'A', fingerprint: '1', impactUzs: 100 },
      { ...base, severity: 'warning' as const, vehicleId: 'v2', plate: 'B', fingerprint: '2' },
      { ...base, severity: 'info' as const, vehicleId: 'v2', plate: 'B', fingerprint: '3' },
    ]
    const s = summarize(fs)
    expect(s).toMatchObject({ total: 3, critical: 1, warning: 1, info: 1, impactUzs: 100 })
    expect(s.byCategory.fuel).toBe(3)
    expect(scoreVehicles(fs).map(v => [v.plate, v.score])).toEqual([['A', 10], ['B', 4]])
  })
})

describe('tezlik', () => {
  it('120 mashinali katta tashkilot 3 soniyadan tez tahlil qilinadi', () => {
    const vehicles = Array.from({ length: 120 }, (_, i) => veh(String(1000 + i), { gpsUnitName: 'u', lastGpsSignal: ago(0.2), brand: i % 2 ? 'ISUZU' : 'MAN', model: 'X' }))
    const maintenance: MaintSnap[] = []
    const fuel: Snapshot['fuel'] = []
    const dailyKm: Snapshot['dailyKm'] = []
    for (const v of vehicles) {
      for (let k = 0; k < 40; k++) maintenance.push(maint(`${v.id}-m${k}`, v.id, ago(k * 27), { mileage: 150000 - k * 2000, parts: [{ sparePartId: `p${k % 15}`, name: k % 7 ? 'Kolodka' : 'Porshen', category: null, qty: 1, unitCost: 100000 + k * 1000 }] }))
      for (let k = 0; k < 60; k++) fuel.push({ id: `${v.id}-f${k}`, vehicleId: v.id, fuelType: 'diesel', liters: 60, cost: 720000, odometer: 150000 - k * 300, date: ago(k * 3), supplierId: null })
      for (let k = 1; k <= 130; k++) dailyKm.push({ vehicleId: v.id, day: uzDay(ago(k)), km: 80 + (k % 5) * 10 })
    }
    const s = snap({
      org: { gpsConnected: true, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'gps' },
      vehicles, maintenance, fuel, dailyKm,
    })
    const t0 = Date.now()
    const res = runRules(s)
    expect(res.ruleErrors).toEqual([])
    expect(Date.now() - t0).toBeLessThan(3000)
  })
})

describe('yordamchilar', () => {
  it('raqam va sana formati (kun.oy.yil, UTC+5)', () => {
    expect(fmtNum(1234567)).toBe('1 234 567')
    expect(fmtNum(12.345, 1)).toBe('12,3')
    expect(fmtDate(new Date('2026-09-11T20:00:00Z'))).toBe('12.09.2026')
  })

  it('dvigatel detali kalit so\'zlari (lotin/kirill)', () => {
    expect(isEnginePart('Porshen kolsa STD')).toBe(true)
    expect(isEnginePart('Поршневые кольца')).toBe(true)
    expect(isEnginePart('Вкладыши коренные')).toBe(true)
    expect(isEnginePart('Havo filtri')).toBe(false)
  })

  it('davlat raqami normallashtirish', () => {
    expect(normalizePlate('30 574 оба')).toBe('30574OBA')  // kirill fonetik
    expect(normalizePlate('30 574 ОВА')).toBe('30574OBA')  // kirill o'xshash harf
    expect(normalizePlate('30-574 OBA')).toBe('30574OBA')
  })

  it('sotilgan izohi', () => {
    expect(isSoldNote('Списан 2025')).toBe(true)
    expect(isSoldNote('Yangi akkumulyator')).toBe(false)
  })
})
