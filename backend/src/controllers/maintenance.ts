import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getSearchVariants } from '../lib/transliterate'
import { getEffectiveWarehouseId } from '../lib/warehouse'

export async function getMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, sparePartId, supplierId, from, to, branchId, search } = req.query as any

    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (sparePartId) where.sparePartId = sparePartId
    if (supplierId) where.supplierId = supplierId
    if (from || to) where.installationDate = (() => {
        const gte = from ? new Date(from) : undefined
        const lte = to   ? new Date(to)   : undefined
        return { ...(gte && !isNaN(gte.getTime()) && { gte }), ...(lte && !isNaN(lte.getTime()) && { lte }) }
      })()
    if (search) {
      const variants = getSearchVariants(search)
      where.OR = variants.flatMap(v => [
        { sparePart: { name: { contains: v, mode: 'insensitive' } } },
        { sparePart: { partCode: { contains: v, mode: 'insensitive' } } },
        { vehicle: { registrationNumber: { contains: v, mode: 'insensitive' } } },
      ])
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

    if (!vehicleId) throw new AppError('Avtomashina ID kiritilmagan', 400)
    if (!installationDate || isNaN(Date.parse(installationDate)))
      throw new AppError('Sana noto\'g\'ri formatda', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    if (vehicle.status === 'inactive') throw new AppError('Avtomashina nofaol', 400)

    // branch_manager faqat o'z guruhidagi mashinalar uchun maintenance qo'sha oladi
    if (req.user!.role === 'branch_manager' && vehicle.branchId !== req.user!.branchId)
      throw new AppError('Bu avtomashina sizning guruhingizda emas', 403)

    const partCost = parseFloat(cost || '0')
    const laborCostVal = parseFloat(laborCost || '0')
    const totalCost = partCost + laborCostVal
    const qty = parseInt(quantityUsed || '0')

    if (isNaN(partCost) || partCost < 0) throw new AppError('Qism narxi manfiy bo\'lmasligi kerak', 400)
    if (isNaN(laborCostVal) || laborCostVal < 0) throw new AppError('Usta haqi manfiy bo\'lmasligi kerak', 400)
    if (isNaN(qty) || qty < 0) throw new AppError('Miqdor manfiy bo\'lmasligi kerak', 400)

    const ops: any[] = []

    // If spare part provided, check inventory.
    // Warehouse priority: 1) explicit warehouseBranchId in body, 2) performing user's branch,
    // 3) vehicle's home branch. Then resolve sharedWarehouseId for whichever branch is chosen.
    if (sparePartId && qty > 0) {
      // Resolve warehouse: explicit warehouseId in body, or from performing user's branch, or vehicle's branch
      let warehouseId: string | null = req.body.warehouseId || null
      if (!warehouseId) {
        const sourceBranchId = req.body.warehouseBranchId || req.user!.branchId || vehicle.branchId
        warehouseId = await getEffectiveWarehouseId(sourceBranchId)
      }
      if (!warehouseId) throw new AppError('Ombor aniqlanmadi', 400)

      const inventory = await prisma.inventory.findUnique({
        where: { sparePartId_warehouseId: { sparePartId, warehouseId } },
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
      // Return stock to the branch's warehouse
      const warehouseId = await getEffectiveWarehouseId(record.vehicle.branchId)
      if (warehouseId) {
        ops.push(prisma.inventory.updateMany({
          where: { sparePartId: record.sparePartId, warehouseId },
          data: { quantityOnHand: { increment: record.quantityUsed } },
        }))
      }
    }
    await prisma.$transaction(ops)

    res.json(successResponse(null, 'Rekord o\'chirildi va ombor qaytarildi'))
  } catch (err) { next(err) }
}

export async function getMaintenanceStats(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, from, to, branchId } = req.query as any
    const effectiveBranchId = ['branch_manager', 'operator'].includes(req.user!.role) ? req.user!.branchId : branchId

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (from || to) where.installationDate = (() => {
        const gte = from ? new Date(from) : undefined
        const lte = to   ? new Date(to)   : undefined
        return { ...(gte && !isNaN(gte.getTime()) && { gte }), ...(lte && !isNaN(lte.getTime()) && { lte }) }
      })()
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
