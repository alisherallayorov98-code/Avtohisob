import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

export async function getSuppliers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { search, isActive } = req.query as any
    const where: any = {}
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { phone: { contains: search, mode: 'insensitive' } },
    ]
    if (isActive !== undefined) where.isActive = isActive === 'true'

    const [total, suppliers] = await Promise.all([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
    ])
    res.json({ success: true, data: suppliers, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getSupplier(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } })
    if (!supplier) throw new AppError('Ta\'minotchi topilmadi', 404)
    res.json(successResponse(supplier))
  } catch (err) { next(err) }
}

export async function createSupplier(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, contactPerson, phone, email, address, paymentTerms } = req.body
    const supplier = await prisma.supplier.create({ data: { name, contactPerson, phone, email, address, paymentTerms } })
    res.status(201).json(successResponse(supplier, 'Ta\'minotchi qo\'shildi'))
  } catch (err) { next(err) }
}

export async function updateSupplier(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { name, contactPerson, phone, email, address, paymentTerms, isActive } = req.body
    const supplier = await prisma.supplier.update({
      where: { id: req.params.id },
      data: {
        ...(name && { name }), ...(contactPerson !== undefined && { contactPerson }),
        ...(phone && { phone }), ...(email !== undefined && { email }),
        ...(address !== undefined && { address }), ...(paymentTerms !== undefined && { paymentTerms }),
        ...(isActive !== undefined && { isActive }),
      },
    })
    res.json(successResponse(supplier, 'Ta\'minotchi yangilandi'))
  } catch (err) { next(err) }
}
