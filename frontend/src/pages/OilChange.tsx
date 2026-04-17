import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Droplets, CheckCircle, AlertTriangle, XCircle, HelpCircle, RefreshCw, Save, Edit2, X, Check, TrendingUp, BarChart2 } from 'lucide-react'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import Button from '../components/ui/Button'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'

interface OilVehicle {
  id: string
  registrationNumber: string
  brand: string
  model: string
  fuelType: string
  currentKm: number
  lastGpsSignal: string | null
  oilIntervalKm: number | null
  effectiveIntervalKm: number
  intervalId: string | null
  lastServiceKm: number | null
  lastServiceDate: string | null
  nextDueKm: number | null
  remainingKm: number | null
  percentUsed: number | null
  status: 'ok' | 'due_soon' | 'overdue' | 'no_data'
  firstGpsKm: number | null
}

interface OilOverview {
  vehicles: OilVehicle[]
  defaults: { oilIntervalKm: number; oilWarningKm: number }
  summary: { total: number; ok: number; due_soon: number; overdue: number; no_data: number }
}

interface KmAtDateResult {
  found: boolean
  kmAtDate: number
  logDate: string | null
  currentKm: number
  kmTraveled: number
  note: string | null
  gpsLinked?: boolean
  skipReason?: string | null
}

interface MileageReport {
  vehicleId: string
  registrationNumber: string
  from: string
  to: string
  totalKm: number
  startKm: number | null
  endKm: number | null
  days: { date: string; km: number }[]
  syncCount: number
}

