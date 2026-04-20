import { prisma } from '../lib/prisma'

export async function generateRecommendations(vehicleId?: string): Promise<void> {
  const where = vehicleId ? { id: vehicleId } : {}
  const vehicles = await prisma.vehicle.findMany({
    where: { ...where, status: { not: 'inactive' } },
    include: {
      healthScores: { orderBy: { calculatedAt: 'desc' }, take: 1 },
      anomalies: { where: { isResolved: false } },
      predictions: { where: { isAcknowledged: false, predictedDate: { gte: new Date() } }, orderBy: { predictedDate: 'asc' } },
      fuelRecords: { orderBy: { refuelDate: 'desc' }, take: 5 },
    },
  })

  for (const v of vehicles) {
    const latestScore = v.healthScores[0]

    // Recommendation 1: Critical health score
    if (latestScore && Number(latestScore.score) < 40) {
      await upsertRecommendation({
        vehicleId: v.id,
        type: 'maintenance',
        priority: 'critical',
        title: `${v.registrationNumber} kritik holat`,
        description: `Avtomobil health skori ${Number(latestScore.score).toFixed(0)} — darhol texnik xizmat kerak`,
        actionUrl: `/maintenance?vehicleId=${v.id}`,
      })
    } else if (latestScore && Number(latestScore.score) < 55) {
      await upsertRecommendation({
        vehicleId: v.id,
        type: 'maintenance',
        priority: 'high',
        title: `${v.registrationNumber} yomon holat`,
        description: `Avtomobil health skori ${Number(latestScore.score).toFixed(0)} — tez orada texnik xizmat kerak`,
        actionUrl: `/maintenance?vehicleId=${v.id}`,
      })
    }

    // Recommendation 2: Upcoming maintenance prediction
    const urgentPrediction = v.predictions.find(p => {
      const daysUntil = (p.predictedDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000)
      return daysUntil <= 14 && Number(p.confidence) >= 0.6
    })
    if (urgentPrediction) {
      const daysUntil = Math.ceil((urgentPrediction.predictedDate.getTime() - Date.now()) / (24 * 60 * 60 * 1000))
      await upsertRecommendation({
        vehicleId: v.id,
        type: 'maintenance',
        priority: daysUntil <= 7 ? 'high' : 'medium',
        title: `${v.registrationNumber} — ${urgentPrediction.partCategory} xizmati`,
        description: `${daysUntil} kun ichida ${urgentPrediction.partCategory} kategoriyasida texnik xizmat tavsiya etiladi (ishonch: ${(Number(urgentPrediction.confidence) * 100).toFixed(0)}%)`,
        actionUrl: `/maintenance?vehicleId=${v.id}`,
      })
    }

    // Recommendation 3: High severity anomalies
    const highAnomalies = v.anomalies.filter(a => a.severity === 'high')
    if (highAnomalies.length > 0) {
      const anomaly = highAnomalies[0]
      await upsertRecommendation({
        vehicleId: v.id,
        type: anomaly.type.includes('fuel') ? 'fuel' : 'maintenance',
        priority: 'high',
        title: `${v.registrationNumber} — anomaliya aniqlandi`,
        description: anomaly.description,
        actionUrl: `/anomalies?vehicleId=${v.id}`,
      })
    }

    // Recommendation 4: Old vehicle (>10 years) with high mileage
    const vehicleAge = new Date().getFullYear() - v.year
    if (vehicleAge > 10 && Number(v.mileage) > 150000) {
      await upsertRecommendation({
        vehicleId: v.id,
        type: 'replacement',
        priority: 'medium',
        title: `${v.registrationNumber} almashtirish tavsiyasi`,
        description: `Avtomobil ${vehicleAge} yoshda va ${Number(v.mileage).toLocaleString()} km bosib o'tgan — almashtirishni ko'rib chiqing`,
        actionUrl: `/vehicles`,
      })
    }
  }
}

// Priority darajasi — yuqori raqam = kuchli signal.
const PRIORITY_RANK: Record<string, number> = { critical: 4, high: 3, medium: 2, low: 1 }

async function upsertRecommendation(data: {
  vehicleId: string
  type: string
  priority: string
  title: string
  description: string
  actionUrl?: string
}) {
  // Dedup: bir xil (vehicleId, type) kombinatsiyasi bo'yicha 1 ta aktiv yozuv.
  // Agar yangi signal kuchliroq bo'lsa — mavjud yozuvni upgrade qilamiz
  // (dubl yaratmaymiz va past prioritetni tashlab yubormaymiz).
  const existing = await prisma.recommendation.findFirst({
    where: {
      vehicleId: data.vehicleId,
      type: data.type,
      isDismissed: false,
      expiresAt: { gt: new Date() },
    },
  })

  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) // 30 days

  if (existing) {
    const existingRank = PRIORITY_RANK[existing.priority] ?? 0
    const newRank = PRIORITY_RANK[data.priority] ?? 0
    if (newRank > existingRank) {
      // Yangi signal kuchliroq — mavjudni upgrade qilamiz.
      await prisma.recommendation.update({
        where: { id: existing.id },
        data: {
          priority: data.priority,
          title: data.title,
          description: data.description,
          actionUrl: data.actionUrl ?? existing.actionUrl,
          expiresAt,
        },
      })
    }
    // Teng yoki pastroq prioritet — mavjud yozuvga tegmaymiz.
    return
  }

  await prisma.recommendation.create({
    data: { ...data, expiresAt },
  })
}
