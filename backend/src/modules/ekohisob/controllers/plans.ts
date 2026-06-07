import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'

function todayStr(): string {
  return new Date().toISOString().slice(0, 10)
}

function dayBounds(dateStr: string) {
  const start = new Date(dateStr + 'T00:00:00.000Z')
  const end = new Date(start)
  end.setUTCDate(end.getUTCDate() + 1)
  return { start, end }
}

// O'sha kun inspektor kiritgan tashkilotlar soni (plan progressi)
export async function entityProgress(orgId: string, inspectorId: string, dateStr: string): Promise<number> {
  const { start, end } = dayBounds(dateStr)
  return (prisma as any).ekoHisobLegalEntity.count({
    where: { orgId, createdBy: inspectorId, createdAt: { gte: start, lt: end } },
  })
}

// Supervisor — o'z tumani inspektorlari; admin — barcha inspektorlar
async function inspectorsFor(orgId: string, role: string, districtIds: string[]) {
  const where: any = { orgId, role: 'inspector', isActive: true }
  if (role === 'supervisor') where.districts = { some: { districtId: { in: districtIds } } }
  return (prisma as any).ekoHisobUser.findMany({
    where, select: { id: true, fullName: true }, orderBy: { fullName: 'asc' },
  })
}

/**
 * GET /plans?date=YYYY-MM-DD — supervisor/admin: inspektorlar plani + progress
 */
export async function listPlans(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    if (role === 'inspector') { res.status(403).json({ success: false, error: 'Faqat boshliq/admin' }); return }
    const date = (req.query.date as string) || todayStr()

    const inspectors = await inspectorsFor(orgId, role, districtIds)
    const plans = await (prisma as any).ekoHisobPlan.findMany({
      where: { orgId, date: dayBounds(date).start, type: 'new_entity' },
    })
    const planMap = new Map<string, any>(plans.map((p: any) => [p.inspectorId, p]))

    const result = []
    for (const insp of inspectors) {
      const done = await entityProgress(orgId, insp.id, date)
      const plan = planMap.get(insp.id)
      result.push({
        inspectorId: insp.id, fullName: insp.fullName,
        target: plan?.targetCount ?? null, done, note: plan?.note ?? null,
      })
    }
    res.json({ success: true, data: { date, inspectors: result } })
  } catch (err) { next(err) }
}

/**
 * POST /plans — plan berish yoki yangilash (upsert)
 * { inspectorId, date, targetCount, note? }
 */
export async function setPlan(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds, id: userId } = req.ekoUser!
    if (role === 'inspector') { res.status(403).json({ success: false, error: 'Faqat boshliq/admin' }); return }
    const { inspectorId, date, targetCount, note } = req.body
    if (!inspectorId || !date || targetCount == null) {
      res.status(400).json({ success: false, error: 'inspectorId, date, targetCount talab qilinadi' })
      return
    }
    const target = parseInt(String(targetCount))
    if (isNaN(target) || target < 0) {
      res.status(400).json({ success: false, error: 'Maqsad musbat son bo\'lishi kerak' })
      return
    }

    const insp = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: inspectorId }, include: { districts: { select: { districtId: true } } },
    })
    if (!insp || insp.orgId !== orgId || insp.role !== 'inspector') {
      res.status(404).json({ success: false, error: 'Inspektor topilmadi' })
      return
    }
    if (role === 'supervisor' && !insp.districts.some((d: any) => districtIds.includes(d.districtId))) {
      res.status(403).json({ success: false, error: 'Bu inspektor sizning tumaningizda emas' })
      return
    }

    const dateObj = dayBounds(date).start
    const plan = await (prisma as any).ekoHisobPlan.upsert({
      where: { inspectorId_date_type: { inspectorId, date: dateObj, type: 'new_entity' } },
      create: { orgId, inspectorId, assignedById: userId, date: dateObj, targetCount: target, type: 'new_entity', note: note ? String(note).trim() : null },
      update: { targetCount: target, note: note ? String(note).trim() : null, assignedById: userId },
    })
    res.status(201).json({ success: true, data: plan })
  } catch (err) { next(err) }
}

/**
 * DELETE /plans/:id
 */
export async function deletePlan(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role } = req.ekoUser!
    if (role === 'inspector') { res.status(403).json({ success: false, error: 'Faqat boshliq/admin' }); return }
    const { id } = req.params
    const plan = await (prisma as any).ekoHisobPlan.findUnique({ where: { id } })
    if (!plan || plan.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Plan topilmadi' })
      return
    }
    await (prisma as any).ekoHisobPlan.delete({ where: { id } })
    res.json({ success: true, data: null, message: 'Plan o\'chirildi' })
  } catch (err) { next(err) }
}

/**
 * GET /plans/my — inspektor o'z bugungi plani + progress
 */
export async function getMyPlan(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
    const date = todayStr()
    const plan = await (prisma as any).ekoHisobPlan.findUnique({
      where: { inspectorId_date_type: { inspectorId: userId, date: dayBounds(date).start, type: 'new_entity' } },
    })
    const done = await entityProgress(orgId, userId, date)
    res.json({ success: true, data: { date, target: plan?.targetCount ?? null, done, note: plan?.note ?? null } })
  } catch (err) { next(err) }
}
