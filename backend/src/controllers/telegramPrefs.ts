import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest, successResponse } from '../types'
import { AppError } from '../middleware/errorHandler'

async function resolveOrgId(branchId: string | null | undefined): Promise<string | null> {
  if (!branchId) return null
  const branch = await (prisma.branch as any).findUnique({
    where: { id: branchId },
    select: { organizationId: true },
  })
  return branch?.organizationId ?? branchId
}

async function getOrgBranchIds(orgId: string): Promise<string[]> {
  const branches = await (prisma.branch as any).findMany({
    where: { OR: [{ organizationId: orgId }, { id: orgId }] },
    select: { id: true },
  })
  return branches.map((b: any) => b.id as string)
}

/** GET /api/telegram/admin/prefs — org foydalanuvchilari + ularning prefs */
export async function getOrgPrefs(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const orgId = await resolveOrgId(req.user!.branchId)
    if (!orgId) throw new AppError('Org topilmadi', 404)

    const orgBranchIds = await getOrgBranchIds(orgId)

    const users = await prisma.user.findMany({
      where: {
        isActive: true,
        branchId: { in: orgBranchIds },
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

    const orgId = await resolveOrgId(req.user!.branchId)
    if (!orgId) throw new AppError('Org topilmadi', 404)
    const orgBranchIds = await getOrgBranchIds(orgId)

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
      select: { branchId: true },
    })
    if (!targetUser || !orgBranchIds.includes(targetUser.branchId ?? '')) {
      throw new AppError('Foydalanuvchi topilmadi', 404)
    }

    const {
      insurance, techInspection, oilChange, fuelAnomaly,
      sparePart, maintenance, monthlyInspection, vehicleIds,
    } = req.body

    const data = {
      insurance:         insurance         !== undefined ? Boolean(insurance)         : true,
      techInspection:    techInspection    !== undefined ? Boolean(techInspection)    : true,
      oilChange:         oilChange         !== undefined ? Boolean(oilChange)         : true,
      fuelAnomaly:       fuelAnomaly       !== undefined ? Boolean(fuelAnomaly)       : true,
      sparePart:         sparePart         !== undefined ? Boolean(sparePart)         : true,
      maintenance:       maintenance       !== undefined ? Boolean(maintenance)       : true,
      monthlyInspection: monthlyInspection !== undefined ? Boolean(monthlyInspection) : true,
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
