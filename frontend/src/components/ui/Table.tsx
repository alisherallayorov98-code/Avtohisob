import { cn } from '../../lib/utils'
import { Loader2, Inbox, LucideIcon } from 'lucide-react'
import { ReactNode } from 'react'

interface Column<T> {
  key: keyof T | string
  title: ReactNode
  render?: (row: T) => ReactNode
  className?: string
}

interface Props<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  empty?: string
  emptyIcon?: LucideIcon
  emptyAction?: ReactNode
  className?: string
  numbered?: boolean
  page?: number
  limit?: number
}

export default function Table<T extends { id?: string }>({
  columns, data, loading,
  empty = 'Ma\'lumot topilmadi',
  emptyIcon: EmptyIcon = Inbox,
  emptyAction,
  className,
  numbered,
  page,
  limit,
}: Props<T>) {
  const totalCols = columns.length + (numbered ? 1 : 0)
  const startIndex = numbered && page && limit ? (page - 1) * limit : 0
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
            {numbered && (
              <th className="text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap w-12">#</th>
            )}
            {columns.map(col => (
              <th key={String(col.key)} className={cn('text-left px-4 py-3 font-medium text-gray-600 dark:text-gray-400 whitespace-nowrap', col.className)}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={totalCols} className="py-16 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto" />
            </td></tr>
          ) : data.length === 0 ? (
            <tr><td colSpan={totalCols} className="py-16 text-center">
              <div className="flex flex-col items-center gap-2">
                <div className="w-12 h-12 bg-gray-100 dark:bg-gray-700 rounded-xl flex items-center justify-center">
                  <EmptyIcon className="w-6 h-6 text-gray-400 dark:text-gray-500" />
                </div>
                <p className="text-sm text-gray-400 dark:text-gray-500">{empty}</p>
                {emptyAction && <div className="mt-1">{emptyAction}</div>}
              </div>
            </td></tr>
          ) : data.map((row, i) => (
            <tr key={row.id || i} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/50 dark:hover:bg-gray-700/20 transition-colors">
              {numbered && (
                <td className="px-4 py-3 text-gray-400 dark:text-gray-500 text-sm tabular-nums">{startIndex + i + 1}</td>
              )}
              {columns.map(col => (
                <td key={String(col.key)} className={cn('px-4 py-3', col.className)}>
                  {col.render ? col.render(row) : String((row as any)[col.key] ?? '-')}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
