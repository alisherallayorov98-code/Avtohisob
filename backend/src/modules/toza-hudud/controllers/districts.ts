import { Request, Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'

export async function getDistricts(req: Request, res: Response, next: NextFunction) {
  try {
    const { regionId, page = '1', limit = '50' } = req.query as any
    const skip = (parseInt(page) - 1) * parseInt(limit)
    const where: any = {}
    if (regionId) where.regionId = regionId

    const [total, districts] = await Promise.all([
      (prisma as any).thDistrict.count({ where }),
      (prisma as any).thDistrict.findMany({
        where, skip, take: parseInt(limit),
        orderBy: { name: 'asc' },
        include: {
          region: { select: { id: true, name: true } },
          _count: { select: { mfys: true } },
        },
      }),
    ])
    res.json({ success: true, data: districts, meta: { total, page: parseInt(page), limit: parseInt(limit), totalPages: Math.ceil(total / parseInt(limit)) } })
  } catch (err) { next(err) }
}

export async function createDistrict(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, regionId } = req.body
    if (!name?.trim()) throw new AppError('Tuman nomi kiritilishi shart', 400)
    if (!regionId) throw new AppError('Viloyat tanlanishi shart', 400)
    const district = await (prisma as any).thDistrict.create({
      data: { name: name.trim(), regionId },
      include: { region: { select: { id: true, name: true } } },
    })
    res.status(201).json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function updateDistrict(req: Request, res: Response, next: NextFunction) {
  try {
    const { name, regionId } = req.body
    if (!name?.trim()) throw new AppError('Tuman nomi kiritilishi shart', 400)
    const district = await (prisma as any).thDistrict.update({
      where: { id: req.params.id },
      data: { name: name.trim(), ...(regionId && { regionId }) },
      include: { region: { select: { id: true, name: true } } },
    })
    res.json({ success: true, data: district })
  } catch (err) { next(err) }
}

export async function deleteDistrict(req: Request, res: Response, next: NextFunction) {
  try {
    const count = await (prisma as any).thMfy.count({ where: { districtId: req.params.id } })
    if (count > 0) throw new AppError(`Bu tumanda ${count} ta MFY bor. Avval MFYlarni o'chiring.`, 400)
    await (prisma as any).thDistrict.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}
