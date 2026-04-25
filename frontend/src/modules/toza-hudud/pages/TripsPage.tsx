import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { CheckCircle2, XCircle, Wifi, AlertTriangle, RefreshCw, Trash2 } from 'lucide-react'
import api from '../../../lib/api'

type Tab = 'service' | 'landfill'

const STATUS_CONFIG = {
  visited:     { label: 'Borildi',        color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle2, dot: 'bg-emerald-500' },
  not_visited: { label: 'Borilmadi',      color: 'bg-red-100 text-red-700',         icon: XCircle,      dot: 'bg-red-500' },
  no_gps:      { label: 'GPS yo\'q',      color: 'bg-gray-100 text-gray-500',       icon: Wifi,         dot: 'bg-gray-400' },
  no_polygon:  { label: 'Polygon yo\'q',  color: 'bg-yellow-100 text-yellow-700',   icon: AlertTriangle,dot: 'bg-yellow-400' },
} as const

function formatTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

function today() {
  return new Date().toISOString().split('T')[0]
}

export default function TripsPage() {
  const qc = useQueryClient()
  const [tab, setTab] = useState<Tab>('service')
  const [date, setDate] = useState(today)
  const [branchFilter, setBranchFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')

  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ['th-service-stats', date, branchFilter],
    queryFn: () => api.get('/th/trips/service/stats', {
      params: { date, branchId: branchFilter || undefined },
    }).then(r => r.data.data),
  })

  const { data: serviceTrips, isLoading: tripsLoading } = useQuery({
    queryKey: ['th-service-trips', date, branchFilter, statusFilter],
    queryFn: () => api.get('/th/trips/service', {
      params: { date, branchId: branchFilter || undefined, status: statusFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'service',
  })

  const { data: landfillTrips, isLoading: landfillLoading } = useQuery({
    queryKey: ['th-landfill-trips', date, branchFilter],
    queryFn: () => api.get('/th/trips/landfills', {
      params: { date, branchId: branchFilter || undefined },
    }).then(r => r.data.data),
    enabled: tab === 'landfill',
  })

  const runMut = useMutation({
    mutationFn: () => api.post('/th/trips/run', null, { params: { date } }),
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`Tahlil tugadi: ${d.analyzed} tahlil qilindi, ${d.noGps} GPS yo'q, ${d.noPolygon} polygon yo'q`)
      qc.invalidateQueries({ queryKey: ['th-service-trips'] })
      qc.invalidateQueries({ queryKey: ['th-service-stats'] })
      qc.invalidateQueries({ queryKey: ['th-landfill-trips'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="p-6 space-y-4 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800">GPS Monitoring</h1>
          <p className="text-sm text-gray-500 mt-0.5">Kunlik xizmat ko'rsatish nazorati</p>
        </div>
        <button
          onClick={() => runMut.mutate()}
          disabled={runMut.isPending}
          className="flex items-center gap-2 px-4 py-2 bg-emerald-600 text-white text-sm rounded-lg hover:bg-emerald-700 disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${runMut.isPending ? 'animate-spin' : ''}`} />
          {runMut.isPending ? 'Tahlil qilinmoqda...' : 'GPS tahlil qilish'}
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap items-center">
        <input
          type="date"
          value={date}
          onChange={e => setDate(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500"
        />
        <select value={branchFilter} onChange={e => setBranchFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <option value="">Barcha filiallar</option>
          {(branches || []).map((b: any) => (
            <option key={b.id} value={b.id}>{b.name}</option>
          ))}
        </select>
        {tab === 'service' && (
          <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
            <option value="">Barcha holatlar</option>
            <option value="visited">Borildi</option>
            <option value="not_visited">Borilmadi</option>
            <option value="no_gps">GPS yo'q</option>
            <option value="no_polygon">Polygon yo'q</option>
          </select>
        )}
      </div>

      {/* Stats cards */}
      {!statsLoading && stats && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <StatCard label="Jami" value={stats.total} color="text-gray-700" bg="bg-gray-50" />
          <StatCard label="Borildi" value={stats.visited} color="text-emerald-700" bg="bg-emerald-50" />
          <StatCard label="Borilmadi" value={stats.notVisited} color="text-red-700" bg="bg-red-50" />
          <StatCard label="GPS yo'q" value={stats.noGps} color="text-gray-500" bg="bg-gray-50" />
          <StatCard label="Shubhali" value={stats.suspicious} color="text-orange-700" bg="bg-orange-50" />
          <StatCard label="Poligon tashriflari" value={stats.landfillTrips} color="text-blue-700" bg="bg-blue-50" />
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-gray-200">
        {(['service', 'landfill'] as Tab[]).map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t ? 'border-emerald-600 text-emerald-700' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {t === 'service' ? 'Xizmat ko\'rsatish' : 'Poligon tashriflari'}
          </button>
        ))}
      </div>

      {/* Service trips table */}
      {tab === 'service' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Mashina</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">MFY</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Holat</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Kirdi</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Chiqdi</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Tezlik</th>
                </tr>
              </thead>
              <tbody>
                {tripsLoading && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">Yuklanmoqda...</td></tr>
                )}
                {!tripsLoading && (serviceTrips || []).length === 0 && (
                  <tr><td colSpan={6} className="px-4 py-10 text-center text-gray-400">
                    Ma'lumot yo'q. "GPS tahlil qilish" tugmasini bosing.
                  </td></tr>
                )}
                {(serviceTrips || []).map((trip: any) => {
                  const cfg = STATUS_CONFIG[trip.status as keyof typeof STATUS_CONFIG] || STATUS_CONFIG.no_gps
                  const Icon = cfg.icon
                  return (
                    <tr key={trip.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-medium text-gray-800">
                          {trip.vehicle?.registrationNumber || trip.vehicleId.slice(0, 8)}
                        </p>
                        <p className="text-xs text-gray-400">{trip.vehicle?.brand} {trip.vehicle?.model}</p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-gray-800">{trip.mfy?.name}</p>
                        <p className="text-xs text-gray-400">{trip.mfy?.district?.name}</p>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium ${cfg.color}`}>
                          <Icon className="w-3.5 h-3.5" />
                          {cfg.label}
                          {trip.suspicious && (
                            <span className="ml-1 text-orange-600" title="Tezligi yuqori">⚠</span>
                          )}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{formatTime(trip.enteredAt)}</td>
                      <td className="px-4 py-3 text-gray-600 tabular-nums">{formatTime(trip.exitedAt)}</td>
                      <td className="px-4 py-3">
                        {trip.maxSpeedKmh ? (
                          <span className={`text-sm font-medium ${trip.suspicious ? 'text-orange-600' : 'text-gray-600'}`}>
                            {Math.round(trip.maxSpeedKmh)} km/h
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Landfill trips table */}
      {tab === 'landfill' && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[560px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Mashina</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Poligon</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Keldi</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Ketdi</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Vaqt</th>
                </tr>
              </thead>
              <tbody>
                {landfillLoading && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">Yuklanmoqda...</td></tr>
                )}
                {!landfillLoading && (landfillTrips || []).length === 0 && (
                  <tr><td colSpan={5} className="px-4 py-10 text-center text-gray-400">
                    Poligon tashrifi yo'q.
                  </td></tr>
                )}
                {(landfillTrips || []).map((trip: any) => (
                  <tr key={trip.id} className="border-b border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-3">
                      <p className="font-mono text-xs font-medium text-gray-800">
                        {trip.vehicle?.registrationNumber || trip.vehicleId.slice(0, 8)}
                      </p>
                    </td>
                    <td className="px-4 py-3 text-gray-700">{trip.landfill?.name}</td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums">{formatTime(trip.arrivedAt)}</td>
                    <td className="px-4 py-3 text-gray-600 tabular-nums">{formatTime(trip.leftAt)}</td>
                    <td className="px-4 py-3">
                      {trip.durationMin != null ? (
                        <span className="text-sm text-blue-700 font-medium">{trip.durationMin} daq</span>
                      ) : '—'}
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

function StatCard({ label, value, color, bg }: { label: string; value: number; color: string; bg: string }) {
  return (
    <div className={`${bg} rounded-xl p-4`}>
      <p className={`text-2xl font-bold ${color}`}>{value ?? 0}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  )
}
