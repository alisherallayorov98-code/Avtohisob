import { cn } from '../../lib/utils'
import { Loader2 } from 'lucide-react'

interface Column<T> {
  key: keyof T | string
  title: string
  render?: (row: T) => React.ReactNode
  className?: string
}

interface Props<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  empty?: string
  className?: string
}

export default function Table<T extends { id?: string }>({ columns, data, loading, empty = 'Ma\'lumot topilmadi', className }: Props<T>) {
  return (
    <div className={cn('overflow-x-auto', className)}>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-gray-100 bg-gray-50">
            {columns.map(col => (
              <th key={String(col.key)} className={cn('text-left px-4 py-3 font-medium text-gray-600 whitespace-nowrap', col.className)}>
                {col.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr><td colSpan={columns.length} className="py-12 text-center">
              <Loader2 className="w-6 h-6 animate-spin text-blue-500 mx-auto" />
            </td></tr>
          ) : data.length === 0 ? (
            <tr><td colSpan={columns.length} className="py-12 text-center text-gray-400">{empty}</td></tr>
          ) : data.map((row, i) => (
            <tr key={row.id || i} className="border-b border-gray-50 hover:bg-gray-50/50 transition-colors">
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
