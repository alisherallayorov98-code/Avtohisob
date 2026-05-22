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
  geometry?: [number, number][]
}

interface StreetGuideData {
  streets: StreetItem[]
  hasStreetData: boolean
  isNewDriver: boolean
  mfyVisitedToday: boolean
  mfyCoveragePctToday: number | null
  totalStreets: number
  neverCount: number
  rareCount: number
}

const PRIORITY_CFG = {
  0: { label: 'Hech qachon', mapColor: '#ef4444', mapWeight: 5, badge: 'bg-red-100 text-red-700', border: 'border-l-red-500', dot: '🔴' },
  1: { label: 'Kam boriladi', mapColor: '#f59e0b', mapWeight: 4, badge: 'bg-amber-100 text-amber-700', border: 'border-l-amber-400', dot: '🟡' },
  2: { label: 'Odatda',       mapColor: '#9ca3af', mapWeight: 2.5, badge: 'bg-gray-100 text-gray-600', border: 'border-l-gray-300', dot: '⚪' },
  3: { label: 'Doim boriladi',mapColor: '#10b981', mapWeight: 2.5, badge: 'bg-emerald-100 text-emerald-700', border: 'border-l-emerald-500', dot: '✅' },
} as const

function haversineM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function StreetGuidePanel({
  token, mfyId, mfyName, onClose,
}: { token: string; mfyId: string; mfyName: string; onClose: () => void }) {
  const [data, setData] = useState<StreetGuideData | null>(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab] = useState<'list' | 'map'>('list')
  const [showAll, setShowAll] = useState(false)
  const [userPos, setUserPos] = useState<[number, number] | null>(null)
  const [nearest, setNearest] = useState<{ name: string | null; dist: number } | null>(null)
  const mapRef = useRef<any>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const userMarkerRef = useRef<any>(null)

  // Ma'lumotlarni geometry bilan yuklash
  useEffect(() => {
    setLoading(true)
    api.get('/th/driver/street-guide', { params: { token, mfyId, includeGeometry: 'true' } })
      .then(r => setData(r.data.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false))
  }, [token, mfyId])

  // GPS kuzatuv
  useEffect(() => {
    if (!navigator.geolocation) return
    const wid = navigator.geolocation.watchPosition(
      pos => setUserPos([pos.coords.latitude, pos.coords.longitude]),
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    )
    return () => navigator.geolocation.clearWatch(wid)
  }, [])

  // Eng yaqin qoplanmagan ko'cha hisoblash
  useEffect(() => {
    if (!userPos || !data?.streets) return
    const [ulat, ulon] = userPos
    let minDist = Infinity
    let minStreet: StreetItem | null = null
    for (const s of data.streets) {
      if (s.priority > 1 || !s.geometry) continue
      for (const [clat, clon] of s.geometry) {
        const d = haversineM(ulat, ulon, clat, clon)
        if (d < minDist) { minDist = d; minStreet = s }
      }
    }
    setNearest(minStreet ? { name: minStreet.name, dist: Math.round(minDist) } : null)
  }, [userPos, data])

  // Leaflet xarita
  useEffect(() => {
    if (tab !== 'map' || loading || !data?.streets?.length || !mapContainerRef.current) return
    if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }

    import('leaflet').then(L => {
      const Lx = L.default ?? (L as any)
      if (!mapContainerRef.current) return

      // Markazni ko'chalar bo'yicha topish
      const allCoords: [number, number][] = []
      for (const s of data.streets) {
        if (s.geometry) for (const c of s.geometry) allCoords.push(c)
      }
      const center: [number, number] = allCoords.length > 0
        ? [
            allCoords.reduce((sum, c) => sum + c[0], 0) / allCoords.length,
            allCoords.reduce((sum, c) => sum + c[1], 0) / allCoords.length,
          ]
        : [41.3, 69.2]

      const map = Lx.map(mapContainerRef.current, { zoomControl: true, attributionControl: false })
      Lx.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OSM',
      }).addTo(map)
      map.setView(center, 15)
      mapRef.current = map

      // Har ko'cha polyline
      for (const s of data.streets) {
        if (!s.geometry || s.geometry.length < 2) continue
        const cfg = PRIORITY_CFG[s.priority]
        const line = Lx.polyline(s.geometry, {
          color: cfg.mapColor,
          weight: cfg.mapWeight,
          opacity: s.priority === 0 ? 0.95 : s.priority === 1 ? 0.85 : 0.6,
        }).addTo(map)
        line.bindPopup(
          `<b>${s.name || 'Nomsiz ko\'cha'}</b><br>${cfg.label} · ${s.lengthM}m<br>${s.monthsCovered}/6 oy qoplangan`
        )
      }

      // Foydalanuvchi joylashuvi
      if (userPos) {
        const icon = Lx.divIcon({
          html: `<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 0 0 2px #3b82f6,0 2px 8px rgba(59,130,246,0.5);"></div>`,
          iconSize: [16, 16], iconAnchor: [8, 8], className: '',
        })
        userMarkerRef.current = Lx.marker(userPos, { icon }).addTo(map).bindPopup('📍 Siz shu yerdasiz')
      }

      if (allCoords.length > 0) {
        map.fitBounds(Lx.latLngBounds(allCoords), { padding: [24, 24], maxZoom: 17 })
      }
    })

    return () => {
      if (mapRef.current) { mapRef.current.remove(); mapRef.current = null }
    }
  }, [tab, data, loading]) // eslint-disable-line react-hooks/exhaustive-deps

  // GPS o'zgarganda faqat markerni yangilash (xaritani qayta yaratmaslik)
  useEffect(() => {
    if (!mapRef.current || !userPos || tab !== 'map') return
    import('leaflet').then(L => {
      const Lx = L.default ?? (L as any)
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng(userPos)
      } else {
        const icon = Lx.divIcon({
          html: `<div style="width:16px;height:16px;border-radius:50%;background:#3b82f6;border:3px solid white;box-shadow:0 0 0 2px #3b82f6,0 2px 8px rgba(59,130,246,0.5);"></div>`,
          iconSize: [16, 16], iconAnchor: [8, 8], className: '',
        })
        userMarkerRef.current = Lx.marker(userPos, { icon }).addTo(mapRef.current).bindPopup('📍 Siz shu yerdasiz')
      }
    })
  }, [userPos, tab])

  const streets = data?.streets ?? []
  const visible = showAll ? streets : streets.slice(0, 30)
  const priorityStreets = streets.filter(s => s.priority <= 1)

  return (
    <div className="fixed inset-0 z-50 bg-white flex flex-col">
      {/* Header */}
      <div className="bg-gradient-to-r from-emerald-600 to-emerald-700 text-white px-4 pt-5 pb-3 shrink-0">
        <div className="flex items-center gap-3 mb-3">
          <button onClick={onClose} className="p-1.5 hover:bg-white/20 rounded-lg transition-colors">
            <X className="w-5 h-5" />
          </button>
          <div className="flex-1 min-w-0">
            <p className="text-xs text-emerald-200">Ko'cha yo'riqnomasi</p>
            <p className="font-bold text-base truncate">{mfyName}</p>
          </div>
          {data?.mfyVisitedToday && (
            <span className="shrink-0 px-2 py-0.5 rounded-full text-xs font-bold bg-white/20 text-emerald-100 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" />
              {data.mfyCoveragePctToday != null ? `${data.mfyCoveragePctToday}%` : 'Borildi'}
            </span>
          )}
        </div>

        {/* Statistika kartalar */}
        {data && data.hasStreetData && (
          <div className="flex gap-2 mb-3">
            {data.neverCount > 0 && (
              <div className="flex-1 bg-red-500/30 rounded-xl p-2 text-center">
                <p className="text-base font-bold">{data.neverCount}</p>
                <p className="text-[10px] text-red-200">Hech qachon</p>
              </div>
            )}
            {data.rareCount > 0 && (
              <div className="flex-1 bg-amber-500/30 rounded-xl p-2 text-center">
                <p className="text-base font-bold">{data.rareCount}</p>
                <p className="text-[10px] text-amber-200">Kam boriladi</p>
              </div>
            )}
            <div className="flex-1 bg-white/15 rounded-xl p-2 text-center">
              <p className="text-base font-bold">{data.totalStreets}</p>
              <p className="text-[10px] text-emerald-200">Jami ko'cha</p>
            </div>
          </div>
        )}

        {/* Tab switcher */}
        <div className="flex bg-white/15 rounded-xl p-1 gap-1">
          <button
            onClick={() => setTab('list')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'list' ? 'bg-white text-emerald-700' : 'text-emerald-100 hover:bg-white/10'
            }`}
          >
            <BookOpen className="w-3.5 h-3.5" /> Ro'yxat
          </button>
          <button
            onClick={() => setTab('map')}
            className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-semibold transition-colors ${
              tab === 'map' ? 'bg-white text-emerald-700' : 'text-emerald-100 hover:bg-white/10'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" /> Xarita
          </button>
        </div>
      </div>

      {/* Loading */}
      {loading && (
        <div className="flex-1 flex items-center justify-center text-gray-400">
          <RefreshCw className="w-5 h-5 animate-spin mr-2" />
          <span className="text-sm">Yuklanmoqda...</span>
        </div>
      )}

      {/* Ma'lumot yo'q */}
      {!loading && (!data || !data.hasStreetData) && (
        <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
          <BookOpen className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="font-medium text-gray-500 text-sm">Bu MFY uchun ko'cha ma'lumoti yo'q</p>
          <p className="text-xs text-gray-400 mt-1">
            Avval "AI Ko'cha Tahlili" sahifasidan OSM ko'chalarini yuklab oling.
          </p>
        </div>
      )}

      {/* Ro'yxat tab */}
      {!loading && data?.hasStreetData && tab === 'list' && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-4 space-y-2">
            {priorityStreets.length > 0 && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-3">
                <p className="text-xs font-bold text-red-700 flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5" />
                  Albatta o'tish kerak: {priorityStreets.length} ta ko'cha
                </p>
                <p className="text-[11px] text-red-600 mt-0.5">
                  Qizil va sariq ko'chalar GPS tarixida hech qachon yoki kamdan-kam qoplangan.
                </p>
              </div>
            )}

            {visible.map(s => {
              const cfg = PRIORITY_CFG[s.priority]
              return (
                <div key={s.osmWayId}
                  className={`bg-white rounded-xl border border-gray-100 border-l-4 ${cfg.border} shadow-sm`}
                >
                  <div className="flex items-center gap-3 p-3">
                    <span className="text-base shrink-0">{cfg.dot}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-800 truncate">
                        {s.name ?? <span className="text-gray-400 italic text-xs">Nomsiz ko'cha</span>}
                      </p>
                      <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                        <span className="text-[10px] text-gray-400">{s.highway}</span>
                        <span className="text-[10px] text-gray-300">·</span>
                        <span className="text-[10px] text-gray-400">{s.lengthM}m</span>
                        {s.monthsCovered > 0 && (
                          <span className="text-[10px] text-gray-400">· {s.monthsCovered}/6 oy</span>
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
                {showAll ? "Kamroq ko'rsat" : `Barchasini ko'rsat (${streets.length} ta)`}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Xarita tab */}
      {!loading && data?.hasStreetData && tab === 'map' && (
        <div className="flex-1 flex flex-col relative">
          {/* Rang izoh */}
          <div className="absolute top-2 right-2 z-[1000] bg-white/90 backdrop-blur rounded-xl shadow px-2.5 py-2 space-y-1">
            {([0, 1, 2, 3] as const).map(p => (
              <div key={p} className="flex items-center gap-1.5 text-[10px] text-gray-700">
                <div className="w-5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PRIORITY_CFG[p].mapColor }} />
                {PRIORITY_CFG[p].label}
              </div>
            ))}
            {userPos && (
              <div className="flex items-center gap-1.5 text-[10px] text-gray-700 border-t border-gray-100 pt-1 mt-1">
                <div className="w-3 h-3 rounded-full bg-blue-500 shrink-0" />
                Siz
              </div>
            )}
          </div>

          {/* Leaflet map container */}
          <div ref={mapContainerRef} className="flex-1" style={{ minHeight: 0 }} />

          {/* Nearest uncovered ko'cha alert */}
          {nearest && (
            <div className="absolute bottom-3 left-3 right-3 z-[1000] bg-white rounded-xl shadow-lg border border-red-200 px-3 py-2.5 flex items-center gap-2">
              <Navigation2 className="w-4 h-4 text-red-500 shrink-0" />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] font-bold text-red-700">Eng yaqin qoplanmagan ko'cha</p>
                <p className="text-xs text-gray-700 truncate">{nearest.name || 'Nomsiz ko\'cha'}</p>
              </div>
              <span className="text-xs font-bold text-red-600 shrink-0">
                {nearest.dist < 1000 ? `${nearest.dist}m` : `${(nearest.dist / 1000).toFixed(1)}km`}
              </span>
            </div>
          )}

          {!userPos && (
            <div className="absolute bottom-3 left-3 right-3 z-[1000] bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 text-[11px] text-amber-700 text-center">
              📡 GPS aniqlanmoqda... Joylashuvni yoqing
            </div>
          )}
        </div>
      )}
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