const STATUS_CONFIG = {
  ok:        { label: 'Yaxshi',          color: 'text-green-600 bg-green-50 dark:bg-green-900/20',   dot: 'bg-green-500',  icon: CheckCircle },
  due_soon:  { label: 'Tez almashish',   color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20', dot: 'bg-yellow-500', icon: AlertTriangle },
  overdue:   { label: "Muddati o'tgan", color: 'text-red-600 bg-red-50 dark:bg-red-900/20',         dot: 'bg-red-500',    icon: XCircle },
  no_data:   { label: 'Sozlanmagan',     color: 'text-gray-500 bg-gray-50 dark:bg-gray-800',          dot: 'bg-gray-400',   icon: HelpCircle },
}

function ProgressBar({ percent, status }: { percent: number | null; status: string }) {
  if (percent === null) return <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full" />
  const color = status === 'overdue' ? 'bg-red-500' : status === 'due_soon' ? 'bg-yellow-500' : 'bg-green-500'
  return (
    <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, percent)}%` }} />
    </div>
  )
}

function StatCard({ label, value, color, sub }: { label: string; value: number; color: string; sub?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="text-xs text-gray-400 mb-1">{label}</div>
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}


/** Mashina km hisobot modal */
function VehicleReportModal({ vehicle, onClose }: { vehicle: OilVehicle; onClose: () => void }) {
  const today = new Date().toISOString().slice(0, 10)
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10)
  const [from, setFrom] = useState(thirtyDaysAgo)
  const [to, setTo] = useState(today)
  const [report, setReport] = useState<MileageReport | null>(null)
  const [loading, setLoading] = useState(false)

  async function fetchReport() {
    setLoading(true)
    try {
      const r = await api.get('/oil-change/vehicle-report', { params: { vehicleId: vehicle.id, from, to } })
      setReport(r.data)
    } catch {
      toast.error('Hisobot olinmadi')
    } finally {
      setLoading(false)
    }
  }

  const maxDailyKm = report ? Math.max(...report.days.map(d => d.km), 1) : 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
        <div className="px-6 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white flex items-center gap-2">
              <BarChart2 className="w-5 h-5 text-blue-500" />
              GPS Km Hisobot — {vehicle.registrationNumber}
            </h3>
            <p className="text-xs text-gray-400 mt-0.5">{vehicle.brand} {vehicle.model}</p>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-4 h-4 text-gray-400" />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Date range */}
          <div className="flex items-center gap-3 flex-wrap">
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Dan:</label>
              <input type="date" value={from} max={to} onChange={e => setFrom(e.target.value)}
                className="text-sm px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs text-gray-500">Gacha:</label>
              <input type="date" value={to} min={from} max={today} onChange={e => setTo(e.target.value)}
                className="text-sm px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <Button variant="primary" onClick={fetchReport} loading={loading} icon={<TrendingUp className="w-4 h-4" />}>
              Hisobot
            </Button>
          </div>

          {report && (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-3 text-center">
                  <div className="text-xs text-blue-500 mb-1">Jami yurgan</div>
                  <div className="text-xl font-bold text-blue-700 dark:text-blue-300">{report.totalKm.toLocaleString()} km</div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
                  <div className="text-xs text-gray-400 mb-1">Boshlanish km</div>
                  <div className="text-lg font-bold text-gray-700 dark:text-gray-200">
                    {report.startKm != null ? report.startKm.toLocaleString() : '—'}
                  </div>
                </div>
                <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 text-center">
                  <div className="text-xs text-gray-400 mb-1">Tugash km</div>
                  <div className="text-lg font-bold text-gray-700 dark:text-gray-200">
                    {report.endKm != null ? report.endKm.toLocaleString() : '—'}
                  </div>
                </div>
              </div>

              {/* Info */}
              {report.days.length === 0 ? (
                <div className="py-8 text-center text-gray-400 text-sm">Bu davr uchun GPS ma'lumoti yo'q</div>
              ) : (
                <>
                  <div className="text-xs text-gray-400">{report.syncCount} ta GPS sync · {report.days.length} kun</div>
                  {/* Bar chart — simple CSS */}
                  <div className="space-y-1 max-h-72 overflow-y-auto">
                    {report.days.map(d => (
                      <div key={d.date} className="flex items-center gap-2">
                        <div className="text-xs text-gray-400 w-20 flex-shrink-0">{d.date.slice(5)}</div>
                        <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-4 overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full flex items-center pl-2 transition-all"
                            style={{ width: `${Math.max(4, (d.km / maxDailyKm) * 100)}%` }}
                          >
                            {d.km > 10 && <span className="text-white text-xs font-medium">{d.km}</span>}
                          </div>
                        </div>
                        <div className="text-xs font-medium text-gray-700 dark:text-gray-200 w-16 text-right flex-shrink-0">
                          {d.km.toLocaleString()} km
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </>
          )}

          {!report && !loading && (
            <div className="py-10 text-center text-gray-400 text-sm">
              <BarChart2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
              Sana oralig'ini tanlang va "Hisobot" tugmasini bosing
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function OilChange() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const canEdit = hasRole('admin', 'super_admin', 'manager', 'branch_manager')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [branchFilter, setBranchFilter] = useState('')
  const [editingDefaults, setEditingDefaults] = useState(false)
  const [defaultKm, setDefaultKm] = useState('')
  const [defaultWarning, setDefaultWarning] = useState('')

  // Per-row edit state
  const [rowEdits, setRowEdits] = useState<Record<string, { lastServiceDate: string; intervalKm: string; dirty: boolean }>>({})
  // Sana tanlanganida live GPS preview
  const [liveGps, setLiveGps] = useState<Record<string, { loading: boolean; gpsKm: number; remaining: number | null }>>({})
  // Record oil change
  const [recordingId, setRecordingId] = useState<string | null>(null)
  const [recordKm, setRecordKm] = useState('')
  const [recordDate, setRecordDate] = useState(new Date().toISOString().slice(0, 10))
  // GPS report modal
  const [reportVehicle, setReportVehicle] = useState<OilVehicle | null>(null)

  const { data, isLoading, refetch } = useQuery<OilOverview>({
    queryKey: ['oil-overview', branchFilter],
    queryFn: () => api.get('/oil-change/overview', { params: { branchId: branchFilter || undefined } }).then(r => r.data),
    staleTime: 60000,
  })

  const { data: branchesData } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
    enabled: hasRole('admin', 'super_admin', 'manager'),
  })

  const { data: settings } = useQuery({
    queryKey: ['oil-settings'],
    queryFn: () => api.get('/oil-change/settings').then(r => r.data),
  })

  const saveSettingsMut = useMutation({
    mutationFn: (body: any) => api.post('/oil-change/settings', body).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oil-settings'] })
      qc.invalidateQueries({ queryKey: ['oil-overview'] })
      setEditingDefaults(false)
      toast.success('Standart interval saqlandi')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const bulkMut = useMutation({
    mutationFn: (items: any[]) => api.post('/oil-change/bulk-setup', { items }).then(r => r.data),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['oil-overview'] })
      setRowEdits({})
      setLiveGps({})
      toast.success(`${d.saved} ta mashina saqlandi`)
    },
    onError: () => toast.error('Xato yuz berdi'),
  })

  const recordMut = useMutation({
    mutationFn: (body: any) => api.post('/oil-change/record', body).then(r => r.data),
    onSuccess: (d) => {
      qc.invalidateQueries({ queryKey: ['oil-overview'] })
      setRecordingId(null)
      setRecordKm('')
      toast.success(`Moy almashuvi qayd qilindi. Keyingi: ${d.nextDueKm?.toLocaleString()} km`)
    },
    onError: () => toast.error('Xato yuz berdi'),
  })

  const vehicles = data?.vehicles ?? []
  const summary = data?.summary ?? { total: 0, ok: 0, due_soon: 0, overdue: 0, no_data: 0 }
  const defaults = settings ?? data?.defaults ?? { oilIntervalKm: 7000, oilWarningKm: 500 }

  const filtered = useMemo(() => vehicles.filter(v => {
    if (statusFilter !== 'all' && v.status !== statusFilter) return false
    const q = search.toLowerCase()
    return v.registrationNumber.toLowerCase().includes(q) || v.brand.toLowerCase().includes(q) || v.model.toLowerCase().includes(q)
  }), [vehicles, search, statusFilter])

  const dirtyItems = Object.entries(rowEdits)
    .filter(([, e]) => e.dirty)
    .filter(([, e]) => {
      if (e.intervalKm) {
        const iv = Number(e.intervalKm)
        if (iv < 500 || iv > 50000) return false
      }
      return true
    })
    .map(([vehicleId, e]) => ({
      vehicleId,
      lastServiceDate: e.lastServiceDate || undefined,
      intervalKm: e.intervalKm || undefined,
    }))

  function getRowEdit(v: OilVehicle) {
    return rowEdits[v.id] ?? {
      lastServiceDate: v.lastServiceDate ? v.lastServiceDate.slice(0, 10) : '',
      intervalKm: v.oilIntervalKm != null ? String(v.oilIntervalKm) : '',
      dirty: false,
    }
  }

  async function updateRowEdit(vehicleId: string, field: 'lastServiceDate' | 'intervalKm', value: string) {
    const cur = rowEdits[vehicleId] ?? getRowEdit({ id: vehicleId } as any)
    setRowEdits(prev => ({ ...prev, [vehicleId]: { ...cur, [field]: value, dirty: true } }))

    if (field === 'lastServiceDate') {
      if (!value) {
        setLiveGps(prev => { const n = { ...prev }; delete n[vehicleId]; return n })
        return
      }
      setLiveGps(prev => ({ ...prev, [vehicleId]: { loading: true, gpsKm: 0, remaining: null } }))
      try {
        const r = await api.get('/oil-change/km-at-date', { params: { vehicleId, date: value } })
        const gpsKm: number = r.data.kmTraveled ?? 0
        const ivKm = Number(cur.intervalKm) || defaults.oilIntervalKm
        const remaining = gpsKm > 0 ? ivKm - gpsKm : null
        setLiveGps(prev => ({ ...prev, [vehicleId]: { loading: false, gpsKm, remaining } }))
      } catch {
        setLiveGps(prev => ({ ...prev, [vehicleId]: { loading: false, gpsKm: 0, remaining: null } }))
      }
    }
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Droplets className="w-7 h-7 text-amber-500" />
            Motor Yog'i Nazorati
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            GPS km ga asoslangan moy almashtirish nazorati
          </p>
        </div>
        <div className="flex items-center gap-2">
          {dirtyItems.length > 0 && (
            <Button variant="primary" icon={<Save className="w-4 h-4" />}
              onClick={() => bulkMut.mutate(dirtyItems)} loading={bulkMut.isPending}>
              {dirtyItems.length} ta saqlash
            </Button>
          )}
          <button onClick={() => refetch()} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <RefreshCw className="w-4 h-4 text-gray-400" />
          </button>
        </div>
      </div>

      {/* Org Default */}
      <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <Droplets className="w-5 h-5 text-amber-600 flex-shrink-0" />
            <div>
              <div className="text-sm font-medium text-amber-800 dark:text-amber-200">Tashkilot standarti</div>
              {editingDefaults ? (
                <div className="flex items-center gap-2 mt-1">
                  <input type="number" value={defaultKm} onChange={e => setDefaultKm(e.target.value)}
                    placeholder="km interval (7000)" className="text-sm px-2 py-1 border border-amber-300 rounded-lg w-36 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <input type="number" value={defaultWarning} onChange={e => setDefaultWarning(e.target.value)}
                    placeholder="ogohlantirish (500)" className="text-sm px-2 py-1 border border-amber-300 rounded-lg w-32 dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-amber-400" />
                  <button onClick={() => saveSettingsMut.mutate({ oilIntervalKm: Number(defaultKm), oilWarningKm: Number(defaultWarning || 500) })}
                    disabled={!defaultKm || saveSettingsMut.isPending}
                    className="p-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 disabled:opacity-50">
                    <Check className="w-4 h-4" />
                  </button>
                  <button onClick={() => setEditingDefaults(false)} className="p-1.5 rounded-lg hover:bg-amber-200 dark:hover:bg-amber-800 text-amber-700">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="text-xs text-amber-700 dark:text-amber-300">
                  Har <strong>{defaults.oilIntervalKm?.toLocaleString()} km</strong> da moy almashtiriladi ·
                  <strong> {defaults.oilWarningKm} km</strong> qolganda ogohlantirish
                </div>
              )}
            </div>
          </div>
          {!editingDefaults && canEdit && (
            <button onClick={() => { setDefaultKm(String(defaults.oilIntervalKm ?? 7000)); setDefaultWarning(String(defaults.oilWarningKm ?? 500)); setEditingDefaults(true) }}
              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-300 hover:bg-amber-100 dark:hover:bg-amber-900/40 transition-colors">
              <Edit2 className="w-3 h-3" /> O'zgartirish
            </button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <StatCard label="Jami" value={summary.total} color="text-gray-900 dark:text-white" />
        <StatCard label="Yaxshi" value={summary.ok} color="text-green-600" sub="vaqtida almashuv" />
        <StatCard label="Tez almashish" value={summary.due_soon} color="text-yellow-600" sub="< 500 km qoldi" />
        <StatCard label="Muddati o'tgan" value={summary.overdue} color="text-red-600" sub="zudlik bilan!" />
        <StatCard label="Sozlanmagan" value={summary.no_data} color="text-gray-400" sub="km kiritilmagan" />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Mashina qidirish..."
          className="text-sm px-3 py-2 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-52" />
        {branchesData && branchesData.length > 1 && (
          <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setRowEdits({}); setLiveGps({}) }}
            className="text-sm px-3 py-2 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha filiallar</option>
            {branchesData.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        )}
        <div className="flex gap-1 flex-wrap">
          {(['all', 'overdue', 'due_soon', 'ok', 'no_data'] as const).map(s => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 text-xs rounded-lg border transition-colors font-medium ${statusFilter === s ? 'bg-blue-600 text-white border-blue-600' : 'border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
              {s === 'all' ? 'Barchasi' : STATUS_CONFIG[s].label}
              {s !== 'all' && summary[s] > 0 && <span className="ml-1 font-bold">{summary[s]}</span>}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-3.5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Mashinalar bo'yicha holat</h2>
            <p className="text-xs text-gray-400 mt-0.5">
              Moy almashgan sanani kiriting — GPS avtomatik hisoblab qolgan km ni ko'rsatadi
            </p>
          </div>
          {dirtyItems.length > 0 && (
            <span className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-1 rounded-lg">
              {dirtyItems.length} ta o'zgartirildi
            </span>
          )}
        </div>

        {isLoading ? (
          <div className="py-16 flex justify-center">
            <div className="w-8 h-8 border-4 border-amber-400 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            <Droplets className="w-10 h-10 mx-auto mb-3 opacity-30" />Mashina topilmadi
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 pb-3 pt-2 font-medium">Mashina</th>
                  <th className="pb-3 pt-2 pr-4 font-medium">Hozirgi km</th>
                  <th className="pb-3 pt-2 pr-4 font-medium">Oxirgi moy sana</th>
                  <th className="pb-3 pt-2 pr-4 font-medium">Interval</th>
                  <th className="pb-3 pt-2 pr-4 font-medium">Qolgan</th>
                  <th className="pb-3 pt-2 pr-4 font-medium w-28">Holat</th>
                  <th className="pb-3 pt-2 pr-5 font-medium text-right">Amal</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(v => {
                  const cfg = STATUS_CONFIG[v.status]
                  const edit = getRowEdit(v)
                  const isRecording = recordingId === v.id

                  return (
                    <tr key={v.id} className={`border-b border-gray-50 dark:border-gray-800 ${edit.dirty ? 'bg-blue-50/30 dark:bg-blue-900/10' : 'hover:bg-gray-50/50 dark:hover:bg-gray-800/50'}`}>
                      {/* Mashina */}
                      <td className="px-5 py-3">
                        <Link to={`/vehicles/${v.id}`} className="font-medium text-blue-600 hover:underline text-sm">
                          {v.registrationNumber}
                        </Link>
                        <div className="text-xs text-gray-400">{v.brand} {v.model}</div>
                        {/* GPS hisobot tugmasi */}
                        <button
                          onClick={() => setReportVehicle(v)}
                          className="mt-0.5 text-xs text-blue-500 hover:text-blue-700 flex items-center gap-0.5"
                        >
                          <BarChart2 className="w-3 h-3" /> GPS hisobot
                        </button>
                      </td>
                      {/* Hozirgi km */}
                      <td className="py-3 pr-4">
                        <div className="text-sm font-medium text-gray-900 dark:text-white">{v.currentKm.toLocaleString()} km</div>
                        {v.lastGpsSignal && (
                          <div className="text-xs text-gray-400">
                            {new Date(v.lastGpsSignal).toLocaleDateString('uz-UZ')}
                          </div>
                        )}
                      </td>
                      {/* Oxirgi moy sana */}
                      <td className="py-3 pr-4">
                        <input
                          type="date"
                          value={edit.lastServiceDate}
                          max={new Date().toISOString().slice(0, 10)}
                          onChange={e => updateRowEdit(v.id, 'lastServiceDate', e.target.value)}
                          disabled={!canEdit}
                          className="text-xs px-2 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-amber-400 disabled:opacity-50"
                        />
                      </td>
                      {/* Interval */}
                      <td className="py-3 pr-4">
                        {(() => {
                          const iv = Number(edit.intervalKm)
                          const ivInvalid = edit.intervalKm !== '' && (iv < 500 || iv > 50000)
                          return (
                            <div>
                              <input
                                type="number"
                                value={edit.intervalKm}
                                onChange={e => updateRowEdit(v.id, 'intervalKm', e.target.value)}
                                disabled={!canEdit}
                                min={500} max={50000}
                                placeholder={`${defaults.oilIntervalKm}`}
                                className={`text-xs px-2 py-1.5 border rounded-lg w-24 focus:outline-none focus:ring-2 disabled:opacity-50 dark:bg-gray-700 dark:text-white ${ivInvalid ? 'border-red-400 focus:ring-red-400' : 'border-gray-200 dark:border-gray-600 focus:ring-amber-400'}`}
                              />
                              {ivInvalid && <div className="text-xs text-red-500 mt-0.5">500–50 000 km</div>}
                            </div>
                          )
                        })()}
                      </td>
                      {/* Qolgan km — live preview yoki DB qiymati */}
                      <td className="py-3 pr-4 min-w-[100px]">
                        {(() => {
                          const live = edit.dirty ? liveGps[v.id] : undefined
                          if (live?.loading) return (
                            <div className="flex items-center gap-1 text-xs text-blue-500">
                              <RefreshCw className="w-3 h-3 animate-spin" /> GPS...
                            </div>
                          )
                          const rem = live ? live.remaining : v.remainingKm
                          const pct = live ? null : v.percentUsed
                          const st = live
                            ? (live.remaining === null ? 'no_data' : live.remaining < 0 ? 'overdue' : live.remaining < 500 ? 'due_soon' : 'ok')
                            : v.status
                          if (rem !== null) return (
                            <div>
                              <div className={`text-sm font-semibold ${rem < 0 ? 'text-red-600' : rem < 500 ? 'text-yellow-600' : 'text-gray-900 dark:text-white'}`}>
                                {rem < 0
                                  ? `+${Math.abs(rem).toLocaleString()} km o'tgan`
                                  : `${rem.toLocaleString()} km`}
                              </div>
                              {live && live.gpsKm > 0 && (
                                <div className="text-xs text-blue-500">{live.gpsKm.toLocaleString()} km yurgan</div>
                              )}
                              {!live && <ProgressBar percent={pct} status={st} />}
                            </div>
                          )
                          return <span className="text-xs text-gray-400">—</span>
                        })()}
                      </td>
                      {/* Holat */}
                      <td className="py-3 pr-4">
                        <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                          {cfg.label}
                        </span>
                      </td>
                      {/* Amal */}
                      <td className="py-3 pr-5 text-right">
                        {canEdit && (
                          isRecording ? (
                            <div className="flex flex-col items-end gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <input type="number" autoFocus value={recordKm} onChange={e => setRecordKm(e.target.value)}
                                  placeholder={String(v.currentKm)} className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg w-24 focus:outline-none focus:ring-1 focus:ring-amber-400" />
                                <button
                                  onClick={() => recordMut.mutate({ vehicleId: v.id, servicedAtKm: recordKm ? Number(recordKm) : undefined, servicedAt: recordDate || undefined })}
                                  disabled={recordMut.isPending}
                                  className="px-2 py-1 bg-amber-500 text-white text-xs rounded-lg hover:bg-amber-600 disabled:opacity-50">
                                  <Check className="w-3 h-3" />
                                </button>
                                <button onClick={() => { setRecordingId(null); setRecordKm('') }} className="p-1 text-gray-400 hover:text-gray-600">
                                  <X className="w-3 h-3" />
                                </button>
                              </div>
                              <input type="date" value={recordDate} max={new Date().toISOString().slice(0, 10)} onChange={e => setRecordDate(e.target.value)}
                                className="text-xs px-2 py-1 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg w-32 focus:outline-none" />
                            </div>
                          ) : (
                            <button
                              onClick={() => { setRecordingId(v.id); setRecordKm(v.currentKm > 0 ? String(v.currentKm) : ''); setRecordDate(new Date().toISOString().slice(0, 10)) }}
                              className="text-xs px-3 py-1.5 rounded-lg border border-amber-300 text-amber-700 dark:text-amber-400 hover:bg-amber-50 dark:hover:bg-amber-900/20 transition-colors flex items-center gap-1.5 ml-auto">
                              <Droplets className="w-3 h-3" /> Moy almashildi
                            </button>
                          )
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Help */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 text-sm text-blue-700 dark:text-blue-300">
        <div className="font-medium mb-1">Qanday foydalanish?</div>
        <ul className="text-xs space-y-1 list-disc list-inside">
          <li><strong>Moy sana:</strong> Oxirgi moy almashgan sanani kiriting va "N ta saqlash" tugmasini bosing — GPS o'sha sanadan bugunga qadar yurgan km ni avtomatik hisoblab qolgan km ni ko'rsatadi</li>
          <li><strong>GPS hisobot:</strong> Har bir mashina ostidagi "GPS hisobot" havolasini bosib sana oralig'i bo'yicha km ko'ring</li>
          <li><strong>Moy almashildi:</strong> Hozir moy almashdingizmi? Tugmani bosib joriy km va sanani kiriting</li>
        </ul>
      </div>

      {/* GPS Report Modal */}
      {reportVehicle && (
        <VehicleReportModal vehicle={reportVehicle} onClose={() => setReportVehicle(null)} />
      )}
    </div>
  )
}
