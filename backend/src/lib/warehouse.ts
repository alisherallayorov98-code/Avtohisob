import { prisma } from './prisma'

/**
 * Returns the warehouse ID for a given branch.
 * Branch has a direct warehouseId FK to the Warehouse table.
 * Returns null if branchId is null/undefined or branch has no warehouse assigned.
 */
export async function getEffectiveWarehouseId(
  branchId: string | null | undefined
): Promise<string | null> {
  if (!branchId) return null
  const branch = await prisma.branch.findUnique({
    where: { id: branchId },
    select: { warehouseId: true },
  })
  return branch?.warehouseId ?? null
}
