import { useCallback, useEffect, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { Search, LocateFixed, Loader2, WifiOff } from 'lucide-react'
import { tgApi, tgErrorMessage } from './tgApi'
import { Banner } from '../ui'

export interface MapEntity {
  id: string
  name: string
  address?: string | null
  lat: number
  lon: number
  status: string
  billingMode: string
  paidThisMonth: boolean
  debtMonths: number
  debtAmount: number
}

type Filter = 'all' | 'debt' | 'paid' | 'draft'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'Hammasi' },
  { key: 'debt', label: 'Qarzdor' },
  { key: 'paid', label: "To'lagan" },
  { key: 'draft', label: 'Chala' },
]

const COLOR = { debt: '#dc2626', paid: '#16a34a', draft: '#f59e0b' }

/** Marker holati. Talon rejimida "shu oy to'lov" emas, qarz bor-yo'qligi hal qiladi. */
function kindOf(e: MapEntity): Filter {
  if (e.status === 'draft') return 'draft'
  if (e.billingMode === 'talon') return e.debtMonths > 0 ? 'debt' : 'paid'
  if (e.debtMonths > 0) return 'debt'
  return e.paidThisMonth ? 'paid' : 'debt'
}

const TASHKENT: [number, number] = [41.311081, 69.240562]

function MapHandle({ onMap }: { onMap: (m: LeafletMap) => void }) {
  const map = useMap()
  useEffect(() => { onMap(map) }, [map, onMap])
  return null
}

function BoundsWatcher({ onChange }: { onChange: () => void }) {
  useMapEvents({ moveend: onChange, zoomend: onChange })
  return null
}

