// Tahlil uchun tashkilot ma'lumotlarini BIR MARTA yig'adi va pure Snapshot'ga aylantiradi.
// Tenant izolatsiya: hamma narsa aniq ro'yxat bilan cheklanadi — branchIds, ulardan olingan
// vehicleIds, orgId, warehouseIds. `organizationId: null` OR pattern ISHLATILMAYDI.
import { prisma } from '../lib/prisma'
import { getOrgWarehouseIds } from '../lib/orgFilter'
import type { Snapshot } from '../lib/insights/types'
import { mergeThresholds } from '../lib/insights/thresholds'
import { buildReturnMap, netParts } from '../lib/insights/partReturns'

const DAY = 86400000
const n = (x: any): number => (x == null ? 0 : Number(x) || 0)
const nn = (x: any): number | null => (x == null ? null : Number(x))
const d = (x: any): Date | null => (x ? new Date(x) : null)

/**
 * @param orgId    tashkilot id (Branch.organizationId ?? Branch.id)
 * @param branchIds shu so'rov ko'radigan filiallar (org yoki toraytirilgan filial)
 */
export async function loadInsightSnapshot(orgId: string, branchIds: string[], now = new Date()): Promise<Snapshot> {
  const db = prisma as any
  const ago = (days: number) => new Date(now.getTime() - days * DAY)

  const vehiclesRaw = branchIds.length
    ? await db.vehicle.findMany({
      where: { branchId: { in: branchIds } },
      select: {
        id: true, registrationNumber: true, brand: true, model: true, year: true, fuelType: true, branchId: true,
        purchaseDate: true, mileage: true, status: true, notes: true, insuranceExpiry: true, techInspectionExpiry: true,
        gpsUnitName: true, lastGpsSignal: true, fuelNormPer100km: true, tankCapacity: true, fuelSensorName: true,
        lastFuelUpdate: true, oilIntervalKm: true, createdAt: true,
      },
    })
    : []
  const vids: string[] = vehiclesRaw.map((v: any) => v.id)
  const inV = { in: vids }

  const warehouseIds = branchIds.length ? (await getOrgWarehouseIds({ type: 'org', orgBranchIds: branchIds })) || [] : []
  const orgUsers = branchIds.length
    ? await db.user.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })
    : []
  const userIds = orgUsers.map((u: any) => u.id)

  const empty = Promise.resolve([] as any[])
  const [
    branches, maintenance, engine, intervals, serviceRecords, fuel, dailyKm, fuelAnomalies, inspections,
    warranties, tires, tireTracking, inventory, receipts, shippedBatches, pendingRequests, pendingReturns,
    oldDebts, suppliers, waybills, expenses, budgets, fuelImports, fuelPrices, orgSettings, gpsCred, insightSettings,
    returnedItems, arrivalReceipts, transfersIn, transfersOut,
  ] = await Promise.all([
    db.branch.findMany({ where: { id: { in: branchIds } }, select: { id: true, name: true, managerId: true } }),
    vids.length ? db.maintenanceRecord.findMany({
      where: { vehicleId: inV, installationDate: { gte: ago(3 * 365) }, status: { in: ['approved', 'pending_approval'] } },
      select: {
        sourceWarehouseId: true,
        id: true, vehicleId: true, installationDate: true, installationMileage: true, cost: true, laborCost: true,
        workerName: true, isOfficial: true, isPaid: true, status: true, notes: true, isOil: true, createdAt: true,
        quantityUsed: true, sparePartId: true,
        sparePart: { select: { name: true, category: true } },
        items: { select: { sparePartId: true, warehouseId: true, quantityUsed: true, unitCost: true, sparePart: { select: { name: true, category: true } } } },
        _count: { select: { evidence: true } },
      },
    }) : empty,
    vids.length ? db.engineRecord.findMany({ where: { vehicleId: inV }, select: { id: true, vehicleId: true, recordType: true, mileage: true, date: true, cost: true, nextServiceMileage: true } }) : empty,
    vids.length ? db.serviceInterval.findMany({ where: { vehicleId: inV } }) : empty,
    vids.length ? db.serviceRecord.findMany({
      where: { vehicleId: inV, servicedAt: { gte: ago(3 * 365) } },
      select: { vehicleId: true, serviceType: true, servicedAtKm: true, servicedAt: true, cost: true },
    }) : empty,
    vids.length ? db.fuelRecord.findMany({
      where: { vehicleId: inV, refuelDate: { gte: ago(180) } },
      select: { id: true, vehicleId: true, fuelType: true, amountLiters: true, cost: true, odometerReading: true, refuelDate: true, supplierId: true },
    }) : empty,
    vids.length ? db.vehicleDailyKm.findMany({ where: { vehicleId: inV, date: { gte: ago(130) } }, select: { vehicleId: true, date: true, km: true } }) : empty,
    vids.length ? db.fuelReading.findMany({
      where: { vehicleId: inV, capturedAt: { gte: ago(30) }, anomaly: { in: ['theft', 'unrecorded_refuel'] } },
      select: { vehicleId: true, anomaly: true, deltaL: true, capturedAt: true },
      orderBy: { capturedAt: 'asc' },
    }).catch(() => []) : empty,
    vids.length ? db.techInspection.findMany({
      where: { vehicleId: inV, inspectionDate: { gte: ago(365) } },
      select: { vehicleId: true, inspectionDate: true, overallStatus: true, brakes: true },
    }) : empty,
    vids.length ? db.warranty.findMany({ where: { vehicleId: inV }, select: { id: true, vehicleId: true, partName: true, startDate: true, endDate: true, status: true } }) : empty,
    db.tire.findMany({
      where: { OR: [...(vids.length ? [{ vehicleId: inV }] : []), { branchId: { in: branchIds } }] },
      select: {
        id: true, serialCode: true, vehicleId: true, status: true, position: true, installedMileageKm: true, removedDate: true,
        actualMileageUsed: true, standardMileageKm: true, purchasePrice: true, purchaseDate: true, dotCode: true,
        tireDeductions: { select: { id: true, vehicleId: true, isSettled: true, createdAt: true, deductionAmount: true } },
      },
    }),
    vids.length ? db.tireTracking.findMany({ where: { vehicleId: inV }, select: { vehicleId: true }, distinct: ['vehicleId'] }) : empty,
    warehouseIds.length ? db.inventory.findMany({
      where: { warehouseId: { in: warehouseIds } },
      select: {
        sparePartId: true, warehouseId: true, quantityOnHand: true, reorderLevel: true, lastRestockDate: true, createdAt: true,
        sparePart: { select: { name: true, unitPrice: true } }, warehouse: { select: { name: true } },
      },
    }) : empty,
    warehouseIds.length ? db.inventoryReceipt.findMany({
      where: { warehouseId: { in: warehouseIds }, createdAt: { gte: ago(90) } },
      select: { id: true, isOfficial: true, invoiceNumber: true, createdAt: true },
    }) : empty,
    db.transferBatch.findMany({ where: { orgId, status: 'shipped' }, select: { id: true, documentNumber: true, status: true, shippedAt: true, createdAt: true } }),
    db.sparePartRequest.findMany({ where: { orgId, status: 'pending' }, select: { id: true, documentNumber: true, status: true, createdAt: true } }),
    db.sparePartReturn.findMany({ where: { branchId: { in: branchIds }, status: 'pending_approval' }, select: { id: true, status: true, createdAt: true }, orderBy: { createdAt: 'asc' } }),
    vids.length ? db.oldPartDebt.findMany({
      where: { vehicleId: inV, status: 'open' },
      select: { id: true, vehicleId: true, sparePartName: true, workerName: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    }) : empty,
    db.supplier.findMany({
      where: { organizationId: orgId, isActive: true },
      select: { id: true, name: true, payments: { select: { amount: true, type: true, paymentDate: true } } },
    }),
    db.waybill.findMany({
      where: {
        branchId: { in: branchIds },
        OR: [{ plannedDeparture: { gte: ago(120) } }, { status: { in: ['draft', 'active'] } }],
      },
      select: {
        id: true, number: true, vehicleId: true, status: true, plannedDeparture: true, actualDeparture: true, actualReturn: true,
        departureOdometer: true, returnOdometer: true, fuelIssued: true, mechanicApproved: true, createdAt: true,
      },
    }),
    vids.length ? db.expense.findMany({
      where: { vehicleId: inV, expenseDate: { gte: ago(180) } },
      select: { id: true, vehicleId: true, amount: true, expenseDate: true, receiptUrl: true, category: { select: { name: true } } },
    }) : empty,
    db.budgetPlan.findMany({
      where: { orgId, year: new Date(now.getTime() + 5 * 3600 * 1000).getUTCFullYear() },
      select: { month: true, category: true, amount: true, branchId: true },
    }),
    userIds.length ? db.fuelImport.findMany({
      where: { createdById: { in: userIds }, status: 'draft' },
      select: { id: true, title: true, status: true, createdAt: true, _count: { select: { rows: { where: { vehicleId: null } } } } },
    }) : empty,
    db.fuelPriceHistory.findMany({ where: { organizationId: orgId }, select: { fuelType: true, pricePerUnit: true, effectiveFrom: true } }),
    db.orgSettings.findUnique({ where: { orgId } }).catch(() => null),
    db.gpsCredential.findUnique({ where: { orgId } }).catch(() => null),
    db.insightSettings.findUnique({ where: { orgId } }).catch(() => null),
    // Omborga qaytarilgan (tasdiqlangan) qismlar — ta'mirdan ayiriladi
    vids.length ? db.sparePartReturnItem.findMany({
      where: { return: { status: 'approved', vehicleId: inV, maintenanceId: { not: null } } },
      select: { sparePartId: true, quantity: true, unitCost: true, return: { select: { maintenanceId: true } } },
    }) : empty,
    // Qism omborga qachon kelgan: kirim hujjatlari va qabul qilingan transferlar (yarim yildan sal ko'proq)
    warehouseIds.length ? db.inventoryReceipt.findMany({
      where: { warehouseId: { in: warehouseIds }, createdAt: { gte: ago(200) } },
      select: { sparePartId: true, warehouseId: true, createdAt: true },
    }) : empty,
    warehouseIds.length ? db.inventoryTransfer.findMany({
      where: { toWarehouseId: { in: warehouseIds }, status: 'received', updatedAt: { gte: ago(200) } },
      select: { sparePartId: true, toWarehouseId: true, updatedAt: true },
    }) : empty,
    warehouseIds.length ? db.inventoryTransfer.findMany({
      where: { fromWarehouseId: { in: warehouseIds }, status: { in: ['shipped', 'received'] }, transferDate: { gte: ago(200) } },
      select: { sparePartId: true, fromWarehouseId: true, transferDate: true },
    }) : empty,
  ])

  const returnMap = buildReturnMap((returnedItems as any[]).map(r => ({
    maintenanceId: r.return?.maintenanceId, sparePartId: r.sparePartId, quantity: r.quantity, unitCost: n(r.unitCost),
  })))
  const latest = (m: Map<string, Date>, k: string, dt: Date) => { const cur = m.get(k); if (!cur || dt > cur) m.set(k, dt) }
  const arrival = new Map<string, Date>()
  for (const r of arrivalReceipts as any[]) latest(arrival, `${r.sparePartId}|${r.warehouseId}`, new Date(r.createdAt))
  for (const t of transfersIn as any[]) latest(arrival, `${t.sparePartId}|${t.toWarehouseId}`, new Date(t.updatedAt))
  const outgoing = new Map<string, Date>()
  for (const t of transfersOut as any[]) latest(outgoing, `${t.sparePartId}|${t.fromWarehouseId}`, new Date(t.transferDate))

  const mapMaint = (m: any) => {
    let parts = (m.items || []).map((i: any) => ({
      sparePartId: i.sparePartId, name: i.sparePart?.name || '', category: i.sparePart?.category ?? null,
      qty: i.quantityUsed || 1, unitCost: n(i.unitCost), warehouseId: i.warehouseId ?? m.sourceWarehouseId ?? null,
    }))
    // Eski yozuvlar: bitta qism to'g'ridan-to'g'ri MaintenanceRecord.sparePartId'da
    if (!parts.length && m.sparePartId) {
      parts.push({ sparePartId: m.sparePartId, name: m.sparePart?.name || '', category: m.sparePart?.category ?? null, qty: m.quantityUsed || 1, unitCost: m.quantityUsed ? n(m.cost) / m.quantityUsed : n(m.cost), warehouseId: m.sourceWarehouseId ?? null })
    }
    const net = netParts(m.id, parts, returnMap)
    parts = net.parts
    return {
      id: m.id, vehicleId: m.vehicleId, date: new Date(m.installationDate), mileage: m.installationMileage ?? null,
      cost: Math.max(0, n(m.cost) - net.returnedCost), laborCost: n(m.laborCost), workerName: m.workerName, isOfficial: m.isOfficial, isPaid: m.isPaid,
      status: m.status, notes: m.notes, isOil: m.isOil, createdAt: new Date(m.createdAt),
      evidenceCount: m._count?.evidence || 0, parts,
    }
  }
  const mappedMaint = (maintenance as any[]).map(mapMaint)

  const tireDeductions = (tires as any[]).flatMap(t => (t.tireDeductions || []).map((x: any) => ({
    id: x.id, tireId: t.id, vehicleId: x.vehicleId ?? t.vehicleId, isSettled: x.isSettled, createdAt: new Date(x.createdAt), amount: n(x.deductionAmount),
  })))

  return {
    now,
    thresholds: mergeThresholds(insightSettings?.thresholds),
    org: {
      gpsConnected: !!(gpsCred && gpsCred.isActive),
      gpsSyncError: gpsCred && gpsCred.isActive && gpsCred.lastSyncStatus === 'error' ? (gpsCred.lastSyncError || 'Noma\'lum xato') : null,
      gpsTokenExpiresAt: d(gpsCred?.tokenExpiresAt),
      oilIntervalKm: orgSettings?.oilIntervalKm ?? 7000,
      fuelDistanceMode: orgSettings?.fuelDistanceMode ?? 'gps',
    },
    branches: branches.map((b: any) => ({ id: b.id, name: b.name, managerId: b.managerId })),
    vehicles: vehiclesRaw.map((v: any) => ({
      id: v.id, plate: v.registrationNumber, brand: v.brand || '', model: v.model || '', year: v.year,
      fuelType: v.fuelType, branchId: v.branchId, purchaseDate: d(v.purchaseDate), mileage: n(v.mileage),
      status: v.status, notes: v.notes, insuranceExpiry: d(v.insuranceExpiry), techInspectionExpiry: d(v.techInspectionExpiry),
      gpsUnitName: v.gpsUnitName, lastGpsSignal: d(v.lastGpsSignal), fuelNorm: nn(v.fuelNormPer100km),
      tankCapacity: v.tankCapacity ?? null, fuelSensorName: v.fuelSensorName, lastFuelUpdate: d(v.lastFuelUpdate),
      oilIntervalKm: v.oilIntervalKm ?? null, createdAt: new Date(v.createdAt),
    })),
    // FAQAT tasdiqlangan ta'mirlar tahlil qilinadi (rad etilgan/kutayotganlar — savol ko'paytirib, shubhani buzadi)
    maintenance: mappedMaint.filter(m => m.status === 'approved'),
    pendingMaintenance: mappedMaint.filter(m => m.status === 'pending_approval'),
    engine: engine.map((e: any) => ({
      id: e.id, vehicleId: e.vehicleId, type: e.recordType, mileage: n(e.mileage), date: new Date(e.date), cost: n(e.cost), nextServiceMileage: nn(e.nextServiceMileage),
    })),
    intervals: intervals.map((i: any) => ({
      vehicleId: i.vehicleId, serviceType: i.serviceType, intervalKm: i.intervalKm, intervalDays: i.intervalDays, warningKm: i.warningKm,
      lastServiceKm: i.lastServiceKm ?? null, lastServiceDate: d(i.lastServiceDate), nextDueKm: i.nextDueKm ?? null,
      nextDueDate: d(i.nextDueDate), serviceOdometerKm: i.serviceOdometerKm ?? null,
    })),
    serviceRecords: serviceRecords.map((r: any) => ({ vehicleId: r.vehicleId, serviceType: r.serviceType, km: r.servicedAtKm, date: new Date(r.servicedAt), cost: n(r.cost) })),
    fuel: fuel.map((r: any) => ({
      id: r.id, vehicleId: r.vehicleId, fuelType: r.fuelType, liters: n(r.amountLiters), cost: n(r.cost),
      odometer: n(r.odometerReading), date: new Date(r.refuelDate), supplierId: r.supplierId,
    })),
    dailyKm: dailyKm.map((x: any) => ({ vehicleId: x.vehicleId, day: new Date(x.date).toISOString().slice(0, 10), km: n(x.km) })),
    fuelAnomalies: fuelAnomalies.map((a: any) => ({ vehicleId: a.vehicleId, anomaly: a.anomaly, deltaL: a.deltaL ?? null, at: new Date(a.capturedAt) })),
    inspections: inspections.map((i: any) => ({ vehicleId: i.vehicleId, date: new Date(i.inspectionDate), overall: i.overallStatus, brakes: i.brakes })),
    warranties: warranties.map((w: any) => ({ id: w.id, vehicleId: w.vehicleId, partName: w.partName, startDate: new Date(w.startDate), endDate: new Date(w.endDate), status: w.status })),
    tires: (tires as any[]).map(t => ({
      id: t.id, serial: t.serialCode, vehicleId: t.vehicleId, status: t.status, position: t.position,
      installedMileageKm: t.installedMileageKm ?? null, removedDate: d(t.removedDate), actualMileageUsed: t.actualMileageUsed ?? null,
      standardMileageKm: t.standardMileageKm, purchasePrice: n(t.purchasePrice), purchaseDate: new Date(t.purchaseDate), dotCode: t.dotCode,
    })),
    tireDeductions,
    tireTrackingVehicleIds: tireTracking.map((t: any) => t.vehicleId),
    inventory: inventory.map((i: any) => ({
      partId: i.sparePartId, partName: i.sparePart?.name || '', warehouseId: i.warehouseId, warehouseName: i.warehouse?.name || '',
      qty: i.quantityOnHand, reorderLevel: i.reorderLevel, unitPrice: n(i.sparePart?.unitPrice), lastRestockDate: d(i.lastRestockDate),
      lastArrival: [d(i.lastRestockDate), d(i.createdAt), arrival.get(`${i.sparePartId}|${i.warehouseId}`) || null]
        .filter((x): x is Date => !!x).sort((a, b) => b.getTime() - a.getTime())[0] || null,
      lastOutgoing: outgoing.get(`${i.sparePartId}|${i.warehouseId}`) || null,
    })),
    receipts: receipts.map((r: any) => ({ id: r.id, isOfficial: r.isOfficial, invoiceNumber: r.invoiceNumber, createdAt: new Date(r.createdAt) })),
    shippedBatches: shippedBatches.map((b: any) => ({ id: b.id, number: b.documentNumber, status: b.status, at: new Date(b.shippedAt || b.createdAt) })),
    pendingRequests: pendingRequests.map((r: any) => ({ id: r.id, number: r.documentNumber, status: r.status, at: new Date(r.createdAt) })),
    pendingReturns: pendingReturns.map((r: any) => ({ id: r.id, number: '', status: r.status, at: new Date(r.createdAt) })),
    oldDebts: oldDebts.map((o: any) => ({ id: o.id, vehicleId: o.vehicleId, partName: o.sparePartName, workerName: o.workerName, createdAt: new Date(o.createdAt) })),
    suppliers: suppliers.map((s: any) => {
      const inv = (s.payments || []).filter((p: any) => p.type === 'invoice')
      const pay = (s.payments || []).filter((p: any) => p.type !== 'invoice')
      const minDate = (xs: any[]) => xs.length ? new Date(Math.min(...xs.map(p => new Date(p.paymentDate).getTime()))) : null
      const maxDate = (xs: any[]) => xs.length ? new Date(Math.max(...xs.map(p => new Date(p.paymentDate).getTime()))) : null
      return {
        id: s.id, name: s.name,
        invoiced: inv.reduce((a: number, p: any) => a + n(p.amount), 0),
        paid: pay.reduce((a: number, p: any) => a + n(p.amount), 0),
        oldestInvoice: minDate(inv), lastPayment: maxDate(pay),
      }
    }),
    waybills: waybills.map((w: any) => ({
      id: w.id, number: w.number, vehicleId: w.vehicleId, status: w.status, plannedDeparture: new Date(w.plannedDeparture),
      actualDeparture: d(w.actualDeparture), actualReturn: d(w.actualReturn), departureOdometer: w.departureOdometer ?? null,
      returnOdometer: w.returnOdometer ?? null, fuelIssued: n(w.fuelIssued), mechanicApproved: w.mechanicApproved, createdAt: new Date(w.createdAt),
    })),
    expenses: expenses.map((e: any) => ({
      id: e.id, vehicleId: e.vehicleId, amount: n(e.amount), date: new Date(e.expenseDate), hasReceipt: !!e.receiptUrl, category: e.category?.name || '',
    })),
    budgets: budgets.map((b: any) => ({ month: b.month, category: b.category, amount: n(b.amount), branchId: b.branchId })),
    fuelImports: fuelImports.map((i: any) => ({ id: i.id, title: i.title, status: i.status, createdAt: new Date(i.createdAt), unmatchedRows: i._count?.rows || 0 })),
    fuelPrices: fuelPrices.map((p: any) => ({ fuelType: p.fuelType, price: n(p.pricePerUnit), from: new Date(p.effectiveFrom) })),
  }
}
