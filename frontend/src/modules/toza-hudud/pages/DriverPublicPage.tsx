import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Truck, MapPin, CheckCircle2, XCircle, Clock, Wifi, AlertTriangle,
  ChevronLeft, ChevronRight, RefreshCw, Leaf, Lock, Eye, EyeOff, Navigation2,
  BookOpen, X, ArrowRight,
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

// ── Ko'cha yo'riqnomasi panel ─────────────────────────────────────────────────

interface StreetItem {
  osmWayId: string
  name: string | null
  highway: string
  lengthM: number
  monthsCovered: number
  priority: 0 | 1 | 2 | 3
}

interface StreetGuideData {
  streets: StreetItem[]
  hasStreetData: boolean
  isNewDriver: boolean
  totalStreets: number
  neverCount: number
  rareCount: number
}

const PRIORITY_CFG = {
  0: { label: 'Hech qachon', color: 'bg-red-500', badge: 'bg-red-100 text-red-700', border: 'border-l-red-500', dot: '🔴' },
  1: { label: 'Kam boriladi', color: 'bg-amber-400', badge: 'bg-amber-100 text-amber-700', border: 'border-l-amber-400', dot: '🟡' },
  2: { label: 'Odatda', color: 'bg-gray-300', badge: 'bg-gray-100 text-gray-600', border: 'border-l-gray-300', dot: '⚪' },
  3: { label: 'Doim boriladi', color: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', border: 'border-l-emerald-500', dot: '✅' },
} as const

function StreetGuidePanel({
  token, mfyId, mfyName, onClose,
}: { token: string; mfyId: string; mfyName: string; onClose: () => void }) {
  const [data, setData] = useState<StreetGuideData | null>(null)
  const [loading, setLoading] = useState(true)
  const [showAll, setShowAll] = useState(false)

  useEffect(() => {
    setLoading(true)
    api.get('/th/driver/street-guide', { params: { token, mfyId } })
      .then(r => setData(r.data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [token, mfyId])

  const streets = data?.streets ?? []
  const visible = showAll ? streets : streets.slice(0, 30)
  const priorityStreets = streets.filter(s => s.priority <= 1)

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-4 pt-5 pb-4 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-emerald-200">Ko'cha yo'riqnomasi</p>
            <p className="font-bold text-base truncate">{mfyName}</p>
          </div>
          <BookOpen className="w-5 h-5 text-emerald-300 shrink-0" />
        </div>

        {data && data.hasStreetData && (
          <div className="flex gap-2">
            {data.neverCount > 0 && (
              <div className="flex-1 bg-red-500/30 rounded-xl p-2.5 text-center">
                <p className="text-lg font-bold">{data.neverCount}</p>
                <p className="text-[10px] text-red-200">Hech qachon</p>
              </div>
            )}
            {data.rareCount > 0 && (
              <div className="flex-1 bg-amber-500/30 rounded-xl p-2.5 text-center">
                <p className="text-lg font-bold">{data.rareCount}</p>
                <p className="text-[10px] text-amber-200">Kam boriladi</p>
              </div>
            )}
            <div className="flex-1 bg-white/15 rounded-xl p-2.5 text-center">
              <p className="text-lg font-bold">{data.totalStreets}</p>
              <p className="text-[10px] text-emerald-200">Jami ko'cha</p>
            </div>
          </div>
        )}
      </div>

      {/* Kontent */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex items-center justify-center h-40 text-gray-400">
            <RefreshCw className="w-5 h-5 animate-spin mr-2" />
            <span className="text-sm">Yuklanmoqda...</span>
          </div>
        ) : !data || !data.hasStreetData ? (
          <div className="p-6 text-center">
            <BookOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="font-medium text-gray-500 text-sm">Bu MFY uchun ko'cha ma'lumoti yo'q</p>
            <p className="text-xs text-gray-400 mt-1">
              Avval "AI Ko'cha Tahlili" sahifasidan OSM ko'chalarini yuklab oling.
            </p>
          </div>
        ) : (
          <div className="p-4 space-y-2">
            {/* Muhim ogohlantirish */}
            {priorityStreets.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3 mb-3">
                <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Albatta o'tish kerak bo'lgan ko'chalar: {priorityStreets.length} ta
                </p>
                <p className="text-[11px] text-red-600 mt-0.5">
                  Qizil va sariq belgilangan ko'chalar GPS tarixida kamdan-kam yoki hech qachon tozalanmagan.
                </p>
              </div>
            )}

            {/* Ko'chalar ro'yxati */}
            {visible.map((s, i) => {
              const cfg = PRIORITY_CFG[s.priority]
              return (
                <div key={s.osmWayId}
                  className={`bg-white rounded-xl border border-gray-100 border-l-4 ${cfg.border} overflow-hidden shadow-sm`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <span className="text-base shrink-0">{cfg.dot}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {s.name || <span className="text-gray-400 italic text-xs">Nomsiz ko'cha</span>}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-gray-400">{s.highway}</span>
                        <span className="text-[10px] text-gray-400">·</span>
                        <span className="text-[10px] text-gray-400">{s.lengthM}m</span>
                        {s.monthsCovered > 0 && (
                          <>
                            <span className="text-[10px] text-gray-400">·</span>
                            <span className="text-[10px] text-gray-400">{s.monthsCovered}/6 oy</span>
                          </>
                        )}
                      </div>
                    </div>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${cfg.badge}`}>
                      {cfg.label}
                    </span>
                  </div>
                </div>
              )
            })}

            {streets.length > 30 && (
              <button
                onClick={() => setShowAll(v => !v)}
                className="w-full py-3 text-sm text-emerald-700 font-medium bg-emerald-50 rounded-xl"
              >
                {showAll ? 'Kamroq ko\'rsat' : `Barchasini ko'rsat (${streets.length} ta)`}
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

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

// ── Marshut xaritasi ──────────────────────────────────────────────────────────

interface RoutePoint {
  order: number
  mfyId: string
  mfyName: string
  district: string
  centroid: [number, number]
  distanceFromPrevKm: number | null
  cumulativeKm: number
}

function RouteMapTab({ token, date }: { token: string; date: string }) {
  const mapRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const [route, setRoute] = useState<RoutePoint[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    api.get('/th/routes/public', { params: { token, date } })
      .then(r => { setRoute(r.data.data.route); setError(null) })
      .catch(() => setError("Marshrutni yuklashda xato yuz berdi"))
      .finally(() => setLoading(false))
  }, [token, date])

  useEffect(() => {
    if (!mapContainerRef.current || route.length === 0) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

    import('leaflet').then(L => {
      const Lx = L.default ?? L as any

      const center: [number, number] = route.length > 0
        ? [
            route.reduce((s, p) => s + p.centroid[0], 0) / route.length,
            route.reduce((s, p) => s + p.centroid[1], 0) / route.length,
          ]
        : [41.3, 69.2]

      const map = Lx.map(mapContainerRef.current!, { zoomControl: true, attributionControl: false })
      Lx.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map)
      map.setView(center, 13)
      mapRef.current = map

      // Polyline
      if (route.length > 1) {
        Lx.polyline(route.map(p => p.centroid), {
          color: '#059669', weight: 3, opacity: 0.8, dashArray: '8, 6',
        }).addTo(map)
      }

      // Numbered markers
      route.forEach(pt => {
        const icon = Lx.divIcon({
          html: `<div style="
            width:28px;height:28px;border-radius:50%;
            background:#059669;color:white;font-weight:bold;font-size:12px;
            display:flex;align-items:center;justify-content:center;
            border:2px solid white;box-shadow:0 2px 6px rgba(0,0,0,0.3);
          ">${pt.order}</div>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
          className: '',
        })
        const dist = pt.distanceFromPrevKm != null ? `<br>Oldingi: ${pt.distanceFromPrevKm} km` : ''
        Lx.marker(pt.centroid, { icon })
          .addTo(map)
          .bindPopup(`<b>${pt.order}. ${pt.mfyName}</b><br>${pt.district}${dist}`)
      })

      if (route.length > 0) {
        map.fitBounds(Lx.latLngBounds(route.map(p => p.centroid)), { padding: [24, 24] })
      }
    })

    return () => { if (mapRef.current) { mapRef.current.remove(); mapRef.current = null } }
  }, [route])

  if (loading) return (
    <div className="flex items-center justify-center h-48 text-emerald-300">
      <RefreshCw className="w-5 h-5 animate-spin mr-2" />
      <span className="text-sm">Marshrut hisoblanmoqda...</span>
    </div>
  )

  if (error) return (
    <div className="p-4 text-center text-sm text-red-400">{error}</div>
  )

  if (route.length === 0) return (
    <div className="p-8 text-center text-sm text-gray-400">Bu kun uchun jadval yo'q</div>
  )

  const totalKm = route[route.length - 1]?.cumulativeKm ?? 0

  return (
    <div className="space-y-3 p-4">
      {/* Leaflet xarita */}
      <div
        ref={mapContainerRef}
        className="rounded-xl overflow-hidden border border-gray-200"
        style={{ height: 280 }}
      />

      {/* Tartib ro'yxati */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-2.5 border-b border-gray-100 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-600">Optimal tartib</p>
          <span className="text-xs text-gray-400">Jami: ~{totalKm} km</span>
        </div>
        {route.map(pt => (
          <div key={pt.mfyId} className="flex items-center gap-3 px-4 py-3 border-b border-gray-50 last:border-0">
            <div className="w-7 h-7 rounded-full bg-emerald-500 text-white font-bold text-xs flex items-center justify-center shrink-0">
              {pt.order}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 truncate">{pt.mfyName}</p>
              {pt.district && <p className="text-xs text-gray-400">{pt.district}</p>}
            </div>
            {pt.distanceFromPrevKm != null && (
              <span className="text-[11px] text-gray-400 shrink-0">{pt.distanceFromPrevKm} km</span>
            )}
          </div>
        ))}
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
  const [tab, setTab] = useState<'list' | 'route'>('list')
  const [streetGuide, setStreetGuide] = useState<{ mfyId: string; mfyName: string } | null>(null)

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

        {/* Tab switcher */}
        <div className="mt-4 flex bg-white/15 rounded-xl p-1 gap-1">
          <button
            onClick={() => setTab('list')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'list' ? 'bg-white text-emerald-700' : 'text-emerald-100 hover:bg-white/10'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            Ro'yxat
          </button>
          <button
            onClick={() => setTab('route')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'route' ? 'bg-white text-emerald-700' : 'text-emerald-100 hover:bg-white/10'
            }`}
          >
            <Navigation2 className="w-3.5 h-3.5" />
            Marshut
          </button>
        </div>
      </div>

      {/* Kontent */}
      <div className="max-w-lg mx-auto">

      {/* Yangi haydovchi banner */}
      {data?.isNewDriver && tab === 'list' && (
        <div className="mx-4 mt-3 bg-amber-50 border border-amber-300 rounded-xl p-3 flex items-start gap-2">
          <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-xs font-bold text-amber-800">Yo'riqnoma rejimi yoqilgan</p>
            <p className="text-xs text-amber-700 mt-0.5">
              Har bir MFY kartasidagi <strong>"Ko'chalar →"</strong> tugmasini bosib yo'riqnomani ko'ring.
              Qizil ko'chalar GPS tarixida hech qachon tozalanmagan — ularga albatta kiring.
            </p>
          </div>
        </div>
      )}

      {/* Marshut tab */}
      {tab === 'route' && (
        <RouteMapTab token={token} date={date} />
      )}

      {tab === 'list' && (
      <div className="p-4 space-y-3">

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

                      {/* Ko'cha yo'riqnomasi tugmasi */}
                      <button
                        onClick={() => setStreetGuide({ mfyId: item.mfy.id, mfyName: item.mfy.name })}
                        className="mt-2 ml-6 flex items-center gap-1 text-[11px] text-emerald-600 font-semibold hover:text-emerald-700"
                      >
                        <BookOpen className="w-3 h-3" />
                        Ko'chalar yo'riqnomasi
                        <ArrowRight className="w-3 h-3" />
                      </button>
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
      )}
    </div>

      {/* Ko'cha yo'riqnomasi overlay */}
      {streetGuide && token && (
        <StreetGuidePanel
          token={token}
          mfyId={streetGuide.mfyId}
          mfyName={streetGuide.mfyName}
          onClose={() => setStreetGuide(null)}
        />
      )}
    </div>
  )
}
