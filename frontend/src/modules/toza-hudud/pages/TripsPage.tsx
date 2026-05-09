import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  CheckCircle2, XCircle, Wifi, AlertTriangle, RefreshCw,
  Trash2, MapPin, Search, ChevronLeft, ChevronRight, Download,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../../../lib/api'

type Tab = 'service' | 'landfill' | 'container'

const STATUS_CONFIG = {
  visited:     { label: 'Borildi',       cls: 'bg-emerald-100 text-emerald-700', row: 'bg-emerald-50/30', dot: 'bg-emerald-500', icon: CheckCircle2 },
  not_visited: { label: 'Borilmadi',     cls: 'bg-red-100 text-red-700',         row: 'bg-red-50/20',     dot: 'bg-red-500',     icon: XCircle },
  no_gps:      { label: "GPS yo'q",      cls: 'bg-gray-100 text-gray-500',       row: '',                 dot: 'bg-gray-400',    icon: Wifi },
  no_polygon:  { label: "Polygon yo'q",  cls: 'bg-yellow-100 text-yellow-700',   row: 'bg-yellow-50/20',  dot: 'bg-yellow-400',  icon: AlertTriangle },
} as const

function fmtTime(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}
function fmtDur(a: string | null, b: string | null) {
  if (!a || !b) return null
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m > 0 ? `${m} daq` : null
}
function todayStr() { return new Date().toISOString().split('T')[0] }
function shiftDate(s: string, d: number) {
  const dt = new Date(s); dt.setDate(dt.getDate() + d); return dt.toISOString().split('T')[0]
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'short', year: 'numeric' })
}

