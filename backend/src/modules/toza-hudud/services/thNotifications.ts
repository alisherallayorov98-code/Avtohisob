import { sendToOrgAdmins } from '../../../services/telegramBot'
import { loadThSettings } from '../controllers/settings'
import { prisma } from '../../../lib/prisma'
import { signCoverageToken } from '../controllers/coverageMap'
import { getLastWeekStats } from './thDriverStats'
import type { AnomalyResult } from './thAnomalyDetector'
import { checkOverdueContainers } from './thContainerAnalytics'

interface MonitorResult {
  analyzed: number
  noGps: number
  noPolygon: number
  errors: string[]
}

interface DaySummary {
  visited: number
  notVisited: number
  total: number
}

/**
 * Kunlik monitoring tugagach tashkilot adminlariga Telegram xabar yuboradi.
 * notifyOnMonitorComplete = false bo'lsa — o'tkazib yuboriladi.
 */
export async function notifyMonitoringComplete(
  orgId: string,
  date: Date,
  result: MonitorResult,
  summary: DaySummary,
): Promise<void> {
  try {
    const settings = await loadThSettings(orgId)
    if (!settings.notifyOnMonitorComplete) return

    const coveragePct = summary.total > 0
      ? Math.round(summary.visited / summary.total * 100)
      : null

    const dateStr = date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' })

    const statusEmoji =
      coveragePct === null ? '⚪' :
      coveragePct >= (settings.coverageGreenPct ?? 80) ? '✅' :
      coveragePct >= (settings.coverageYellowPct ?? 50) ? '⚠️' : '❌'

    let msg = `${statusEmoji} <b>Toza-Hudud: ${dateStr}</b>\n\n`
    msg += `📊 Qamrov: <b>${coveragePct !== null ? coveragePct + '%' : '—'}</b>\n`
    msg += `✅ Borildi: <b>${summary.visited}</b>\n`
    msg += `❌ Borilmadi: <b>${summary.notVisited}</b>\n`

    if (result.noGps > 0) msg += `📡 GPS yo'q: ${result.noGps}\n`
    if (result.noPolygon > 0) msg += `⬛ Polygon yo'q: ${result.noPolygon}\n`

    if (result.errors.length > 0) {
      msg += `\n⚠️ Xatolar: ${result.errors.length} ta mashina\n`
      result.errors.slice(0, 3).forEach(e => {
        const short = e.length > 60 ? e.slice(0, 60) + '...' : e
        msg += `• ${short}\n`
      })
      if (result.errors.length > 3) msg += `• ...va yana ${result.errors.length - 3} ta\n`
    }

    if (settings.notifyOnLowCoverage && coveragePct !== null) {
      const minPct = settings.notifyMinCoveragePct ?? 60
      if (coveragePct < minPct) {
        msg += `\n🚨 <b>DIQQAT!</b> Qamrov ${minPct}% dan past (${coveragePct}%)\n`
        msg += `Borilmagan MFYlarni tekshiring!`
      }
    }

    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    // Bildirishnoma yuborilmasa monitoring to'xtamasligi kerak
    console.error('[thNotifications] notifyMonitoringComplete xatosi:', err?.message ?? err)
  }
}

/**
 * Har dushanba 09:00 UZT (04:00 UTC): o'tgan hafta haydovchi statistikasini
 * Telegram orqali tashkilot adminlariga yuboradi.
 */
