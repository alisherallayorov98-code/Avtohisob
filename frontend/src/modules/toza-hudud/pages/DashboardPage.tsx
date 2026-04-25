import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, XCircle, AlertTriangle, Truck, Map, CalendarDays, Trash2 } from 'lucide-react'
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

export default function DashboardPage() {
  const navigate = useNavigate()

  const { data, isLoading } = useQuery({
    queryKey: ['th-dashboard'],
    queryFn: () => api.get('/th/reports/dashboard').then(r => r.data.data),
    refetchInterval: 5 * 60 * 1000, // har 5 daqiqada yangilanadi
  })

  const today = data?.today
  const month = data?.month
  const totals = data?.totals
  const underserved: any[] = data?.underserved || []

  const todayStr = new Date().toLocaleDateString('uz-UZ', { day: 'numeric', month: 'long', year: 'numeric' })

  if (isLoading) return (
    <div className="flex items-center justify-center h-full text-gray-400">
      <p className="text-sm">Yuklanmoqda...</p>
    </div>
  )

  return (
    <div className="p-6 space-y-6 overflow-y-auto h-full">
      {/* Header */}
      <div>
        <h1 className="text-xl font-bold text-gray-800">Boshqaruv paneli</h1>
        <p className="text-sm text-gray-500 mt-0.5">{todayStr}</p>
      </div>

      {/* Top metrics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <MetricCard label="Jami MFY" value={totals?.mfys ?? 0} icon={Map} bg="bg-emerald-50" iconColor="text-emerald-600" />
        <MetricCard label="Faol mashinalar" value={totals?.vehicles ?? 0} icon={Truck} bg="bg-blue-50" iconColor="text-blue-600" />
        <MetricCard label="Jadval (mashina×MFY)" value={totals?.schedules ?? 0} icon={CalendarDays} bg="bg-purple-50" iconColor="text-purple-600" />
        <MetricCard label="Bugungi poligon" value={today?.landfillTrips ?? 0} icon={Trash2} bg="bg-orange-50" iconColor="text-orange-600" />
      </div>

      {/* Coverage cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Today coverage */}
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
            <StatRow icon={AlertTriangle} label="Shubhali (tez harakatlan)" value={today?.suspicious ?? 0} color="bg-orange-100 text-orange-600" />
          </div>
          <button onClick={() => navigate('trips')}
            className="mt-4 w-full py-2 text-sm text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors">
            GPS Monitoring →
          </button>
        </div>

        {/* Month coverage */}
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="font-semibold text-gray-800">Oylik qamrov</p>
              <p className="text-xs text-gray-500 mt-0.5">{new Date().toLocaleDateString('uz-UZ', { month: 'long', year: 'numeric' })}</p>
            </div>
            <CoverageRing pct={month?.coveragePct ?? null} />
          </div>
          <div className="divide-y divide-gray-100">
            <StatRow icon={CheckCircle2} label="Bajarildi (kun×MFY)" value={month?.visited ?? 0} color="bg-emerald-100 text-emerald-600" />
            <StatRow icon={XCircle} label="Bajarilmadi" value={month?.notVisited ?? 0} color="bg-red-100 text-red-600" />
            <StatRow icon={Trash2} label="Poligon tashrifi" value={month?.landfillTrips ?? 0} color="bg-blue-100 text-blue-600" />
          </div>
          <button onClick={() => navigate('reports')}
            className="mt-4 w-full py-2 text-sm text-emerald-700 border border-emerald-200 rounded-lg hover:bg-emerald-50 transition-colors">
            Hisobotlar →
          </button>
        </div>
      </div>

      {/* Underserved MFYs */}
      {underserved.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-5">
          <p className="font-semibold text-gray-800 mb-3">Eng kam xizmat qilingan MFYlar (bu oy)</p>
          <div className="space-y-2">
            {underserved.map((m: any) => (
              <div key={m.id} className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
                <div>
                  <p className="text-sm text-gray-800">{m.name}</p>
                  <p className="text-xs text-gray-400">{m.district?.name}</p>
                </div>
                <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-full">
                  {m.missedCount} kun o'tkazildi
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function MetricCard({ label, value, icon: Icon, bg, iconColor }: {
  label: string; value: number; icon: any; bg: string; iconColor: string
}) {
  return (
    <div className={`${bg} rounded-xl p-4 flex items-center gap-4`}>
      <div className="w-10 h-10 bg-white rounded-lg flex items-center justify-center shadow-sm">
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div>
        <p className="text-2xl font-bold text-gray-800">{value}</p>
        <p className="text-xs text-gray-500 mt-0.5 leading-tight">{label}</p>
      </div>
    </div>
  )
}
