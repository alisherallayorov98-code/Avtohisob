import { prisma } from '../lib/prisma'

function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export async function predictNextMaintenance(vehicleId: string): Promise<void> {
  // Get all maintenance records grouped by spare part category
  const records = await prisma.maintenanceRecord.findMany({
    where: { vehicleId },
    include: { sparePart: { select: { category: true } } },
    orderBy: { installationDate: 'asc' },
  })

  if (records.length < 2) return

  // Group by category
  const byCategory = new Map<string, Date[]>()
  for (const r of records) {
    const cat = r.sparePart?.category || 'Boshqa'
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(r.installationDate)
  }

  const now = new Date()

  for (const [category, dates] of byCategory.entries()) {
    if (dates.length < 2) continue

    // Calculate intervals in days
    const intervals: number[] = []
    for (let i = 1; i < dates.length; i++) {
      intervals.push((dates[i].getTime() - dates[i - 1].getTime()) / (24 * 60 * 60 * 1000))
    }

    // Median interval — outlier-chidamli (bir martalik warranty replace avg ni buzmaydi).
    const medianInterval = median(intervals)
    if (medianInterval <= 0) continue

    const lastDate = dates[dates.length - 1]
    const predictedDate = new Date(lastDate.getTime() + medianInterval * 24 * 60 * 60 * 1000)
    if (predictedDate <= now) continue

    // Variance-based confidence — zich intervallar yuqori ishonch.
    // CV (coefficient of variation) = std / mean. CV=0 → mukammal tartib, CV→∞ → betartib.
    const meanInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const variance = intervals.reduce((a, b) => a + (b - meanInterval) ** 2, 0) / intervals.length
    const stdDev = Math.sqrt(variance)
    const cv = meanInterval > 0 ? stdDev / meanInterval : 1

    // Ikki komponent: tarix chuqurligi (5+ yozuv = 100%) va variance barqarorligi.
    const depthFactor = Math.min(intervals.length / 5, 1)
    const varianceFactor = Math.max(0.3, 1 - cv) // CV=0 → 1.0, CV>=0.7 → 0.3
    const confidence = Math.min(1, Math.max(0.1, depthFactor * varianceFactor))

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
          basedOnHistory: dates.length,
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
