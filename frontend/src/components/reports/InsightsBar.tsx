import { formatDate } from '../../lib/utils'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { AlertTriangle, ArrowDown, ArrowUp, Info, Minus } from 'lucide-react'
import api from '../../lib/api'

interface Totals { total: number; fuel: number; maintenance: number; expenses: number }
interface InsightsData {
  current: Totals
  previous: Totals | null
  previousRange: { from: string; to: string } | null
  delta: { total: number | null; fuel: number | null; maintenance: number | null; expenses: number | null } | null
  insights: { level: 'warning' | 'info'; text: string; vehicleId?: string }[]
}

const short = (n: number) => {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace('.', ',')} mln`
  if (a >= 1_000) return `${Math.round(n / 1_000)} ming`
  return String(Math.round(n))
}

const fmtDay = (iso: string) => formatDate(iso)

function Delta({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-xs text-gray-400">—</span>
  const Icon = pct > 0 ? ArrowUp : pct < 0 ? ArrowDown : Minus
  // Xarajat kamaysa yaxshi (yashil), oshsa e'tibor (qizil)
  const cls = pct === 0 ? 'text-gray-500' : pct > 0 ? 'text-red-600 dark:text-red-400' : 'text-emerald-600 dark:text-emerald-400'
  return <span className={`inline-flex items-center gap-0.5 text-xs font-semibold ${cls}`}><Icon className="w-3 h-3" />{Math.abs(pct)}%</span>
}

/** Davr bo'yicha oldingi davr bilan solishtirma + "nimaga e'tibor berish kerak". Ma'noli narsa bo'lmasa — hech narsa ko'rsatmaydi. */
export default function InsightsBar({ from, to, branchId, compare = true }: { from: string; to: string; branchId: string; compare?: boolean }) {
  const { data } = useQuery({
    queryKey: ['report-insights', from, to, branchId, compare],
    queryFn: () => api.get('/reports/insights', { params: { from: from || undefined, to: to || undefined, branchId: branchId || undefined, compare: compare ? undefined : '0' } }).then(r => r.data.data as InsightsData),
    enabled: !!from && !!to,
    staleTime: 60_000,
  })
  if (!data) return null

  const items = data.insights || []
  const prev = data.previous
  const hasCompare = !!prev && !!data.delta && (data.current.total > 0 || prev.total > 0)
  if (!hasCompare && items.length === 0) return null

  const rows: { label: string; cur: number; prev: number; d: number | null }[] = hasCompare ? [
    { label: 'Jami', cur: data.current.total, prev: prev!.total, d: data.delta!.total },
    { label: "Yoqilg'i", cur: data.current.fuel, prev: prev!.fuel, d: data.delta!.fuel },
    { label: "Ta'mirlash", cur: data.current.maintenance, prev: prev!.maintenance, d: data.delta!.maintenance },
    { label: 'Boshqa', cur: data.current.expenses, prev: prev!.expenses, d: data.delta!.expenses },
  ] : []

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-3 print:hidden">
      {hasCompare && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
            Oldingi davr bilan{data.previousRange ? ` (${fmtDay(data.previousRange.from)} – ${fmtDay(data.previousRange.to)})` : ''}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {rows.map(r => (
              <div key={r.label}>
                <p className="text-xs text-gray-500 dark:text-gray-400">{r.label}</p>
                <p className="text-base font-bold text-gray-900 dark:text-white tabular-nums">{short(r.cur)}</p>
                <p className="text-[11px] text-gray-400 tabular-nums flex items-center gap-1.5">{short(r.prev)} <Delta pct={r.d} /></p>
              </div>
            ))}
          </div>
        </div>
      )}
      {items.length > 0 && (
        <div className="rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 p-4">
          <p className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">Nimaga e'tibor berish kerak</p>
          <ul className="space-y-2">
            {items.map((it, i) => (
              <li key={i} className="flex gap-2 text-sm text-gray-800 dark:text-gray-200">
                {it.level === 'warning'
                  ? <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" />
                  : <Info className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />}
                <span>
                  {it.text}
                  {it.vehicleId && <Link to={`/vehicles/${it.vehicleId}`} className="ml-2 text-xs text-blue-600 dark:text-blue-400 hover:underline whitespace-nowrap">Mashinaga o'tish →</Link>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
