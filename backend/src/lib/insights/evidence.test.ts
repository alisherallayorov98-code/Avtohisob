// Har savolning manbasi va ishonch darajasi bo'lishi shart — admin savolga ko'r-ko'rona ishonmasin.
import * as fs from 'fs'
import * as path from 'path'
import { RULES, runRules } from './engine'
import { RULE_CONFIDENCE } from './confidence'
import type { Snapshot, VehicleSnap, MaintSnap, FuelSnap, ExpenseSnap } from './types'
import { DEFAULT_THRESHOLDS } from './thresholds'

const NOW = new Date('2026-11-20T07:00:00.000Z')
const DAY = 86400000
const ago = (d: number) => new Date(NOW.getTime() - d * DAY)

function snap(p: Partial<Snapshot> = {}): Snapshot {
  return {
    now: NOW, thresholds: DEFAULT_THRESHOLDS,
    org: { gpsConnected: false, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'manual' },
    branches: [], vehicles: [], maintenance: [], pendingMaintenance: [], engine: [], intervals: [], serviceRecords: [], fuel: [], dailyKm: [],
    fuelAnomalies: [], inspections: [], warranties: [], tires: [], tireDeductions: [], tireTrackingVehicleIds: [],
    inventory: [], receipts: [], shippedBatches: [], pendingRequests: [], pendingReturns: [], oldDebts: [], suppliers: [],
    waybills: [], expenses: [], budgets: [], fuelImports: [], fuelPrices: [],
    ...p,
  }
}
const veh = (id: string, p: Partial<VehicleSnap> = {}): VehicleSnap => ({
  id, plate: `30 ${id} OBA`, brand: 'ISUZU', model: 'NPR', year: 2018, fuelType: 'diesel', branchId: 'b1',
  purchaseDate: new Date('2018-05-01'), mileage: 150000, status: 'active', notes: null,
  insuranceExpiry: new Date('2027-06-01'), techInspectionExpiry: new Date('2027-06-01'),
  gpsUnitName: null, lastGpsSignal: null, fuelNorm: 20, tankCapacity: 150, fuelSensorName: null, lastFuelUpdate: null,
  oilIntervalKm: null, createdAt: new Date('2025-01-01'), ...p,
})
const maint = (id: string, vehicleId: string, date: Date, p: Partial<MaintSnap> = {}): MaintSnap => ({
  id, vehicleId, date, mileage: 140000, cost: 500000, laborCost: 100000, workerName: 'Usta', isOfficial: true,
  isPaid: true, status: 'approved', notes: null, isOil: false, createdAt: date, evidenceCount: 0, parts: [], ...p,
})
const fuel = (id: string, vehicleId: string, date: Date, p: Partial<FuelSnap> = {}): FuelSnap => ({
  id, vehicleId, fuelType: 'diesel', liters: 60, cost: 600000, odometer: 0, date, supplierId: null, ...p,
})
const exp = (id: string, vehicleId: string, date: Date, amount: number, category: string): ExpenseSnap => ({ id, vehicleId, amount, date, hasReceipt: false, category })

describe('ishonch darajasi reyestri', () => {
  test("har bir qoidaning ishonch darajasi va asosi bor", () => {
    const missing = RULES.filter(r => !RULE_CONFIDENCE[r.key]).map(r => r.key)
    expect(missing).toEqual([])
    for (const r of RULES) expect(RULE_CONFIDENCE[r.key][1].length).toBeGreaterThan(10)
  })
  test("reyestrda o'chirilgan qoida qolmagan", () => {
    const live = new Set(RULES.map(r => r.key))
    expect(Object.keys(RULE_CONFIDENCE).filter(k => !live.has(k))).toEqual([])
  })
})

