import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import {
  ShieldAlert, AlertTriangle, CheckCircle, Wrench, ShieldCheck,
  Settings, ChevronDown, ChevronUp, RefreshCw, Truck,
} from 'lucide-react'
import api from '../lib/api'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Summary {
  totalVehicles: number
  vehiclesWithIssues: number
  criticalHealth: number
  poorHealth: number
  overduePredictions: number
  upcomingPredictions: number
  expiringWarranties: number
  overdueServices: number
  dueSoonServices: number
}

interface Prediction {
  id: string
  partCategory: string
  predictedDate: string
  isOverdue: boolean
  confidence: number
}

interface WarrantyItem {
  id: string
  partName: string
  endDate: string
}

interface ServiceItem {
  id: string
  serviceType: string
  status: string
  nextDueDate: string | null
}

interface VehicleIssue {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  branchName: string | null
  healthScore: { score: number; grade: string } | null
  predictions: Prediction[]
  warranties: WarrantyItem[]
  services: ServiceItem[]
  severity: number
}

interface FleetStatusData {
  summary: Summary
  issues: VehicleIssue[]
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<string, string> = {
  excellent: 'text-green-600',
  good:      'text-green-500',
  fair:      'text-yellow-500',
  poor:      'text-orange-500',
  critical:  'text-red-600',
}
const GRADE_LABELS: Record<string, string> = {
  excellent: 'A\'lo',
  good:      'Yaxshi',
  fair:      "O'rtacha",
  poor:      'Yomon',
  critical:  'Kritik',
}
const CATEGORY_LABELS: Record<string, string> = {
  filters:      'Filtrlar',
  brakes:       'Tormoz',
  oils:         "Moylar",
  electrical:   'Elektr',
  engine:       'Dvigatel',
  body:         'Kuzov',
  tires:        'Shinalar',
  transmission: 'Transmissiya',
  suspension:   'Osilgi',
  cooling:      'Sovutish',
  exhaust:      'Egzoz',
  fuel:         "Yoqilg'i",
  other:        'Boshqa',
}
const SERVICE_LABELS: Record<string, string> = {
  oil_change:   'Motor yog\'i',
  air_filter:   'Havo filtri',
  fuel_filter:  "Yoqilg'i filtri",
  gearbox_oil:  'Karobka yog\'i',
  coolant:      'Sovutklar',
  brake_fluid:  'Tormoz suyuqligi',
  timing_belt:  'Gaz taqsimot tasma',
  spark_plug:   'Buji',
  brake_pads:   'Tormoz kolodkasi',
}

function daysUntil(dateStr: string) {
  const diff = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(diff / (1000 * 60 * 60 * 24))
}

function vehicleSeverityColor(issue: VehicleIssue) {
  const grade = issue.healthScore?.grade
  const hasOverdue = issue.predictions.some(p => p.isOverdue) ||
    issue.services.some(s => s.status === 'overdue')
  if (grade === 'critical' || hasOverdue) return 'border-red-300 dark:border-red-800 bg-red-50/40 dark:bg-red-900/10'
  if (grade === 'poor' || issue.predictions.length > 0 || issue.services.length > 0)
    return 'border-amber-300 dark:border-amber-800 bg-amber-50/40 dark:bg-amber-900/10'
  return 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
}

function vehicleStatusIcon(issue: VehicleIssue) {
  const grade = issue.healthScore?.grade
  const hasOverdue = issue.predictions.some(p => p.isOverdue) || issue.services.some(s => s.status === 'overdue')
  if (grade === 'critical' || hasOverdue) return <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0" />
  return <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0" />
}

// ─── Vehicle Card ─────────────────────────────────────────────────────────────

function VehicleCard({ issue }: { issue: VehicleIssue }) {
  const [expanded, setExpanded] = useState(false)
  const navigate = useNavigate()
  const borderClass = vehicleSeverityColor(issue)

  const overdueCount = issue.predictions.filter(p => p.isOverdue).length +
    issue.services.filter(s => s.status === 'overdue').length

  return (
    <div className={`rounded-xl border ${borderClass} overflow-hidden transition-all`}>
      {/* Header row */}
      <button
        onClick={() => setExpanded(o => !o)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:opacity-90 transition-opacity"
      >
        {vehicleStatusIcon(issue)}

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 dark:text-white">{issue.registrationNumber}</span>
            <span className="text-sm text-gray-500">{issue.brand} {issue.model}</span>
            {issue.branchName && (
              <span className="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">
                {issue.branchName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-3 mt-0.5 flex-wrap">
            {issue.healthScore && (
              <span className={`text-xs font-medium ${GRADE_COLORS[issue.healthScore.grade] || 'text-gray-500'}`}>
                Holat: {issue.healthScore.score}/100 ({GRADE_LABELS[issue.healthScore.grade]})
              </span>
            )}
            {overdueCount > 0 && (
              <span className="text-xs text-red-600 font-medium">{overdueCount} ta muddati o'tgan</span>
            )}
            <span className="text-xs text-gray-400">
              {issue.predictions.length + issue.warranties.length + issue.services.length} ta muammo
            </span>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={e => { e.stopPropagation(); navigate(`/vehicles/${issue.vehicleId}`) }}
            className="text-xs text-blue-600 hover:text-blue-700 font-medium px-2 py-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          >
            Batafsil
          </button>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-200 dark:border-gray-700 px-4 py-3 space-y-2.5 bg-white/60 dark:bg-gray-800/60">
          {/* Predictions */}
          {issue.predictions.map(p => (
            <div key={p.id} className="flex items-start gap-2">
              <Wrench className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${p.isOverdue ? 'text-red-500' : 'text-amber-500'}`} />
              <div className="flex-1 text-sm">
                <span className={p.isOverdue ? 'text-red-700 dark:text-red-400 font-medium' : 'text-amber-700 dark:text-amber-400'}>
                  {CATEGORY_LABELS[p.partCategory] || p.partCategory}
                </span>
                <span className="text-gray-400 ml-1.5 text-xs">
                  {p.isOverdue
                    ? `${Math.abs(daysUntil(p.predictedDate))} kun o'tdi`
                    : `${daysUntil(p.predictedDate)} kun qoldi`}
                </span>
              </div>
              <button
                onClick={() => navigate('/maintenance')}
                className="text-xs text-blue-500 hover:underline flex-shrink-0"
              >
                Ta'mirlash →
              </button>
            </div>
          ))}

          {/* Services */}
          {issue.services.map(s => (
            <div key={s.id} className="flex items-start gap-2">
              <Settings className={`w-3.5 h-3.5 mt-0.5 flex-shrink-0 ${s.status === 'overdue' ? 'text-red-500' : 'text-amber-500'}`} />
              <div className="flex-1 text-sm">
                <span className={s.status === 'overdue' ? 'text-red-700 dark:text-red-400 font-medium' : 'text-amber-700 dark:text-amber-400'}>
                  {SERVICE_LABELS[s.serviceType] || s.serviceType}
                </span>
                <span className={`ml-1.5 text-xs ${s.status === 'overdue' ? 'text-red-400' : 'text-amber-400'}`}>
                  {s.status === 'overdue' ? '(muddati o\'tgan)' : '(yaqinlashmoqda)'}
                </span>
              </div>
              <button
                onClick={() => navigate('/oil-change')}
                className="text-xs text-blue-500 hover:underline flex-shrink-0"
              >
                Ko'rish →
              </button>
            </div>
          ))}

          {/* Warranties */}
          {issue.warranties.map(w => (
            <div key={w.id} className="flex items-start gap-2">
              <ShieldCheck className="w-3.5 h-3.5 mt-0.5 flex-shrink-0 text-amber-500" />
              <div className="flex-1 text-sm">
                <span className="text-amber-700 dark:text-amber-400">{w.partName}</span>
                <span className="text-gray-400 ml-1.5 text-xs">
                  {daysUntil(w.endDate)} kun qoldi
                </span>
              </div>
              <button
                onClick={() => navigate('/warranties')}
                className="text-xs text-blue-500 hover:underline flex-shrink-0"
              >
                Kafolat →
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

type FilterType = 'all' | 'critical' | 'warning'

export default function FleetStatus() {
  const [filter, setFilter] = useState<FilterType>('all')

  const { data, isLoading, refetch, isFetching } = useQuery<FleetStatusData>({
    queryKey: ['fleet-status'],
    queryFn: () => api.get('/reports/fleet-status').then(r => r.data.data),
    staleTime: 60_000,
  })

  const summary = data?.summary
  const allIssues = data?.issues ?? []

  const filtered = allIssues.filter(issue => {
    if (filter === 'all') return true
    const grade = issue.healthScore?.grade
    const hasOverdue = issue.predictions.some(p => p.isOverdue) || issue.services.some(s => s.status === 'overdue')
    if (filter === 'critical') return grade === 'critical' || hasOverdue
    if (filter === 'warning') return (grade === 'poor' || issue.predictions.length > 0 || issue.services.length > 0) && !hasOverdue && grade !== 'critical'
    return true
  })

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ShieldAlert className="w-7 h-7 text-red-600" />
            Nazorat markazi
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            Diqqat talab qiluvchi mashinalar — bir joyda
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {/* Summary cards */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">Jami mashinalar</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{summary.totalVehicles}</div>
            <div className="text-xs text-gray-400 mt-0.5">{summary.vehiclesWithIssues} ta muammoli</div>
          </div>
          <div className={`rounded-xl border p-4 ${summary.criticalHealth > 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
            <div className="text-xs text-gray-400 mb-1">Kritik holat</div>
            <div className={`text-2xl font-bold ${summary.criticalHealth > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {summary.criticalHealth + summary.poorHealth}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{summary.criticalHealth} kritik, {summary.poorHealth} yomon</div>
          </div>
          <div className={`rounded-xl border p-4 ${summary.overduePredictions > 0 ? 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
            <div className="text-xs text-gray-400 mb-1">Muddati o'tgan TO</div>
            <div className={`text-2xl font-bold ${summary.overduePredictions > 0 ? 'text-red-600' : 'text-gray-400'}`}>
              {summary.overduePredictions}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{summary.upcomingPredictions} ta yaqinlashmoqda</div>
          </div>
          <div className={`rounded-xl border p-4 ${summary.overdueServices > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
            <div className="text-xs text-gray-400 mb-1">Xizmat intervali</div>
            <div className={`text-2xl font-bold ${summary.overdueServices > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {summary.overdueServices}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">{summary.dueSoonServices} ta yaqin</div>
          </div>
          <div className={`rounded-xl border p-4 ${summary.expiringWarranties > 0 ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
            <div className="text-xs text-gray-400 mb-1">Kafolat tugaydi</div>
            <div className={`text-2xl font-bold ${summary.expiringWarranties > 0 ? 'text-amber-600' : 'text-gray-400'}`}>
              {summary.expiringWarranties}
            </div>
            <div className="text-xs text-gray-400 mt-0.5">30 kun ichida</div>
          </div>
        </div>
      )}

      {/* Filter */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 p-1 rounded-xl w-fit">
        {([
          { key: 'all',      label: 'Barchasi' },
          { key: 'critical', label: '🔴 Kritik' },
          { key: 'warning',  label: '🟡 Ogohlantirish' },
        ] as { key: FilterType; label: string }[]).map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              filter === f.key
                ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm'
                : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* List */}
      {isLoading ? (
        <div className="py-12 flex justify-center">
          <div className="w-8 h-8 border-4 border-red-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-16 text-center">
          <CheckCircle className="w-14 h-14 text-green-400 mx-auto mb-3" />
          <div className="text-lg font-semibold text-gray-700 dark:text-gray-300">
            {filter === 'all' ? "Barcha mashinalar tartibda!" : "Bu kategoriyada muammo yo'q"}
          </div>
          <div className="text-sm text-gray-400 mt-1">
            {filter === 'all'
              ? "Hech qanday kritik yoki ogohlantiruvchi holat topilmadi"
              : "Filtrni o'zgartirib ko'ring"}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="text-xs text-gray-400 px-1">{filtered.length} ta mashina — og'irlik bo'yicha saralangan</div>
          {filtered.map(issue => (
            <VehicleCard key={issue.vehicleId} issue={issue} />
          ))}
        </div>
      )}

      {/* All ok banner (when no issues at all) */}
      {!isLoading && allIssues.length === 0 && summary && (
        <div className="rounded-xl bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 p-6 text-center">
          <Truck className="w-10 h-10 text-green-500 mx-auto mb-2" />
          <div className="font-semibold text-green-800 dark:text-green-300">
            {summary.totalVehicles} ta mashina — barchasi tartibda!
          </div>
          <div className="text-sm text-green-600 dark:text-green-400 mt-1">
            Hozircha hech qanday muammo aniqlanmadi
          </div>
        </div>
      )}
    </div>
  )
}
