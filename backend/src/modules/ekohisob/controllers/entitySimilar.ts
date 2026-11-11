import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { findSimilar, phoneKey } from '../lib/similarEntities'
import { entityScopeWhere } from '../lib/ekoScope'

/**
 * POST /entities/similar { name, phone, lat, lon, districtId, excludeId }
 * Yangi/tahrirlanayotgan tashkilotga O'XSHASH mavjudlarni qaytaradi (STIR'siz tashkilotlar
 * uchun takrorning oldini olish). Faqat ogohlantirish — hech narsani bloklamaydi.
 * Inspektor faqat o'z tumanlaridagilarni ko'radi (boshqa tuman ma'lumoti sizib chiqmasin).
 */
export async function findSimilarEntities(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const b = req.body ?? {}
    const name = typeof b.name === 'string' ? b.name.trim() : ''
    const phone = typeof b.phone === 'string' ? b.phone : ''
    const lat = Number.isFinite(Number(b.lat)) && b.lat !== null && b.lat !== '' ? Number(b.lat) : null
    const lon = Number.isFinite(Number(b.lon)) && b.lon !== null && b.lon !== '' ? Number(b.lon) : null
    const districtId = typeof b.districtId === 'string' && b.districtId ? b.districtId : null
    const excludeId = typeof b.excludeId === 'string' ? b.excludeId : null

    const or: any[] = []
    const pk = phoneKey(phone)
    if (pk) or.push({ phone: { contains: pk } })
    if (lat !== null && lon !== null) {
      or.push({ lat: { gte: lat - 0.0006, lte: lat + 0.0006 }, lon: { gte: lon - 0.0008, lte: lon + 0.0008 } })
    }
    if (name.length >= 3 && districtId) or.push({ districtId })

    if (or.length === 0) { res.json({ success: true, data: [] }); return }

    // Tenant + tuman doirasi (ekoScope): admin — butun korxona; boshqalar — faqat o'z tumanlari
    const where: any = { ...entityScopeWhere(user), OR: or }
    if (excludeId) where.id = { not: excludeId }

    const candidates = await (prisma as any).ekoHisobLegalEntity.findMany({
      where,
      select: { id: true, name: true, phone: true, lat: true, lon: true, districtId: true, status: true },
      take: 5000,
    })
    res.json({ success: true, data: findSimilar({ name, phone, lat, lon, districtId }, candidates) })
  } catch (err) { next(err) }
}
