import { prisma } from '../lib/prisma'

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

/**
 * Fleet-level prior: bir xil brand+model'dagi boshqa mashinalarning tarixini
 * jamlab, kategoriya uchun o'rtacha interval nimaligini aytadi. Yangi
 * mashinada o'z tarixi kam bo'lsa (<3), cold-start yechimi sifatida ishlatiladi.
 */
async function getFleetPriorIntervals(
  brand: string | null,
  model: string | null,
  category: string,
  excludeVehicleId: string,
): Promise<number[]> {
  if (!brand || !model) return []
  const peers = await prisma.vehicle.findMany({
    where: { brand, model, id: { not: excludeVehicleId } },
    select: { id: true },
  })
  if (peers.length < 2) return []

  const records = await prisma.maintenanceRecord.findMany({
    where: {
      vehicleId: { in: peers.map(p => p.id) },
      sparePart: { category },
    },
    select: { vehicleId: true, installationDate: true },
    orderBy: [{ vehicleId: 'asc' }, { installationDate: 'asc' }],
  })

  // Har mashina uchun intervallarni alohida hisoblab, so'ng jamlaymiz.
  const byVehicle = new Map<string, number[]>()
  for (const r of records) {
    if (!byVehicle.has(r.vehicleId)) byVehicle.set(r.vehicleId, [])
    byVehicle.get(r.vehicleId)!.push(r.installationDate.getTime())
  }

  const allIntervals: number[] = []
  for (const timestamps of byVehicle.values()) {
    for (let i = 1; i < timestamps.length; i++) {
      const days = (timestamps[i] - timestamps[i - 1]) / (24 * 60 * 60 * 1000)
      // Sanity cap: 10 yildan uzoq interval — ma'lumot xatosi ehtimoli, tashlaymiz.
      if (days > 0 && days < 3650) allIntervals.push(days)
    }
  }
  return allIntervals
}

export async function predictNextMaintenance(vehicleId: string): Promise<void> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, brand: true, model: true },
  })
  if (!vehicle) return

  const records = await prisma.maintenanceRecord.findMany({
    where: { vehicleId },
    include: { sparePart: { select: { category: true } } },
    orderBy: { installationDate: 'asc' },
  })

  // Group by category
  const byCategory = new Map<string, Date[]>()
  for (const r of records) {
    const cat = r.sparePart?.category || 'Boshqa'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(r.installationDate)
  }

  if (byCategory.size === 0) return

  const now = new Date()

  for (const [category, dates] of byCategory.entries()) {
    // Own intervals
    const ownIntervals: number[] = []
    for (let i = 1; i < dates.length; i++) {
      ownIntervals.push((dates[i].getTime() - dates[i - 1].getTime()) / (24 * 60 * 60 * 1000))
    }

    let intervals: number[]
    let isFleetPrior = false

    if (ownIntervals.length >= 3) {
      // O'z tarixi yetarli
      intervals = ownIntervals
    } else {
      // Cold-start: fleet prior bilan to'ldiramiz
      const fleet = await getFleetPriorIntervals(vehicle.brand, vehicle.model, category, vehicleId)
      if (fleet.length < 5) {
        // Na o'z tarix, na fleet — oldingidek ishlaymiz (>=2 own intervals bilan)
        if (ownIntervals.length < 2) continue
        intervals = ownIntervals
      } else {
        // Fleet prior'ni o'z 1-2 intervali bilan aralashtiramiz (bor bo'lsa)
        intervals = ownIntervals.length > 0 ? [...ownIntervals, ...fleet] : fleet
        isFleetPrior = ownIntervals.length === 0
      }
    }

    const medianInterval = median(intervals)
    if (medianInterval <= 0) continue

    // O'z tarixi bor bo'lsa — oxirgi sanadan boshlaymiz; bo'lmasa — bugundan.
    const baseDate = dates.length > 0 ? dates[dates.length - 1] : now
    const predictedDate = new Date(baseDate.getTime() + medianInterval * 24 * 60 * 60 * 1000)
    if (predictedDate <= now) continue

    // Variance-based confidence — zich intervallar yuqori ishonch.
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance = intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length
    const stdDev = Math.sqrt(variance)
    const cv = meanInterval > 0 ? stdDev / meanInterval : 1

    const depthFactor = Math.min(intervals.length / 5, 1)
    const varianceFactor = Math.max(0.3, 1 - cv)
    let confidence = Math.min(1, Math.max(0.1, depthFactor * varianceFactor))
    // Fleet prior proxi ma'lumot — confidence'ni pasaytiramiz (0.6x).
    if (isFleetPrior) confidence *= 0.6

    const existing = await prisma.maintenancePrediction.findFirst({
      where: {
        vehicleId,
        partCategory: category,
        predictedDate: { gte: now },
        isAcknowledged: false,
      },
    })

    if (!existing) {
      await prisma.maintenancePrediction.create({
        data: {
          vehicleId,
          partCategory: category,
          predictedDate,
          confidence,
          basedOnHistory: intervals.length,
        },
      })
    }
  }
}

export async function runFleetForecasting(branchId?: string): Promise<void> {
  const vehicles = await prisma.vehicle.findMany({
    where: { status: 'active', ...(branchId ? { branchId } : {}) },
    select: { id: true },
  })
  for (const v of vehicles) {
    await predictNextMaintenance(v.id).catch(console.error)
  }
}
