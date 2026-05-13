import { useEffect, useState } from 'react'
import { AxiosInstance } from 'axios'
import { Truck, Gauge, Fuel, TrendingUp, CheckCircle, Clock } from 'lucide-react'

interface Props {
  api: AxiosInstance
  user: { id: string; fullName: string; role: string }
  tg: any
}

interface ActiveWaybill {
  id: string
  number: string
  status: 'draft' | 'active' | 'completed'
  vehicle: { plateNumber: string; make: string; model: string }
  departureAt: string | null
  departureOdometer: number | null
}

interface Stats {
  totalTrips: number
  totalKm: number
  totalFuel: number
  thisMonthTrips: number
}

export default function TMAHome({ api, user, tg }: Props) {
  const [data, setData] = useState<{ active: ActiveWaybill | null; recent: ActiveWaybill[]; stats: Stats } | null>(null)
  const [loading, setLoading] = useState(true)
  const [actionLoading, setActionLoading] = useState(false)
  const [odometer, setOdometer] = useState('')
  const [fuel, setFuel] = useState('')
  const [step, setStep] = useState<'idle' | 'depart' | 'arrive'>('idle')

  useEffect(() => { load() }, [])

  async function load() {
    try {
      const res = await api.get('/waybills/my')
      setData(res.data)
      setLoading(false)
    } catch {
      setLoading(false)
    }
  }

  async function activateWaybill() {
    if (!data?.active || !odometer) return
    const km = Number(odometer)
    if (!km || km < (data.active.departureOdometer || 0)) {
      tg?.HapticFeedback?.impactOccurred('heavy')
      return
    }
    setActionLoading(true)
    try {
      await api.post(`/waybills/${data.active.id}/activate`, { departureOdometer: km })
      tg?.HapticFeedback?.impactOccurred('medium')
      setStep('idle')
      setOdometer('')
      load()
    } catch {
      tg?.HapticFeedback?.impactOccurred('heavy')
    } finally {
      setActionLoading(false)
    }
  }

  async function completeWaybill() {
    if (!data?.active || !odometer) return
    const km = Number(odometer)
    const fuelL = Number(fuel) || 0
    setActionLoading(true)
    try {
      await api.post(`/waybills/${data.active.id}/complete`, {
        returnOdometer: km,
        actualFuelUsed: fuelL || undefined,
      })
      tg?.HapticFeedback?.impactOccurred('medium')
      setStep('idle')
      setOdometer('')
      setFuel('')
      load()
    } catch {
      tg?.HapticFeedback?.impactOccurred('heavy')
    } finally {
      setActionLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const w = data?.active
  const s = data?.stats

  return (
    <div className="p-4 space-y-4">
      {/* Greeting */}
      <div>
        <h1 className="text-lg font-semibold">Salom, {user.fullName.split(' ')[0]}! 👋</h1>
        <p className="text-sm opacity-60">Bugun {new Date().toLocaleDateString('uz-UZ', { weekday: 'long', day: 'numeric', month: 'long' })}</p>
      </div>

      {/* Active waybill card */}
      {w ? (
        <div
          className="rounded-2xl p-4 space-y-3"
          style={{ background: 'var(--tg-theme-secondary-bg-color, #fff)' }}
        >
          <div className="flex items-center gap-2">
            <Truck className="w-5 h-5 text-blue-500" />
            <span className="font-semibold text-sm">Faol yo'llanma</span>
            <span className={`ml-auto text-xs px-2 py-0.5 rounded-full font-medium ${
              w.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {w.status === 'active' ? 'Yo\'lda' : 'Kutmoqda'}
            </span>
          </div>

          <div>
            <div className="font-mono text-base font-bold">{w.vehicle.plateNumber}</div>
            <div className="text-xs opacity-60">{w.vehicle.make} {w.vehicle.model} · #{w.number}</div>
          </div>

          {/* Actions */}
          {w.status === 'draft' && step === 'idle' && (
            <button
              onClick={() => setStep('depart')}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: 'var(--tg-theme-button-color, #3b82f6)' }}
            >
              Jo'nashni tasdiqlash
            </button>
          )}

          {w.status === 'draft' && step === 'depart' && (
            <div className="space-y-2">
              <label className="text-xs opacity-60">Jo'nash odometri (km)</label>
              <input
                type="number"
                value={odometer}
                onChange={e => setOdometer(e.target.value)}
                placeholder="Masalan: 125400"
                className="w-full rounded-xl px-3 py-2.5 text-sm border"
                style={{
                  background: 'var(--tg-theme-bg-color, #f5f5f5)',
                  borderColor: 'var(--tg-theme-hint-color, #ddd)',
                  color: 'var(--tg-theme-text-color, #000)',
                }}
                inputMode="numeric"
              />
              <div className="flex gap-2">
                <button onClick={() => setStep('idle')} className="flex-1 py-2 rounded-xl text-sm border"
                  style={{ borderColor: 'var(--tg-theme-hint-color, #ddd)' }}>
                  Bekor
                </button>
                <button
                  onClick={activateWaybill}
                  disabled={!odometer || actionLoading}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: 'var(--tg-theme-button-color, #3b82f6)' }}
                >
                  {actionLoading ? '...' : 'Jo\'nash'}
                </button>
              </div>
            </div>
          )}

          {w.status === 'active' && step === 'idle' && (
            <button
              onClick={() => setStep('arrive')}
              className="w-full py-2.5 rounded-xl text-sm font-semibold text-white"
              style={{ background: '#10b981' }}
            >
              Qaytishni tasdiqlash
            </button>
          )}

          {w.status === 'active' && step === 'arrive' && (
            <div className="space-y-2">
              <label className="text-xs opacity-60">Qaytish odometri (km)</label>
              <input
                type="number"
                value={odometer}
                onChange={e => setOdometer(e.target.value)}
                placeholder={`${(w.departureOdometer || 0) + 1}`}
                className="w-full rounded-xl px-3 py-2.5 text-sm border"
                style={{
                  background: 'var(--tg-theme-bg-color, #f5f5f5)',
                  borderColor: 'var(--tg-theme-hint-color, #ddd)',
                  color: 'var(--tg-theme-text-color, #000)',
                }}
                inputMode="numeric"
              />
              <label className="text-xs opacity-60">Yoqilg'i sarfi (litr, ixtiyoriy)</label>
              <input
                type="number"
                value={fuel}
                onChange={e => setFuel(e.target.value)}
                placeholder="0.0"
                className="w-full rounded-xl px-3 py-2.5 text-sm border"
                style={{
                  background: 'var(--tg-theme-bg-color, #f5f5f5)',
                  borderColor: 'var(--tg-theme-hint-color, #ddd)',
                  color: 'var(--tg-theme-text-color, #000)',
                }}
                inputMode="decimal"
              />
              <div className="flex gap-2">
                <button onClick={() => setStep('idle')} className="flex-1 py-2 rounded-xl text-sm border"
                  style={{ borderColor: 'var(--tg-theme-hint-color, #ddd)' }}>
                  Bekor
                </button>
                <button
                  onClick={completeWaybill}
                  disabled={!odometer || actionLoading}
                  className="flex-1 py-2 rounded-xl text-sm font-semibold text-white disabled:opacity-50"
                  style={{ background: '#10b981' }}
                >
                  {actionLoading ? '...' : 'Tugatish'}
                </button>
              </div>
            </div>
          )}
        </div>
      ) : (
        <div
          className="rounded-2xl p-4 flex items-center gap-3"
          style={{ background: 'var(--tg-theme-secondary-bg-color, #fff)' }}
        >
          <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0" />
          <div>
            <div className="font-medium text-sm">Faol yo'llanma yo'q</div>
            <div className="text-xs opacity-60">Yangi yo'llanma admin tomonidan beriladi</div>
          </div>
        </div>
      )}

      {/* Stats */}
      {s && (
        <div className="grid grid-cols-2 gap-3">
          {[
            { label: "Bu oy safar", value: s.thisMonthTrips, icon: Clock, unit: 'ta' },
            { label: "Jami safar",  value: s.totalTrips,     icon: Truck, unit: 'ta' },
            { label: "Jami km",     value: s.totalKm.toLocaleString(), icon: Gauge, unit: 'km' },
            { label: "Jami yoqilg'i", value: s.totalFuel.toFixed(0), icon: Fuel, unit: 'L' },
          ].map(card => (
            <div
              key={card.label}
              className="rounded-2xl p-3"
              style={{ background: 'var(--tg-theme-secondary-bg-color, #fff)' }}
            >
              <div className="flex items-center gap-1.5 mb-1">
                <card.icon className="w-3.5 h-3.5 opacity-50" />
                <span className="text-xs opacity-50">{card.label}</span>
              </div>
              <div className="font-bold text-lg leading-tight">
                {card.value} <span className="text-xs font-normal opacity-60">{card.unit}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Recent completed */}
      {data?.recent && data.recent.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold mb-2 opacity-60">Oxirgi safarlar</h2>
          <div className="space-y-2">
            {data.recent.slice(0, 5).map((r: any) => (
              <div
                key={r.id}
                className="rounded-xl px-3 py-2.5 flex items-center gap-3"
                style={{ background: 'var(--tg-theme-secondary-bg-color, #fff)' }}
              >
                <TrendingUp className="w-4 h-4 text-green-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{r.vehicle?.plateNumber} · #{r.number}</div>
                  <div className="text-xs opacity-50">
                    {r.returnOdometer && r.departureOdometer
                      ? `${(r.returnOdometer - r.departureOdometer).toLocaleString()} km`
                      : 'Masofa yo\'q'}
                  </div>
                </div>
                <span className="text-xs opacity-40">
                  {r.completedAt ? new Date(r.completedAt).toLocaleDateString('uz-UZ', { day: 'numeric', month: 'short' }) : ''}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
