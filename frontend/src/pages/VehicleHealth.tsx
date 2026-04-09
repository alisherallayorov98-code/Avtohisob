import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Activity, RefreshCw, ChevronDown, ChevronUp, AlertTriangle, Search, ChevronLeft, ChevronRight } from 'lucide-react'
import api from '../lib/api'
import { getSocket } from '../lib/socket'
import { useAuthStore } from '../stores/authStore'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { Card, CardBody, CardHeader, StatCard } from '../components/ui/Card'

const PAGE_SIZE = 20

interface HealthScore {
  id: string
  vehicleId: string
  score: number
  grade: string
  mileageFactor: number
  maintenanceFactor: number
  fuelFactor: number
  ageFactor: number
  details: Record<string, any>
  calculatedAt: string
}

interface VehicleHealth {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  branch: string
  status: string
  latestScore: HealthScore | null
}

const GRADE_CONFIG: Record<string, { label: string; variant: any; color: string; bg: string }> = {
  excellent: { label: 'A\'lo', variant: 'success', color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20' },
  good: { label: 'Yaxshi', variant: 'success', color: 'text-emerald-600', bg: 'bg-emerald-50 dark:bg-emerald-900/20' },
  fair: { label: 'O\'rtacha', variant: 'warning', color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20' },
  poor: { label: 'Yomon', variant: 'danger', color: 'text-orange-600', bg: 'bg-orange-50 dark:bg-orange-900/20' },
  critical: { label: 'Kritik', variant: 'danger', color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20' },
}

function HealthBar({ value, label, color }: { value: number; label: string; color: string }) {
  return (
    <div>
      <div className="flex justify-between text-xs mb-1">
        <span className="text-gray-600 dark:text-gray-300">{label}</span>
        <span className="font-medium">{value.toFixed(0)}</span>
      </div>
      <div className="h-2 bg-gray-100 dark:bg-gray-700 rounded-full overflow-hidden">
        <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  )
}

function ScoreGauge({ score, grade }: { score: number; grade: string }) {
  const cfg = GRADE_CONFIG[grade] || GRADE_CONFIG.fair
  const circumference = 2 * Math.PI * 40
  const strokeDashoffset = circumference - (score / 100) * circumference

  const strokeColor = grade === 'excellent' ? '#22c55e'
    : grade === 'good' ? '#10b981'
    : grade === 'fair' ? '#f59e0b'
    : grade === 'poor' ? '#f97316'
    : '#ef4444'

  return (
    <div className="flex flex-col items-center">
      <div className="relative w-24 h-24">
        <svg className="w-24 h-24 -rotate-90" viewBox="0 0 100 100">
          <circle cx="50" cy="50" r="40" fill="none" stroke="#e5e7eb" strokeWidth="8" />
          <circle cx="50" cy="50" r="40" fill="none" stroke={strokeColor} strokeWidth="8"
            strokeDasharray={circumference} strokeDashoffset={strokeDashoffset}
            strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }} />
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className={`text-2xl font-bold ${cfg.color}`}>{score}</span>
        </div>
      </div>
      <Badge variant={cfg.variant} className="mt-1">{cfg.label}</Badge>
    </div>
  )
}

export default function VehicleHealth() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [gradeFilter, setGradeFilter] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)

  const { data: vehicles, isLoading } = useQuery<VehicleHealth[]>({
    queryKey: ['health-scores'],
    queryFn: () => api.get('/analytics/health-scores').then(r => r.data.data),
  })

  const { data: overview } = useQuery({
    queryKey: ['analytics-overview'],
    queryFn: () => api.get('/analytics/overview').then(r => r.data.data),
  })

  const { data: historyData } = useQuery({
    queryKey: ['health-history', expandedId],
    queryFn: () => api.get(`/analytics/health-scores/${expandedId}/history`).then(r => r.data.data),
    enabled: !!expandedId,
  })

  const recalcMutation = useMutation({
    mutationFn: (vehicleId: string) => api.post(`/analytics/health-scores/${vehicleId}/recalculate`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['health-scores'] }),
  })

  // Real-time health updates via WebSocket
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const handler = () => qc.invalidateQueries({ queryKey: ['health-scores'] })
    socket.on('health:updated', handler)
    return () => { socket.off('health:updated', handler) }
  }, [qc])

  const q = search.trim().toLowerCase()
  const filtered = (vehicles || []).filter(v =>
    (!gradeFilter || v.latestScore?.grade === gradeFilter) &&
    (!q || v.registrationNumber.toLowerCase().includes(q) ||
      v.brand.toLowerCase().includes(q) ||
      v.model.toLowerCase().includes(q))
  )

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE))
  const currentPage = Math.min(page, totalPages)
  const paginated = filtered.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  const grades = ['excellent', 'good', 'fair', 'poor', 'critical']
  const gradeCounts = grades.map(g => ({
    grade: g,
    count: (vehicles || []).filter(v => v.latestScore?.grade === g).length,
  }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Avtomobil Salomatligi</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Real-time health monitoring va skor hisoblash</p>
        </div>
        {hasRole('admin', 'manager') && (
          <Button
            variant="outline"
            icon={<RefreshCw className="w-4 h-4" />}
            onClick={() => vehicles?.forEach(v => recalcMutation.mutate(v.vehicleId))}
            loading={recalcMutation.isPending}
            size="sm"
          >
            Hammasini yangilash
          </Button>
        )}
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          type="text"
          placeholder="Davlat raqami, marka yoki model bo'yicha qidirish..."
          value={search}
          onChange={e => { setSearch(e.target.value); setPage(1) }}
          className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Overview stats */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {gradeCounts.map(g => {
          const cfg = GRADE_CONFIG[g.grade]
          return (
            <button
              key={g.grade}
              onClick={() => { setGradeFilter(gradeFilter === g.grade ? '' : g.grade); setPage(1) }}
              className={`p-3 rounded-xl border-2 text-center transition-all ${
                gradeFilter === g.grade
                  ? `border-current ${cfg.bg} ${cfg.color}`
                  : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
              }`}
            >
              <div className={`text-2xl font-bold ${cfg.color}`}>{g.count}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{cfg.label}</div>
            </button>
          )
        })}
      </div>

      {/* Vehicle list */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
        {isLoading ? (
          <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : paginated.length === 0 ? (
          <div className="py-12 text-center text-gray-400">Ma'lumot yo'q</div>
        ) : paginated.map(v => {
          const score = v.latestScore
          const cfg = score ? GRADE_CONFIG[score.grade] : GRADE_CONFIG.fair
          const isExpanded = expandedId === v.vehicleId

          return (
            <div key={v.vehicleId}>
              <div
                className="flex items-center gap-4 p-4 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700/50"
                onClick={() => setExpandedId(isExpanded ? null : v.vehicleId)}
              >
                {score ? (
                  <ScoreGauge score={Number(score.score)} grade={score.grade} />
                ) : (
                  <div className="w-24 h-24 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center">
                    <Activity className="w-8 h-8 text-gray-400" />
                  </div>
                )}

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-bold text-gray-900 dark:text-white">{v.registrationNumber}</span>
                    <span className="text-gray-500 dark:text-gray-400 text-sm">{v.brand} {v.model}</span>
                  </div>
                  <div className="text-xs text-gray-400 mt-0.5">{v.branch}</div>
                  {score && (
                    <div className="flex items-center gap-4 mt-2">
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-gray-400">Yosh:</span>
                        <span className="font-medium">{Number(score.ageFactor).toFixed(0)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-gray-400">Xizmat:</span>
                        <span className="font-medium">{Number(score.maintenanceFactor).toFixed(0)}</span>
                      </div>
                      <div className="flex items-center gap-1 text-xs">
                        <span className="text-gray-400">Yoqilgi:</span>
                        <span className="font-medium">{Number(score.fuelFactor).toFixed(0)}</span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  {hasRole('admin', 'manager') && (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={<RefreshCw className="w-3 h-3" />}
                      loading={recalcMutation.isPending}
                      onClick={(e) => { e.stopPropagation(); recalcMutation.mutate(v.vehicleId) }}
                    />
                  )}
                  {isExpanded ? <ChevronUp className="w-5 h-5 text-gray-400" /> : <ChevronDown className="w-5 h-5 text-gray-400" />}
                </div>
              </div>

              {/* Expanded details */}
              {isExpanded && score && (
                <div className={`px-6 pb-5 ${cfg.bg} dark:bg-gray-700/30`}>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6 pt-4">
                    <div className="space-y-3">
                      <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Faktorlar taqsimoti</h4>
                      <HealthBar value={Number(score.ageFactor)} label="Yosh va Yurish" color="bg-blue-500" />
                      <HealthBar value={Number(score.maintenanceFactor)} label="Texnik xizmat" color="bg-green-500" />
                      <HealthBar value={Number(score.fuelFactor)} label="Yoqilgi samaradorligi" color="bg-yellow-500" />
                      <HealthBar value={Number(score.mileageFactor)} label="Yurish ko'rsatkichi" color="bg-purple-500" />
                    </div>

                    {score.details && (
                      <div className="space-y-2">
                        <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">Tafsilotlar</h4>
                        <div className="grid grid-cols-2 gap-2 text-xs">
                          {score.details.vehicleAge && (
                            <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                              <div className="text-gray-400">Yoshi</div>
                              <div className="font-bold">{score.details.vehicleAge} yil</div>
                            </div>
                          )}
                          {score.details.mileageKm && (
                            <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                              <div className="text-gray-400">Yurish</div>
                              <div className="font-bold">{Number(score.details.mileageKm).toLocaleString()} km</div>
                            </div>
                          )}
                          {score.details.recentMaintenanceCount !== undefined && (
                            <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                              <div className="text-gray-400">So'nggi 90 kun xizmati</div>
                              <div className="font-bold">{score.details.recentMaintenanceCount} ta</div>
                            </div>
                          )}
                          {score.details.recentCost !== undefined && (
                            <div className="bg-white dark:bg-gray-800 rounded-lg p-2">
                              <div className="text-gray-400">Xizmat xarajati</div>
                              <div className="font-bold">{Number(score.details.recentCost).toLocaleString()} UZS</div>
                            </div>
                          )}
                        </div>

                        {/* Alert for critical */}
                        {(score.grade === 'critical' || score.grade === 'poor') && (
                          <div className="mt-2 flex items-start gap-2 text-xs bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg p-2">
                            <AlertTriangle className="w-3.5 h-3.5 text-red-500 flex-shrink-0 mt-0.5" />
                            <span className="text-red-700 dark:text-red-300">
                              {score.grade === 'critical'
                                ? 'Darhol texnik xizmat kerak!'
                                : 'Tez orada texnik xizmat tavsiya etiladi'}
                            </span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  {/* History sparkline */}
                  {historyData && historyData.length > 1 && (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 mb-2">30 kunlik trend</h4>
                      <div className="flex items-end gap-1 h-10">
                        {historyData.slice(0, 20).reverse().map((h: HealthScore, i: number) => {
                          const ht = Number(h.score)
                          const color = ht >= 85 ? 'bg-green-400' : ht >= 70 ? 'bg-emerald-400' : ht >= 55 ? 'bg-yellow-400' : ht >= 40 ? 'bg-orange-400' : 'bg-red-400'
                          return (
                            <div key={i} className={`flex-1 rounded-sm ${color}`} style={{ height: `${ht}%` }} title={`Score: ${ht}`} />
                          )
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500 dark:text-gray-400">
          <span>{filtered.length} ta natija, {currentPage}/{totalPages} sahifa</span>
          <div className="flex items-center gap-1">
            <button
              disabled={currentPage === 1}
              onClick={() => setPage(p => p - 1)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1)
              .reduce<(number | '...')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('...')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '...' ? (
                  <span key={`dots-${i}`} className="px-2">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => setPage(p as number)}
                    className={`w-8 h-8 rounded-lg text-xs font-medium ${
                      currentPage === p
                        ? 'bg-blue-600 text-white'
                        : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              disabled={currentPage === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
