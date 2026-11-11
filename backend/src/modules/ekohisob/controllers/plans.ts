import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { todayUz, parseDateOnly, dayBoundsUz } from '../lib/uzt'
import { checkPlanChange } from '../lib/planMath'
import { logEkoAudit, EkoAuditAction } from '../lib/ekoAudit'

/** Plan amallari uchun audit (ekoAudit.ts turlar ro'yxatida 'plan.*' hali yo'q — satr sifatida yoziladi). */
function auditPlan(req: EkoRequest, action: 'plan.set' | 'plan.delete', targetId: string | null, name: string | null, details: Record<string, unknown>) {
  return logEkoAudit(req.ekoUser, {
    action: action as unknown as EkoAuditAction,
    targetType: 'kpi',
    targetId, targetName: name, details,
  })
}

const isoDay = (d: Date) => d.toISOString().slice(0, 10) // @db.Date — UTC yarim tun = kalendar kun

// O'sha kun (UZT) inspektor kiritgan tashkilotlar soni (plan progressi)
export async function entityProgress(orgId: string, inspectorId: string, dateStr: string): Promise<number> {
  const b = dayBoundsUz(dateStr)
  if (!b) return 0
  return (prisma as any).ekoHisobLegalEntity.count({
    where: { orgId, createdBy: inspectorId, createdAt: { gte: b.start, lt: b.end } },
  })
}

/** Bir nechta inspektor uchun bitta so'rov bilan progress (N+1 emas). */
export async function entityProgressBatch(
  orgId: string, inspectorIds: string[], dateStr: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>(inspectorIds.map(id => [id, 0]))
  const b = dayBoundsUz(dateStr)
  if (!b || inspectorIds.length === 0) return out
  const rows = await (prisma as any).ekoHisobLegalEntity.groupBy({
    by: ['createdBy'],
    where: { orgId, createdBy: { in: inspectorIds }, createdAt: { gte: b.start, lt: b.end } },
    _count: { _all: true },
  })
  for (const r of rows) out.set(r.createdBy, r._count._all)
  return out
}

// Supervisor — o'z tumani inspektorlari; admin — barcha inspektorlar
async function inspectorsFor(orgId: string, role: string, districtIds: string[]) {
  const where: any = { orgId, role: 'inspector', isActive: true }
  if (role !== 'admin') where.districts = { some: { districtId: { in: districtIds } } }
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
    const date = (req.query.date as string) || todayUz()
    const dateObj = parseDateOnly(date)
    if (!dateObj) { res.status(400).json({ success: false, error: "Sana noto'g'ri (YYYY-MM-DD)" }); return }

    const inspectors = await inspectorsFor(orgId, role, districtIds)
    const plans = await (prisma as any).ekoHisobPlan.findMany({
      where: { orgId, date: dateObj, type: 'new_entity', inspectorId: { in: inspectors.map((i: any) => i.id) } },
    })
    const planMap = new Map<string, any>(plans.map((p: any) => [p.inspectorId, p]))
    const progress = await entityProgressBatch(orgId, inspectors.map((i: any) => i.id), date)

    const result = inspectors.map((insp: any) => {
      const plan = planMap.get(insp.id)
      return {
        inspectorId: insp.id, fullName: insp.fullName,
        target: plan?.targetCount ?? null, done: progress.get(insp.id) ?? 0, note: plan?.note ?? null,
        planId: plan?.id ?? null, // qo'shimcha: o'chirish uchun
      }
    })
    res.json({ success: true, data: { date, inspectors: result } })
  } catch (err) { next(err) }
}

/**
 * POST /plans — plan berish yoki yangilash (upsert)
 * { inspectorId, date, targetCount, note?, reason? }  (reason — faqat o'tgan sana uchun, admin)
 */
