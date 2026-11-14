import { buildReturnMap, netParts } from './partReturns'
import { runRules, RULES } from './engine'
import { DEFAULT_THRESHOLDS } from './thresholds'
import type { Snapshot, InventorySnap, MaintSnap } from './types'

const NOW = new Date('2026-11-14T07:00:00.000Z')
const ago = (d: number) => new Date(NOW.getTime() - d * 86400000)

describe("qaytarilgan qismlar", () => {
  const parts = [
    { sparePartId: 'p1', qty: 2, unitCost: 100, name: 'Porshen' },
    { sparePartId: 'p2', qty: 1, unitCost: 50, name: 'Prokladka' },
    { sparePartId: null, qty: 1, unitCost: 10, name: 'Mayda' },
  ]

  it("to'liq qaytarilgan qism ro'yxatdan chiqadi, summasi ayiriladi", () => {
    const map = buildReturnMap([{ maintenanceId: 'm1', sparePartId: 'p1', quantity: 2, unitCost: 100 }])
    const r = netParts('m1', parts, map)
    expect(r.parts.map(p => p.sparePartId)).toEqual(['p2', null])
    expect(r.returnedCost).toBe(200)
  })

  it('qisman qaytarilgani — soni kamayadi', () => {
    const map = buildReturnMap([{ maintenanceId: 'm1', sparePartId: 'p1', quantity: 1, unitCost: 100 }])
    expect(netParts('m1', parts, map).parts[0]).toMatchObject({ sparePartId: 'p1', qty: 1 })
  })

  it("boshqa ta'mirning qaytarishi ta'sir qilmaydi", () => {
    const map = buildReturnMap([{ maintenanceId: 'mX', sparePartId: 'p1', quantity: 2, unitCost: 100 }])
    expect(netParts('m1', parts, map).parts).toHaveLength(3)
  })
})

function inv(partId: string, p: Partial<InventorySnap> = {}): InventorySnap {
  return {
    partId, partName: `Qism ${partId}`, warehouseId: 'w1', warehouseName: 'Markaziy ombor', qty: 10, reorderLevel: 1, unitPrice: 100_000,
    lastRestockDate: null, lastArrival: ago(400), lastOutgoing: null, ...p,
  }
}
function maint(id: string, date: Date, partId: string, warehouseId: string | null = 'w1'): MaintSnap {
  return {
    id, vehicleId: 'v1', date, mileage: null, cost: 0, laborCost: 0, workerName: null, isOfficial: true, isPaid: true, status: 'approved',
    notes: null, isOil: false, createdAt: date, evidenceCount: 0, parts: [{ sparePartId: partId, name: partId, category: null, qty: 1, unitCost: 0, warehouseId }],
  }
}
function snap(inventory: InventorySnap[], maintenance: MaintSnap[] = []): Snapshot {
  return {
    now: NOW, thresholds: DEFAULT_THRESHOLDS,
    org: { gpsConnected: false, gpsSyncError: null, gpsTokenExpiresAt: null, oilIntervalKm: 7000, fuelDistanceMode: 'manual' },
    branches: [], vehicles: [], maintenance, pendingMaintenance: [], engine: [], intervals: [], serviceRecords: [], fuel: [], dailyKm: [],
    fuelAnomalies: [], inspections: [], warranties: [], tires: [], tireDeductions: [], tireTrackingVehicleIds: [],
    inventory, receipts: [], shippedBatches: [], pendingRequests: [], pendingReturns: [], oldDebts: [], suppliers: [],
    waybills: [], expenses: [], budgets: [], fuelImports: [], fuelPrices: [],
  }
}
const dead = (s: Snapshot) => runRules(s, RULES.filter(r => r.key === 'warehouse.dead_stock')).findings

describe('#100 harakatsiz qismlar', () => {
  it("haqiqatan harakatsiz qismlar ro'yxat bilan ko'rsatiladi", () => {
    const fs = dead(snap([inv('a'), inv('b', { qty: 3 })]))
    expect(fs).toHaveLength(1)
    expect(fs[0].evidenceLabel).toBe("Qismlar ro'yxati (2 ta)")
    expect(fs[0].evidence?.rows.map(r => r[0])).toEqual(['Qism a', 'Qism b']) // qiymat bo'yicha
    expect(fs[0].evidence?.rows[0][4]).toBe('ishlatilmagan')
  })

  it("yaqinda kelgan qism (kirim/transfer) harakatsiz deb hisoblanmaydi", () => {
    const fs = dead(snap([inv('a', { lastArrival: ago(20) }), inv('b'), inv('c', { qty: 1 })]))
    expect(fs[0].evidence?.rows.map(r => r[0])).toEqual(['Qism b', 'Qism c'])
  })

  it("6 oy ichida tasdiqlangan ta'mirda ishlatilgani chiqmaydi", () => {
    const fs = dead(snap([inv('a'), inv('b'), inv('c')], [maint('m1', ago(30), 'a')]))
    expect(fs[0].evidence?.rows.map(r => r[0])).toEqual(['Qism b', 'Qism c'])
  })

  it('boshqa ombordan ishlatilgan qism — bu omborda baribir harakatsiz', () => {
    const fs = dead(snap([inv('a'), inv('b'), inv('c')], [maint('m1', ago(30), 'a', 'w2')]))
    expect(fs[0].evidence?.rows).toHaveLength(3)
  })

  it("boshqa omborga o'tkazilgan qism chiqmaydi", () => {
    const fs = dead(snap([inv('a', { lastOutgoing: ago(10) }), inv('b'), inv('c')]))
    expect(fs[0].evidence?.rows.map(r => r[0])).toEqual(['Qism b', 'Qism c'])
  })

  it("rad etilgan ta'mir (snapshotga tushib qolsa ham) ishlatilgan deb hisoblanmaydi — dvigatel qoidasi", () => {
    const s = snap([])
    s.vehicles = [{
      id: 'v1', plate: '30 574 OBA', brand: 'X', model: 'Y', year: 2018, fuelType: 'diesel', branchId: 'b1', purchaseDate: null, mileage: 1, status: 'active',
      notes: null, insuranceExpiry: null, techInspectionExpiry: null, gpsUnitName: null, lastGpsSignal: null, fuelNorm: null, tankCapacity: null,
      fuelSensorName: null, lastFuelUpdate: null, oilIntervalKm: null, createdAt: ago(10),
    }]
    s.maintenance = [{ ...maint('m1', ago(20), 'p'), status: 'rejected', parts: [{ sparePartId: 'p', name: 'Porshen kolsa', category: null, qty: 1, unitCost: 0 }] }]
    expect(runRules(s, RULES.filter(r => r.key === 'engine.parts_without_passport')).findings).toHaveLength(0)
  })
})
