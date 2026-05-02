import { prisma } from './prisma'
import { getOrgContextFilter } from './orgContext'

interface AuthUser {
  id: string
  role: string
  branchId?: string | null
}

export type BranchFilter =
  | { type: 'none' }
  | { type: 'single'; branchId: string }
  | { type: 'org'; orgBranchIds: string[] }

/**
 * Returns the branch filter scope for the given user.
 * - super_admin / global admin (no branchId) → no filter (sees all)
 * - org admin (admin with branchId) → all branches in their org
 * - branch_manager / operator → only their own branch
 *
 * Fast path: if authenticate middleware already computed the filter for
 * this request via AsyncLocalStorage, returns that cached value instantly
 * (no extra DB round-trip).
 */
export async function getOrgFilter(user: AuthUser): Promise<BranchFilter> {
  // Cache hit: filter already computed once for this request
  const cached = getOrgContextFilter()
  if (cached !== undefined) return cached

  return computeOrgFilter(user)
}

async function computeOrgFilter(user: AuthUser): Promise<BranchFilter> {
  if (user.role === 'super_admin') return { type: 'none' }

  // Admin without branchId: hech qanday tashkilotga biriktirilmagan — hech narsa ko'rinmasin
  if (user.role === 'admin' && !user.branchId) return { type: 'org', orgBranchIds: [] }

  // branch_manager / operator → single branch
  if (['branch_manager', 'operator'].includes(user.role)) {
    // branchId yo'q bo'lsa hech narsa ko'rinmasin (type:'none' = hamma ko'rinadi — xavfli)
    if (!user.branchId) return { type: 'org', orgBranchIds: [] }
    return { type: 'single', branchId: user.branchId }
  }

  // Org admin → all branches in their organization
  if (user.role === 'admin' && user.branchId) {
    const userBranch = await (prisma.branch as any).findUnique({
      where: { id: user.branchId },
      select: { organizationId: true },
    })
    const orgId = userBranch?.organizationId ?? user.branchId
    const orgBranches = await (prisma.branch as any).findMany({
      where: { organizationId: orgId },
      select: { id: true },
    })
    const orgBranchIds = orgBranches.map((b: any) => b.id)
    if (!orgBranchIds.includes(user.branchId)) orgBranchIds.push(user.branchId)
    return { type: 'org', orgBranchIds }
  }

  if (user.branchId) return { type: 'single', branchId: user.branchId }
  return { type: 'none' }
}

/**
 * Converts filter to a Prisma-compatible branchId value:
 * undefined (no filter) | string (single) | { in: string[] } (org)
 */
export function applyBranchFilter(
  filter: BranchFilter
): undefined | string | { in: string[] } {
  if (filter.type === 'none') return undefined
  if (filter.type === 'single') return filter.branchId
  return { in: filter.orgBranchIds }
}

/**
 * Checks whether a given branchId is accessible by the filter.
 */
export function isBranchAllowed(filter: BranchFilter, branchId: string): boolean {
  if (filter.type === 'none') return true
  if (filter.type === 'single') return filter.branchId === branchId
  return filter.orgBranchIds.includes(branchId)
}

/**
 * Like applyBranchFilter, but also respects a user-requested branchId.
 *
 * Use this in controllers that have a ?branchId query param so that:
 * - super_admin: any branch (or all if not specified)
 * - org admin: any branch within their org (or all org branches if not specified)
 * - single-branch user (branch_manager/operator): always their own branch
 */
export function applyNarrowedBranchFilter(
  filter: BranchFilter,
  requestedBranchId: string | undefined,
): undefined | string | { in: string[] } {
  if (filter.type === 'none') return requestedBranchId || undefined
  if (filter.type === 'single') return filter.branchId
  // org type: allow narrowing to a specific branch within the allowed set
  if (requestedBranchId && filter.orgBranchIds.includes(requestedBranchId)) {
    return requestedBranchId
  }
  return { in: filter.orgBranchIds }
}

/**
 * Tashkilot (organization) ID ni foydalanuvchining branch idan topib beradi.
 * - super_admin → null (org bog'liq emas)
 * - branchId yo'q → null
 * - Odatda: branch.organizationId, agar null bo'lsa branchId ni org sifatida ishlatadi
 */
export async function resolveOrgId(user: AuthUser): Promise<string | null> {
  if (user.role === 'super_admin') return null
  if (!user.branchId) return null
  const branch = await (prisma.branch as any).findUnique({
    where: { id: user.branchId },
    select: { organizationId: true },
  })
  return branch?.organizationId ?? user.branchId
}

/**
 * Returns warehouse IDs accessible by the filter.
 * Returns null for 'none' (no restriction).
 * Returns empty array if org has no warehouses.
 *
 * Ikki manbadan birlashtiradi:
 *  1. Warehouse.organizationId = org (Faza C — yangi)
 *  2. Branch.warehouseId orqali biriktirilgan (legacy)
 *
 * Avval faqat (2) qaytardi va shu sababli foydalanuvchi yangi yaratilgan
 * (lekin biror filialga hali ulanmagan) omborni filialga biriktira olmasdi
 * (tovuq-tuxum muammosi).
 */
export async function getOrgWarehouseIds(filter: BranchFilter): Promise<string[] | null> {
  if (filter.type === 'none') return null
  if (filter.type === 'org' && filter.orgBranchIds.length === 0) return null
  const branchIds = filter.type === 'single' ? [filter.branchId] : filter.orgBranchIds
  if (branchIds.length === 0) return []

  // Org id ni har qanday branchdan resolve qilamiz
  const someBranch = await (prisma.branch as any).findUnique({
    where: { id: branchIds[0] },
    select: { organizationId: true },
  })
  const orgId = someBranch?.organizationId ?? branchIds[0]

  const [linkedBranches, ownedWarehouses] = await Promise.all([
    (prisma.branch as any).findMany({
      where: { id: { in: branchIds }, warehouseId: { not: null } },
      select: { warehouseId: true },
    }),
    orgId
      ? (prisma.warehouse as any).findMany({
          where: { organizationId: orgId },
          select: { id: true },
        })
      : Promise.resolve([]),
  ])

  const linkedIds = linkedBranches.map((b: any) => b.warehouseId).filter(Boolean) as string[]
  const ownedIds = ownedWarehouses.map((w: any) => w.id) as string[]
  return [...new Set([...linkedIds, ...ownedIds])]
}
