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
import { runDailyMonitoring } from '../modules/toza-hudud/services/thMonitor'

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
    // null = barcha orglar uchun qayta hisoblash (scheduler global job)
    await recalculateAll(null).catch(console.error)
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

  // Toza-Hudud: kunlik xizmat monitoringi — har kuni 20:00 UZT (15:00 UTC)
  cron.schedule('0 15 * * *', async () => {
    console.log('[Scheduler] Toza-Hudud: kunlik monitoring...')
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000)
    await runDailyMonitoring(yesterday).catch(console.error)
  })

  // Clean up expired blacklisted tokens + telegram link tokens daily at 6am
  cron.schedule('0 6 * * *', async () => {
    const { count } = await prisma.tokenBlacklist.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }).catch(() => ({ count: 0 }))
    const { count: tgCount } = await (prisma as any).telegramLinkToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }).catch(() => ({ count: 0 }))
    if (count + tgCount > 0) console.log(`[Scheduler] Cleaned up ${count} JWT + ${tgCount} Telegram tokens`)
  })

  // Obuna muddati tugaganlarni aniqlash — har kuni 02:30.
  // active + currentPeriodEnd o'tgan → past_due.
  // past_due holatida 7 kundan ko'p turganlar → expired.
  // Diqqat: user.isActive ga tegmaydi — foydalanuvchi kirib to'lashi uchun.
  cron.schedule('30 2 * * *', async () => {
    const now = new Date()
    const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)
    try {
      const toPastDue = await (prisma as any).subscription.updateMany({
        where: { status: 'active', currentPeriodEnd: { lt: now } },
        data: { status: 'past_due', updatedAt: now },
      })
      const toExpired = await (prisma as any).subscription.updateMany({
        where: { status: 'past_due', currentPeriodEnd: { lt: sevenDaysAgo } },
        data: { status: 'expired', updatedAt: now },
      })
      if (toPastDue.count + toExpired.count > 0) {
        console.log(`[Scheduler] Subscription expiry: ${toPastDue.count} → past_due, ${toExpired.count} → expired`)
      }
    } catch (e) {
      console.error('[Scheduler] Subscription expiry error:', e)
    }
  })

  console.log('[Scheduler] Started')
}
