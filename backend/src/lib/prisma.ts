import { PrismaClient } from '@prisma/client'
import { getOrgContextFilter } from './orgContext'
import { applyBranchFilter, isBranchAllowed } from './orgFilter'

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
    }

    // ── Warranty: vehicle may be null (standalone tire warranties) ────────
    if (params.model === 'Warranty' && LIST_OPS.has(params.action)) {
      params.args = params.args ?? {}
      params.args.where = mergeWhere(params.args.where, {
        OR: [{ vehicleId: null }, { vehicle: { branchId: bv } }],
      })
      return next(params)
    }

    return next(params)
  })

  return client
}

export const prisma = globalForPrisma.prisma ?? buildPrisma()

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma
