import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts'
import {
  TrendingUp, TrendingDown, Car, Fuel, Wrench, Package,
  AlertTriangle, Activity, DollarSign, Route, Users,
  Minus, ChevronRight, MapPin, Gauge, Building2,
} from 'lucide-react'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { useAuthStore } from '../stores/authStore'
import ExcelExportButton from '../components/ui/ExcelExportButton'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

const PERIODS = [
  { label: '30 kun', months: 1 },
  { label: '3 oy', months: 3 },
  { label: '6 oy', months: 6 },
  { label: '1 yil', months: 12 },
]

// ── helpers ──────────────────────────────────────────────────────────────────
function pct(val: number | null) {
  if (val === null) return null
  return val
}

function DeltaBadge({ delta }: { delta: number | null }) {
  if (delta === null) return null
  if (delta === 0) return <span className="flex items-center gap-0.5 text-xs text-gray-400"><Minus className="w-3 h-3" /> 0%</span>
  const up = delta > 0
  return (
    <span className={`flex items-center gap-0.5 text-xs font-semibold ${up ? 'text-red-500' : 'text-emerald-500'}`}>
      {up ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
      {Math.abs(delta)}%
    </span>
  )
}

function KpiCard({
  label, value, sub, icon, color, bg, delta,
}: {
  label: string; value: string | number; sub?: string
  icon: React.ReactNode; color: string; bg: string; delta?: number | null
}) {
  return (
    <div className={`rounded-2xl p-4 border ${bg} flex items-start gap-3`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{label}</p>
        <p className="text-xl font-bold text-gray-900 dark:text-white mt-0.5 truncate">{value}</p>
        <div className="flex items-center gap-2 mt-0.5">
          {sub && <p className="text-xs text-gray-400 truncate">{sub}</p>}
          {delta !== undefined && <DeltaBadge delta={pct(delta ?? null)} />}
        </div>
      </div>
    </div>
  )
}

function ChartCard({ title, children, className = '', action }: { title: string; children: React.ReactNode; className?: string; action?: React.ReactNode }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 ${className}`}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">{title}</h3>
        {action}
      </div>
      {children}
    </div>
  )
}

function CustomTooltipCurrency({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-900 rounded-xl px-3 py-2 shadow-xl text-xs border border-gray-700">
      <p className="text-gray-400 mb-1 font-medium">{label}</p>
      {payload.map((p: any, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
          <span className="text-gray-300">{p.name}:</span>
          <span className="font-bold text-white">{formatCurrency(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

const tooltipStyle = {
  contentStyle: { backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#f9fafb', fontSize: 12 },
}

// ── main component ────────────────────────────────────────────────────────────
export default function AnalyticsDashboard() {
  const { hasRole, user } = useAuthStore()
  const isAdmin = hasRole('admin', 'super_admin')
  const canFilterBranch = hasRole('admin', 'super_admin', 'manager')
  const [selectedPeriod, setSelectedPeriod] = useState(3)
  const [branchFilter, setBranchFilter] = useState('')

  const effectiveBranch = ['branch_manager', 'operator'].includes(user?.role || '') ? (user?.branchId || '') : branchFilter

  const params = { months: selectedPeriod, ...(effectiveBranch ? { branchId: effectiveBranch } : {}) }

  const { data: branches } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
    enabled: canFilterBranch,
  })

  const { data: dash } = useQuery({
    queryKey: ['report-dashboard', effectiveBranch],
    queryFn: () => api.get('/reports/dashboard', { params: effectiveBranch ? { branchId: effectiveBranch } : {} }).then(r => r.data.data),
  })

  const { data: branchCostData } = useQuery({
    queryKey: ['branch-cost-comparison', selectedPeriod],
    queryFn: () => api.get('/branch-analytics/cost-comparison', { params: { months: selectedPeriod } }).then(r => r.data.data),
    enabled: isAdmin,
  })

  const { data: monthlyTrend, isLoading: trendLoading } = useQuery({
    queryKey: ['report-monthly-trend', selectedPeriod, effectiveBranch],
    queryFn: () => api.get('/reports/monthly-trend', { params }).then(r => r.data.data),
  })

  const { data: vehicleReport } = useQuery({
    queryKey: ['report-vehicles-analytics', effectiveBranch],
    queryFn: () => api.get('/reports/vehicles', { params: effectiveBranch ? { branchId: effectiveBranch } : {} }).then(r => r.data.data),
  })

  const { data: branchReport } = useQuery({
    queryKey: ['report-branch-analytics'],
    queryFn: () => api.get('/reports/branch').then(r => r.data.data),
    enabled: !effectiveBranch,
  })

  const { data: expenseReport } = useQuery({
    queryKey: ['report-expenses-analytics', effectiveBranch],
    queryFn: () => api.get('/reports/expenses', { params: effectiveBranch ? { branchId: effectiveBranch } : {} }).then(r => r.data.data),
  })

  const { data: fuelReport } = useQuery({
    queryKey: ['report-fuel-analytics', effectiveBranch],
    queryFn: () => api.get('/reports/fuel', { params: effectiveBranch ? { branchId: effectiveBranch } : {} }).then(r => r.data.data),
  })

  const { data: maintReport } = useQuery({
    queryKey: ['report-maintenance-analytics', effectiveBranch],
    queryFn: () => api.get('/reports/maintenance', { params: effectiveBranch ? { branchId: effectiveBranch } : {} }).then(r => r.data.data),
  })

  const { data: costPerKm } = useQuery({
    queryKey: ['report-cost-per-km', selectedPeriod, effectiveBranch],
    queryFn: () => api.get('/reports/cost-per-km', { params }).then(r => r.data.data),
  })

  const { data: driverStats } = useQuery({
    queryKey: ['report-driver-stats', selectedPeriod, effectiveBranch],
    queryFn: () => api.get('/reports/driver-stats', { params }).then(r => r.data.data),
  })

  // derived data
  const topVehicles = ((vehicleReport as any[]) || [])
    .map((v: any) => ({
      name: v.registrationNumber,
      fuel: v.totalFuelCost,
      maintenance: v.totalMaintenanceCost,
      total: v.totalExpenses + v.totalFuelCost,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  const expensePie = Object.entries(expenseReport?.byCategory || {}).map(([name, val]: any) => ({ name, value: Number(val) }))
  const fuelPie = Object.entries(fuelReport?.byFuelType || {}).map(([name, val]: any) => ({ name, value: Number((val as any).cost || val) }))
  const maintPie = Object.entries(maintReport?.byCategory || {}).map(([name, val]: any) => ({ name, value: Number(val) }))

  const branchData = ((branchReport as any[]) || []).map((b: any) => ({
    name: b.name.length > 14 ? b.name.slice(0, 14) + '…' : b.name,
    fuel: b.totalFuelCost,
    expenses: b.totalExpenses,
    vehicles: b.activeVehicles,
  }))

  const monthlyTotal = (monthlyTrend || []).reduce((s: number, m: any) => s + m.total, 0)
  const monthlyFuel = (monthlyTrend || []).reduce((s: number, m: any) => s + m.fuel, 0)
  const monthlyMaint = (monthlyTrend || []).reduce((s: number, m: any) => s + m.maintenance, 0)

  const periodLabel = selectedPeriod === 1 ? '30 kun' : selectedPeriod === 3 ? '3 oy' : selectedPeriod === 6 ? '6 oy' : '12 oy'

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-500" />
            Analitika paneli
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Flot bo'yicha to'liq statistik tahlil</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {/* Branch filter (admin/manager) */}
          {canFilterBranch && (
            <select
              value={branchFilter}
              onChange={e => setBranchFilter(e.target.value)}
              className="text-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Barcha filiallar</option>
              {((branches as any[]) || []).length === 0 ? (
                <option disabled>— filiallar yo'q —</option>
              ) : (
                ((branches as any[]) || []).map((b: any) => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))
              )}
            </select>
          )}
          {/* Period selector */}
          <div className="flex items-center gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
            {PERIODS.map(p => (
              <button
                key={p.months}
                onClick={() => setSelectedPeriod(p.months)}
                className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-all ${selectedPeriod === p.months ? 'bg-white dark:bg-gray-700 text-blue-600 dark:text-blue-400 shadow-sm' : 'text-gray-500 dark:text-gray-400 hover:text-gray-700'}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          <ExcelExportButton endpoint="/exports/vehicles" params={effectiveBranch ? { branchId: effectiveBranch } : {}} label="Export" size="sm" />
        </div>
      </div>

      {/* KPI Cards Row 1 — fleet overview */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiCard
          label="Jami transport"
          value={dash?.totalVehicles ?? '—'}
          sub={`${dash?.activeVehicles ?? 0} faol, ${dash?.maintenanceVehicles ?? 0} ta'mirda`}
          icon={<Car className="w-5 h-5 text-blue-600" />}
          color="bg-blue-100 dark:bg-blue-900/30"
          bg="border-blue-100 dark:border-blue-900/30"
        />
        <KpiCard
          label="Yo'l varaqlari (bu oy)"
          value={dash?.waybillsThisMonth ?? '—'}
          sub={`${dash?.completedWaybillsThisMonth ?? 0} tugallandi · ${dash?.activeWaybills ?? 0} aktiv`}
          icon={<Route className="w-5 h-5 text-cyan-600" />}
          color="bg-cyan-100 dark:bg-cyan-900/30"
          bg="border-cyan-100 dark:border-cyan-900/30"
        />
        <KpiCard
          label="Jami km (bu oy)"
          value={dash?.totalKmMonth ? `${Number(dash.totalKmMonth).toLocaleString()} km` : '0 km'}
          sub="Tugallangan reyslar bo'yicha"
          icon={<MapPin className="w-5 h-5 text-violet-600" />}
          color="bg-violet-100 dark:bg-violet-900/30"
          bg="border-violet-100 dark:border-violet-900/30"
        />
        <KpiCard
          label="Kam ombor / Kechikkan"
          value={`${dash?.lowStockCount ?? 0} / ${dash?.overdueMaintenanceCount ?? 0}`}
          sub={`${dash?.expiringWarrantiesCount ?? 0} ta kafolat tugayapti`}
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          color="bg-red-100 dark:bg-red-900/30"
          bg="border-red-100 dark:border-red-900/30"
        />
      </div>

      {/* KPI Cards Row 2 — cost breakdown with delta */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <KpiCard
          label={`Yoqilg'i xarajati (${periodLabel})`}
          value={formatCurrency(monthlyFuel)}
          sub={`${fuelReport?.totalLiters ? Number(fuelReport.totalLiters).toFixed(0) + ' L' : ''}`}
          icon={<Fuel className="w-5 h-5 text-green-600" />}
          color="bg-green-100 dark:bg-green-900/30"
          bg="border-green-100 dark:border-green-900/30"
          delta={dash?.deltaFuel}
        />
        <KpiCard
          label={`Ta'mirlash xarajati (${periodLabel})`}
          value={formatCurrency(monthlyMaint)}
          sub={`${maintReport?.count ?? 0} ta amal`}
          icon={<Wrench className="w-5 h-5 text-yellow-600" />}
          color="bg-yellow-100 dark:bg-yellow-900/30"
          bg="border-yellow-100 dark:border-yellow-900/30"
          delta={dash?.deltaMaintenance}
        />
        <KpiCard
          label={`Jami xarajat (${periodLabel})`}
          value={formatCurrency(monthlyTotal)}
          sub={`O'tgan oydan taqqoslash`}
          icon={<DollarSign className="w-5 h-5 text-indigo-600" />}
          color="bg-indigo-100 dark:bg-indigo-900/30"
          bg="border-indigo-100 dark:border-indigo-900/30"
          delta={dash?.deltaExpenses}
        />
      </div>

      {/* Monthly Trend */}
      <ChartCard title={`Oylik xarajat trendi — so'nggi ${periodLabel}`}>
        {trendLoading ? (
          <div className="h-56 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend || []} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <defs>
                  <linearGradient id="gFuel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gMaint" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                <Tooltip content={<CustomTooltipCurrency />} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'fuel' ? "Yoqilg'i" : v === 'maintenance' ? "Ta'mirlash" : 'Boshqa'} />
                <Area type="monotone" dataKey="fuel" name="fuel" stroke="#3B82F6" strokeWidth={2} fill="url(#gFuel)" />
                <Area type="monotone" dataKey="maintenance" name="maintenance" stroke="#10B981" strokeWidth={2} fill="url(#gMaint)" />
                <Area type="monotone" dataKey="expenses" name="expenses" stroke="#F59E0B" strokeWidth={2} fill="url(#gExp)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {/* Top vehicles + Branch */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <ChartCard title="Top 8 avtomobil — xarajat bo'yicha">
          {topVehicles.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topVehicles} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={76} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltipCurrency />} />
                  <Bar dataKey="fuel" name="Yoqilg'i" stackId="a" fill="#3B82F6" />
                  <Bar dataKey="maintenance" name="Ta'mirlash" stackId="a" fill="#10B981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        {effectiveBranch ? (
          /* Single branch — donut summary */
          <ChartCard title="Xarajat taqsimoti">
            {expensePie.length === 0 && fuelPie.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={[
                      { name: "Yoqilg'i", value: monthlyFuel },
                      { name: "Ta'mirlash", value: monthlyMaint },
                      { name: 'Boshqa', value: monthlyTotal - monthlyFuel - monthlyMaint },
                    ].filter(d => d.value > 0)} dataKey="value" cx="50%" cy="45%" outerRadius={80} innerRadius={40} paddingAngle={3}>
                      {[0, 1, 2].map(i => <Cell key={i} fill={COLORS[i]} />)}
                    </Pie>
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} contentStyle={tooltipStyle.contentStyle} />
                    <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        ) : (
          /* All branches — bar chart */
          <ChartCard title="Filiallar bo'yicha xarajat">
            {branchData.length === 0 ? (
              <div className="h-64 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={branchData} margin={{ top: 5, right: 10, bottom: 24, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#9ca3af' }} angle={-20} textAnchor="end" axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                    <Tooltip content={<CustomTooltipCurrency />} />
                    <Bar dataKey="fuel" name="Yoqilg'i" stackId="b" fill="#3B82F6" />
                    <Bar dataKey="expenses" name="Xarajat" stackId="b" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
          </ChartCard>
        )}
      </div>

      {/* Cost per km table + Driver stats */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Cost per km */}
        <ChartCard title={`1 km xarajati — so'nggi ${periodLabel}`}>
          {!costPerKm || (costPerKm as any[]).length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
              <div className="text-center">
                <Gauge className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Yo'l varaqlari ma'lumoti yo'q
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-gray-400 border-b border-gray-100 dark:border-gray-700">
                    <th className="text-left py-1.5 pr-2 font-medium">Avtomobil</th>
                    <th className="text-right py-1.5 pr-2 font-medium">Km</th>
                    <th className="text-right py-1.5 pr-2 font-medium">1 km</th>
                    <th className="text-right py-1.5 font-medium">L/100km</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                  {((costPerKm as any[]) || []).slice(0, 8).map((v: any) => (
                    <tr key={v.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-1.5 pr-2">
                        <span className="font-mono font-bold text-blue-600 dark:text-blue-400">{v.registrationNumber}</span>
                        <span className="text-gray-400 ml-1">{v.brand}</span>
                      </td>
                      <td className="text-right py-1.5 pr-2 text-gray-600 dark:text-gray-300">{v.totalKm.toLocaleString()}</td>
                      <td className="text-right py-1.5 pr-2 font-semibold text-gray-800 dark:text-gray-200">
                        {v.costPerKm > 0 ? formatCurrency(v.costPerKm) : '—'}
                      </td>
                      <td className="text-right py-1.5">
                        <span className={`px-1.5 py-0.5 rounded font-medium ${v.lPer100km > 20 ? 'bg-red-100 text-red-700' : v.lPer100km > 12 ? 'bg-yellow-100 text-yellow-700' : 'bg-green-100 text-green-700'}`}>
                          {v.lPer100km > 0 ? `${v.lPer100km}` : '—'}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ChartCard>

        {/* Driver leaderboard */}
        <ChartCard title={`Haydovchilar reytingi — so'nggi ${periodLabel}`}>
          {!driverStats || (driverStats as any[]).length === 0 ? (
            <div className="h-40 flex items-center justify-center text-gray-400 text-sm">
              <div className="text-center">
                <Users className="w-8 h-8 mx-auto mb-2 opacity-40" />
                Tugallangan reys yo'q
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {((driverStats as any[]) || []).slice(0, 6).map((d: any, i: number) => (
                <div key={i} className="flex items-center gap-3">
                  <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold flex-shrink-0 ${
                    i === 0 ? 'bg-yellow-400 text-yellow-900' : i === 1 ? 'bg-gray-300 text-gray-700' : i === 2 ? 'bg-orange-400 text-orange-900' : 'bg-gray-100 dark:bg-gray-700 text-gray-500'
                  }`}>{i + 1}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium text-gray-800 dark:text-gray-200 truncate">{d.name}</span>
                      <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{d.trips} reys</span>
                    </div>
                    <div className="flex items-center gap-3 mt-0.5">
                      <div className="flex-1 bg-gray-100 dark:bg-gray-700 rounded-full h-1.5">
                        <div
                          className="h-1.5 rounded-full bg-blue-500"
                          style={{ width: `${Math.min(100, (d.km / ((driverStats as any[])[0]?.km || 1)) * 100)}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-500 flex-shrink-0">{d.km.toLocaleString()} km</span>
                      {d.lPer100km > 0 && (
                        <span className={`text-xs flex-shrink-0 font-medium ${d.lPer100km > 20 ? 'text-red-500' : d.lPer100km > 12 ? 'text-yellow-500' : 'text-green-500'}`}>
                          {d.lPer100km} L
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ChartCard>
      </div>

      {/* 3 donuts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <ChartCard title="Xarajat kategoriyalari">
          {expensePie.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={expensePie} dataKey="value" cx="50%" cy="45%" outerRadius={65} innerRadius={32} paddingAngle={3}>
                    {expensePie.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} contentStyle={tooltipStyle.contentStyle} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Yoqilg'i turlari">
          {fuelPie.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={fuelPie} dataKey="value" cx="50%" cy="45%" outerRadius={65} innerRadius={32} paddingAngle={3}>
                    {fuelPie.map((_, i) => <Cell key={i} fill={COLORS[(i + 2) % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} contentStyle={tooltipStyle.contentStyle} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        <ChartCard title="Ta'mirlash toifalari">
          {maintPie.length === 0 ? (
            <div className="h-44 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
          ) : (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={maintPie} dataKey="value" cx="50%" cy="45%" outerRadius={65} innerRadius={32} paddingAngle={3}>
                    {maintPie.map((_, i) => <Cell key={i} fill={COLORS[(i + 4) % COLORS.length]} />)}
                  </Pie>
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} contentStyle={tooltipStyle.contentStyle} />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11 }} />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Branch cost comparison — admin only */}
      {isAdmin && branchCostData && branchCostData.length > 0 && (
        <ChartCard title="Filiallararo xarajat tahlili">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th className="py-2 pr-4 text-left font-medium">Filial</th>
                  <th className="py-2 pr-4 text-right font-medium">Mashina</th>
                  <th className="py-2 pr-4 text-right font-medium">Ta'mirlash</th>
                  <th className="py-2 pr-4 text-right font-medium">Yoqilg'i</th>
                  <th className="py-2 pr-4 text-right font-medium">Mashina boshiga</th>
                  <th className="py-2 pr-4 text-right font-medium">Og'ish</th>
                  <th className="py-2 pr-4 text-right font-medium">Motor remont</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-800">
                {branchCostData.map((row: any) => (
                  <tr key={row.branchId} className="hover:bg-gray-50 dark:hover:bg-gray-800/40">
                    <td className="py-2 pr-4 font-medium text-gray-800 dark:text-gray-200 flex items-center gap-1.5">
                      <Building2 className="w-3.5 h-3.5 text-gray-400" />
                      {row.branchName}
                    </td>
                    <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-300">{row.vehicleCount}</td>
                    <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.maintCost)}</td>
                    <td className="py-2 pr-4 text-right text-gray-600 dark:text-gray-300">{formatCurrency(row.fuelCost)}</td>
                    <td className="py-2 pr-4 text-right font-semibold text-gray-800 dark:text-gray-200">{formatCurrency(row.costPerVehicle)}</td>
                    <td className="py-2 pr-4 text-right">
                      {row.deviationPct !== null ? (
                        <span className={`font-semibold ${row.deviationPct > 15 ? 'text-red-600' : row.deviationPct < -15 ? 'text-green-600' : 'text-gray-500'}`}>
                          {row.deviationPct > 0 ? '+' : ''}{row.deviationPct}%
                        </span>
                      ) : '—'}
                    </td>
                    <td className="py-2 pr-4 text-right">
                      {row.engineOverhaulCount > 0 ? (
                        <span className={`font-semibold ${row.engineOverhaulCount >= 3 ? 'text-red-600' : 'text-yellow-600'}`}>
                          {row.engineOverhaulCount}x
                        </span>
                      ) : (
                        <span className="text-green-600">0</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </ChartCard>
      )}

      {/* Low stock alert */}
      {dash?.lowStockItems?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200 dark:border-amber-800 p-5">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2 mb-3">
            <Package className="w-4 h-4" /> Kam qolgan ehtiyot qismlar
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {dash.lowStockItems.map((item: any) => (
              <div key={item.partCode} className="bg-amber-50 dark:bg-amber-900/20 rounded-xl p-3 text-xs">
                <p className="font-semibold text-gray-800 dark:text-gray-200 truncate">{item.name}</p>
                <p className="text-gray-500 dark:text-gray-400 font-mono mt-0.5">{item.partCode}</p>
                <div className="flex items-center justify-between mt-1.5">
                  <span className="text-amber-600 dark:text-amber-400 font-bold">{item.quantityOnHand} ta</span>
                  <span className="text-gray-400">/ {item.reorderLevel}</span>
                </div>
                <p className="text-gray-400 truncate mt-0.5">{item.branch}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
