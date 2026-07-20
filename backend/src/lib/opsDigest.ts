// Kunlik operatsion xulosa — faqat egaga (siz), mijozlarga ko'rinmaydi.
// FAQAT O'QIYDI: sonlarni sanaydi va backup faylining sanasini tekshiradi.
// Hech qanday yozish/o'chirish yo'q — Sarlavha [[project_uzbekistan_data_law]]
// talabiga mos, ma'lumot tashqariga chiqmaydi (faqat sonlar Telegram'ga ketadi).
import fs from 'fs'
import path from 'path'
import { prisma } from './prisma'
import { alertDigest, getAndResetErrorCount, opsAlertStatus } from './opsAlert'

const processStartedAt = Date.now()

function formatUptime(ms: number): string {
  const h = Math.floor(ms / 3600000)
  const d = Math.floor(h / 24)
  if (d > 0) return `${d}k ${h % 24}s`
  return `${h}s ${Math.floor((ms % 3600000) / 60000)}d`
}

/** Backup papkasidagi eng yangi .dump faylining yoshini soatda qaytaradi (topilmasa null). */
function latestBackupAgeHours(): number | null {
  const dir = process.env.BACKUP_DIR || '/home/alisher/backups/db'
  try {
    if (!fs.existsSync(dir)) return null
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.dump'))
    if (files.length === 0) return null
    let newest = 0
    for (const f of files) {
      const stat = fs.statSync(path.join(dir, f))
      if (stat.mtimeMs > newest) newest = stat.mtimeMs
    }
    return (Date.now() - newest) / 3600000
  } catch {
    return null
  }
}

/** Har kuni chaqiriladi (scheduler). Sonlarni sanab, Telegram'ga bitta xabar yuboradi. */
export async function runDailyOpsDigest(): Promise<void> {
  try {
    const [users, vehicles, branches] = await Promise.all([
      prisma.user.count().catch(() => -1),
      prisma.vehicle.count({ where: { status: 'active' } }).catch(() => -1),
      prisma.branch.count().catch(() => -1),
    ])
    const errorCount = getAndResetErrorCount()
    const backupAge = latestBackupAgeHours()

    const lines: string[] = []
    lines.push('📊 <b>AutoHisob — kunlik xulosa</b>')
    lines.push(`Foydalanuvchi: ${users} · Faol mashina: ${vehicles} · Filial: ${branches}`)
    lines.push(`Server ishlash vaqti: ${formatUptime(Date.now() - processStartedAt)}`)
    lines.push(errorCount === 0
      ? '✅ So\'nggi 24 soatda server xatosi yo\'q'
      : `⚠️ So'nggi 24 soatda ${errorCount} ta server xatosi (5xx)`)

    if (backupAge === null) {
      lines.push("⚪ Backup fayli topilmadi (BACKUP_DIR sozlanmaganmi yoki hali ishlamaganmi?)")
    } else if (backupAge > 26) {
      lines.push(`🔴 Backup ESKIRGAN — oxirgisi ${Math.round(backupAge)} soat oldin! Cron'ni tekshiring.`)
    } else {
      lines.push(`✅ Backup yangi (${Math.round(backupAge)} soat oldin)`)
    }

    alertDigest(lines.join('\n'))
  } catch (e: any) {
    console.warn('[opsDigest] xulosa yuborishda xato:', e?.message ?? e)
  }
}

export { opsAlertStatus }
