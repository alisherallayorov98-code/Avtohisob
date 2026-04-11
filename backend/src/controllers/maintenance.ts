import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

export async function getMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, sparePartId, from, to, branchId, search } = req.query as any

    const effectiveBranchId = ['admin', 'branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (sparePartId) where.sparePartId = sparePartId
    if (from || to) where.installationDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) }
    if (search) {
      where.OR = [
        { sparePart: { name: { contains: search, mode: 'insensitive' } } },
        { sparePart: { partCode: { contains: search, mode: 'insensitive' } } },
        { vehicle: { registrationNumber: { contains: search, mode: 'insensitive' } } },
      ]
    }
    if (effectiveBranchId) {
      where.vehicle = { ...(where.vehicle || {}), branchId: effectiveBranchId }
    }

    const [total, records] = await Promise.all([
      prisma.maintenanceRecord.count({ where }),
      prisma.maintenanceRecord.findMany({
        where, skip, take: limit,
        include: {
          vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
          sparePart: { select: { id: true, name: true, partCode: true, category: true } },
          supplier: { select: { id: true, name: true } },
          performedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { installationDate: 'desc' },
      }),
    ])

    res.json({ success: true, data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getMaintenanceById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: true, sparePart: true, supplier: true,
        performedBy: { select: { id: true, fullName: true, email: true } },
      },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)
    res.json(successResponse(record))
  } catch (err) { next(err) }
}

export async function createMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, sparePartId, quantityUsed, installationDate, cost, laborCost, workerName, paymentType, isPaid, supplierId, notes } = req.body

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    if (vehicle.status === 'inactive') throw new AppError('Avtomashina nofaol', 400)

    const partCost = parseFloat(cost || '0')
    const laborCostVal = parseFloat(laborCost || '0')
    const totalCost = partCost + laborCostVal
    const qty = parseInt(quantityUsed || '0')

    const ops: any[] = []

    // If spare part provided, check inventory
    if (sparePartId && qty > 0) {
      const inventory = await prisma.inventory.findUnique({
        where: { sparePartId_branchId: { sparePartId, branchId: vehicle.branchId } },
      })
      if (!inventory) throw new AppError('Bu ehtiyot qism omborda mavjud emas', 400)
      if (inventory.quantityOnHand < qty) throw new AppError(`Omborda faqat ${inventory.quantityOnHand} ta mavjud`, 400)
      ops.push(prisma.inventory.update({
        where: { id: inventory.id },
        data: { quantityOnHand: inventory.quantityOnHand - qty },
      }))
    }

    const recordData: any = {
      vehicleId,
      installationDate: new Date(installationDate),
      cost: partCost,
      laborCost: laborCostVal,
      workerName: workerName || null,
      paymentType: paymentType || 'cash',
      isPaid: isPaid !== undefined ? isPaid : true,
      supplierId: supplierId || null,
      notes,
      performedById: req.user!.id,
    }
    if (sparePartId) { recordData.sparePartId = sparePartId; recordData.quantityUsed = qty }

    ops.unshift(prisma.maintenanceRecord.create({
      data: recordData,
      include: { vehicle: true, sparePart: true, supplier: true, performedBy: { select: { fullName: true } } },
    }))

    if (totalCost > 0) {
      ops.push(prisma.expense.create({
        data: {
          vehicleId, amount: totalCost,
          description: laborCostVal > 0 && partCost === 0 ? `Usta haqi${workerName ? ': ' + workerName : ''}` : `Texnik xizmat`,
          expenseDate: new Date(installationDate), createdById: req.user!.id,
          categoryId: await getOrCreateCategory('Texnik xizmat'),
        },
      }))
    }

    const [record] = await prisma.$transaction(ops)
    res.status(201).json(successResponse(record, 'Texnik xizmat qayd etildi'))
  } catch (err) { next(err) }
}

async function getOrCreateCategory(name: string) {
  let cat = await prisma.expenseCategory.findFirst({ where: { name } })
  if (!cat) cat = await prisma.expenseCategory.create({ data: { name, description: name } })
  return cat.id
}

export async function updateMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { notes, cost, laborCost, workerName, paymentType, isPaid } = req.body
    const record = await prisma.maintenanceRecord.update({
      where: { id: req.params.id },
      data: {
        ...(notes !== undefined && { notes }),
        ...(cost !== undefined && { cost: parseFloat(cost) }),
        ...(laborCost !== undefined && { laborCost: parseFloat(laborCost) }),
        ...(workerName !== undefined && { workerName }),
        ...(paymentType !== undefined && { paymentType }),
        ...(isPaid !== undefined && { isPaid }),
      },
      include: { vehicle: true, sparePart: true, performedBy: { select: { fullName: true } } },
    })
    res.json(successResponse(record, 'Rekord yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    const ops: any[] = [prisma.maintenanceRecord.delete({ where: { id: req.params.id } })]
    if (record.sparePartId && record.quantityUsed > 0) {
      ops.push(prisma.inventory.updateMany({
        where: { sparePartId: record.sparePartId, branchId: record.vehicle.branchId },
        data: { quantityOnHand: { increment: record.quantityUsed } },
      }))
    }
    await prisma.$transaction(ops)

    res.json(successResponse(null, 'Rekord o\'chirildi va ombor qaytarildi'))
  } catch (err) { next(err) }
}

export async function getMaintenanceStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, from, to, branchId } = req.query as any
    const effectiveBranchId = ['admin', 'branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (from || to) where.installationDate = { ...(from && { gte: new Date(from) }), ...(to && { lte: new Date(to) }) }
    if (effectiveBranchId) where.vehicle = { branchId: effectiveBranchId }

    const agg = await prisma.maintenanceRecord.aggregate({
      where,
      _sum: { cost: true, quantityUsed: true },
      _count: { id: true },
    })

    res.json(successResponse({
      totalCost: Number(agg._sum.cost) || 0,
      totalParts: Number(agg._sum.quantityUsed) || 0,
      count: agg._count.id,
    }))
  } catch (err) { next(err) }
}

export async function getVehicleMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const records = await prisma.maintenanceRecord.findMany({
      where: { vehicleId: req.params.id },
      include: { sparePart: true, supplier: true, performedBy: { select: { fullName: true } } },
      orderBy: { installationDate: 'desc' },
    })
    res.json(successResponse(records))
  } catch (err) { next(err) }
}
