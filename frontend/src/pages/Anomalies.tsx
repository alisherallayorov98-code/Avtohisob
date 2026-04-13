import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { AlertOctagon, CheckCircle, Filter, RefreshCw } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { getSocket } from '../lib/socket'
import { formatDateTime } from '../lib/utils'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { Card } from '../components/ui/Card'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'

interface Anomaly {
  id: string
  vehicleId: string
  type: string
  severity: string
  description: string
  isResolved: boolean
  resolvedAt?: string
  detectedAt: string
  metadata?: Record<string, any>
  vehicle: { registrationNumber: string; brand: string; model: string }
}

const TYPE_LABELS: Record<string, string> = {
  fuel_spike: 'Gaz sarfi oshishi',
  maintenance_frequency: 'Ko\'p ta\'mirlash',
  cost_spike: 'Xarajat oshishi',
  odometer_jump: 'Odometr sakrashi',
}

const SEVERITY_CONFIG: Record<string, { label: string; variant: any }> = {
  high: { label: 'Yuqori', variant: 'danger' },
  medium: { label: 'O\'rtacha', variant: 'warning' },
  low: { label: 'Past', variant: 'info' },
}

export default function Anomalies() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [severityFilter, setSeverityFilter] = useState('')
  const [resolvedFilter, setResolvedFilter] = useState('false')
  const [typeFilter, setTypeFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['anomalies', page, severityFilter, resolvedFilter, typeFilter],
    queryFn: () => api.get('/analytics/anomalies', {
      params: {
        page,
        limit: 15,
        severity: severityFilter || undefined,
        isResolved: resolvedFilter,
        type: typeFilter || undefined,
      },
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const resolveMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/analytics/anomalies/${id}/resolve`),
    onSuccess: () => {
      toast.success('Anomaliya hal qilindi')
      qc.invalidateQueries({ queryKey: ['anomalies'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Real-time anomaly updates
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const handler = () => qc.invalidateQueries({ queryKey: ['anomalies'] })
    socket.on('anomaly:new', handler)
    return () => { socket.off('anomaly:new', handler) }
  }, [qc])

  const anomalies: Anomaly[] = data?.data || []
  const meta = data?.meta

  const summaryStats = {
    high: anomalies.filter(a => a.severity === 'high' && !a.isResolved).length,
    medium: anomalies.filter(a => a.severity === 'medium' && !a.isResolved).length,
    low: anomalies.filter(a => a.severity === 'low' && !a.isResolved).length,
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Anomaliyalar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Avtomatik anomaliya aniqlash tizimi</p>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-red-600">{summaryStats.high}</div>
          <div className="text-sm text-red-700 dark:text-red-300 mt-0.5">Yuqori</div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-yellow-600">{summaryStats.medium}</div>
          <div className="text-sm text-yellow-700 dark:text-yellow-300 mt-0.5">O'rtacha</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{summaryStats.low}</div>
          <div className="text-sm text-blue-700 dark:text-blue-300 mt-0.5">Past</div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-3">
          <select
            value={resolvedFilter}
            onChange={e => { setResolvedFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="false">Ochiq</option>
            <option value="true">Hal qilingan</option>
            <option value="">Barchasi</option>
          </select>

          <select
            value={severityFilter}
            onChange={e => { setSeverityFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Barcha darajalar</option>
            <option value="high">Yuqori</option>
            <option value="medium">O'rtacha</option>
            <option value="low">Past</option>
          </select>

          <select
            value={typeFilter}
            onChange={e => { setTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Barcha turlar</option>
            {Object.entries(TYPE_LABELS).map(([k, v]) => (
              <option key={k} value={k}>{v}</option>
            ))}
          </select>
        </div>

        {isLoading ? (
          <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
        ) : anomalies.length === 0 ? (
          <div className="py-12 text-center">
            <CheckCircle className="w-10 h-10 text-green-400 mx-auto mb-2" />
            <p className="text-gray-400">Anomaliya topilmadi</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {anomalies.map(a => {
              const sevCfg = SEVERITY_CONFIG[a.severity] || SEVERITY_CONFIG.medium
              return (
                <div key={a.id} className={`p-4 flex items-start gap-4 ${a.isResolved ? 'opacity-60' : ''}`}>
                  <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
                    a.severity === 'high' ? 'bg-red-100 dark:bg-red-900/30' :
                    a.severity === 'medium' ? 'bg-yellow-100 dark:bg-yellow-900/30' :
                    'bg-blue-100 dark:bg-blue-900/30'
                  }`}>
                    <AlertOctagon className={`w-5 h-5 ${
                      a.severity === 'high' ? 'text-red-500' :
                      a.severity === 'medium' ? 'text-yellow-500' :
                      'text-blue-500'
                    }`} />
                  </div>

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-gray-900 dark:text-white">{a.vehicle.registrationNumber}</span>
                      <Badge variant={sevCfg.variant}>{sevCfg.label}</Badge>
                      <Badge variant="default">{TYPE_LABELS[a.type] || a.type}</Badge>
                      {a.isResolved && <Badge variant="success">Hal qilingan</Badge>}
                    </div>
                    <p className="text-sm text-gray-600 dark:text-gray-300">{a.description}</p>
                    <p className="text-xs text-gray-400 mt-1">
                      {a.vehicle.brand} {a.vehicle.model} • {formatDateTime(a.detectedAt)}
                    </p>
                  </div>

                  {!a.isResolved && hasRole('admin', 'manager', 'branch_manager') && (
                    <Button
                      size="sm"
                      variant="outline"
                      icon={<CheckCircle className="w-3.5 h-3.5" />}
                      onClick={() => resolveMutation.mutate(a.id)}
                      loading={resolveMutation.isPending}
                    >
                      Hal qilish
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {meta && (
          <Pagination page={page} totalPages={meta.totalPages} total={meta.total} limit={15} onPageChange={setPage} />
        )}
      </div>
    </div>
  )
}
