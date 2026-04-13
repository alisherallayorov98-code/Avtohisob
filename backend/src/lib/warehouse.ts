import { prisma } from './prisma'

/**
 * Returns the "effective warehouse branch ID" for a given branch.
 *
 * Logic:
 *  - If the branch has sharedWarehouseId set → that branch owns the warehouse
 *  - Otherwise the branch owns its own warehouse → return branchId as-is
 *
 * Usage: anywhere we need to look up or deduct inventory.
 *
 * @param branchId  The branch whose warehouse we want to resolve.
 *                  Pass null/undefined for admin users who have no branch.
 */
export async function getEffectiveWarehouseId(
  branchId: string | null | undefined
): Promise<string | null> {
  if (!branchId) return null
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { sharedWarehouseId: true },
  })
  return branch?.sharedWarehouseId ?? branchId
}