describe('manba (dalil) majburiy', () => {
  // Statik qo'riqchi: qoida fayllaridagi har bir savol (c.f({...})) dalil bilan chiqariladi
  test("qoida fayllarida dalilsiz savol yo'q", () => {
    const dir = path.join(__dirname, 'rules')
    const bad: string[] = []
    for (const file of fs.readdirSync(dir).filter(f => f.endsWith('.ts'))) {
      const src = fs.readFileSync(path.join(dir, file), 'utf8')
      let at = src.indexOf('c.f({'), n = 0
      while (at >= 0) {
        n++
        // c.f({ ... }) chaqiruvining aniq chegarasi — qavslarni sanab topiladi
        let depth = 0, end = at + 3
        for (; end < src.length; end++) {
          if (src[end] === '{' || src[end] === '(') depth++
          else if (src[end] === '}' || src[end] === ')') { depth--; if (depth === 0) break }
        }
        if (!/\bevidence\s*:/.test(src.slice(at, end))) bad.push(`${file} #${n}`)
        at = src.indexOf('c.f({', end)
      }
    }
    expect(bad).toEqual([])
  })

  test('chiqqan barcha savollarda manba jadvali, ishonch va asos bor', () => {
    const vs = [
      veh('1', { insuranceExpiry: null }),
      veh('2', { insuranceExpiry: ago(10), fuelNorm: null }),
      veh('3', { tankCapacity: 100 }),
      veh('4', { year: 1900 }),
      veh('5', { brand: '', model: '' }),
      veh('6', { status: 'active', notes: 'sotilgan 2025' }),
    ]
    const s = snap({
      vehicles: vs,
      maintenance: [
        maint('m1', '1', ago(100), { parts: [{ sparePartId: 'p1', name: 'Disk stseplenie', category: null, qty: 1, unitCost: 900000 }] }),
        maint('m2', '1', ago(20), { parts: [{ sparePartId: 'p1', name: 'Disk stseplenie', category: null, qty: 1, unitCost: 900000 }] }),
        maint('m3', '2', ago(5), { date: new Date(NOW.getTime() + 5 * DAY) }),
        maint('m4', '3', ago(40), { isPaid: false }),
      ],
      fuel: [fuel('f1', '3', ago(10), { liters: 140 }), fuel('f2', '2', ago(3), { fuelType: 'petrol' })],
      expenses: [exp('e1', '2', ago(10), 2_000_000, 'Shtraf'), exp('e2', '2', ago(60), 300_000, 'Yuvish'), exp('e3', '2', ago(90), 300_000, 'Yuvish')],
    })
    const { findings, ruleErrors } = runRules(s)
    expect(ruleErrors).toEqual([])
    expect(findings.length).toBeGreaterThan(8)
    for (const f of findings) {
      expect({ rule: f.ruleKey, hasRows: (f.evidence?.rows.length || 0) > 0 || !!f.evidence?.note }).toEqual({ rule: f.ruleKey, hasRows: true })
      expect(['fact', 'strong', 'guess']).toContain(f.confidence)
      expect(f.basis).toBeTruthy()
    }
  })
})

describe('stseplenie qoidasi (taxmin — aniqlashtirilgan)', () => {
  const clutch = RULES.filter(r => r.key === 'repairs.clutch_repeat')
  const part = (name: string, unitCost = 800000) => ({ sparePartId: 'p', name, category: null, qty: 1, unitCost })

  test("bir hafta ichidagi yozuvlar bitta ish deb sanaladi", () => {
    const s = snap({
      vehicles: [veh('1')],
      maintenance: [maint('a', '1', ago(30), { parts: [part('Korzinka stseplenie')] }), maint('b', '1', ago(27), { parts: [part('Vyzhimnoy podshipnik')] })],
    })
    expect(runRules(s, clutch).findings).toHaveLength(0)
  })

  test("pul ta'siri — faqat stseplenie qismlari, so'zlar belgilanadi, km oraliq ko'rsatiladi", () => {
    const s = snap({
      vehicles: [veh('1')],
      maintenance: [
        maint('a', '1', ago(150), { mileage: 120000, cost: 3_000_000, parts: [part('Disk stseplenie', 700000), part('Generator', 2_300_000)] }),
        maint('b', '1', ago(20), { mileage: 135000, parts: [part('Disk stseplenie', 700000)] }),
      ],
    })
    const [f] = runRules(s, clutch).findings
    expect(f.impactUzs).toBe(1_400_000)
    expect(f.detail).toMatch(/15 000 km/)
    expect(f.evidence?.highlight).toContain('stseplenie')
    expect(f.confidence).toBe('guess')
    expect(f.title).not.toMatch(/haydovchi/i)
  })
})

describe('xarajat oshishi — qaysi kategoriya', () => {
  test('sarlavhada asosiy kategoriya, manbada xarajatlar ro\'yxati', () => {
    const s = snap({
      vehicles: [veh('1')],
      expenses: [
        exp('e1', '1', ago(5), 1_500_000, 'Shtraf'), exp('e2', '1', ago(8), 200_000, 'Yuvish'),
        exp('e3', '1', ago(45), 250_000, 'Yuvish'), exp('e4', '1', ago(75), 250_000, 'Yuvish'), exp('e5', '1', ago(105), 250_000, 'Yuvish'),
      ],
    })
    const [f] = runRules(s, RULES.filter(r => r.key === 'budget.expense_spike')).findings
    expect(f.title).toMatch(/Shtraf/)
    expect(f.evidence?.rows[0]).toEqual(expect.arrayContaining(['Shtraf']))
    expect(f.evidence?.refs?.[0]).toEqual({ kind: 'expense', id: 'e1' })
  })
})
