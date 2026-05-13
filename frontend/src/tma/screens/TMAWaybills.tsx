import { useEffect, useState } from 'react'
import { AxiosInstance } from 'axios'
import { Truck, Clock, CheckCircle, FileText } from 'lucide-react'

interface Props {
  api: AxiosInstance
  user: { id: string; fullName: string; role: string }
  tg: any
}

interface Waybill {
  id: string
  number: string
  status: 'draft' | 'active' | 'completed'
  departureAt: string | null
  completedAt: string | null
  departureOdometer: number | null
  returnOdometer: number | null
  vehicle: { plateNumber: string; make: string; model: string }
}

const STATUS_LABEL: Record<string, string> = {
  draft:     'Kutmoqda',
  active:    'Yo\'lda',
  completed: 'Yakunlangan',
}
const STATUS_COLOR: Record<string, string> = {
  draft:     'bg-amber-100 text-amber-700',
  active:    'bg-green-100 text-green-700',
  completed: 'bg-gray-100 text-gray-600',
}
const STATUS_ICON: Record<string, React.ElementType> = {
  draft:     Clock,
  active:    Truck,
  completed: CheckCircle,
}

export default function TMAWaybills({ api, tg }: Props) {
  const [waybills, setWaybills] = useState<Waybill[]>([])
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<'all' | 'active' | 'draft' | 'completed'>('all')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const res = await api.get('/waybills/my')
      const { active, drafts, recent } = res.data
      const all: Waybill[] = [
        ...(active ? [active] : []),
        ...(drafts || []),
        ...(recent || []),
      ]
      // deduplicate by id
      const seen = new Set<string>()
      setWaybills(all.filter(w => { if (seen.has(w.id)) return false; seen.add(w.id); return true }))
    } catch {
      // silently fail
    } finally {
      setLoading(false)
    }
  }

  const filtered = filter === 'all' ? waybills : waybills.filter(w => w.status === filter)

  const tabs: { id: typeof filter; label: string }[] = [
    { id: 'all',       label: 'Barchasi' },
    { id: 'active',    label: 'Faol'     },
    { id: 'draft',     label: 'Kutmoqda' },
    { id: 'completed', label: 'Tugagan'  },
  ]

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  return (
    <div className="p-4 space-y-4">
      <h1 className="text-lg font-semibold">Yo'llanmalar</h1>

      {/* Filter tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
        {tabs.map(t => (
          <button
            key={t.id}
            onClick={() => { tg?.HapticFeedback?.impactOccurred('light'); setFilter(t.id) }}
            className="flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-colors"
            style={{
              background: filter === t.id
                ? 'var(--tg-theme-button-color, #3b82f6)'
                : 'var(--tg-theme-secondary-bg-color, #fff)',
              color: filter === t.id
                ? 'var(--tg-theme-button-text-color, #fff)'
                : 'var(--tg-theme-text-color, #000)',
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center py-12 opacity-50">
          <FileText className="w-10 h-10 mb-2" />
          <p className="text-sm">Yo'llanmalar yo'q</p>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map(w => {
            const Icon = STATUS_ICON[w.status]
            const km = w.returnOdometer && w.departureOdometer
              ? w.returnOdometer - w.departureOdometer
              : null
            return (
              <div
                key={w.id}
                className="rounded-2xl p-4 space-y-2"
                style={{ background: 'var(--tg-theme-secondary-bg-color, #fff)' }}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Icon className="w-4 h-4 opacity-60" />
                    <span className="font-mono text-sm font-bold">{w.vehicle.plateNumber}</span>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLOR[w.status]}`}>
                    {STATUS_LABEL[w.status]}
                  </span>
                </div>

                <div className="text-xs opacity-50">
                  {w.vehicle.make} {w.vehicle.model} · Yo'llanma #{w.number}
                </div>

                <div className="flex gap-4 text-xs">
                  {w.departureAt && (
                    <div>
                      <div className="opacity-40 mb-0.5">Jo'nagan</div>
                      <div className="font-medium">
                        {new Date(w.departureAt).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  )}
                  {w.completedAt && (
                    <div>
                      <div className="opacity-40 mb-0.5">Qaytgan</div>
                      <div className="font-medium">
                        {new Date(w.completedAt).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  )}
                  {km !== null && (
                    <div className="ml-auto">
                      <div className="opacity-40 mb-0.5">Masofa</div>
                      <div className="font-bold text-blue-500">{km.toLocaleString()} km</div>
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
