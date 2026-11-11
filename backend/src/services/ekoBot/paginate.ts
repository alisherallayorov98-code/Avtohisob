export interface Page<T> { items: T[]; page: number; pages: number; total: number; hasPrev: boolean; hasNext: boolean }

export function paginate<T>(items: T[], page: number, size: number): Page<T> {
  const sz = Math.max(1, Math.floor(size) || 1)
  const total = items.length
  const pages = Math.max(1, Math.ceil(total / sz))
  const p = Math.min(Math.max(0, Math.floor(Number.isFinite(page) ? page : 0)), pages - 1)
  return { items: items.slice(p * sz, p * sz + sz), page: p, pages, total, hasPrev: p > 0, hasNext: p < pages - 1 }
}