// Mini progress bar for coverage
function CoverageBar({ pct }: { pct: number | null }) {
  if (pct == null) return <span className="text-gray-300 text-xs">—</span>
  const clr = pct >= 70 ? 'bg-emerald-500' : pct >= 40 ? 'bg-amber-400' : 'bg-red-400'
  const txt = pct >= 70 ? 'text-emerald-700' : pct >= 40 ? 'text-amber-700' : 'text-red-700'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${clr}`} style={{ width: `${pct}%` }} />
      </div>
      <span className={`text-xs font-bold tabular-nums ${txt}`}>{pct}%</span>
    </div>
  )
}

export default function TripsPage() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('service')
  const [date, setDate] = useState(todayStr)
  const [branchFilter, setBranchFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [vehicleSearch, setVehicleSearch] = useState('')
  const isToday = date === todayStr()

  const { data: diagnostic } = useQuery({
    queryKey: ['th-diagnostic'],
    queryFn: () => api.get('/th/trips/diagnostic').then(r => r.data.data),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
  })

  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: stats, isLoading: statsLoading, refetch: refetchStats } = useQuery({
    queryKey: ['th-service-stats', date, branchFilter],
    queryFn: () => api.get('/th/trips/service/stats', {
      params: { date, branchId: branchFilter || undefined },
    }).then(r => r.data.data),
    refetchInterval: isToday ? 5 * 60 * 1000 : false,
  })

  const { data: serviceTrips, isLoading: tripsLoading, refetch: refetchTrips } = useQuery({
    queryKey: ['th-service-trips', date, branchFilter, statusFilter],
    queryFn: () => api.get('/th/trips/service', {
      params: { date, branchId: branchFilter || undefined, status: statusFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'service',
    refetchInterval: isToday && tab === 'service' ? 5 * 60 * 1000 : false,
  })

  const { data: landfillTrips, isLoading: landfillLoading } = useQuery({
    queryKey: ['th-landfill-trips', date, branchFilter],
    queryFn: () => api.get('/th/trips/landfills', {
      params: { date, branchId: branchFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'landfill',
  })

  const { data: containerStats, isLoading: containerLoading } = useQuery({
    queryKey: ['th-container-stats', date, branchFilter],
    queryFn: () => api.get('/th/containers/visits/stats', {
      params: { date, branchId: branchFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'container',
  })

  const runMut = useMutation({
    mutationFn: () => api.post('/th/trips/run', {}, { params: { date } }),
    onSuccess: (res) => {
      const d = res.data.data
      if (d.analyzed === 0 && d.noGps === 0 && d.noPolygon === 0) {
        toast('Jadval topilmadi — avval haftalik grafik kiriting', { icon: '📋' })
      } else if (d.analyzed > 0) {
        toast.success(`Tahlil tugadi: ${d.analyzed} ta juftlik tahlil qilindi`)
      } else if (d.noGps > 0) {
        toast(`GPS signal yo'q: ${d.noGps} ta — Sozlamalar → GPS ni tekshiring`, { icon: '📡' })
      } else if (d.noPolygon > 0) {
        toast(`Polygon yo'q: ${d.noPolygon} ta MFY — Xarita sahifasidan sinxronlang`, { icon: '⬛' })
      } else {
        toast.success(`Tahlil tugadi`)
      }
      qc.invalidateQueries({ queryKey: ['th-service-trips'] })
      qc.invalidateQueries({ queryKey: ['th-service-stats'] })
      qc.invalidateQueries({ queryKey: ['th-landfill-trips'] })
      qc.invalidateQueries({ queryKey: ['th-container-stats'] })
      qc.invalidateQueries({ queryKey: ['th-diagnostic'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Tahlil xatoligi'),
  })

  // Client-side vehicle search filter
  const filteredTrips = useMemo(() => {
    if (!serviceTrips) return []
    if (!vehicleSearch.trim()) return serviceTrips
    const q = vehicleSearch.trim().toLowerCase()
    return serviceTrips.filter((t: any) =>
      (t.vehicle?.registrationNumber || '').toLowerCase().includes(q) ||
      (t.mfy?.name || '').toLowerCase().includes(q)
    )
  }, [serviceTrips, vehicleSearch])

  const completionPct = stats && stats.total > 0
    ? Math.round(stats.visited / stats.total * 100) : 0

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full">

      {/* ── Header ── */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">GPS Monitoring</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kunlik xizmat ko'rsatish nazorati</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { refetchStats(); refetchTrips() }}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-white border border-gray-200 rounded-lg hover:bg-gray-50"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Yangilash
          </button>
          <button
            onClick={() => runMut.mutate()}
            disabled={runMut.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-60 shadow-sm shadow-emerald-200"
          >
            <RefreshCw className={`w-4 h-4 ${runMut.isPending ? 'animate-spin' : ''}`} />
            {runMut.isPending ? 'Tahlil qilinmoqda...' : 'GPS tahlil qilish'}
          </button>
        </div>
      </div>

      {/* ── Sana navigatsiya + filtrlar ── */}
      <div className="flex items-center gap-2 flex-wrap">
        {/* Sana */}
        <div className="flex items-center gap-1 bg-white border border-gray-200 rounded-lg px-1 py-1">
          <button onClick={() => setDate(d => shiftDate(d, -1))} className="p-1.5 hover:bg-gray-100 rounded">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)}
            className="px-2 py-1 text-sm text-gray-700 bg-transparent outline-none" />
          <button onClick={() => setDate(d => shiftDate(d, 1))} disabled={isToday}
            className="p-1.5 hover:bg-gray-100 rounded disabled:opacity-30">
            <ChevronRight className="w-4 h-4 text-gray-500" />
          </button>
          {!isToday && (
            <button onClick={() => setDate(todayStr())}
              className="text-xs px-2 py-1 bg-emerald-50 text-emerald-700 rounded hover:bg-emerald-100">
              Bugun
            </button>
          )}
        </div>

        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Barcha filiallar</option>
          {(branches || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
        </select>

        {tab === 'service' && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-200 bg-white rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
            <option value="">Barcha holatlar</option>
            <option value="visited">✅ Borildi</option>
            <option value="not_visited">❌ Borilmadi</option>
            <option value="no_gps">📡 GPS yo'q</option>
            <option value="no_polygon">⚠ Polygon yo'q</option>
          </select>
        )}

        {isToday && (
          <span className="ml-auto flex items-center gap-1.5 text-xs text-emerald-600 bg-emerald-50 px-3 py-1.5 rounded-full">
            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
            Bugun — 5 daqiqada yangilanadi
          </span>
        )}
      </div>

      {/* ── Diagnostika banneri ── */}
      {diagnostic && diagnostic.issues?.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold text-amber-800 text-sm">Monitoring nega ishlamayapti?</p>
              <div className="mt-2 space-y-2">

                {diagnostic.issues.includes('no_vehicles') && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-amber-100">
                    <span className="text-gray-700">🚛 Tashkilotda mashina kiritilmagan</span>
                    <button onClick={() => navigate('/toza-hudud')}
                      className="shrink-0 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 font-medium">
                      Mashinalar →
                    </button>
                  </div>
                )}

                {diagnostic.issues.includes('no_mfys') && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-amber-100">
                    <span className="text-gray-700">🏘 MFY (xizmat hududlari) kiritilmagan</span>
                    <button onClick={() => navigate('map')}
                      className="shrink-0 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 font-medium">
                      Xarita →
                    </button>
                  </div>
                )}

                {diagnostic.issues.includes('no_schedules') && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-amber-100">
                    <div>
                      <span className="text-gray-700 font-medium">📋 Haftalik grafik kiritilmagan</span>
                      <p className="text-gray-500 mt-0.5">
                        {diagnostic.vehicleCount} ta mashina, {diagnostic.mfyTotal} ta MFY bor lekin hech qanday jadval yo'q
                      </p>
                    </div>
                    <button onClick={() => navigate('schedule')}
                      className="shrink-0 px-2.5 py-1 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 font-medium">
                      Grafik →
                    </button>
                  </div>
                )}

                {diagnostic.issues.includes('no_today_schedule') && !diagnostic.issues.includes('no_schedules') && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-amber-100">
                    <span className="text-gray-700">📅 Bugun uchun jadval yo'q (jami {diagnostic.scheduleCount} ta jadval bor)</span>
                    <button onClick={() => navigate('schedule')}
                      className="shrink-0 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 font-medium">
                      Grafik →
                    </button>
                  </div>
                )}

                {diagnostic.issues.includes('no_gps_credential') && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-amber-100">
                    <span className="text-gray-700">📡 GPS tizimi ulanmagan — trek olinmaydi</span>
                    <button onClick={() => navigate('settings')}
                      className="shrink-0 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 font-medium">
                      Sozlamalar →
                    </button>
                  </div>
                )}

                {(diagnostic.issues.includes('no_polygons') || diagnostic.issues.includes('many_missing_polygons')) && (
                  <div className="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-3 py-2 border border-amber-100">
                    <span className="text-gray-700">
                      ⬛ {diagnostic.mfyWithoutPolygon} ta MFY da chegara (polygon) yo'q — qamrov hisoblanmaydi
                    </span>
                    <button onClick={() => navigate('map')}
                      className="shrink-0 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-lg hover:bg-amber-200 font-medium">
                      Xarita →
                    </button>
                  </div>
                )}

              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Stats ── */}
      {!statsLoading && stats && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-6 flex-wrap">
            {/* Progress bar */}
            <div className="flex-1 min-w-[200px]">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-semibold text-gray-700">Bajarilish</span>
                <span className={`text-sm font-bold ${
                  completionPct >= 80 ? 'text-emerald-700' :
                  completionPct >= 50 ? 'text-amber-700' : 'text-red-700'
                }`}>{completionPct}%</span>
              </div>
              <div className="h-3 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${
                    completionPct >= 80 ? 'bg-emerald-500' :
                    completionPct >= 50 ? 'bg-amber-400' : 'bg-red-400'
                  }`}
                  style={{ width: `${completionPct}%` }}
                />
              </div>
              <p className="text-xs text-gray-400 mt-1">{stats.visited} / {stats.total} MFY xizmat ko'rsatildi</p>
            </div>

            {/* Stat chips */}
            <div className="flex items-center gap-3 flex-wrap">
              <Chip label="Jami" value={stats.total} color="text-gray-700" bg="bg-gray-50" />
              <Chip label="Borildi" value={stats.visited} color="text-emerald-700" bg="bg-emerald-50" />
              <Chip label="Borilmadi" value={stats.notVisited} color="text-red-700" bg="bg-red-50" />
              <Chip label="GPS yo'q" value={stats.noGps} color="text-gray-500" bg="bg-gray-100" />
              <Chip label="Shubhali" value={stats.suspicious} color="text-orange-700" bg="bg-orange-50" />
              <Chip label="Poligon" value={stats.landfillTrips} color="text-blue-700" bg="bg-blue-50" icon={<MapPin className="w-3 h-3" />} />
            </div>
          </div>
        </div>
      )}

      {/* ── Tabs ── */}
      <div className="flex items-center gap-1 bg-gray-100 rounded-xl p-1 w-fit">
        {(['service', 'landfill', 'container'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors ${
              tab === t ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'service' ? '🗺 Xizmat ko\'rsatish'
             : t === 'landfill' ? '🏭 Poligon tashriflari'
             : '🗑 Konteynerlar'}
          </button>
        ))}
      </div>

      {/* ── Service trips ── */}
      {tab === 'service' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Table header bar */}
          <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100 gap-3 flex-wrap">
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
              <input
                value={vehicleSearch} onChange={e => setVehicleSearch(e.target.value)}
                placeholder="Mashina yoki MFY qidirish..."
                className="pl-8 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-400 w-52"
              />
            </div>
            <div className="flex items-center gap-2">
              {serviceTrips && (
                <span className="text-xs text-gray-400">{filteredTrips.length} ta yozuv</span>
              )}
              <a
                href={`/api/th/reports/daily/excel?date=${date}${branchFilter ? `&branchId=${branchFilter}` : ''}`}
                target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-emerald-700 bg-emerald-50 hover:bg-emerald-100 rounded-lg transition-colors"
              >
                <Download className="w-3.5 h-3.5" /> Excel
              </a>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 text-left font-semibold">Mashina</th>
                  <th className="px-4 py-3 text-left font-semibold">MFY / Tuman</th>
                  <th className="px-4 py-3 text-left font-semibold">Holat</th>
                  <th className="px-4 py-3 text-left font-semibold">Qamrov</th>
                  <th className="px-4 py-3 text-left font-semibold">Kirdi</th>
                  <th className="px-4 py-3 text-left font-semibold">Chiqdi</th>
                  <th className="px-4 py-3 text-left font-semibold">Davom</th>
                  <th className="px-4 py-3 text-left font-semibold">Tezlik</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {tripsLoading && (
                  <tr><td colSpan={8} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2 text-gray-400">
                      <RefreshCw className="w-6 h-6 animate-spin" />
                      <span className="text-sm">Yuklanmoqda...</span>
                    </div>
                  </td></tr>
                )}
                {!tripsLoading && filteredTrips.length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-14 text-center">
                    <div className="flex flex-col items-center gap-3">
                      <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center">
                        <MapPin className="w-7 h-7 text-gray-300" />
                      </div>
                      <div>
                        <p className="font-medium text-gray-600">{fmtDate(date)} uchun ma'lumot yo'q</p>
                        <p className="text-xs text-gray-400 mt-1">
                          "GPS tahlil qilish" tugmasini bosing yoki boshqa sanani tanlang
                        </p>
                      </div>
                    </div>
                  </td></tr>
                )}
                {filteredTrips.map((trip: any) => {
                  const cfg = STATUS_CONFIG[trip.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.no_gps
                  const Icon = cfg.icon
                  const dur = fmtDur(trip.enteredAt, trip.exitedAt)
                  return (
                    <tr key={trip.id} className={`hover:bg-gray-50/80 transition-colors ${cfg.row}`}>
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-bold text-gray-800 tracking-wide">
                          {trip.vehicle?.registrationNumber || '—'}
                        </p>
                        <p className="text-[11px] text-gray-400">{trip.vehicle?.brand} {trip.vehicle?.model}</p>
                      </td>
                      <td className="px-4 py-3 max-w-[180px]">
                        <p className="text-gray-800 font-medium truncate">{trip.mfy?.name || '—'}</p>
                        <p className="text-[11px] text-gray-400 truncate">{trip.mfy?.district?.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1 px-2 py-1 rounded-full text-[11px] font-semibold ${cfg.cls}`}>
                          <Icon className="w-3 h-3" />
                          {cfg.label}
                        </span>
                        {trip.suspicious && (
                          <span className="ml-1.5 text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">⚠ shubhali</span>
                        )}
                      </td>
                      <td className="px-4 py-3"><CoverageBar pct={trip.coveragePct ?? null} /></td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums text-xs">{fmtTime(trip.enteredAt)}</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums text-xs">{fmtTime(trip.exitedAt)}</td>
                      <td className="px-4 py-3 text-gray-500 text-xs">{dur || '—'}</td>
                      <td className="px-4 py-3">
                        {trip.maxSpeedKmh ? (
                          <span className={`text-xs font-semibold ${trip.suspicious ? 'text-orange-600' : 'text-gray-600'}`}>
                            {Math.round(trip.maxSpeedKmh)} km/h
                          </span>
                        ) : <span className="text-gray-300">—</span>}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Landfill trips ── */}
      {tab === 'landfill' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 text-left font-semibold">Mashina</th>
                  <th className="px-4 py-3 text-left font-semibold">Chiqindi poligoni</th>
                  <th className="px-4 py-3 text-left font-semibold">Keldi</th>
                  <th className="px-4 py-3 text-left font-semibold">Ketdi</th>
                  <th className="px-4 py-3 text-left font-semibold">Turdi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {landfillLoading && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400 text-sm">Yuklanmoqda...</td></tr>
                )}
                {!landfillLoading && (landfillTrips || []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Trash2 className="w-8 h-8 text-gray-200" />
                      <p className="text-sm text-gray-500">Bu sanada poligonga tashrif qayd etilmadi</p>
                    </div>
                  </td></tr>
                )}
                {(landfillTrips || []).map((trip: any) => (
                  <tr key={trip.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-bold text-gray-800">{trip.vehicle?.registrationNumber || '—'}</p>
                      <p className="text-[11px] text-gray-400">{trip.vehicle?.brand} {trip.vehicle?.model}</p>
                    </td>
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 text-gray-700 font-medium">
                        <MapPin className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                        {trip.landfill?.name || '—'}
                      </span>
                      {trip.landfill?.location && (
                        <p className="text-[11px] text-gray-400 mt-0.5 ml-5">{trip.landfill.location}</p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums text-xs">{fmtTime(trip.arrivedAt)}</td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums text-xs">{fmtTime(trip.leftAt)}</td>
                    <td className="px-4 py-3">
                      {trip.durationMin != null ? (
                        <span className="text-xs font-semibold text-blue-700 bg-blue-50 px-2 py-0.5 rounded-full">
                          {trip.durationMin} daq
                        </span>
                      ) : <span className="text-gray-300">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* ── Container visits ── */}
      {tab === 'container' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[480px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200 text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-3 text-left font-semibold">Konteyner</th>
                  <th className="px-4 py-3 text-left font-semibold">MFY</th>
                  <th className="px-4 py-3 text-center font-semibold">Tashriflar</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {containerLoading && (
                  <tr><td colSpan={3} className="px-4 py-10 text-center text-gray-400 text-sm">Yuklanmoqda...</td></tr>
                )}
                {!containerLoading && (containerStats || []).length === 0 && (
                  <tr><td colSpan={3} className="px-4 py-12 text-center">
                    <div className="flex flex-col items-center gap-2">
                      <Trash2 className="w-8 h-8 text-gray-200" />
                      <p className="text-sm text-gray-500">Bu sanada konteynerga tashrif qayd etilmadi</p>
                    </div>
                  </td></tr>
                )}
                {(containerStats || []).map((row: any) => (
                  <tr key={row.container?.id} className="hover:bg-gray-50/80">
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-1.5 font-medium text-gray-800">
                        <span className="text-base">🗑</span>
                        {row.container?.name || '—'}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500 text-xs">
                      {row.container?.mfy?.name
                        ? <span className="bg-gray-100 px-2 py-0.5 rounded-full">{row.container.mfy.name}</span>
                        : <span className="text-gray-300 italic">biriktirilmagan</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className="inline-flex items-center justify-center w-9 h-9 rounded-full bg-violet-100 text-violet-700 font-bold text-sm">
                        {row.visitCount}
                      </span>
                    </td>
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

function Chip({ label, value, color, bg, icon }: {
  label: string; value: number; color: string; bg: string; icon?: React.ReactNode
}) {
  return (
    <div className={`${bg} rounded-lg px-3 py-2 text-center min-w-[64px]`}>
      <div className={`flex items-center justify-center gap-1 text-xl font-bold ${color}`}>
        {icon}{value ?? 0}
      </div>
      <p className="text-[11px] text-gray-500 mt-0.5 whitespace-nowrap">{label}</p>
    </div>
  )
}
