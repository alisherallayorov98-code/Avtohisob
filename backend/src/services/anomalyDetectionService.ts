import { prisma } from '../lib/prisma'

// Robust statistics — median va MAD outlier'larga mean/std ga qaraganda
// ancha chidamli. MAD * 1.4826 ≈ normal taqsimotda standart og'ish.
function median(arr: number[]): number {
  const sorted = [...arr].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function medianAndMad(arr: number[]): { med: number; mad: number } {
  const med = median(arr)
  const deviations = arr.map(v => Math.abs(v - med))
  return { med, mad: median(deviations) }
}

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

  // --- Anomaly 1: Fuel consumption spike (robust — MAD asosida) ---
  // Kichik sample'da mean ± 2σ beqaror (1 ta outlier mean ni buzib yuboradi).
  // Median + MAD ishlatamiz va min 6 ta namuna talab qilamiz.
  if (vehicle.fuelRecords.length >= 7) {
    const consumptions: number[] = []
    for (let i = 0; i < vehicle.fuelRecords.length - 1; i++) {
      const km = Number(vehicle.fuelRecords[i].odometerReading) - Number(vehicle.fuelRecords[i + 1].odometerReading)
      if (km > 10) {
        consumptions.push(Number(vehicle.fuelRecords[i].amountLiters) / km * 100)
      }
    }
    if (consumptions.length >= 6) {
      const { med, mad } = medianAndMad(consumptions)
      const robustStd = mad * 1.4826 // normal distribution uchun MAD → σ ekvivalenti
      const latest = consumptions[0]
      // 2.5 robust-sigma ~ 99% ishonch — mean+2σ ga qaraganda past false-positive
      if (robustStd > 0 && latest > med + 2.5 * robustStd) {
        const existing = await prisma.anomaly.findFirst({
          where: { vehicleId, type: 'fuel_spike', isResolved: false },
        })
        if (!existing) {
          await prisma.anomaly.create({
            data: {
              vehicleId,
              type: 'fuel_spike',
              severity: latest > med + 4 * robustStd ? 'high' : 'medium',
              description: `Yoqilg'i sarfi odatdagidan ${((latest - med) / med * 100).toFixed(0)}% yuqori (${latest.toFixed(1)} L/100km, median: ${med.toFixed(1)})`,
              metadata: { latest, median: med, mad, robustStd, sampleCount: consumptions.length },
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

  // --- Anomaly 3: Single high-cost maintenance (median asosida — outlier-chidamli) ---
  if (vehicle.maintenanceRecords.length >= 5) {
    const costs = vehicle.maintenanceRecords.map(r => Number(r.cost))
    const medianCost = median(costs)
    const latestCost = costs[0]
    // Median x3 — mean x3 ga qaraganda ishonchli, chunki eski katta ta'mirat
    // mean ni buzmaydi va latest noto'g'ri "normal" ko'rinmaydi.
    if (medianCost > 0 && latestCost > medianCost * 3 && latestCost > 500000) {
      const existing = await prisma.anomaly.findFirst({
        where: { vehicleId, type: 'cost_spike', isResolved: false },
      })
      if (!existing) {
        await prisma.anomaly.create({
          data: {
            vehicleId,
            type: 'cost_spike',
            severity: 'high',
            description: `Oxirgi xizmat xarajati (${latestCost.toLocaleString()} UZS) medianadan 3 baravar yuqori (median: ${medianCost.toLocaleString()} UZS)`,
            metadata: { latestCost, medianCost, sampleCount: costs.length },
          },
        })
      }
    }
  }

  // --- Anomaly 4: Odometer jump (hamma juftliklar bo'yicha, eng yomonini topamiz) ---
  // Oldingi versiya birinchi sakrashda break qilardi — eski va yomonroq
  // sakrashlarni o'tkazib yuborardi. Endi barchasini skan qilib, eng yomonini
  // bitta anomaliya sifatida yozamiz.
  if (vehicle.fuelRecords.length >= 2) {
    let worstJump: { kmDiff: number; daysDiff: number; rate: number } | null = null
    for (let i = 0; i < vehicle.fuelRecords.length - 1; i++) {
      const r1 = vehicle.fuelRecords[i]
      const r2 = vehicle.fuelRecords[i + 1]
      const kmDiff = Number(r1.odometerReading) - Number(r2.odometerReading)
      const daysDiff = Math.max(1, (r1.refuelDate.getTime() - r2.refuelDate.getTime()) / (24 * 60 * 60 * 1000))
      if (kmDiff > 0) {
        const rate = kmDiff / daysDiff
        if (rate > 1500 && (!worstJump || rate > worstJump.rate)) {
          worstJump = { kmDiff, daysDiff, rate }
        }
      }
    }
    if (worstJump) {
      const existing = await prisma.anomaly.findFirst({
        where: { vehicleId, type: 'odometer_jump', isResolved: false },
      })
      if (!existing) {
        await prisma.anomaly.create({
          data: {
            vehicleId,
            type: 'odometer_jump',
            severity: worstJump.rate > 2500 ? 'high' : 'medium',
            description: `Odometr sakrashi: ${worstJump.kmDiff.toFixed(0)} km / ${worstJump.daysDiff.toFixed(0)} kun (${worstJump.rate.toFixed(0)} km/kun)`,
            metadata: { kmDiff: worstJump.kmDiff, daysDiff: worstJump.daysDiff, kmPerDay: worstJump.rate },
          },
        })
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
