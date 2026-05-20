import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, isBranchAllowed } from '../lib/orgFilter'
import { detectIsOilFromFields } from '../lib/oilKeywords'

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

// ── POST /engine-records/detect-oil ──────────────────────────────────────────
// Mavjud MaintenanceRecord lardan yog' yozuvlarini retroaktiv aniqlaydi

export async function detectOilRecords(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)

    // Tashkilot doirasidagi barcha maintenance yozuvlarini olamiz
    const where: any = {}
    if (filter.type === 'single') where.vehicle = { branchId: filter.branchId }
    else if (filter.type === 'org') where.vehicle = { branchId: { in: filter.orgBranchIds } }

    const records = await prisma.maintenanceRecord.findMany({
      where,
      select: {
        id: true,
        notes: true,
        sparePart: { select: { name: true } },
        items: { select: { sparePart: { select: { name: true } } } },
      },
    })

    let updated = 0
    for (const r of records) {
      const spNames = [
        r.sparePart?.name,
        ...((r.items as any[]).map((i: any) => i.sparePart?.name)),
      ]
      const isOil = detectIsOilFromFields(r.notes, ...spNames)
      if (isOil) {
        await prisma.maintenanceRecord.update({ where: { id: r.id }, data: { isOil: true } })
        updated++
      }
    }

    res.json(successResponse({ scanned: records.length, updated }, `${updated} ta yog' yozuvi aniqlandi`))
  } catch (err) { next(err) }
}

// ── GET /engine-records/dashboard ─────────────────────────────────────────────
// Dvigatel nazorati: engine records + oylik yog' sarfi trendlari

