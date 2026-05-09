import { Response, NextFunction } from 'express'
import { prisma } from '../../../lib/prisma'
import { AppError } from '../../../middleware/errorHandler'
import { resolveOrgId } from '../../../lib/orgFilter'
import { AuthRequest } from '../../../types'
import { getScheduleSuggestions } from '../services/thScheduleOptimizer'
import { suggestScheduleFromGps } from '../services/thGpsSuggest'

export async function getHolidays(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const { year } = req.query as any
    const y = parseInt(year) || new Date().getFullYear()

    const from = new Date(`${y}-01-01T00:00:00.000Z`)
    const to = new Date(`${y + 1}-01-01T00:00:00.000Z`)

    const holidays = await (prisma as any).thHoliday.findMany({
      where: { organizationId: orgId ?? '', date: { gte: from, lt: to } },
      orderBy: { date: 'asc' },
    })
    res.json({ success: true, data: holidays })
  } catch (err) { next(err) }
}

export async function createHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { date, name } = req.body
    if (!date) throw new AppError('Sana kiritilishi shart', 400)
    if (!name?.trim()) throw new AppError('Bayram nomi kiritilishi shart', 400)
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const dateOnly = new Date(new Date(date).toISOString().split('T')[0] + 'T00:00:00.000Z')

    const h = await (prisma as any).thHoliday.upsert({
      where: { organizationId_date: { organizationId: orgId, date: dateOnly } },
      create: { organizationId: orgId, date: dateOnly, name: name.trim() },
      update: { name: name.trim() },
    })
    res.status(201).json({ success: true, data: h })
  } catch (err) { next(err) }
}

export async function deleteHoliday(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    const existing = await (prisma as any).thHoliday.findUnique({ where: { id: req.params.id } })
    if (!existing) throw new AppError('Bayram topilmadi', 404)
    if (orgId && existing.organizationId !== orgId) throw new AppError('Ruxsat yo\'q', 403)
    await (prisma as any).thHoliday.delete({ where: { id: req.params.id } })
    res.json({ success: true, data: null })
  } catch (err) { next(err) }
}

export async function getScheduleSuggestionsHandler(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!)
    if (!orgId) throw new AppError('Tashkilot aniqlanmadi', 403)

    const useGps = req.query.gps !== 'false'  // default: GPS dan foydalanish

    if (useGps) {
      const result = await suggestScheduleFromGps(orgId)
      return res.json({ success: true, data: result.suggestions, meta: {
        source: result.source,
        analyzedDays: result.analyzedDays,
        vehiclesWithData: result.vehiclesWithData,
        mfysDetected: result.mfysDetected,
      }})
    }

    const suggestions = await getScheduleSuggestions(orgId)
    res.json({ success: true, data: suggestions, meta: { source: 'fallback' } })
  } catch (err) { next(err) }
}
