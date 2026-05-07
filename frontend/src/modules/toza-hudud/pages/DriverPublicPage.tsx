import { useState, useEffect, useCallback } from 'react'
import {
  Truck, MapPin, CheckCircle2, XCircle, Clock, Wifi, AlertTriangle,
  ChevronLeft, ChevronRight, RefreshCw, Leaf, Lock, Eye, EyeOff,
} from 'lucide-react'
import api from '../../../lib/api'

// ── Yordamchi funksiyalar ─────────────────────────────────────────────────────

function todayStr() { return new Date().toISOString().split('T')[0] }
function shiftDate(s: string, days: number) {
  const d = new Date(s); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('uz-UZ', { weekday: 'long', day: '2-digit', month: 'long' })
}
function fmtTime(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}
function dur(a: string | null, b: string | null) {
  if (!a || !b) return null
  const m = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  return m > 0 ? `${m} daq` : null
}

const PIN_SESSION_KEY = 'th-driver-pin'

const STATUS_CFG = {
  visited:     { stripe: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'Borildi',      icon: CheckCircle2 },
  not_visited: { stripe: 'bg-red-500',     badge: 'bg-red-100 text-red-700',         label: 'Borilmadi',    icon: XCircle },
  no_gps:      { stripe: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-600',       label: "GPS yo'q",     icon: Wifi },
  no_polygon:  { stripe: 'bg-yellow-400',  badge: 'bg-yellow-100 text-yellow-700',   label: "Polygon yo'q", icon: AlertTriangle },
  pending:     { stripe: 'bg-blue-400',    badge: 'bg-blue-100 text-blue-700',       label: 'Kutmoqda',     icon: Clock },
} as const

// ── PIN kirish ekrani ─────────────────────────────────────────────────────────

function PinScreen({ onSuccess, error, loading }: {
  onSuccess: (pin: string) => void
  error: string | null
  loading: boolean
}) {
  const [pin, setPin] = useState('')
  const [show, setShow] = useState(false)

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (pin.length >= 4) onSuccess(pin)
  }

  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-900 to-emerald-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center">
        {/* Logo */}
        <div className="w-14 h-14 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg shadow-emerald-200">
          <Leaf className="w-7 h-7 text-white" />
        </div>
        <p className="font-bold text-gray-800 text-lg mb-0.5">Toza-Hudud</p>
        <p className="text-sm text-gray-500 mb-6">Haydovchi portali</p>

        <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <Lock className="w-6 h-6 text-emerald-600" />
        </div>
        <p className="text-sm font-medium text-gray-700 mb-4">PIN kodni kiriting</p>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div className="relative">
            <input
              type={show ? 'text' : 'password'}
              value={pin}
              onChange={e => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder="• • • •"
              maxLength={8}
              autoFocus
              className={`w-full text-center text-2xl tracking-[0.5em] font-mono px-4 py-3 border-2 rounded-xl outline-none transition-colors ${
                error ? 'border-red-300 bg-red-50' : 'border-gray-200 focus:border-emerald-400'
              }`}
            />
            <button
              type="button"
              onClick={() => setShow(v => !v)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
            >
              {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
            </button>
          </div>

          {error && (
            <p className="text-red-600 text-xs font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={pin.length < 4 || loading}
            className="w-full py-3 bg-emerald-600 text-white font-semibold rounded-xl hover:bg-emerald-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-2"
          >
            {loading
              ? <><RefreshCw className="w-4 h-4 animate-spin" /> Tekshirilmoqda...</>
              : 'Kirish'}
          </button>
        </form>
      </div>
    </div>
  )
}

// ── Xato ekrani ───────────────────────────────────────────────────────────────

function ErrorScreen({ msg }: { msg: string }) {
  return (
    <div className="min-h-screen bg-gradient-to-b from-emerald-900 to-emerald-800 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xs p-6 text-center">
        <div className="w-14 h-14 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
          <XCircle className="w-7 h-7 text-red-500" />
        </div>
        <p className="font-semibold text-gray-800 mb-2">Xato yuz berdi</p>
        <p className="text-sm text-gray-500">{msg}</p>
      </div>
    </div>
  )
}

// ── Asosiy sahifa ─────────────────────────────────────────────────────────────

export default function DriverPublicPage() {
  const params = new URLSearchParams(window.location.search)
  const token = params.get('token')

  const [pin, setPin] = useState<string>(() => sessionStorage.getItem(PIN_SESSION_KEY) || '')
  const [pinRequired, setPinRequired] = useState<boolean | null>(null)
  const [pinError, setPinError] = useState<string | null>(null)
  const [pinLoading, setPinLoading] = useState(false)

  const [date, setDate] = useState(todayStr)
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const isToday = date === todayStr()

  // Token yo'q bo'lsa — hech narsa ko'rsatmay xato
  if (!token) return <ErrorScreen msg="Noto'g'ri havola. QR kodni qayta skanerlang." />

  const fetchData = useCallback(async (currentPin: string, currentDate: string) => {
    setLoading(true)
    setFetchError(null)
    try {
      const res = await api.get('/th/driver/public-today', {
        params: { token, pin: currentPin || undefined, date: currentDate },
      })
      setData(res.data.data)
      setPinRequired(false)
      if (currentPin) sessionStorage.setItem(PIN_SESSION_KEY, currentPin)
    } catch (err: any) {
      const status = err.response?.status
      const msg: string = err.response?.data?.error || ''

      if (status === 401 && msg.includes('PIN talab')) {
        setPinRequired(true)
        setPin('')
        sessionStorage.removeItem(PIN_SESSION_KEY)
      } else if (status === 401) {
        setPinError('PIN noto\'g\'ri. Qayta urinib ko\'ring.')
        setPinLoading(false)
      } else if (status === 403) {
        setFetchError('Haydovchi kirish tizimi yoqilmagan. Administrator bilan bog\'laning.')
      } else {
        setFetchError('Ma\'lumot yuklashda xato yuz berdi. Sahifani yangilang.')
      }
    } finally {
      setLoading(false)
      setPinLoading(false)
    }
  }, [token])

  // Birinchi yuklanish — PIN session'da bo'lsa to'g'ridan yuborish
  useEffect(() => {
    fetchData(pin, date)
  }, [])

  // Sana o'zgarganda qayta yuklash
  useEffect(() => {
    if (pinRequired === false) {
      fetchData(pin, date)
    }
  }, [date])

  const handlePinSubmit = (enteredPin: string) => {
    setPinError(null)
    setPinLoading(true)
    setPin(enteredPin)
    fetchData(enteredPin, date)
  }

  // PIN kutilmoqda
  if (pinRequired === true) {
    return <PinScreen onSuccess={handlePinSubmit} error={pinError} loading={pinLoading} />
  }

  // Birinchi yuklanish (pinRequired hali aniqlanmagan)
  if (pinRequired === null && loading) {
    return (
      <div className="min-h-screen bg-emerald-900 flex items-center justify-center">
        <div className="text-center text-white space-y-3">
          <RefreshCw className="w-8 h-8 animate-spin mx-auto text-emerald-300" />
          <p className="text-sm text-emerald-300">Yuklanmoqda...</p>
        </div>
      </div>
    )
  }

  if (fetchError) return <ErrorScreen msg={fetchError} />

  const vehicle = data?.vehicle
  const summary = data?.summary
  const items: any[] = data?.items || []
  const landfillTrips: any[] = data?.landfillTrips || []

  const completionPct = summary?.total > 0
    ? Math.round(summary.visited / summary.total * 100) : 0

  const pendingItems = items.filter(i => i.status === 'pending')
  const nextItem = pendingItems[0]

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white px-4 pt-6 pb-5">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-7 h-7 bg-emerald-400 rounded-lg flex items-center justify-center shrink-0">
            <Leaf className="w-4 h-4 text-emerald-900" />
          </div>
          <p className="text-sm font-semibold text-emerald-100">Toza-Hudud — Haydovchi portali</p>
        </div>

        {/* Mashina */}
        {vehicle && (
          <div className="flex items-center gap-3 mb-4">
            <div className="w-11 h-11 bg-white/20 rounded-xl flex items-center justify-center shrink-0">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="font-mono font-bold text-xl tracking-wider">{vehicle.registrationNumber}</p>
              <p className="text-emerald-200 text-xs">{vehicle.brand} {vehicle.model}</p>
            </div>
          </div>
        )}

        {/* Sana navigatsiya */}
        <div className="flex items-center gap-1 bg-white/15 rounded-xl p-1">
          <button
            onClick={() => setDate(d => shiftDate(d, -1))}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          <div className="flex-1 text-center">
            <p className="text-sm font-semibold">{fmtDate(date)}</p>
          </div>
          <button
            onClick={() => setDate(d => shiftDate(d, 1))}
            disabled={isToday}
            className="p-2 hover:bg-white/20 rounded-lg transition-colors disabled:opacity-30"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
          {!isToday && (
            <button
              onClick={() => setDate(todayStr())}
              className="text-xs bg-white/20 px-2.5 py-1.5 rounded-lg"
            >
              Bugun
            </button>
          )}
        </div>

        {/* Progress */}
        {summary && summary.total > 0 && (
          <div className="mt-4">
            <div className="flex justify-between text-xs text-emerald-200 mb-1.5">
              <span>{summary.visited} / {summary.total} MFY</span>
              <span className="font-bold">{completionPct}%</span>
            </div>
            <div className="h-2 bg-white/20 rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  completionPct >= 80 ? 'bg-emerald-300' :
                  completionPct >= 50 ? 'bg-yellow-300' : 'bg-red-300'
                }`}
                style={{ width: `${completionPct}%` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Kontent */}
      <div className="p-4 space-y-3 max-w-lg mx-auto">

        {/* Yangilash */}
        {isToday && (
          <button
            onClick={() => fetchData(pin, date)}
            disabled={loading}
            className="w-full flex items-center justify-center gap-2 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-600 hover:bg-gray-50 disabled:opacity-50 transition-colors shadow-sm"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            {loading ? 'Yuklanmoqda...' : 'Yangilash'}
          </button>
        )}

        {/* Keyingi MFY */}
        {nextItem && isToday && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
              <MapPin className="w-5 h-5 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-bold text-blue-500 uppercase tracking-wider mb-0.5">
                Keyingi navbatda
              </p>
              <p className="font-semibold text-gray-800 truncate">{nextItem.mfy.name}</p>
              {nextItem.mfy.district && <p className="text-xs text-gray-500">{nextItem.mfy.district}</p>}
            </div>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full font-semibold shrink-0">
              {pendingItems.length} qoldi
            </span>
          </div>
        )}

        {/* Bo'sh holat */}
        {!loading && items.length === 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-10 text-center">
            <MapPin className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="font-medium text-gray-500">Bu kun uchun jadval yo'q</p>
          </div>
        )}

        {/* MFY ro'yxati */}
        {items.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide px-1">
              Marshrut — {items.length} ta MFY
            </p>
            {items.map((item, idx) => {
              const s = STATUS_CFG[item.status as keyof typeof STATUS_CFG] || STATUS_CFG.pending
              const Icon = s.icon
              const d = dur(item.enteredAt, item.exitedAt)
              return (
                <div key={item.mfy.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  <div className="flex">
                    <div className={`${s.stripe} w-1.5 shrink-0`} />
                    <div className="flex-1 p-3.5">
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs text-gray-400 font-mono shrink-0">
                              {String(idx + 1).padStart(2, '0')}
                            </span>
                            <span className="font-semibold text-gray-800 truncate">{item.mfy.name}</span>
                          </div>
                          {item.mfy.district && (
                            <p className="text-xs text-gray-400 mt-0.5 ml-6">{item.mfy.district}</p>
                          )}
                        </div>
                        <span className={`flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${s.badge}`}>
                          <Icon className="w-3 h-3" />
                          {s.label}
                        </span>
                      </div>

                      {(item.enteredAt || item.exitedAt) && (
                        <div className="flex items-center gap-3 mt-2 ml-6 text-xs text-gray-500">
                          {item.enteredAt && <span>🟢 {fmtTime(item.enteredAt)}</span>}
                          {item.exitedAt && <span>🔴 {fmtTime(item.exitedAt)}</span>}
                          {d && <span className="text-gray-400">({d})</span>}
                        </div>
                      )}

                      {item.coveragePct != null && item.status === 'visited' && (
                        <div className="mt-2 ml-6">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-gray-400">Qamrov</span>
                            <span className={`text-[10px] font-bold ${
                              item.coveragePct >= 70 ? 'text-emerald-600' :
                              item.coveragePct >= 40 ? 'text-amber-600' : 'text-red-600'
                            }`}>{item.coveragePct}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full ${
                                item.coveragePct >= 70 ? 'bg-emerald-500' :
                                item.coveragePct >= 40 ? 'bg-amber-400' : 'bg-red-400'
                              }`}
                              style={{ width: `${item.coveragePct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {item.suspicious && (
                        <p className="text-[11px] text-orange-600 mt-1.5 ml-6">⚠ Shubhali harakat qayd etildi</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Poligon tashriflari */}
        {landfillTrips.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-4 shadow-sm">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-500" />
              Chiqindi poligon tashriflari
            </p>
            <div className="space-y-2">
              {landfillTrips.map((t: any, i: number) => (
                <div key={i} className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2">
                  <span className="text-sm font-medium text-gray-700">{t.landfillName}</span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {fmtTime(t.arrivedAt)} → {fmtTime(t.leftAt)}
                    {t.durationMin != null && ` · ${t.durationMin} daq`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <p className="text-center text-[10px] text-gray-300 pb-4">
          Toza-Hudud · AutoHisob.uz
        </p>
      </div>
    </div>
  )
}
