import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

// Tashkilot org/tumaniga inspektor kira oladimi tekshiradi
async function checkEntityAccess(entityId: string, req: EkoRequest): Promise<{ ok: boolean; entity?: any; error?: string; code?: number }> {
  const { orgId, role, districtIds } = req.ekoUser!
  const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({ where: { id: entityId } })
  if (!entity || entity.orgId !== orgId) return { ok: false, error: 'Tashkilot topilmadi', code: 404 }
  if (role === 'inspector' && !districtIds.includes(entity.districtId)) {
    return { ok: false, error: 'Ushbu tumanga kirish taqiqlangan', code: 403 }
  }
  return { ok: true, entity }
}

/**
 * GET /talons?entityId=&from=&to=
 * Talon ro'yxati (tashkilot bo'yicha yoki davr bo'yicha)
 */
export async function listTalons(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    const { entityId, from, to } = req.query as Record<string, string>

    const where: any = { orgId }
    if (entityId) {
      const access = await checkEntityAccess(entityId, req)
      if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }
      where.entityId = entityId
    } else if (role === 'inspector') {
      // Inspektor — faqat o'z tumanlari tashkilotlarining talonlari
      const ents = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: { orgId, districtId: { in: districtIds } }, select: { id: true },
      })
      where.entityId = { in: ents.map((e: any) => e.id) }
    }
    if (from || to) {
      where.date = {}
      if (from) where.date.gte = new Date(from + 'T00:00:00.000Z')
      if (to) where.date.lte = new Date(to + 'T00:00:00.000Z')
    }

    const talons = await (prisma as any).ekoHisobTalon.findMany({
      where,
      include: { entity: { select: { id: true, name: true } } },
      orderBy: { date: 'desc' },
      take: 200,
    })
    const total = talons.reduce((s: number, t: any) => s + t.amount, 0)
    const totalUnpaid = talons.filter((t: any) => !t.paid).reduce((s: number, t: any) => s + t.amount, 0)
    const totalVolume = talons.reduce((s: number, t: any) => s + t.volume, 0)

    res.json({ success: true, data: { talons, total, totalUnpaid, totalVolume, count: talons.length } })
  } catch (err) { next(err) }
}

/**
 * POST /talons
 * { entityId, volume, date?, note? } — yangi talon (bajarilgan ish, kub)
 * Summa avtomatik: amount = volume × tashkilot cubicPrice
 */
export async function createTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
    const { entityId, volume, date, note, paid } = req.body

    if (!entityId || volume === undefined) {
      res.status(400).json({ success: false, error: 'entityId va volume (kub) talab qilinadi' })
      return
    }
    const parsedVolume = parseFloat(String(volume))
    if (isNaN(parsedVolume) || parsedVolume <= 0) {
      res.status(400).json({ success: false, error: 'Kub (hajm) musbat son bo\'lishi kerak' })
      return
    }

    const access = await checkEntityAccess(entityId, req)
    if (!access.ok) { res.status(access.code!).json({ success: false, error: access.error }); return }

    const cubicPrice = access.entity.cubicPrice || 0
    if (cubicPrice <= 0) {
      res.status(400).json({ success: false, error: 'Tashkilotga bir kub narxi belgilanmagan. Avval narxni kiriting.' })
      return
    }
    const amount = Math.round(parsedVolume * cubicPrice)

    const talonDate = date ? new Date(date + 'T00:00:00.000Z') : new Date()

    const talon = await (prisma as any).ekoHisobTalon.create({
      data: {
        entityId, orgId,
        volume: parsedVolume,
        amount,
        date: talonDate,
        note: note ? String(note).trim() : null,
        createdBy: userId || null,
        paid: Boolean(paid),
      },
      include: { entity: { select: { id: true, name: true } } },
    })
    res.status(201).json({ success: true, data: { ...talon, cubicPrice } })
  } catch (err) { next(err) }
}

/**
 * PATCH /talons/:id — talon holati (paid) yoki kub (volume → amount qayta hisoblanadi)
 */
export async function updateTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const { paid, volume, note } = req.body

    const talon = await (prisma as any).ekoHisobTalon.findUnique({
      where: { id }, include: { entity: { select: { cubicPrice: true } } },
    })
    if (!talon || talon.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Talon topilmadi' })
      return
    }
    const data: any = {}
    if (paid !== undefined) data.paid = Boolean(paid)
    if (note !== undefined) data.note = note ? String(note).trim() : null
    if (volume !== undefined) {
      const v = parseFloat(String(volume))
      if (!isNaN(v) && v > 0) {
        data.volume = v
        data.amount = Math.round(v * (talon.entity.cubicPrice || 0))
      }
    }

    const updated = await (prisma as any).ekoHisobTalon.update({ where: { id }, data })
    res.json({ success: true, data: updated })
  } catch (err) { next(err) }
}

/**
 * DELETE /talons/:id
 */
export async function deleteTalon(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId } = req.ekoUser!
    const { id } = req.params
    const talon = await (prisma as any).ekoHisobTalon.findUnique({ where: { id } })
    if (!talon || talon.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Talon topilmadi' })
      return
    }
    await (prisma as any).ekoHisobTalon.delete({ where: { id } })
    res.json({ success: true, data: null, message: 'Talon o\'chirildi' })
  } catch (err) { next(err) }
}
