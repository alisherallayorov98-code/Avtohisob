import { PrismaClient } from '@prisma/client'
import { getOrgContextFilter } from './orgContext'
import { applyBranchFilter, isBranchAllowed, BranchFilter } from './orgFilter'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

/** Merge two Prisma where clauses safely using AND */
function mergeWhere(existing: any, extra: any): any {
  if (!existing) return extra
  return { AND: [existing, extra] }
}

/** Operations that return lists — these get auto-filtered */
const LIST_OPS = new Set(['findMany', 'findFirst', 'count', 'aggregate', 'groupBy'])

/**
 * Yozuvning tegishli vehicle.branchId qiymatini topadi.
 * - Agar yozuvda allaqachon `vehicle.branchId` bor (include qilingan) — undan oladi
 * - Aks holda DB'dan vehicleId orqali olib keladi
 * Qaytaradi: branchId | null (mavjud emas) | undefined (vehicle topilmadi/error)
 */
async function resolveVehicleBranchId(
  client: PrismaClient,
  _model: string,
  record: any,
): Promise<string | null | undefined> {
  if (record?.vehicle?.branchId) return record.vehicle.branchId as string
  const vehicleId: string | null | undefined = record?.vehicleId
  if (!vehicleId) return null
  try {
    const v = await client.vehicle.findUnique({
      where: { id: vehicleId },
      select: { branchId: true },
    })
    return v?.branchId ?? undefined
  } catch {
    return undefined
  }
}

/** Inventory.warehouseId chaqiruvchining org doirasidami? */
async function isWarehouseAllowedForFilter(
  client: PrismaClient,
  filter: BranchFilter,
  warehouseId: string,
): Promise<boolean> {
  if (filter.type === 'none') return true
  const branchIds = filter.type === 'single' ? [filter.branchId] : filter.orgBranchIds
  if (branchIds.length === 0) return false
  const branches = await (client.branch as any).findMany({
    where: { id: { in: branchIds }, warehouseId },
    select: { id: true },
  })
  return branches.length > 0
}

/** Filter'dan organizationId ni topadi (faqat findUnique post-check uchun). */
async function resolveCallerOrgIdFromFilter(
  client: PrismaClient,
  filter: BranchFilter,
): Promise<string | null> {
  if (filter.type === 'none') return null
  const someBranchId = filter.type === 'single' ? filter.branchId : filter.orgBranchIds[0]
  if (!someBranchId) return null
  const b = await (client.branch as any).findUnique({
    where: { id: someBranchId },
    select: { organizationId: true },
  })
  return b?.organizationId ?? someBranchId
}

function buildPrisma(): PrismaClient {
  const client = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
  })

  /**
   * Row-Level Security via Prisma middleware.
   *
   * Every findMany / findFirst / count / aggregate / groupBy on
   * the listed models automatically gains a branchId (or vehicle.branchId)
   * filter matching the current user's organisation.
   *
   * The filter is set once per request inside authenticate() middleware
   * and stored in AsyncLocalStorage — zero extra DB queries.
   *
   * findUnique is handled via a post-query access check so callers
   * that fetch by id still get a 404-style null when accessing
   * records outside their org.
   */
  client.$use(async (params, next) => {
    const filter = getOrgContextFilter()

    // No active request context or super_admin / global admin — pass through
    if (!filter || filter.type === 'none') return next(params)

    const bv = applyBranchFilter(filter) // string | { in: string[] }

    // ── Models with a direct branchId column ─────────────────────────────
    if (['Vehicle', 'User', 'Waybill', 'Tire'].includes(params.model ?? '')) {
      if (LIST_OPS.has(params.action)) {
        params.args = params.args ?? {}
        params.args.where = mergeWhere(params.args.where, { branchId: bv })
        return next(params)
      }

      // findUnique: execute then verify ownership (can't add WHERE to findUnique)
      if (params.action === 'findUnique') {
        const result = await next(params)
        if (!result) return null
        const bid: string | null = result.branchId ?? null
        if (bid && !isBranchAllowed(filter, bid)) return null
        return result
      }
    }

    // ── Models filtered via their vehicle's branch ────────────────────────
    if (['FuelRecord', 'MaintenanceRecord', 'Expense', 'ServiceInterval'].includes(params.model ?? '')) {
      if (LIST_OPS.has(params.action)) {
        params.args = params.args ?? {}
        params.args.where = mergeWhere(params.args.where, { vehicle: { branchId: bv } })
        return next(params)
      }

      // findUnique: avval natijani olamiz, so'ng vehicle.branchId ni tekshiramiz.
      // findUnique ga WHERE qo'shib bo'lmaydi (Prisma cheklovi), shuning uchun post-check.
      // Defense-in-depth: kontrollerlar allaqachon manual tekshirishadi, lekin bitta
      // unutish IDOR'ga olib keladi — middleware'da ham mahkamlaymiz.
      if (params.action === 'findUnique') {
        const result = await next(params)
        if (!result) return null
        const vehicleBranchId = await resolveVehicleBranchId(client, params.model!, result)
        // null = legacy (vehicleId yo'q) yoki global yozuv — o'tkazamiz
        if (vehicleBranchId === null) return result
        // undefined = ichki vehicle.findUnique cross-org tufayli null qaytardi yoki xato
        // → fail-closed (deny)
        if (vehicleBranchId === undefined) return null
        if (!isBranchAllowed(filter, vehicleBranchId)) return null
        return result
      }
    }

    // ── Warranty: vehicle may be null (standalone tire warranties) ────────
    if (params.model === 'Warranty' && LIST_OPS.has(params.action)) {
      params.args = params.args ?? {}
      params.args.where = mergeWhere(params.args.where, {
        OR: [{ vehicleId: null }, { vehicle: { branchId: bv } }],
      })
      return next(params)
    }

    // ── Inventory / SparePart: warehouse/orgId orqali filtr ───────────────
    // findUnique uchun post-check (cross-org IDOR himoyasi).
    if (params.model === 'Inventory' && params.action === 'findUnique') {
      const result = await next(params)
      if (!result) return null
      const warehouseId = (result as any).warehouseId
      if (!warehouseId) return result
      const allowed = await isWarehouseAllowedForFilter(client, filter, warehouseId)
      return allowed ? result : null
    }

    if (params.model === 'SparePart' && params.action === 'findUnique') {
      const result = await next(params)
      if (!result) return null
      const orgId = (result as any).organizationId
      if (!orgId) return result // legacy/global yozuvlar
      const callerOrgId = await resolveCallerOrgIdFromFilter(client, filter)
      // Fail-closed: callerOrgId aniqlab bo'lmasa (admin branchId yo'q va h.k.) ruxsat bermaymiz
      if (callerOrgId === null) return null
      return callerOrgId === orgId ? result : null
    }

    return next(params)
  })

  return client
}

export const prisma = globalForPrisma.prisma ?? buildPrisma()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
