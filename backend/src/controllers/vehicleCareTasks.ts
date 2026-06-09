import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { resolveOrgId } from '../lib/orgFilter'

const SCOPES = ['all', 'branch', 'vehicles']

function cleanWeekdays(raw: any): number[] {
  if (!Array.isArray(raw)) return []
  return [...new Set(raw.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6))].sort()
}

/** GET /vehicle-care-tasks — tashkilotning barcha texnik parvarish vazifalari */
export async function listCareTasks(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) { res.json(successResponse([])); return }
    const tasks = await (prisma as any).vehicleCareTask.findMany({
      where: { organizationId: orgId },
      orderBy: { createdAt: 'desc' },
    })
    res.json(successResponse(tasks))
  } catch (err) { next(err) }
}

/** POST /vehicle-care-tasks — yangi vazifa */
export async function createCareTask(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 400)

    const { name, description, weekdays, scope, branchId, vehicleIds } = req.body
    if (!name || !String(name).trim()) throw new AppError('Vazifa nomi talab qilinadi', 400)
    const days = cleanWeekdays(weekdays)
    if (days.length === 0) throw new AppError('Kamida bitta kun tanlang', 400)
    const sc = SCOPES.includes(scope) ? scope : 'all'

    const task = await (prisma as any).vehicleCareTask.create({
      data: {
        organizationId: orgId,
        name: String(name).trim(),
        description: description ? String(description).trim() : null,
        weekdays: days,
        scope: sc,
        branchId: sc === 'branch' ? (branchId || null) : null,
        vehicleIds: sc === 'vehicles' && Array.isArray(vehicleIds) ? vehicleIds : [],
        createdById: req.user!.id,
      },
    })
    res.status(201).json(successResponse(task, 'Vazifa yaratildi'))
  } catch (err) { next(err) }
}

/** PUT /vehicle-care-tasks/:id — tahrirlash */
export async function updateCareTask(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { id } = req.params
    const existing = await (prisma as any).vehicleCareTask.findUnique({ where: { id } })
    if (!existing || existing.organizationId !== orgId) throw new AppError('Vazifa topilmadi', 404)

    const { name, description, weekdays, scope, branchId, vehicleIds, isActive } = req.body
    const data: any = {}
    if (name !== undefined) data.name = String(name).trim()
    if (description !== undefined) data.description = description ? String(description).trim() : null
    if (weekdays !== undefined) {
      const days = cleanWeekdays(weekdays)
      if (days.length === 0) throw new AppError('Kamida bitta kun tanlang', 400)
      data.weekdays = days
    }
    if (scope !== undefined) {
      const sc = SCOPES.includes(scope) ? scope : 'all'
      data.scope = sc
      data.branchId = sc === 'branch' ? (branchId || null) : null
      data.vehicleIds = sc === 'vehicles' && Array.isArray(vehicleIds) ? vehicleIds : []
    }
    if (isActive !== undefined) data.isActive = Boolean(isActive)

    const task = await (prisma as any).vehicleCareTask.update({ where: { id }, data })
    res.json(successResponse(task, 'Yangilandi'))
  } catch (err) { next(err) }
}

/** DELETE /vehicle-care-tasks/:id */
export async function deleteCareTask(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { id } = req.params
    const existing = await (prisma as any).vehicleCareTask.findUnique({ where: { id } })
    if (!existing || existing.organizationId !== orgId) throw new AppError('Vazifa topilmadi', 404)
    await (prisma as any).vehicleCareTask.delete({ where: { id } })
    res.json(successResponse(null, 'O\'chirildi'))
  } catch (err) { next(err) }
}
