import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, paginate, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getSearchVariants } from '../lib/transliterate'
import { getOrgFilter, applyBranchFilter, resolveOrgId } from '../lib/orgFilter'

// Ism normalizatsiyasi — workerName (erkin matn) bilan moslashtirish uchun
const norm = (s: string | null | undefined) => (s || '').trim().toLowerCase()

function orgFilterBlock(orgId: string | null) {
  if (!orgId) return null // super_admin: filter yo'q
  return { organizationId: orgId }
}

async function assertMasterAccess(masterId: string, orgId: string | null) {
  const master = await prisma.master.findUnique({ where: { id: masterId }, select: { organizationId: true } })
  if (!master) throw new AppError('Usta topilmadi', 404)
  if (orgId && master.organizationId && master.organizationId !== orgId)
    throw new AppError("Bu ustaga kirish huquqingiz yo'q", 403)
  return master
}

// Ta'mirlash yozuvlaridagi usta haqini (laborCost) workerName bo'yicha yig'adi.
// Faqat foydalanuvchi org'iga tegishli filiallar bo'yicha (tenant izolatsiya).
async function laborByWorkerName(
  user: { id: string; role: string; branchId?: string | null },
  dateRange?: { gte?: Date; lt?: Date },
): Promise<Map<string, { work: number; count: number }>> {
  const filter = await getOrgFilter(user)
  const bv = applyBranchFilter(filter)
  const where: any = { workerName: { not: null }, laborCost: { gt: 0 } }
  if (bv !== undefined) where.vehicle = { branchId: bv }
  if (dateRange) where.installationDate = dateRange

  const grouped = await prisma.maintenanceRecord.groupBy({
    by: ['workerName'],
    where,
    _sum: { laborCost: true },
    _count: { _all: true },
  })
  const map = new Map<string, { work: number; count: number }>()
  for (const g of grouped) {
    const key = norm(g.workerName)
    if (!key) continue
    const prev = map.get(key) || { work: 0, count: 0 }
    prev.work += Number(g._sum.laborCost) || 0
    prev.count += g._count._all || 0
    map.set(key, prev)
  }
  return map
}

// ─── List ─────────────────────────────────────────────────────────────────────
export async function getMasters(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { page, limit, skip } = paginate(req.query)
    const { search, isActive } = req.query as any
    const orgId = await resolveOrgId(req.user!)

    const and: any[] = []
    const orgBlock = orgFilterBlock(orgId)
    if (orgBlock) and.push(orgBlock)
    if (search) {
      const variants = getSearchVariants(search)
      and.push({
        OR: variants.flatMap(v => [
          { name: { contains: v, mode: 'insensitive' } },
          { phone: { contains: v, mode: 'insensitive' } },
        ]),
      })
    }
    if (isActive !== undefined) and.push({ isActive: isActive === 'true' })
    const where: any = and.length ? { AND: and } : {}

    const [total, masters, labor] = await Promise.all([
      prisma.master.count({ where }),
      prisma.master.findMany({ where, skip, take: limit, orderBy: { name: 'asc' } }),
      laborByWorkerName(req.user!),
    ])

    // To'lovlar — masterId bo'yicha jami
    const masterIds = masters.map(m => m.id)
    const payAgg = masterIds.length
      ? await prisma.masterPayment.groupBy({
          by: ['masterId'],
          where: { masterId: { in: masterIds } },
          _sum: { amount: true },
        })
      : []
    const paidByMaster = new Map<string, number>(payAgg.map(p => [p.masterId, Number(p._sum.amount) || 0]))

    const data = masters.map(m => {
      const l = labor.get(norm(m.name)) || { work: 0, count: 0 }
      const totalPaid = paidByMaster.get(m.id) || 0
      return {
        ...m,
        totalWork: Math.round(l.work),
        workCount: l.count,
        totalPaid: Math.round(totalPaid),
        balance: Math.round(l.work - totalPaid), // qarz (musbat = biz qarzdormiz)
      }
    })

    res.json({ success: true, data, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } })
  } catch (err) { next(err) }
}

// ─── Detail (oylik kesim + ishlar + to'lovlar) ──────────────────────────────────
export async function getMasterDetail(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const master = await prisma.master.findUnique({
      where: { id: req.params.id },
      include: { payments: { orderBy: { paymentDate: 'desc' } } },
    })
    if (!master) throw new AppError('Usta topilmadi', 404)
    if (orgId && master.organizationId && master.organizationId !== orgId)
      throw new AppError("Bu ustaga kirish huquqingiz yo'q", 403)

    // Usta bajargan ishlar — workerName=usta ismi, org filiallari doirasida
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)
    const works = await prisma.maintenanceRecord.findMany({
      where: {
        workerName: { equals: master.name, mode: 'insensitive' },
        laborCost: { gt: 0 },
        ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}),
      },
      select: {
        id: true, installationDate: true, laborCost: true, notes: true, paymentType: true,
        vehicle: { select: { registrationNumber: true, brand: true, model: true } },
      },
      orderBy: { installationDate: 'desc' },
      take: 300,
    })

    // Oylik kesim
    const byMonth = new Map<string, { work: number; count: number }>()
    for (const w of works) {
      const mKey = new Date(w.installationDate).toISOString().slice(0, 7)
      const prev = byMonth.get(mKey) || { work: 0, count: 0 }
      prev.work += Number(w.laborCost) || 0
      prev.count++
      byMonth.set(mKey, prev)
    }
    const monthly = [...byMonth.entries()]
      .sort(([a], [b]) => b.localeCompare(a))
      .map(([month, d]) => ({
        month,
        label: new Date(month + '-01').toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' }),
        work: Math.round(d.work),
        count: d.count,
      }))

    const totalWork = works.reduce((s, w) => s + Number(w.laborCost), 0)
    const totalPaid = master.payments.reduce((s, p) => s + Number(p.amount), 0)

    res.json(successResponse({
      ...master,
      works: works.map(w => ({
        id: w.id,
        date: w.installationDate,
        laborCost: Math.round(Number(w.laborCost)),
        notes: w.notes,
        paymentType: w.paymentType,
        vehicle: w.vehicle ? `${w.vehicle.registrationNumber} (${w.vehicle.brand} ${w.vehicle.model})` : '—',
      })),
      monthly,
      totalWork: Math.round(totalWork),
      totalPaid: Math.round(totalPaid),
      balance: Math.round(totalWork - totalPaid),
    }))
  } catch (err) { next(err) }
}

