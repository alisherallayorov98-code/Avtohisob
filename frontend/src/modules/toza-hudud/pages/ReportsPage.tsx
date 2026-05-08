import { useState, useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  Download, CheckCircle2, XCircle, Wifi, AlertTriangle,
  ChevronUp, ChevronDown, Search, TrendingUp, TrendingDown, Minus,
} from 'lucide-react'
import api from '../../../lib/api'

type Tab = 'daily' | 'mfy' | 'vehicles'
type SortDir = 'asc' | 'desc'

const MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function todayStr() { return new Date().toISOString().split('T')[0] }
function currentYear() { return new Date().getFullYear() }
function currentMonth() { return new Date().getMonth() + 1 }

function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'long', year: 'numeric' })
}

function downloadExcel(url: string, params: Record<string, any>) {
  const query = new URLSearchParams(
    Object.fromEntries(Object.entries(params).filter(([, v]) => v != null && v !== ''))
  ).toString()
  window.open(`${import.meta.env.VITE_API_URL || ''}/api/th/${url}?${query}`, '_blank')
}

// ── Coverage rang va ikonka ─────────────────────────────────────────────────
function coverageMeta(pct: number | null) {
  if (pct === null) return { cls: 'text-gray-400 bg-gray-50', bar: 'bg-gray-200', icon: null, label: '—' }
  if (pct >= 80) return { cls: 'text-emerald-700 bg-emerald-50', bar: 'bg-emerald-500', icon: TrendingUp,   label: `${pct}%` }
  if (pct >= 50) return { cls: 'text-amber-700  bg-amber-50',   bar: 'bg-amber-400',   icon: Minus,        label: `${pct}%` }
  return            { cls: 'text-red-700    bg-red-50',     bar: 'bg-red-400',     icon: TrendingDown, label: `${pct}%` }
}

function CoverageBadge({ pct }: { pct: number | null }) {
  const m = coverageMeta(pct)
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold ${m.cls}`}>
      {Icon && <Icon className="w-3 h-3" />}
      {m.label}
    </span>
  )
}

function CoverageBar({ pct }: { pct: number | null }) {
  const m = coverageMeta(pct)
  if (pct === null) return <span className="text-gray-300 text-xs">—</span>
  return (
    <div className="flex items-center gap-2 min-w-[100px]">
      <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${m.bar}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums w-8 text-right ${
        pct >= 80 ? 'text-emerald-700' : pct >= 50 ? 'text-amber-700' : 'text-red-700'
      }`}>{pct}%</span>
    </div>
  )
}

// ── Sort header ─────────────────────────────────────────────────────────────
function SortTh({ label, field, sortField, sortDir, onSort, align = 'left' }: {
  label: string; field: string; sortField: string; sortDir: SortDir
  onSort: (f: string) => void; align?: 'left' | 'center' | 'right'
}) {
  const active = sortField === field
  return (
    <th
      onClick={() => onSort(field)}
      className={`px-4 py-3 text-${align} text-xs uppercase tracking-wide font-semibold text-gray-500 cursor-pointer select-none hover:text-gray-800 transition-colors`}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? (sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-emerald-600" /> : <ChevronDown className="w-3 h-3 text-emerald-600" />)
          : <ChevronDown className="w-3 h-3 text-gray-300" />}
      </span>
    </th>
  )
}

// ── Stat karta ───────────────────────────────────────────────────────────────
function StatCard({ label, value, sub, color, bg, icon }: {
  label: string; value: number | string; sub?: string
  color: string; bg: string; icon?: React.ReactNode
}) {
  return (
    <div className={`${bg} rounded-xl p-4 flex flex-col gap-1`}>
      <div className={`flex items-center gap-2 text-2xl font-bold ${color}`}>
        {icon}{value}
      </div>
      <p className="text-xs font-medium text-gray-600">{label}</p>
      {sub && <p className="text-[11px] text-gray-400">{sub}</p>}
    </div>
  )
}

