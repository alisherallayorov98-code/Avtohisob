import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2, XCircle, AlertTriangle, Truck, Map, CalendarDays, Trash2,
  Clock, RefreshCw, Package, TrendingUp,
} from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import api from '../../../lib/api'

function CoverageRing({ pct }: { pct: number | null }) {
  if (pct === null) return (
    <div className="w-24 h-24 rounded-full border-8 border-gray-200 flex items-center justify-center">
      <span className="text-gray-400 text-sm">—</span>
    </div>
  )
  const color = pct >= 80 ? '#059669' : pct >= 50 ? '#D97706' : '#DC2626'
  const radius = 40
  const circ = 2 * Math.PI * radius
  const offset = circ - (pct / 100) * circ
  return (
    <div className="relative w-24 h-24 flex items-center justify-center">
      <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#E5E7EB" strokeWidth="12" />
        <circle cx="50" cy="50" r={radius} fill="none" stroke={color} strokeWidth="12"
          strokeDasharray={circ} strokeDashoffset={offset}
          strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
      </svg>
      <span className="absolute text-xl font-bold" style={{ color }}>{pct}%</span>
    </div>
  )
}

function StatRow({ icon: Icon, label, value, color }: { icon: any; label: string; value: number; color: string }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <span className="flex-1 text-sm text-gray-600">{label}</span>
      <span className="text-sm font-bold text-gray-800">{value}</span>
    </div>
  )
}