export async function notifyWeeklyDriverReport(orgId: string): Promise<void> {
  try {
    const settings = await loadThSettings(orgId)
    if (!settings.notifyOnMonitorComplete) return

    const { avgCoveragePct, topDrivers, bottomDrivers, totalVehicles } = await getLastWeekStats(orgId)
    if (totalVehicles === 0) return

    const now = new Date()
    const uzDow = (now.getUTCDay() + 6) % 7  // 0=Du
    // O'tgan haftaning dushanba sanasini hisoblaymiz
    const daysBack = uzDow === 0 ? 7 : uzDow  // bugun dushanba bo'lsa — 7 kun orqaga
    const lastMon = new Date(now)
    lastMon.setUTCDate(now.getUTCDate() - daysBack)
    const lastSun = new Date(lastMon)
    lastSun.setUTCDate(lastMon.getUTCDate() + 6)

    const monStr = lastMon.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    const sunStr = lastSun.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', timeZone: 'UTC' })

    const statusEmoji = avgCoveragePct >= 80 ? '✅' : avgCoveragePct >= 50 ? '⚠️' : '❌'

    let msg = `📊 <b>Toza-Hudud: Haftalik hisobot</b>\n`
    msg += `📅 ${monStr} – ${sunStr}\n\n`
    msg += `${statusEmoji} O'rtacha qamrov: <b>${avgCoveragePct}%</b>\n`
    msg += `🚛 Tahlil qilindi: <b>${totalVehicles}</b> mashina\n`

    if (topDrivers.length > 0) {
      msg += `\n🏆 <b>Eng yaxshi haydovchilar:</b>\n`
      topDrivers.forEach((d, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : '🥉'
        msg += `${medal} ${d.registrationNumber} (${d.brand} ${d.model}) — <b>${d.weekCoveragePct}%</b>\n`
      })
    }

    if (bottomDrivers.length > 0) {
      msg += `\n⚠️ <b>Pastroq natija (&lt;70%):</b>\n`
      bottomDrivers.forEach(d => {
        msg += `• ${d.registrationNumber} (${d.brand} ${d.model}) — ${d.weekCoveragePct}%\n`
      })
    }

    if (avgCoveragePct < (settings.coverageYellowPct ?? 50)) {
      msg += `\n🚨 <b>DIQQAT!</b> Umumiy qamrov juda past. Haydovchilar bilan suhbat o'tkazish tavsiya etiladi.`
    }

    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    console.error('[thNotifications] notifyWeeklyDriverReport xatosi:', err?.message ?? err)
  }
}

/**
 * GPS sinxi uzilganda ogohlantirish (SettingsPage orqali chaqiriladi).
 */
export async function notifyGpsDisconnected(orgId: string, lastSyncAt: Date | null): Promise<void> {
  try {
    const settings = await loadThSettings(orgId)
    if (!settings.notifyOnMonitorComplete) return

    const lastSync = lastSyncAt
      ? lastSyncAt.toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
      : 'noma\'lum'

    const msg = `📡 <b>Toza-Hudud: GPS ulanishi uzildi</b>\n\nOxirgi sinx: ${lastSync}\nMonitoring to'g'ri ishlamasligi mumkin.`
    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    console.error('[thNotifications] notifyGpsDisconnected xatosi:', err?.message ?? err)
  }
}

/**
 * Ertalab 10:30 UZT da: bugun ishlashi kerak bo'lgan mashinalar orasida
 * GPS ma'lumoti yo'q bo'lganlarini topib admin(lar)ga Telegram xabar yuboradi.
 * notifyOnLowCoverage sozlamasi o'chirilgan bo'lsa — o'tkazib yuboriladi.
 */
