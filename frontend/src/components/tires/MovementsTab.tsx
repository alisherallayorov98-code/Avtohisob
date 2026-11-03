import { useEffect, useState } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import api from '../../lib/api'
import { formatDateTime } from '../../lib/utils'
import ExcelExportButton from '../ui/ExcelExportButton'
import Pagination from '../ui/Pagination'
import { useDebounce } from '../../hooks/useDebounce'
import { EVENT_STYLE, eventStyle, fmtKm, positionLabel } from './tireUi'

const inputCls =
  'px-3 py-2 text-sm rounded-xl border border-slate-200 dark:border-slate-600 bg-white dark:bg-slate-800 text-slate-900 dark:text-white ' +
  'placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition'

export default function MovementsTab({ branchId }: { branchId?: string }) {
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 300)
  const [eventType, setEventType] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)

  useEffect(() => { setPage(1) }, [debounced, eventType, from, to, branchId])

  const { data, isLoading } = useQuery({
    queryKey: ['tire-movements', 'all', page, limit, debounced, eventType, from, to, branchId],
    queryFn: () => api.get('/tires/movements', {
      params: {
        page, limit, search: debounced || undefined, eventType: eventType || undefined,
        from: from || undefined, to: to || undefined,
      },
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const rows: any[] = data?.data || []

  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800/60 overflow-hidden">
      <div className="p-3 flex flex-col lg:flex-row lg:items-center gap-2 border-b border-slate-100 dark:border-slate-700">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Shina raqami bo'yicha qidirish"
            className={`${inputCls} w-full pl-9`} />
        </div>
        <select value={eventType} onChange={e => setEventType(e.target.value)} className={inputCls}>
          <option value="">Barcha voqealar</option>
          {Object.entries(EVENT_STYLE).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <div className="flex items-center gap-2">
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} className={inputCls} aria-label="Boshlanish sanasi" />
          <span className="text-slate-400">—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} className={inputCls} aria-label="Tugash sanasi" />
        </div>
        <ExcelExportButton endpoint="/exports/tires" label="Excel hisobot" filename="shinalar-hisoboti.xlsx"
          params={{ from: from || undefined, to: to || undefined, branchId }} />
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-slate-400 bg-slate-50 dark:bg-slate-800">
              <th className="px-4 py-2.5 font-semibold">Sana</th>
              <th className="px-4 py-2.5 font-semibold">Voqea</th>
              <th className="px-4 py-2.5 font-semibold">Shina</th>
              <th className="px-4 py-2.5 font-semibold">Mashina</th>
              <th className="px-4 py-2.5 font-semibold">Joyi</th>
              <th className="px-4 py-2.5 font-semibold text-right">Km</th>
              <th className="px-4 py-2.5 font-semibold">Bajargan</th>
            </tr>
          </thead>
          <tbody>
            {isLoading ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Yuklanmoqda…</td></tr>
            ) : !rows.length ? (
              <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Harakat topilmadi</td></tr>
            ) : rows.map(e => {
              const s = eventStyle(e.eventType)
              return (
                <tr key={e.id} className="border-t border-slate-100 dark:border-slate-700/60 hover:bg-slate-50/70 dark:hover:bg-slate-800/60">
                  <td className="px-4 py-3 whitespace-nowrap text-slate-600 dark:text-slate-300">{formatDateTime(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center gap-1.5 text-[11px] font-semibold px-2 py-0.5 rounded-md ${s.chip}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {s.label}
                    </span>
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-slate-900 dark:text-white">{e.tire?.serialCode || '—'}</td>
                  <td className="px-4 py-3 text-slate-700 dark:text-slate-200">
                    {e.vehicle ? (
                      <>
                        <span className="font-mono font-medium">{e.vehicle.registrationNumber}</span>
                        <span className="block text-xs text-slate-400">{e.vehicle.brand} {e.vehicle.model}</span>
                      </>
                    ) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.position ? positionLabel(e.position) : '—'}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-slate-700 dark:text-slate-200">{fmtKm(e.mileageAtEvent)}</td>
                  <td className="px-4 py-3 text-slate-600 dark:text-slate-300">{e.createdBy || '—'}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0}
        limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
    </div>
  )
}
