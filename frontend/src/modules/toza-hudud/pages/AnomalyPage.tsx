import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, Gauge, Timer, TrendingDown, Eye, RefreshCw, ChevronDown } from 'lucide-react'
import api from '../../../lib/api'
import TrekReplayModal from './TrekReplayModal'

interface AnomalyFlags {
  tooFast?: boolean
  timeTooShort?: boolean
  linearTrack?: boolean
  edgeOnly?: boolean
}

interface TrackPoint {
  lat: number
  lon: number
  ts: number
}

interface AnomalyTrip {
  id: string
  vehicleId: string
  mfyId: string
  date: string
  status: string
  enteredAt: string | null
  exitedAt: string | null
  maxSpeedKmh: number | null
  coveragePct: number | null
  timeInsideMin: number | null
  anomalyFlags: AnomalyFlags | null
  trackSnapshot: TrackPoint[] | null
  suspicious: boolean
  vehicle: { id: string; registrationNumber: string; brand: string; model: string } | null
  mfy: { id: string; name: string; polygon: any; district: { name: string } } | null
}

const FLAG_CFG: Record<string, { label: string; color: string; icon: any }> = {
  tooFast:      { label: 'Juda tez', color: 'bg-red-100 text-red-700',     icon: Gauge },
  timeTooShort: { label: 'Vaqt qisqa', color: 'bg-orange-100 text-orange-700', icon: Timer },
  linearTrack:  { label: 'Chiziqli trek', color: 'bg-purple-100 text-purple-700', icon: TrendingDown },
  edgeOnly:     { label: 'Faqat chegara', color: 'bg-amber-100 text-amber-700',   icon: AlertTriangle },
}

