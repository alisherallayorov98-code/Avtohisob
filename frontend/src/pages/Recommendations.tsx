import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Lightbulb, X, ArrowRight, Wrench, Fuel, DollarSign, RefreshCw, Car, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { getSocket } from '../lib/socket'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { useAuthStore } from '../stores/authStore'

interface Recommendation {
  id: string
  vehicleId?: string
  branchId?: string
  type: string
  priority: string
  title: string
  description: string
  actionUrl?: string
  estimatedSaving?: number
  expiresAt?: string
  createdAt: string
  vehicle?: { registrationNumber: string; brand: string; model: string }
}

const TYPE_ICONS: Record<string, React.ReactNode> = {
  maintenance: <Wrench className="w-5 h-5" />,
  fuel: <Fuel className="w-5 h-5" />,
  cost: <DollarSign className="w-5 h-5" />,
  replacement: <Car className="w-5 h-5" />,
  inventory: <RefreshCw className="w-5 h-5" />,
}

const PRIORITY_CONFIG: Record<string, { variant: any; order: number; bg: string; border: string }> = {
  critical: { variant: 'danger', order: 0, bg: 'bg-red-50 dark:bg-red-900/10', border: 'border-red-200 dark:border-red-700' },
  high: { variant: 'danger', order: 1, bg: 'bg-orange-50 dark:bg-orange-900/10', border: 'border-orange-200 dark:border-orange-700' },
  medium: { variant: 'warning', order: 2, bg: 'bg-yellow-50 dark:bg-yellow-900/10', border: 'border-yellow-200 dark:border-yellow-700' },
  low: { variant: 'info', order: 3, bg: 'bg-blue-50 dark:bg-blue-900/10', border: 'border-blue-200 dark:border-blue-700' },
}

const PRIORITY_LABELS: Record<string, string> = {
  critical: 'Kritik',
  high: 'Yuqori',
  medium: "O'rtacha",
  low: 'Past',
}

