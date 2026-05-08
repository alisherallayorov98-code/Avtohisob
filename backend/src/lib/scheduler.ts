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
import { syncAllGpsCredentials, syncContainersFromGps, checkAllCredentials } from '../services/wialonService'
import { notifyGpsDisconnected } from '../modules/toza-hudud/services/thNotifications'
import { runDailyMonitoring } from '../modules/toza-hudud/services/thMonitor'
import { notifyMonitoringComplete, notifyLateVehicles, notifyIncompleteCoverage, notifyWeeklyDriverReport, notifyAnomalyBatch, notifyOverdueContainers, notifyMonthlyReport } from '../modules/toza-hudud/services/thNotifications'
import { updateAllDriverStats } from '../modules/toza-hudud/services/thDriverStats'
import { runAnomalyBatch } from '../modules/toza-hudud/services/thAnomalyDetector'
import {
  broadcastDailySummary,
  broadcastWeeklySummary,
  broadcastPendingApprovals,
} from '../services/telegramCommands'
import { cleanupExpiredArchive } from '../services/archiveService'
import { cleanupOldFuelReadings } from './fuelAnomalyDetector'

/**
 * Bugun haftalik grafik bo'yicha oxirgi ish kuni bo'lgan vehicle+MFY juftliklari uchun
 * shu haftalik barcha kunlardagi trekni yig'ib qamrovni tekshiradi.
 * Qamrov yetarli bo'lmagan juftliklar uchun Telegram xabar yuboradi.
 */
