interface PagerProps {
  page: number
  totalPages: number
  total: number
  onChange: (page: number) => void
}

export default function Pager({ page, totalPages, total, onChange }: PagerProps) {
  if (totalPages <= 1) return null
  return (
    <div className="flex items-center justify-between mt-4 text-sm">
      <span className="text-gray-400">Jami: {total.toLocaleString()}</span>
      <div className="flex items-center gap-2">
        <button
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Oldingi
        </button>
        <span className="text-gray-500 savdo-num">{page} / {totalPages}</span>
        <button
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
          className="px-3 py-1.5 rounded-lg border border-gray-300 text-gray-600 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-gray-50 transition-colors"
        >
          Keyingi
        </button>
      </div>
    </div>
  )
}
