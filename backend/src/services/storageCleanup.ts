import fs from 'fs'
import path from 'path'
import { execSync } from 'child_process'
import { prisma } from '../lib/prisma'
import { sendToUser } from './telegramBot'

const UPLOADS_DIR = path.join(process.cwd(), 'uploads')

// ── Disk holati ───────────────────────────────────────────────────────────────

export interface DiskStats {
  uploadsDirMB: number
  bySubdir: Record<string, number>  // MB by subdir
  diskTotalGB: number
  diskUsedGB: number
  diskFreeGB: number
  diskUsedPct: number
}

export async function getDiskStats(): Promise<DiskStats> {
  // uploads papkasidagi har bir subdirning hajmi
  const bySubdir: Record<string, number> = {}
  let uploadsDirMB = 0

  if (fs.existsSync(UPLOADS_DIR)) {
    const subdirs = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })
      .filter(d => d.isDirectory()).map(d => d.name)

    for (const sub of subdirs) {
      const mb = getDirSizeMB(path.join(UPLOADS_DIR, sub))
      bySubdir[sub] = mb
      uploadsDirMB += mb
    }

    // Root uploadlar (papkasiz fayllar)
    const rootFiles = fs.readdirSync(UPLOADS_DIR, { withFileTypes: true })
      .filter(d => d.isFile())
    for (const f of rootFiles) {
      try {
        const size = fs.statSync(path.join(UPLOADS_DIR, f.name)).size
        uploadsDirMB += size / (1024 * 1024)
      } catch {}
    }
  }

  // Umumiy disk holati (Linux/Mac: df, Windows: wmic)
  let diskTotalGB = 0, diskUsedGB = 0, diskFreeGB = 0, diskUsedPct = 0
  try {
    if (process.platform === 'win32') {
      const out = execSync('wmic logicaldisk get size,freespace,caption /format:csv', { timeout: 5000 }).toString()
      const lines = out.trim().split('\n').filter(l => l.includes(','))
      for (const line of lines) {
        const parts = line.trim().split(',')
        if (parts.length >= 3) {
          const free = Number(parts[1])
          const total = Number(parts[2])
          if (!isNaN(free) && !isNaN(total) && total > 0) {
            diskTotalGB += total / (1024 ** 3)
            diskFreeGB += free / (1024 ** 3)
          }
        }
      }
      diskUsedGB = diskTotalGB - diskFreeGB
    } else {
      const out = execSync(`df -k "${UPLOADS_DIR}" 2>/dev/null || df -k /`, { timeout: 5000 }).toString()
      const lines = out.trim().split('\n')
      const data = lines[lines.length - 1].trim().split(/\s+/)
      if (data.length >= 4) {
        diskTotalGB = Number(data[1]) / (1024 ** 2)
        diskUsedGB  = Number(data[2]) / (1024 ** 2)
        diskFreeGB  = Number(data[3]) / (1024 ** 2)
      }
    }
    diskUsedPct = diskTotalGB > 0 ? Math.round((diskUsedGB / diskTotalGB) * 100) : 0
  } catch {
    // disk ma'lumoti olib bo'lmadi — faqat uploads hajmi ko'rsatiladi
  }

  return {
    uploadsDirMB: Math.round(uploadsDirMB * 10) / 10,
    bySubdir: Object.fromEntries(
      Object.entries(bySubdir).map(([k, v]) => [k, Math.round(v * 10) / 10])
    ),
    diskTotalGB: Math.round(diskTotalGB * 10) / 10,
    diskUsedGB:  Math.round(diskUsedGB  * 10) / 10,
    diskFreeGB:  Math.round(diskFreeGB  * 10) / 10,
    diskUsedPct,
  }
}

function getDirSizeMB(dirPath: string): number {
  let total = 0
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dirPath, e.name)
      if (e.isDirectory()) {
        total += getDirSizeMB(full)
      } else {
        try { total += fs.statSync(full).size } catch {}
      }
    }
  } catch {}
  return total / (1024 * 1024)
}

// ── Eski evidence fayllarini tozalash ────────────────────────────────────────

/**
 * Tasdiqlangan yoki rad etilgan maintenance yozuvlarining evidencelarini o'chiradi.
 * Retention: N oy oldin yaratilgan (default 6 oy).
 * Faylni DB dan ham o'chiradi.
 */
