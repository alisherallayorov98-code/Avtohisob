import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { AppError } from './errorHandler'
import { getOrgFilter, applyBranchFilter, BranchFilter } from '../lib/orgFilter'

// ─── Feature keys per plan type ──────────────────────────────────────────────
// These are machine-readable keys used by requireFeature() middleware.
// free = no premium features
// starter+ = excel, ai, fuel analytics
// professional+ = + anomaly, health, predictions
// enterprise+ = + api_access

const PLAN_FEATURE_MAP: Record<string, string[]> = {
  free:         [],
  starter:      ['excel_export', 'ai_analysis', 'fuel_analytics'],
  professional: ['excel_export', 'ai_analysis', 'fuel_analytics',
                 'anomaly_detection', 'health_monitoring', 'maintenance_predictions'],
  enterprise:   ['excel_export', 'ai_analysis', 'fuel_analytics',
                 'anomaly_detection', 'health_monitoring', 'maintenance_predictions',
                 'api_access'],
}

const FEATURE_DISPLAY: Record<string, { name: string; minPlan: string }> = {
  excel_export:            { name: 'Excel eksport',                 minPlan: 'Starter'      },
  ai_analysis:             { name: 'AI kalonka tahlili (OCR)',       minPlan: 'Starter'      },
  fuel_analytics:          { name: "Yoqilg'i analitikasi",          minPlan: 'Starter'      },
  anomaly_detection:       { name: 'Anomaliya aniqlash',            minPlan: 'Professional' },
  health_monitoring:       { name: 'Texnika holati monitoringi',    minPlan: 'Professional' },
  maintenance_predictions: { name: "Ta'mirlash bashorati",          minPlan: 'Professional' },
  api_access:              { name: 'API integratsiya',              minPlan: 'Enterprise'   },
}

// ─── Default limits for free tier (no subscription) ──────────────────────────
const FREE_LIMITS = { maxVehicles: 5, maxBranches: 1, maxUsers: 3 }

// ─── Helper: find admin subscription ─────────────────────────────────────────
// For admin role: use own subscription.
// For sub-users (manager, branch_manager, operator): find this org's admin.
// super_admin: unlimited — returns null (skip all checks).
async function getAdminSubscription(userId: string, role: string, userBranchId?: string | null) {
  if (role === 'super_admin') return null

  let adminId = userId
  if (role !== 'admin') {
    if (!userBranchId) return null
    // Find the org root branch (organizationId), then the admin for that org
    const userBranch = await (prisma.branch as any).findUnique({
      where: { id: userBranchId },
      select: { organizationId: true },
    })
    const orgId = userBranch?.organizationId ?? userBranchId
    const admin = await prisma.user.findFirst({
      where: { role: 'admin', branchId: orgId, isActive: true },
    })
    if (!admin) return null
    adminId = admin.id
  }

  return (prisma as any).subscription.findFirst({
    where: { userId: adminId, status: 'active' },
    include: { plan: true },
  })
}

// ─── Middleware: enforce resource count limit ─────────────────────────────────
// Usage: router.post('/', checkLimit('vehicles'), createVehicle)
export function checkLimit(resource: 'vehicles' | 'branches' | 'users') {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user!.role === 'super_admin') return next()

      const sub = await getAdminSubscription(req.user!.id, req.user!.role, req.user!.branchId)
      const plan = sub?.plan

      const maxField = resource === 'vehicles' ? 'maxVehicles'
                     : resource === 'branches'  ? 'maxBranches'
                     : 'maxUsers'

      const max = plan ? Number(plan[maxField]) : FREE_LIMITS[maxField]
      if (max === -1) return next() // unlimited (enterprise)

      // Count only within this organization
      const filter: BranchFilter = await getOrgFilter(req.user!)
      const bv = applyBranchFilter(filter)

      let current = 0
      if (resource === 'vehicles') {
        current = bv !== undefined
          ? await prisma.vehicle.count({ where: { branchId: bv } })
          : await prisma.vehicle.count()
      } else if (resource === 'branches') {
        if (filter.type === 'none') {
          current = await prisma.branch.count()
        } else if (filter.type === 'single') {
          current = 1
        } else {
          current = filter.orgBranchIds.length
        }
      } else {
        const userWhere: any = { role: { not: 'super_admin' } }
        if (bv !== undefined) userWhere.branchId = bv
        current = await prisma.user.count({ where: userWhere })
      }

      if (current >= max) {
        const planName = plan?.name || 'Bepul'
        const resourceLabel =
          resource === 'vehicles' ? 'avtomobil' :
          resource === 'branches' ? 'filial' : 'foydalanuvchi'
        throw new AppError(
          `Tarif chegarasi: "${planName}" tarifida maksimum ${max} ta ${resourceLabel} qo'shish mumkin. ` +
          `Hozir: ${current}. Tarifni yangilang.`,
          403
        )
      }

      next()
    } catch (err) { next(err) }
  }
}

// ─── Middleware: enforce feature availability ─────────────────────────────────
// Usage: router.post('/analyze', requireFeature('ai_analysis'), analyzeMeterImage)
export function requireFeature(featureKey: string) {
  return async (req: AuthRequest, res: Response, next: NextFunction) => {
    try {
      if (req.user!.role === 'super_admin') return next()

      const sub = await getAdminSubscription(req.user!.id, req.user!.role, req.user!.branchId)
      const planType = sub?.plan?.type || 'free'

      const allowed = PLAN_FEATURE_MAP[planType] || []

      if (!allowed.includes(featureKey)) {
        const info = FEATURE_DISPLAY[featureKey]
        const currentPlanName = sub?.plan?.name || 'Bepul'
        const msg = info
          ? `"${info.name}" funksiyasi "${currentPlanName}" tarifida mavjud emas. ` +
            `Kamida "${info.minPlan}" tarifiga o'ting.`
          : `Bu funksiya sizning tarifingizda mavjud emas. Tarifni yangilang.`
        throw new AppError(msg, 403)
      }

      next()
    } catch (err) { next(err) }
  }
}