export async function getEngineDashboard(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const { vehicleId } = req.query as any

    const vehicleWhere: any = {}
    if (filter.type === 'single') vehicleWhere.branchId = filter.branchId
    else if (filter.type === 'org') vehicleWhere.branchId = { in: filter.orgBranchIds }
    if (vehicleId) vehicleWhere.id = vehicleId

    const vehicles = await prisma.vehicle.findMany({
      where: { ...vehicleWhere, status: { not: 'inactive' } },
      select: { id: true, registrationNumber: true, brand: true, model: true, mileage: true },
      orderBy: { registrationNumber: 'asc' },
    })

    const vIds = vehicles.map(v => v.id)
    const twelveMonthsAgo = new Date()
    twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12)

    // So'nggi 12 oylik yog' yozuvlari (xarajat/litr trend uchun — MaintenanceRecord.isOil)
    const oilRecords = await prisma.maintenanceRecord.findMany({
      where: { vehicleId: { in: vIds }, isOil: true, installationDate: { gte: twelveMonthsAgo } },
      select: {
        id: true, vehicleId: true, installationDate: true,
        installationMileage: true, cost: true, oilLiters: true,
      },
      orderBy: { installationDate: 'asc' },
    })

    // OilChange moduli: rasmiy yog' almashtirish jadvali (ServiceInterval.oil_change)
    // "Moy almashtirildi" tugmasi shu jadvalni yangilaydi — bu eng ishonchli manba.
    const oilIntervals = await prisma.serviceInterval.findMany({
      where: { vehicleId: { in: vIds }, serviceType: 'oil_change' },
      select: {
        vehicleId: true,
        lastServiceKm: true,
        lastServiceDate: true,
        nextDueKm: true,
        status: true,
      },
    })

    // Engine records
    const engineRecords = await (prisma as any).engineRecord.findMany({
      where: { vehicleId: { in: vIds } },
      select: {
        id: true, vehicleId: true, recordType: true, mileage: true,
        date: true, description: true, cost: true, nextServiceMileage: true,
        performedBy: true,
      },
      orderBy: { date: 'desc' },
    })

    const vehicleStats = vehicles.map(v => {
      const vOilRecs = oilRecords.filter(r => r.vehicleId === v.id)
      const vEngRecs = engineRecords.filter((r: any) => r.vehicleId === v.id)

      // Oylik yog' xarajati trendi
      const monthlyMap = new Map<string, { cost: number; liters: number; count: number }>()
      for (const r of vOilRecs) {
        const key = r.installationDate.toISOString().slice(0, 7)
        const cur = monthlyMap.get(key) || { cost: 0, liters: 0, count: 0 }
        cur.cost += Number(r.cost)
        cur.liters += r.oilLiters ?? 0
        cur.count++
        monthlyMap.set(key, cur)
      }
      const monthlyTrend = Array.from(monthlyMap.entries())
        .sort((a, b) => a[0].localeCompare(b[0]))
        .map(([month, mv]) => ({ month, ...mv }))

      const totalCost12 = vOilRecs.reduce((s, r) => s + Number(r.cost), 0)
      const totalLiters12 = vOilRecs.reduce((s, r) => s + (r.oilLiters ?? 0), 0)

      // Trend: oxirgi 3 oy vs oldingi 3 oy
      const last3 = monthlyTrend.slice(-3)
      const prev3 = monthlyTrend.slice(-6, -3)
      const last3Avg = last3.length ? last3.reduce((s, m) => s + m.cost, 0) / last3.length : 0
      const prev3Avg = prev3.length ? prev3.reduce((s, m) => s + m.cost, 0) / prev3.length : 0
      const trendPct = prev3Avg > 0 ? Math.round((last3Avg - prev3Avg) / prev3Avg * 100) : 0

      // Ketma-ket o'sayotgan oylar soni
      let consecutiveTrendMonths = 0
      for (let i = monthlyTrend.length - 1; i >= 1; i--) {
        if (monthlyTrend[i].cost > monthlyTrend[i - 1].cost) consecutiveTrendMonths++
        else break
      }

      // Engine records stats
      const lastOverhaul = vEngRecs.find((r: any) => r.recordType === 'overhaul' || r.recordType === 'major_repair')
      const repairCount12m = vEngRecs.filter((r: any) => {
        const d = new Date(r.date)
        return d >= twelveMonthsAgo && (r.recordType === 'overhaul' || r.recordType === 'major_repair')
      }).length

      // Keyingi yog' almashtirish — ServiceInterval.oil_change dan (OilChange moduli)
      // Bu "Moy almashtirildi" tugmasi bosiganda yangilanadi.
      // MaintenanceRecord.isOil faqat xarajat/litr kuzatish uchun — bu yerda ishlatilmaydi.
      const oilInterval = oilIntervals.find(si => si.vehicleId === v.id)
      const nextOilServiceMileage = oilInterval?.nextDueKm != null
        ? Number(oilInterval.nextDueKm)
        : null
      // oilOverdueKm: musbat = o'tib ketgan, manfiy = qolgan
      const oilOverdueKm = nextOilServiceMileage !== null
        ? Math.round(Number(v.mileage) - nextOilServiceMileage)
        : null

      // 1 km uchun yog' xarajati
      const firstOilMileage = vOilRecs.length > 0 ? Number(vOilRecs[0].installationMileage) : null
      const kmDriven = firstOilMileage != null ? Number(v.mileage) - firstOilMileage : 0
      const costPerKm = kmDriven > 500 && totalCost12 > 0
        ? Math.round(totalCost12 / kmDriven)
        : null

      // Charchaganlik balli (yangilangan algoritm)
      let fatigueScore = 0
      if (trendPct > 20) fatigueScore += 2
      else if (trendPct > 10) fatigueScore += 1
      if (repairCount12m >= 2) fatigueScore += 3
      else if (repairCount12m === 1) fatigueScore += 1
      // Yangi faktorlar:
      if (oilOverdueKm !== null && oilOverdueKm > 0) fatigueScore += 2
      if (lastOverhaul && repairCount12m >= 1) {
        const kmSinceOverhaul = Number(v.mileage) - Number(lastOverhaul.mileage)
        if (kmSinceOverhaul > 100_000) fatigueScore += 2
      }
      if (consecutiveTrendMonths >= 3) fatigueScore += 1

      const fatigueLevel: 'ok' | 'warning' | 'critical' =
        fatigueScore >= 6 ? 'critical' : fatigueScore >= 3 ? 'warning' : 'ok'

      return {
        vehicle: v,
        oilRecordsCount: vOilRecs.length,
        totalOilCost12m: Math.round(totalCost12),
        totalOilLiters12m: Math.round(totalLiters12 * 10) / 10,
        monthlyTrend,
        trendPct,
        consecutiveTrendMonths,
        lastOverhaul: lastOverhaul ? { date: lastOverhaul.date, mileage: lastOverhaul.mileage } : null,
        repairCount12m,
        nextOilServiceMileage,
        oilOverdueKm,
        costPerKm,
        fatigueLevel,
        fatigueScore,
        recentEngineRecords: vEngRecs.slice(0, 5),
      }
    })

    res.json(successResponse(vehicleStats))
  } catch (err) { next(err) }
}