export async function cleanupOldEvidence(retentionMonths = 6): Promise<{ deletedFiles: number; freedMB: number }> {
  const cutoff = new Date()
  cutoff.setMonth(cutoff.getMonth() - retentionMonths)

  // Faqat tasdiqlangan yoki rad etilgan yozuvlar uchun — kutayotganlarni saqlaymiz
  const oldEvidence = await (prisma as any).maintenanceEvidence.findMany({
    where: {
      createdAt: { lt: cutoff },
      maintenance: { status: { in: ['approved', 'rejected', 'completed'] } },
    },
    select: { id: true, fileUrl: true },
  }).catch(() => [] as { id: string; fileUrl: string }[])

  let deletedFiles = 0
  let freedBytes = 0

  for (const ev of oldEvidence) {
    try {
      const filePath = path.join(process.cwd(), ev.fileUrl)
      if (fs.existsSync(filePath)) {
        const stat = fs.statSync(filePath)
        fs.unlinkSync(filePath)
        freedBytes += stat.size
      }
      await (prisma as any).maintenanceEvidence.delete({ where: { id: ev.id } }).catch(() => {})
      deletedFiles++
    } catch (err: any) {
      console.error(`[StorageCleanup] Evidence o'chirishda xato (${ev.id}):`, err?.message)
    }
  }

  // Bo'sh oy papkalarini tozalash
  cleanupEmptyMonthDirs()

  return { deletedFiles, freedMB: Math.round((freedBytes / (1024 * 1024)) * 10) / 10 }
}

