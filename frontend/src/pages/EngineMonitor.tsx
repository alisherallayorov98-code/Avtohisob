import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Cpu, TrendingUp, TrendingDown, Minus, AlertTriangle, CheckCircle, XCircle, RefreshCw, ChevronDown, ChevronUp } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'

interface MonthlyTrend {
  month: string
  cost: number
  liters: number
  count: number
}

interface VehicleStat {
  vehicle: { id: string; registrationNumber: string; brand: string; model: string; mileage: number }
  oilRecordsCount: number
  totalOilCost12m: number
  totalOilLiters12m: number
  monthlyTrend: MonthlyTrend[]
  trendPct: number
  lastOverhaul: { date: string; mileage: number } | null
  repairCount12m: number
  fatigueLevel: 'ok' | 'warning' | 'critical'
  fatigueScore: number
  recentEngineRecords: Array<{
    id: string; recordType: string; mileage: number; date: string
    description: string; cost: number; nextServiceMileage: number | null; performedBy: string | null
  }>
}

const FATIGUE_CONFIG = {
  ok:       { label: "Yaxshi",           bg: 'bg-emerald-50',  text: 'text-emerald-700', border: 'border-emerald-200', dot: 'bg-emerald-500' },
  warning:  { label: "Kuzatuv kerak",    bg: 'bg-amber-50',    text: 'text-amber-700',   border: 'border-amber-200',   dot: 'bg-amber-500'   },
  critical: { label: "Charchagan!",      bg: 'bg-red-50',      text: 'text-red-700',     border: 'border-red-200',     dot: 'bg-red-500'     },
}

const TYPE_LABELS: Record<string, string> = {
  overhaul: 'Kapital remont',
  major_repair: "Yirik ta'mirat",
  minor_repair: "Kichik ta'mirat",
  inspection: 'Texnik ko\'rik',
}

function MiniSparkLine({ trend }: { trend: MonthlyTrend[] }) {
  if (trend.length < 2) return <span className="text-xs text-gray-300">— ma'lumot yo'q</span>
  const max = Math.max(...trend.map(t => t.cost), 1)
  return (
    <div className="flex items-end gap-0.5 h-8">
      {trend.slice(-8).map((t, i) => {
        const h = Math.max(3, Math.round(t.cost / max * 32))
        const color = t.cost > max * 0.7 ? 'bg-red-400' : t.cost > max * 0.4 ? 'bg-amber-400' : 'bg-emerald-400'
        return (
          <div key={i} className={`w-3 rounded-sm ${color}`} style={{ height: `${h}px` }}
            title={`${t.month}: ${t.cost.toLocaleString()} so'm`} />
        )
      })}
    </div>
  )
}

