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
import { syncAllGpsCredentials, syncContainersFromGps, syncMfyPolygonsFromGps, checkAllCredentials } from '../services/wialonService'
import { notifyGpsDisconnected } from '../modules/toza-hudud/services/thNotifications'
import { runDailyMonitoring } from '../modules/toza-hudud/services/thMonitor'
import { runIncrementalTraining, invalidateFingerprintCache } from '../modules/toza-hudud/services/thCoverageAI'
import { notifyMonitoringComplete, notifyLateVehicles, notifyIncompleteCoverageBatch, notifyWeeklyDriverReport, notifyAnomalyBatch, notifyOverdueContainers, notifyMonthlyReport, notifyEmptySchedules, notifySetupIssues } from '../modules/toza-hudud/services/thNotifications'
import { updateAllDriverStats } from '../modules/toza-hudud/services/thDriverStats'
import { runWorkSessionsForDate } from '../modules/toza-hudud/services/thWorkSession'
import { runAnomalyBatch } from '../modules/toza-hudud/services/thAnomalyDetector'
import {
  broadcastDailySummary,
  broadcastWeeklySummary,
  broadcastPendingApprovals,
} from '../services/telegramCommands'
import { cleanupExpiredArchive } from '../services/archiveService'
import { cleanupOldFuelReadings } from './fuelAnomalyDetector'
import { cleanupOldEvidence, cleanupOrphanedFiles, checkDiskAndNotify } from '../services/storageCleanup'

/**
 * Bugun haftalik grafik bo'yicha oxirgi ish kuni bo'lgan vehicle+MFY juftliklari uchun
 * shu haftalik barcha kunlardagi trekni yig'ib qamrovni tekshiradi.
 * Qamrov yetarli bo'lmagan juftliklar uchun Telegram xabar yuboradi.
 */
