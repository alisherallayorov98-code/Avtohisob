import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getSearchVariants } from '../lib/transliterate'

export async function getSuppliers(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { search, isActive } = req.query as any
    const where: any = {}
    if (search) {
      const variants = getSearchVariants(search)
      where.OR = variants.flatMap(v => [
        { name: { contains: v, mode: 'insensitive' } },
        { phone: { contains: v, mode: 'insensitive' } },
      ])
    }
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

export async function deleteSupplier(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const linked = await prisma.sparePart.count({ where: { supplierId: req.params.id } })
    if (linked > 0)
      throw new AppError(`Bu yetkazuvchiga ${linked} ta ehtiyot qism biriktirilgan. Avval ularni o'zgartiring.`, 400)
    await prisma.supplier.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'Yetkazuvchi o\'chirildi'))
  } catch (err) { next(err) }
}

export async function getSupplierDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const supplier = await prisma.supplier.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { spareParts: true, maintenanceRecords: true } },
        payments: {
          orderBy: { paymentDate: 'desc' },
          include: { createdBy: { select: { fullName: true } } },
        },
      },
    })
    if (!supplier) throw new AppError('Yetkazuvchi topilmadi', 404)

    const invoiceTotal = supplier.payments.filter(p => p.type === 'invoice').reduce((s, p) => s + Number(p.amount), 0)
    const paymentTotal = supplier.payments.filter(p => p.type === 'payment').reduce((s, p) => s + Number(p.amount), 0)
    const balance = invoiceTotal - paymentTotal // positive = biz qarz, negative = ular qarz

    res.json(successResponse({
      ...supplier,
      balance,
      invoiceTotal,
      paymentTotal,
    }))
  } catch (err) { next(err) }
}

export async function createSupplierPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { amount, type, paymentDate, note } = req.body
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      throw new AppError('Summa to\'g\'ri kiritilmagan', 400)
    if (!['invoice', 'payment'].includes(type))
      throw new AppError('Tur noto\'g\'ri: invoice yoki payment', 400)
    if (!paymentDate || isNaN(Date.parse(paymentDate)))
      throw new AppError('Sana noto\'g\'ri', 400)

    const supplier = await prisma.supplier.findUnique({ where: { id: req.params.id } })
    if (!supplier) throw new AppError('Yetkazuvchi topilmadi', 404)

    const payment = await prisma.supplierPayment.create({
      data: {
        supplierId: req.params.id,
        amount: parseFloat(amount),
        type,
        paymentDate: new Date(paymentDate),
        note: note || null,
        createdById: req.user!.id,
      },
      include: { createdBy: { select: { fullName: true } } },
    })
    res.status(201).json(successResponse(payment, 'Yozuv qo\'shildi'))
  } catch (err) { next(err) }
}

export async function deleteSupplierPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    await prisma.supplierPayment.delete({ where: { id: req.params.paymentId } })
    res.json(successResponse(null, 'Yozuv o\'chirildi'))
  } catch (err) { next(err) }
}
