import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react'

const PAGE_SIZE_OPTIONS = [10, 20, 50, 100]

interface Props {
  page: number
  totalPages: number
  onPageChange: (p: number) => void
  total: number
  limit: number
  onLimitChange?: (l: number) => void
}

export default function Pagination({ page, totalPages, onPageChange, total, limit, onLimitChange }: Props) {
  const from = total === 0 ? 0 : (page - 1) * limit + 1
  const to = Math.min(page * limit, total)

  // Page number buttons
  const pages: number[] = []
  const delta = 2
  const left = Math.max(1, page - delta)
  const right = Math.min(totalPages, page + delta)
  for (let i = left; i <= right; i++) pages.push(i)
  if (pages[0] > 1) { if (pages[0] > 2) pages.unshift(-1); pages.unshift(1) }
  if (pages[pages.length - 1] < totalPages) {
    if (pages[pages.length - 1] < totalPages - 1) pages.push(-2)
    pages.push(totalPages)
  }

  return (
    <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex-wrap gap-2">
      {/* Left: total info */}
      <p className="text-sm text-gray-500 dark:text-gray-400">
        {from}–{to} / <span className="font-medium text-gray-700 dark:text-gray-300">{total}</span> ta
      </p>

      {/* Center: page buttons */}
      <div className="flex items-center gap-1">
        <button onClick={() => onPageChange(1)} disabled={page <= 1}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors" title="Birinchi sahifa">
          <ChevronsLeft className="w-4 h-4 text-gray-500" />
        </button>
        <button onClick={() => onPageChange(page - 1)} disabled={page <= 1}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>

        {pages.map((p, i) =>
          p < 0 ? (
            <span key={`dots-${i}`} className="w-8 text-center text-gray-400 text-sm">…</span>
          ) : (
            <button key={p} onClick={() => onPageChange(p)}
              className={`w-8 h-8 rounded-lg text-sm font-medium transition-colors
                ${p === page
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'}`}>
              {p}
            </button>
          )
        )}

        <button onClick={() => onPageChange(page + 1)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
        <button onClick={() => onPageChange(totalPages)} disabled={page >= totalPages}
          className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-30 transition-colors" title="Oxirgi sahifa">
          <ChevronsRight className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Right: limit selector */}
      {onLimitChange && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-gray-500 dark:text-gray-400 hidden sm:inline">Ko'rsatish:</span>
          <div className="flex items-center gap-1">
            {PAGE_SIZE_OPTIONS.map(opt => (
              <button key={opt} onClick={() => { onLimitChange(opt); onPageChange(1) }}
                className={`px-2.5 py-1 rounded-lg text-sm font-medium transition-colors
                  ${limit === opt
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600'}`}>
                {opt}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