// Texnik parvarish (uploads/care) media: yetimlarni + eskirgan retentiondan o'tganlarni o'chiradi
export async function cleanupOldCareMedia(retentionMonths = 6): Promise<{ deletedFiles: number; freedMB: number }> {
  const careDir = path.join(UPLOADS_DIR, 'care')
  if (!fs.existsSync(careDir)) return { deletedFiles: 0, freedMB: 0 }
  let files: string[] = []
  try { files = fs.readdirSync(careDir) } catch { return { deletedFiles: 0, freedMB: 0 } }

  const used = await (prisma as any).vehicleCareSubmission.findMany({
    where: { mediaPath: { not: null } }, select: { id: true, mediaPath: true, submittedAt: true },
  }).catch(() => [] as any[])
  const usedByFile: Record<string, any> = {}
  for (const s of used) { if (s.mediaPath) usedByFile[String(s.mediaPath).replace(/^care\//, '')] = s }

  const retentionCutoff = new Date(); retentionCutoff.setMonth(retentionCutoff.getMonth() - retentionMonths)
  const orphanCutoffMs = Date.now() - 24 * 3600 * 1000 // 1 kundan eski yetimlar

  let deletedFiles = 0, freedBytes = 0
  for (const f of files) {
    const fp = path.join(careDir, f)
    let stat: fs.Stats
    try { stat = fs.statSync(fp) } catch { continue }
    if (!stat.isFile()) continue
    const sub = usedByFile[f]
    let del = false
    if (!sub) {
      if (stat.mtimeMs < orphanCutoffMs) del = true // yetim (rad etilgan/tanlanmagan) — o'chiramiz
    } else {
      const when = sub.submittedAt ? new Date(sub.submittedAt) : stat.mtime
      if (when < retentionCutoff) {
        del = true
        await (prisma as any).vehicleCareSubmission.update({ where: { id: sub.id }, data: { mediaPath: null } }).catch(() => {})
      }
    }
    if (del) {
      try { fs.unlinkSync(fp); freedBytes += stat.size; deletedFiles++ } catch { /* ignore */ }
    }
  }
  return { deletedFiles, freedMB: Math.round((freedBytes / (1024 * 1024)) * 10) / 10 }
}

function cleanupEmptyMonthDirs() {
  const evidenceBase = path.join(UPLOADS_DIR, 'maintenance-evidence')
  if (!fs.existsSync(evidenceBase)) return
  try {
    const months = fs.readdirSync(evidenceBase)
    for (const m of months) {
      const monthDir = path.join(evidenceBase, m)
      try {
        const files = fs.readdirSync(monthDir)
        if (files.length === 0) fs.rmdirSync(monthDir)
      } catch {}
    }
  } catch {}
}

// ── Yetim fayllarni tozalash ─────────────────────────────────────────────────

/**
 * DB da yo'q lekin diskda bor fayllarni topadi va o'chiradi.
 * Faqat maintenance-evidence papkasi uchun (qolganlar muhimroq).
 */
export async function cleanupOrphanedFiles(): Promise<{ deletedFiles: number; freedMB: number }> {
  const evidenceBase = path.join(UPLOADS_DIR, 'maintenance-evidence')
  if (!fs.existsSync(evidenceBase)) return { deletedFiles: 0, freedMB: 0 }

  // DB dagi barcha evidence fileUrl larni olish
  const dbUrls = new Set<string>()
  const allEvidence = await (prisma as any).maintenanceEvidence.findMany({
    select: { fileUrl: true },
  }).catch(() => [] as { fileUrl: string }[])
  for (const e of allEvidence) dbUrls.add(e.fileUrl)

  let deletedFiles = 0
  let freedBytes = 0

  const months = fs.readdirSync(evidenceBase).filter(m => /^\d{4}-\d{2}$/.test(m))
  for (const month of months) {
    const monthDir = path.join(evidenceBase, month)
    let files: string[]
    try { files = fs.readdirSync(monthDir) } catch { continue }

    for (const file of files) {
      const relUrl = `/uploads/maintenance-evidence/${month}/${file}`
      if (!dbUrls.has(relUrl)) {
        // Yetim fayl — 1 kundan eski bo'lsa o'chiramiz (yangi yuklanganlar bilan mojaroni oldini olish)
        try {
          const filePath = path.join(monthDir, file)
          const stat = fs.statSync(filePath)
          const ageMs = Date.now() - stat.mtimeMs
          if (ageMs > 24 * 60 * 60 * 1000) {
            fs.unlinkSync(filePath)
            freedBytes += stat.size
            deletedFiles++
          }
        } catch {}
      }
    }
  }

  cleanupEmptyMonthDirs()
  return { deletedFiles, freedMB: Math.round((freedBytes / (1024 * 1024)) * 10) / 10 }
}

// ── Disk monitoringi: Telegram alert ─────────────────────────────────────────

const DISK_WARN_PCT  = 75  // sariq ogohlantirish
const DISK_CRIT_PCT  = 90  // qizil: xavfli

export async function checkDiskAndNotify(): Promise<void> {
  if (!fs.existsSync(UPLOADS_DIR)) return

  let stats: DiskStats
  try { stats = await getDiskStats() } catch { return }

  if (stats.diskUsedPct === 0) return  // disk ma'lumoti olinmadi

  if (stats.diskUsedPct < DISK_WARN_PCT) return  // hammasi yaxshi

  const emoji = stats.diskUsedPct >= DISK_CRIT_PCT ? '🔴' : '🟡'
  const level = stats.diskUsedPct >= DISK_CRIT_PCT ? 'XAVFLI' : 'Ogohlantirish'

  const topDirs = Object.entries(stats.bySubdir)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 5)
    .map(([k, v]) => `  • <code>${k}/</code> — ${v} MB`)
    .join('\n')

  const msg = [
    `${emoji} <b>Disk ${level}: ${stats.diskUsedPct}% to'lgan</b>`,
    '',
    `📊 Disk: ${stats.diskUsedGB} GB / ${stats.diskTotalGB} GB`,
    `📁 Uploads papkasi: ${stats.uploadsDirMB} MB`,
    '',
    'Eng katta papkalar:',
    topDirs || '  (ma\'lumot yo\'q)',
    '',
    '💡 Admin panelida Storage bo\'limini tekshiring.',
  ].join('\n')

  // Barcha super_admin larga yuborish
  try {
    const superAdmins = await prisma.user.findMany({
      where: { role: 'super_admin', isActive: true },
      select: { id: true },
    })
    for (const admin of superAdmins) {
      await sendToUser(admin.id, msg).catch(() => {})
    }
  } catch (err: any) {
    console.error('[StorageCleanup] Disk alert yuborishda xato:', err?.message)
  }
}

/**
 * "Savatcha" auto-tozalash: nofaol (o'chirilgan) ehtiyot qismlar retentionDays
 * kundan ko'p turgan VA hech qachon ishlatilmagan bo'lsa — butunlay o'chiriladi.
 * Shunda nofaol qismlar cheksiz yig'ilib qolmaydi. Ishlatilgan (ta'mir/o'tkazma/
 * so'rov/qaytarish tarixi bor) qism saqlanadi.
 */
export async function purgeOldDeactivatedSpareParts(retentionDays = 30): Promise<{ purged: number }> {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000)
  const parts = await (prisma as any).sparePart.findMany({
    where: { isActive: false, updatedAt: { lt: cutoff } },
    select: { id: true },
  }).catch(() => [] as Array<{ id: string }>)

  let purged = 0
  for (const p of parts) {
    try {
      const [maint, mItems, transfers, reqItems, retItems] = await Promise.all([
        (prisma as any).maintenanceRecord.count({ where: { sparePartId: p.id } }),
        (prisma as any).maintenanceItem.count({ where: { sparePartId: p.id } }),
        (prisma as any).inventoryTransfer.count({ where: { sparePartId: p.id } }),
        (prisma as any).sparePartRequestItem.count({ where: { sparePartId: p.id } }),
        (prisma as any).sparePartReturnItem.count({ where: { sparePartId: p.id } }),
      ])
      if (maint + mItems + transfers + reqItems + retItems > 0) continue // ishlatilgan — saqlaymiz
      await prisma.$transaction(async (tx) => {
        await (tx as any).inventoryReceipt.deleteMany({ where: { sparePartId: p.id } })
        await (tx as any).inventory.deleteMany({ where: { sparePartId: p.id } })
        await (tx as any).articleCode.deleteMany({ where: { sparePartId: p.id } })
        await (tx as any).sparePartStatistic.deleteMany({ where: { sparePartId: p.id } })
        await (tx as any).sparePart.delete({ where: { id: p.id } })
      })
      purged++
    } catch { /* skip */ }
  }
  return { purged }
}
