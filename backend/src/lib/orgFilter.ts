import { prisma } from './prisma'

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
 */
export async function getOrgFilter(user: AuthUser): Promise<BranchFilter> {
  if (user.role === 'super_admin') return { type: 'none' }

  // Global admin: admin without branchId sees everything
  if (user.role === 'admin' && !user.branchId) return { type: 'none' }

  // branch_manager / operator → single branch
  if (['branch_manager', 'operator'].includes(user.role)) {
    if (!user.branchId) return { type: 'none' }
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
