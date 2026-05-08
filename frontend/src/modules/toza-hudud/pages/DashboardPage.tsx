import { useQuery } from '@tanstack/react-query'
import {
  CheckCircle2, XCircle, AlertTriangle, Truck, Map, CalendarDays, Trash2,
  Clock, RefreshCw, Package, TrendingUp, Trophy, Activity,
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

// Keyingi monitoring vaqti: 01,03,05,07,09,11,13,15 UTC = 06,08,10,12,14,16,18,20 UZT
function nextMonitoringTime(): { timeStr: string; label: string } {
  const now = new Date()
  const utcH = now.getUTCHours()
  // Ishchi soat: 01-15 UTC (06-20 UZT) har 2 soatda
  const slots = [1, 3, 5, 7, 9, 11, 13, 15]
  const nextSlot = slots.find(h => h > utcH) ?? (slots[0] + 24) // ertasiga birinchisi
  const next = new Date(now)
  next.setUTCHours(nextSlot < 24 ? nextSlot : nextSlot - 24, 0, 0, 0)
  if (nextSlot >= 24) next.setDate(next.getDate() + 1)
  const diffMs = next.getTime() - now.getTime()
  const h = Math.floor(diffMs / 3600000)
  const m = Math.floor((diffMs % 3600000) / 60000)
  const timeStr = h > 0 ? `${h} soat ${m} daqiqada` : `${m} daqiqada`
  const uztHour = (nextSlot + 5) % 24
  return { timeStr, label: `${String(uztHour).padStart(2, '0')}:00 UZT` }
}

export default function DashboardPage() {
  const navigate = useNavigate()

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery({
    queryKey: ['th-dashboard'],
    queryFn: () => api.get('/th/reports/dashboard').then(r => r.data.data),
    refetchInterval: 5 * 60 * 1000,
  })

  const { data: liveData } = useQuery({
    queryKey: ['th-live-positions'],
    queryFn: () => api.get('/th/gps/positions').then(r => r.data.data as Array<{
      liveStatus: 'active' | 'scheduled' | 'idle'; scheduled: boolean
    }>),
    refetchInterval: 120_000,
    staleTime: 110_000,
  })

  const today = data?.today
  const month = data?.month
  const totals = data?.totals
  const underserved: any[] = data?.underserved || []
  const driverRankings: any[] = data?.driverRankings || []

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
  const nextMon = nextMonitoringTime()

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

      {/* Avtomatik monitoring baner */}
      <div className="bg-emerald-900 rounded-xl p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-emerald-700 rounded-lg flex items-center justify-center shrink-0">
              <RefreshCw className="w-5 h-5 text-emerald-200" />
            </div>
            <div>
              <p className="text-sm font-semibold text-white">Avtomatik monitoring</p>
              <p className="text-emerald-300 text-xs mt-0.5">
                Har 2 soatda yangilanadi — hech qanday tugma bosish shart emas
              </p>
            </div>
          </div>
          <div className="text-right shrink-0">
            <p className="text-emerald-200 font-bold text-sm">
              Keyingisi: {nextMon.label}
            </p>
            <p className="text-emerald-400 text-xs mt-0.5">{nextMon.timeStr}</p>
          </div>
        </div>
        {/* Kun jadvali */}
        <div className="mt-3 flex gap-1.5 flex-wrap">
          {[6, 8, 10, 12, 14, 16, 18, 20].map(h => {
            const utcH = new Date().getUTCHours()
            const slotUtc = h - 5
            const isPast = utcH > slotUtc
            const isCurrent = utcH === slotUtc
            return (
              <span key={h} className={`px-2 py-0.5 rounded text-[10px] font-medium ${
                isCurrent ? 'bg-emerald-400 text-emerald-900' :
                isPast ? 'bg-emerald-800 text-emerald-500 line-through' :
                'bg-emerald-800 text-emerald-300'
              }`}>
                {String(h).padStart(2, '0')}:00
              </span>
            )
          })}
          {lastUpdateStr && (
            <span className="ml-auto text-emerald-400 text-xs">
              <Clock className="inline w-3 h-3 mr-0.5" />
              Yangilandi: {lastUpdateStr}
            </span>
          )}
        </div>
      </div>

      {/* Kun davomida mashina holati */}
      {liveData && liveData.length > 0 && (() => {
        const active = liveData.filter(p => p.liveStatus === 'active').length
        const scheduled = liveData.filter(p => p.liveStatus === 'scheduled').length
        const total = active + scheduled
        const donePct = total > 0 ? Math.round(active / total * 100) : 0
        return (
          <div className="bg-white rounded-xl border border-gray-200 p-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <Activity className="w-4 h-4 text-emerald-500" />
                <p className="text-sm font-semibold text-gray-800">Kun davomida holat</p>
              </div>
              <span className="text-xs text-gray-400 flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                Jonli · 2 daq yangilanadi
              </span>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              <div className="bg-emerald-50 rounded-lg p-2.5 text-center">
                <p className="text-emerald-700 font-bold text-xl">{active}</p>
                <p className="text-emerald-600 text-xs">🟢 Faol</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-2.5 text-center">
                <p className="text-amber-700 font-bold text-xl">{scheduled}</p>
                <p className="text-amber-600 text-xs">🟡 Kutmoqda</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-2.5 text-center">
                <p className="text-gray-600 font-bold text-xl">{liveData.filter(p => p.liveStatus === 'idle').length}</p>
                <p className="text-gray-400 text-xs">⬜ Jadvalda yo'q</p>
              </div>
            </div>
            {total > 0 && (
              <>
                <div className="flex justify-between text-xs text-gray-500 mb-1">
                  <span>Boshlagan</span>
                  <span className="font-semibold">{active} / {total} — {donePct}%</span>
                </div>
                <div className="h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${donePct >= 80 ? 'bg-emerald-500' : donePct >= 50 ? 'bg-amber-400' : 'bg-red-400'}`}
                    style={{ width: `${donePct}%` }}
                  />
                </div>
              </>
            )}
            <button onClick={() => navigate('map')}
              className="mt-3 w-full py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              Xaritada ko'rish →
            </button>
          </div>
        )
      })()}

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

      {/* Top mashinalar reyting */}
      {driverRankings.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Trophy className="w-4 h-4 text-amber-500" />
              <p className="font-semibold text-gray-800">Top mashinalar</p>
            </div>
            <span className="text-xs text-gray-400">bu hafta</span>
          </div>
          <div className="space-y-0">
            {driverRankings.map((d: any, i: number) => {
              const pctColor = d.weekCoveragePct >= 80 ? 'text-emerald-600' : d.weekCoveragePct >= 50 ? 'text-amber-600' : 'text-red-600'
              const barColor = d.weekCoveragePct >= 80 ? 'bg-emerald-400' : d.weekCoveragePct >= 50 ? 'bg-amber-400' : 'bg-red-400'
              const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`
              return (
                <div key={d.vehicleId} className="flex items-center gap-3 py-2.5 border-b border-gray-100 last:border-0">
                  <span className="w-7 text-center text-sm">{medal}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800 truncate">
                      {d.registrationNumber} <span className="text-gray-400 font-normal">{d.brand} {d.model}</span>
                    </p>
                    <div className="mt-1 h-1.5 bg-gray-100 rounded-full overflow-hidden">
                      <div className={`h-full rounded-full ${barColor}`} style={{ width: `${d.weekCoveragePct}%` }} />
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <span className={`text-sm font-bold ${pctColor}`}>{d.weekCoveragePct}%</span>
                    {d.streak > 0 && (
                      <p className="text-[10px] text-amber-500">🔥 {d.streak} kun</p>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
          <button onClick={() => navigate('reports')}
            className="mt-3 w-full py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Barchani ko'rish →
          </button>
        </div>
      )}

      {/* Tizim holati — avtomatik jarayonlar */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-700 mb-3">Avtomatik jarayonlar</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { label: 'GPS monitoring', desc: 'Har 2 soatda (06:00–20:00)', dot: true },
            { label: 'Konteyner sinxi', desc: 'Har kuni 02:00 UZT', dot: true },
            { label: 'Ertalab tekshiruv', desc: 'Har kuni 10:30 UZT', dot: true },
            { label: 'Telegram bot', desc: 'Natijalar + ogohlantirishlar', dot: true },
          ].map(item => (
            <div key={item.label} className="flex items-start gap-2 p-2.5 bg-gray-50 rounded-lg">
              <div className="w-2 h-2 rounded-full bg-emerald-500 mt-1 shrink-0 animate-pulse" />
              <div>
                <p className="text-xs font-semibold text-gray-700">{item.label}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{item.desc}</p>
              </div>
            </div>
          ))}
        </div>
        <p className="text-[10px] text-gray-400 mt-3 text-center">
          Barcha jarayonlar server tomonida avtomatik ishlaydi — hech qanday tugma bosish talab etilmaydi
        </p>
      </div>
    </div>
  )
}
