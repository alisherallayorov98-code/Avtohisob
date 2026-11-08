import { prisma } from '../lib/prisma'
import {
  evaluateReview, daysBetween, priceDiffPct, typicalGapDays, RISK_ORDER,
  LastInstall, ReviewItemInput,
} from '../lib/maintenanceReview'

// Kutayotgan arizalarga admin uchun "tekshiruv konteksti"ni qo'shadi:
// har bir qism uchun shu mashinadagi oxirgi o'rnatish, kirim narxi bilan farq, ombor qoldig'i va umumiy xavf.
// Faqat o'qiydi; faqat tasdiqlangan (approved) tarix hisobga olinadi. Tarix faqat arizadagi mashinalar bo'yicha olinadi
// (arizalar allaqachon tenant filtridan o'tgan), shuning uchun boshqa tashkilot ma'lumoti aralashmaydi.
export async function attachReviews<T extends { id: string; vehicleId: string; installationDate: Date; createdAt: Date; workerName?: string | null; items: any[]; evidence: any[] }>(
  records: T[],
): Promise<(T & { review: any })[]> {
  if (records.length === 0) return []

  const vehicleIds = [...new Set(records.map(r => r.vehicleId))]
  const partIds = [...new Set(records.flatMap(r => r.items.map((i: any) => i.sparePartId as string)))]
  const warehouseIds = [...new Set(records.flatMap(r => r.items.map((i: any) => i.warehouseId as string | null)).filter(Boolean) as string[])]
  const since365 = new Date(Date.now() - 365 * 86400000)

  const [itemHistory, legacyHistory, recent, vehicles, stocks] = await Promise.all([
    partIds.length
      ? prisma.maintenanceItem.findMany({
          where: { sparePartId: { in: partIds }, maintenance: { vehicleId: { in: vehicleIds }, status: 'approved' } },
          select: {
            sparePartId: true, quantityUsed: true, unitCost: true,
            maintenance: { select: { vehicleId: true, installationDate: true, installationMileage: true, workerName: true } },
          },
        })
      : Promise.resolve([] as any[]),
    partIds.length
      ? prisma.maintenanceRecord.findMany({
          where: { status: 'approved', vehicleId: { in: vehicleIds }, sparePartId: { in: partIds }, items: { none: {} } },
          select: { vehicleId: true, sparePartId: true, installationDate: true, installationMileage: true, workerName: true, cost: true, quantityUsed: true },
        })
      : Promise.resolve([] as any[]),
    prisma.maintenanceRecord.findMany({
      where: { status: 'approved', vehicleId: { in: vehicleIds }, installationDate: { gte: since365 } },
      select: {
        id: true, vehicleId: true, installationDate: true, workerName: true, cost: true, laborCost: true,
        sparePart: { select: { name: true } },
        items: { select: { sparePart: { select: { name: true } } } },
      },
      orderBy: { installationDate: 'desc' },
    }),
    prisma.vehicle.findMany({ where: { id: { in: vehicleIds } }, select: { id: true, mileage: true } }),
    partIds.length && warehouseIds.length
      ? prisma.inventory.findMany({
          where: { sparePartId: { in: partIds }, warehouseId: { in: warehouseIds } },
          select: { sparePartId: true, warehouseId: true, quantityOnHand: true },
        })
      : Promise.resolve([] as any[]),
  ])

  // vehicleId::partId -> o'rnatishlar (yangi -> eski)
  const histMap = new Map<string, LastInstallRow[]>()
  const push = (vehicleId: string, partId: string, row: LastInstallRow) => {
    const k = `${vehicleId}::${partId}`
    if (!histMap.has(k)) histMap.set(k, [])
    histMap.get(k)!.push(row)
  }
  for (const h of itemHistory as any[]) {
    push(h.maintenance.vehicleId, h.sparePartId, {
      date: h.maintenance.installationDate, vehicleKm: h.maintenance.installationMileage ?? null,
      worker: h.maintenance.workerName ?? null, unitCost: Number(h.unitCost), quantity: h.quantityUsed,
    })
  }
  for (const h of legacyHistory as any[]) {
    push(h.vehicleId, h.sparePartId, {
      date: h.installationDate, vehicleKm: h.installationMileage ?? null,
      worker: h.workerName ?? null, unitCost: Number(h.cost), quantity: h.quantityUsed || 1,
    })
  }
  for (const rows of histMap.values()) rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())

  const stockMap = new Map<string, number>()
  for (const s of stocks as any[]) stockMap.set(`${s.sparePartId}::${s.warehouseId}`, s.quantityOnHand)
  const mileageMap = new Map<string, number>(vehicles.map(v => [v.id, Number(v.mileage) || 0]))

  // Boshqa kutayotgan arizalarda bir xil mashina+qism
  const pendingByKey = new Map<string, Set<string>>()
  for (const r of records) {
    for (const i of r.items as any[]) {
      const k = `${r.vehicleId}::${i.sparePartId}`
      if (!pendingByKey.has(k)) pendingByKey.set(k, new Set())
      pendingByKey.get(k)!.add(r.id)
    }
  }

  const now = Date.now()
  const out = records.map(r => {
    const vehicleKm = mileageMap.get(r.vehicleId) ?? null
    const vehRecent = (recent as any[]).filter(x => x.vehicleId === r.vehicleId)
    const workerRepeatCount = r.workerName
      ? vehRecent.filter(x => x.workerName === r.workerName && now - new Date(x.installationDate).getTime() <= 180 * 86400000).length
      : 0

    const inputItems: ReviewItemInput[] = r.items.map((i: any) => {
      const rows = histMap.get(`${r.vehicleId}::${i.sparePartId}`) || []
      // Aynan shu arizadan oldingi o'rnatishlar (kelajakdagi/teng sanalar tarix emas)
      const past = rows.filter(x => new Date(x.date).getTime() <= new Date(r.installationDate).getTime())
      const last: LastInstall | null = past[0] || null
      return {
        itemId: i.id, name: i.sparePart?.name || '—', quantity: i.quantityUsed, unitCost: Number(i.unitCost),
        refPrice: i.sparePart?.unitPrice != null ? Number(i.sparePart.unitPrice) : null,
        stock: i.warehouseId ? (stockMap.get(`${i.sparePartId}::${i.warehouseId}`) ?? 0) : null,
        lastOnVehicle: last,
        pastDates: past.map(x => x.date),
        alsoPending: (pendingByKey.get(`${r.vehicleId}::${i.sparePartId}`)?.size || 0) > 1,
      }
    })

    const { risk, flags } = evaluateReview({
      installationDate: r.installationDate, vehicleKm, evidenceCount: r.evidence.length,
      items: inputItems, workerRepeatCount, workerName: r.workerName ?? null,
    })

    const since90 = now - 90 * 86400000
    const review = {
      risk,
      flags,
      items: inputItems.map(it => ({
        itemId: it.itemId,
        last: it.lastOnVehicle && {
          date: it.lastOnVehicle.date,
          daysAgo: daysBetween(r.installationDate, it.lastOnVehicle.date),
          vehicleKm: it.lastOnVehicle.vehicleKm,
          kmAgo: it.lastOnVehicle.vehicleKm != null && vehicleKm != null && vehicleKm >= it.lastOnVehicle.vehicleKm ? vehicleKm - it.lastOnVehicle.vehicleKm : null,
          worker: it.lastOnVehicle.worker,
          unitCost: it.lastOnVehicle.unitCost,
          quantity: it.lastOnVehicle.quantity,
        },
        refPrice: it.refPrice,
        priceDiffPct: priceDiffPct(it.unitCost, it.refPrice),
        stock: it.stock,
        typicalGapDays: typicalGapDays(it.pastDates),
      })),
      vehicle: {
        mileage: vehicleKm,
        count90: vehRecent.filter(x => new Date(x.installationDate).getTime() >= since90).length,
        lastMaintenanceAt: vehRecent[0]?.installationDate ?? null,
        recent: vehRecent.slice(0, 4).map(x => ({
          id: x.id, date: x.installationDate, worker: x.workerName ?? null,
          total: Number(x.cost) + Number(x.laborCost),
          parts: (x.items.length ? x.items.map((i: any) => i.sparePart?.name) : [x.sparePart?.name]).filter(Boolean),
        })),
      },
    }
    return { ...r, review }
  })

  // Xavfli arizalar yuqorida, ichida — eng yangisi birinchi
  return out.sort((a, b) =>
    RISK_ORDER[a.review.risk as 'ok'] - RISK_ORDER[b.review.risk as 'ok'] ||
    new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
}

interface LastInstallRow { date: Date | string; vehicleKm: number | null; worker: string | null; unitCost: number; quantity: number }