function VehicleCard({ stat }: { stat: VehicleStat }) {
  const [expanded, setExpanded] = useState(false)
  const cfg = FATIGUE_CONFIG[stat.fatigueLevel]
  const trendIcon = stat.trendPct > 10
    ? <TrendingUp className="w-3.5 h-3.5 text-red-500" />
    : stat.trendPct < -10
    ? <TrendingDown className="w-3.5 h-3.5 text-emerald-500" />
    : <Minus className="w-3.5 h-3.5 text-gray-400" />

  return (
    <div className={`bg-white rounded-xl border ${cfg.border} overflow-hidden`}>
      {/* Header */}
      <div
        className={`flex items-center justify-between px-4 py-3 cursor-pointer hover:opacity-90 ${cfg.bg}`}
        onClick={() => setExpanded(v => !v)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${cfg.dot}`} />
          <div className="min-w-0">
            <p className="font-mono font-bold text-gray-900">{stat.vehicle.registrationNumber}</p>
            <p className="text-xs text-gray-500 truncate">{stat.vehicle.brand} {stat.vehicle.model}</p>
          </div>
          <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${cfg.bg} ${cfg.text} border ${cfg.border} shrink-0`}>
            {cfg.label}
          </span>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <div className="hidden sm:flex items-center gap-1 text-xs text-gray-600">
            {trendIcon}
            <span className={stat.trendPct > 10 ? 'text-red-600 font-semibold' : stat.trendPct < -10 ? 'text-emerald-600' : 'text-gray-500'}>
              {stat.trendPct > 0 ? '+' : ''}{stat.trendPct}%
            </span>
          </div>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-px bg-gray-100">
        {[
          { label: "Yog' xarajati (12 oy)", value: stat.totalOilCost12m > 0 ? `${stat.totalOilCost12m.toLocaleString()} so'm` : '—' },
          { label: "Yog' hajmi (12 oy)", value: stat.totalOilLiters12m > 0 ? `${stat.totalOilLiters12m} litr` : '—' },
          { label: "Remont (12 oy)", value: stat.repairCount12m > 0 ? `${stat.repairCount12m} ta` : '0' },
          { label: "Oxirgi kapital remont", value: stat.lastOverhaul ? new Date(stat.lastOverhaul.date).toLocaleDateString('uz-UZ') : "Yo'q" },
        ].map((item, i) => (
          <div key={i} className="bg-white px-3 py-2">
            <p className="text-[10px] text-gray-400 uppercase tracking-wide">{item.label}</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">{item.value}</p>
          </div>
        ))}
      </div>

      {/* Expanded: trend + engine records */}
      {expanded && (
        <div className="px-4 py-3 space-y-4 border-t border-gray-100">
          {/* Trend */}
          {stat.monthlyTrend.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Oylik yog' xarajati (so'm)</p>
              <div className="flex items-end gap-1 overflow-x-auto pb-1">
                {stat.monthlyTrend.map((t, i) => {
                  const max = Math.max(...stat.monthlyTrend.map(m => m.cost), 1)
                  const h = Math.max(4, Math.round(t.cost / max * 64))
                  return (
                    <div key={i} className="flex flex-col items-center gap-0.5 shrink-0">
                      <span className="text-[9px] text-gray-400">{t.cost > 0 ? (t.cost / 1000).toFixed(0) + 'k' : ''}</span>
                      <div
                        className={`w-6 rounded-sm ${t.cost > max * 0.7 ? 'bg-red-400' : t.cost > max * 0.4 ? 'bg-amber-400' : 'bg-emerald-400'}`}
                        style={{ height: `${h}px` }}
                        title={`${t.liters > 0 ? t.liters + 'L · ' : ''}${t.cost.toLocaleString()} so'm`}
                      />
                      <span className="text-[9px] text-gray-400">{t.month.slice(5)}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Engine records */}
          {stat.recentEngineRecords.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-gray-600 mb-2">Dvigatel ta'mirlash tarixi</p>
              <div className="space-y-1.5">
                {stat.recentEngineRecords.map(r => (
                  <div key={r.id} className="flex items-start gap-3 text-xs py-1.5 border-b border-gray-50 last:border-0">
                    <div className="shrink-0 mt-0.5">
                      {r.recordType === 'overhaul' ? <XCircle className="w-3.5 h-3.5 text-red-500" />
                        : r.recordType === 'major_repair' ? <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                        : <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="font-medium text-gray-800">{TYPE_LABELS[r.recordType] || r.recordType}</span>
                      <span className="text-gray-400 ml-2">{new Date(r.date).toLocaleDateString('uz-UZ')}</span>
                      {r.performedBy && <span className="text-gray-400 ml-2">· {r.performedBy}</span>}
                      <p className="text-gray-500 truncate">{r.description}</p>
                    </div>
                    <div className="shrink-0 text-right">
                      <p className="text-gray-600 font-medium">{Number(r.mileage).toLocaleString()} km</p>
                      {r.cost > 0 && <p className="text-gray-400">{Number(r.cost).toLocaleString()} so'm</p>}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

export default function EngineMonitor() {
  const qc = useQueryClient()
  const [filter, setFilter] = useState<'all' | 'critical' | 'warning' | 'ok'>('all')
  const [search, setSearch] = useState('')

  const { data: stats, isLoading, refetch } = useQuery<VehicleStat[]>({
    queryKey: ['engine-dashboard'],
    queryFn: () => api.get('/engine-records/dashboard').then(r => r.data.data),
    staleTime: 5 * 60_000,
  })

  const detectMut = useMutation({
    mutationFn: () => api.post('/engine-records/detect-oil'),
    onSuccess: (r) => {
      toast.success(`${r.data.data.updated} ta yog' yozuvi aniqlandi`)
      qc.invalidateQueries({ queryKey: ['engine-dashboard'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const filtered = (stats || []).filter(s => {
    if (filter !== 'all' && s.fatigueLevel !== filter) return false
    if (search) {
      const q = search.toLowerCase()
      return s.vehicle.registrationNumber.toLowerCase().includes(q) ||
        `${s.vehicle.brand} ${s.vehicle.model}`.toLowerCase().includes(q)
    }
    return true
  })

  const summary = stats ? {
    critical: stats.filter(s => s.fatigueLevel === 'critical').length,
    warning: stats.filter(s => s.fatigueLevel === 'warning').length,
    ok: stats.filter(s => s.fatigueLevel === 'ok').length,
  } : null

  return (
    <div className="p-5 space-y-5 max-w-4xl mx-auto">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-800 flex items-center gap-2">
            <Cpu className="w-5 h-5 text-blue-600" /> Dvigatel nazorati
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Yog' sarfi trendi va ta'mirlash tarixi asosida dvigatel holati
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => detectMut.mutate()} disabled={detectMut.isPending}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700 disabled:opacity-50">
            {detectMut.isPending ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Yog'larni aniqlash
          </button>
          <button onClick={() => refetch()}
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-500">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          {([
            { key: 'critical', label: 'Charchagan',    count: summary.critical, bg: 'bg-red-50',     text: 'text-red-700',     border: 'border-red-200'     },
            { key: 'warning',  label: 'Kuzatuv kerak', count: summary.warning,  bg: 'bg-amber-50',   text: 'text-amber-700',   border: 'border-amber-200'   },
            { key: 'ok',       label: 'Yaxshi',        count: summary.ok,       bg: 'bg-emerald-50', text: 'text-emerald-700', border: 'border-emerald-200' },
          ] as const).map(item => (
            <div key={item.key}
              onClick={() => setFilter(f => f === item.key ? 'all' : item.key)}
              className={`${item.bg} border ${item.border} rounded-xl p-3 text-center cursor-pointer hover:opacity-80 transition-opacity ${filter === item.key ? 'ring-2 ring-blue-400' : ''}`}>
              <p className={`text-2xl font-bold ${item.text}`}>{item.count}</p>
              <p className={`text-xs ${item.text} mt-0.5`}>{item.label}</p>
            </div>
          ))}
        </div>
      )}

      {/* Search + filter */}
      <div className="flex gap-2 flex-wrap">
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Mashina raqami yoki nomi..."
          className="flex-1 min-w-40 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
        {filter !== 'all' && (
          <button onClick={() => setFilter('all')}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-600 rounded-lg hover:bg-gray-200">
            Filtrni tozalash ✕
          </button>
        )}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center h-32 text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" /> Yuklanmoqda...
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-10 text-gray-400 text-sm">
          {stats?.length === 0 ? 'Mashina topilmadi' : 'Qidiruv natijasi yo\'q'}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered
            .sort((a, b) => b.fatigueScore - a.fatigueScore)
            .map(s => <VehicleCard key={s.vehicle.id} stat={s} />)}
        </div>
      )}

      <p className="text-xs text-gray-400 text-center">
        Charchaganlik indeksi: yog' sarfi oshishi (&gt;10%) + so'nggi 12 oyda 2+ yirik ta'mirat
      </p>
    </div>
  )
}
