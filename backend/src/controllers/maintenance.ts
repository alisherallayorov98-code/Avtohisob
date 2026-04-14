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
        { items: { some: { sparePart: { name: { contains: v, mode: 'insensitive' } } } } },
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
          items: {
            include: {
              sparePart: { select: { id: true, name: true, partCode: true, category: true } },
              warehouse: { select: { id: true, name: true } },
            },
          },
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
    if (['branch_manager', 'operator'].includes(req.user!.role) && record.vehicle.branchId !== req.user!.branchId) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }
    res.json(successResponse(record))
  } catch (err) { next(err) }
}

interface PartItem {
  sparePartId: string
  warehouseId?: string
  quantityUsed: number
  unitCost: number
}

export async function createMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, installationDate, laborCost, workerName, paymentType, isPaid, supplierId, notes } = req.body
    // items: [{sparePartId, warehouseId, quantityUsed, unitCost}]
    const items: PartItem[] = Array.isArray(req.body.items) ? req.body.items : []

    // Backward compat: if no items but single sparePartId provided
    if (items.length === 0 && req.body.sparePartId) {
      const qty = parseInt(req.body.quantityUsed || '0')
      const uc = parseFloat(req.body.cost || '0')
      if (req.body.sparePartId && qty > 0) {
        items.push({ sparePartId: req.body.sparePartId, warehouseId: req.body.warehouseId, quantityUsed: qty, unitCost: uc })
      }
    }

    if (!vehicleId) throw new AppError('Avtomashina ID kiritilmagan', 400)
    if (!installationDate || isNaN(Date.parse(installationDate)))
      throw new AppError('Sana noto\'g\'ri formatda', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)
    if (vehicle.status === 'inactive') throw new AppError('Avtomashina nofaol', 400)

    if (req.user!.role === 'branch_manager' && vehicle.branchId !== req.user!.branchId)
      throw new AppError('Bu avtomashina sizning guruhingizda emas', 403)

    const laborCostVal = parseFloat(laborCost || '0')
    if (isNaN(laborCostVal) || laborCostVal < 0) throw new AppError('Usta haqi manfiy bo\'lmasligi kerak', 400)

    // Validate and resolve warehouses for all items
    const resolvedItems: Array<PartItem & { resolvedWarehouseId: string; inventory: any }> = []
    let totalPartsCost = 0

    for (const item of items) {
      if (!item.sparePartId) continue
      const qty = Number(item.quantityUsed) || 0
      const uc = Number(item.unitCost) || 0
      if (qty <= 0) continue

      let warehouseId: string | null = item.warehouseId || null
      if (!warehouseId) {
        const sourceBranchId = req.user!.branchId || vehicle.branchId
        warehouseId = await getEffectiveWarehouseId(sourceBranchId)
      }
      if (!warehouseId) throw new AppError('Ombor aniqlanmadi', 400)

      const inventory = await prisma.inventory.findUnique({
        where: { sparePartId_warehouseId: { sparePartId: item.sparePartId, warehouseId } },
      })
      if (!inventory) {
        const sp = await prisma.sparePart.findUnique({ where: { id: item.sparePartId }, select: { name: true } })
        throw new AppError(`"${sp?.name || item.sparePartId}" omborda mavjud emas`, 400)
      }
      if (inventory.quantityOnHand < qty) {
        const sp = await prisma.sparePart.findUnique({ where: { id: item.sparePartId }, select: { name: true } })
        throw new AppError(`"${sp?.name}" uchun omborda faqat ${inventory.quantityOnHand} ta mavjud`, 400)
      }

      totalPartsCost += uc * qty
      resolvedItems.push({ ...item, quantityUsed: qty, unitCost: uc, resolvedWarehouseId: warehouseId, inventory })
    }

    const totalCost = totalPartsCost + laborCostVal

    const ops: any[] = []

    // Inventory deductions
    for (const item of resolvedItems) {
      ops.push(prisma.inventory.update({
        where: { id: item.inventory.id },
        data: { quantityOnHand: item.inventory.quantityOnHand - item.quantityUsed },
      }))
    }

    const recordData: any = {
      vehicleId,
      installationDate: new Date(installationDate),
      cost: totalPartsCost,
      laborCost: laborCostVal,
      workerName: workerName || null,
      paymentType: paymentType || 'cash',
      isPaid: isPaid !== undefined ? isPaid : true,
      supplierId: supplierId || null,
      notes,
      performedById: req.user!.id,
    }

    // Backward compat: store first item in legacy fields too
    if (resolvedItems.length > 0) {
      recordData.sparePartId = resolvedItems[0].sparePartId
      recordData.quantityUsed = resolvedItems[0].quantityUsed
      recordData.sourceWarehouseId = resolvedItems[0].resolvedWarehouseId
    }

    ops.unshift(prisma.maintenanceRecord.create({
      data: {
        ...recordData,
        items: resolvedItems.length > 0 ? {
          create: resolvedItems.map(item => ({
            sparePartId: item.sparePartId,
            warehouseId: item.resolvedWarehouseId,
            quantityUsed: item.quantityUsed,
            unitCost: item.unitCost,
          }))
        } : undefined,
      },
      include: {
        vehicle: true, sparePart: true, supplier: true,
        performedBy: { select: { fullName: true } },
        items: { include: { sparePart: { select: { id: true, name: true, partCode: true } }, warehouse: { select: { id: true, name: true } } } },
      },
    }))

    if (totalCost > 0) {
      ops.push(prisma.expense.create({
        data: {
          vehicleId, amount: totalCost,
          description: laborCostVal > 0 && totalPartsCost === 0 ? `Usta haqi${workerName ? ': ' + workerName : ''}` : `Texnik xizmat`,
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

    // Read current record to sync related expense if cost changed
    const existing = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { vehicleId: true, cost: true, laborCost: true, installationDate: true },
    })
    if (!existing) throw new AppError('Rekord topilmadi', 404)

    const oldTotal = Number(existing.cost) + Number(existing.laborCost)
    const newCost = cost !== undefined ? parseFloat(cost) : Number(existing.cost)
    const newLaborCost = laborCost !== undefined ? parseFloat(laborCost) : Number(existing.laborCost)
    const newTotal = newCost + newLaborCost

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

    // Sync auto-created "Texnik xizmat" expense if total cost changed
    if ((cost !== undefined || laborCost !== undefined) && newTotal !== oldTotal) {
      const categoryId = await getOrCreateCategory('Texnik xizmat')
      const startOfDay = new Date(existing.installationDate); startOfDay.setHours(0, 0, 0, 0)
      const endOfDay   = new Date(existing.installationDate); endOfDay.setHours(23, 59, 59, 999)
      await prisma.expense.updateMany({
        where: { vehicleId: existing.vehicleId, expenseDate: { gte: startOfDay, lte: endOfDay }, categoryId, amount: oldTotal },
        data: { amount: newTotal },
      })
    }

    res.json(successResponse(record, 'Rekord yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: { select: { branchId: true } },
        items: true,
      },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    const totalCost = Number(record.cost) + Number(record.laborCost)
    const ops: any[] = [prisma.maintenanceRecord.delete({ where: { id: req.params.id } })]

    if (record.items && record.items.length > 0) {
      // New style: restore each item's inventory
      for (const item of record.items) {
        if (item.warehouseId && item.quantityUsed > 0) {
          ops.push(prisma.inventory.updateMany({
            where: { sparePartId: item.sparePartId, warehouseId: item.warehouseId },
            data: { quantityOnHand: { increment: item.quantityUsed } },
          }))
        }
      }
    } else if (record.sparePartId && record.quantityUsed > 0) {
      // Legacy: single spare part on record
      const warehouseId = record.sourceWarehouseId || await getEffectiveWarehouseId(record.vehicle.branchId)
      if (warehouseId) {
        ops.push(prisma.inventory.updateMany({
          where: { sparePartId: record.sparePartId, warehouseId },
          data: { quantityOnHand: { increment: record.quantityUsed } },
        }))
      }
    }

    // Delete the auto-created "Texnik xizmat" expense
    if (totalCost > 0) {
      const categoryId = await getOrCreateCategory('Texnik xizmat')
      const startOfDay = new Date(record.installationDate); startOfDay.setHours(0, 0, 0, 0)
      const endOfDay   = new Date(record.installationDate); endOfDay.setHours(23, 59, 59, 999)
      ops.push(prisma.expense.deleteMany({
        where: { vehicleId: record.vehicleId, expenseDate: { gte: startOfDay, lte: endOfDay }, categoryId, amount: totalCost },
      }))
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
      _sum: { cost: true, laborCost: true, quantityUsed: true },
      _count: { id: true },
    })

    res.json(successResponse({
      totalCost: (Number(agg._sum.cost) || 0) + (Number(agg._sum.laborCost) || 0),
      totalPartsCost: Number(agg._sum.cost) || 0,
      totalLaborCost: Number(agg._sum.laborCost) || 0,
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
