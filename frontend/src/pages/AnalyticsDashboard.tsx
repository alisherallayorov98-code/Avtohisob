import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend, CartesianGrid,
} from 'recharts'
import {
  TrendingUp, Car, Fuel, Wrench, Package, Building2,
  AlertTriangle, Calendar, ChevronDown, Activity, DollarSign,
} from 'lucide-react'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899', '#06B6D4', '#84CC16']

const PERIODS = [
  { label: '30 kun', months: 1 },
  { label: '3 oy', months: 3 },
  { label: '6 oy', months: 6 },
  { label: '1 yil', months: 12 },
]

function StatCard({
  label, value, sub, icon, color, bg,
}: { label: string; value: string | number; sub?: string; icon: React.ReactNode; color: string; bg: string }) {
  return (
    <div className={`rounded-2xl p-5 border ${bg} flex items-start gap-4`}>
      <div className={`w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 ${color}`}>
        {icon}
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide truncate">{label}</p>
        <p className="text-2xl font-bold text-gray-900 dark:text-white mt-0.5 truncate">{value}</p>
        {sub && <p className="text-xs text-gray-400 mt-0.5 truncate">{sub}</p>}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="text-base font-semibold text-gray-800 dark:text-white mb-3">{children}</h2>
}

function ChartCard({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={`bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 ${className}`}>
      <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-4">{title}</h3>
      {children}
    </div>
  )
}

const tooltipStyle = {
  contentStyle: { backgroundColor: '#1f2937', border: 'none', borderRadius: '8px', color: '#f9fafb', fontSize: 12 },
  labelStyle: { color: '#9ca3af' },
}

function CustomTooltipCurrency({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-gray-800 rounded-xl px-3 py-2 shadow-xl text-xs">
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

export default function AnalyticsDashboard() {
  const [selectedPeriod, setSelectedPeriod] = useState(3)

  const { data: dashStats } = useQuery({
    queryKey: ['report-dashboard'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data.data),
  })

  const { data: monthlyTrend, isLoading: trendLoading } = useQuery({
    queryKey: ['report-monthly-trend', selectedPeriod],
    queryFn: () => api.get('/reports/monthly-trend', { params: { months: selectedPeriod } }).then(r => r.data.data),
  })

  const { data: vehicleReport } = useQuery({
    queryKey: ['report-vehicles-analytics'],
    queryFn: () => api.get('/reports/vehicles').then(r => r.data.data),
  })

  const { data: branchReport } = useQuery({
    queryKey: ['report-branch-analytics'],
    queryFn: () => api.get('/reports/branch').then(r => r.data.data),
  })

  const { data: expenseReport } = useQuery({
    queryKey: ['report-expenses-analytics'],
    queryFn: () => api.get('/reports/expenses').then(r => r.data.data),
  })

  const { data: fuelReport } = useQuery({
    queryKey: ['report-fuel-analytics'],
    queryFn: () => api.get('/reports/fuel').then(r => r.data.data),
  })

  const { data: maintReport } = useQuery({
    queryKey: ['report-maintenance-analytics'],
    queryFn: () => api.get('/reports/maintenance').then(r => r.data.data),
  })

  // Build top-10 vehicles bar data
  const topVehicles = ((vehicleReport as any[]) || [])
    .map((v: any) => ({
      name: v.registrationNumber,
      model: `${v.brand} ${v.model}`,
      fuel: v.totalFuelCost,
      maintenance: v.totalMaintenanceCost,
      total: v.totalExpenses + v.totalFuelCost,
    }))
    .sort((a, b) => b.total - a.total)
    .slice(0, 8)

  // Expense category pie
  const expensePie = Object.entries(expenseReport?.byCategory || {}).map(([name, val]: any) => ({
    name,
    value: Number(val),
  }))

  // Fuel type pie
  const fuelPie = Object.entries(fuelReport?.byFuelType || {}).map(([name, val]: any) => ({
    name,
    value: Number((val as any).cost || val),
  }))

  // Maintenance category pie
  const maintPie = Object.entries(maintReport?.byCategory || {}).map(([name, val]: any) => ({
    name,
    value: Number(val),
  }))

  // Branch bar chart
  const branchData = ((branchReport as any[]) || []).map((b: any) => ({
    name: b.name,
    fuel: b.totalFuelCost,
    expenses: b.totalExpenses,
    vehicles: b.activeVehicles,
  }))

  const monthlyTotal = (monthlyTrend || []).reduce((s: number, m: any) => s + m.total, 0)
  const monthlyFuel = (monthlyTrend || []).reduce((s: number, m: any) => s + m.fuel, 0)
  const monthlyMaint = (monthlyTrend || []).reduce((s: number, m: any) => s + m.maintenance, 0)
  const monthlyExp = (monthlyTrend || []).reduce((s: number, m: any) => s + m.expenses, 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Activity className="w-6 h-6 text-blue-500" />
            Analitika paneli
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">Flot bo'yicha to'liq statistik tahlil</p>
        </div>
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
      </div>

      {/* KPI Cards Row 1 */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard
          label="Jami transport"
          value={dashStats?.totalVehicles ?? '—'}
          sub={`${dashStats?.activeVehicles ?? 0} ta faol`}
          icon={<Car className="w-5 h-5 text-blue-600" />}
          color="bg-blue-100 dark:bg-blue-900/30"
          bg="border-blue-100 dark:border-blue-900/30"
        />
        <StatCard
          label="Davr xarajati"
          value={formatCurrency(monthlyTotal)}
          sub={`${(monthlyTrend || []).length} oy`}
          icon={<DollarSign className="w-5 h-5 text-indigo-600" />}
          color="bg-indigo-100 dark:bg-indigo-900/30"
          bg="border-indigo-100 dark:border-indigo-900/30"
        />
        <StatCard
          label="Yoqilg'i"
          value={formatCurrency(monthlyFuel)}
          sub={`${fuelReport?.totalLiters ? Number(fuelReport.totalLiters).toFixed(0) + ' L' : ''}`}
          icon={<Fuel className="w-5 h-5 text-green-600" />}
          color="bg-green-100 dark:bg-green-900/30"
          bg="border-green-100 dark:border-green-900/30"
        />
        <StatCard
          label="Ta'mirlash"
          value={formatCurrency(monthlyMaint)}
          sub={`${maintReport?.count ?? 0} ta amal`}
          icon={<Wrench className="w-5 h-5 text-yellow-600" />}
          color="bg-yellow-100 dark:bg-yellow-900/30"
          bg="border-yellow-100 dark:border-yellow-900/30"
        />
        <StatCard
          label="Boshqa xarajat"
          value={formatCurrency(monthlyExp)}
          sub={`${expenseReport?.count ?? 0} ta yozuv`}
          icon={<TrendingUp className="w-5 h-5 text-purple-600" />}
          color="bg-purple-100 dark:bg-purple-900/30"
          bg="border-purple-100 dark:border-purple-900/30"
        />
        <StatCard
          label="Kam ombor"
          value={dashStats?.lowStockCount ?? '—'}
          sub={`${dashStats?.overdueMaintenanceCount ?? 0} ta kechikkan`}
          icon={<AlertTriangle className="w-5 h-5 text-red-500" />}
          color="bg-red-100 dark:bg-red-900/30"
          bg="border-red-100 dark:border-red-900/30"
        />
      </div>

      {/* Monthly Trend - full width */}
      <ChartCard title={`Oylik xarajat trendi — so'nggi ${selectedPeriod === 1 ? '30 kun' : selectedPeriod === 3 ? '3 oy' : selectedPeriod === 6 ? '6 oy' : '12 oy'}`}>
        {trendLoading ? (
          <div className="h-56 flex items-center justify-center">
            <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={monthlyTrend || []} margin={{ top: 5, right: 10, bottom: 5, left: 5 }}>
                <defs>
                  <linearGradient id="colorFuel" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#3B82F6" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorMaint" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10B981" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorExp" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#F59E0B" stopOpacity={0.25} />
                    <stop offset="95%" stopColor="#F59E0B" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#9ca3af' }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                <Tooltip content={<CustomTooltipCurrency />} />
                <Legend wrapperStyle={{ fontSize: 12 }} formatter={(v) => v === 'fuel' ? "Yoqilg'i" : v === 'maintenance' ? "Ta'mirlash" : 'Boshqa'} />
                <Area type="monotone" dataKey="fuel" name="fuel" stroke="#3B82F6" strokeWidth={2} fill="url(#colorFuel)" />
                <Area type="monotone" dataKey="maintenance" name="maintenance" stroke="#10B981" strokeWidth={2} fill="url(#colorMaint)" />
                <Area type="monotone" dataKey="expenses" name="expenses" stroke="#F59E0B" strokeWidth={2} fill="url(#colorExp)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </ChartCard>

      {/* Middle row: Top vehicles + Branch comparison */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Top vehicles horizontal bar */}
        <ChartCard title="Top 8 avtomobil — xarajat bo'yicha">
          {topVehicles.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={topVehicles} layout="vertical" margin={{ top: 0, right: 10, bottom: 0, left: 10 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} horizontal={false} />
                  <XAxis type="number" tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, fill: '#374151' }} width={72} axisLine={false} tickLine={false} />
                  <Tooltip content={<CustomTooltipCurrency />} />
                  <Bar dataKey="fuel" name="Yoqilg'i" stackId="a" fill="#3B82F6" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="maintenance" name="Ta'mirlash" stackId="a" fill="#10B981" radius={[0, 4, 4, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>

        {/* Branch comparison */}
        <ChartCard title="Filiallar bo'yicha xarajat">
          {branchData.length === 0 ? (
            <div className="h-56 flex items-center justify-center text-gray-400 text-sm">Ma'lumot yo'q</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={branchData} margin={{ top: 5, right: 10, bottom: 20, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} vertical={false} />
                  <XAxis dataKey="name" tick={{ fontSize: 11, fill: '#9ca3af' }} angle={-25} textAnchor="end" axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: '#9ca3af' }} axisLine={false} tickLine={false} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                  <Tooltip content={<CustomTooltipCurrency />} />
                  <Bar dataKey="fuel" name="Yoqilg'i" stackId="b" fill="#3B82F6" />
                  <Bar dataKey="expenses" name="Xarajatlar" stackId="b" fill="#F59E0B" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </ChartCard>
      </div>

      {/* Bottom row: 3 donuts */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Expense by category */}
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

        {/* Fuel by type */}
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

        {/* Maintenance by category */}
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

      {/* Low stock alert */}
      {dashStats?.lowStockItems?.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-amber-200 dark:border-amber-800 p-5">
          <h3 className="text-sm font-semibold text-amber-700 dark:text-amber-400 flex items-center gap-2 mb-3">
            <Package className="w-4 h-4" /> Kam qolgan ehtiyot qismlar
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {dashStats.lowStockItems.map((item: any) => (
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
