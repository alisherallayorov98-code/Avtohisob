import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { cleanStir, isValidStir } from '../lib/soliqNormalize'
import { lookupStir, isSoliqConfigured } from '../services/soliqClient'

// Foydalanuvchi boshiga daqiqasiga 20 ta so'rov — Soliq kvotasini bitta odam yeb qo'ymasin
const rate = new Map<string, { n: number; reset: number }>()
function allow(userId: string): boolean {
  const now = Date.now()
  const e = rate.get(userId)
  if (!e || now > e.reset) { rate.set(userId, { n: 1, reset: now + 60_000 }); return true }
  if (e.n >= 20) return false
  e.n++
  return true
}
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of rate) if (v.reset < now) rate.delete(k)
}, 5 * 60_000).unref?.()

/** GET /soliq/status — funksiya yoqilganmi (frontend tugmani shunga qarab ko'rsatadi). */
export function getSoliqStatus(_req: EkoRequest, res: Response): void {
  res.json({ success: true, data: { configured: isSoliqConfigured() } })
}

/**
 * GET /soliq/lookup?stir=...&excludeId=...
 * Javob: { found, company?, existing?, reason? }
 *  - existing: shu korxonada shu STIR bilan tashkilot ALLAQACHON bor (takror kiritishning oldi).
 *    Soliq so'ralmaydi ham — mavjudini ochish kerak.
 *  - excludeId: tahrirlanayotgan tashkilotning o'zi takror hisoblanmasin.
 */
export async function lookupSoliq(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
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
      select: { id: true, name: true, status: true },
    })
    if (existing) {
      res.json({ success: true, data: { found: false, existing, reason: 'DUPLICATE' } })
      return
    }

    if (!allow(userId)) {
      res.status(429).json({ success: false, error: "Juda ko'p so'rov. Bir daqiqadan keyin urining." })
      return
    }

    const r = await lookupStir(stir)
    if (r.ok) {
      res.json({ success: true, data: { found: true, company: r.company } })
      return
    }
    // "Topilmadi" xato emas (jismoniy shaxs/YaTT bo'lishi mumkin) — 200; qolganlari xizmat holati
    res.json({ success: true, data: { found: false, reason: r.code, message: r.message } })
  } catch (err) { next(err) }
}