export async function notifyLateVehicles(orgId: string, date: Date): Promise<void> {
  try {
    const settings = await loadThSettings(orgId)
    if (!settings.notifyOnLowCoverage) return  // Xabar sozlamasi o'chirilgan

    const uzDow = (date.getUTCDay() + 6) % 7  // 0=Du ... 6=Ya (UTC asosida, 10:30 UZT = 05:30 UTC)

    // Org ga tegishli filiallar
    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    }).catch(() => [] as { id: string }[])
    const branchIds = branches.map((b: any) => b.id)

    if (branchIds.length === 0) return

    // Bugun ishlashi kerak bo'lgan mashinalar (jadvalda bor)
    const schedules = await (prisma as any).thSchedule.findMany({
      where: {
        dayOfWeek: { has: uzDow },
        vehicleId: { in: (await prisma.vehicle.findMany({
          where: { branchId: { in: branchIds }, status: 'active' },
          select: { id: true },
        })).map(v => v.id) },
      },
      select: { vehicleId: true },
    }).catch(() => [] as { vehicleId: string }[])

    if (schedules.length === 0) return

    const scheduledVehicleIds = [...new Set<string>(schedules.map((s: any) => s.vehicleId as string))]
    const dateOnly = new Date(date.toISOString().split('T')[0] + 'T00:00:00.000Z')

    // GPS ma'lumoti yo'q mashinalar (hali birorta MFYga kirmagan)
    const tripsWithGps = await (prisma as any).thServiceTrip.findMany({
      where: {
        date: dateOnly,
        vehicleId: { in: scheduledVehicleIds },
        status: 'visited',
      },
      select: { vehicleId: true },
    }).catch(() => [] as { vehicleId: string }[])

    const visitedVehicleIds = new Set(tripsWithGps.map((t: any) => t.vehicleId as string))
    const notStartedIds = scheduledVehicleIds.filter(id => !visitedVehicleIds.has(id))

    if (notStartedIds.length === 0) return

    // Mashina nomlarini olish
    const vehicles = await prisma.vehicle.findMany({
      where: { id: { in: notStartedIds.slice(0, 10) } },
      select: { registrationNumber: true, brand: true, model: true },
    }).catch(() => [] as { registrationNumber: string; brand: string; model: string }[])

    const total = scheduledVehicleIds.length
    const notStarted = notStartedIds.length
    const pct = Math.round(notStarted / total * 100)

    let msg = `⏰ <b>Toza-Hudud: Ertalab holati (10:30 UZT)</b>\n\n`
    msg += `📊 Bugungi jadval: <b>${total}</b> mashina\n`
    msg += `✅ Boshlagan: <b>${total - notStarted}</b>\n`
    msg += `⚠️ Boshlamagan: <b>${notStarted}</b> (${pct}%)\n`

    if (vehicles.length > 0) {
      msg += `\nBoshlamagan mashinalar:\n`
      vehicles.forEach(v => {
        msg += `• ${v.registrationNumber} (${v.brand} ${v.model})\n`
      })
      if (notStartedIds.length > 10) {
        msg += `• ...va yana ${notStartedIds.length - 10} ta\n`
      }
    }

    if (pct >= 50) {
      msg += `\n🚨 <b>DIQQAT!</b> Mashinalarning yarmi hali boshlamagan!`
    }

    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    console.error('[thNotifications] notifyLateVehicles xatosi:', err?.message ?? err)
  }
}

/**
 * Haftalik jadval tugagach MFY qamrovi to'liq bo'lmasa haydovchiga xabar yuboradi.
 * dates — shu hafta ushbu MFY uchun grafik kunlar (ISO: "2026-05-07").
 * Qamrov notifyMinCoveragePct dan past bo'lsagina xabar ketadi.
 */
export async function notifyIncompleteCoverage(
  orgId: string,
  vehicleId: string,
  mfyId: string,
  coveragePct: number,
  dates: string[],
): Promise<void> {
  try {
    const settings = await loadThSettings(orgId)
    const minPct = settings.notifyMinCoveragePct ?? 60
    if (coveragePct >= minPct) return  // Qamrov yetarli — xabar shart emas

    const mfy = await (prisma as any).thMfy.findUnique({
      where: { id: mfyId },
      select: { name: true, district: { select: { name: true } } },
    }).catch(() => null)

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { registrationNumber: true, brand: true, model: true },
    }).catch(() => null)

    if (!mfy || !vehicle) return

    const token = signCoverageToken({ vehicleId, mfyId, orgId, dates })
    const baseUrl = process.env.CORS_ORIGIN?.split(',')[0]?.trim() || 'https://avtohisob.uz'
    const mapUrl = `${baseUrl}/th-coverage?token=${token}`

    const datesStr = dates.map(d => {
      const dow = ['Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh', 'Ya']
      const dt = new Date(d + 'T12:00:00Z')
      const uzDow = (dt.getUTCDay() + 6) % 7
      return `${dow[uzDow]} ${dt.getUTCDate()}-${dt.toLocaleString('uz-UZ', { month: 'short' })}`
    }).join(', ')

    const mfyName = mfy.name
    const distName = mfy.district?.name || ''
    const vehName = `${vehicle.registrationNumber} (${vehicle.brand} ${vehicle.model})`

    let msg = `🔴 <b>Toza-Hudud: Chala qoplangan MFY</b>\n\n`
    msg += `🚛 Mashina: <b>${vehName}</b>\n`
    msg += `📍 MFY: <b>${mfyName}</b>`
    if (distName) msg += ` (${distName})`
    msg += `\n📅 Kunlar: ${datesStr}\n`
    msg += `📊 Qamrov: <b>${coveragePct}%</b> (min ${minPct}% talab qilinadi)\n\n`
    msg += `Haydovchi ba'zi ko'chalarni o'tkazib yuborgan bo'lishi mumkin.\n`
    msg += `🗺 <a href="${mapUrl}">Xaritada ko'rish</a> — yashil: borildi, qizil: borilmadi`

    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    console.error('[thNotifications] notifyIncompleteCoverage xatosi:', err?.message ?? err)
  }
}