export default function TgMapTab({
  onOpen, active, refreshKey,
}: { onOpen: (id: string) => void; active: boolean; refreshKey: number }) {
  const mapRef = useRef<LeafletMap | null>(null)
  const [entities, setEntities] = useState<MapEntity[]>([])
  const [meta, setMeta] = useState<{ total: number; truncated: boolean } | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [loading, setLoading] = useState(false)
  const [offline, setOffline] = useState('')
  const [me, setMe] = useState<[number, number] | null>(null)
  const [locating, setLocating] = useState(false)
  const [locError, setLocError] = useState('')
  const [center, setCenter] = useState<[number, number] | null>(null)
  const reqId = useRef(0)
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Xarita oynasi bo'yicha yuklash (butun shahar emas, faqat ko'rinadigan qism)
  const fetchView = useCallback(async () => {
    const map = mapRef.current
    if (!map) return
    const b = map.getBounds()
    const id = ++reqId.current
    setLoading(true)
    try {
      const res = await tgApi.get('/dashboard/map', {
        params: {
          minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast(), limit: 2000,
        },
      })
      if (id !== reqId.current) return // eskirgan javob
      setEntities(res.data.data ?? [])
      setMeta({ total: res.data.meta?.total ?? 0, truncated: Boolean(res.data.meta?.truncated) })
      setOffline('')
    } catch (e) {
      if (id === reqId.current) setOffline(tgErrorMessage(e, "Xaritani yuklab bo'lmadi"))
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  const scheduleFetch = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(fetchView, 350)
  }, [fetchView])

  // Ilova qaytib ochilganda (boshqa ilovadan, ekran yoqilganda) yangi ma'lumot
  useEffect(() => {
    const onVis = () => { if (document.visibilityState === 'visible') fetchView() }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [fetchView])

  // To'lov yozilgach (refreshKey) yoki tab qayta ochilganda: o'lcham + yangi ma'lumot.
  // Yashirin (display:none) konteynerda Leaflet o'lchamni yo'qotadi.
  useEffect(() => {
    if (!active) return
    mapRef.current?.invalidateSize()
    fetchView()
  }, [active, refreshKey, fetchView])

  // Boshlang'ich markaz: birinchi tashkilot joylashuvi (yoki Toshkent)
  useEffect(() => {
    tgApi.get('/dashboard/map', { params: { limit: 1 } })
      .then(r => {
        const first = r.data.data?.[0]
        setCenter(first ? [first.lat, first.lon] : TASHKENT)
      })
      .catch(() => setCenter(TASHKENT))
  }, [])

  function locateMe() {
    if (!navigator.geolocation) { setLocError("Qurilmada GPS yo'q"); return }
    setLocating(true); setLocError('')
    navigator.geolocation.getCurrentPosition(
      pos => {
        const p: [number, number] = [pos.coords.latitude, pos.coords.longitude]
        setMe(p)
        mapRef.current?.flyTo(p, 17)
        setLocating(false)
      },
      () => { setLocError('GPS ruxsati berilmadi'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  function flyTo(e: { lat?: number | null; lon?: number | null }) {
    if (e.lat != null && e.lon != null) mapRef.current?.flyTo([e.lat, e.lon], 18)
  }

  const visible = entities.filter(e => filter === 'all' || kindOf(e) === filter)
  const counts = entities.reduce(
    (acc, e) => { acc[kindOf(e)] = (acc[kindOf(e)] ?? 0) + 1; return acc },
    {} as Record<string, number>,
  )

  if (!center) {
    return <div className="h-full flex items-center justify-center text-eko-muted"><Loader2 className="w-6 h-6 animate-spin" /></div>
  }

  return (
    <div className="relative h-full w-full">
      <MapContainer center={center} zoom={15} className="h-full w-full" preferCanvas zoomControl={false}>
        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="" />
        <MapHandle onMap={m => { const first = !mapRef.current; mapRef.current = m; if (first) fetchView() }} />
        <BoundsWatcher onChange={scheduleFetch} />

        {visible.map(e => (
          <CircleMarker
            key={e.id}
            center={[e.lat, e.lon]}
            radius={10}
            pathOptions={{ color: '#fff', weight: 2, fillColor: COLOR[kindOf(e) as 'debt' | 'paid' | 'draft'], fillOpacity: 0.95 }}
            eventHandlers={{ click: () => onOpen(e.id) }}
          />
        ))}
        {me && (
          <>
            <CircleMarker center={me} radius={16} pathOptions={{ color: '#2563eb', weight: 1, fillColor: '#2563eb', fillOpacity: 0.15 }} />
            <CircleMarker center={me} radius={7} pathOptions={{ color: '#fff', weight: 2, fillColor: '#2563eb', fillOpacity: 1 }} />
          </>
        )}
      </MapContainer>

      {/* Yuqori panel: qidiruv + filtr */}
      <div className="absolute top-2 left-2 right-2 z-[500] space-y-2">
        <SearchBox onPick={e => { flyTo(e); onOpen(e.id) }} />
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 px-3 h-8 rounded-full text-xs font-medium shadow border transition-colors ${
                filter === f.key ? 'bg-eko-accent text-white border-eko-accent' : 'bg-white text-gray-700 border-gray-200'
              }`}
            >
              {f.label}
              {f.key !== 'all' && counts[f.key] ? ` · ${counts[f.key]}` : ''}
            </button>
          ))}
        </div>
        {offline && (
          <Banner tone="danger" action={<button className="text-xs underline" onClick={fetchView}>Qayta</button>}>
            <span className="flex items-center gap-1.5"><WifiOff className="w-3.5 h-3.5" />{offline}</span>
          </Banner>
        )}
        {meta?.truncated && (
          <Banner tone="info">{meta.total} tadan faqat bir qismi ko'rinmoqda — xaritani yaqinlashtiring.</Banner>
        )}
        {locError && <Banner tone="warn">{locError}</Banner>}
      </div>

      {/* Pastki o'ng: joylashuv */}
      <div className="absolute right-3 bottom-4 z-[500] flex flex-col items-center gap-2">
        {loading && <Loader2 className="w-5 h-5 animate-spin text-eko-accent" />}
        <button
          onClick={locateMe}
          aria-label="Mening joylashuvim"
          className="w-12 h-12 rounded-full bg-white shadow-lg border border-gray-200 flex items-center justify-center text-blue-600 active:scale-95"
        >
          {locating ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-6 h-6" />}
        </button>
      </div>
    </div>
  )
}

/** Tashkilot qidiruvi (nom / STIR / kod) — natija bosilsa xaritada o'sha joyga uchadi. */
function SearchBox({ onPick }: { onPick: (e: { id: string; lat?: number | null; lon?: number | null }) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; address?: string; lat?: number; lon?: number; status: string }>>([])
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); return }
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const res = await tgApi.get('/entities', { params: { search: term, limit: 6 } })
        setResults(res.data.data ?? [])
      } catch { setResults([]) }
      finally { setBusy(false) }
    }, 300)
    return () => clearTimeout(t)
  }, [q])

  return (
    <div className="relative">
      <div className="flex items-center gap-2 bg-white rounded-xl shadow border border-gray-200 px-3 h-11">
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Tashkilot nomi, STIR yoki kod"
          className="flex-1 min-w-0 bg-transparent outline-none text-sm"
        />
        {busy && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
      </div>
      {results.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden max-h-64 overflow-y-auto">
          {results.map(r => (
            <li key={r.id}>
              <button
                className="w-full text-left px-3 py-2.5 border-b border-gray-100 last:border-0 active:bg-gray-50"
                onClick={() => { setQ(''); setResults([]); onPick(r) }}
              >
                <p className="text-sm font-medium text-gray-900 truncate">{r.name}</p>
                <p className="text-xs text-gray-500 truncate">{r.address || '—'}{r.lat == null ? ' · joylashuvsiz' : ''}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
