import { verifyResolution, gpsOdometerAt } from './verify'
import { tierOf } from './triage'
import type { Snapshot, VehicleSnap, MaintSnap, DailyKmSnap } from './types'
import { DEFAULT_THRESHOLDS } from './thresholds'
import { uzDay } from './context'

const NOW = new Date('2026-11-20T07:00:00.000Z')
const DAY = 86400000
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)
const SENT = ago(3) // savol 3 kun oldin yuborilgan

function snap(p: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW, thresholds: DEFAULT_THRESHOLDS,
    org: { gpsConnected: true, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'gps' },
    branches: [], vehicles: [], maintenance: [], pendingMaintenance: [], engine: [], intervals: [], serviceRecords: [], fuel: [], dailyKm: [],
    fuelAnomalies: [], inspections: [], warranties: [], tires: [], tireDeductions: [], tireTrackingVehicleIds: [],
    inventory: [], receipts: [], shippedBatches: [], pendingRequests: [], pendingReturns: [], oldDebts: [], suppliers: [],
    waybills: [], expenses: [], budgets: [], fuelImports: [], fuelPrices: [],
    ...p,
  }
}

function veh(p: Partial<VehicleSnap> = {}): VehicleSnap {
  return {
    id: 'v1', plate: '30 001 OBA', brand: 'ISUZU', model: 'NPR', year: 2018, fuelType: 'diesel', branchId: 'b1',
    purchaseDate: null, mileage: 150000, status: 'active', notes: null, insuranceExpiry: null, techInspectionExpiry: null,
    gpsUnitName: 'T1', lastGpsSignal: ago(0.1), fuelNorm: 20, tankCapacity: 150, fuelSensorName: null, lastFuelUpdate: null,
    oilIntervalKm: null, createdAt: new Date('2025-01-01'), ...p,
  }
}

function maint(p: Partial<MaintSnap> = {}): MaintSnap {
  return {
    id: 'm1', vehicleId: 'v1', date: ago(1), mileage: 149800, cost: 300000, laborCost: 50000, workerName: 'Usta', isOfficial: true,
    isPaid: true, status: 'approved', notes: null, isOil: false, createdAt: ago(1), evidenceCount: 1, parts: [], ...p,
  }
}

/** Oxirgi n kun har kuni `km` yurgan */
function gpsDays(n: number, km: number): DailyKmSnap[] {
  return Array.from({ length: n }, (_, i) => ({ vehicleId: 'v1', day: uzDay(ago(i)), km }))
}

const OIL = { ruleKey: 'service.oil_overdue_km', vehicleId: 'v1', sentAt: SENT }