async function checkWeeklyCoverageGaps(orgId: string, today: Date, vIds: string[]): Promise<void> {
  if (vIds.length === 0) return

  // 20:00 UZT = 15:00 UTC — UTC va UZT bir xil kalendar kunga to'g'ri keladi
  const uzDow = (today.getUTCDay() + 6) % 7  // 0=Du ... 6=Ya (UTC asosida)

  // Bugun grafigi bo'lgan jadvallarni olamiz
  const schedules = await (prisma as any).thSchedule.findMany({
    where: {
      vehicleId: { in: vIds },
      dayOfWeek: { has: uzDow },
    },
    select: { vehicleId: true, mfyId: true, dayOfWeek: true },
  }).catch(() => [] as any[])

  if (schedules.length === 0) return

  // Haftalik sana oralig'i (Dushanba dan Yakshanba gacha) — UTC asosida
  const weekStart = new Date(today)
  weekStart.setUTCDate(weekStart.getUTCDate() - uzDow)  // uzDow=0 → Dushanba
  weekStart.setUTCHours(0, 0, 0, 0)

  for (const sched of schedules) {
    try {
      const days: number[] = sched.dayOfWeek  // [0,2] = Du, Ch
      const maxDay = Math.max(...days)

      // Bugun oxirgi ish kuni emasmi? Kechiktirish kerak emas.
      if (uzDow !== maxDay) continue

      // Shu hafta ushbu jadval uchun barcha sanalar
      const scheduledDates: string[] = days.map(d => {
        const dt = new Date(weekStart)
        dt.setUTCDate(dt.getUTCDate() + d)
        return dt.toISOString().split('T')[0]
      })

      // DB dan yig'ma coveragePct ni olamiz (har kun alohida saqlangan)
      const trips = await (prisma as any).thServiceTrip.findMany({
        where: {
          vehicleId: sched.vehicleId,
          mfyId: sched.mfyId,
          date: { in: scheduledDates.map(d => new Date(d + 'T00:00:00.000Z')) },
          status: 'visited',
        },
        select: { coveragePct: true, date: true },
      }).catch(() => [] as any[])

      if (trips.length === 0) continue  // Birorta ham borilmagan — boshqa bildirishnoma bor

      // Kunlik coveragePct larning o'rtacha yig'indisi haftalik qamrovni taxminan beradi
      // Aniq hisob uchun DB ga saqlangan pct ni ishlatamiz
      const avgPct = Math.round(trips.reduce((s: number, t: any) => s + (t.coveragePct ?? 0), 0) / days.length)

      await notifyIncompleteCoverage(
        orgId,
        sched.vehicleId,
        sched.mfyId,
        avgPct,
        scheduledDates,
      )
    } catch (e: any) {
      console.error(`[Scheduler] TH coverage-gap vehicleId=${sched.vehicleId} mfyId=${sched.mfyId}:`, e?.message)
    }
  }
}

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

  // GPS credential sog'liq tekshiruvi — har kuni 08:00 UTC (13:00 UZT)
  // Ulanish uzilgan bo'lsa Telegram'ga xabar yuboriladi
  cron.schedule('0 8 * * *', async () => {
    console.log('[Scheduler] GPS credential health check...')
    try {
      const results = await checkAllCredentials()
      for (const r of results) {
        if (!r.ok) {
          console.warn(`[Scheduler] GPS health xatosi orgId=${r.orgId}: ${r.error}`)
          await notifyGpsDisconnected(r.orgId, null).catch(() => {})
        }
      }
    } catch (e: any) {
      console.error('[Scheduler] GPS health check xatosi:', e?.message)
    }
  })

  // Toza-Hudud: kunlik xizmat monitoringi — har kuni 20:00 UZT (15:00 UTC)
  // Har bir org alohida tahlil qilinadi va Telegram bildirishnoma yuboriladi
  cron.schedule('0 15 * * *', async () => {
    console.log('[Scheduler] Toza-Hudud: kunlik monitoring...')
    const today = new Date()

    try {
      // Toza-Hudud moduliga obuna bo'lgan tashkilotlar
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      if (subs.length === 0) {
        // Obuna tizimi ishlatilmasa — global run (single-tenant yoki dev)
        await runDailyMonitoring(today).catch(console.error)
        return
      }

      for (const sub of subs) {
        const orgId = sub.organizationId
        try {
          const result = await runDailyMonitoring(today, orgId)
          console.log(`[Scheduler] TH org=${orgId}: analyzed=${result.analyzed} noGps=${result.noGps}`)

          // Kunlik statistikani DB dan olish (count() xatolikka chidamli)
          const dateOnly = new Date(today.toISOString().split('T')[0] + 'T00:00:00.000Z')
          const branches = await (prisma as any).branch.findMany({
            where: { OR: [{ id: orgId }, { organizationId: orgId }] },
            select: { id: true },
          }).catch(() => [] as { id: string }[])
          const branchIds = branches.map((b: any) => b.id)
          const vIds = branchIds.length
            ? await prisma.vehicle.findMany({ where: { branchId: { in: branchIds } }, select: { id: true } })
                .then(vs => vs.map(v => v.id)).catch(() => [] as string[])
            : [] as string[]

          if (vIds.length > 0) {
            const scope = { date: dateOnly, vehicleId: { in: vIds } }
            const [visited, notVisited] = await Promise.all([
              (prisma as any).thServiceTrip.count({ where: { ...scope, status: 'visited' } }).catch(() => 0),
              (prisma as any).thServiceTrip.count({ where: { ...scope, status: { in: ['not_visited', 'no_gps', 'no_polygon'] } } }).catch(() => 0),
            ])
            await notifyMonitoringComplete(orgId, today, result, {
              visited,
              notVisited,
              total: visited + notVisited,
            })

            // Ko'cha darajasidagi qamrov tekshiruvi:
            // Bugun haftalik grafik bo'yicha oxirgi kun bo'lgan vehicle+MFY juftliklari uchun
            // yig'ma qamrovni tekshiramiz va chala qolganlar uchun Telegram xabar yuboramiz.
            await checkWeeklyCoverageGaps(orgId, today, vIds).catch((e: any) =>
              console.error(`[Scheduler] TH coverage-gaps org=${orgId}:`, e?.message)
            )

            // Haydovchi statistikasini yangilash (haftalik/oylik qamrov, streak, reyting)
            await updateAllDriverStats(orgId).catch((e: any) =>
              console.error(`[Scheduler] TH driver-stats org=${orgId}:`, e?.message)
            )

            // Anomaliya tahlili: visited triplar uchun 4 ta tekshiruv + Telegram
            const anomalies = await runAnomalyBatch(orgId, today).catch((e: any) => {
              console.error(`[Scheduler] TH anomaly org=${orgId}:`, e?.message)
              return []
            })
            if (anomalies.length > 0) {
              console.log(`[Scheduler] TH anomaly org=${orgId}: ${anomalies.length} ta shubhali trip`)
              await notifyAnomalyBatch(orgId, today, anomalies).catch((e: any) =>
                console.error(`[Scheduler] TH anomaly-notify org=${orgId}:`, e?.message)
              )
            }
          }
        } catch (orgErr: any) {
          console.error(`[Scheduler] TH org=${orgId} xatosi:`, orgErr?.message ?? orgErr)
        }
      }
    } catch (err: any) {
      console.error('[Scheduler] Toza-Hudud monitoring umumiy xatosi:', err?.message ?? err)
    }
  })

  // ── Toza-Hudud: AVTOMATIK ishlar ─────────────────────────────────────────────

  // Kun davomida har 2 soatda monitoring yangilanadi (hech qanday tugma bosmasdan)
  // 06:00, 08:00, 10:00, 12:00, 14:00, 16:00, 18:00 UZT = 01:00..13:00 UTC
  // 20:00 UZT da allaqachon alohida cron ishlaydi — uni bu yerdan o'tkazib yuboramiz
  cron.schedule('0 1,3,5,7,9,11,13 * * *', async () => {
    const hour = new Date().getUTCHours()
    console.log(`[Scheduler] Toza-Hudud: oraliq monitoring (${hour}:00 UTC = ${hour + 5}:00 UZT)...`)
    const today = new Date()

    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      const orgIds: string[] = subs.length > 0
        ? subs.map((s: any) => s.organizationId)
        : [] // single-tenant: global run

      if (orgIds.length === 0) {
        const r = await runDailyMonitoring(today).catch(() => null)
        if (r) console.log(`[Scheduler] TH global: analyzed=${r.analyzed} noGps=${r.noGps}`)
        return
      }

      for (const orgId of orgIds) {
        try {
          const r = await runDailyMonitoring(today, orgId)
          console.log(`[Scheduler] TH org=${orgId}: analyzed=${r.analyzed} noGps=${r.noGps}`)
        } catch (e: any) {
          console.error(`[Scheduler] TH intraday org=${orgId}:`, e?.message)
        }
      }
    } catch (e: any) {
      console.error('[Scheduler] TH intraday xatosi:', e?.message)
    }
  })

  // Ertalab ogohlantirish — 10:30 UZT (05:30 UTC)
  // Bugun ishlashi kerak bo'lgan mashinalar orasida GPS yo'q bo'lsa Telegram xabar
  cron.schedule('30 5 * * *', async () => {
    console.log('[Scheduler] Toza-Hudud: kech yoki GPS yo\'q mashinalar tekshirilmoqda...')
    const today = new Date()
    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      for (const sub of subs) {
        await notifyLateVehicles(sub.organizationId, today).catch((e: any) =>
          console.error(`[Scheduler] TH late-vehicles org=${sub.organizationId}:`, e?.message)
        )
      }
    } catch (e: any) {
      console.error('[Scheduler] TH ertalab ogohlantirish xatosi:', e?.message)
    }
  })

  // Toza-Hudud: haftalik haydovchi samaradorlik hisoboti — har dushanba 09:00 UZT (04:00 UTC)
  cron.schedule('0 4 * * 1', async () => {
    console.log('[Scheduler] Toza-Hudud: haftalik haydovchi hisoboti...')
    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      for (const sub of subs) {
        await notifyWeeklyDriverReport(sub.organizationId).catch((e: any) =>
          console.error(`[Scheduler] TH weekly-driver-report org=${sub.organizationId}:`, e?.message)
        )
      }
    } catch (e: any) {
      console.error('[Scheduler] TH haftalik haydovchi hisoboti xatosi:', e?.message)
    }
  })

  // Konteyner GPS sinxi — har kuni 02:00 UZT (21:00 UTC oldingi kun)
  // GPS geozonadagi yangi konteynerlar avtomatik qo'shiladi
  cron.schedule('0 21 * * *', async () => {
    console.log('[Scheduler] Toza-Hudud: konteyner GPS sinxi...')
    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      for (const sub of subs) {
        try {
          const r = await syncContainersFromGps(sub.organizationId)
          if (r.created > 0 || r.updated > 0) {
            console.log(`[Scheduler] TH containers org=${sub.organizationId}: +${r.created} yangi, ${r.updated} yangilandi`)
          }
        } catch (e: any) {
          console.error(`[Scheduler] TH container-sync org=${sub.organizationId}:`, e?.message)
        }
      }
    } catch (e: any) {
      console.error('[Scheduler] TH konteyner sinxi xatosi:', e?.message)
    }
  })

  // Oylik xulosa — har oyning 1-kuni 09:00 UZT (04:00 UTC)
  cron.schedule('0 4 1 * *', async () => {
    console.log('[Scheduler] Toza-Hudud: oylik xulosa Telegram...')
    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      for (const sub of subs) {
        await notifyMonthlyReport(sub.organizationId).catch((e: any) =>
          console.error(`[Scheduler] TH monthly-report org=${sub.organizationId}:`, e?.message)
        )
      }
    } catch (e: any) {
      console.error('[Scheduler] TH oylik xulosa xatosi:', e?.message)
    }
  })

  // Kechikkan konteynerlar tekshiruvi — GPS sinxidan 30 daqiqa keyin (21:30 UTC = 02:30 UZT)
  cron.schedule('30 21 * * *', async () => {
    console.log('[Scheduler] Toza-Hudud: kechikkan konteynerlar tekshirilmoqda...')
    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      for (const sub of subs) {
        await notifyOverdueContainers(sub.organizationId).catch((e: any) =>
          console.error(`[Scheduler] TH overdue-containers org=${sub.organizationId}:`, e?.message)
        )
      }
    } catch (e: any) {
      console.error('[Scheduler] TH kechikkan konteyner tekshiruvi xatosi:', e?.message)
    }
  })

  // ─────────────────────────────────────────────────────────────────────────────

  // Telegram: kunlik xulosa — har kuni 08:00 UZT (03:00 UTC)
  cron.schedule('0 3 * * *', async () => {
    console.log('[Scheduler] Telegram: kunlik xulosa...')
    await broadcastDailySummary().catch(console.error)
  })

  // Telegram: haftalik xulosa — har dushanba 08:30 UZT (03:30 UTC)
  cron.schedule('30 3 * * 1', async () => {
    console.log('[Scheduler] Telegram: haftalik xulosa...')
    await broadcastWeeklySummary().catch(console.error)
  })

  // Telegram: tasdiqlash kutmoqda eslatmasi — har kuni 09:00 UZT (04:00 UTC)
  cron.schedule('0 4 * * *', async () => {
    console.log('[Scheduler] Telegram: tasdiqlash eslatmasi...')
    await broadcastPendingApprovals().catch(console.error)
  })

  // Arxiv tozalash — har kuni 03:00 UZT (22:00 UTC oldingi kun)
  cron.schedule('0 22 * * *', async () => {
    console.log('[Scheduler] Arxiv: eskilarni tozalash...')
    const count = await cleanupExpiredArchive().catch(() => 0)
    if (count > 0) console.log(`[Scheduler] Arxiv: ${count} ta yozuv tozalandi`)
  })

  // FuelReading snapshot'larini tozalash — 30 kundan eski yozuvlar (kuniga 03:30 UZT)
  // Sabab: 80 ta mashina × har 30s = 230k+ yozuv/kun. 30 kundan keyin grafikga keraksiz.
  cron.schedule('30 22 * * *', async () => {
    console.log('[Scheduler] FuelReading: eski snapshotlarni tozalash...')
    const { deleted } = await cleanupOldFuelReadings().catch(() => ({ deleted: 0 }))
    if (deleted > 0) console.log(`[Scheduler] FuelReading: ${deleted} ta yozuv tozalandi`)
  })

  // Clean up expired blacklisted tokens + telegram link tokens + alert dedupe daily at 6am
  cron.schedule('0 6 * * *', async () => {
    const { count } = await prisma.tokenBlacklist.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }).catch(() => ({ count: 0 }))
    const { count: tgCount } = await (prisma as any).telegramLinkToken.deleteMany({
      where: { expiresAt: { lt: new Date() } },
    }).catch(() => ({ count: 0 }))
    // Dedup yozuvlari 24 soatdan keyin foydasiz — eskilarini o'chiramiz
    const { count: dedupCount } = await (prisma as any).telegramAlertDedupe.deleteMany({
      where: { sentAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
    }).catch(() => ({ count: 0 }))
    if (count + tgCount + dedupCount > 0) {
      console.log(`[Scheduler] Cleaned up ${count} JWT + ${tgCount} TG link + ${dedupCount} alert dedupe`)
    }
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
