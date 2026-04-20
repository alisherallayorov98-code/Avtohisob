import { prisma } from '../lib/prisma'

export interface HealthScoreResult {
  vehicleId: string
  score: number
  grade: string
  mileageFactor: number
  maintenanceFactor: number
  fuelFactor: number
  ageFactor: number
  details: Record<string, any>
}

function getGrade(score: number): string {
  if (score >= 85) return 'excellent'
  if (score >= 70) return 'good'
  if (score >= 55) return 'fair'
  if (score >= 40) return 'poor'
  return 'critical'
}

export async function calculateHealthScore(vehicleId: string): Promise<HealthScoreResult> {
  const vehicle = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    include: {
      maintenanceRecords: {
        orderBy: { installationDate: 'desc' },
        take: 20,
      },
      fuelRecords: {
        orderBy: { refuelDate: 'desc' },
        take: 20,
      },
    },
  })
  if (!vehicle) throw new Error('Vehicle not found')

  const now = new Date()
  const currentYear = now.getFullYear()

  // Age Factor — smooth exponential decay (step sakrashlar yo'q).
  // 100 * e^(-age/12) formulasi: 0yosh=100, 3yosh=78, 5yosh=66, 7yosh=56,
  // 10yosh=43, 15yosh=35. Min 35 — eng eski mashina ham 0 ga tushmaydi.
  const vehicleAge = Math.max(0, currentYear - vehicle.year)
  const ageFactor = Math.max(35, Math.round(100 * Math.exp(-vehicleAge / 12)))

  // Mileage sub-factor — smooth linear penalty (max 20).
  // 7500 km = 1 penalty point: 50k=6.6, 100k=13.3, 150k=20 (capped), 200k=20.
  const mileageKm = Number(vehicle.mileage)
  const mileagePenalty = Math.min(20, mileageKm / 7500)
  const mileageFactor = Math.max(0, Math.min(100, Math.round(ageFactor - mileagePenalty)))

  // Maintenance Factor (0-100)
  const last90Days = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000)
  const last30Days = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
  const recentMaintenance = vehicle.maintenanceRecords.filter(r => r.installationDate >= last90Days)
  const lastMaintenance = vehicle.maintenanceRecords[0]

  let maintenanceFactor = 70 // default if no history

  if (lastMaintenance) {
    const daysSinceLastService = Math.floor((now.getTime() - lastMaintenance.installationDate.getTime()) / (24 * 60 * 60 * 1000))
    if (daysSinceLastService <= 30) maintenanceFactor = 100
    else if (daysSinceLastService <= 60) maintenanceFactor = 75
    else if (daysSinceLastService <= 90) maintenanceFactor = 50
    else maintenanceFactor = 25
  }

  // Penalize for too many repairs
  if (recentMaintenance.length > 5) maintenanceFactor = Math.max(0, maintenanceFactor - 20)

  // Penalize for high recent costs
  const recentCost = recentMaintenance.reduce((s, r) => s + Number(r.cost), 0)
  if (recentCost > 2000000) maintenanceFactor = Math.max(0, maintenanceFactor - 15)

  // Vehicle status penalty
  if (vehicle.status === 'maintenance') maintenanceFactor = Math.max(0, maintenanceFactor - 15)
  if (vehicle.status === 'inactive') maintenanceFactor = Math.max(0, maintenanceFactor - 30)

  // Fuel Efficiency Factor (0-100)
  // L/100km = (yoqilg'i yig'indisi, eng eski quyish tashqari) / (max odo - min odo) * 100.
  // Eng eski quyish "boshlang'ich holat" bo'lgani uchun chiqariladi — bu klassik avto sarfi hisobi.
  let fuelFactor = 70 // default if no data
  const recentFuelRecords = vehicle.fuelRecords.filter(r => r.refuelDate >= last30Days)
  const olderFuelRecords = vehicle.fuelRecords.filter(r => r.refuelDate >= last90Days && r.refuelDate < last30Days)

  const computeEfficiency = (records: typeof vehicle.fuelRecords): number => {
    if (records.length < 2) return 0
    const sorted = [...records].sort((a, b) => Number(a.odometerReading) - Number(b.odometerReading))
    const km = Number(sorted[sorted.length - 1].odometerReading) - Number(sorted[0].odometerReading)
    if (km < 10) return 0
    const litersAfterFirst = sorted.slice(1).reduce((s, r) => s + Number(r.amountLiters), 0)
    return (litersAfterFirst / km) * 100
  }

  if (recentFuelRecords.length >= 2 && olderFuelRecords.length >= 2) {
    const recentEfficiency = computeEfficiency(recentFuelRecords)
    const baselineEfficiency = computeEfficiency(olderFuelRecords)

    if (baselineEfficiency > 0 && recentEfficiency > 0) {
      const drift = Math.abs(recentEfficiency - baselineEfficiency) / baselineEfficiency * 100
      if (drift <= 5) fuelFactor = 100
      else if (drift <= 10) fuelFactor = 80
      else if (drift <= 15) fuelFactor = 60
      else fuelFactor = 40
    }
  } else if (recentFuelRecords.length > 0) {
    fuelFactor = 75
  }

  // Final weighted score
  const score = Math.round(
    (ageFactor * 0.20) +
    (mileageFactor * 0.20) +
    (maintenanceFactor * 0.35) +
    (fuelFactor * 0.25)
  )

  const grade = getGrade(score)

  const result: HealthScoreResult = {
    vehicleId,
    score,
    grade,
    mileageFactor,
    maintenanceFactor,
    fuelFactor,
    ageFactor,
    details: {
      vehicleAge,
      mileageKm,
      lastMaintenanceDate: lastMaintenance?.installationDate ?? null,
      recentMaintenanceCount: recentMaintenance.length,
      recentCost,
      recentFuelRecordCount: recentFuelRecords.length,
      vehicleStatus: vehicle.status,
    },
  }

  // Persist
  await prisma.vehicleHealthScore.create({
    data: {
      vehicleId,
      score: result.score,
      grade,
      mileageFactor,
      maintenanceFactor,
      fuelFactor,
      ageFactor,
      details: result.details,
    },
  })

  return result
}

export async function getLatestHealthScores(branchId?: string | { in: string[] }) {
  const vehicles = await prisma.vehicle.findMany({
    where: branchId ? { branchId } : {},
    include: {
      branch: { select: { name: true } },
      healthScores: {
        orderBy: { calculatedAt: 'desc' },
        take: 1,
      },
    },
  })

  return vehicles.map(v => ({
    vehicleId: v.id,
    registrationNumber: v.registrationNumber,
    brand: v.brand,
    model: v.model,
    branch: v.branch.name,
    status: v.status,
    latestScore: v.healthScores[0] ?? null,
  }))
}