describe('verifyResolution', () => {
  test('yangi yozuvsiz yo\'qolgan "ish bajarilganmi" savoli — shubhali', () => {
    const r = verifyResolution(OIL, snap({ vehicles: [veh()] }))
    expect(r.ok).toBe(false)
    expect(r.checks[0].text).toMatch(/yangi yozuv kiritilmagan/)
  })

  test('mashina "nofaol" qilib savol yo\'qotilgan — sababi aytiladi', () => {
    const r = verifyResolution(OIL, snap({ vehicles: [veh({ status: 'inactive' })] }))
    expect(r.ok).toBe(false)
    expect(r.checks[0].text).toMatch(/inactive/)
  })

  test('mavjud yozuvni tuzatish turidagi savol yozuvsiz yopilsa — tasdiqlanadi', () => {
    const r = verifyResolution({ ruleKey: 'repairs.no_mileage', vehicleId: 'v1', sentAt: SENT }, snap({ vehicles: [veh()] }))
    expect(r.ok).toBe(true)
  })

  test('yangi moy yozuvi, probeg GPS bilan mos — tasdiqlanadi', () => {
    // 2 kun oldin almashtirilgan; keyin 2 kun × 100 km → o'sha kuni ≈ 149 800
    const s = snap({
      vehicles: [veh()], dailyKm: gpsDays(30, 100),
      serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 149800, date: ago(2), cost: 400000, createdAt: ago(1) }],
    })
    const r = verifyResolution(OIL, s)
    expect(r.ok).toBe(true)
    expect(r.checks.some(c => /GPS bilan mos/.test(c.text))).toBe(true)
  })

  test('orqa sana bilan kiritilgan va GPS probegi mos emas — shubhali', () => {
    // Yozuvda 60 kun oldin 149 000 km deyilgan, GPS bo'yicha o'shanda ≈ 144 000 km
    const s = snap({
      vehicles: [veh()], dailyKm: gpsDays(100, 100),
      serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 149000, date: ago(60), cost: 400000, createdAt: ago(1) }],
    })
    const r = verifyResolution(OIL, s)
    expect(r.ok).toBe(false)
    expect(r.checks.some(c => !c.ok && /GPS bo'yicha/.test(c.text))).toBe(true)
    expect(r.checks.some(c => !c.ok && /oldinga qo'yilgan/.test(c.text))).toBe(true)
  })

  test("orqa sana, lekin GPS probegi tasdiqlaydi — o'tadi", () => {
    const s = snap({
      vehicles: [veh()], dailyKm: gpsDays(100, 100),
      serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 144000, date: ago(60), cost: 400000, createdAt: ago(1) }],
    })
    expect(verifyResolution(OIL, s).ok).toBe(true)
  })

  test('orqa sana, GPS yo\'q — shubhali', () => {
    const s = snap({
      vehicles: [veh({ gpsUnitName: null })],
      serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 149000, date: ago(30), cost: 400000, createdAt: ago(1) }],
    })
    expect(verifyResolution(OIL, s).ok).toBe(false)
  })

  test('probeg hozirgidan katta — shubhali', () => {
    const s = snap({
      vehicles: [veh({ gpsUnitName: null })],
      serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 158000, date: ago(1), cost: 400000, createdAt: ago(1) }],
    })
    const r = verifyResolution(OIL, s)
    expect(r.ok).toBe(false)
    expect(r.checks[0].text).toMatch(/hozirgi probegidan/)
  })

  test('tashkilot moyni ombordan chiqaradi, bu safar chiqarilmagan — shubhali', () => {
    const fromStock = maint({ id: 'old', vehicleId: 'v2', date: ago(40), createdAt: ago(40), isOil: true, parts: [{ sparePartId: 'p1', name: 'Moy', category: 'oil', qty: 7, unitCost: 50000 }] })
    const s = snap({
      vehicles: [veh({ gpsUnitName: null }), veh({ id: 'v2' })], maintenance: [fromStock],
      serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 149900, date: ago(1), cost: 400000, createdAt: ago(1) }],
    })
    const r = verifyResolution(OIL, s)
    expect(r.ok).toBe(false)
    expect(r.checks.some(c => /ombordan chiqarilmagan/.test(c.text))).toBe(true)
  })

  test("moy ombordan chiqarilgan bo'lsa — o'tadi", () => {
    const part = { sparePartId: 'p1', name: 'Moy', category: 'oil', qty: 7, unitCost: 50000 }
    const s = snap({
      vehicles: [veh({ gpsUnitName: null })],
      maintenance: [maint({ id: 'm9', isOil: true, date: ago(1), mileage: 149900, parts: [part] })],
      serviceRecords: [{ vehicleId: 'v1', serviceType: 'oil_change', km: 149900, date: ago(1), cost: 400000, createdAt: ago(1) }],
    })
    expect(verifyResolution(OIL, s).ok).toBe(true)
  })

  test('katta summa — har doim admin ko\'radi, chek yo\'qligi aytiladi', () => {
    const s = snap({
      vehicles: [veh({ gpsUnitName: null })],
      maintenance: [maint({ cost: 2_500_000, laborCost: 0, evidenceCount: 0 })],
    })
    const r = verifyResolution({ ruleKey: 'repairs.battery', vehicleId: 'v1', sentAt: SENT }, s)
    expect(r.ok).toBe(false)
    expect(r.checks.some(c => /chek\/rasm biriktirilmagan/.test(c.text))).toBe(true)
  })

  test('savol yuborilishidan oldingi yozuvlar hisobga olinmaydi', () => {
    const s = snap({ vehicles: [veh()], maintenance: [maint({ date: ago(10), createdAt: ago(10) })] })
    expect(verifyResolution({ ruleKey: 'repairs.battery', vehicleId: 'v1', sentAt: SENT }, s).ok).toBe(false)
  })
})

describe('gpsOdometerAt', () => {
  test('signal eski bo\'lsa — tekshirib bo\'lmaydi', () => {
    const v = veh({ lastGpsSignal: ago(10) })
    expect(gpsOdometerAt(snap({ vehicles: [v], dailyKm: gpsDays(30, 100) }), v, ago(5))).toBeNull()
  })
  test("kesh o'sha kunni qamramasa — null", () => {
    const v = veh()
    expect(gpsOdometerAt(snap({ vehicles: [v], dailyKm: gpsDays(10, 100) }), v, ago(50))).toBeNull()
  })
})

describe('tierOf', () => {
  const base = { vehicleId: 'v1', branchId: 'b1', impactUzs: 0 }
  test("ma'lumot yetishmaydi — robot yuboradi", () => expect(tierOf({ ...base, ruleKey: 'service.oil_overdue_km' })).toBe('auto'))
  test("yoqilg'i shubhasi — admin", () => expect(tierOf({ ...base, ruleKey: 'fuel.fuel_while_parked' })).toBe('admin'))
  test('katta pul — admin', () => expect(tierOf({ ...base, ruleKey: 'service.oil_overdue_km', impactUzs: 3_000_000 })).toBe('admin'))
  test("mashinaga bog'liq emas — admin", () => expect(tierOf({ ...base, vehicleId: null, ruleKey: 'service.oil_overdue_km' })).toBe('admin'))
  test("birlashgan savolda admin qoidasi bo'lsa — admin", () =>
    expect(tierOf({ ...base, ruleKey: 'service.oil_overdue_km', mergedFrom: ['fuel.over_norm'] })).toBe('admin'))
})
