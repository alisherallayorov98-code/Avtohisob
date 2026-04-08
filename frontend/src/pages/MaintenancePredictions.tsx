import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, RefreshCw, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import { useAuthStore } from '../stores/authStore'

interface Prediction {
  id: string
  vehicleId: string
  partCategory: string
  predictedDate: string
  predictedKm?: number
  confidence: number
  basedOnHistory: number
  isAcknowledged: boolean
  vehicle: { registrationNumber: string; brand: string; model: string }
}

const CATEGORY_LABELS: Record<string, string> = {
  filters: 'Filtrlar',
  brakes: 'Tormoz tizimi',
  oils: 'Moylash',
  electrical: 'Elektrik',
  engine: 'Dvigatel',
  body: 'Kuzov',
  tires: 'Shinalar',
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

export default function MaintenancePredictions() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()

  const { data: predictions, isLoading } = useQuery<Prediction[]>({
    queryKey: ['predictions'],
    queryFn: () => api.get('/analytics/predictions').then(r => r.data.data),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/analytics/predictions/${id}/acknowledge`),
    onSuccess: () => {
      toast.success('Bashorat tasdiqlandi')
      qc.invalidateQueries({ queryKey: ['predictions'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const preds = predictions || []
  const urgent = preds.filter(p => daysUntil(p.predictedDate) <= 7)
  const upcoming = preds.filter(p => daysUntil(p.predictedDate) > 7 && daysUntil(p.predictedDate) <= 14)
  const future = preds.filter(p => daysUntil(p.predictedDate) > 14)

  // Alert banners: overdue (days < 0), urgent (0-7), upcoming (8-14)
  const overdue = preds.filter(p => daysUntil(p.predictedDate) < 0)
  const alertBanners = [
    ...overdue.map(p => ({
      id: p.id, type: 'critical' as const,
      message: `${p.vehicle.registrationNumber} — KRITIK: Texnik xizmat ${Math.abs(daysUntil(p.predictedDate))} kun kechikdi`,
    })),
    ...urgent.slice(0, 2).map(p => ({
      id: p.id, type: 'warning' as const,
      message: `${p.vehicle.registrationNumber} — OGOHLANTIRISH: Texnik xizmat ${daysUntil(p.predictedDate)} kundan keyin`,
    })),
    ...upcoming.slice(0, 1).map(p => ({
      id: p.id, type: 'info' as const,
      message: `${p.vehicle.registrationNumber} — MA'LUMOT: Texnik xizmat ${daysUntil(p.predictedDate)} kundan keyin rejalashtirilgan`,
    })),
  ]

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Texnik Xizmat Bashoratlari</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm">Tarixiy ma'lumotlar asosida avtomatik bashorat</p>
      </div>

      {/* Alert Banners */}
      {alertBanners.length > 0 && (
        <div className="space-y-2">
          {alertBanners.map(banner => (
            <div key={banner.id} className={`flex items-center gap-3 p-4 rounded-xl border-l-4 ${
              banner.type === 'critical'
                ? 'bg-red-50 dark:bg-red-900/20 border-l-red-500'
                : banner.type === 'warning'
                ? 'bg-yellow-50 dark:bg-yellow-900/20 border-l-yellow-500'
                : 'bg-green-50 dark:bg-green-900/20 border-l-green-500'
            }`}>
              <AlertTriangle className={`w-5 h-5 flex-shrink-0 ${
                banner.type === 'critical' ? 'text-red-500' :
                banner.type === 'warning' ? 'text-yellow-500' : 'text-green-500'
              }`} />
              <p className={`text-sm font-medium flex-1 ${
                banner.type === 'critical' ? 'text-red-800 dark:text-red-200' :
                banner.type === 'warning' ? 'text-yellow-800 dark:text-yellow-200' :
                'text-green-800 dark:text-green-200'
              }`}>{banner.message}</p>
            </div>
          ))}
        </div>
      )}

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-red-600">{urgent.length}</div>
          <div className="text-sm text-red-700 dark:text-red-300 mt-0.5">7 kun ichida</div>
        </div>
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-yellow-600">{upcoming.length}</div>
          <div className="text-sm text-yellow-700 dark:text-yellow-300 mt-0.5">7-14 kun</div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{future.length}</div>
          <div className="text-sm text-blue-700 dark:text-blue-300 mt-0.5">14+ kun</div>
        </div>
      </div>

      {/* Predictions */}
      {isLoading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : preds.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 py-16 text-center">
          <CalendarClock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">Yaqin orada bashorat yo'q</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
          {preds.map(p => {
            const days = daysUntil(p.predictedDate)
            const urgencyVariant: any = days <= 7 ? 'danger' : days <= 14 ? 'warning' : 'info'

            return (
              <div key={p.id} className="p-4 flex items-center gap-4">
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  days <= 7 ? 'bg-red-100 dark:bg-red-900/30' :
                  days <= 14 ? 'bg-yellow-100 dark:bg-yellow-900/30' :
                  'bg-blue-100 dark:bg-blue-900/30'
                }`}>
                  <CalendarClock className={`w-6 h-6 ${
                    days <= 7 ? 'text-red-500' : days <= 14 ? 'text-yellow-500' : 'text-blue-500'
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-semibold text-gray-900 dark:text-white">{p.vehicle.registrationNumber}</span>
                    <Badge variant="default">{CATEGORY_LABELS[p.partCategory] || p.partCategory}</Badge>
                    <Badge variant={urgencyVariant}>{days} kun</Badge>
                  </div>
                  <p className="text-sm text-gray-600 dark:text-gray-300">
                    {p.vehicle.brand} {p.vehicle.model} • {formatDate(p.predictedDate)}
                  </p>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>Ishonch: {(Number(p.confidence) * 100).toFixed(0)}%</span>
                    <span>Tarix: {p.basedOnHistory} ta yozuv</span>
                    {p.predictedKm && <span>Km: {Number(p.predictedKm).toLocaleString()}</span>}
                  </div>
                  {/* Confidence bar */}
                  <div className="mt-1.5 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full w-32">
                    <div
                      className={`h-full rounded-full ${
                        Number(p.confidence) >= 0.8 ? 'bg-green-400' :
                        Number(p.confidence) >= 0.5 ? 'bg-yellow-400' : 'bg-red-400'
                      }`}
                      style={{ width: `${Number(p.confidence) * 100}%` }}
                    />
                  </div>
                </div>

                <Button
                  size="sm"
                  variant="outline"
                  icon={<Check className="w-3.5 h-3.5" />}
                  onClick={() => acknowledgeMutation.mutate(p.id)}
                  loading={acknowledgeMutation.isPending}
                >
                  Tasdiqlash
                </Button>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
