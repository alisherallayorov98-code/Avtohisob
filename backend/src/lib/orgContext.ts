/**
 * Per-request AsyncLocalStorage for org filter.
 * Set once in authenticate middleware — used by getOrgFilter() cache
 * and Prisma $use auto-filter for all models.
 */
import { AsyncLocalStorage } from 'async_hooks'
import { BranchFilter } from './orgFilter'

interface OrgContextStore {
  filter: BranchFilter
}

const storage = new AsyncLocalStorage<OrgContextStore>()

/** Called inside authenticate middleware to bind filter to the async context */
export function runWithOrgContext(filter: BranchFilter, next: () => void): void {
  storage.run({ filter }, next)
}

/** Returns the filter for the current request, or undefined if not in a request context */
export function getOrgContextFilter(): BranchFilter | undefined {
  return storage.getStore()?.filter
}
