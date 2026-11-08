import { Calendar } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import api from '../../lib/api'

export interface Preset { key: string; label: string }

export const PRESETS: Preset[] = [
  { key: 'this-month', label: 'Bu oy' },
  { key: 'last-month', label: "O'tgan oy" },
  { key: 'this-quarter', label: 'Bu chorak' },
  { key: 'this-year', label: 'Bu yil' },
  { key: 'last-year', label: "O'tgan yil" },
]

const inputCls = 'h-9 px-3 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500'

/**
 * Yagona filtr paneli: davr tugmalari (aktivi ajralib turadi), qo'lda sana va filial.
 * getRange — Reports.tsx dagi preset hisobi (bir joyda saqlanadi).
 */
export default function ReportFilterBar({
  from, to, branchId, summary, getRange, onChange, onBranch,
}: {
  from: string; to: string; branchId: string
  /** Xulosa tabi doim joriy oy — davr tanlash ma'nosiz, faqat filial */
  summary?: boolean
  getRange: (preset: string) => { from: string; to: string }
  onChange: (from: string, to: string) => void
  onBranch: (id: string) => void
}) {
  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data as Array<{ id: string; name: string }>),
    staleTime: 5 * 60 * 1000,
  })
  const active = PRESETS.find(p => { const r = getRange(p.key); return r.from === from && r.to === to })?.key

  return (
    <div className="flex flex-wrap items-center gap-2">
      {!summary && PRESETS.map(p => (
        <button
          key={p.key}
          onClick={() => { const r = getRange(p.key); onChange(r.from, r.to) }}
          className={`h-9 px-3 text-sm font-medium rounded-lg border transition-colors ${active === p.key
            ? 'bg-blue-600 border-blue-600 text-white'
            : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
        >{p.label}</button>
      ))}
      {!summary && (
        <div className="flex items-center gap-2">
          <Calendar className="w-4 h-4 text-gray-400" />
          <input type="date" value={from} onChange={e => onChange(e.target.value, to)} className={inputCls} />
          <span className="text-gray-400">—</span>
          <input type="date" value={to} onChange={e => onChange(from, e.target.value)} className={inputCls} />
        </div>
      )}
      {branches && branches.length > 1 && (
        <select value={branchId} onChange={e => onBranch(e.target.value)} className={`${inputCls} ${summary ? '' : 'sm:ml-auto'}`}>
          <option value="">Barcha filiallar</option>
          {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>
      )}
    </div>
  )
}