async function checkWeeklyCoverageGaps(orgId: string, today: Date, vIds: string[]): Promise<void> {
  if (vIds.length === 0) return

  const uzDow = (today.getUTCDay() + 6) % 7  // 0=Du ... 6=Ya

  const schedules = await (prisma as any).thSchedule.findMany({
    where: { vehicleId: { in: vIds }, dayOfWeek: { has: uzDow } },
    select: { vehicleId: true, mfyId: true, dayOfWeek: true },
  }).catch(() => [] as any[])

  if (schedules.length === 0) return

  const weekStart = new Date(today)
  weekStart.setUTCDate(weekStart.getUTCDate() - uzDow)
  weekStart.setUTCHours(0, 0, 0, 0)

  // Oxirgi ish kuni bo'lgan jadvallarni aniqlaymiz, so'ng BARCHA coveragePct larni
  // BITTA so'rovda yuklaymiz — N+1 dan qochamiz
  const finalDayScheds = schedules.filter((s: any) => {
    const days: number[] = s.dayOfWeek
    return days.length > 0 && Math.max(...days) === uzDow
  })
  if (finalDayScheds.length === 0) return

  // Barcha tegishli sanalar to'plamini quramiz
  const allDates: Date[] = []
  const schedDateMap = new Map<string, string[]>()  // "vehicleId::mfyId" → scheduledDates[]

  for (const sched of finalDayScheds) {
    const days: number[] = sched.dayOfWeek
    const scheduledDates = days.map((d: number) => {
      const dt = new Date(weekStart)
      dt.setUTCDate(dt.getUTCDate() + d)
      return dt.toISOString().split('T')[0]
    })
    schedDateMap.set(`${sched.vehicleId}::${sched.mfyId}`, scheduledDates)
    scheduledDates.forEach(d => allDates.push(new Date(d + 'T00:00:00.000Z')))
  }

  // Bitta so'rovda barcha trip natijalarini olamiz
  const allTrips = await (prisma as any).thServiceTrip.findMany({
    where: {
      vehicleId: { in: finalDayScheds.map((s: any) => s.vehicleId) },
      date: { in: [...new Set(allDates.map(d => d.toISOString()))] .map(s => new Date(s)) },
      status: 'visited',
    },
    select: { vehicleId: true, mfyId: true, coveragePct: true, date: true },
  }).catch(() => [] as any[])

  // vehicleId::mfyId::dateStr → coveragePct
  const tripMap = new Map<string, number>()
  for (const t of allTrips) {
    const key = `${t.vehicleId}::${t.mfyId}::${new Date(t.date).toISOString().split('T')[0]}`
    tripMap.set(key, t.coveragePct ?? 0)
  }

  // Har jadval uchun o'rtacha qamrovni hisoblaymiz — Telegram spamsiz
  const lowCoveragePairs: Array<{ vehicleId: string; mfyId: string; avgPct: number; scheduledDates: string[] }> = []

  for (const sched of finalDayScheds) {
    const scheduledDates = schedDateMap.get(`${sched.vehicleId}::${sched.mfyId}`) ?? []
    const days: number[] = sched.dayOfWeek
    const covPcts = scheduledDates
      .map(d => tripMap.get(`${sched.vehicleId}::${sched.mfyId}::${d}`) ?? null)
      .filter((v): v is number => v !== null)

    if (covPcts.length === 0) continue  // Birorta ham borilmagan — boshqa bildirishnoma bor

    const avgPct = Math.round(covPcts.reduce((s, v) => s + v, 0) / days.length)
    lowCoveragePairs.push({ vehicleId: sched.vehicleId, mfyId: sched.mfyId, avgPct, scheduledDates })
  }

  // BITTA yig'ma xabar (har juftlik uchun alohida emas)
  await notifyIncompleteCoverageBatch(orgId, lowCoveragePairs).catch((e: any) =>
    console.error(`[Scheduler] TH coverage-batch org=${orgId}:`, e?.message)
  )
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

          // Jadval kiritilmagan bo'lsa adminni xabardor qilish
          if (vIds.length > 0 && result.analyzed === 0 && result.noGps === 0 && result.noPolygon === 0) {
            const scheduleCount = await (prisma as any).thSchedule.count({
              where: { vehicleId: { in: vIds } },
            }).catch(() => -1)
            if (scheduleCount === 0) {
              await notifyEmptySchedules(orgId, vIds.length).catch((e: any) =>
                console.error(`[Scheduler] TH empty-schedules org=${orgId}:`, e?.message)
              )
            }
          }

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

            // GPS va polygon muammolari bo'lsa adminni yo'naltirish
            const totalPairs = result.analyzed + result.noGps + result.noPolygon
            if (totalPairs > 0 && (result.noGps + result.noPolygon) > 0) {
              await notifySetupIssues(orgId, result.noGps, result.noPolygon, totalPairs).catch((e: any) =>
                console.error(`[Scheduler] TH setup-issues org=${orgId}:`, e?.message)
              )
            }

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

            // Ish vaqti sessiyasini saqlash (workTrackingEnabled bo'lsa)
            await runWorkSessionsForDate(orgId, today.toISOString().split('T')[0]).catch((e: any) =>
              console.error(`[Scheduler] TH work-sessions org=${orgId}:`, e?.message)
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

  // Konteyner GPS sinxi + MFY polygon auto-yangilash — har kuni 02:00 UZT (21:00 UTC oldingi kun)
  // GPS geozonadagi yangi konteynerlar + MFY chegaralari avtomatik yangilanadi
  cron.schedule('0 21 * * *', async () => {
    console.log('[Scheduler] Toza-Hudud: konteyner GPS sinxi + MFY polygon yangilash...')
    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      for (const sub of subs) {
        // Konteyner sinxi
        try {
          const r = await syncContainersFromGps(sub.organizationId)
          if (r.created > 0 || r.updated > 0) {
            console.log(`[Scheduler] TH containers org=${sub.organizationId}: +${r.created} yangi, ${r.updated} yangilandi`)
          }
        } catch (e: any) {
          console.error(`[Scheduler] TH container-sync org=${sub.organizationId}:`, e?.message)
        }

        // MFY polygon auto-sinxi (gpsZoneName mavjud MFYlar uchun)
        try {
          const r = await syncMfyPolygonsFromGps(sub.organizationId)
          if (r.updated > 0) {
            console.log(`[Scheduler] TH mfy-polygons org=${sub.organizationId}: ${r.updated} ta yangilandi (${r.total} ta zona)`)
          }
        } catch (e: any) {
          console.error(`[Scheduler] TH mfy-polygon-sync org=${sub.organizationId}:`, e?.message)
        }
      }
    } catch (e: any) {
      console.error('[Scheduler] TH GPS sinxi xatosi:', e?.message)
    }
  })

  // AI Coverage Fingerprint: oylik inkremental yangilanish — har oy 1-kuni 02:00 UTC (07:00 UZT)
  // To'liq 6 oy o'qitish emas — faqat o'tgan oyni qo'shadi (tez, ~10 daqiqa)
  cron.schedule('0 2 1 * *', async () => {
    console.log('[Scheduler] Toza-Hudud: AI fingerprint oylik yangilanish...')
    try {
      const subs = await (prisma as any).subscription.findMany({
        where: { status: 'active', features: { has: 'tozahudud_module' } },
        select: { organizationId: true },
      }).catch(() => [] as { organizationId: string }[])

      for (const sub of subs) {
        try {
          const r = await runIncrementalTraining(sub.organizationId, 1)
          console.log(`[Scheduler] AI fingerprint org=${sub.organizationId}: +${r.processed} juftlik`)
          invalidateFingerprintCache()
        } catch (e: any) {
          console.error(`[Scheduler] AI fingerprint org=${sub.organizationId}:`, e?.message)
        }
      }
    } catch (e: any) {
      console.error('[Scheduler] AI fingerprint xatosi:', e?.message)
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

  // Evidence tozalash — har oy 1-kuni 01:00 UZT (20:00 UTC oldingi kun)
  // 6+ oy oldin approved/rejected maintenance evidencelarini o'chiradi
  cron.schedule('0 20 1 * *', async () => {
    console.log('[Scheduler] Storage: eski evidence fayllarni tozalash...')
    const { deletedFiles, freedMB } = await cleanupOldEvidence(6).catch(() => ({ deletedFiles: 0, freedMB: 0 }))
    if (deletedFiles > 0) console.log(`[Scheduler] Storage: ${deletedFiles} ta fayl o'chirildi, ${freedMB} MB bo'shadi`)

    // Yetim fayllarni ham shu payt tozalaymiz
    const orphan = await cleanupOrphanedFiles().catch(() => ({ deletedFiles: 0, freedMB: 0 }))
    if (orphan.deletedFiles > 0) console.log(`[Scheduler] Storage: ${orphan.deletedFiles} ta yetim fayl o'chirildi, ${orphan.freedMB} MB`)
  })

  // Disk monitoringi — har dushanba 09:00 UZT (04:00 UTC)
  // 75% → sariq ogohlantirish, 90% → qizil Telegram xabar
  cron.schedule('0 4 * * 1', async () => {
    await checkDiskAndNotify().catch(console.error)
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