export async function setPlan(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds, id: userId } = req.ekoUser!
    if (role === 'inspector') { res.status(403).json({ success: false, error: 'Faqat boshliq/admin' }); return }
    const { inspectorId, date, targetCount, note, reason } = req.body ?? {}
    if (!inspectorId || !date || targetCount == null) {
      res.status(400).json({ success: false, error: 'inspectorId, date, targetCount talab qilinadi' })
      return
    }
    const dateObj = parseDateOnly(date)
    if (!dateObj) { res.status(400).json({ success: false, error: "Sana noto'g'ri (YYYY-MM-DD)" }); return }

    const target = Number(targetCount)
    if (!Number.isInteger(target) || target < 0 || target > 10_000) {
      res.status(400).json({ success: false, error: "Maqsad 0 dan 10 000 gacha butun son bo'lishi kerak" })
      return
    }

    const change = checkPlanChange({ date: String(date), today: todayUz(), role, reason })
    if (!change.ok) { res.status(change.status).json({ success: false, error: change.error }); return }

    const insp = await (prisma as any).ekoHisobUser.findUnique({
      where: { id: String(inspectorId) }, include: { districts: { select: { districtId: true } } },
    })
    if (!insp || insp.orgId !== orgId || insp.role !== 'inspector') {
      res.status(404).json({ success: false, error: 'Inspektor topilmadi' })
      return
    }
    if (role !== 'admin' && !insp.districts.some((d: any) => districtIds.includes(d.districtId))) {
      res.status(403).json({ success: false, error: 'Bu inspektor sizning tumaningizda emas' })
      return
    }

    const noteText = note ? String(note).trim().slice(0, 300) : null
    const before = await (prisma as any).ekoHisobPlan.findUnique({
      where: { inspectorId_date_type: { inspectorId: insp.id, date: dateObj, type: 'new_entity' } },
    })
    const plan = await (prisma as any).ekoHisobPlan.upsert({
      where: { inspectorId_date_type: { inspectorId: insp.id, date: dateObj, type: 'new_entity' } },
      create: { orgId, inspectorId: insp.id, assignedById: userId, date: dateObj, targetCount: target, type: 'new_entity', note: noteText },
      update: { targetCount: target, note: noteText, assignedById: userId },
    })
    await auditPlan(req, 'plan.set', plan.id, insp.fullName, {
      date, inspectorId: insp.id,
      before: before ? { targetCount: before.targetCount, note: before.note } : null,
      after: { targetCount: target, note: noteText },
      ...(change.past ? { pastDate: true, reason: String(reason).trim().slice(0, 300) } : {}),
    })
    res.status(201).json({ success: true, data: plan })
  } catch (err) { next(err) }
}

/**
 * DELETE /plans/:id   (o'tgan sana: admin + body/query `reason`)
 */
export async function deletePlan(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, role, districtIds } = req.ekoUser!
    if (role === 'inspector') { res.status(403).json({ success: false, error: 'Faqat boshliq/admin' }); return }
    const { id } = req.params
    const plan = await (prisma as any).ekoHisobPlan.findUnique({
      where: { id },
      include: { inspector: { select: { fullName: true, districts: { select: { districtId: true } } } } },
    })
    if (!plan || plan.orgId !== orgId) {
      res.status(404).json({ success: false, error: 'Plan topilmadi' })
      return
    }
    // Boshliq faqat o'z tumani inspektorining planini o'chira oladi
    if (role !== 'admin' && !plan.inspector.districts.some((d: any) => districtIds.includes(d.districtId))) {
      res.status(403).json({ success: false, error: 'Bu inspektor sizning tumaningizda emas' })
      return
    }
    const reason = req.body?.reason ?? req.query.reason
    const dateStr = isoDay(plan.date)
    const change = checkPlanChange({ date: dateStr, today: todayUz(), role, reason })
    if (!change.ok) { res.status(change.status).json({ success: false, error: change.error }); return }

    await (prisma as any).ekoHisobPlan.delete({ where: { id } })
    await auditPlan(req, 'plan.delete', id, plan.inspector.fullName, {
      date: dateStr, inspectorId: plan.inspectorId, targetCount: plan.targetCount, note: plan.note,
      ...(change.past ? { pastDate: true, reason: String(reason).trim().slice(0, 300) } : {}),
    })
    res.json({ success: true, data: null, message: 'Plan o\'chirildi' })
  } catch (err) { next(err) }
}

/**
 * GET /plans/my — inspektor o'z bugungi plani + progress
 */
export async function getMyPlan(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { orgId, id: userId } = req.ekoUser!
    const date = todayUz()
    const plan = await (prisma as any).ekoHisobPlan.findUnique({
      where: { inspectorId_date_type: { inspectorId: userId, date: parseDateOnly(date)!, type: 'new_entity' } },
    })
    const done = await entityProgress(orgId, userId, date)
    res.json({ success: true, data: { date, target: plan?.targetCount ?? null, done, note: plan?.note ?? null } })
  } catch (err) { next(err) }
}
