import { sendToOrgAdmins } from '../../../services/telegramBot'
import { loadThSettings } from '../controllers/settings'

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
