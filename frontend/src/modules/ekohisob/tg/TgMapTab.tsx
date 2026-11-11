import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { MapContainer, TileLayer, CircleMarker, useMap, useMapEvents } from 'react-leaflet'
import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { LocateFixed, Loader2, WifiOff, AlertCircle } from 'lucide-react'
import { tgApi, tgErrorMessage } from './tgApi'
import { InputWithIcon, currentTheme } from '../ui'
import { Search } from 'lucide-react'
import { tokenColor } from './tgTelegram'
import { GeoError, geoErrorText, requestFix } from './tgUtil'

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

/** Marker holati. Talon rejimida "shu oy to'lov" emas, qarz bor-yo'qligi hal qiladi. */
function kindOf(e: MapEntity): Filter {
  if (e.status === 'draft') return 'draft'
  if (e.billingMode === 'talon') return e.debtMonths > 0 ? 'debt' : 'paid'
  if (e.debtMonths > 0) return 'debt'
  return e.paidThisMonth ? 'paid' : 'debt'
}

const TASHKENT: [number, number] = [41.311081, 69.240562]
const VIEW_KEY = 'eko-tg:mapview'

function savedView(): { c: [number, number]; z: number } | null {
  try {
    const raw = sessionStorage.getItem(VIEW_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null // kesh ixtiyoriy
  }
}

/** Boshlang'ich markaz: tashkilotlar markaziga (centroid) eng yaqin tashkilot. */
function pickCenter(rows: MapEntity[]): [number, number] {
  if (rows.length === 0) return TASHKENT
  const lat = rows.reduce((s, r) => s + r.lat, 0) / rows.length
  const lon = rows.reduce((s, r) => s + r.lon, 0) / rows.length
  let best = rows[0]
  let bd = Infinity
  for (const r of rows) {
    const d = (r.lat - lat) ** 2 + (r.lon - lon) ** 2
    if (d < bd) { bd = d; best = r }
  }
  return [best.lat, best.lon]
}

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
  const [start, setStart] = useState<{ c: [number, number]; z: number } | null>(() => savedView())
  const reqId = useRef(0)
  const lastFetch = useRef({ key: '', t: 0 })
  const debounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const firstRefresh = useRef(true)

  // Boshlang'ich yuklash: markaz xarita natijasidan olinadi (alohida limit=1 so'rovi yo'q)
  const init = useCallback(async () => {
    setOffline('')
    try {
      const res = await tgApi.get('/dashboard/map', { params: { limit: 300 } })
      const rows: MapEntity[] = res.data.data ?? []
      setEntities(rows)
      setMeta({ total: res.data.meta?.total ?? rows.length, truncated: Boolean(res.data.meta?.truncated) })
      setStart({ c: pickCenter(rows), z: 15 })
    } catch (e) {
      setOffline(tgErrorMessage(e, "Xaritani yuklab bo'lmadi"))
      setStart({ c: TASHKENT, z: 13 })
    }
  }, [])
  useEffect(() => { if (!start) init() }, [start, init])

  // Xarita oynasi bo'yicha yuklash (faqat ko'rinadigan qism). Bir xil oyna 1.5s ichida qayta so'ralmaydi.
  const fetchView = useCallback(async (force = false) => {
    const map = mapRef.current
    if (!map) return
    const b = map.getBounds()
    const key = [b.getSouth(), b.getNorth(), b.getWest(), b.getEast()].map(v => v.toFixed(4)).join(',')
    const now = Date.now()
    if (!force && key === lastFetch.current.key && now - lastFetch.current.t < 1500) return
    lastFetch.current = { key, t: now }
    const id = ++reqId.current
    setLoading(true)
    try {
      const res = await tgApi.get('/dashboard/map', {
        params: { minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast(), limit: 2000 },
      })
      if (id !== reqId.current) return // eskirgan javob
      setEntities(res.data.data ?? [])
      setMeta({ total: res.data.meta?.total ?? 0, truncated: Boolean(res.data.meta?.truncated) })
      setOffline('')
      try {
        const c = map.getCenter()
        sessionStorage.setItem(VIEW_KEY, JSON.stringify({ c: [c.lat, c.lng], z: map.getZoom() }))
      } catch {
        // ixtiyoriy kesh
      }
    } catch (e) {
      lastFetch.current = { key: '', t: 0 }
      if (id === reqId.current) setOffline(tgErrorMessage(e, "Xaritani yuklab bo'lmadi"))
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  const scheduleFetch = useCallback(() => {
    if (debounce.current) clearTimeout(debounce.current)
    debounce.current = setTimeout(() => fetchView(), 350)
  }, [fetchView])

  // Ilova qaytib ochilganda yangi ma'lumot (faqat xarita ko'rinib turganda)
  useEffect(() => {
    if (!active) return
    const onVis = () => { if (document.visibilityState === 'visible') fetchView(true) }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [active, fetchView])

  // Tab qayta ochilganda: o'lcham tuzatiladi (yashirin konteynerda Leaflet o'lchamni yo'qotadi)
  useEffect(() => {
    if (!active) return
    mapRef.current?.invalidateSize()
    fetchView()
  }, [active, fetchView])

  // To'lov/tashrifdan keyin (refreshKey) — birinchi mount'da emas
  useEffect(() => {
    if (firstRefresh.current) { firstRefresh.current = false; return }
    if (active) fetchView(true)
  }, [refreshKey]) // eslint-disable-line react-hooks/exhaustive-deps

  async function locateMe() {
    setLocating(true); setLocError('')
    try {
      const fix = await requestFix({ timeout: 15000 })
      const p: [number, number] = [fix.lat, fix.lon]
      setMe(p)
      mapRef.current?.flyTo(p, 17)
    } catch (e) {
      setLocError(e instanceof GeoError ? geoErrorText(e) : "Joylashuvni aniqlab bo'lmadi")
    } finally { setLocating(false) }
  }

  function flyTo(e: { lat?: number | null; lon?: number | null }) {
    if (e.lat != null && e.lon != null) mapRef.current?.flyTo([e.lat, e.lon], 18)
  }

  const visible = entities.filter(e => filter === 'all' || kindOf(e) === filter)
  const counts = entities.reduce(
    (acc, e) => { acc[kindOf(e)] = (acc[kindOf(e)] ?? 0) + 1; return acc },
    {} as Record<string, number>,
  )

  // Marker ranglari -- ilova tokenlari (--eko-level-*), mavzu o'zgarsa qayta o'qiladi
  const theme = currentTheme()
  const colors = useMemo(() => ({
    debt: tokenColor('--eko-level-3'),
    paid: tokenColor('--eko-level-0'),
    draft: tokenColor('--eko-level-1'),
    stroke: tokenColor('--eko-surface'),
    me: tokenColor('--eko-info'),
  }), [theme])

  if (!start) {
    return <div className="h-full flex items-center justify-center text-eko-muted bg-eko-canvas"><Loader2 className="w-6 h-6 animate-spin" aria-label="Yuklanmoqda" /></div>
  }

  // Bitta holat chizig'i (ustuvorlik: xato > kesilgan > GPS)
  const status = offline
    ? { icon: <WifiOff className="w-4 h-4" />, text: offline, retry: () => (entities.length ? fetchView(true) : init()) }
    : locError ? { icon: <AlertCircle className="w-4 h-4" />, text: locError, retry: undefined }
    : meta?.truncated ? { icon: <AlertCircle className="w-4 h-4" />, text: `${meta.total} tadan bir qismi — yaqinlashtiring`, retry: undefined }
    : null

  return (
    <div className="relative h-full w-full">
      {/* isolate: Leaflet panellari (z 400+) ustki panellar ustiga chiqmasin */}
      <div className="absolute inset-0 isolate">
        <MapContainer center={start.c} zoom={start.z} className="h-full w-full" preferCanvas zoomControl={false}>
          <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" maxZoom={19} attribution="" />
          <MapHandle onMap={m => { const first = !mapRef.current; mapRef.current = m; if (first) fetchView(true) }} />
          <BoundsWatcher onChange={scheduleFetch} />

          {visible.map(e => (
            <CircleMarker
              key={e.id}
              center={[e.lat, e.lon]}
              radius={11}
              pathOptions={{ color: colors.stroke, weight: 2, fillColor: colors[kindOf(e) as 'debt' | 'paid' | 'draft'], fillOpacity: 0.95 }}
              eventHandlers={{ click: () => onOpen(e.id) }}
            />
          ))}
          {me && (
            <>
              <CircleMarker center={me} radius={16} pathOptions={{ color: colors.me, weight: 1, fillColor: colors.me, fillOpacity: 0.15 }} />
              <CircleMarker center={me} radius={7} pathOptions={{ color: colors.stroke, weight: 2, fillColor: colors.me, fillOpacity: 1 }} />
            </>
          )}
        </MapContainer>
      </div>

      {/* Tepa panel: qidiruv + bitta holat chizig'i (ekranning ~15%i) */}
      <div className="absolute top-2 left-2 right-2 eko-z-sticky space-y-2">
        <SearchBox onPick={e => { flyTo(e); onOpen(e.id) }} />
        {status && (
          <div role="status" className="flex items-center gap-2 bg-eko-surface border border-eko-line-strong rounded-eko px-3 min-h-[40px] eko-text-sm text-eko-text">
            <span className="shrink-0 text-eko-warn" aria-hidden>{status.icon}</span>
            <span className="flex-1 min-w-0 truncate">{status.text}</span>
            {status.retry && <button className="shrink-0 h-10 px-2 font-medium underline" onClick={status.retry}>Qayta</button>}
          </div>
        )}
      </div>

      {/* Pastki panel: filtr chiplari (bosh barmoq yetadigan joyda) + joylashuv */}
      <div className="absolute left-0 right-0 bottom-3 eko-z-sticky flex items-end gap-2 px-2">
        <div className="flex-1 min-w-0 flex gap-2 overflow-x-auto pb-0.5" role="radiogroup" aria-label="Filtr">
          {FILTERS.map(fl => {
            const on = filter === fl.key
            return (
              <button
                key={fl.key} role="radio" aria-checked={on}
                onClick={() => setFilter(fl.key)}
                className={`shrink-0 px-4 h-11 rounded-full text-sm font-medium border transition-colors ${
                  on ? 'bg-eko-text text-eko-surface border-eko-text' : 'bg-eko-surface text-eko-text border-eko-line-strong'
                }`}
              >
                {fl.label}{fl.key !== 'all' && counts[fl.key] ? ` · ${counts[fl.key]}` : ''}
              </button>
            )
          })}
        </div>
        <div className="shrink-0 flex flex-col items-center gap-2">
          {loading && <Loader2 className="w-5 h-5 animate-spin text-eko-text" aria-label="Yuklanmoqda" />}
          <button
            onClick={locateMe}
            aria-label="Mening joylashuvim"
            className="w-12 h-12 rounded-full bg-eko-surface shadow-eko-lg border border-eko-line-strong flex items-center justify-center text-eko-text active:scale-95"
          >
            {locating ? <Loader2 className="w-5 h-5 animate-spin" /> : <LocateFixed className="w-6 h-6" />}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Tashkilot qidiruvi (nom / STIR / kod) — natija bosilsa xaritada o'sha joyga uchadi. */
function SearchBox({ onPick }: { onPick: (e: { id: string; lat?: number | null; lon?: number | null }) => void }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Array<{ id: string; name: string; address?: string; lat?: number; lon?: number; status: string }>>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  useEffect(() => {
    const term = q.trim()
    if (term.length < 2) { setResults([]); setErr(''); return }
    let off = false
    const t = setTimeout(async () => {
      setBusy(true)
      try {
        const res = await tgApi.get('/entities', { params: { search: term, limit: 6 } })
        if (!off) { setResults(res.data.data ?? []); setErr('') }
      } catch (e) {
        if (!off) { setResults([]); setErr(tgErrorMessage(e, 'Qidiruv ishlamadi')) }
      } finally { if (!off) setBusy(false) }
    }, 300)
    return () => { off = true; clearTimeout(t) }
  }, [q])

  return (
    <div className="relative">
      <div className="relative">
        <InputWithIcon
          icon={<Search className="w-4 h-4" />} value={q} onChange={e => setQ(e.target.value)}
          placeholder="Tashkilot nomi, STIR yoki kod" aria-label="Qidiruv" className="!h-12 shadow-eko"
        />
        {busy && <Loader2 className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 animate-spin text-eko-muted" aria-hidden />}
      </div>
      {err && <p className="mt-1 bg-eko-surface border border-eko-line-strong rounded-eko px-3 py-2 eko-text-sm text-eko-danger">{err}</p>}
      {results.length > 0 && (
        <ul className="absolute left-0 right-0 mt-1 bg-eko-surface rounded-eko-lg shadow-eko-lg border border-eko-line-strong overflow-hidden max-h-72 overflow-y-auto">
          {results.map(r => (
            <li key={r.id}>
              <button
                className="w-full text-left px-4 py-3 min-h-[56px] border-b border-eko-line last:border-0 active:bg-eko-surface-2"
                onClick={() => { setQ(''); setResults([]); onPick(r) }}
              >
                <p className="eko-text-md font-medium text-eko-text truncate">{r.name}</p>
                <p className="eko-text-sm text-eko-muted truncate">{r.address || '—'}{r.lat == null ? ' · joylashuvsiz' : ''}</p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
