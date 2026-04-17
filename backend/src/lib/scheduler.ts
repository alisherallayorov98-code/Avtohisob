import cron from 'node-cron'
import { prisma } from './prisma'
import { calculateHealthScore } from '../services/healthScoreService'
import { detectFleetAnomalies } from '../services/anomalyDetectionService'
import { generateRecommendations } from '../services/recommendationsEngine'
import { runFleetForecasting } from '../services/forecastingService'
import { computeFuelMetrics } from '../services/fuelAnalyticsService'
import { recalculateAll } from '../services/sparePartStatsService'
import { checkVehicleDocumentExpiry } from './smartAlerts'
import { checkMissingMonthlyInspections } from '../controllers/techInspections'
import { syncAllGpsCredentials } from '../services/wialonService'

export function startScheduler() {
  // Recalculate health scores every 4 hours
  cron.schedule('0 */4 * * *', async () => {
    console.log('[Scheduler] Recalculating health scores...')
    const vehicles = await prisma.vehicle.findMany({ where: { status: 'active' }, select: { id: true } })
    for (const v of vehicles) {
      await calculateHealthScore(v.id).catch(console.error)
    }
  })

  // Compute fuel metrics daily at 1am
  cron.schedule('0 1 * * *', async () => {
    console.log('[Scheduler] Computing fuel metrics...')
    const vehicles = await prisma.vehicle.findMany({ where: { status: 'active' }, select: { id: true } })
    for (const v of vehicles) {
      await computeFuelMetrics(v.id, 30).catch(console.error)
    }
  })

  // Detect anomalies daily at 2am
  cron.schedule('0 2 * * *', async () => {
    console.log('[Scheduler] Detecting anomalies...')
    await detectFleetAnomalies().catch(console.error)
  })

  // Generate recommendations daily at 3am
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduler] Generating recommendations...')
    await generateRecommendations().catch(console.error)
  })

  // Run forecasting daily at 4am
  cron.schedule('0 4 * * *', async () => {
    console.log('[Scheduler] Running forecasting...')
    await runFleetForecasting().catch(console.error)
  })

  // Recalculate spare part statistics daily at 5am
  cron.schedule('0 5 * * *', async () => {
    console.log('[Scheduler] Recalculating spare part statistics...')
    await recalculateAll().catch(console.error)
  })

  // Oylik texnik tekshiruv — har oy 5-sanasi 09:00 da (bir necha kun o'tib tekshirilsin)
  cron.schedule('0 9 5 * *', async () => {
    console.log('[Scheduler] Checking missing monthly inspections...')
    await checkMissingMonthlyInspections().catch(console.error)
  })

  // #3: Texosmotr / sug'urta muddati tekshiruvi har kuni 8da
  cron.schedule('0 8 * * *', async () => {
    console.log('[Scheduler] Checking vehicle document expiry...')
    await checkVehicleDocumentExpiry().catch(console.error)
  })

  // GPS mileage sync — har 6 soatda
  cron.schedule('0 */6 * * *', async () => {
    console.log('[Scheduler] Syncing GPS mileage...')
    await syncAllGpsCredentials().catch(console.error)
  })

  // Clean up expired blacklisted tokens daily at 6am
  cron.schedule('0 6 * * *', async () => {
    const { count } = await prisma.tokenBlacklist.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }).catch(() => ({ count: 0 }))
    if (count > 0) console.log(`[Scheduler] Cleaned up ${count} expired tokens`)
  })

  console.log('[Scheduler] Started')
}