// ── GET /engine-records/oil-history ──────────────────────────────────────────
// Vehicle'ning barcha tarixiy yog' yozuvlari (MaintenanceRecord.isOil=true)
// Foydalanuvchi eski yozuvlardan rasmiy moy almashtirish sifatida belgilashi uchun.

export async function getOilHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId } = req.query as any
    if (!vehicleId) throw new AppError('vehicleId majburiy', 400)

    const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId }, select: { branchId: true } })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, vehicle.branchId))
      throw new AppError("Ruxsat yo'q", 403)

    const records = await prisma.maintenanceRecord.findMany({
      where: { vehicleId, isOil: true },
      select: {
        id: true,
        installationDate: true,
        installationMileage: true,
        cost: true,
        oilLiters: true,
        notes: true,
        sparePart: { select: { name: true } },
      },
      orderBy: { installationDate: 'desc' },
    })

    // Har bir yozuvga "tur" tavsifi qo'shamiz:
    // fullChange = oilLiters >= 3 (yoki noma'lum bo'lsa null)
    // topUp     = oilLiters < 3
    const enriched = records.map(r => ({
      ...r,
      oilType: r.oilLiters == null ? 'unknown'
        : r.oilLiters >= 3 ? 'fullChange'
        : 'topUp',
    }))

    res.json(successResponse(enriched))
  } catch (err) { next(err) }
}

// ── POST /engine-records/mark-oil-change ─────────────────────────────────────
// Tarixiy MaintenanceRecord.isOil yozuvini rasmiy moy almashtirish sifatida
// ServiceInterval ga qo'shadi. "Moy almashtirildi" tugmasi bilan bir xil natija.

export async function markOilChangeFromHistory(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { vehicleId, servicedAtKm, servicedAt } = req.body
    if (!vehicleId || !servicedAtKm || !servicedAt)
      throw new AppError('vehicleId, servicedAtKm, servicedAt majburiy', 400)

    const vehicle = await prisma.vehicle.findUnique({
      where: { id: vehicleId },
      select: { branchId: true, oilIntervalKm: true, mileage: true },
    })
    if (!vehicle) throw new AppError('Avtomashina topilmadi', 404)

    const orgFilter = await getOrgFilter(req.user!)
    if (!isBranchAllowed(orgFilter, vehicle.branchId))
      throw new AppError("Ruxsat yo'q", 403)

    // Org settings dan default interval
    let defaultIntervalKm = 7000
    try {
      const branch = await prisma.branch.findUnique({ where: { id: vehicle.branchId }, select: { organizationId: true } })
      const orgId = branch?.organizationId ?? vehicle.branchId
      const orgSettings = await (prisma as any).orgSettings.findUnique({ where: { orgId }, select: { oilIntervalKm: true } })
      if (orgSettings?.oilIntervalKm) defaultIntervalKm = orgSettings.oilIntervalKm
    } catch {}

    const km = Number(servicedAtKm)
    const date = new Date(servicedAt)
    const intervalKm = vehicle.oilIntervalKm ?? defaultIntervalKm
    const nextDueKm = km + intervalKm

    // ServiceInterval ni yangilaymiz (yoki yaratamiz)
    const interval = await prisma.serviceInterval.upsert({
      where: { vehicleId_serviceType: { vehicleId, serviceType: 'oil_change' } },
      create: {
        vehicleId,
        serviceType: 'oil_change',
        intervalKm,
        intervalDays: 180,
        warningKm: 500,
        lastServiceKm: km,
        lastServiceDate: date,
        nextDueKm,
        nextDueDate: new Date(date.getTime() + 180 * 24 * 60 * 60 * 1000),
        status: 'ok',
      },
      update: {
        lastServiceKm: km,
        lastServiceDate: date,
        nextDueKm,
        nextDueDate: new Date(date.getTime() + 180 * 24 * 60 * 60 * 1000),
        status: 'ok',
        intervalKm,
      },
    })

    // ServiceRecord ham yaratamiz (tarix uchun)
    await prisma.serviceRecord.create({
      data: {
        vehicleId,
        serviceIntervalId: interval.id,
        serviceType: 'oil_change',
        servicedAtKm: km,
        servicedAt: date,
        cost: 0,
        notes: "Tarixiy yozuvdan import qilindi",
        nextDueKm,
        createdById: req.user!.id,
      },
    })

    res.json(successResponse({ nextDueKm, intervalKm }, `Moy almashtirish qayd etildi. Keyingi: ${nextDueKm.toLocaleString()} km`))
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