export default function ReportsPage() {
  const [tab, setTab] = useState<Tab>('daily')
  const [date, setDate] = useState(todayStr)
  const [branchFilter, setBranchFilter] = useState('')
  const [year, setYear] = useState(currentYear)
  const [month, setMonth] = useState(currentMonth)
  const [districtFilter, setDistrictFilter] = useState('')
  const [search, setSearch] = useState('')
  const [sortField, setSortField] = useState('visited')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

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

  // Sort handler
  function handleSort(field: string) {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  function sortRows(rows: any[], getVal: (r: any) => any) {
    return [...rows].sort((a, b) => {
      const av = getVal(a) ?? -1
      const bv = getVal(b) ?? -1
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
  }

  // Daily: summary
  const dailySummary = useMemo(() => {
    if (!dailyData) return null
    return {
      total:      (dailyData as any[]).reduce((s, v) => s + v.total, 0),
      visited:    (dailyData as any[]).reduce((s, v) => s + v.visited, 0),
      notVisited: (dailyData as any[]).reduce((s, v) => s + v.notVisited, 0),
      noGps:      (dailyData as any[]).reduce((s, v) => s + v.noGps, 0),
      suspicious: (dailyData as any[]).reduce((s, v) => s + v.suspicious, 0),
    }
  }, [dailyData])

  const completionPct = dailySummary && dailySummary.total > 0
    ? Math.round(dailySummary.visited / dailySummary.total * 100) : 0

  // Sorted daily rows
  const dailySorted = useMemo(() => {
    if (!dailyData) return []
    const q = search.trim().toLowerCase()
    const filtered = q
      ? (dailyData as any[]).filter(r =>
          (r.vehicle?.registrationNumber || '').toLowerCase().includes(q))
      : dailyData as any[]
    const fieldMap: Record<string, (r: any) => any> = {
      visited: r => r.visited,
      notVisited: r => r.notVisited,
      noGps: r => r.noGps,
      suspicious: r => r.suspicious,
      coveragePct: r => r.coveragePct,
      reg: r => r.vehicle?.registrationNumber || '',
    }
    return sortRows(filtered, fieldMap[sortField] || (r => r.visited))
  }, [dailyData, search, sortField, sortDir])

  // Sorted MFY rows
  const mfySorted = useMemo(() => {
    if (!mfyData) return []
    const q = search.trim().toLowerCase()
    const filtered = q
      ? (mfyData as any[]).filter(r =>
          (r.mfy?.name || '').toLowerCase().includes(q) ||
          (r.mfy?.district?.name || '').toLowerCase().includes(q))
      : mfyData as any[]
    const fieldMap: Record<string, (r: any) => any> = {
      visited: r => r.visited,
      notVisited: r => r.notVisited,
      coveragePct: r => r.coveragePct,
      name: r => r.mfy?.name || '',
    }
    return sortRows(filtered, fieldMap[sortField] || (r => r.coveragePct))
  }, [mfyData, search, sortField, sortDir])

  // Sorted vehicle rows
  const vehicleSorted = useMemo(() => {
    if (!vehicleData) return []
    const q = search.trim().toLowerCase()
    const filtered = q
      ? (vehicleData as any[]).filter(r =>
          (r.vehicle?.registrationNumber || '').toLowerCase().includes(q))
      : vehicleData as any[]
    const fieldMap: Record<string, (r: any) => any> = {
      visited: r => r.visited,
      notVisited: r => r.notVisited,
      suspicious: r => r.suspicious,
      landfillTrips: r => r.landfillTrips,
      coveragePct: r => r.coveragePct,
    }
    return sortRows(filtered, fieldMap[sortField] || (r => r.visited))
  }, [vehicleData, search, sortField, sortDir])

  const tabs = [
    { key: 'daily' as Tab, label: '📅 Kunlik hisobot' },
    { key: 'mfy' as Tab, label: '🏘 Oylik MFY' },
    { key: 'vehicles' as Tab, label: '🚛 Oylik mashinalar' },
  ]

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Hisobotlar</h1>
          <p className="text-sm text-gray-500 mt-0.5">Xizmat ko'rsatish statistikasi va tahlili</p>
        </div>
        <button
          onClick={() => {
            if (tab === 'daily')    downloadExcel('reports/daily/excel', { date, branchId: branchFilter || undefined })
            else if (tab === 'mfy') downloadExcel('reports/monthly/mfy/excel', { year, month, districtId: districtFilter || undefined })
            else                    downloadExcel('reports/monthly/vehicles/excel', { year, month, branchId: branchFilter || undefined })
          }}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 shadow-sm shadow-emerald-200"
        >
          <Download className="w-4 h-4" />
          Excel yuklab olish
        </button>
      </div>

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {tabs.map(t => (
          <button key={t.key} onClick={() => { setTab(t.key); setSearch(''); setSortField('visited'); setSortDir('desc') }}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t.key ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── Filtrlar ── */}
      <div className="flex gap-2 flex-wrap items-center">
        {tab === 'daily' && (
          <>
            <input type="date" value={date} onChange={e => setDate(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400" />
            <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
              className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
              <option value="">Barcha filiallar</option>
              {(branches || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </>
        )}
        {(tab === 'mfy' || tab === 'vehicles') && (
          <YearMonthPicker year={year} month={month} onYear={setYear} onMonth={setMonth} />
        )}
        {tab === 'mfy' && (
          <select value={districtFilter} onChange={e => setDistrictFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
            <option value="">Barcha tumanlar</option>
            {(districts || []).map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        )}
        {tab === 'vehicles' && (
          <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
            <option value="">Barcha filiallar</option>
            {(branches || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        {/* Qidiruv */}
        <div className="relative ml-auto">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder={tab === 'mfy' ? 'MFY yoki tuman...' : 'Mashina raqami...'}
            className="pl-8 pr-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 w-48"
          />
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════════════════════
          KUNLIK HISOBOT
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'daily' && (
        <div className="space-y-4">
          {/* Stats */}
          {dailySummary && (
            <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
              <div className="flex items-center justify-between flex-wrap gap-2">
                <p className="text-sm font-semibold text-gray-700">
                  📅 {fmtDate(date)} — umumiy ko'rsatkich
                </p>
                <span className={`text-sm font-bold px-3 py-1 rounded-full ${
                  completionPct >= 80 ? 'bg-emerald-100 text-emerald-700' :
                  completionPct >= 50 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'
                }`}>{completionPct}% bajarildi</span>
              </div>
              {/* Progress bar */}
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div className={`h-full rounded-full transition-all ${
                  completionPct >= 80 ? 'bg-emerald-500' :
                  completionPct >= 50 ? 'bg-amber-400' : 'bg-red-400'
                }`} style={{ width: `${completionPct}%` }} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 pt-1">
                <StatCard label="Jami topshiriq" value={dailySummary.total}     color="text-gray-700"   bg="bg-gray-50" />
                <StatCard label="Bajarildi"       value={dailySummary.visited}   color="text-emerald-700" bg="bg-emerald-50" icon={<CheckCircle2 className="w-5 h-5" />} />
                <StatCard label="Bajarilmadi"     value={dailySummary.notVisited} color="text-red-700"   bg="bg-red-50"    icon={<XCircle className="w-5 h-5" />} />
                <StatCard label="GPS yo'q"        value={dailySummary.noGps}     color="text-gray-500"   bg="bg-gray-100"  icon={<Wifi className="w-5 h-5" />} />
                <StatCard label="Shubhali"        value={dailySummary.suspicious} color="text-orange-700" bg="bg-orange-50" icon={<AlertTriangle className="w-5 h-5" />} />
              </div>
            </div>
          )}

          {/* Table */}
          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
              <p className="text-xs text-gray-500">{dailySorted.length} ta mashina</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <SortTh label="Mashina"    field="reg"        sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    <SortTh label="Borildi"    field="visited"    sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Borilmadi"  field="notVisited" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="GPS yo'q"   field="noGps"      sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Shubhali"   field="suspicious" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Bajarilish" field="coveragePct" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {dailyLoading && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center text-gray-400 text-sm">Yuklanmoqda...</td></tr>
                  )}
                  {!dailyLoading && dailySorted.length === 0 && (
                    <tr><td colSpan={6} className="px-4 py-12 text-center">
                      <p className="font-medium text-gray-500">{fmtDate(date)} uchun ma'lumot topilmadi</p>
                      <p className="text-xs text-gray-400 mt-1">GPS tahlil qilish tugmasini bosing yoki boshqa sanani tanlang</p>
                    </td></tr>
                  )}
                  {dailySorted.map((row: any, i: number) => {
                    const total = row.visited + row.notVisited + row.noGps
                    const pct = total > 0 ? Math.round(row.visited / total * 100) : null
                    const rowBg = row.notVisited > row.visited
                      ? 'bg-red-50/20' : row.visited === total ? 'bg-emerald-50/20' : ''
                    return (
                      <tr key={row.vehicle?.id || i} className={`hover:bg-gray-50/80 transition-colors ${rowBg}`}>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-bold text-gray-800 tracking-wide">
                            {row.vehicle?.registrationNumber || '—'}
                          </p>
                          <p className="text-[11px] text-gray-400">{row.vehicle?.brand} {row.vehicle?.model}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />{row.visited}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.notVisited > 0
                            ? <span className="inline-flex items-center gap-1 text-red-600 font-bold"><XCircle className="w-3.5 h-3.5" />{row.notVisited}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.noGps > 0
                            ? <span className="inline-flex items-center gap-1 text-gray-500"><Wifi className="w-3.5 h-3.5" />{row.noGps}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.suspicious > 0
                            ? <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">⚠ {row.suspicious}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3"><CoverageBar pct={pct} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          OYLIK MFY HISOBOTI
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'mfy' && (
        <div className="space-y-4">
          {/* Summary chips */}
          {mfyData && !mfyLoading && (
            <div className="flex items-center gap-3 flex-wrap">
              {[
                { label: 'Jami MFY', val: mfyData.length, cls: 'bg-gray-100 text-gray-700' },
                { label: '≥80% yaxshi', val: (mfyData as any[]).filter(r => (r.coveragePct ?? 0) >= 80).length, cls: 'bg-emerald-100 text-emerald-700' },
                { label: '50–79% o\'rta', val: (mfyData as any[]).filter(r => r.coveragePct != null && r.coveragePct >= 50 && r.coveragePct < 80).length, cls: 'bg-amber-100 text-amber-700' },
                { label: '<50% yomon', val: (mfyData as any[]).filter(r => r.coveragePct != null && r.coveragePct < 50).length, cls: 'bg-red-100 text-red-700' },
              ].map(c => (
                <span key={c.label} className={`text-xs font-semibold px-3 py-1.5 rounded-full ${c.cls}`}>
                  {c.label}: <strong>{c.val}</strong>
                </span>
              ))}
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <p className="text-xs text-gray-400">{mfySorted.length} ta MFY · {MONTHS[month - 1]} {year}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[560px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide font-semibold text-gray-500 w-8">#</th>
                    <SortTh label="MFY"         field="name"       sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide font-semibold text-gray-500">Tuman</th>
                    <SortTh label="Borildi"     field="visited"    sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Borilmadi"   field="notVisited" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <th className="px-4 py-3 text-center text-xs uppercase tracking-wide font-semibold text-gray-500">GPS yo'q</th>
                    <SortTh label="Bajarilish"  field="coveragePct" sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {mfyLoading && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">Yuklanmoqda...</td></tr>
                  )}
                  {!mfyLoading && mfySorted.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500 text-sm">
                      {MONTHS[month - 1]} {year} uchun ma'lumot topilmadi
                    </td></tr>
                  )}
                  {mfySorted.map((row: any, i: number) => {
                    const pct = row.coveragePct
                    const rowBg = pct != null && pct < 50 ? 'bg-red-50/20' : pct != null && pct >= 80 ? 'bg-emerald-50/10' : ''
                    return (
                      <tr key={row.mfy?.id || i} className={`hover:bg-gray-50/80 transition-colors ${rowBg}`}>
                        <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-gray-800 max-w-[180px] truncate">{row.mfy?.name || '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{row.mfy?.district?.name || '—'}</td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />{row.visited}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.notVisited > 0
                            ? <span className="inline-flex items-center gap-1 text-red-600 font-bold"><XCircle className="w-3.5 h-3.5" />{row.notVisited}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center text-gray-500">{row.noGps || '—'}</td>
                        <td className="px-4 py-3"><CoverageBar pct={pct} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════════
          OYLIK MASHINA HISOBOTI
      ══════════════════════════════════════════════════════════════════════ */}
      {tab === 'vehicles' && (
        <div className="space-y-4">
          {/* Top performers */}
          {vehicleData && !vehicleLoading && (vehicleData as any[]).length > 0 && (() => {
            const sorted = [...(vehicleData as any[])].sort((a, b) => (b.coveragePct ?? 0) - (a.coveragePct ?? 0))
            const top = sorted[0]
            const worst = sorted[sorted.length - 1]
            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-3 flex items-center gap-3">
                  <div className="w-10 h-10 bg-emerald-100 rounded-xl flex items-center justify-center text-emerald-600">🏆</div>
                  <div>
                    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wide">Eng yaxshi mashina</p>
                    <p className="font-mono font-bold text-gray-800">{top.vehicle?.registrationNumber}</p>
                    <p className="text-xs text-emerald-700">{top.visited} ta MFY · {top.coveragePct ?? 0}% bajarildi</p>
                  </div>
                </div>
                {worst && worst.vehicle?.id !== top.vehicle?.id && (
                  <div className="bg-red-50 border border-red-200 rounded-xl p-3 flex items-center gap-3">
                    <div className="w-10 h-10 bg-red-100 rounded-xl flex items-center justify-center text-red-600">⚠️</div>
                    <div>
                      <p className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">Eng kam bajargan</p>
                      <p className="font-mono font-bold text-gray-800">{worst.vehicle?.registrationNumber}</p>
                      <p className="text-xs text-red-700">{worst.visited} ta MFY · {worst.coveragePct ?? 0}% bajarildi</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })()}

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="px-4 py-2.5 border-b border-gray-100">
              <p className="text-xs text-gray-400">{vehicleSorted.length} ta mashina · {MONTHS[month - 1]} {year}</p>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[640px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-200">
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide font-semibold text-gray-500 w-8">#</th>
                    <th className="px-4 py-3 text-left text-xs uppercase tracking-wide font-semibold text-gray-500">Mashina</th>
                    <SortTh label="Borildi"     field="visited"      sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Borilmadi"   field="notVisited"   sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Shubhali"    field="suspicious"   sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Poligon"     field="landfillTrips" sortField={sortField} sortDir={sortDir} onSort={handleSort} align="center" />
                    <SortTh label="Bajarilish"  field="coveragePct"  sortField={sortField} sortDir={sortDir} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {vehicleLoading && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-400 text-sm">Yuklanmoqda...</td></tr>
                  )}
                  {!vehicleLoading && vehicleSorted.length === 0 && (
                    <tr><td colSpan={7} className="px-4 py-12 text-center text-gray-500 text-sm">
                      {MONTHS[month - 1]} {year} uchun ma'lumot topilmadi
                    </td></tr>
                  )}
                  {vehicleSorted.map((row: any, i: number) => {
                    const pct = row.coveragePct
                    const rowBg = pct != null && pct < 50 ? 'bg-red-50/20' : ''
                    return (
                      <tr key={row.vehicle?.id || i} className={`hover:bg-gray-50/80 transition-colors ${rowBg}`}>
                        <td className="px-4 py-3 text-xs text-gray-400 tabular-nums">{i + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-mono text-xs font-bold text-gray-800 tracking-wide">
                            {row.vehicle?.registrationNumber || '—'}
                          </p>
                          <p className="text-[11px] text-gray-400">{row.vehicle?.brand} {row.vehicle?.model}</p>
                        </td>
                        <td className="px-4 py-3 text-center">
                          <span className="inline-flex items-center gap-1 text-emerald-700 font-bold">
                            <CheckCircle2 className="w-3.5 h-3.5" />{row.visited}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.notVisited > 0
                            ? <span className="inline-flex items-center gap-1 text-red-600 font-bold"><XCircle className="w-3.5 h-3.5" />{row.notVisited}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.suspicious > 0
                            ? <span className="text-xs font-bold bg-orange-100 text-orange-700 px-2 py-0.5 rounded-full">⚠ {row.suspicious}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3 text-center">
                          {row.landfillTrips > 0
                            ? <span className="text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">{row.landfillTrips}</span>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-3"><CoverageBar pct={pct} /></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
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
        className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
        {years.map(y => <option key={y} value={y}>{y}</option>)}
      </select>
      <select value={month} onChange={e => onMonth(Number(e.target.value))}
        className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400">
        {MONTHS.map((m, i) => <option key={i + 1} value={i + 1}>{m}</option>)}
      </select>
    </>
  )
}
