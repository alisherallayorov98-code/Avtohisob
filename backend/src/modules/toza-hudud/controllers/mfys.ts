import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'

export async function getMfys(req: Request, res: Response, next: NextFunction) {
  try {
    const { districtId, regionId, page = '1', limit = '50' } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const where: any = {}
    if (districtId) where.districtId = districtId
    if (regionId) where.district = { regionId }

    const [total, mfys] = await Promise.all([
      (prisma as any).thMfy.count({ where }),
      (prisma as any).thMfy.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: {
          district: { include: { region: { select: { id: true, name: true } } } },
          _count: { select: { streets: true } },
        },
      }),
    ])
    res.json({ success: true, data: mfys, meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function createMfy(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, districtId, polygon } = req.body
    if (!name?.trim()) throw new AppError('MFY nomi kiritilishi shart', 400)
    if (!districtId) throw new AppError('Tuman tanlanishi shart', 400)
    const mfy = await (prisma as any).thMfy.create({
      data: { name: name.trim(), districtId, polygon: polygon || null },
      include: { district: { include: { region: { select: { id: true, name: true } } } } },
    })
    res.status(201).json({ success: true, data: mfy })
  } catch (err) { next(err) }
}

export async function updateMfy(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, districtId, polygon } = req.body
    if (!name?.trim()) throw new AppError('MFY nomi kiritilishi shart', 400)
    const mfy = await (prisma as any).thMfy.update({
      where: { id: req.params.id },
      data: {
        name: name.trim(),
        ...(districtId && { districtId }),
        ...(polygon !== undefined && { polygon: polygon || null }),
      },
      include: { district: { include: { region: { select: { id: true, name: true } } } } },
    })
    res.json({ success: true, data: mfy })
  } catch (err) { next(err) }
}

export async function deleteMfy(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await (prisma as any).thStreet.count({ where: { mfyId: req.params.id } })
    if (count > 0) throw new AppError(`Bu MFYda ${count} ta ko'cha bor. Avval ko'chalarni o'chiring.`, 400)
    await (prisma as any).thMfy.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
