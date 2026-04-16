import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter, isBranchAllowed } from '../lib/orgFilter'

const STATUS_VALUES = ['ok', 'warning', 'critical']
const FIELDS = ['engineOil', 'coolant', 'brakes', 'transmission', 'tires', 'lights', 'exhaust', 'bodyCondition']

export async function getInspections(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { vehicleId, branchId, from, to, overallStatus } = req.query as any

    const filter = await getOrgFilter(req.user!)
    const filterVal = applyBranchFilter(filter)

    const where: any = {}
    if (vehicleId) where.vehicleId = vehicleId
    if (overallStatus) where.overallStatus = overallStatus
    if (from || to) where.inspectionDate = {
      ...(from && { gte: new Date(from) }),
      ...(to && { lte: new Date(to) }),
    }

    // Org filter — vehicle.branchId orqali
    if (filterVal !== undefined) where.vehicle = { branchId: filterVal }
    else if (branchId) where.vehicle = { branchId }

    const [total, records] = await Promise.all([
      (prisma as any).techInspection.count({ where }),
      (prisma as any).techInspection.findMany({
        where, skip, take: limit,
        include: {
          vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true } },
          inspectedBy: { select: { id: true, fullName: true } },
        },
        orderBy: { inspectionDate: 'desc' },
      }),
    ])

    res.json({ success: true, data: records, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

export async function getInspectionById(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const record = await (prisma as any).techInspection.findUnique({
      where: { id: req.params.id },
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true, branchId: true } },
        inspectedBy: { select: { id: true, fullName: true } },
      },
    })
    if (!record) throw new AppError('Tekshiruv topilmadi', 404)
    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, record.vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)
    res.json(successResponse(record))
  } catch (err) { next(err) }
}

export async function createInspection(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, inspectionDate, notes } = req.body
    if (!vehicleId || !inspectionDate) throw new AppError('vehicleId va inspectionDate majburiy', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, vehicle.branchId))
      throw new AppError('Bu avtomashina sizning tashkilotingizda emas', 403)

    // Har bir maydon uchun validatsiya
    const fieldData: Record<string, string> = {}
    for (const f of FIELDS) {
      const val = req.body[f] || 'ok'
      if (!STATUS_VALUES.includes(val)) throw new AppError(`${f} qiymati: ok | warning | critical`, 400)
      fieldData[f] = val
    }

    // overallStatus: eng yomon qiymatni avtomatik hisoblash
    const ovr = req.body.overallStatus
    const autoStatus = FIELDS.some(f => fieldData[f] === 'critical') ? 'critical'
      : FIELDS.some(f => fieldData[f] === 'warning') ? 'warning' : 'ok'
    const overallStatus = ovr && STATUS_VALUES.includes(ovr) ? ovr : autoStatus

    const record = await (prisma as any).techInspection.create({
      data: {
        vehicleId,
        branchId: vehicle.branchId || null,
        inspectedById: req.user!.id,
        inspectionDate: new Date(inspectionDate),
        ...fieldData,
        overallStatus,
        notes: notes || null,
      },
      include: {
        vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } },
        inspectedBy: { select: { id: true, fullName: true } },
      },
    })

    // Critical bo'lsa admin ga xabar (non-blocking)
    if (overallStatus === 'critical') {
      notifyCriticalInspection(record, vehicle.branchId).catch(() => {})
    }

    res.status(201).json(successResponse(record, 'Texnik tekshiruv saqlandi'))
  } catch (err) { next(err) }
}

