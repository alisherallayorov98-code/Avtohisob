import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CalendarClock, AlertTriangle, Search, Lightbulb, ChevronDown, ChevronUp, Wrench, Clock, EyeOff, Info, History } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
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
  vehicle: { id: string; registrationNumber: string; brand: string; model: string; mileage?: number }
  history?: {
    lastDate: string | null
    lastKm: number | null
    totalCount: number
    avgDays: number | null
    avgKm: number | null
  }
}

const CATEGORY_LABELS: Record<string, string> = {
  filters: 'Filtrlar', brakes: 'Tormoz', oils: 'Moylash',
  electrical: 'Elektrik', engine: 'Dvigatel', body: 'Kuzov', tires: 'Shinalar',
  transmission: 'Uzatma', suspension: 'Osmasi', cooling: 'Sovutish',
  exhaust: 'Tashqi qism', fuel: 'Yoqilg\'i tizimi', other: 'Boshqa',
}

function daysUntil(dateStr: string) {
  return Math.ceil((new Date(dateStr).getTime() - Date.now()) / (24 * 60 * 60 * 1000))
}

function urgencyColor(days: number) {
  if (days < 0) return { bg: 'bg-red-50 dark:bg-red-900/20', border: 'border-red-200 dark:border-red-800', text: 'text-red-700 dark:text-red-300', dot: 'bg-red-500' }
  if (days <= 7) return { bg: 'bg-orange-50 dark:bg-orange-900/20', border: 'border-orange-200 dark:border-orange-800', text: 'text-orange-700 dark:text-orange-300', dot: 'bg-orange-500' }
  if (days <= 14) return { bg: 'bg-yellow-50 dark:bg-yellow-900/20', border: 'border-yellow-200 dark:border-yellow-800', text: 'text-yellow-700 dark:text-yellow-300', dot: 'bg-yellow-500' }
  return { bg: 'bg-blue-50 dark:bg-blue-900/20', border: 'border-blue-200 dark:border-blue-800', text: 'text-blue-700 dark:text-blue-300', dot: 'bg-blue-500' }
}