/**
 * Anomaliya batch natijalarini Telegram orqali yuboradi.
 * Faqat notifyOnLowCoverage yoniq bo'lsa ishlaydi.
 * 5 dan ortiq anomaliya bo'lsa — ro'yxatni qisqartiradi.
 */
export async function notifyAnomalyBatch(
  orgId: string,
  date: Date,
  results: AnomalyResult[],
): Promise<void> {
  if (results.length === 0) return
  try {
    const settings = await loadThSettings(orgId)
    if (!settings.notifyOnLowCoverage) return

    const dateStr = date.toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', timeZone: 'UTC' })
    const shown = results.slice(0, 5)

    let msg = `⚠️ <b>Toza-Hudud: Shubhali tashriflar — ${dateStr}</b>\n`
    msg += `Jami ${results.length} ta shubhali holat aniqlandi:\n\n`

    for (const r of shown) {
      const reasons: string[] = []
      if (r.flags.tooFast) reasons.push(`🏎 Juda tez (${Math.round(r.maxSpeedKmh ?? 0)} km/h)`)
      if (r.flags.timeTooShort) reasons.push(`⏱ Vaqt juda qisqa (${r.durationMin} daqiqa)`)
      if (r.flags.linearTrack) reasons.push(`📡 GPS to'g'ri chiziq (signal manipulyatsiyasi?)`)
      if (r.flags.edgeOnly) reasons.push(`⬛ Faqat chegara — ichiga kirmagan`)

      msg += `🚛 <b>${r.registrationNumber}</b> — ${r.mfyName}\n`
      reasons.forEach(reason => { msg += `   ${reason}\n` })
      msg += '\n'
    }

    if (results.length > 5) {
      msg += `...va yana ${results.length - 5} ta holat.\n`
    }

    msg += `Monitoring sahifasida batafsil ko'ring.`
    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    console.error('[thNotifications] notifyAnomalyBatch xatosi:', err?.message ?? err)
  }
}

/**
 * Har oyning 1-kuni 09:00 UZT: o'tgan oy uchun yig'ma xulosa yuboradi.
 * Jami qamrov %, eng yaxshi/zaif mashinalar, MFY hisoboti.
 */
