import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Download, CheckCircle2, XCircle, Wifi, TrendingUp } from 'lucide-react'
import api from '../../../lib/api'

type Tab = 'daily' | 'mfy' | 'vehicles'

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function today() {
  return new Date().toISOString().split('T')[0]
}

function currentYear() { return new Date().getFullYear() }
function currentMonth() { return new Date().getMonth() + 1 }

function CoverageBadge({ pct }: { pct: number | null }) {
  if (pct === null) return <span className="text-gray-400">—</span>
  const color = pct >= 80 ? 'text-emerald-700 bg-emerald-100' : pct >= 50 ? 'text-yellow-700 bg-yellow-100' : 'text-red-700 bg-red-100'
  return <span className={`px-2 py-0.5 rounded-full text-xs font-bold ${color}`}>{pct}%</span>
}

function downloadExcel(url: string, params: Record<string, any>) {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  window.open(`${import.meta.env.VITE_API_URL || ''}/api/th/${url}?${query}`, '_blank')
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('daily')
  const [date, setDate] = useState(today)
  const [branchFilter, setBranchFilter] = useState('')
  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)
  const [districtFilter, setDistrictFilter] = useState('')

  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })
  const { data: districts } = useQuery({
    queryKey: ['th-districts'],
    queryFn: () => api.get('/th/districts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: dailyData, isLoading: dailyLoading } = useQuery({
    queryKey: ['th-report-daily', date, branchFilter],
    queryFn: () => api.get('/th/reports/daily', {
      params: { date, branchId: branchFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'daily',
  })

  const { data: mfyData, isLoading: mfyLoading } = useQuery({
    queryKey: ['th-report-mfy', year, month, districtFilter],
    queryFn: () => api.get('/th/reports/monthly/mfy', {
      params: { year, month, districtId: districtFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'mfy',
  })

  const { data: vehicleData, isLoading: vehicleLoading } = useQuery({
    queryKey: ['th-report-vehicles', year, month, branchFilter],
    queryFn: () => api.get('/th/reports/monthly/vehicles', {
      params: { year, month, branchId: branchFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'vehicles',
  })

  // Summary for daily tab
  const dailySummary = dailyData ? {
    total: (dailyData as any[]).reduce((s, v) => s + v.total, 0),
    visited: (dailyData as any[]).reduce((s, v) => s + v.visited, 0),
    notVisited: (dailyData as any[]).reduce((s, v) => s + v.notVisited, 0),
    suspicious: (dailyData as any[]).reduce((s, v) => s + v.suspicious, 0),
  } : null

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Hisobotlar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Xizmat ko'rsatish statistikasi va hisobotlar</p>
        </div>
        {/* Excel export button */}
        <button
          onClick={() => {
            if (tab === 'daily') downloadExcel('reports/daily/excel', { date, branchId: branchFilter || undefined })
            else if (tab === 'mfy') downloadExcel('reports/monthly/mfy/excel', { year, month, districtId: districtFilter || undefined })
            else downloadExcel('reports/monthly/vehicles/excel', { year, month, branchId: branchFilter || undefined })
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700"
        >
          <Download className="w-4 h-4" />
          Excel yuklab olish
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {([
          { key: 'daily', label: 'Kunlik hisobot' },
          { key: 'mfy', label: 'Oylik MFY' },
          { key: 'vehicles', label: 'Oylik mashinalar' },
        ] as { key: Tab; label: string }[]).map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex gap-3 flex-wrap items-center">
        {tab === 'daily' && (
          <>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">Barcha filiallar</option>
              {(branches || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>
        )}
        {tab === 'mfy' && (
          <>
            <YearMonthPicker year={year} month={month} onYear={setYear} onMonth={setMonth} />
            <select value={districtFilter} onChange={e => setDistrictFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">Barcha tumanlar</option>
              {(districts || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </>
        )}
        {tab === 'vehicles' && (
          <>
            <YearMonthPicker year={year} month={month} onYear={setYear} onMonth={setMonth} />
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
              <option value="">Barcha filiallar</option>
              {(branches || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>
        )}
      </div>

      {/* ── Daily report ── */}
      {tab === 'daily' && (
        <div className="space-y-4">
          {dailySummary && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 rounded-xl p-4">
                <p className="text-2xl font-bold text-gray-700">{dailySummary.total}</p>
                <p className="text-xs text-gray-500 mt-0.5">Jami topshiriq</p>
              </div>
              <div className="bg-emerald-50 rounded-xl p-4">
                <p className="text-2xl font-bold text-emerald-700">{dailySummary.visited}</p>
                <p className="text-xs text-gray-500 mt-0.5">Bajarildi</p>
              </div>
              <div className="bg-red-50 rounded-xl p-4">
                <p className="text-2xl font-bold text-red-700">{dailySummary.notVisited}</p>
                <p className="text-xs text-gray-500 mt-0.5">Bajarilmadi</p>
              </div>
              <div className="bg-orange-50 rounded-xl p-4">
                <p className="text-2xl font-bold text-orange-700">{dailySummary.suspicious}</p>
                <p className="text-xs text-gray-500 mt-0.5">Shubhali</p>
              </div>
            </div>
          )}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Mashina</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Borildi</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Borilmadi</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">GPS yo'q</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Shubhali</th>
                    <th className="px-4 py-3 text-center font-medium text-gray-600">Qamrov</th>
                  </tr>
                </thead>
                <tbody>
                  {dailyLoading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Yuklanmoqda...</td></tr>}
                  {!dailyLoading && (dailyData || []).length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Ma'lumot yo'q</td></tr>
                  )}
                  {(dailyData || []).map((row: any) => (
                    <tr key={row.vehicle?.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-medium text-gray-800">{row.vehicle?.registrationNumber}</p>
                        <p className="text-xs text-gray-400">{row.vehicle?.brand} {row.vehicle?.model}</p>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />{row.visited}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-red-600 font-medium">
                          <XCircle className="w-3.5 h-3.5" />{row.notVisited}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="inline-flex items-center gap-1 text-gray-400">
                          <Wifi className="w-3.5 h-3.5" />{row.noGps}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {row.suspicious > 0
                          ? <span className="text-orange-600 font-bold">⚠ {row.suspicious}</span>
                          : <span className="text-gray-300">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <CoverageBadge pct={row.coveragePct} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ── Monthly MFY ── */}
      {tab === 'mfy' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">MFY</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tuman</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Borildi</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Borilmadi</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">GPS yo'q</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Qamrov</th>
                </tr>
              </thead>
              <tbody>
                {mfyLoading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Yuklanmoqda...</td></tr>}
                {!mfyLoading && (mfyData || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Ma'lumot yo'q</td></tr>
                )}
                {(mfyData || []).map((row: any) => (
                  <tr key={row.mfy?.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3 text-gray-800 font-medium">{row.mfy?.name}</td>
                    <td className="px-4 py-3 text-gray-500 text-xs">{row.mfy?.district?.name}</td>
                    <td className="px-4 py-3 text-center text-emerald-700 font-medium">{row.visited}</td>
                    <td className="px-4 py-3 text-center text-red-600 font-medium">{row.notVisited}</td>
                    <td className="px-4 py-3 text-center text-gray-400">{row.noGps}</td>
                    <td className="px-4 py-3 text-center"><CoverageBadge pct={row.coveragePct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Monthly Vehicles ── */}
      {tab === 'vehicles' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Mashina</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Borildi</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Borilmadi</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Shubhali</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Poligon</th>
                  <th className="px-4 py-3 text-center font-medium text-gray-600">Qamrov</th>
                </tr>
              </thead>
              <tbody>
                {vehicleLoading && <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Yuklanmoqda...</td></tr>}
                {!vehicleLoading && (vehicleData || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Ma'lumot yo'q</td></tr>
                )}
                {(vehicleData || []).map((row: any) => (
                  <tr key={row.vehicle?.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-medium text-gray-800">{row.vehicle?.registrationNumber}</p>
                      <p className="text-xs text-gray-400">{row.vehicle?.brand} {row.vehicle?.model}</p>
                    </td>
                    <td className="px-4 py-3 text-center text-emerald-700 font-medium">{row.visited}</td>
                    <td className="px-4 py-3 text-center text-red-600 font-medium">{row.notVisited}</td>
                    <td className="px-4 py-3 text-center">
                      {row.suspicious > 0
                        ? <span className="text-orange-600 font-bold">⚠ {row.suspicious}</span>
                        : <span className="text-gray-300">—</span>}
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center gap-1 text-blue-700 font-medium">
                        <TrendingUp className="w-3.5 h-3.5" />{row.landfillTrips}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center"><CoverageBadge pct={row.coveragePct} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

function YearMonthPicker({ year, month, onYear, onMonth }: {
  year: number; month: number
  onYear: (v: number) => void; onMonth: (v: number) => void
}) {
  const years = Array.from({ length: 3 }, (_, i) => new Date().getFullYear() - i)
  return (
    <>
      <select value={year} onChange={e => onYear(Number(e.target.value))}
        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={month} onChange={e => onMonth(Number(e.target.value))}
        className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
        {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
      </select>
    </>
  )
}