export default function MaintenancePredictions() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [showGuide, setShowGuide] = useState(true)

  const { data: predictions, isLoading } = useQuery<Prediction[]>({
    queryKey: ['predictions'],
    queryFn: () => api.get('/analytics/predictions').then(r => r.data.data),
  })

  const acknowledgeMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/analytics/predictions/${id}/acknowledge`),
    onSuccess: () => { toast.success('Bashorat yashirildi'); qc.invalidateQueries({ queryKey: ['predictions'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const snoozeMutation = useMutation({
    mutationFn: ({ id, days }: { id: string; days: number }) =>
      api.patch(`/analytics/predictions/${id}/snooze`, { days }),
    onSuccess: (_, vars) => {
      toast.success(`${vars.days} kun keyinga surildi`)
      qc.invalidateQueries({ queryKey: ['predictions'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const goToMaintenance = (p: Prediction) => {
    toast(`${p.vehicle.registrationNumber} uchun ${CATEGORY_LABELS[p.partCategory] || p.partCategory} bo'yicha yangi yozuv qo'shing`, { icon: '🔧', duration: 4000 })
    navigate(`/maintenance?vehicle=${encodeURIComponent(p.vehicle.registrationNumber)}`)
  }

  const preds = predictions || []
  const overdue = preds.filter(p => daysUntil(p.predictedDate) < 0)
  const urgent  = preds.filter(p => { const d = daysUntil(p.predictedDate); return d >= 0 && d <= 7 })
  const upcoming = preds.filter(p => { const d = daysUntil(p.predictedDate); return d > 7 && d <= 14 })
  const future   = preds.filter(p => daysUntil(p.predictedDate) > 14)

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

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Texnik xizmat bashoratlari</h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
          Tarixiy ma'lumotlar asosida har bir mashina uchun keyingi xizmat sanasi
        </p>
      </div>

      {/* Yo'l-yo'riq paneli */}
      {showGuide && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 relative">
          <button onClick={() => setShowGuide(false)}
            className="absolute top-2 right-2 text-blue-400 hover:text-blue-600 text-xs">
            yashirish ✕
          </button>
          <div className="flex items-start gap-3">
            <Lightbulb className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
            <div className="text-sm space-y-2 text-blue-900 dark:text-blue-100">
              <p className="font-semibold">Bu modul nimani qiladi?</p>
              <p>
                Har bir mashinaning <b>oldingi texnik xizmat tarixiga</b> qarab,
                keyingi xizmat <b>qachon va qaysi km da</b> kerak bo'lishini avtomatik hisoblaydi.
                Misol uchun: <i>"Mashina 01-A123 yog' filtrini har 65 kunda almashtirgan — keyingi almashish 12 kundan keyin"</i>.
              </p>
              <p className="font-semibold mt-2">Qanday foydalanish kerak?</p>
              <ul className="list-disc list-inside space-y-1 ml-2">
                <li><b>🔧 Bajarildi</b> — texnik xizmat qildingiz, yangi yozuv qo'shing (Maintenance sahifasiga olib boradi)</li>
                <li><b>🕒 Keyinroq</b> — bashorat noto'g'ri, sanasini 14 kun keyinga suradi</li>
                <li><b>🔕 Yashirish</b> — bu bashoratni e'tibordan chetda qoldirish (qaytmaydi)</li>
              </ul>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-2">
                💡 <b>Eslatma:</b> Bashorat aniqligi mashina tarixiga bog'liq. Yangi mashinalar uchun bashorat ko'pincha noto'g'ri bo'ladi.
                Tarix to'planganda aniqroq bo'ladi.
              </p>
            </div>
          </div>
        </div>
      )}

      {!showGuide && (
        <button onClick={() => setShowGuide(true)}
          className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
          <Info className="w-3.5 h-3.5" /> Yo'l-yo'riqni ko'rsatish
        </button>
      )}

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Muddati o'tgan", count: overdue.length, color: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-700 text-red-600', filter: 'overdue', emoji: '🔴' },
          { label: '7 kun ichida', count: urgent.length, color: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-700 text-orange-600', filter: 'urgent', emoji: '🟠' },
          { label: '7-14 kun', count: upcoming.length, color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-700 text-yellow-600', filter: 'upcoming', emoji: '🟡' },
          { label: '14+ kun', count: future.length, color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-700 text-blue-600', filter: 'future', emoji: '🔵' },
        ].map(s => (
          <button key={s.filter} onClick={() => setUrgencyFilter(urgencyFilter === s.filter ? '' : s.filter)}
            className={`rounded-xl border p-4 text-center transition-all hover:shadow-md ${s.color} ${urgencyFilter === s.filter ? 'ring-2 ring-offset-1 ring-current' : ''}`}>
            <div className="text-3xl font-bold">{s.count}</div>
            <div className="text-xs mt-0.5 opacity-80">{s.emoji} {s.label}</div>
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
          <p className="text-gray-400">{search || categoryFilter || urgencyFilter ? 'Mos bashorat topilmadi' : "Bashoratlar yo'q"}</p>
          <p className="text-xs text-gray-300 mt-2">
            {!preds.length && 'Mashinalarda texnik xizmat tarixi to\'plansa bashoratlar paydo bo\'ladi'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(p => {
            const days = daysUntil(p.predictedDate)
            const u = urgencyColor(days)
            const isOpen = expanded === p.id
            const lowConfidence = Number(p.confidence) < 0.4

            return (
              <div key={p.id} className={`rounded-xl border ${u.border} bg-white dark:bg-gray-800 overflow-hidden`}>
                {/* Yuqori qator — asosiy ma'lumot */}
                <div className="flex items-center gap-3 p-4">
                  <div className={`w-2 h-12 rounded-full ${u.dot}`} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono font-bold text-gray-900 dark:text-white">{p.vehicle.registrationNumber}</span>
                      <span className="text-xs text-gray-500">{p.vehicle.brand} {p.vehicle.model}</span>
                      <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${u.bg} ${u.text}`}>
                        {CATEGORY_LABELS[p.partCategory] || p.partCategory}
                      </span>
                      {lowConfidence && (
                        <span className="text-xs text-amber-600 dark:text-amber-400 flex items-center gap-1">
                          <AlertTriangle className="w-3 h-3" /> Bashorat aniq emas
                        </span>
                      )}
                    </div>
                    <p className={`text-sm mt-1 font-medium ${u.text}`}>
                      {days < 0
                        ? `⏰ ${Math.abs(days)} kun kechikdi`
                        : days === 0
                        ? '⚡ Bugun!'
                        : `🕒 ${days} kun qolgan`}
                      <span className="text-gray-400 font-normal ml-2">— {formatDate(p.predictedDate)}</span>
                    </p>
                  </div>

                  <button
                    onClick={() => setExpanded(isOpen ? null : p.id)}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400"
                    title="Batafsil"
                  >
                    {isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                  </button>
                </div>

                {/* Kengaytirilgan: batafsil tarix va harakatlar */}
                {isOpen && (
                  <div className="border-t border-gray-100 dark:border-gray-700 p-4 bg-gray-50/50 dark:bg-gray-900/20 space-y-3">
                    {/* Tarix */}
                    <div className="flex items-start gap-2 text-sm">
                      <History className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-1">Asoslangan tarix</p>
                        {p.history && p.history.totalCount > 0 ? (
                          <ul className="space-y-0.5 text-gray-700 dark:text-gray-300 text-sm">
                            <li>📋 Jami <b>{p.history.totalCount}</b> ta yozuv (oxirgi 5 tasi tahlil qilindi)</li>
                            {p.history.lastDate && (
                              <li>📅 Oxirgi almashish: <b>{formatDate(p.history.lastDate)}</b>
                                {p.history.lastKm != null && <> ({Number(p.history.lastKm).toLocaleString()} km)</>}
                              </li>
                            )}
                            {p.history.avgDays != null && (
                              <li>⏱ O'rtacha interval: har <b>{p.history.avgDays}</b> kunda 1 marta</li>
                            )}
                            {p.history.avgKm != null && (
                              <li>🛣 O'rtacha km: har <b>{Number(p.history.avgKm).toLocaleString()} km</b> da 1 marta</li>
                            )}
                          </ul>
                        ) : (
                          <p className="text-gray-500 italic text-sm">
                            Tarix yo'q — flot priori (boshqa mashinalar tarixi) asosida bashorat
                          </p>
                        )}
                      </div>
                    </div>

                    {/* Bashorat */}
                    <div className="flex items-start gap-2 text-sm">
                      <CalendarClock className="w-4 h-4 text-gray-400 mt-0.5 shrink-0" />
                      <div className="flex-1">
                        <p className="text-xs uppercase tracking-wide font-semibold text-gray-500 mb-1">Bashorat natijasi</p>
                        <ul className="space-y-0.5 text-gray-700 dark:text-gray-300 text-sm">
                          <li>📍 Sana: <b>{formatDate(p.predictedDate)}</b></li>
                          {p.predictedKm != null && (
                            <li>🛣 Km: <b>{Number(p.predictedKm).toLocaleString()} km</b> da</li>
                          )}
                          <li>
                            🎯 Ishonchlilik: <b>{(Number(p.confidence) * 100).toFixed(0)}%</b>
                            <span className="ml-2 inline-block w-32 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden align-middle">
                              <span className={`block h-full ${Number(p.confidence) >= 0.8 ? 'bg-green-500' : Number(p.confidence) >= 0.5 ? 'bg-yellow-500' : 'bg-red-500'}`}
                                style={{ width: `${Number(p.confidence) * 100}%` }} />
                            </span>
                          </li>
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* Harakat tugmalari */}
                {hasRole('admin', 'manager', 'branch_manager') && (
                  <div className="flex gap-1.5 px-4 pb-3 flex-wrap">
                    <button
                      onClick={() => goToMaintenance(p)}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium rounded-lg"
                      title="Texnik xizmat sahifasiga o'tib yangi yozuv qo'shing"
                    >
                      <Wrench className="w-4 h-4" /> Bajarildi
                    </button>
                    <button
                      onClick={() => snoozeMutation.mutate({ id: p.id, days: 14 })}
                      disabled={snoozeMutation.isPending}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg disabled:opacity-50"
                      title="Bashorat noto'g'ri — 14 kun keyinga surish"
                    >
                      <Clock className="w-4 h-4" /> Keyinroq (14 kun)
                    </button>
                    <button
                      onClick={() => acknowledgeMutation.mutate(p.id)}
                      disabled={acknowledgeMutation.isPending}
                      className="flex-1 sm:flex-none flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-700 dark:hover:bg-gray-600 text-gray-500 dark:text-gray-400 text-sm font-medium rounded-lg disabled:opacity-50"
                      title="Bu bashoratni e'tibordan chetda qoldirish"
                    >
                      <EyeOff className="w-4 h-4" /> Yashirish
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
