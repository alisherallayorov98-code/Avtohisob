import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useTranslation } from 'react-i18next'
import {
  Truck, DollarSign, Package, AlertTriangle, Fuel, Wrench,
  HeartPulse, CalendarClock, AlertOctagon, Lightbulb, ArrowRight,
  TrendingUp, CheckCircle2, Circle, X, ChevronDown, ChevronUp,
  ShieldAlert, Plus, Zap, ClipboardList, BarChart2, Satellite, Droplets,
} from 'lucide-react'
import { Link, useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import api from '../lib/api'
import { getSocket } from '../lib/socket'
import { StatCard } from '../components/ui/Card'
import Badge from '../components/ui/Badge'
import { formatCurrency, formatDate } from '../lib/utils'

// Grade ranglari (label'lar t() orqali tarjima qilinadi)
const GRADE_CONFIG: Record<string, { tKey: string; color: string }> = {
  excellent: { tKey: 'dashboard.grades.excellent', color: 'bg-green-500' },
  good:      { tKey: 'dashboard.grades.good',      color: 'bg-emerald-400' },
  fair:      { tKey: 'dashboard.grades.fair',      color: 'bg-yellow-400' },
  poor:      { tKey: 'dashboard.grades.poor',      color: 'bg-orange-400' },
  critical:  { tKey: 'dashboard.grades.critical',  color: 'bg-red-500' },
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

const CHECKLIST_KEY = 'avtohisob_onboarding_done'
const CHECKLIST_ITEMS = [
  { id: 'vehicle',    tKey: 'dashboard.checklist.addVehicle',    path: '/vehicles',    icon: '🚗' },
  { id: 'fuel',       tKey: 'dashboard.checklist.addFuel',       path: '/fuel',        icon: '⛽' },
  { id: 'maintenance',tKey: 'dashboard.checklist.addMaintenance',path: '/maintenance', icon: '🔧' },
  { id: 'report',     tKey: 'dashboard.checklist.viewReport',    path: '/reports',     icon: '📊' },
  { id: 'spare_part', tKey: 'dashboard.checklist.addSparePart',  path: '/spare-parts', icon: '🔩' },
  { id: 'invite',     tKey: 'dashboard.checklist.viewSettings',  path: '/settings',    icon: '⚙️' },
]

function OnboardingChecklist({ stats }: { stats: any }) {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const [dismissed, setDismissed] = useState(() => localStorage.getItem(CHECKLIST_KEY) === 'true')
  const [collapsed, setCollapsed] = useState(false)

  const completed: Record<string, boolean> = {
    vehicle: (stats?.totalVehicles || 0) > 0,
    fuel: (stats?.totalFuelCost || stats?.monthlyFuelCost || 0) > 0,
    maintenance: (stats?.totalMaintenanceCost || stats?.monthlyMaintenanceCost || 0) > 0,
    report: (stats?.totalVehicles || 0) > 0 && (stats?.totalExpenses || 0) > 0,
    spare_part: (stats?.lowStockItems?.length >= 0 && stats !== undefined),
    invite: localStorage.getItem('settings_visited') === 'true',
  }

  const doneCount = Object.values(completed).filter(Boolean).length
  const pct = Math.round((doneCount / CHECKLIST_ITEMS.length) * 100)
  if (dismissed || pct === 100) return null

  return (
    <div className="bg-white dark:bg-gray-800 border border-blue-200 dark:border-blue-800 rounded-xl overflow-hidden shadow-sm">
      <div className="flex items-center justify-between px-4 py-3 bg-blue-50 dark:bg-blue-900/30 cursor-pointer" onClick={() => setCollapsed(c => !c)}>
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <svg className="w-8 h-8 -rotate-90" viewBox="0 0 32 32">
              <circle cx="16" cy="16" r="14" fill="none" stroke="#DBEAFE" strokeWidth="3" />
              <circle cx="16" cy="16" r="14" fill="none" stroke="#3B82F6" strokeWidth="3"
                strokeDasharray={`${pct * 0.88} 88`} strokeLinecap="round" />
            </svg>
            <span className="absolute inset-0 flex items-center justify-center text-[10px] font-bold text-blue-600">{pct}%</span>
          </div>
          <div>
            <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">{t('dashboard.checklist.title')}</p>
            <p className="text-xs text-blue-600 dark:text-blue-400">{t('dashboard.checklist.completed', { done: doneCount, total: CHECKLIST_ITEMS.length })}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {collapsed ? <ChevronDown className="w-4 h-4 text-blue-500" /> : <ChevronUp className="w-4 h-4 text-blue-500" />}
          <button onClick={e => { e.stopPropagation(); localStorage.setItem(CHECKLIST_KEY, 'true'); setDismissed(true) }}
            className="text-blue-400 hover:text-blue-600 p-1 rounded">
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
      {!collapsed && (
        <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
          {CHECKLIST_ITEMS.map(item => (
            <button key={item.id} onClick={() => navigate(item.path)}
              className="flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors text-left">
              {completed[item.id]
                ? <CheckCircle2 className="w-5 h-5 text-green-500 flex-shrink-0" />
                : <Circle className="w-5 h-5 text-gray-300 flex-shrink-0" />}
              <span className="text-sm">{item.icon}</span>
              <span className={`text-sm ${completed[item.id] ? 'line-through text-gray-400' : 'text-gray-700 dark:text-gray-300'}`}>{t(item.tKey)}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

const QUICK_ACTIONS = [
  { tKey: 'dashboard.quickActions.addFuel',    icon: <Fuel className="w-4 h-4" />,         path: '/fuel',        color: 'text-yellow-600 bg-yellow-50 hover:bg-yellow-100 dark:bg-yellow-900/20 dark:hover:bg-yellow-900/40 border-yellow-200 dark:border-yellow-800' },
  { tKey: 'dashboard.quickActions.maintenance',icon: <Wrench className="w-4 h-4" />,       path: '/maintenance', color: 'text-blue-600 bg-blue-50 hover:bg-blue-100 dark:bg-blue-900/20 dark:hover:bg-blue-900/40 border-blue-200 dark:border-blue-800' },
  { tKey: 'dashboard.quickActions.addPart',    icon: <Plus className="w-4 h-4" />,         path: '/spare-parts', color: 'text-purple-600 bg-purple-50 hover:bg-purple-100 dark:bg-purple-900/20 dark:hover:bg-purple-900/40 border-purple-200 dark:border-purple-800' },
  { tKey: 'dashboard.quickActions.report',     icon: <BarChart2 className="w-4 h-4" />,    path: '/reports',     color: 'text-green-600 bg-green-50 hover:bg-green-100 dark:bg-green-900/20 dark:hover:bg-green-900/40 border-green-200 dark:border-green-800' },
  { tKey: 'dashboard.quickActions.addVehicle', icon: <Truck className="w-4 h-4" />,        path: '/vehicles',    color: 'text-gray-600 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 border-gray-200 dark:border-gray-600' },
  { tKey: 'dashboard.quickActions.import',     icon: <ClipboardList className="w-4 h-4" />,path: '/import',      color: 'text-orange-600 bg-orange-50 hover:bg-orange-100 dark:bg-orange-900/20 dark:hover:bg-orange-900/40 border-orange-200 dark:border-orange-800' },
]

export default function Dashboard() {
  const { t } = useTranslation()
  const qc = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['dashboard'],
    queryFn: () => api.get('/reports/dashboard').then(r => r.data.data),
  })

  const { data: analyticsOverview } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => api.get('/analytics/overview').then(r => r.data.data),
  })

  const { data: healthData } = useQuery({
    queryKey: ['health-scores'],
    queryFn: () => api.get('/analytics/health-scores').then(r => r.data.data),
  })

  const { data: predictionsData } = useQuery({
    queryKey: ['predictions'],
    queryFn: () => api.get('/analytics/predictions').then(r => r.data.data),
  })

  const { data: recsData } = useQuery({
    queryKey: ['recommendations', '', ''],
    queryFn: () => api.get('/analytics/recommendations', { params: { limit: 3 } }).then(r => r.data.data),
  })

  const { data: fuelTrends } = useQuery({
    queryKey: ['fuel-trends-dashboard'],
    queryFn: () => api.get('/analytics/fuel').then(r => r.data.data?.trends ?? []),
  })

  const { data: activeWaybills } = useQuery({
    queryKey: ['active-waybills-dashboard'],
    queryFn: () => api.get('/waybills', { params: { status: 'active', limit: 5 } }).then(r => r.data.data),
    refetchInterval: 60000,
  })

  const { data: dueServiceIntervals } = useQuery({
    queryKey: ['due-service-dashboard'],
    queryFn: () => api.get('/service-intervals/due').then(r => (r.data?.intervals || r.data) as any[]),
    staleTime: 120000,
  })

  const { data: gpsStatus } = useQuery({
    queryKey: ['gps-status'],
    queryFn: () => api.get('/gps/status').then(r => r.data.data),
    staleTime: 300000,
  })

  const { data: oilSummary } = useQuery({
    queryKey: ['oil-summary-dashboard'],
    queryFn: () => api.get('/oil-change/overview').then(r => r.data.summary as { total: number; ok: number; due_soon: number; overdue: number; no_data: number }),
    staleTime: 300000,
  })

  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const refresh = () => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      qc.invalidateQueries({ queryKey: ['analytics-overview'] })
    }
    socket.on('health:updated', refresh)
    socket.on('anomaly:new', refresh)
    return () => { socket.off('health:updated', refresh); socket.off('anomaly:new', refresh) }
  }, [qc])

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const stats = data || {}
  const overview = analyticsOverview || {}
  const vehicles = healthData || []
  const predictions = predictionsData || []
  const recs = recsData || []
  const trends: any[] = fuelTrends || []

  const lastTrend = trends[trends.length - 1]
  const prevTrend = trends[trends.length - 2]
  const fuelTrendPct = lastTrend && prevTrend && prevTrend.cost > 0
    ? (((lastTrend.cost - prevTrend.cost) / prevTrend.cost) * 100) : null

  const gradeCounts = Object.entries(GRADE_CONFIG).map(([grade, cfg]) => ({
    grade, label: t(cfg.tKey), color: cfg.color,
    count: vehicles.filter((v: any) => v.latestScore?.grade === grade).length,
  }))

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('dashboard.title')}</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">{t('dashboard.subtitle')}</p>
      </div>

      {/* Onboarding checklist */}
      <OnboardingChecklist stats={stats} />

      {/* Alerts row */}
      <div className="space-y-2">
        {(() => {
          const overdueCount = (dueServiceIntervals || []).filter((i: any) => i.status === 'overdue').length
          return overdueCount > 0 ? (
            <Link to="/vehicles" className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-3 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
              <Wrench className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm font-medium text-red-800 dark:text-red-200 flex-1">
                {t('dashboard.alerts.overdueServiceCount', { count: overdueCount })}
              </p>
              <ArrowRight className="w-4 h-4 text-red-400" />
            </Link>
          ) : null
        })()}
        {(activeWaybills?.length || 0) > 0 && (
          <Link to="/waybills" className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl px-4 py-3 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
            <ClipboardList className="w-5 h-5 text-blue-500 flex-shrink-0" />
            <p className="text-sm font-medium text-blue-800 dark:text-blue-200 flex-1">
              {t('dashboard.alerts.activeWaybills', { count: activeWaybills.length })}
            </p>
            <ArrowRight className="w-4 h-4 text-blue-400" />
          </Link>
        )}
        {(stats.overdueMaintenanceCount || 0) > 0 && (
          <Link to="/predictions" className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl px-4 py-3 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
            <p className="text-sm font-medium text-red-800 dark:text-red-200 flex-1">
              {t('dashboard.alerts.overdueMaintenance', { count: stats.overdueMaintenanceCount })}
            </p>
            <ArrowRight className="w-4 h-4 text-red-400" />
          </Link>
        )}
        {(stats.expiringWarrantiesCount || 0) > 0 && (
          <Link to="/warranties" className="flex items-center gap-3 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl px-4 py-3 hover:bg-yellow-100 dark:hover:bg-yellow-900/30 transition-colors">
            <ShieldAlert className="w-5 h-5 text-yellow-500 flex-shrink-0" />
            <p className="text-sm font-medium text-yellow-800 dark:text-yellow-200 flex-1">
              {t('dashboard.alerts.expiringWarranties', { count: stats.expiringWarrantiesCount })}
            </p>
            <ArrowRight className="w-4 h-4 text-yellow-400" />
          </Link>
        )}
      </div>

      {/* KPI Cards — 6 cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        <StatCard label={t('dashboard.stat.totalVehicles')} value={stats.totalVehicles || 0}
          sub={`${stats.activeVehicles || 0} ${t('dashboard.stat.active')}${stats.maintenanceVehicles > 0 ? ` · ${stats.maintenanceVehicles} ${t('dashboard.stat.underMaintenance')}` : ''}`}
          icon={<Truck className="w-5 h-5" />} color="blue" />
        <StatCard label={t('dashboard.stat.monthlyExpenses')} value={formatCurrency(stats.monthlyExpenses || 0)}
          sub={t('dashboard.stat.currentMonth')} icon={<DollarSign className="w-5 h-5" />} color="green" />
        <StatCard label={t('dashboard.stat.fuel')} value={formatCurrency(stats.monthlyFuelCost || 0)}
          sub={t('dashboard.stat.currentMonth')} icon={<Fuel className="w-5 h-5" />} color="yellow"
          trend={fuelTrendPct !== null ? `${Math.abs(fuelTrendPct).toFixed(1)}%` : undefined}
          trendUp={fuelTrendPct !== null ? fuelTrendPct <= 0 : undefined}
        />
        <StatCard label={t('dashboard.stat.maintenance')} value={formatCurrency(stats.monthlyMaintenanceCost || 0)}
          sub={t('dashboard.stat.currentMonth')} icon={<Wrench className="w-5 h-5" />} color="blue" />
        <StatCard label={t('dashboard.stat.lowStock')} value={stats.lowStockCount || 0}
          sub={t('dashboard.stat.spareParts')} icon={<AlertTriangle className="w-5 h-5" />}
          color={stats.lowStockCount > 0 ? 'red' : 'green'} />
        <StatCard label={t('dashboard.stat.warehouseValue')} value={formatCurrency(stats.totalInventoryValue || 0)}
          sub={t('dashboard.stat.total')} icon={<Package className="w-5 h-5" />} color="green" />
      </div>

      {/* GPS Status widget — faqat GPS ulangan bo'lsa ko'rsatamiz */}
      {gpsStatus && (
        <Link to="/gps" className="block">
          <div className={`rounded-xl border px-5 py-3.5 flex items-center justify-between gap-4 transition-colors hover:opacity-90 ${
            gpsStatus.lastSyncStatus === 'error'
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800'
          }`}>
            <div className="flex items-center gap-3">
              <Satellite className={`w-5 h-5 flex-shrink-0 ${gpsStatus.lastSyncStatus === 'error' ? 'text-red-500' : 'text-green-600'}`} />
              <div>
                <span className="font-medium text-gray-900 dark:text-white text-sm">{t('dashboard.gps.connected')}</span>
                <span className="text-xs text-gray-500 dark:text-gray-400 ml-2">{gpsStatus.username} · {gpsStatus.host}</span>
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-400">
              {gpsStatus.lastSyncAt && (
                <span>{t('dashboard.gps.lastSync')}: {new Date(gpsStatus.lastSyncAt).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              )}
              <span className={`font-medium ${gpsStatus.lastSyncStatus === 'ok' ? 'text-green-600' : gpsStatus.lastSyncStatus === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
                {gpsStatus.lastSyncStatus === 'ok' ? t('dashboard.gps.statusOk') : gpsStatus.lastSyncStatus === 'error' ? t('dashboard.gps.statusError') : t('dashboard.gps.statusPending')}
              </span>
              <ArrowRight className="w-4 h-4" />
            </div>
          </div>
        </Link>
      )}

      {/* Oil Change widget */}
      {oilSummary && (oilSummary.overdue > 0 || oilSummary.due_soon > 0) && (
        <Link to="/oil-change" className="block">
          <div className={`rounded-xl border px-5 py-3.5 flex items-center justify-between gap-4 transition-colors hover:opacity-90 ${
            oilSummary.overdue > 0
              ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800'
              : 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800'
          }`}>
            <div className="flex items-center gap-3">
              <Droplets className={`w-5 h-5 flex-shrink-0 ${oilSummary.overdue > 0 ? 'text-red-500' : 'text-yellow-600'}`} />
              <div>
                <span className="font-medium text-gray-900 dark:text-white text-sm">{t('dashboard.oilChange.title')}</span>
                <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  {oilSummary.overdue > 0 && <span className="text-red-600 font-medium">{t('dashboard.oilChange.overdue', { count: oilSummary.overdue })}</span>}
                  {oilSummary.overdue > 0 && oilSummary.due_soon > 0 && ' · '}
                  {oilSummary.due_soon > 0 && <span className="text-yellow-600">{t('dashboard.oilChange.dueSoon', { count: oilSummary.due_soon })}</span>}
                </div>
              </div>
            </div>
            <ArrowRight className="w-4 h-4 text-gray-400" />
          </div>
        </Link>
      )}

      {/* Quick Actions */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-3">
          <Zap className="w-4 h-4 text-blue-500" />
          <h3 className="font-semibold text-gray-900 dark:text-white text-sm">{t('dashboard.quickActions.title')}</h3>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {QUICK_ACTIONS.map(a => (
            <Link key={a.path} to={a.path}
              className={`flex flex-col items-center gap-1.5 px-2 py-3 rounded-xl border text-xs font-medium transition-colors ${a.color}`}>
              {a.icon}
              <span className="text-center leading-tight">{t(a.tKey)}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* Analytics alerts */}
      {(overview.criticalCount > 0 || overview.openAnomalies > 0 || overview.upcomingPredictions > 0) && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {overview.criticalCount > 0 && (
            <Link to="/vehicle-health" className="flex items-center gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors">
              <HeartPulse className="w-8 h-8 text-red-500 flex-shrink-0" />
              <div>
                <div className="text-2xl font-bold text-red-600">{overview.criticalCount}</div>
                <div className="text-xs text-red-700 dark:text-red-300">{t('dashboard.analyticsAlerts.criticalCount')}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-red-400 ml-auto" />
            </Link>
          )}
          {overview.openAnomalies > 0 && (
            <Link to="/anomalies" className="flex items-center gap-3 bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-700 rounded-xl p-4 hover:bg-orange-100 dark:hover:bg-orange-900/30 transition-colors">
              <AlertOctagon className="w-8 h-8 text-orange-500 flex-shrink-0" />
              <div>
                <div className="text-2xl font-bold text-orange-600">{overview.openAnomalies}</div>
                <div className="text-xs text-orange-700 dark:text-orange-300">{t('dashboard.analyticsAlerts.openAnomalies')}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-orange-400 ml-auto" />
            </Link>
          )}
          {overview.upcomingPredictions > 0 && (
            <Link to="/predictions" className="flex items-center gap-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 hover:bg-blue-100 dark:hover:bg-blue-900/30 transition-colors">
              <CalendarClock className="w-8 h-8 text-blue-500 flex-shrink-0" />
              <div>
                <div className="text-2xl font-bold text-blue-600">{overview.upcomingPredictions}</div>
                <div className="text-xs text-blue-700 dark:text-blue-300">{t('dashboard.analyticsAlerts.upcomingPredictions')}</div>
              </div>
              <ArrowRight className="w-4 h-4 text-blue-400 ml-auto" />
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fleet Health Overview */}
        {vehicles.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <HeartPulse className="w-5 h-5 text-rose-500" />
                <h3 className="font-semibold text-gray-900 dark:text-white">{t('dashboard.fleetHealth')}</h3>
              </div>
              <Link to="/vehicle-health" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                Barchasi <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="p-5">
              <div className="flex h-4 rounded-full overflow-hidden mb-3">
                {gradeCounts.filter(g => g.count > 0).map(g => (
                  <div key={g.grade} className={g.color}
                    style={{ width: `${(g.count / vehicles.length) * 100}%` }}
                    title={`${g.label}: ${g.count}`} />
                ))}
              </div>
              <div className="flex flex-wrap gap-3">
                {gradeCounts.filter(g => g.count > 0).map(g => (
                  <div key={g.grade} className="flex items-center gap-1.5 text-xs">
                    <div className={`w-3 h-3 rounded-full ${g.color}`} />
                    <span className="text-gray-600 dark:text-gray-300">{g.label}: <span className="font-bold">{g.count}</span></span>
                  </div>
                ))}
              </div>
              <div className="mt-3 space-y-1.5">
                {vehicles
                  .filter((v: any) => v.latestScore && ['critical', 'poor'].includes(v.latestScore.grade))
                  .slice(0, 3)
                  .map((v: any) => (
                    <div key={v.vehicleId} className="flex items-center justify-between text-xs bg-red-50 dark:bg-red-900/20 rounded-lg px-2 py-1.5">
                      <span className="font-medium text-gray-800 dark:text-gray-200">{v.registrationNumber} — {v.brand} {v.model}</span>
                      <span className="font-bold text-red-600">{Number(v.latestScore.score).toFixed(0)}</span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}

        {/* Upcoming Predictions */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <CalendarClock className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('dashboard.upcomingService')}</h3>
            </div>
            <Link to="/predictions" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
              Barchasi <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {predictions.length === 0 ? (
              <p className="py-8 text-center text-gray-400 dark:text-gray-500 text-sm">{t('dashboard.noPredictions')}</p>
            ) : predictions.slice(0, 5).map((p: any) => {
              const days = daysUntil(p.predictedDate)
              return (
                <div key={p.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{p.vehicle?.registrationNumber}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{p.partCategory} • {formatDate(p.predictedDate)}</p>
                  </div>
                  <Badge variant={days < 0 ? 'danger' : days <= 7 ? 'danger' : days <= 14 ? 'warning' : 'info'}>
                    {days < 0 ? `${Math.abs(days)} kun o'tdi` : `${days} kun`}
                  </Badge>
                </div>
              )
            })}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Maintenance */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Wrench className="w-5 h-5 text-blue-500" />
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('dashboard.recentMaintenance')}</h3>
            </div>
            <Link to="/maintenance" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
              Barchasi <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(stats.recentMaintenance || []).length === 0
              ? <p className="py-8 text-center text-gray-400 dark:text-gray-500 text-sm">{t('dashboard.noData')}</p>
              : (stats.recentMaintenance || []).map((m: any) => (
                <div key={m.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{m.vehicle?.registrationNumber}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{m.sparePart?.name} &bull; {m.quantityUsed} ta</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(Number(m.cost))}</p>
                    <p className="text-xs text-gray-400">{formatDate(m.installationDate)}</p>
                  </div>
                </div>
              ))
            }
          </div>
        </div>

        {/* AI Recommendations */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-yellow-500" />
              <h3 className="font-semibold text-gray-900 dark:text-white">{t('dashboard.topRecommendations')}</h3>
            </div>
            <Link to="/recommendations" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
              {t('dashboard.viewAll')} <ArrowRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {recs.length === 0 ? (
              <p className="py-8 text-center text-gray-400 dark:text-gray-500 text-sm">{t('dashboard.noRecommendations')}</p>
            ) : recs.map((r: any) => (
              <div key={r.id} className="px-5 py-3 flex items-start gap-3">
                <Badge variant={r.priority === 'critical' || r.priority === 'high' ? 'danger' : r.priority === 'medium' ? 'warning' : 'info'} className="flex-shrink-0 mt-0.5">
                  {r.priority === 'critical' ? t('dashboard.priority.critical') : r.priority === 'high' ? t('dashboard.priority.high') : r.priority === 'medium' ? t('dashboard.priority.medium') : t('dashboard.priority.low')}
                </Badge>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 dark:text-white truncate">{r.title}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 line-clamp-1">{r.description}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Fuel Trends Chart */}
        {trends.length > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-blue-500" />
                <h3 className="font-semibold text-gray-900 dark:text-white">{t('dashboard.fuelDynamics')}</h3>
              </div>
              <Link to="/fuel-analytics" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                {t('dashboard.viewMore')} <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="h-44">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trends} margin={{ top: 0, right: 5, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#9CA3AF' }} />
                  <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#1F2937', border: 'none', borderRadius: 8, color: '#F3F4F6', fontSize: 12 }}
                    formatter={(v: any) => [formatCurrency(Number(v)), t('dashboard.expense')]}
                  />
                  <Bar dataKey="cost" name={t('dashboard.expense')} fill="#3B82F6" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Low Stock Items */}
        {(stats.lowStockCount || 0) > 0 && (
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
            <div className="p-5 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <AlertTriangle className="w-5 h-5 text-red-500" />
                <h3 className="font-semibold text-gray-900 dark:text-white">{t('dashboard.lowStockItems')}</h3>
                <span className="bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs font-bold px-2 py-0.5 rounded-full">{stats.lowStockCount}</span>
              </div>
              <Link to="/inventory" className="text-xs text-blue-500 hover:underline flex items-center gap-1">
                {t('dashboard.warehouseLink')} <ArrowRight className="w-3 h-3" />
              </Link>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700">
              {(stats.lowStockItems || []).map((item: any, i: number) => (
                <div key={i} className="px-5 py-2.5 flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{item.partCode} · {item.branch}</p>
                  </div>
                  <div className="text-right">
                    <span className="text-sm font-bold text-red-600">{item.quantityOnHand}</span>
                    <span className="text-xs text-gray-400"> / {item.reorderLevel} {t('dashboard.minSuffix')}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Inventory Value banner */}
      <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-5 text-white">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <p className="text-blue-100 text-sm">{t('dashboard.totalWarehouseValue')}</p>
            <p className="text-3xl font-bold mt-1">{formatCurrency(stats.totalInventoryValue || 0)}</p>
          </div>
          <div className="flex items-center gap-4">
            <div>
              <p className="text-blue-200 text-xs">{t('dashboard.monthlyFuel')}</p>
              <p className="text-lg font-bold">{formatCurrency(stats.monthlyFuelCost || 0)}</p>
            </div>
            <div>
              <p className="text-blue-200 text-xs">{t('dashboard.monthlyMaintenance')}</p>
              <p className="text-lg font-bold">{formatCurrency(stats.monthlyMaintenanceCost || 0)}</p>
            </div>
            <Package className="w-10 h-10 text-blue-300" />
          </div>
        </div>
      </div>
    </div>
  )
}