// ─── CRUD ───────────────────────────────────────────────────────────────────
export async function createMaster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { name, phone, notes } = req.body
    if (!name || !String(name).trim()) throw new AppError('Usta ismi kiritilmagan', 400)

    // Takror nomdan saqlanish (org doirasida)
    const dup = await prisma.master.findFirst({
      where: { name: { equals: String(name).trim(), mode: 'insensitive' }, ...(orgId ? { organizationId: orgId } : {}) },
      select: { id: true },
    })
    if (dup) throw new AppError('Bu nomli usta allaqachon mavjud', 400)

    const master = await prisma.master.create({
      data: {
        name: String(name).trim(),
        phone: phone || null,
        notes: notes || null,
        branchId: req.user!.branchId || null,
        organizationId: orgId,
        createdById: req.user!.id,
      },
    })
    res.status(201).json(successResponse(master, "Usta qo'shildi"))
  } catch (err) { next(err) }
}

export async function updateMaster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await assertMasterAccess(req.params.id, orgId)
    const { name, phone, notes, isActive } = req.body
    const takeOwnership = existing.organizationId === null && orgId ? { organizationId: orgId } : {}
    const master = await prisma.master.update({
      where: { id: req.params.id },
      data: {
        ...takeOwnership,
        ...(name && { name: String(name).trim() }),
        ...(phone !== undefined && { phone: phone || null }),
        ...(notes !== undefined && { notes: notes || null }),
        ...(isActive !== undefined && { isActive }),
      },
    })
    res.json(successResponse(master, 'Usta yangilandi'))
  } catch (err) { next(err) }
}

export async function deleteMaster(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    await assertMasterAccess(req.params.id, orgId)
    await prisma.master.delete({ where: { id: req.params.id } }) // to'lovlar cascade o'chadi
    res.json(successResponse(null, "Usta o'chirildi"))
  } catch (err) { next(err) }
}

// ─── To'lovlar ──────────────────────────────────────────────────────────────
export async function createMasterPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    await assertMasterAccess(req.params.id, orgId)
    const { amount, paymentDate, method, note } = req.body
    if (!amount || isNaN(parseFloat(amount)) || parseFloat(amount) <= 0)
      throw new AppError("Summa to'g'ri kiritilmagan", 400)
    if (!paymentDate || isNaN(Date.parse(paymentDate)))
      throw new AppError('Sana noto\'g\'ri', 400)

    const payment = await prisma.masterPayment.create({
      data: {
        masterId: req.params.id,
        amount: parseFloat(amount),
        paymentDate: new Date(paymentDate),
        method: ['cash', 'card', 'transfer'].includes(method) ? method : 'cash',
        note: note || null,
        createdById: req.user!.id,
      },
    })
    res.status(201).json(successResponse(payment, "To'lov qo'shildi"))
  } catch (err) { next(err) }
}

export async function deleteMasterPayment(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const payment = await prisma.masterPayment.findUnique({
      where: { id: req.params.paymentId },
      select: { masterId: true },
    })
    if (!payment) throw new AppError('To\'lov topilmadi', 404)
    await assertMasterAccess(payment.masterId, orgId)
    await prisma.masterPayment.delete({ where: { id: req.params.paymentId } })
    res.json(successResponse(null, "To'lov o'chirildi"))
  } catch (err) { next(err) }
}

// ─── Ta'mirlashdagi usta nomlaridan import ──────────────────────────────────
export async function syncFromMaintenance(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const filter = await getOrgFilter(req.user!)
    const bv = applyBranchFilter(filter)

    const rows = await prisma.maintenanceRecord.findMany({
      where: { workerName: { not: null }, ...(bv !== undefined ? { vehicle: { branchId: bv } } : {}) },
      select: { workerName: true },
      distinct: ['workerName'],
    })
    const names = [...new Set(rows.map(r => (r.workerName || '').trim()).filter(Boolean))]

    const existing = await prisma.master.findMany({
      where: { ...(orgId ? { organizationId: orgId } : {}) },
      select: { name: true },
    })
    const existingSet = new Set(existing.map(m => norm(m.name)))

    const toCreate = names.filter(n => !existingSet.has(norm(n)))
    if (toCreate.length > 0) {
      await prisma.master.createMany({
        data: toCreate.map(name => ({
          name,
          branchId: req.user!.branchId || null,
          organizationId: orgId,
          createdById: req.user!.id,
        })),
      })
    }

    res.json(successResponse({ created: toCreate.length, total: names.length }, `${toCreate.length} ta usta import qilindi`))
  } catch (err) { next(err) }
}
