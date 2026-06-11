import { useState, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fuel, TrendingUp, AlertTriangle, Zap, ChevronDown, ChevronRight, X, Satellite, CheckCircle, XCircle, Droplets } from 'lucide-react'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceDot, BarChart, Bar, Legend,
} from 'recharts'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatCurrency, fuelUnit } from '../lib/utils'
import { StatCard } from '../components/ui/Card'

const SEVERITY_CONFIG: Record<string, { bg: string; border: string; text: string; label: string }> = {
  high:   { bg: 'bg-red-50 dark:bg-red-900/20',    border: 'border-l-red-500',    text: 'text-red-700 dark:text-red-300',    label: 'YUQORI' },
  medium: { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-l-yellow-500', text: 'text-yellow-700 dark:text-yellow-300', label: "O'RTA" },
  low:    { bg: 'bg-blue-50 dark:bg-blue-900/20',   border: 'border-l-blue-500',   text: 'text-blue-700 dark:text-blue-300',   label: 'PAST' },
}

export default function FuelAnalytics() {
  const qc = useQueryClient()
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(new Set())
  const dismissAlert = useCallback((id: string) => setDismissedIds(prev => new Set(prev).add(id)), [])

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

  // Norma nazorati (norma vs haqiqiy sarf)
  const { data: normData } = useQuery({
    queryKey: ['fuel-norm-analysis'],
    queryFn: () => api.get('/fuel-records/norm-analysis').then(r => r.data.data),
  })

  // Bak balansi — taxminiy qoldiq har mashina uchun
  const { data: tankData } = useQuery({
    queryKey: ['fuel-tank-balance'],
    queryFn: () => api.get('/fuel-records/tank-balance').then(r => r.data.data),
  })

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/analytics/anomalies/${id}/resolve`),
    onSuccess: () => { toast.success("Anomaliya hal qilindi"); qc.invalidateQueries({ queryKey: ['fuel-anomalies'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const trends: any[] = trendsData || []
  const vehicles: any[] = Array.isArray(vehiclesData) ? vehiclesData : []
  const anomalies: any[] = (anomaliesRes?.data || []).filter((a: any) => !dismissedIds.has(a.id))

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

      {/* Norma nazorati — ortiqcha sarf */}
      {normData && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <div>
              <h3 className="font-semibold text-gray-900 dark:text-white">Norma nazorati — ortiqcha sarf</h3>
              <p className="text-xs text-gray-400 mt-0.5">{normData.from} — {normData.to} · norma (L/100km) bilan taqqoslash</p>
            </div>
            <div className="flex items-center gap-4 text-sm">
              <span className="text-red-600 dark:text-red-400 font-medium">🔴 {normData.summary.overCount} ta ortiqcha</span>
              {normData.summary.totalExcessCost > 0 && (
                <span className="text-gray-500">Ortiqcha: <b className="text-red-600 dark:text-red-400">{formatCurrency(normData.summary.totalExcessCost)}</b></span>
              )}
            </div>
          </div>
          {normData.summary.noNormCount > 0 && (
            <div className="px-5 py-2 bg-amber-50 dark:bg-amber-900/20 text-xs text-amber-700 dark:text-amber-400 border-b border-amber-100 dark:border-amber-800">
              ⚠️ {normData.summary.noNormCount} ta mashinaga norma belgilanmagan — "Avtomashinalar" bo'limida har biriga norma kiriting.
            </div>
          )}
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-gray-500">
                  <th className="text-left px-4 py-2 font-medium">Mashina</th>
                  <th className="text-right px-3 py-2 font-medium">Norma</th>
                  <th className="text-right px-3 py-2 font-medium">Haqiqiy</th>
                  <th className="text-right px-3 py-2 font-medium">Probeg</th>
                  <th className="text-right px-3 py-2 font-medium">Ortiqcha</th>
                  <th className="text-right px-4 py-2 font-medium">Ortiqcha (so'm)</th>
                </tr>
              </thead>
              <tbody>
                {normData.rows.map((r: any) => {
                  const over = r.status === 'over'
                  const noData = r.status === 'no_data'
                  const noNorm = r.status === 'no_norm'
                  const u = fuelUnit(r.fuelType)
                  return (
                    <tr key={r.vehicleId} className={`border-b border-gray-50 dark:border-gray-700/50 ${over ? 'bg-red-50/60 dark:bg-red-900/10' : ''}`}>
                      <td className="px-4 py-2">
                        <div className="font-mono font-medium text-gray-900 dark:text-white">{r.registrationNumber}</div>
                        <div className="text-xs text-gray-400">{r.brand} {r.model}</div>
                      </td>
                      <td className="text-right px-3 py-2 text-gray-600 dark:text-gray-300">{r.norm != null ? `${r.norm} ${u}/100km` : '—'}</td>
                      <td className={`text-right px-3 py-2 font-semibold ${over ? 'text-red-600 dark:text-red-400' : r.status === 'under' ? 'text-green-600 dark:text-green-400' : 'text-gray-700 dark:text-gray-200'}`}>
                        {noData ? <span className="text-gray-300 font-normal">ma'lumot yo'q</span> : `${r.actual} ${u}/100km`}
                      </td>
                      <td className="text-right px-3 py-2 text-gray-500">{noData ? '—' : `${r.km.toLocaleString()} km`}</td>
                      <td className={`text-right px-3 py-2 ${over ? 'text-red-600 dark:text-red-400 font-semibold' : 'text-gray-400'}`}>
                        {noNorm ? <span className="text-amber-500 text-xs">norma yo'q</span> : noData ? '—' : (r.excessLiters != null && r.excessLiters > 0 ? `+${r.excessLiters} ${u}` : (r.excessLiters != null ? `${r.excessLiters} ${u}` : '—'))}
                      </td>
                      <td className={`text-right px-4 py-2 ${over ? 'text-red-600 dark:text-red-400 font-bold' : 'text-gray-400'}`}>
                        {over && r.excessCost ? formatCurrency(r.excessCost) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Bak balansi — taxminiy qoldiq */}
      {tankData && tankData.rows.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <Droplets className="w-5 h-5 text-blue-500" />
              <div>
                <h3 className="font-semibold text-gray-900 dark:text-white">Bak balansi — taxminiy qoldiq</h3>
                <p className="text-xs text-gray-400 mt-0.5">Oxirgi quyilishdan keyin sarf hisoblangan taxminiy qoldiq</p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-sm">
              {tankData.summary.criticalCount > 0 && (
                <span className="text-red-600 dark:text-red-400 font-medium">🔴 {tankData.summary.criticalCount} ta kritik</span>
              )}
              {tankData.summary.lowCount > 0 && (
                <span className="text-amber-600 dark:text-amber-400 font-medium">🟡 {tankData.summary.lowCount} ta kam</span>
              )}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 text-gray-500">
                  <th className="text-left px-4 py-2 font-medium">Mashina</th>
                  <th className="text-right px-3 py-2 font-medium">Oxirgi quyilish</th>
                  <th className="text-right px-3 py-2 font-medium">Km buyon</th>
                  <th className="text-right px-3 py-2 font-medium">Sarflandi</th>
                  <th className="text-left px-3 py-2 font-medium">Qoldiq (est.)</th>
                  <th className="text-right px-4 py-2 font-medium">Tugaydi</th>
                </tr>
              </thead>
              <tbody>
                {tankData.rows.map((r: any) => {
                  const isCritical = r.warningLevel === 'critical'
                  const isLow = r.warningLevel === 'low'
                  const noData = r.status === 'no_data'
                  const u = fuelUnit(r.fuelType)
                  return (
                    <tr key={r.vehicleId} className={`border-b border-gray-50 dark:border-gray-700/50 ${isCritical ? 'bg-red-50/60 dark:bg-red-900/10' : isLow ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}`}>
                      <td className="px-4 py-2.5">
                        <div className="font-mono font-medium text-gray-900 dark:text-white">{r.registrationNumber}</div>
                        <div className="text-xs text-gray-400">{r.brand} {r.model}</div>
                      </td>
                      <td className="text-right px-3 py-2 text-gray-600 dark:text-gray-300">
                        {noData ? '—' : (
                          <div>
                            <div className="font-medium">{r.lastRefuelLiters} {u}</div>
                            <div className="text-xs text-gray-400">{r.lastRefuelDate ? new Date(r.lastRefuelDate).toLocaleDateString('uz-UZ') : '—'}</div>
                          </div>
                        )}
                      </td>
                      <td className="text-right px-3 py-2 text-gray-500">
                        {noData ? '—' : `${r.kmSince.toLocaleString()} km`}
                      </td>
                      <td className="text-right px-3 py-2 text-gray-500">
                        {noData || r.estimatedConsumed == null ? <span className="text-gray-300 text-xs">norma yo'q</span> : `~${r.estimatedConsumed} ${u}`}
                      </td>
                      <td className="px-3 py-2">
                        {noData || r.estimatedRemaining == null ? (
                          <span className="text-gray-300 text-xs">ma'lumot yo'q</span>
                        ) : (
                          <div className="flex items-center gap-2">
                            <span className={`font-semibold ${isCritical ? 'text-red-600 dark:text-red-400' : isLow ? 'text-amber-600 dark:text-amber-400' : 'text-green-600 dark:text-green-400'}`}>
                              ~{r.estimatedRemaining} {u}
                            </span>
                            {r.fillPercent != null && (
                              <div className="flex items-center gap-1">
                                <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
                                  <div
                                    className={`h-full rounded-full ${isCritical ? 'bg-red-500' : isLow ? 'bg-amber-500' : 'bg-green-500'}`}
                                    style={{ width: `${Math.min(100, r.fillPercent)}%` }}
                                  />
                                </div>
                                <span className="text-xs text-gray-400">{r.fillPercent}%</span>
                              </div>
                            )}
                          </div>
                        )}
                      </td>
                      <td className="text-right px-4 py-2">
                        {r.daysToEmpty != null ? (
                          <span className={`text-xs font-medium ${r.daysToEmpty <= 1 ? 'text-red-600 dark:text-red-400' : r.daysToEmpty <= 3 ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500'}`}>
                            ~{r.daysToEmpty} kun
                          </span>
                        ) : '—'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-2 border-t border-gray-100 dark:border-gray-700 text-xs text-gray-400">
            * Taxminiy hisob: oxirgi quyilgan miqdor minus yurgan km × norma. Aniqroq natija uchun bak hajmini va normani belgilang.
          </div>
        </div>
      )}

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
                  formatter={(v: any, name: any) => name === 'cost' ? formatCurrency(Number(v)) : `${v} L`}
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
                        onClick={() => dismissAlert(a.id)}
                        className="text-gray-400 hover:text-gray-600 transition-colors"
                        title="Vaqtinchalik yopish"
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
      {/* GPS Tekshiruv sektsiyasi */}
      <GpsCheckSection />
    </div>
  )
}

