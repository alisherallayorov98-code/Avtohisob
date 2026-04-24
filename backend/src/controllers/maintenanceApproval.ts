import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'
import { getEffectiveWarehouseId } from '../lib/warehouse'
import {
  checkFrequentMaintenance,
  checkPartPriceAnomaly,
  checkWorkerRepeatOnVehicle,
  checkWorkerHighVolume,
  checkInventoryLow,
} from '../lib/smartAlerts'

async function getOrCreateCategory(name: string) {
  let cat = await prisma.expenseCategory.findFirst({ where: { name } })
  if (!cat) cat = await prisma.expenseCategory.create({ data: { name, description: name } })
  return cat.id
}

export async function getPendingMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const where: any = { status: 'pending_approval' }
    if (filter.type === 'single') where.vehicle = { branchId: filter.branchId }
    else if (filter.type === 'org') where.vehicle = { branchId: { in: filter.orgBranchIds } }
    // type === 'none' → super_admin sees all

    const records = await prisma.maintenanceRecord.findMany({
      where,
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true } },
        sparePart: { select: { id: true, name: true, partCode: true } },
        performedBy: { select: { id: true, fullName: true } },
        items: {
          include: {
            sparePart: { select: { id: true, name: true, partCode: true } },
            warehouse: { select: { id: true, name: true } },
          },
        },
        evidence: true,
      },
      orderBy: { createdAt: 'desc' },
    })

    const count = records.length
    res.json({ success: true, data: records, meta: { count } })
  } catch (err) { next(err) }
}

export async function approveMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: { select: { id: true, branchId: true, mileage: true } },
        items: true,
      },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)
    if ((record as any).status !== 'pending_approval') {
      throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const totalCost = Number(record.cost) + Number(record.laborCost)
    const expenseCategoryId = totalCost > 0 ? await getOrCreateCategory('Texnik xizmat') : null

    const updated = await prisma.$transaction(async (tx) => {
      // Race-safe status transition: updateMany with status in WHERE is atomic.
      // If another concurrent request already approved/rejected this record,
      // count === 0 and we roll back the whole transaction — no double-deduction.
      const transition = await tx.maintenanceRecord.updateMany({
        where: { id: req.params.id, status: 'pending_approval' },
        data: { status: 'approved', approvedById: req.user!.id, approvedAt: new Date() },
      })
      if (transition.count === 0) {
        throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
      }

      // Deduct inventory now (safe — only one transaction reaches this point)
      if (record.items.length > 0) {
        for (const item of record.items) {
          if (!item.warehouseId || item.quantityUsed <= 0) continue
          const inv = await tx.inventory.findFirst({
            where: { sparePartId: item.sparePartId, warehouseId: item.warehouseId },
          })
          if (inv && inv.quantityOnHand < item.quantityUsed) {
            const sp = await tx.sparePart.findUnique({ where: { id: item.sparePartId }, select: { name: true } })
            throw new AppError(`"${sp?.name}" uchun omborda faqat ${inv.quantityOnHand} ta mavjud`, 400)
          }
          await tx.inventory.updateMany({
            where: { sparePartId: item.sparePartId, warehouseId: item.warehouseId },
            data: { quantityOnHand: { decrement: item.quantityUsed } },
          })
        }
      } else if (record.sparePartId && record.quantityUsed > 0) {
        const warehouseId = record.sourceWarehouseId || await getEffectiveWarehouseId(record.vehicle.branchId)
        if (warehouseId) {
          await tx.inventory.updateMany({
            where: { sparePartId: record.sparePartId, warehouseId },
            data: { quantityOnHand: { decrement: record.quantityUsed } },
          })
        }
      }

      // Create expense
      if (totalCost > 0 && expenseCategoryId) {
        await tx.expense.create({
          data: {
            vehicleId: record.vehicleId,
            amount: totalCost,
            description: 'Texnik xizmat',
            expenseDate: record.installationDate,
            createdById: req.user!.id,
            categoryId: expenseCategoryId,
          },
        })
      }

      // Notify creator
      await tx.notification.create({
        data: {
          userId: record.performedById,
          title: 'Ta\'mirlash tasdiqlandi',
          message: `${req.user!.fullName} sizning ta\'mirlash yozuvingizni tasdiqladi va ehtiyot qism hisobdan chiqarildi.`,
          type: 'success',
          link: `/maintenance`,
        },
      })

      return tx.maintenanceRecord.findUnique({
        where: { id: req.params.id },
        include: {
          vehicle: true,
          items: { include: { sparePart: { select: { id: true, name: true } } } },
          performedBy: { select: { fullName: true } },
          approvedBy: { select: { fullName: true } },
        },
      })
    })

    // Smart alerts — non-blocking
    const date = record.installationDate
    const uniquePartIds = [...new Set(record.items.map((i: any) => i.sparePartId))]
    checkFrequentMaintenance(record.id, record.vehicleId, record.vehicle.branchId, date).catch(() => {})
    checkPartPriceAnomaly(record.vehicle.branchId, record.items.map((i: any) => ({ sparePartId: i.sparePartId, unitCost: Number(i.unitCost) }))).catch(() => {})
    checkWorkerRepeatOnVehicle(record.id, record.vehicleId, record.vehicle.branchId, record.workerName, date).catch(() => {})
    checkWorkerHighVolume(record.id, record.vehicle.branchId, record.workerName, date).catch(() => {})
    for (const item of record.items) {
      if (item.warehouseId) checkInventoryLow(item.warehouseId, item.sparePartId, record.vehicle.branchId).catch(() => {})
    }

    res.json(successResponse(updated, 'Tasdiqlandi va ehtiyot qism hisobdan chiqarildi'))
  } catch (err) { next(err) }
}

