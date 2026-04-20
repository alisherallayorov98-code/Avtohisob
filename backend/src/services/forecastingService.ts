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
 *
 * Ham kun-intervallari, ham km-intervallari (ikkala ketma-ket yozuvda
 * installationMileage bo'lsa) qaytariladi.
 */
async function getFleetPriorIntervals(
  brand: string | null,
  model: string | null,
  category: string,
  excludeVehicleId: string,
): Promise<{ dayIntervals: number[]; kmIntervals: number[] }> {
  if (!brand || !model) return { dayIntervals: [], kmIntervals: [] }
  const peers = await prisma.vehicle.findMany({
    where: { brand, model, id: { not: excludeVehicleId } },
    select: { id: true },
  })
  if (peers.length < 2) return { dayIntervals: [], kmIntervals: [] }

  const records = await prisma.maintenanceRecord.findMany({
    where: {
      vehicleId: { in: peers.map(p => p.id) },
      sparePart: { category },
    },
    select: { vehicleId: true, installationDate: true, installationMileage: true },
    orderBy: [{ vehicleId: 'asc' }, { installationDate: 'asc' }],
  })

  // Har mashina uchun intervallarni alohida hisoblab, so'ng jamlaymiz.
  const byVehicle = new Map<string, { t: number; km: number | null }[]>()
  for (const r of records) {
    if (!byVehicle.has(r.vehicleId)) byVehicle.set(r.vehicleId, [])
    byVehicle.get(r.vehicleId)!.push({ t: r.installationDate.getTime(), km: r.installationMileage })
  }

  const dayIntervals: number[] = []
  const kmIntervals: number[] = []
  for (const points of byVehicle.values()) {
    for (let i = 1; i < points.length; i++) {
      const days = (points[i].t - points[i - 1].t) / (24 * 60 * 60 * 1000)
      // Sanity cap: 10 yildan uzoq interval — ma'lumot xatosi ehtimoli, tashlaymiz.
      if (days > 0 && days < 3650) dayIntervals.push(days)

      const prevKm = points[i - 1].km
      const curKm = points[i].km
      if (prevKm != null && curKm != null) {
        const km = curKm - prevKm
        // Sanity: 0 < km < 500k — noto'g'ri kiritilgan odometr tashlanadi.
        if (km > 0 && km < 500000) kmIntervals.push(km)
      }
    }
  }
  return { dayIntervals, kmIntervals }
}

export async function predictNextMaintenance(vehicleId: string): Promise<void> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { id: true, brand: true, model: true, mileage: true },
  })
  if (!vehicle) return

  const records = await prisma.maintenanceRecord.findMany({
    where: { vehicleId },
    include: { sparePart: { select: { category: true } } },
    orderBy: { installationDate: 'asc' },
  })

  // Group by category — (date, mileage) juftliklari.
  const byCategory = new Map<string, { date: Date; km: number | null }[]>()
  for (const r of records) {
    const cat = r.sparePart?.category || 'Boshqa'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push({ date: r.installationDate, km: r.installationMileage })
  }

  if (byCategory.size === 0) return

  const now = new Date()
  const currentMileage = Number(vehicle.mileage) || null

  for (const [category, points] of byCategory.entries()) {
    // O'z tarixidan kun va km intervallarini ajratamiz.
    const ownDayIntervals: number[] = []
    const ownKmIntervals: number[] = []
    for (let i = 1; i < points.length; i++) {
      ownDayIntervals.push((points[i].date.getTime() - points[i - 1].date.getTime()) / (24 * 60 * 60 * 1000))
      const prevKm = points[i - 1].km
      const curKm = points[i].km
      if (prevKm != null && curKm != null && curKm > prevKm) {
        ownKmIntervals.push(curKm - prevKm)
      }
    }

    let dayIntervals: number[]
    let kmIntervals: number[] = ownKmIntervals
    let isFleetPrior = false

    if (ownDayIntervals.length >= 3) {
      dayIntervals = ownDayIntervals
    } else {
      // Cold-start: fleet prior.
      const fleet = await getFleetPriorIntervals(vehicle.brand, vehicle.model, category, vehicleId)
      if (fleet.dayIntervals.length < 5) {
        if (ownDayIntervals.length < 2) continue
        dayIntervals = ownDayIntervals
      } else {
        dayIntervals = ownDayIntervals.length > 0 ? [...ownDayIntervals, ...fleet.dayIntervals] : fleet.dayIntervals
        isFleetPrior = ownDayIntervals.length === 0
      }
      // Km intervallarni ham fleet bilan to'ldiramiz (agar bo'lsa).
      if (fleet.kmIntervals.length >= 3 && ownKmIntervals.length < 3) {
        kmIntervals = ownKmIntervals.length > 0 ? [...ownKmIntervals, ...fleet.kmIntervals] : fleet.kmIntervals
      }
    }

    const medianDayInterval = median(dayIntervals)
    if (medianDayInterval <= 0) continue

    // Predicted date — odatdagidek sana tarixidan oldinga proekt.
    const baseDate = points.length > 0 ? points[points.length - 1].date : now
    const predictedDate = new Date(baseDate.getTime() + medianDayInterval * 24 * 60 * 60 * 1000)
    if (predictedDate <= now) continue

    // Predicted km — faqat bizda yetarli km tarix bor bo'lsa va current mileage
    // ma'lum bo'lsa. Oxirgi yozuv km'ini + median km interval.
    let predictedKm: number | null = null
    const lastKm = points.length > 0 ? points[points.length - 1].km : null
    if (kmIntervals.length >= 2 && lastKm != null) {
      const medianKm = median(kmIntervals)
      if (medianKm > 0) {
        const km = lastKm + medianKm
        // Agar current mileage oxirgi yozuvdagidan yuqori bo'lsa va predictedKm
        // o'ni o'tmasa — kelasi xizmat allaqachon o'tib ketgan, o'tkazib yuboramiz.
        if (currentMileage == null || km > currentMileage) predictedKm = km
      }
    }

    // Variance-based confidence — zich intervallar yuqori ishonch.
    const meanInterval = dayIntervals.reduce((a, b) => a + b, 0) / dayIntervals.length
    const variance = dayIntervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / dayIntervals.length
    const stdDev = Math.sqrt(variance)
    const cv = meanInterval > 0 ? stdDev / meanInterval : 1

    const depthFactor = Math.min(dayIntervals.length / 5, 1)
    const varianceFactor = Math.max(0.3, 1 - cv)
    let confidence = Math.min(1, Math.max(0.1, depthFactor * varianceFactor))
    // Fleet prior proxi ma'lumot — confidence'ni pasaytiramiz (0.6x).
    if (isFleetPrior) confidence *= 0.6
    // Km-prognoz ham bor bo'lsa — bitta qo'shimcha signal, kichik bonus (1.1x, cap 1).
    if (predictedKm != null) confidence = Math.min(1, confidence * 1.1)

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
          predictedKm,
          confidence,
          basedOnHistory: dayIntervals.length,
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