export async function notifyMonthlyReport(orgId: string): Promise<void> {
  try {
    const settings = await loadThSettings(orgId)
    if (!settings.notifyOnMonitorComplete) return

    const now = new Date()
    // O'tgan oy
    const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0)  // O'tgan oyning oxirgi kuni
    const prevMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth(), 1)
    const nextMonthStart = new Date(prevMonthEnd.getFullYear(), prevMonthEnd.getMonth() + 1, 1)

    const monthNames = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
      'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']
    const monthName = monthNames[prevMonthStart.getMonth()]
    const year = prevMonthStart.getFullYear()

    // Org vehiclelari
    const branches = await (prisma as any).branch.findMany({
      where: { OR: [{ id: orgId }, { organizationId: orgId }] },
      select: { id: true },
    }).catch(() => [] as { id: string }[])
    const branchIds = branches.map((b: any) => b.id)
    if (branchIds.length === 0) return

    const vIds = await prisma.vehicle.findMany({
      where: { branchId: { in: branchIds }, status: 'active' },
      select: { id: true },
    }).then(vs => vs.map(v => v.id)).catch(() => [] as string[])
    if (vIds.length === 0) return

    const fromDate = new Date(prevMonthStart.toISOString().split('T')[0] + 'T00:00:00.000Z')
    const toDate = new Date(nextMonthStart.toISOString().split('T')[0] + 'T00:00:00.000Z')

    const [visited, notVisited, suspicious] = await Promise.all([
      (prisma as any).thServiceTrip.count({
        where: { vehicleId: { in: vIds }, date: { gte: fromDate, lt: toDate }, status: 'visited' },
      }).catch(() => 0),
      (prisma as any).thServiceTrip.count({
        where: { vehicleId: { in: vIds }, date: { gte: fromDate, lt: toDate }, status: 'not_visited' },
      }).catch(() => 0),
      (prisma as any).thServiceTrip.count({
        where: { vehicleId: { in: vIds }, date: { gte: fromDate, lt: toDate }, suspicious: true },
      }).catch(() => 0),
    ])

    const total = visited + notVisited
    const pct = total > 0 ? Math.round(visited / total * 100) : null
    const statusEmoji = pct === null ? '⚪' : pct >= 80 ? '✅' : pct >= 50 ? '⚠️' : '❌'

    let msg = `📊 <b>Toza-Hudud: ${monthName} ${year} — oylik xulosa</b>\n\n`
    msg += `${statusEmoji} Qamrov: <b>${pct !== null ? pct + '%' : '—'}</b>\n`
    msg += `✅ Bajarildi: <b>${visited}</b> ta tashrif\n`
    msg += `❌ Bajarilmadi: <b>${notVisited}</b> ta\n`
    if (suspicious > 0) msg += `⚠️ Shubhali: <b>${suspicious}</b> ta\n`
    msg += `🚛 Faol mashinalar: <b>${vIds.length}</b> ta\n`

    if (pct !== null && pct < (settings.coverageYellowPct ?? 50)) {
      msg += `\n🚨 <b>DIQQAT!</b> Oy davomida qamrov juda past bo'ldi.`
    }

    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    console.error('[thNotifications] notifyMonthlyReport xatosi:', err?.message ?? err)
  }
}

/**
 * Kechikkan konteynerlar haqida Telegram xabar yuboradi.
 * isOverdue = daysSinceLastVisit > avgIntervalDays * 1.5
 * notifyOnLowCoverage sozlamasi o'chirilgan bo'lsa — o'tkazib yuboriladi.
 */
export async function notifyOverdueContainers(orgId: string): Promise<void> {
  try {
    const settings = await loadThSettings(orgId)
    if (!settings.notifyOnLowCoverage) return

    const overdue = await checkOverdueContainers(orgId)
    if (overdue.length === 0) return

    const shown = overdue.slice(0, 8)
    let msg = `🗑 <b>Toza-Hudud: Kechikkan konteynerlar</b>\n`
    msg += `${overdue.length} ta konteyner o'z vaqtida tozalanmagan:\n\n`

    for (const c of shown) {
      const avg = c.avgIntervalDays !== null ? `har ${c.avgIntervalDays} kunda` : `birinchi marta`
      const since = c.daysSinceLastVisit !== null ? `${c.daysSinceLastVisit} kun oldin` : `hech qachon`
      msg += `📦 <b>${c.name}</b>`
      if (c.mfyName) msg += ` (${c.mfyName})`
      msg += `\n   Oxirgi: ${since} | O'rtacha: ${avg}\n`
    }

    if (overdue.length > 8) {
      msg += `\n...va yana ${overdue.length - 8} ta konteyner.`
    }

    msg += `\n\nKonteyner jadvalini tekshiring va tozalash ishlarini rejalashtiring.`
    await sendToOrgAdmins(orgId, msg)
  } catch (err: any) {
    console.error('[thNotifications] notifyOverdueContainers xatosi:', err?.message ?? err)
  }
}