export async function rejectMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { reason } = req.body
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { status: true, performedById: true, vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)
    if ((record as any).status !== 'pending_approval') {
      throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Race-safe transition: only rejects if still pending
      const transition = await tx.maintenanceRecord.updateMany({
        where: { id: req.params.id, status: 'pending_approval' },
        data: { status: 'rejected', approvedById: req.user!.id, approvedAt: new Date(), rejectedReason: reason || null },
      })
      if (transition.count === 0) {
        throw new AppError('Bu rekord allaqachon ko\'rib chiqilgan', 400)
      }

      await tx.notification.create({
        data: {
          userId: record.performedById,
          title: 'Ta\'mirlash rad etildi',
          message: `${req.user!.fullName} sizning ta\'mirlash yozuvingizni rad etdi.${reason ? ' Sabab: ' + reason : ''}`,
          type: 'error',
          link: `/maintenance`,
        },
      })

      return tx.maintenanceRecord.findUnique({ where: { id: req.params.id } })
    })

    res.json(successResponse(updated, 'Rad etildi'))
  } catch (err) { next(err) }
}

export async function uploadEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { id: true, performedById: true, status: true, vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    const isAdmin = ['admin', 'super_admin'].includes(req.user!.role)

    // Security: only the creator or admin can upload evidence
    if (!isAdmin && record.performedById !== req.user!.id) {
      throw new AppError('Faqat yozuvni yaratgan xodim yoki admin rasm yuklashi mumkin', 403)
    }
    // Security: cannot upload evidence to already approved or rejected records
    if ((record as any).status !== 'pending_approval' && !isAdmin) {
      throw new AppError('Faqat kutayotgan yozuvlarga rasm yuklash mumkin', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const files: Array<{ url: string; size: number }> = (req as any).compressedFiles || []
    if (files.length === 0) throw new AppError('Fayl yuklanmadi', 400)

    const existing = await prisma.maintenanceEvidence.count({ where: { maintenanceId: record.id } })
    if (existing + files.length > 3) {
      throw new AppError(`Maksimal 3 ta rasm ruxsat etiladi. Hozir ${existing} ta bor.`, 400)
    }

    const created = await prisma.maintenanceEvidence.createMany({
      data: files.map(f => ({
        maintenanceId: record.id,
        fileUrl: f.url,
        fileSizeBytes: f.size,
        uploadedById: req.user!.id,
      })),
    })

    res.status(201).json(successResponse(created, `${files.length} ta rasm yuklandi`))
  } catch (err) { next(err) }
}

export async function getEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await prisma.maintenanceRecord.findUnique({
      where: { id: req.params.id },
      select: { vehicle: { select: { branchId: true } } },
    })
    if (!record) throw new AppError('Rekord topilmadi', 404)

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, record.vehicle.branchId)) {
      throw new AppError('Bu yozuvga kirish huquqingiz yo\'q', 403)
    }

    const evidence = await prisma.maintenanceEvidence.findMany({
      where: { maintenanceId: req.params.id },
      orderBy: { createdAt: 'asc' },
    })

    res.json(successResponse(evidence))
  } catch (err) { next(err) }
}

export async function deleteEvidence(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { evidenceId } = req.params
    const ev = await prisma.maintenanceEvidence.findUnique({
      where: { id: evidenceId },
      include: { maintenance: { select: { status: true, vehicle: { select: { branchId: true } } } } },
    })
    if (!ev) throw new AppError('Rasm topilmadi', 404)
    if ((ev.maintenance as any).status === 'approved') {
      throw new AppError('Tasdiqlangan yozuvdan rasm o\'chirib bo\'lmaydi', 400)
    }

    const filter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(filter, ev.maintenance.vehicle.branchId)) {
      throw new AppError('Kirish huquqi yo\'q', 403)
    }

    await prisma.maintenanceEvidence.delete({ where: { id: evidenceId } })

    // Delete physical file
    try {
      const fs = await import('fs')
      const path = await import('path')
      const filePath = path.join(process.cwd(), ev.fileUrl)
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath)
    } catch {}

    res.json(successResponse(null, 'Rasm o\'chirildi'))
  } catch (err) { next(err) }
}