function FlagBadge({ flag }: { flag: string }) {
  const cfg = FLAG_CFG[flag]
  if (!cfg) return null
  const Icon = cfg.icon
  return (
    <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${cfg.color}`}>
      <Icon className="w-2.5 h-2.5" />
      {cfg.label}
    </span>
  )
}

function fmtDate(d: string) {
  return new Date(d).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

const DAYS_OPTIONS = [7, 14, 30, 60]

export default function AnomalyPage() {
  const [days, setDays] = useState(14)
  const [filterFlag, setFilterFlag] = useState<string>('all')
  const [selectedTrip, setSelectedTrip] = useState<AnomalyTrip | null>(null)

  const today = new Date()
  const from = new Date(today)
  from.setUTCDate(from.getUTCDate() - days)
  const fromStr = from.toISOString().slice(0, 10)
  const toStr = today.toISOString().slice(0, 10)

  const { data, isLoading, refetch, isFetching } = useQuery<{ data: AnomalyTrip[] }>({
    queryKey: ['th-anomalies', days],
    queryFn: () => api.get('/th/trips/anomalies', { params: { from: fromStr, to: toStr } }).then(r => r.data),
  })

  const all = data?.data ?? []

  const filtered = filterFlag === 'all'
    ? all
    : all.filter(t => t.anomalyFlags && (t.anomalyFlags as any)[filterFlag] === true)

  // Umumiy statistika
  const stats = {
    total: all.length,
    tooFast: all.filter(t => t.anomalyFlags?.tooFast).length,
    timeTooShort: all.filter(t => t.anomalyFlags?.timeTooShort).length,
    linearTrack: all.filter(t => t.anomalyFlags?.linearTrack).length,
    edgeOnly: all.filter(t => t.anomalyFlags?.edgeOnly).length,
  }

  return (
    <div className="h-full overflow-y-auto p-5 space-y-5 max-w-5xl">
      {/* Sarlavha */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-orange-500" />
            Anomaliyalar
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Shubhali tashriflar — tez yurish, qisqa vaqt, chiziqli trek</p>
        </div>

        <div className="flex items-center gap-2">
          {/* Kunlar filtri */}
          <div className="relative">
            <select
              value={days}
              onChange={e => setDays(Number(e.target.value))}
              className="appearance-none pl-3 pr-7 py-2 text-sm bg-white border border-gray-200 rounded-lg text-gray-700 cursor-pointer hover:border-gray-300"
            >
              {DAYS_OPTIONS.map(d => <option key={d} value={d}>Oxirgi {d} kun</option>)}
            </select>
            <ChevronDown className="w-3.5 h-3.5 text-gray-400 absolute right-2 top-1/2 -translate-y-1/2 pointer-events-none" />
          </div>

          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
            Yangilash
          </button>
        </div>
      </div>

      {/* Statistika kartochkalar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { key: 'tooFast',      label: 'Juda tez',      icon: Gauge,       color: 'text-red-600',    bg: 'bg-red-50',    border: 'border-red-200' },
          { key: 'timeTooShort', label: 'Vaqt qisqa',    icon: Timer,       color: 'text-orange-600', bg: 'bg-orange-50', border: 'border-orange-200' },
          { key: 'linearTrack',  label: 'Chiziqli trek', icon: TrendingDown,color: 'text-purple-600', bg: 'bg-purple-50', border: 'border-purple-200' },
          { key: 'edgeOnly',     label: 'Faqat chegara', icon: AlertTriangle,color: 'text-amber-600', bg: 'bg-amber-50',  border: 'border-amber-200' },
        ].map(({ key, label, icon: Icon, color, bg, border }) => (
          <button
            key={key}
            onClick={() => setFilterFlag(f => f === key ? 'all' : key)}
            className={`${bg} border ${border} rounded-xl p-4 text-left transition-all hover:shadow-sm ${filterFlag === key ? 'ring-2 ring-offset-1 ring-current' : ''}`}
          >
            <div className="flex items-center gap-2 mb-1">
              <Icon className={`w-4 h-4 ${color}`} />
              <span className={`text-2xl font-black ${color}`}>{(stats as any)[key]}</span>
            </div>
            <p className={`text-xs font-medium ${color}`}>{label}</p>
          </button>
        ))}
      </div>

      {/* Jadval */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
          <p className="font-semibold text-sm text-gray-700">
            {filterFlag === 'all' ? 'Barcha anomaliyalar' : FLAG_CFG[filterFlag]?.label}
            <span className="ml-2 text-gray-400 font-normal">({filtered.length} ta)</span>
          </p>
          {filterFlag !== 'all' && (
            <button onClick={() => setFilterFlag('all')} className="text-xs text-gray-400 hover:text-gray-600">
              × Filterni olib tashlash
            </button>
          )}
        </div>

        {isLoading ? (
          <div className="py-12 text-center text-sm text-gray-400 animate-pulse">Yuklanmoqda...</div>
        ) : filtered.length === 0 ? (
          <div className="py-12 text-center">
            <AlertTriangle className="w-8 h-8 text-gray-200 mx-auto mb-2" />
            <p className="text-sm text-gray-400">Bu davr uchun anomaliya topilmadi</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50">
                  <th className="text-left px-4 py-2.5 text-xs font-semibold text-gray-500">Sana</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">Mashina</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">MFY</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Ichida</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500">Tezlik</th>
                  <th className="text-right px-3 py-2.5 text-xs font-semibold text-gray-500 hidden sm:table-cell">Qamrov</th>
                  <th className="text-left px-3 py-2.5 text-xs font-semibold text-gray-500">Sabablar</th>
                  <th className="px-3 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => {
                  const flags = t.anomalyFlags ?? {}
                  const activeFlags = Object.entries(flags).filter(([, v]) => v === true).map(([k]) => k)
                  return (
                    <tr key={t.id} className="border-b border-gray-50 hover:bg-orange-50/30 group">
                      <td className="px-4 py-3 text-xs text-gray-600 whitespace-nowrap">
                        <p>{fmtDate(t.date)}</p>
                        <p className="text-gray-400">{fmtTime(t.enteredAt)}–{fmtTime(t.exitedAt)}</p>
                      </td>
                      <td className="px-3 py-3">
                        <p className="font-medium text-gray-800">{t.vehicle?.registrationNumber ?? '—'}</p>
                        {(t.vehicle?.brand || t.vehicle?.model) && (
                          <p className="text-[10px] text-gray-400">{t.vehicle.brand} {t.vehicle.model}</p>
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <p className="text-gray-700">{t.mfy?.name ?? '—'}</p>
                        <p className="text-[10px] text-gray-400">{t.mfy?.district?.name ?? ''}</p>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`text-sm font-semibold ${(t.timeInsideMin ?? 99) < 3 ? 'text-red-600' : 'text-gray-700'}`}>
                          {t.timeInsideMin != null ? `${t.timeInsideMin} daq` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right">
                        <span className={`text-sm font-semibold ${(t.maxSpeedKmh ?? 0) > 30 ? 'text-red-600' : 'text-gray-700'}`}>
                          {t.maxSpeedKmh != null ? `${Math.round(t.maxSpeedKmh)} km/h` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-right hidden sm:table-cell">
                        <span className={`text-sm font-semibold ${(t.coveragePct ?? 100) < 20 ? 'text-red-600' : 'text-gray-700'}`}>
                          {t.coveragePct != null ? `${t.coveragePct}%` : '—'}
                        </span>
                      </td>
                      <td className="px-3 py-3">
                        <div className="flex flex-wrap gap-1">
                          {activeFlags.map(f => <FlagBadge key={f} flag={f} />)}
                          {activeFlags.length === 0 && <span className="text-gray-300 text-xs">—</span>}
                        </div>
                      </td>
                      <td className="px-3 py-3">
                        <button
                          onClick={() => setSelectedTrip(t)}
                          className="flex items-center gap-1 px-2.5 py-1.5 text-xs text-indigo-600 bg-indigo-50 rounded-lg hover:bg-indigo-100 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap"
                        >
                          <Eye className="w-3 h-3" />
                          Trek
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Trek Replay Modal */}
      {selectedTrip && (
        <TrekReplayModal
          registrationNumber={selectedTrip.vehicle?.registrationNumber ?? '—'}
          mfyName={selectedTrip.mfy?.name ?? '—'}
          date={selectedTrip.date}
          enteredAt={selectedTrip.enteredAt}
          exitedAt={selectedTrip.exitedAt}
          timeInsideMin={selectedTrip.timeInsideMin}
          maxSpeedKmh={selectedTrip.maxSpeedKmh}
          coveragePct={selectedTrip.coveragePct}
          trackSnapshot={selectedTrip.trackSnapshot}
          mfyPolygon={selectedTrip.mfy?.polygon ?? null}
          onClose={() => setSelectedTrip(null)}
        />
      )}
    </div>
  )
}
