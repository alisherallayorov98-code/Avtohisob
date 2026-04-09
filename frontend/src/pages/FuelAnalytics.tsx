import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fuel, TrendingUp, AlertTriangle, Zap, ChevronDown, ChevronRight, X } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot, BarChart, Bar, Legend,
} from 'recharts'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { StatCard } from '../components/ui/Card'

const SEVERITY_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  high:   { bg: 'bg-red-50 dark:bg-red-900/20',    border: 'border-l-red-500',    text: 'text-red-700 dark:text-red-300',    label: 'YUQORI' },
  medium: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-l-yellow-500', text: 'text-yellow-700 dark:text-yellow-300', label: "O'RTA" },
  low:    { bg: 'bg-blue-50 dark:bg-blue-900/20',   border: 'border-l-blue-500',   text: 'text-blue-700 dark:text-blue-300',   label: 'PAST' },
}

export default function FuelAnalytics() {
  const qc = useQueryClient()
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null)

  // Monthly fleet fuel trends
  const { data: trendsData } = useQuery({
    queryKey: ['fuel-trends'],
    queryFn: () => api.get('/analytics/fuel').then(r => r.data.data?.trends ?? []),
  })

  // Top fuel consumers
  const { data: vehiclesData } = useQuery({
    queryKey: ['report-vehicles'],
    queryFn: () => api.get('/reports/vehicles').then(r => r.data.data),
  })

  // Fuel anomalies
  const { data: anomaliesRes } = useQuery({
    queryKey: ['fuel-anomalies'],
    queryFn: () => api.get('/analytics/anomalies', { params: { type: 'fuel_spike', isResolved: false, limit: 10 } }).then(r => r.data),
  })

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/analytics/anomalies/${id}/resolve`),
    onSuccess: () => { toast.success("Anomaliya hal qilindi"); qc.invalidateQueries({ queryKey: ['fuel-anomalies'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const trends: any[] = trendsData || []
  const vehicles: any[] = Array.isArray(vehiclesData) ? vehiclesData : []
  const anomalies: any[] = anomaliesRes?.data || []

  // Compute KPIs from trends
  const lastMonth = trends[trends.length - 1]
  const prevMonth = trends[trends.length - 2]
  const totalCostAllTime = trends.reduce((s, t) => s + (t.cost || 0), 0)
  const totalLitersAllTime = trends.reduce((s, t) => s + (t.liters || 0), 0)
  const trendPct = lastMonth && prevMonth && prevMonth.cost > 0
    ? (((lastMonth.cost - prevMonth.cost) / prevMonth.cost) * 100)
    : null

  // Chart: add anomaly flag to trend data
  const chartData = trends.map(t => ({
    month: t.month,
    liters: Math.round(t.liters || 0),
    cost: Math.round(t.cost || 0),
  }))

  // Vehicle table: top 10 by fuel cost
  const topVehicles = [...vehicles]
    .sort((a, b) => (b.totalFuelCost || 0) - (a.totalFuelCost || 0))
    .slice(0, 10)

  const maxFuel = topVehicles.length > 0 ? topVehicles[0].totalFuelCost : 1

  const getVarianceClass = (variance: number) => {
    if (variance > 10) return 'text-red-600 font-semibold'
    if (variance > 0) return 'text-yellow-600 font-semibold'
    return 'text-green-600 font-semibold'
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Yoqilg'i Tahlili</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Parka yoqilg'i iste'moli va anomaliyalar</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard
          label="Jami Yoqilg'i Xarajati"
          value={formatCurrency(totalCostAllTime)}
          sub="Barcha davrlar"
          icon={<Fuel className="w-6 h-6" />}
          color="blue"
        />
        <StatCard
          label="Jami Litrlar"
          value={`${totalLitersAllTime.toLocaleString()} L`}
          sub={`${trends.length} oy`}
          icon={<Zap className="w-6 h-6" />}
          color="green"
        />
        <StatCard
          label="Oxirgi Oy Xarajati"
          value={lastMonth ? formatCurrency(lastMonth.cost) : '—'}
          sub={lastMonth?.month}
          icon={<TrendingUp className="w-6 h-6" />}
          color={trendPct !== null && trendPct > 0 ? 'red' : 'green'}
          trend={trendPct !== null ? `${Math.abs(trendPct).toFixed(1)}%` : undefined}
          trendUp={trendPct !== null ? trendPct <= 0 : undefined}
        />
        <StatCard
          label="Anomaliyalar"
          value={anomalies.length}
          sub="Hal etilmagan"
          icon={<AlertTriangle className="w-6 h-6" />}
          color={anomalies.length > 0 ? 'red' : 'green'}
        />
      </div>

      {/* Area Chart — Monthly Trends */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h3 className="font-semibold text-gray-900 dark:text-white">Yoqilg'i Sarfi — Oylik Dinamika</h3>
            <p className="text-xs text-gray-400 mt-0.5">So'nggi 6 oy</p>
          </div>
        </div>
        {chartData.length === 0 ? (
          <div className="h-52 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
        ) : (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 5, right: 10, bottom: 0, left: 10 }}>
                <defs>
                  <linearGradient id="fuelGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0.02} />
                  </linearGradient>
                  <linearGradient id="costGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tick={{ fontSize: 12, fill: '#9CA3AF' }} />
                <YAxis yAxisId="liters" tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={v => `${v}L`} />
                <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 11, fill: '#9CA3AF' }}
                  tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                <Tooltip
                  contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#F3F4F6' }}
                  formatter={(v: any, name: string) => name === 'cost' ? formatCurrency(Number(v)) : `${v} L`}
                  labelStyle={{ color: '#9CA3AF' }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area yAxisId="liters" type="monotone" dataKey="liters" name="Litrlar"
                  stroke="#3B82F6" strokeWidth={2.5} fill="url(#fuelGradient)" dot={{ r: 3, fill: '#3B82F6' }} />
                <Area yAxisId="cost" type="monotone" dataKey="cost" name="Xarajat"
                  stroke="#10B981" strokeWidth={2} fill="url(#costGradient)" dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Vehicle Performance Table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white">Avtomashina Ishlashi</h3>
            <p className="text-xs text-gray-400 mt-0.5">Yoqilg'i xarajati bo'yicha</p>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {topVehicles.length === 0 ? (
              <p className="py-8 text-center text-gray-400 text-sm">Ma'lumot yo'q</p>
            ) : topVehicles.map((v, i) => {
              const pct = maxFuel > 0 ? (v.totalFuelCost / maxFuel) * 100 : 0
              const isHighConsumer = i < 3
              return (
                <div key={v.registrationNumber} className="px-5 py-3">
                  <div className="flex items-center justify-between mb-1.5">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 ${
                        i === 0 ? 'bg-red-100 text-red-600' :
                        i === 1 ? 'bg-orange-100 text-orange-600' :
                        i === 2 ? 'bg-yellow-100 text-yellow-600' : 'bg-gray-100 text-gray-500'
                      }`}>{i + 1}</span>
                      <span className="font-medium text-sm text-gray-800 dark:text-gray-200">{v.registrationNumber}</span>
                      <span className="text-xs text-gray-400">{v.brand} {v.model}</span>
                    </div>
                    <span className={`text-sm font-semibold ${isHighConsumer ? 'text-red-600' : 'text-gray-700 dark:text-gray-300'}`}>
                      {formatCurrency(v.totalFuelCost || 0)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full">
                    <div className={`h-full rounded-full transition-all ${isHighConsumer ? 'bg-red-400' : 'bg-blue-400'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        {/* Monthly Comparison Bar Chart */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
          <h3 className="font-semibold text-gray-900 dark:text-white mb-1">Oylik Solishtiruv</h3>
          <p className="text-xs text-gray-400 mb-4">Yoqilg'i miqdori (litr)</p>
          {chartData.length === 0 ? (
            <div className="h-52 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={chartData} margin={{ top: 5, right: 5, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={v => `${v}L`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#F3F4F6' }}
                    formatter={(v: any) => [`${v} L`, 'Litrlar']}
                  />
                  <Bar dataKey="liters" name="Litrlar" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </div>

      {/* Anomaly Alerts */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-5 h-5 text-red-500" />
            <h3 className="font-semibold text-gray-900 dark:text-white">Anomaliya Alertlari</h3>
            {anomalies.length > 0 && (
              <span className="bg-red-100 text-red-600 text-xs font-bold px-2 py-0.5 rounded-full">{anomalies.length}</span>
            )}
          </div>
        </div>
        {anomalies.length === 0 ? (
          <div className="py-10 text-center">
            <div className="w-12 h-12 bg-green-50 rounded-full flex items-center justify-center mx-auto mb-3">
              <Fuel className="w-6 h-6 text-green-500" />
            </div>
            <p className="text-gray-500 font-medium">Anomaliyalar topilmadi</p>
            <p className="text-gray-400 text-sm mt-1">Yoqilg'i sarfi me'yoriy ko'rsatkichlarda</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {anomalies.map((a: any) => {
              const sev = SEVERITY_CONFIG[a.severity] || SEVERITY_CONFIG.medium
              const isExpanded = expandedAlert === a.id
              return (
                <div key={a.id} className={`border-l-4 ${sev.border} ${sev.bg} transition-colors`}>
                  <div className="px-5 py-3.5 flex items-start gap-3">
                    <button
                      onClick={() => setExpandedAlert(isExpanded ? null : a.id)}
                      className={`mt-0.5 flex-shrink-0 transition-transform ${isExpanded ? 'rotate-90' : ''}`}
                    >
                      <ChevronRight className={`w-4 h-4 ${sev.text}`} />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${sev.bg} ${sev.text}`}>{sev.label}</span>
                        <span className="font-semibold text-sm text-gray-800 dark:text-gray-200">
                          {a.vehicle?.registrationNumber} — {a.vehicle?.brand} {a.vehicle?.model}
                        </span>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{a.description}</p>
                      {isExpanded && a.metadata && (
                        <div className="mt-2 bg-white dark:bg-gray-700 rounded-lg p-3 text-xs text-gray-600 dark:text-gray-300 space-y-1">
                          {Object.entries(a.metadata).map(([k, v]) => (
                            <div key={k}><span className="font-medium">{k}:</span> {String(v)}</div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      <button
                        onClick={() => resolveMutation.mutate(a.id)}
                        className="text-xs px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                      >
                        Hal qilish
                      </button>
                      <button
                        onClick={() => resolveMutation.mutate(a.id)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
