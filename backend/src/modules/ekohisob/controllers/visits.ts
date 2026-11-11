import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { EkoRequest } from '../middleware/ekoAuth'
import { entityScopeWhere, canAccessEntity } from '../lib/ekoScope'
import { logEkoAudit } from '../lib/ekoAudit'
import { parsePageParams } from '../lib/ekoValidate'
import { parseVisitInput, findBrokenPromises } from '../lib/visitMath'
import { todayUz, parseDateOnly } from '../lib/uzt'

const VISIT_SELECT = {
  id: true, entityId: true, userId: true, kind: true, reason: true,
  promisedDate: true, photoFileId: true, lat: true, lon: true, createdAt: true,
} as const

/** Xodim ismlarini biriktiradi (FK yo'q — topilmasa null). */
async function attachUserNames<T extends { userId: string }>(rows: T[]): Promise<(T & { userName: string | null })[]> {
  const ids = Array.from(new Set(rows.map(r => r.userId)))
  if (ids.length === 0) return rows.map(r => ({ ...r, userName: null }))
  const users = await (prisma as any).ekoHisobUser.findMany({
    where: { id: { in: ids } }, select: { id: true, fullName: true },
  }).catch(() => [] as any[])
  const by = new Map<string, string>(users.map((u: any) => [u.id, u.fullName]))
  return rows.map(r => ({ ...r, userName: by.get(r.userId) ?? null }))
}

/**
 * POST /visits { entityId, kind: not_paid|promised|visited, reason?, promisedDate?, lat?, lon?, photoFileId? }
 * Inspektor tashrif natijasini qayd etadi. Yozish: admin va inspektor (boshliq yozmaydi).
 */
export async function createVisit(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const entityId = req.body?.entityId
    if (!entityId || typeof entityId !== 'string') {
      res.status(400).json({ success: false, error: 'entityId talab qilinadi' })
      return
    }
    const parsed = parseVisitInput(req.body)
    if (!parsed.ok) { res.status(400).json({ success: false, error: parsed.error }); return }

    const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
      where: { id: entityId },
      select: { id: true, name: true, orgId: true, districtId: true },
    })
    if (!entity || entity.orgId !== user.orgId) {
      res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
      return
    }
    if (!canAccessEntity(user, entity)) {
      res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
      return
    }

    const v = parsed.value
    const visit = await (prisma as any).ekoHisobVisit.create({
      data: {
        orgId: user.orgId, entityId, userId: user.id, kind: v.kind, reason: v.reason,
        promisedDate: v.promisedDate, lat: v.lat, lon: v.lon, photoFileId: v.photoFileId,
      },
      select: VISIT_SELECT,
    })
    await logEkoAudit(user, {
      action: 'visit.create', targetType: 'visit', targetId: visit.id, targetName: entity.name,
      details: { entityId, kind: v.kind, reason: v.reason, promisedDate: req.body?.promisedDate ?? null },
    })
    res.status(201).json({ success: true, data: visit })
  } catch (err) { next(err) }
}

/**
 * GET /visits?entityId=...&page=&limit=
 * Tuman doirasi bilan: entityId berilsa — o'sha tashkilot (kirish tekshiriladi);
 * berilmasa — foydalanuvchi ko'ra oladigan tashkilotlar tashriflari.
 */
export async function listVisits(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const { page, limit, skip } = parsePageParams(req.query.page, req.query.limit, { defaultLimit: 30, maxLimit: 100 })
    const entityId = req.query.entityId ? String(req.query.entityId) : null

    const where: any = { orgId: user.orgId }
    if (entityId) {
      const entity = await (prisma as any).ekoHisobLegalEntity.findUnique({
        where: { id: entityId }, select: { id: true, orgId: true, districtId: true },
      })
      if (!entity || entity.orgId !== user.orgId) {
        res.status(404).json({ success: false, error: 'Tashkilot topilmadi' })
        return
      }
      if (!canAccessEntity(user, entity)) {
        res.status(403).json({ success: false, error: 'Ushbu tumanga kirish taqiqlangan' })
        return
      }
      where.entityId = entityId
    } else {
      const rows = await (prisma as any).ekoHisobLegalEntity.findMany({
        where: entityScopeWhere(user), select: { id: true }, take: 20000,
      })
      where.entityId = { in: rows.map((r: any) => r.id) }
    }

    const [total, rows] = await Promise.all([
      (prisma as any).ekoHisobVisit.count({ where }),
      (prisma as any).ekoHisobVisit.findMany({
        where, orderBy: { createdAt: 'desc' }, skip, take: limit, select: VISIT_SELECT,
      }),
    ])
    res.json({ success: true, data: await attachUserNames(rows), meta: { total, page, limit } })
  } catch (err) { next(err) }
}

/**
 * GET /visits/promises — va'da sanasi BUGUN yoki O'TGAN, lekin to'lov yozilmagan tashkilotlar
 * (har tashkilot bo'yicha eng oxirgi va'da; 60 kundan eskilari hisobga olinmaydi).
 * Mezon: va'da berilgandan KEYIN shu tashkilotga to'lov yozilmagan.
 */
export async function listBrokenPromises(req: EkoRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const user = req.ekoUser!
    const today = todayUz()
    const todayDate = parseDateOnly(today)!
    const since = new Date(todayDate.getTime() - 60 * 86400000)

    const entities = await (prisma as any).ekoHisobLegalEntity.findMany({
      where: { ...entityScopeWhere(user), status: { not: 'deleted' } },
      select: { id: true, name: true, phone: true, address: true, districtId: true },
      take: 20000,
    })
    const byId = new Map<string, any>(entities.map((e: any) => [e.id, e]))
    if (byId.size === 0) { res.json({ success: true, data: [], meta: { total: 0, today } }); return }

    const visits = await (prisma as any).ekoHisobVisit.findMany({
      where: {
        orgId: user.orgId, kind: 'promised', entityId: { in: [...byId.keys()] },
        promisedDate: { gte: since, lte: todayDate },
      },
      select: { id: true, entityId: true, promisedDate: true, createdAt: true, userId: true, reason: true },
      orderBy: { createdAt: 'desc' },
      take: 5000,
    })
    if (visits.length === 0) { res.json({ success: true, data: [], meta: { total: 0, today } }); return }

    const minCreated = new Date(Math.min(...visits.map((v: any) => v.createdAt.getTime())))
    const payments = await (prisma as any).ekoHisobPayment.findMany({
      where: { entityId: { in: [...new Set<string>(visits.map((v: any) => v.entityId))] }, paidAt: { gte: minCreated } },
      select: { entityId: true, paidAt: true },
    })

    const broken = findBrokenPromises(
      visits.map((v: any) => ({
        id: v.id, entityId: v.entityId, createdAt: v.createdAt,
        promisedDate: v.promisedDate.toISOString().slice(0, 10),
      })),
      payments,
      today,
    )
    const meta = new Map<string, any>(visits.map((v: any) => [v.id, v]))
    const data = broken.map(b => ({
      ...b,
      entity: byId.get(b.entityId),
      reason: meta.get(b.visitId)?.reason ?? null,
      userId: meta.get(b.visitId)?.userId ?? null,
    }))
    res.json({ success: true, data, meta: { total: data.length, today } })
  } catch (err) { next(err) }
}
