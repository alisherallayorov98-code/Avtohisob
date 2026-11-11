import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { cleanStir, isValidStir } from '../lib/soliqNormalize'
import { lookupStir, isSoliqConfigured } from '../services/soliqClient'
import { MemCounter } from '../lib/memLimiter'
import { logEkoAudit } from '../lib/ekoAudit'
import { maskDuplicateForUser } from '../lib/dupMask'

// Foydalanuvchi boshiga daqiqasiga 20 ta so'rov — Soliq kvotasini bitta odam yeb qo'ymasin.
// ESLATMA: hisoblagich jarayon xotirasida (qayta ishga tushsa nolga tushadi) — kvota himoyasi uchun yetarli.
const rate = new MemCounter({ windowMs: 60_000, max: 20 })

/** GET /soliq/status — funksiya yoqilganmi (frontend tugmani shunga qarab ko'rsatadi). */
export function getSoliqStatus(_req: EkoRequest, res: Response): void {
  res.json({ success: true, data: { configured: isSoliqConfigured() } })
}

/**
 * GET /soliq/lookup?stir=...&excludeId=...
 * Javob: { found, company?, existing?, reason? }
 *  - existing: shu korxonada shu STIR bilan tashkilot ALLAQACHON bor (takror kiritishning oldi).
 *    Soliq so'ralmaydi ham — mavjudini ochish kerak. Boshqa tuman tashkiloti nomi yashiriladi.
 *  - excludeId: tahrirlanayotgan tashkilotning o'zi takror hisoblanmasin.
 * Har so'rov auditga yoziladi ('soliq.lookup').
 */
export async function lookupSoliq(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { orgId, id: userId } = user
    const stir = cleanStir(req.query.stir)
    if (!isValidStir(stir)) {
      res.status(400).json({ success: false, error: "STIR 9 ta raqamdan iborat bo'lishi kerak" })
      return
    }

    const existing = await (prisma as any).ekoHisobLegalEntity.findFirst({
      where: {
        orgId, stir,
        ...(req.query.excludeId ? { id: { not: String(req.query.excludeId) } } : {}),
      },
      select: { id: true, name: true, status: true, orgId: true, districtId: true },
    })
    if (existing) {
      await logEkoAudit(user, { action: 'soliq.lookup', targetType: 'soliq', targetName: stir, details: { result: 'duplicate' } })
      res.json({ success: true, data: { found: false, existing: maskDuplicateForUser(user, existing), reason: 'DUPLICATE' } })
      return
    }

    if (!rate.hit(userId)) {
      res.status(429).json({ success: false, error: "Juda ko'p so'rov. Bir daqiqadan keyin urining." })
      return
    }

    const r = await lookupStir(stir)
    await logEkoAudit(user, {
      action: 'soliq.lookup', targetType: 'soliq', targetName: stir,
      details: { result: r.ok ? 'found' : r.code },
    })
    if (r.ok) {
      res.json({ success: true, data: { found: true, company: r.company } })
      return
    }
    // "Topilmadi" xato emas (jismoniy shaxs/YaTT bo'lishi mumkin) — 200; qolganlari xizmat holati
    res.json({ success: true, data: { found: false, reason: r.code, message: r.message } })
  } catch (err) { next(err) }
}
