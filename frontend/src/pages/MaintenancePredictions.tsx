import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CalendarClock, Check, AlertTriangle, Search, CheckCheck } from 'lucide-react'
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
  filters: 'Filtrlar', brakes: 'Tormoz', oils: 'Moylash',
  electrical: 'Elektrik', engine: 'Dvigatel', body: 'Kuzov', tires: 'Shinalar',
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

export default function MaintenancePredictions() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState('')

  const { data: predictions, isLoading } = useQuery<Prediction[]>({
    queryKey: ['predictions'],
    queryFn: () => api.get('/analytics/predictions').then(r => r.data.data),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/analytics/predictions/${id}/acknowledge`),
    onSuccess: () => { toast.success('Tasdiqlandi'); qc.invalidateQueries({ queryKey: ['predictions'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const acknowledgeAllMutation = useMutation({
    mutationFn: () => Promise.all(
      (filtered.filter(p => !p.isAcknowledged)).map(p => api.patch(`/analytics/predictions/${p.id}/acknowledge`))
    ),
    onSuccess: () => { toast.success('Hammasi tasdiqlandi'); qc.invalidateQueries({ queryKey: ['predictions'] }) },
    onError: () => toast.error('Xato yuz berdi'),
  })

  const preds = predictions || []
  const overdue = preds.filter(p => daysUntil(p.predictedDate) < 0)
  const urgent  = preds.filter(p => { const d = daysUntil(p.predictedDate); return d >= 0 && d <= 7 })
  const upcoming = preds.filter(p => { const d = daysUntil(p.predictedDate); return d > 7 && d <= 14 })
  const future   = preds.filter(p => daysUntil(p.predictedDate) > 14)

  // Filtered list
  const q = search.trim().toLowerCase()
  const filtered = preds.filter(p => {
    const matchSearch = !q || p.vehicle.registrationNumber.toLowerCase().includes(q) ||
      `${p.vehicle.brand} ${p.vehicle.model}`.toLowerCase().includes(q)
    const matchCat = !categoryFilter || p.partCategory === categoryFilter
    const days = daysUntil(p.predictedDate)
    const matchUrgency = !urgencyFilter ||
      (urgencyFilter === 'overdue' && days < 0) ||
      (urgencyFilter === 'urgent' && days >= 0 && days <= 7) ||
      (urgencyFilter === 'upcoming' && days > 7 && days <= 14) ||
      (urgencyFilter === 'future' && days > 14)
    return matchSearch && matchCat && matchUrgency
  })

  const unacknowledged = filtered.filter(p => !p.isAcknowledged).length

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Texnik Xizmat Bashoratlari</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Tarixiy ma'lumotlar asosida avtomatik bashorat</p>
        </div>
        {hasRole('admin', 'manager', 'branch_manager') && unacknowledged > 0 && (
          <Button
            variant="outline"
            size="sm"
            icon={<CheckCheck className="w-4 h-4" />}
            loading={acknowledgeAllMutation.isPending}
            onClick={() => acknowledgeAllMutation.mutate()}
          >
            Hammasini tasdiqlash ({unacknowledged})
          </Button>
        )}
      </div>

      {/* Alert banners */}
      {overdue.length > 0 && (
        <div className="space-y-1.5">
          {overdue.slice(0, 3).map(p => (
            <div key={p.id} className="flex items-center gap-3 p-3 rounded-xl border-l-4 bg-red-50 dark:bg-red-900/20 border-l-red-500">
              <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
              <p className="text-sm font-medium text-red-800 dark:text-red-200 flex-1">
                <span className="font-bold">{p.vehicle.registrationNumber}</span> — KRITIK: {CATEGORY_LABELS[p.partCategory] || p.partCategory} {Math.abs(daysUntil(p.predictedDate))} kun kechikdi
              </p>
              <Button size="sm" variant="ghost" icon={<Check className="w-3.5 h-3.5" />}
                onClick={() => acknowledgeMutation.mutate(p.id)} loading={acknowledgeMutation.isPending} />
            </div>
          ))}
        </div>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Muddati o\'tgan', count: overdue.length, color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-600', filter: 'overdue' },
          { label: '7 kun ichida', count: urgent.length, color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700 text-orange-600', filter: 'urgent' },
          { label: '7–14 kun', count: upcoming.length, color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700 text-yellow-600', filter: 'upcoming' },
          { label: '14+ kun', count: future.length, color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-600', filter: 'future' },
        ].map(s => (
          <button key={s.filter} onClick={() => setUrgencyFilter(urgencyFilter === s.filter ? '' : s.filter)}
            className={`rounded-xl border p-4 text-center transition-all hover:shadow-md ${s.color} ${urgencyFilter === s.filter ? 'ring-2 ring-offset-1 ring-current' : ''}`}>
            <div className="text-3xl font-bold">{s.count}</div>
            <div className="text-xs mt-0.5 opacity-80">{s.label}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Davlat raqami yoki model..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Barcha kategoriyalar</option>
          {Object.entries(CATEGORY_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        {(search || categoryFilter || urgencyFilter) && (
          <button onClick={() => { setSearch(''); setCategoryFilter(''); setUrgencyFilter('') }}
            className="px-3 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:border-red-300">Tozalash</button>
        )}
      </div>

      {/* Predictions list */}
      {isLoading ? (
        <div className="py-12 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
      ) : filtered.length === 0 ? (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 py-16 text-center">
          <CalendarClock className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-400">{search || categoryFilter || urgencyFilter ? 'Mos bashorat topilmadi' : 'Yaqin orada bashorat yo\'q'}</p>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 divide-y divide-gray-50 dark:divide-gray-700">
          {filtered.map(p => {
            const days = daysUntil(p.predictedDate)
            const urgencyVariant: any = days < 0 ? 'danger' : days <= 7 ? 'danger' : days <= 14 ? 'warning' : 'info'
            const dayLabel = days < 0 ? `${Math.abs(days)} kun kechikdi` : `${days} kun`

            return (
              <div key={p.id} className={`p-4 flex items-center gap-4 ${p.isAcknowledged ? 'opacity-50' : ''}`}>
                <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${
                  days < 0 ? 'bg-red-100 dark:bg-red-900/30' :
                  days <= 7 ? 'bg-orange-100 dark:bg-orange-900/30' :
                  days <= 14 ? 'bg-yellow-100 dark:bg-yellow-900/30' :
                  'bg-blue-100 dark:bg-blue-900/30'
                }`}>
                  <CalendarClock className={`w-6 h-6 ${
                    days < 0 ? 'text-red-500' : days <= 7 ? 'text-orange-500' : days <= 14 ? 'text-yellow-500' : 'text-blue-500'
                  }`} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="font-mono font-bold text-gray-900 dark:text-white">{p.vehicle.registrationNumber}</span>
                    <span className="text-sm text-gray-500">{p.vehicle.brand} {p.vehicle.model}</span>
                    <Badge variant="default">{CATEGORY_LABELS[p.partCategory] || p.partCategory}</Badge>
                    <Badge variant={urgencyVariant}>{dayLabel}</Badge>
                    {p.isAcknowledged && <Badge variant="success">Tasdiqlangan</Badge>}
                  </div>
                  <div className="text-xs text-gray-400">{formatDate(p.predictedDate)}</div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-gray-400">
                    <span>Ishonch: {(Number(p.confidence) * 100).toFixed(0)}%</span>
                    <span>Tarix: {p.basedOnHistory} ta</span>
                    {p.predictedKm && <span>~{Number(p.predictedKm).toLocaleString()} km</span>}
                  </div>
                  <div className="mt-1.5 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full w-32">
                    <div className={`h-full rounded-full ${Number(p.confidence) >= 0.8 ? 'bg-green-400' : Number(p.confidence) >= 0.5 ? 'bg-yellow-400' : 'bg-red-400'}`}
                      style={{ width: `${Number(p.confidence) * 100}%` }} />
                  </div>
                </div>

                {!p.isAcknowledged && hasRole('admin', 'manager', 'branch_manager') && (
                  <Button size="sm" variant="outline" icon={<Check className="w-3.5 h-3.5" />}
                    onClick={() => acknowledgeMutation.mutate(p.id)} loading={acknowledgeMutation.isPending}>
                    Tasdiqlash
                  </Button>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
