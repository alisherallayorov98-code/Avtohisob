import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'
import { getOrgFilter, applyBranchFilter } from '../lib/orgFilter'

/** GET /api/telegram/admin/prefs — org foydalanuvchilari + ularning prefs */
export async function getOrgPrefs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        ...(branchFilter !== undefined ? { branchId: branchFilter } : {}),
        role: { in: ['admin', 'branch_manager'] },
      },
      select: {
        id: true,
        fullName: true,
        role: true,
        telegramLinks: { select: { id: true, deviceLabel: true } },
      },
      orderBy: { fullName: 'asc' },
    })

    const userIds = users.map(u => u.id)
    const prefs = await (prisma as any).telegramNotificationPref.findMany({
      where: { userId: { in: userIds } },
    })
    const prefMap = new Map(prefs.map((p: any) => [p.userId, p]))

    const result = users.map(u => ({
      ...u,
      pref: prefMap.get(u.id) ?? null,
    }))

    res.json(successResponse(result))
  } catch (err) { next(err) }
}

/** PUT /api/telegram/admin/prefs/:userId — user prefs yangilash */
export async function upsertUserPref(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const { userId } = req.params

    const filter = await getOrgFilter(req.user!)
    const branchFilter = applyBranchFilter(filter)

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { branchId: true },
    })
    if (!targetUser) throw new AppError('Foydalanuvchi topilmadi', 404)

    // Tenant isolation: branchFilter !== undefined means user is org-scoped
    if (branchFilter !== undefined) {
      const allowedBranchIds = typeof branchFilter === 'string'
        ? [branchFilter]
        : (branchFilter as any).in ?? []
      if (!allowedBranchIds.includes(targetUser.branchId ?? '')) {
        throw new AppError('Foydalanuvchi topilmadi', 404)
      }
    }

    const {
      insurance, techInspection, oilChange, fuelAnomaly,
      sparePart, maintenance, monthlyInspection, vehicleIds, branchIds,
    } = req.body

    const data = {
      insurance:         insurance         !== undefined ? Boolean(insurance)         : true,
      techInspection:    techInspection    !== undefined ? Boolean(techInspection)    : true,
      oilChange:         oilChange         !== undefined ? Boolean(oilChange)         : true,
      fuelAnomaly:       fuelAnomaly       !== undefined ? Boolean(fuelAnomaly)       : true,
      sparePart:         sparePart         !== undefined ? Boolean(sparePart)         : true,
      maintenance:       maintenance       !== undefined ? Boolean(maintenance)       : true,
      monthlyInspection: monthlyInspection !== undefined ? Boolean(monthlyInspection) : true,
      branchIds:         Array.isArray(branchIds) ? branchIds : [],
      vehicleIds:        Array.isArray(vehicleIds) ? vehicleIds : [],
    }

    const pref = await (prisma as any).telegramNotificationPref.upsert({
      where: { userId },
      update: data,
      create: { userId, ...data },
    })

    res.json(successResponse(pref, 'Sozlamalar saqlandi'))
  } catch (err) { next(err) }
}