export default function Recommendations() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const [priorityFilter, setPriorityFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['recommendations', priorityFilter, typeFilter],
    queryFn: () => api.get('/analytics/recommendations', {
      params: {
        priority: priorityFilter || undefined,
        type: typeFilter || undefined,
        limit: 50,
      },
    }).then(r => r.data.data),
  })

  const dismissMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/analytics/recommendations/${id}/dismiss`),
    onSuccess: () => {
      toast.success('Tavsiya bekor qilindi')
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const generateMutation = useMutation({
    mutationFn: () => api.post('/analytics/recommendations/generate'),
    onSuccess: () => {
      toast.success('Tavsiyalar yangilandi')
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
  })

  const dismissAllMutation = useMutation({
    mutationFn: (ids: string[]) => Promise.all(ids.map(id => api.patch(`/analytics/recommendations/${id}/dismiss`))),
    onSuccess: () => {
      toast.success('Hammasi bekor qilindi')
      qc.invalidateQueries({ queryKey: ['recommendations'] })
    },
    onError: () => toast.error('Xato yuz berdi'),
  })

  // Real-time
  useEffect(() => {
    const socket = getSocket()
    if (!socket) return
    const handler = () => qc.invalidateQueries({ queryKey: ['recommendations'] })
    socket.on('recommendation:new', handler)
    return () => { socket.off('recommendation:new', handler) }
  }, [qc])

  const recommendations: Recommendation[] = data || []

  // Group by priority
  const grouped = ['critical', 'high', 'medium', 'low'].reduce((acc, p) => {
    const items = recommendations.filter(r =>
      r.priority === p && (!priorityFilter || r.priority === priorityFilter) && (!typeFilter || r.type === typeFilter)
    )
    if (items.length > 0) acc[p] = items
    return acc
  }, {} as Record<string, Recommendation[]>)

  const totalCount = recommendations.length
  const criticalCount = recommendations.filter(r => r.priority === 'critical').length
  const totalSavings = recommendations.reduce((sum, r) => sum + (r.estimatedSaving ? Number(r.estimatedSaving) : 0), 0)
  const allIds = recommendations.map(r => r.id)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Tavsiyalar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">
            AI asosida yaratilgan {totalCount} ta tavsiya
            {criticalCount > 0 && <span className="ml-1 text-red-500 font-medium">({criticalCount} kritik)</span>}
            {totalSavings > 0 && <span className="ml-2 text-green-600 dark:text-green-400 font-medium">· Tejash: {totalSavings.toLocaleString()} UZS</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {hasRole('admin', 'manager') && totalCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              icon={<XCircle className="w-4 h-4 text-red-500" />}
              loading={dismissAllMutation.isPending}
              onClick={() => { if (confirm(`${totalCount} ta tavsiyani bekor qilish?`)) dismissAllMutation.mutate(allIds) }}
            >
              Hammasini bekor qilish
            </Button>
          )}
          {hasRole('admin', 'manager') && (
            <Button
              variant="outline"
              icon={<RefreshCw className="w-4 h-4" />}
              onClick={() => generateMutation.mutate()}
              loading={generateMutation.isPending}
              size="sm"
            >
              Yangilash
            </Button>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={priorityFilter}
          onChange={e => setPriorityFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Barcha ustuvorliklar</option>
          {Object.entries(PRIORITY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>

        <select
          value={typeFilter}
          onChange={e => setTypeFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">Barcha turlar</option>
          <option value="maintenance">Texnik xizmat</option>
          <option value="fuel">Yoqilgi</option>
          <option value="cost">Xarajat</option>
          <option value="replacement">Almashtirish</option>
          <option value="inventory">Ombor</option>
        </select>
      </div>

      {isLoading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : totalCount === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 py-16 text-center">
          <Lightbulb className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">Hozircha tavsiya yo'q</p>
          {hasRole('admin', 'manager') && (
            <Button variant="outline" className="mt-3" onClick={() => generateMutation.mutate()} loading={generateMutation.isPending}>
              Tavsiyalarni yaratish
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([priority, items]) => {
            const cfg = PRIORITY_CONFIG[priority]
            return (
              <div key={priority}>
                <div className="flex items-center gap-2 mb-3">
                  <Badge variant={cfg.variant}>{PRIORITY_LABELS[priority]}</Badge>
                  <span className="text-sm text-gray-500">{items.length} ta</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                  {items.map(rec => (
                    <div key={rec.id} className={`rounded-xl border p-4 ${cfg.bg} ${cfg.border}`}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <div className="flex items-center gap-2">
                          <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${
                            priority === 'critical' ? 'bg-red-100 text-red-500' :
                            priority === 'high' ? 'bg-orange-100 text-orange-500' :
                            priority === 'medium' ? 'bg-yellow-100 text-yellow-500' :
                            'bg-blue-100 text-blue-500'
                          }`}>
                            {TYPE_ICONS[rec.type] || <Lightbulb className="w-5 h-5" />}
                          </div>
                          <div>
                            <p className="text-xs text-gray-400">{rec.vehicle?.registrationNumber || 'Barcha avtomobillar'}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => dismissMutation.mutate(rec.id)}
                          className="p-1 rounded hover:bg-black/5 text-gray-400"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <h3 className="font-semibold text-gray-900 dark:text-white text-sm mb-1">{rec.title}</h3>
                      <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2">{rec.description}</p>

                      {rec.estimatedSaving && (
                        <div className="mt-2 text-xs text-green-600 dark:text-green-400 font-medium">
                          Tejash: {Number(rec.estimatedSaving).toLocaleString()} UZS
                        </div>
                      )}

                      {rec.expiresAt && (
                        <div className="mt-1 text-xs text-gray-400">
                          Muddati: {formatDate(rec.expiresAt)}
                        </div>
                      )}

                      {rec.actionUrl && (
                        <button
                          onClick={() => navigate(rec.actionUrl!)}
                          className="mt-3 w-full flex items-center justify-center gap-1 text-xs font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 py-1.5 border border-blue-200 dark:border-blue-700 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
                        >
                          Harakat qilish
                          <ArrowRight className="w-3 h-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
