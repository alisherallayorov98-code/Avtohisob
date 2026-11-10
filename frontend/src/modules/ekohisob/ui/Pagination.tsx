import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from './Button'
import { cx } from './cx'
import { num } from './format'

export interface PaginationProps {
  /** Joriy sahifa, 1 dan boshlanadi */
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  className?: string
}

/**
 * Sahifalash: "1–20 / 1 284" + Oldingi / Keyingi. Tugmalar mobilda 44px.
 * Bitta sahifaga sig'sa ham diapazon matni ko'rinadi (jami son foydali).
 */
export function Pagination({ page, pageSize, total, onPageChange, className }: PaginationProps) {
  if (total <= 0) return null
  const pages = Math.max(1, Math.ceil(total / pageSize))
  const from = (page - 1) * pageSize + 1
  const to = Math.min(total, page * pageSize)
  return (
    <nav aria-label="Sahifalash" className={cx('flex items-center justify-between gap-3', className)}>
      <p className="eko-text-sm text-eko-muted eko-num" aria-live="polite">
        {num(from)}–{num(to)} / {num(total)}
      </p>
      {pages > 1 && (
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            icon={<ChevronLeft className="w-4 h-4" aria-hidden />}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Oldingi
          </Button>
          <Button size="sm" disabled={page >= pages} onClick={() => onPageChange(page + 1)}>
            Keyingi
            <ChevronRight className="w-4 h-4" aria-hidden />
          </Button>
        </div>
      )}
    </nav>
  )
}