function GpsCheckSection() {
  const [showGps, setShowGps] = useState(false)
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['fuel-gps-check'],
    queryFn: () => api.get('/fuel-analytics/gps-check').then(r => r.data),
    enabled: showGps,
    staleTime: 120000,
  })

  const STATUS_CFG: Record<string, { label: string; color: string; icon: any }> = {
    critical:          { label: 'Kritik',       color: 'text-red-600 bg-red-50 dark:bg-red-900/20',       icon: XCircle },
    warning:           { label: 'Diqqat',       color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-900/20', icon: AlertTriangle },
    ok:                { label: 'Yaxshi',        color: 'text-green-600 bg-green-50 dark:bg-green-900/20',   icon: CheckCircle },
    no_gps:            { label: 'GPS yo\'q',    color: 'text-gray-500 bg-gray-50 dark:bg-gray-800',         icon: Satellite },
    insufficient_data: { label: 'Kam ma\'lumot', color: 'text-gray-400 bg-gray-50 dark:bg-gray-800',        icon: AlertTriangle },
  }

  const vehicles = data?.vehicles ?? []
  const summary = data?.summary

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
      <button
        onClick={() => { setShowGps(v => !v); if (!showGps) refetch() }}
        className="w-full px-5 py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-xl"
      >
        <div className="flex items-center gap-3">
          <Satellite className="w-5 h-5 text-blue-500" />
          <div className="text-left">
            <div className="font-semibold text-gray-900 dark:text-white">GPS vs Odometr Tekshiruvi</div>
            <div className="text-xs text-gray-400">Yoqilg'i quyish yozuvi va GPS km ni solishtirish</div>
          </div>
          {summary?.critical > 0 && (
            <span className="text-xs bg-red-100 text-red-700 px-2 py-0.5 rounded-full font-medium">{summary.critical} kritik</span>
          )}
        </div>
        {showGps ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
      </button>

      {showGps && (
        <div className="border-t border-gray-100 dark:border-gray-700">
          {isLoading ? (
            <div className="py-10 flex justify-center">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : (
            <>
              {summary && (
                <div className="grid grid-cols-4 gap-3 p-4">
                  {[['Kritik', summary.critical, 'text-red-600'], ['Diqqat', summary.warning, 'text-yellow-600'], ['Yaxshi', summary.ok, 'text-green-600'], ["GPS yo'q", summary.no_gps, 'text-gray-400']].map(([l, v, c]) => (
                    <div key={l as string} className="text-center">
                      <div className={`text-xl font-bold ${c}`}>{v}</div>
                      <div className="text-xs text-gray-400">{l}</div>
                    </div>
                  ))}
                </div>
              )}
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-xs text-gray-400 border-y border-gray-100 dark:border-gray-700">
                      <th className="px-5 pb-2 pt-2 text-left font-medium">Mashina</th>
                      <th className="pb-2 pt-2 pr-4 text-right font-medium">Odometr km</th>
                      <th className="pb-2 pt-2 pr-4 text-right font-medium">GPS km</th>
                      <th className="pb-2 pt-2 pr-4 text-right font-medium">Farq</th>
                      <th className="pb-2 pt-2 pr-4 text-right font-medium">l/100km</th>
                      <th className="pb-2 pt-2 pr-5 text-right font-medium">Holat</th>
                    </tr>
                  </thead>
                  <tbody>
                    {vehicles.map((v: any) => {
                      const cfg = STATUS_CFG[v.status] ?? STATUS_CFG.ok
                      return (
                        <tr key={v.id} className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                          <td className="px-5 py-2.5">
                            <div className="font-medium text-gray-900 dark:text-white text-sm">{v.registrationNumber}</div>
                            <div className="text-xs text-gray-400">{v.brand} {v.model}</div>
                            {v.details?.anomalyFlags?.map((f: string, i: number) => (
                              <div key={i} className="text-xs text-red-500 mt-0.5">{f}</div>
                            ))}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-sm text-gray-700 dark:text-gray-200">
                            {v.details?.odoKm != null ? `${v.details.odoKm.toLocaleString()} km` : '—'}
                          </td>
                          <td className="py-2.5 pr-4 text-right text-sm text-gray-700 dark:text-gray-200">
                            {v.details?.gpsKm != null ? `${v.details.gpsKm.toLocaleString()} km` : '—'}
                          </td>
                          <td className={`py-2.5 pr-4 text-right text-sm font-medium ${v.details?.kmDeviation != null && Math.abs(v.details.kmDeviation) > 15 ? 'text-red-600' : 'text-gray-600 dark:text-gray-300'}`}>
                            {v.details?.kmDeviation != null ? `${v.details.kmDeviation > 0 ? '+' : ''}${v.details.kmDeviation}%` : '—'}
                          </td>
                          <td className={`py-2.5 pr-4 text-right text-sm font-medium ${v.details?.odoConsumption > 15 ? 'text-red-600' : 'text-gray-700 dark:text-gray-200'}`}>
                            {v.details?.odoConsumption != null ? `${v.details.odoConsumption} l` : '—'}
                          </td>
                          <td className="py-2.5 pr-5 text-right">
                            <span className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full font-medium ${cfg.color}`}>
                              {cfg.label}
                            </span>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}
