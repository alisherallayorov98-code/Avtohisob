import { sendToOrgAdmins } from '../../../services/telegramBot'
import { loadThSettings } from '../controllers/settings'
import { prisma } from '../../../lib/prisma'

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

    const jsDow = date.getDay()
    const uzDow = (jsDow + 6) % 7  // 0=Du ... 6=Ya

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