export async function updateInspection(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await (prisma as any).techInspection.findUnique({
      where: { id: req.params.id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!existing) throw new AppError('Tekshiruv topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, existing.vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    const fieldData: Record<string, string> = {}
    for (const f of FIELDS) {
      if (req.body[f] !== undefined) {
        if (!STATUS_VALUES.includes(req.body[f])) throw new AppError(`${f}: ok | warning | critical`, 400)
        fieldData[f] = req.body[f]
      }
    }

    const merged = { ...existing, ...fieldData }
    const autoStatus = FIELDS.some(f => merged[f] === 'critical') ? 'critical'
      : FIELDS.some(f => merged[f] === 'warning') ? 'warning' : 'ok'

    const record = await (prisma as any).techInspection.update({
      where: { id: req.params.id },
      data: {
        ...fieldData,
        overallStatus: req.body.overallStatus || autoStatus,
        ...(req.body.notes !== undefined && { notes: req.body.notes || null }),
        ...(req.body.inspectionDate && { inspectionDate: new Date(req.body.inspectionDate) }),
      },
      include: { vehicle: { select: { id: true, registrationNumber: true, brand: true, model: true } } },
    })
    res.json(successResponse(record, 'Tekshiruv yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteInspection(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const existing = await (prisma as any).techInspection.findUnique({
      where: { id: req.params.id },
      include: { vehicle: { select: { branchId: true } } },
    })
    if (!existing) throw new AppError('Tekshiruv topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, existing.vehicle.branchId))
      throw new AppError('Ruxsat yo\'q', 403)

    await (prisma as any).techInspection.delete({ where: { id: req.params.id } })
    res.json(successResponse(null, 'O\'chirildi'))
  } catch (err) { next(err) }
}

async function notifyCriticalInspection(record: any, branchId: string) {
  const branch = await (prisma.branch as any).findUnique({ where: { id: branchId }, select: { organizationId: true } })
  const orgId = branch?.organizationId ?? branchId
  const orgBranches = await (prisma.branch as any).findMany({ where: { organizationId: orgId }, select: { id: true } })
  const orgBranchIds = orgBranches.map((b: any) => b.id)
  const recipients = await prisma.user.findMany({
    where: { isActive: true, branchId: { in: orgBranchIds }, role: { in: ['admin', 'branch_manager'] } },
    select: { id: true },
  })
  if (recipients.length === 0) return

  const vName = record.vehicle ? `${record.vehicle.brand} ${record.vehicle.model} (${record.vehicle.registrationNumber})` : record.vehicleId
  await (prisma.notification as any).createMany({
    data: recipients.map((r: any) => ({
      userId: r.id,
      title: 'Kritik texnik tekshiruv natijasi!',
      message: `"${vName}" mashinasi texnik tekshiruvda KRITIK holat aniqlandi. Darhol e'tibor bering!`,
      type: 'error',
      link: `/inspections/${record.id}`,
    })),
  })
}

// Scheduler tomonidan chaqiriladi: shu oy inspeksiyasi yo'q mashinalarni topib xabar beradi
export async function checkMissingMonthlyInspections() {
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  // Barcha aktiv mashinalar
  const vehicles = await prisma.vehicle.findMany({
    where: { status: 'active' },
    select: { id: true, brand: true, model: true, registrationNumber: true, branchId: true },
  })

  // Shu oy inspection bo'lgan vehicleId'lar
  const done = await (prisma as any).techInspection.findMany({
    where: { inspectionDate: { gte: monthStart } },
    select: { vehicleId: true },
    distinct: ['vehicleId'],
  })
  const doneIds = new Set(done.map((d: any) => d.vehicleId))

  const missing = vehicles.filter(v => !doneIds.has(v.id))
  if (missing.length === 0) return

  // Har bir filial uchun guruhlab xabar berish
  const byBranch = missing.reduce<Record<string, typeof missing>>((acc, v) => {
    if (!acc[v.branchId]) acc[v.branchId] = []
    acc[v.branchId].push(v)
    return acc
  }, {})

  for (const [branchId, branchVehicles] of Object.entries(byBranch)) {
    const branch = await (prisma.branch as any).findUnique({ where: { id: branchId }, select: { organizationId: true, name: true } })
    const orgId = branch?.organizationId ?? branchId
    const orgBranches = await (prisma.branch as any).findMany({ where: { organizationId: orgId }, select: { id: true } })
    const recipients = await prisma.user.findMany({
      where: { isActive: true, branchId: { in: orgBranches.map((b: any) => b.id) }, role: { in: ['admin', 'branch_manager'] } },
      select: { id: true },
    })
    if (recipients.length === 0) continue

    const monthStr = now.toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long' })
    await (prisma.notification as any).createMany({
      data: recipients.map((r: any) => ({
        userId: r.id,
        title: 'Oylik texnik tekshiruv o\'tkazilmagan',
        message: `${branch?.name || branchId} filialida ${branchVehicles.length} ta mashina ${monthStr} oylik texnik tekshiruvdan o'tmagan. Tezda o'tkazing!`,
        type: 'warning',
        link: `/inspections`,
      })),
    })
  }
}
