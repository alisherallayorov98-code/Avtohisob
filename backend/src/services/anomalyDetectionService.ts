import { prisma } from '../lib/prisma'

export async function detectVehicleAnomalies(vehicleId: string): Promise<void> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      fuelRecords: { orderBy: { refuelDate: 'desc' }, take: 30 },
      maintenanceRecords: { orderBy: { installationDate: 'desc' }, take: 20 },
    },
  })
  if (!vehicle) return

  const now = new Date()
  const last30 = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)

  // --- Anomaly 1: Fuel consumption spike ---
  if (vehicle.fuelRecords.length >= 4) {
    const consumptions: number[] = []
    for (let i = 0; i < vehicle.fuelRecords.length - 1; i++) {
      const km = Number(vehicle.fuelRecords[i].odometerReading) - Number(vehicle.fuelRecords[i + 1].odometerReading)
      if (km > 10) {
        consumptions.push(Number(vehicle.fuelRecords[i].amountLiters) / km * 100)
      }
    }
    if (consumptions.length >= 3) {
      const mean = consumptions.reduce((a, b) => a + b, 0) / consumptions.length
      const std = Math.sqrt(consumptions.reduce((a, b) => a + (b - mean) ** 2, 0) / consumptions.length)
      const latest = consumptions[0]
      if (latest > mean + 2 * std) {
        // Check if same type anomaly already exists unresolved
        const existing = await prisma.anomaly.findFirst({
          where: { vehicleId, type: 'fuel_spike', isResolved: false },
        })
        if (!existing) {
          await prisma.anomaly.create({
            data: {
              vehicleId,
              type: 'fuel_spike',
              severity: latest > mean + 3 * std ? 'high' : 'medium',
              description: `Gaz sarfi odatdagidan ${((latest - mean) / mean * 100).toFixed(0)}% yuqori (${latest.toFixed(1)} L/100km, o'rtacha: ${mean.toFixed(1)})`,
              metadata: { latest, mean, std },
            },
          })
        }
      }
    }
  }

  // --- Anomaly 2: Too many maintenance records in 30 days ---
  const recentMaint = vehicle.maintenanceRecords.filter(r => r.installationDate >= last30)
  if (recentMaint.length >= 4) {
    const existing = await prisma.anomaly.findFirst({
      where: { vehicleId, type: 'maintenance_frequency', isResolved: false },
    })
    if (!existing) {
      await prisma.anomaly.create({
        data: {
          vehicleId,
          type: 'maintenance_frequency',
          severity: recentMaint.length >= 6 ? 'high' : 'medium',
          description: `So'nggi 30 kunda ${recentMaint.length} ta texnik xizmat — bu odatdan ko'p`,
          metadata: { count: recentMaint.length },
        },
      })
    }
  }

  // --- Anomaly 3: Single high-cost maintenance ---
  if (vehicle.maintenanceRecords.length >= 3) {
    const costs = vehicle.maintenanceRecords.map(r => Number(r.cost))
    const avgCost = costs.reduce((a, b) => a + b, 0) / costs.length
    const latestCost = costs[0]
    if (latestCost > avgCost * 3 && latestCost > 500000) {
      const existing = await prisma.anomaly.findFirst({
        where: { vehicleId, type: 'cost_spike', isResolved: false },
      })
      if (!existing) {
        await prisma.anomaly.create({
          data: {
            vehicleId,
            type: 'cost_spike',
            severity: 'high',
            description: `Oxirgi xizmat xarajati (${latestCost.toLocaleString()} UZS) o'rtachadan 3 baravar yuqori`,
            metadata: { latestCost, avgCost },
          },
        })
      }
    }
  }

  // --- Anomaly 4: Odometer jump ---
  if (vehicle.fuelRecords.length >= 2) {
    for (let i = 0; i < vehicle.fuelRecords.length - 1; i++) {
      const r1 = vehicle.fuelRecords[i]
      const r2 = vehicle.fuelRecords[i + 1]
      const kmDiff = Number(r1.odometerReading) - Number(r2.odometerReading)
      const daysDiff = Math.max(1, (r1.refuelDate.getTime() - r2.refuelDate.getTime()) / (24 * 60 * 60 * 1000))
      if (kmDiff > 0 && kmDiff / daysDiff > 1500) {
        const existing = await prisma.anomaly.findFirst({
          where: { vehicleId, type: 'odometer_jump', isResolved: false },
        })
        if (!existing) {
          await prisma.anomaly.create({
            data: {
              vehicleId,
              type: 'odometer_jump',
              severity: 'medium',
              description: `Odometr ko'rsatkichida katta sakrash: ${kmDiff.toFixed(0)} km/${daysDiff.toFixed(0)} kun`,
              metadata: { kmDiff, daysDiff, kmPerDay: kmDiff / daysDiff },
            },
          })
        }
        break
      }
    }
  }
}

export async function detectFleetAnomalies(branchId?: string): Promise<void> {
  const vehicles = await prisma.vehicle.findMany({
    where: { status: 'active', ...(branchId ? { branchId } : {}) },
    select: { id: true },
  })
  for (const v of vehicles) {
    await detectVehicleAnomalies(v.id).catch(console.error)
  }
}
