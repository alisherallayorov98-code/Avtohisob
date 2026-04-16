import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'

const RECORD_TYPES = ['overhaul', 'major_repair', 'minor_repair', 'inspection']
const TYPE_LABELS: Record<string, string> = {
  overhaul: 'Kapital remont',
  major_repair: 'Yirik ta\'mirat',
  minor_repair: 'Kichik ta\'mirat',
  inspection: 'Texnik ko\'rik',
}

export async function getEngineRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, recordType, from, to } = req.query as any

    const filter = await getOrgFilter(req.user!)

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (recordType) where.recordType = recordType
    if (from || to) {
      where.date = {
        ...(from && { gte: new Date(from) }),
        ...(to && { lte: new Date(to) }),
      }
    }

    // Org filter — vehicle.branchId orqali
    if (filter.type === 'single') where.vehicle = { branchId: filter.branchId }
    else if (filter.type === 'org') where.vehicle = { branchId: { in: filter.orgBranchIds } }

    const [total, records] = await Promise.all([
      (prisma as any).engineRecord.count({ where }),
      (prisma as any).engineRecord.findMany({
        where, skip, take: limit,
        include: {
          vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
        orderBy: { date: 'desc' },
      }),
    ])

    res.json({ success: true, data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function createEngineRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, recordType, mileage, date, description, cost, nextServiceMileage, performedBy, notes } = req.body

    if (!vehicleId || !recordType || !mileage || !date || !description)
      throw new AppError('vehicleId, recordType, mileage, date, description majburiy', 400)
    if (!RECORD_TYPES.includes(recordType))
      throw new AppError(`recordType: ${RECORD_TYPES.join(' | ')}`, 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, vehicle.branchId))
      throw new AppError('Bu avtomashina sizning tashkilotingizda emas', 403)

    const record = await (prisma as any).engineRecord.create({
      data: {
        vehicleId,
        recordType,
        mileage: parseFloat(mileage),
        date: new Date(date),
        description,
        cost: parseFloat(cost || '0'),
        nextServiceMileage: nextServiceMileage ? parseFloat(nextServiceMileage) : null,
        performedBy: performedBy || null,
        notes: notes || null,
        createdById: req.user!.id,
      },
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
        createdBy: { select: { id: true, fullName: true } },
      },
    })

    // Kapital remont bo'lsa smart alert tekshir (non-blocking)
    if (recordType === 'overhaul' || recordType === 'major_repair') {
      checkEngineOverhaulAlert(record.id, vehicleId, vehicle.branchId, new Date(date)).catch(() => {})
    }

    res.status(201).json(successResponse(record, `${TYPE_LABELS[recordType]} qayd etildi`))
  } catch (err) { next(err) }
}

export async function updateEngineRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await (prisma as any).engineRecord.findUnique({
      where: { id: req.params.id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!existing) throw new AppError('Yozuv topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, existing.vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    const { recordType, mileage, date, description, cost, nextServiceMileage, performedBy, notes } = req.body
    const record = await (prisma as any).engineRecord.update({
      where: { id: req.params.id },
      data: {
        ...(recordType && { recordType }),
        ...(mileage !== undefined && { mileage: parseFloat(mileage) }),
        ...(date && { date: new Date(date) }),
        ...(description && { description }),
        ...(cost !== undefined && { cost: parseFloat(cost) }),
        ...(nextServiceMileage !== undefined && { nextServiceMileage: nextServiceMileage ? parseFloat(nextServiceMileage) : null }),
        ...(performedBy !== undefined && { performedBy: performedBy || null }),
        ...(notes !== undefined && { notes: notes || null }),
      },
      include: { vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } } },
    })
    res.json(successResponse(record, 'Yozuv yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteEngineRecord(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await (prisma as any).engineRecord.findUnique({
      where: { id: req.params.id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!existing) throw new AppError('Yozuv topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, existing.vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    await (prisma as any).engineRecord.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'O\'chirildi'))
  } catch (err) { next(err) }
}

// Smart alert: 12 oy ichida 2+ kapital/yirik remont bo'lsa ogohlantirish
async function checkEngineOverhaulAlert(
  newRecordId: string,
  vehicleId: string,
  vehicleBranchId: string,
  date: Date
) {
  const oneYearAgo = new Date(date)
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1)

  const count = await (prisma as any).engineRecord.count({
    where: {
      vehicleId,
      id: { not: newRecordId },
      recordType: { in: ['overhaul', 'major_repair'] },
      date: { gte: oneYearAgo },
    },
  })
  if (count < 1) return

  const v = await prisma.vehicle.findUnique({
    where: { id: vehicleId },
    select: { brand: true, model: true, registrationNumber: true, branchId: true },
  })
  const vName = v ? `${v.brand} ${v.model} (${v.registrationNumber})` : vehicleId

  const branch = await (prisma.branch as any).findUnique({ where: { id: vehicleBranchId }, select: { organizationId: true } })
  const orgId = branch?.organizationId ?? vehicleBranchId
  const orgBranches = await (prisma.branch as any).findMany({ where: { organizationId: orgId }, select: { id: true } })
  const orgBranchIds = orgBranches.map((b: any) => b.id)
  const recipients = await prisma.user.findMany({
    where: { isActive: true, branchId: { in: orgBranchIds }, role: { in: ['admin', 'branch_manager'] } },
    select: { id: true },
  })
  if (recipients.length === 0) return

  await (prisma.notification as any).createMany({
    data: recipients.map(r => ({
      userId: r.id,
      title: 'Dvigatel qayta ta\'mirga tushdi!',
      message: `"${vName}" mashinasining dvigateli so'nggi 12 oy ichida ${count + 1} marta yirik ta'mirga tushdi. Hisobdan chiqarishni ko'rib chiqing.`,
      type: 'warning',
      link: `/vehicles/${vehicleId}`,
    })),
  })
}
