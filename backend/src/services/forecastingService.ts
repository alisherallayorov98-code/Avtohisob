import { prisma } from '../lib/prisma'

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
    const cat = r.sparePart.category
    if (!byCategory.has(cat)) byCategory.set(cat, [])
    byCategory.get(cat)!.push(r.installationDate)
  }

  const now = new Date()

  for (const [category, dates] of byCategory.entries()) {
    if (dates.length < 2) continue

    // Calculate average interval in days
    const intervals: number[] = []
    for (let i = 1; i < dates.length; i++) {
      intervals.push((dates[i].getTime() - dates[i - 1].getTime()) / (24 * 60 * 60 * 1000))
    }
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / intervals.length
    const lastDate = dates[dates.length - 1]
    const predictedDate = new Date(lastDate.getTime() + avgInterval * 24 * 60 * 60 * 1000)

    // Only create prediction if it's in the future
    if (predictedDate <= now) continue

    // Confidence based on history depth
    const confidence = Math.min(dates.length / 5, 1.0)

    // Check for existing active prediction
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
