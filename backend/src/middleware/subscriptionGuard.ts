import { Response, NextFunction } from 'express'
import { prisma } from '../lib/prisma'
import { AuthRequest } from '../types'
import { AppError } from './errorHandler'
import { getOrgFilter, applyBranchFilter, BranchFilter } from '../lib/orgFilter'

// ─── Feature keys per plan type ──────────────────────────────────────────────
// These are machine-readable keys used by requireFeature() middleware.
// free         = no premium features
// starter      (Boshlang'ich, 200k) = excel, ai (cheklangan), fuel
// professional (Biznes, 500k)       = + anomaly, health, predictions, api  ← HAMMASI
// enterprise   (Korporativ, 1M)     = + tozahudud_module + cheksiz scale

const PLAN_FEATURE_MAP: Record<string, string[]> = {
  free:         [],
  starter:      ['excel_export', 'ai_analysis', 'fuel_analytics'],
  professional: ['excel_export', 'ai_analysis', 'fuel_analytics',
                 'anomaly_detection', 'health_monitoring', 'maintenance_predictions',
                 'api_access'],
  enterprise:   ['excel_export', 'ai_analysis', 'fuel_analytics',
                 'anomaly_detection', 'health_monitoring', 'maintenance_predictions',
                 'api_access', 'tozahudud_module'],
}

const FEATURE_DISPLAY: Record<string, { name: string; minPlan: string }> = {
  excel_export:            { name: 'Excel eksport',                 minPlan: "Boshlang'ich" },
  ai_analysis:             { name: 'AI kalonka tahlili (OCR)',       minPlan: "Boshlang'ich" },
  fuel_analytics:          { name: "Yoqilg'i analitikasi",          minPlan: "Boshlang'ich" },
  anomaly_detection:       { name: 'Anomaliya aniqlash',            minPlan: 'Biznes'       },
  health_monitoring:       { name: 'Texnika holati monitoringi',    minPlan: 'Biznes'       },
  maintenance_predictions: { name: "Ta'mirlash bashorati",          minPlan: 'Biznes'       },
  api_access:              { name: 'API integratsiya',              minPlan: 'Biznes'       },
  tozahudud_module:        { name: 'Toza-Hudud moduli',             minPlan: 'Korporativ'   },
}

// ─── Default limits for free tier (no subscription) ──────────────────────────
const FREE_LIMITS = { maxVehicles: 3, maxBranches: 1, maxUsers: 2 }

// ─── Helper: find admin subscription ─────────────────────────────────────────
// For admin role: use own subscription.
// For sub-users (manager, branch_manager, operator): find this org's admin.
// super_admin: unlimited — returns null (skip all checks).
async function getAdminSubscription(userId: string, role: string, userBranchId?: string | null) {
  if (role === 'super_admin') return null

  if (role !== 'admin') {
    if (!userBranchId) return null

    // Step 1: Filial o'z planiga ega — uni to'g'ridan-to'g'ri ishlatamiz.
    // Bu super_admin yoki admin tomonidan filialga belgilangan tarif (Enterprise va h.k.).
    // Filial o'z tariga ega bo'lsa, admin'ning subscription holatidan qat'iy nazar
    // shu tarif bo'yicha funksiyalar mavjud bo'ladi.
    const branchData = await (prisma.branch as any).findUnique({
      where: { id: userBranchId },
      select: {
        organizationId: true,
        planId: true,
        plan: {
          select: { id: true, type: true, name: true, maxVehicles: true, maxBranches: true, maxUsers: true, features: true },
        },
      },
    })

    if (branchData?.planId && branchData?.plan) {
      // Branch o'z planiga ega — sintetik subscription qaytaramiz
      return { plan: branchData.plan, status: 'active' } as any
    }

    // Step 2: Filial o'z planiga ega emas — admin'ning obunasini meros olamiz
    const orgId = branchData?.organizationId ?? userBranchId
    const admin = await prisma.user.findFirst({
      where: {
        role: 'admin',
        isActive: true,
        OR: [
          { branchId: orgId },
          { branch: { organizationId: orgId } },
        ],
      },
      orderBy: { createdAt: 'asc' },
    })
    if (!admin) return null

    const now = new Date()
    return (prisma as any).subscription.findFirst({
      where: {
        userId: admin.id,
        OR: [
          { status: 'active' },
          { status: 'trialing', currentPeriodEnd: { gt: now } },
        ],
      },
      orderBy: { createdAt: 'desc' },
      include: { plan: true },
    })
  }

  // Admin: use own subscription
  const now = new Date()
  return (prisma as any).subscription.findFirst({
    where: {
      userId,
      OR: [
        { status: 'active' },
        { status: 'trialing', currentPeriodEnd: { gt: now } },
      ],
    },
    orderBy: { createdAt: 'desc' },
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