function MetricCard({ label, value, icon: Icon, bg, iconColor, sub }: {
  label: string; value: number | string; icon: any; bg: string; iconColor: string; sub?: string
}) {
  return (
    <div className={`${bg} rounded-xl p-4 flex items-center gap-4`}>
      <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm shrink-0">
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-tight">{label}</p>
        {sub && <p className="text-[10px] text-gray-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  )
}

function nextMonitoringTime(): string {
  const now = new Date()
  const next = new Date()
  next.setUTCHours(15, 0, 0, 0) // 20:00 UZT = 15:00 UTC
  if (now.getUTCHours() >= 15) next.setDate(next.getDate() + 1)
  const diffMs = next.getTime() - now.getTime()
  const h = Math.floor(diffMs / 3600000)
  const m = Math.floor((diffMs % 3600000) / 60000)
  return h > 0 ? `${h} soat ${m} daqiqada` : `${m} daqiqada`
}

export default function DashboardPage() {
  const navigate = useNavigate()

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['th-dashboard'],
    queryFn: () => api.get('/th/reports/dashboard').then(r => r.data.data),
    refetchInterval: 5 * 60 * 1000,
  })

  const today = data?.today
  const month = data?.month
  const totals = data?.totals
  const underserved: any[] = data?.underserved || []

  const todayStr = new Date().toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' })
  const lastUpdateStr = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
    : null

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-gray-400">
      <p className="text-sm">Yuklanmoqda...</p>
    </div>
  )

  const completionPct = (today?.total || 0) > 0 ? Math.round(today.visited / today.total * 100) : 0

  return (
    <div className="p-6 space-y-5 overflow-y-auto h-full">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-800">Boshqaruv paneli</h1>
          <p className="text-sm text-gray-500 mt-0.5">{todayStr}</p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 px-3 py-2 text-sm text-gray-500 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {/* Monitoring holat baner */}
      <div className="bg-emerald-900 rounded-xl p-4 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-emerald-700 rounded-lg flex items-center justify-center shrink-0">
            <RefreshCw className="w-5 h-5 text-emerald-200" />
          </div>
          <div>
            <p className="text-sm font-semibold text-white">Keyingi avtomatik monitoring</p>
            <p className="text-emerald-300 text-xs mt-0.5">Har kuni soat 20:00 (UZT) da ishga tushadi</p>
          </div>
        </div>
        <div className="text-right shrink-0">
          <p className="text-emerald-200 font-bold text-sm">{nextMonitoringTime()}</p>
          {lastUpdateStr && (
            <p className="text-emerald-400 text-xs mt-0.5">
              <Clock className="inline w-3 h-3 mr-0.5" />
              Yangilandi: {lastUpdateStr}
            </p>
          )}
        </div>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Jami MFY" value={totals?.mfys ?? 0} icon={Map} bg="bg-emerald-50" iconColor="text-emerald-600" />
        <MetricCard label="Faol mashinalar" value={totals?.vehicles ?? 0} icon={Truck} bg="bg-blue-50" iconColor="text-blue-600" />
        <MetricCard label="Jadvallar" value={totals?.schedules ?? 0} icon={CalendarDays} bg="bg-purple-50" iconColor="text-purple-600" sub="mashina × MFY" />
        <MetricCard label="Bugun poligon" value={today?.landfillTrips ?? 0} icon={Trash2} bg="bg-orange-50" iconColor="text-orange-600" />
      </div>

      {/* Bugungi progress bar */}
      {(today?.total || 0) > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-gray-800">Bugungi bajarilish</p>
            <span className={`text-lg font-bold ${
              completionPct >= 80 ? 'text-emerald-600' :
              completionPct >= 50 ? 'text-amber-600' : 'text-red-600'
            }`}>{completionPct}%</span>
          </div>
          <div className="h-3 bg-gray-100 rounded-full overflow-hidden mb-2">
            <div
              className={`h-full rounded-full transition-all duration-500 ${
                completionPct >= 80 ? 'bg-emerald-500' :
                completionPct >= 50 ? 'bg-amber-400' : 'bg-red-400'
              }`}
              style={{ width: `${completionPct}%` }}
            />
          </div>
          <p className="text-xs text-gray-400">{today.visited} / {today.total} MFY xizmat ko'rsatildi</p>
        </div>
      )}

      {/* Coverage cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-semibold text-gray-800">Bugungi qamrov</p>
              <p className="text-xs text-gray-500 mt-0.5">Bajarilgan / Jami topshiriq</p>
            </div>
            <CoverageRing pct={today?.coveragePct ?? null} />
          </div>
          <div className="divide-y divide-gray-100">
            <StatRow icon={CheckCircle2} label="Borildi" value={today?.visited ?? 0} color="bg-emerald-100 text-emerald-600" />
            <StatRow icon={XCircle} label="Borilmadi" value={today?.notVisited ?? 0} color="bg-red-100 text-red-600" />
            <StatRow icon={AlertTriangle} label="Shubhali" value={today?.suspicious ?? 0} color="bg-orange-100 text-orange-600" />
            <StatRow icon={Package} label="Konteyner tashriflari" value={today?.containerVisits ?? 0} color="bg-teal-100 text-teal-600" />
          </div>
          <button onClick={() => navigate('trips')}
            className="mt-4 w-full py-2 text-sm text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors">
            GPS Monitoring →
          </button>
        </div>

        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-semibold text-gray-800">Oylik qamrov</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {new Date().toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })}
              </p>
            </div>
            <CoverageRing pct={month?.coveragePct ?? null} />
          </div>
          <div className="divide-y divide-gray-100">
            <StatRow icon={CheckCircle2} label="Bajarildi (kun×MFY)" value={month?.visited ?? 0} color="bg-emerald-100 text-emerald-600" />
            <StatRow icon={XCircle} label="Bajarilmadi" value={month?.notVisited ?? 0} color="bg-red-100 text-red-600" />
            <StatRow icon={Trash2} label="Poligon tashriflari" value={month?.landfillTrips ?? 0} color="bg-blue-100 text-blue-600" />
            <StatRow icon={TrendingUp} label="O'rtacha qamrov %" value={month?.coveragePct ?? 0} color="bg-purple-100 text-purple-600" />
          </div>
          <button onClick={() => navigate('reports')}
            className="mt-4 w-full py-2 text-sm text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors">
            Hisobotlar →
          </button>
        </div>
      </div>

      {/* Eng kam xizmat qilingan MFYlar */}
      {underserved.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <p className="font-semibold text-gray-800">Eng kam xizmat qilingan MFYlar</p>
            <span className="text-xs text-gray-400">bu oy</span>
          </div>
          <div className="space-y-0">
            {underserved.map((m: any, i: number) => (
              <div key={m.id} className="flex items-center justify-between py-2.5 border-b border-gray-100 last:border-0">
                <div className="flex items-center gap-3">
                  <span className="w-6 h-6 bg-gray-100 rounded-full flex items-center justify-center text-xs font-bold text-gray-500">
                    {i + 1}
                  </span>
                  <div>
                    <p className="text-sm text-gray-800 font-medium">{m.name}</p>
                    <p className="text-xs text-gray-400">{m.district?.name}</p>
                  </div>
                </div>
                <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                  {m.missedCount} kun
                </span>
              </div>
            ))}
          </div>
          <button onClick={() => navigate('reports')}
            className="mt-3 w-full py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Barchani ko'rish →
          </button>
        </div>
      )}

      {/* Tizim holati */}
      <div className="grid grid-cols-3 gap-3">
        {[
          { label: 'Avto-monitoring', desc: 'Har kuni 20:00' },
          { label: 'GPS sinxi', desc: 'Har 6 soatda' },
          { label: 'Telegram bot', desc: 'Bildirishnomalar' },
        ].map(item => (
          <div key={item.label} className="bg-white rounded-xl border border-gray-200 p-3 text-center">
            <div className="w-2 h-2 rounded-full bg-emerald-500 mx-auto mb-2 animate-pulse" />
            <p className="text-xs font-semibold text-gray-700">{item.label}</p>
            <p className="text-[10px] text-gray-400 mt-0.5">{item.desc}</p>
          </div>
        ))}
      </div>
    </div>
  )
}
