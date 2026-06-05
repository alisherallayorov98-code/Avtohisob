import { useEffect, useRef, useState, useMemo } from 'react'
import { MapPin, CheckCircle2, AlertCircle, Loader2, Navigation, Search, Layers, X, Crosshair, Route, Download, Flame, Tag } from 'lucide-react'
import toast from 'react-hot-toast'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import ekoApi from '../lib/ekoApi'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import { useAuthStore } from '../../../stores/authStore'
import PaymentModal, { EntityBasic } from '../components/PaymentModal'

// Leaflet default marker icon fix
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

interface MapEntity {
  id: string; name: string; address: string
  status: 'active' | 'blacklisted' | 'inactive'
  paid: boolean; lat?: number; lng?: number; districtId?: string
  debtMonths?: number; monthlyFee?: number
}
interface District { id: string; name: string }

type MapFilter = 'all' | 'unpaid'

function ensurePulseStyle() {
  if (document.getElementById('eko-marker-style')) return
  const style = document.createElement('style')
  style.id = 'eko-marker-style'
  style.textContent = `
    @keyframes eko-pulse {
      0%   { box-shadow: 0 0 0 0 rgba(220,38,38,0.55); }
      70%  { box-shadow: 0 0 0 12px rgba(220,38,38,0); }
      100% { box-shadow: 0 0 0 0 rgba(220,38,38,0); }
    }
    .eko-pin { position: relative; }
    .eko-pin .eko-dot { width:16px; height:16px; border-radius:50%; border:2px solid #fff; box-shadow:0 1px 5px rgba(0,0,0,0.4); }
    .eko-pin.pulse .eko-dot { animation: eko-pulse 1.6s infinite; }
    .eko-pin .eko-badge {
      position:absolute; top:-8px; right:-8px; min-width:15px; height:15px; padding:0 3px;
      background:#7f1d1d; color:#fff; font-size:9px; font-weight:700; line-height:15px;
      text-align:center; border-radius:8px; border:1.5px solid #fff;
    }
    .leaflet-tooltip.eko-label {
      background:rgba(255,255,255,0.92); border:none; box-shadow:0 1px 3px rgba(0,0,0,0.25);
      font-size:10px; font-weight:600; padding:1px 5px; color:#1f2937;
    }
    .leaflet-tooltip.eko-label::before { display:none; }
  `
  document.head.appendChild(style)
}

function makeIcon(status: string, debtMonths = 0) {
  const color = status === 'blacklisted' ? '#111827'
    : status === 'inactive' ? '#9ca3af'
    : status === 'paid' ? '#16a34a'
    : '#dc2626'
  const pulse = status === 'unpaid' ? 'pulse' : ''
  const badge = status === 'unpaid' && debtMonths > 1
    ? `<span class="eko-badge">${debtMonths}</span>` : ''
  return L.divIcon({
    className: '',
    html: `<div class="eko-pin ${pulse}">
      <div class="eko-dot" style="background:${color}"></div>
      ${badge}
    </div>`,
    iconSize: [16, 16], iconAnchor: [8, 8],
  })
}

// Haversine masofa (metr)
function distM(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) ** 2
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)))
}

function fmtDist(m: number): string {
  return m < 1000 ? `${m} m` : `${(m / 1000).toFixed(1)} km`
}

const TASHKENT: [number, number] = [41.2995, 69.2401]

function getSavedView(): { center: [number, number]; zoom: number } {
  try {
    const saved = localStorage.getItem('eko_map_view')
    if (saved) return JSON.parse(saved)
  } catch {}
  return { center: TASHKENT, zoom: 12 }
}

export default function MapPage() {
  const mapRef      = useRef<L.Map | null>(null)
  const mapDivRef   = useRef<HTMLDivElement>(null)
  const clusterRef  = useRef<any>(null)               // markerClusterGroup
  const markerById  = useRef<Map<string, L.Marker>>(new Map())
  const fittedRef   = useRef(false)
  const tileRef     = useRef<L.TileLayer | null>(null)
  const userMarkerRef = useRef<L.Marker | null>(null)
  const heatLayerRef  = useRef<L.LayerGroup | null>(null)

  const [entities, setEntities]   = useState<MapEntity[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [loading, setLoading]     = useState(false)
  const [selected, setSelected]   = useState<MapEntity | null>(null)
  const [mapFilter, setMapFilter] = useState<MapFilter>('all')
  const [search, setSearch]       = useState('')
  const [satellite, setSatellite] = useState(false)
  const [payEntity, setPayEntity] = useState<EntityBasic | null>(null)
  const [userLoc, setUserLoc]     = useState<{ lat: number; lng: number } | null>(null)
  const [locating, setLocating]   = useState(false)
  const [showNearby, setShowNearby] = useState(false)
  const [showHeatmap, setShowHeatmap] = useState(false)
  const [showLabels, setShowLabels]   = useState(false)

  const ekoUser  = useEkoAuthStore(s => s.user)
  const mainUser = useAuthStore(s => s.user)
  const isInspector = ekoUser?.role === 'inspector' || mainUser?.role === 'ekohisob_user'
  const userDistrictIds: string[] = ekoUser?.districtIds ?? []

  // ─── Xarita boshlash ──────────────────────────────────────────────────────
  useEffect(() => {
    if (mapRef.current || !mapDivRef.current) return
    ensurePulseStyle()
    const { center, zoom } = getSavedView()
    const map = L.map(mapDivRef.current, { center, zoom, zoomControl: true })

    tileRef.current = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)

    // Klaster guruhi
    clusterRef.current = (L as any).markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
    })
    map.addLayer(clusterRef.current)

    // Heatmap (qarz zonalari) qatlami — alohida
    heatLayerRef.current = L.layerGroup()

    const saveView = () => {
      const c = map.getCenter()
      localStorage.setItem('eko_map_view', JSON.stringify({
        center: [c.lat, c.lng], zoom: map.getZoom(),
      }))
    }
    map.on('moveend', saveView)
    map.on('zoomend', saveView)

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; clusterRef.current = null }
  }, [])

  // ─── Tile almashtirish (oddiy / sun'iy yo'ldosh) ──────────────────────────
  useEffect(() => {
    const map = mapRef.current
    if (!map || !tileRef.current) return
    map.removeLayer(tileRef.current)
    tileRef.current = satellite
      ? L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
          attribution: '© Esri', maxZoom: 19,
        })
      : L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '© OpenStreetMap', maxZoom: 19,
        })
    tileRef.current.addTo(map)
  }, [satellite])

  // ─── Tumanlar ─────────────────────────────────────────────────────────────
  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    if (isInspector && userDistrictIds.length === 1 && !selectedDistrict) {
      setSelectedDistrict(userDistrictIds[0])
    }
  }, [isInspector, userDistrictIds.length])

  // ─── Tashkilotlarni yuklash ───────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    fittedRef.current = false
    const params = new URLSearchParams()
    if (selectedDistrict) params.set('districtId', selectedDistrict)
    ekoApi.get(`/dashboard/map?${params}`)
      .then(res => {
        const data = res.data.data ?? res.data
        const list: MapEntity[] = (Array.isArray(data) ? data : []).map((e: any) => ({
          id: e.id, name: e.name, address: e.address ?? '',
          status: e.status, paid: Boolean(e.paidThisMonth),
          lat: e.lat ?? undefined, lng: e.lon ?? undefined,
          districtId: e.districtId,
          debtMonths: e.debtMonths ?? e.unpaidMonths?.length ?? 0,
          monthlyFee: e.monthlyFee ?? 0,
        }))
        setEntities(list)
      })
      .catch(() => setEntities([]))
      .finally(() => setLoading(false))
  }, [selectedDistrict])

  // Filtrlangan tashkilotlar (tezkor filtr)
  const visibleEntities = useMemo(() => {
    if (mapFilter === 'unpaid') return entities.filter(e => !e.paid && e.status === 'active')
    return entities
  }, [entities, mapFilter])

  // ─── Markerlar (klaster) ──────────────────────────────────────────────────
  useEffect(() => {
    const cluster = clusterRef.current
    const map = mapRef.current
    if (!cluster || !map) return

    cluster.clearLayers()
    markerById.current.clear()

    const withCoords = visibleEntities.filter(e => e.lat && e.lng)
    withCoords.forEach(entity => {
      const markerStatus = entity.status === 'blacklisted' ? 'blacklisted'
        : entity.status === 'inactive' ? 'inactive'
        : entity.paid ? 'paid' : 'unpaid'

      const marker = L.marker([entity.lat!, entity.lng!], {
        icon: makeIcon(markerStatus, entity.debtMonths ?? 0),
        zIndexOffset: markerStatus === 'unpaid' ? 1000 : 0,
      }).on('click', () => setSelected(entity))
      marker.bindTooltip(entity.name, { direction: 'top', offset: [0, -10] })
      cluster.addLayer(marker)
      markerById.current.set(entity.id, marker)
    })

    if (withCoords.length > 0 && !fittedRef.current) {
      const bounds = L.latLngBounds(withCoords.map(e => [e.lat!, e.lng!] as [number, number]))
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
      fittedRef.current = true
    }
  }, [visibleEntities])

  // ─── Geolokatsiya: "Men shu yerdaman" ────────────────────────────────────
  function locateMe() {
    if (!navigator.geolocation) { toast.error('Brauzer geolokatsiyani qo\'llab-quvvatlamaydi'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      pos => {
        const lat = pos.coords.latitude, lng = pos.coords.longitude
        setUserLoc({ lat, lng })
        setShowNearby(true)
        const map = mapRef.current
        if (map) {
          map.flyTo([lat, lng], 15, { duration: 0.8 })
          // GPS marker
          if (userMarkerRef.current) userMarkerRef.current.remove()
          const icon = L.divIcon({
            className: '',
            html: `<div style="width:18px;height:18px;border-radius:50%;background:#2563eb;border:3px solid #fff;box-shadow:0 0 0 4px rgba(37,99,235,0.3),0 2px 6px rgba(0,0,0,0.4)"></div>`,
            iconSize: [18, 18], iconAnchor: [9, 9],
          })
          userMarkerRef.current = L.marker([lat, lng], { icon, zIndexOffset: 2000 }).addTo(map)
          userMarkerRef.current.bindTooltip('Siz shu yerdasiz', { direction: 'top', offset: [0, -10] })
        }
        setLocating(false)
      },
      () => { toast.error('Joylashuvni aniqlab bo\'lmadi. GPS ruxsatini bering.'); setLocating(false) },
      { enableHighAccuracy: true, timeout: 10000 }
    )
  }

  // Eng yaqin qarzdorlar (joylashuvdan masofa bo'yicha)
  const nearbyDebtors = useMemo(() => {
    if (!userLoc) return []
    return entities
      .filter(e => e.lat && e.lng && !e.paid && e.status === 'active')
      .map(e => ({ ...e, dist: distM(userLoc.lat, userLoc.lng, e.lat!, e.lng!) }))
      .sort((a, b) => a.dist - b.dist)
      .slice(0, 10)
  }, [userLoc, entities])

  // ─── Heatmap: mahalla/hudud qarz zonalari ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current
    const heat = heatLayerRef.current
    if (!map || !heat) return

    heat.clearLayers()
    if (!showHeatmap) { map.removeLayer(heat); return }

    // To'lamagan tashkilotlarni grid hujayralarga guruhlash (~500m)
    const unpaid = entities.filter(e => e.lat && e.lng && !e.paid && e.status === 'active')
    const cells = new Map<string, { lat: number; lng: number; count: number; debt: number }>()
    for (const e of unpaid) {
      const key = `${(e.lat! * 100).toFixed(0)}:${(e.lng! * 100).toFixed(0)}`  // ~1km grid
      if (!cells.has(key)) cells.set(key, { lat: e.lat!, lng: e.lng!, count: 0, debt: 0 })
      const c = cells.get(key)!
      c.count++
      c.debt += (e.debtMonths || 1) * (e.monthlyFee || 0)
    }

    for (const c of cells.values()) {
      // Zichlikka qarab rang va o'lcham
      const intensity = Math.min(c.count, 8)
      const color = intensity >= 5 ? '#dc2626' : intensity >= 3 ? '#f97316' : '#fbbf24'
      const radius = 200 + intensity * 80
      L.circle([c.lat, c.lng], {
        radius, color, fillColor: color, fillOpacity: 0.18, weight: 1, opacity: 0.4,
      }).bindTooltip(`${c.count} ta qarzdor · ${c.debt.toLocaleString('uz-UZ')} so'm`, { sticky: true })
        .addTo(heat)
    }
    map.addLayer(heat)
  }, [showHeatmap, entities])

  // ─── Doimiy nom yorliqlari (zoom yoki tugma) ──────────────────────────────
  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster) return
    markerById.current.forEach((marker, id) => {
      const ent = entities.find(e => e.id === id)
      if (!ent) return
      const tt = marker.getTooltip()
      if (showLabels) {
        marker.unbindTooltip()
        marker.bindTooltip(ent.name, { permanent: true, direction: 'top', offset: [0, -10], className: 'eko-label' })
      } else if (tt && tt.options.permanent) {
        marker.unbindTooltip()
        marker.bindTooltip(ent.name, { direction: 'top', offset: [0, -10] })
      }
    })
  }, [showLabels, visibleEntities])

  // ─── Qarzdorlar ro'yxatini eksport ────────────────────────────────────────
  function exportDebtors() {
    const debtors = entities.filter(e => !e.paid && e.status === 'active')
    if (debtors.length === 0) { toast.error('Qarzdorlar yo\'q'); return }
    const header = ['Tashkilot', 'Manzil', 'Qarz oylari', 'Oylik to\'lov', 'Jami qarz', 'Koordinata']
    const rows = debtors.map(e => [
      e.name, e.address, e.debtMonths || 1, e.monthlyFee || 0,
      (e.debtMonths || 1) * (e.monthlyFee || 0),
      e.lat && e.lng ? `${e.lat},${e.lng}` : '',
    ])
    const csv = [header, ...rows].map(r => r.join('\t')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/tab-separated-values;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `qarzdorlar-${new Date().toISOString().split('T')[0]}.xls`; a.click()
    URL.revokeObjectURL(url)
    toast.success(`${debtors.length} ta qarzdor eksport qilindi`)
  }

  // ─── Qidiruv natijalari ───────────────────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!search.trim()) return []
    const q = search.toLowerCase()
    return entities
      .filter(e => e.lat && e.lng && (e.name.toLowerCase().includes(q) || e.address.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [search, entities])

  function flyToEntity(entity: MapEntity) {
    const map = mapRef.current
    if (!map || !entity.lat || !entity.lng) return
    map.flyTo([entity.lat, entity.lng], 17, { duration: 0.8 })
    setSelected(entity)
    setSearch('')
    // Klaster ichidan markerni ochish
    const marker = markerById.current.get(entity.id)
    if (marker && clusterRef.current) {
      setTimeout(() => clusterRef.current.zoomToShowLayer(marker, () => marker.openTooltip()), 850)
    }
  }

  const myDistrictNames = useMemo(() => {
    if (!isInspector || userDistrictIds.length === 0) return []
    return districts.filter(d => userDistrictIds.includes(d.id)).map(d => d.name)
  }, [districts, userDistrictIds, isInspector])

  // ─── Hudud statistikasi ───────────────────────────────────────────────────
  const stats = useMemo(() => {
    const active = entities.filter(e => e.status === 'active')
    const paid   = active.filter(e => e.paid).length
    const unpaid = active.filter(e => !e.paid)
    const totalDebt = unpaid.reduce((s, e) => s + (e.debtMonths || 1) * (e.monthlyFee || 0), 0)
    const payRate = active.length > 0 ? Math.round(paid * 100 / active.length) : 0
    const topDebtor = [...unpaid].sort((a, b) =>
      ((b.debtMonths || 1) * (b.monthlyFee || 0)) - ((a.debtMonths || 1) * (a.monthlyFee || 0)))[0]
    return { paid, unpaidCount: unpaid.length, totalDebt, payRate, topDebtor, blacklisted: entities.filter(e => e.status === 'blacklisted').length }
  }, [entities])

  const withCoords = entities.filter(e => e.lat && e.lng).length

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="p-4 md:p-5 shrink-0">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-bold text-gray-900">Xarita</h1>
            <p className="text-xs text-gray-500 mt-0.5">
              {withCoords} ta tashkilot xaritada · {entities.length - withCoords} ta koordinatasiz
            </p>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {/* Tezkor filtr */}
            <div className="flex gap-1 bg-gray-100 rounded-lg p-0.5">
              <button onClick={() => setMapFilter('all')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${mapFilter === 'all' ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'}`}>
                Hammasi
              </button>
              <button onClick={() => setMapFilter('unpaid')}
                className={`px-3 py-1 text-xs rounded-md font-medium transition-colors ${mapFilter === 'unpaid' ? 'bg-red-600 text-white shadow-sm' : 'text-gray-500'}`}>
                🔴 To'lamaganlar
              </button>
            </div>

            {/* Tuman filter */}
            {!(isInspector && userDistrictIds.length === 1) && (
              <select
                value={selectedDistrict}
                onChange={e => { setSelectedDistrict(e.target.value); fittedRef.current = false }}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Barcha tumanlar</option>
                {(isInspector && userDistrictIds.length > 0
                  ? districts.filter(d => userDistrictIds.includes(d.id))
                  : districts
                ).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Inspektor tumanlari */}
        {isInspector && myDistrictNames.length > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs text-gray-500">Sizning tumanlaringiz:</span>
            {myDistrictNames.map(name => (
              <span key={name} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">📍 {name}</span>
            ))}
          </div>
        )}
      </div>

      {/* Xarita */}
      <div className="flex-1 relative min-h-[400px]">
        {loading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-white/70">
            <Loader2 className="w-6 h-6 animate-spin text-green-600" />
          </div>
        )}
        <div ref={mapDivRef} className="absolute inset-0" />

        {/* Qidiruv — yuqori chap */}
        <div className="absolute top-3 left-3 z-[1000] w-64">
          <div className="relative">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Tashkilot qidirish..."
              className="w-full pl-8 pr-3 py-2 text-sm bg-white rounded-lg shadow-md border border-gray-200 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
            {search && (
              <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {searchResults.length > 0 && (
            <div className="mt-1 bg-white rounded-lg shadow-lg border border-gray-100 overflow-hidden">
              {searchResults.map(e => (
                <button key={e.id} onClick={() => flyToEntity(e)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-50 transition-colors border-b border-gray-50 last:border-0">
                  <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                    <span className={`w-2 h-2 rounded-full shrink-0 ${e.paid ? 'bg-green-500' : 'bg-red-500'}`} />
                    {e.name}
                  </p>
                  <p className="text-xs text-gray-400 truncate ml-3.5">{e.address}</p>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Boshqaruv tugmalari — yuqori o'ng */}
        <div className="absolute top-3 right-3 z-[1000] flex flex-col gap-2 items-end">
          <button
            onClick={() => setSatellite(v => !v)}
            className="flex items-center gap-1.5 px-3 py-2 bg-white rounded-lg shadow-md border border-gray-200 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Layers className="w-4 h-4" />
            {satellite ? 'Oddiy' : "Sun'iy yo'ldosh"}
          </button>
          <button
            onClick={locateMe}
            disabled={locating}
            className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 text-white rounded-lg shadow-md text-xs font-medium hover:bg-blue-700 disabled:opacity-60"
          >
            {locating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Crosshair className="w-4 h-4" />}
            Men shu yerdaman
          </button>
          <div className="flex gap-1.5">
            <button
              onClick={() => setShowHeatmap(v => !v)}
              title="Qarz zonalari"
              className={`flex items-center gap-1 px-2.5 py-2 rounded-lg shadow-md text-xs font-medium transition-colors ${showHeatmap ? 'bg-orange-600 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'}`}
            >
              <Flame className="w-4 h-4" />
            </button>
            <button
              onClick={() => setShowLabels(v => !v)}
              title="Nomlarni ko'rsatish"
              className={`flex items-center gap-1 px-2.5 py-2 rounded-lg shadow-md text-xs font-medium transition-colors ${showLabels ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 border border-gray-200 hover:bg-gray-50'}`}
            >
              <Tag className="w-4 h-4" />
            </button>
            <button
              onClick={exportDebtors}
              title="Qarzdorlarni eksport"
              className="flex items-center gap-1 px-2.5 py-2 bg-white text-gray-700 border border-gray-200 rounded-lg shadow-md text-xs font-medium hover:bg-gray-50"
            >
              <Download className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Eng yaqin qarzdorlar — pastki chap */}
        {showNearby && userLoc && (
          <div className="absolute bottom-3 left-3 z-[1000] bg-white rounded-xl shadow-lg border border-gray-100 w-72 max-h-[55vh] flex flex-col">
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-800 flex items-center gap-1.5">
                <Route className="w-4 h-4 text-blue-600" /> Eng yaqin qarzdorlar
              </h3>
              <button onClick={() => setShowNearby(false)} className="text-gray-400 hover:text-gray-600">
                <X className="w-4 h-4" />
              </button>
            </div>
            {nearbyDebtors.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">Atrofda qarzdor topilmadi</p>
            ) : (
              <div className="overflow-y-auto divide-y divide-gray-50">
                {nearbyDebtors.map((e, i) => (
                  <div key={e.id} className="px-3 py-2 hover:bg-gray-50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <button onClick={() => flyToEntity(e)} className="text-left flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate flex items-center gap-1.5">
                          <span className="w-4 h-4 rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                          {e.name}
                        </p>
                        <p className="text-xs text-gray-400 truncate ml-5.5">{e.address}</p>
                        <p className="text-xs ml-5.5 mt-0.5">
                          <span className="text-blue-600 font-semibold">{fmtDist(e.dist)}</span>
                          <span className="text-red-600 ml-2 font-medium">{((e.debtMonths || 1) * (e.monthlyFee || 0)).toLocaleString('uz-UZ')} so'm</span>
                        </p>
                      </button>
                      <a
                        href={`https://maps.google.com/?q=${e.lat},${e.lng}`}
                        target="_blank" rel="noopener noreferrer"
                        title="Navigator bilan borish"
                        className="shrink-0 p-1.5 bg-blue-50 text-blue-600 rounded-lg hover:bg-blue-100"
                      >
                        <Navigation className="w-3.5 h-3.5" />
                      </a>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Statistika paneli — pastki o'ng */}
        <div className="absolute bottom-3 right-3 z-[999] bg-white rounded-xl shadow-lg border border-gray-100 p-3 w-52 hidden md:block">
          <p className="text-xs font-semibold text-gray-700 mb-2">📊 {selectedDistrict ? districts.find(d => d.id === selectedDistrict)?.name : 'Umumiy'} hisobot</p>
          <div className="space-y-1.5 text-xs">
            <div className="flex justify-between">
              <span className="text-gray-500">To'lov foizi:</span>
              <span className={`font-bold ${stats.payRate >= 80 ? 'text-green-600' : stats.payRate >= 50 ? 'text-orange-500' : 'text-red-600'}`}>{stats.payRate}%</span>
            </div>
            <div className="w-full bg-gray-100 rounded-full h-1.5">
              <div className={`h-1.5 rounded-full ${stats.payRate >= 80 ? 'bg-green-500' : stats.payRate >= 50 ? 'bg-orange-400' : 'bg-red-500'}`} style={{ width: `${stats.payRate}%` }} />
            </div>
            <div className="flex justify-between pt-1">
              <span className="text-gray-500">To'lamagan:</span>
              <span className="font-semibold text-red-600">{stats.unpaidCount} ta</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">Jami qarz:</span>
              <span className="font-bold text-red-700">{stats.totalDebt.toLocaleString('uz-UZ')}</span>
            </div>
            {stats.topDebtor && (
              <div className="pt-1.5 mt-1 border-t border-gray-100">
                <p className="text-gray-400 text-[10px]">Eng qarzdor:</p>
                <button onClick={() => flyToEntity(stats.topDebtor!)} className="text-left">
                  <p className="text-xs font-medium text-gray-700 truncate hover:text-red-600">{stats.topDebtor.name}</p>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Tanlangan tashkilot popup */}
        {selected && (
          <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-[1000] bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80">
            <div className="flex items-start justify-between gap-2">
              <div className="flex-1 min-w-0">
                <p className="font-semibold text-gray-900 text-sm truncate">{selected.name}</p>
                <p className="text-xs text-gray-500 mt-0.5 truncate">{selected.address}</p>
                <div className="flex items-center gap-3 mt-2">
                  {selected.paid ? (
                    <span className="flex items-center gap-1 text-xs text-green-700 font-medium">
                      <CheckCircle2 className="w-3.5 h-3.5" /> To'lagan
                    </span>
                  ) : (
                    <span className="flex items-center gap-1 text-xs text-red-600 font-medium">
                      <AlertCircle className="w-3.5 h-3.5" />
                      To'lamagan{(selected.debtMonths ?? 0) > 1 && ` · ${selected.debtMonths} oy`}
                    </span>
                  )}
                  {selected.lat && selected.lng && (
                    <a href={`https://maps.google.com/?q=${selected.lat},${selected.lng}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                      <Navigation className="w-3 h-3" /> Navigator
                    </a>
                  )}
                </div>
                {!selected.paid && (selected.debtMonths ?? 0) > 0 && (selected.monthlyFee ?? 0) > 0 && (
                  <div className="mt-2 bg-red-50 rounded-lg px-2.5 py-1.5">
                    <span className="text-xs text-red-500">Qarz: </span>
                    <span className="text-sm font-bold text-red-700">
                      {((selected.debtMonths ?? 1) * (selected.monthlyFee ?? 0)).toLocaleString('uz-UZ')} so'm
                    </span>
                  </div>
                )}
                {/* To'g'ridan-to'g'ri to'lov */}
                {!selected.paid && selected.status === 'active' && (
                  <button
                    onClick={() => setPayEntity({
                      id: selected.id, name: selected.name, address: selected.address,
                      monthlyFee: selected.monthlyFee ?? 0,
                    })}
                    className="mt-2.5 w-full flex items-center justify-center gap-1.5 px-3 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-xs font-semibold transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" /> To'lovni qayd etish
                  </button>
                )}
              </div>
              <button onClick={() => setSelected(null)} className="p-1 hover:bg-gray-100 rounded text-gray-400 shrink-0">×</button>
            </div>
          </div>
        )}

        {!loading && entities.length > 0 && withCoords === 0 && (
          <div className="absolute inset-0 z-[999] flex items-center justify-center bg-white/80">
            <div className="text-center">
              <MapPin className="w-10 h-10 text-gray-300 mx-auto mb-2" />
              <p className="text-gray-600 font-medium text-sm">Tashkilotlarda koordinata yo'q</p>
              <p className="text-gray-400 text-xs mt-1">Tashkilotlar sahifasida "Xaritadan belgilash" tugmasini ishlating</p>
            </div>
          </div>
        )}
      </div>

      {/* To'lov modali */}
      {payEntity && (
        <PaymentModal
          entity={payEntity}
          onClose={() => setPayEntity(null)}
          onSuccess={() => {
            setPayEntity(null)
            setSelected(null)
            // Ma'lumotni yangilash
            const params = new URLSearchParams()
            if (selectedDistrict) params.set('districtId', selectedDistrict)
            ekoApi.get(`/dashboard/map?${params}`).then(res => {
              const data = res.data.data ?? res.data
              setEntities((Array.isArray(data) ? data : []).map((e: any) => ({
                id: e.id, name: e.name, address: e.address ?? '',
                status: e.status, paid: Boolean(e.paidThisMonth),
                lat: e.lat ?? undefined, lng: e.lon ?? undefined,
                districtId: e.districtId,
                debtMonths: e.debtMonths ?? 0, monthlyFee: e.monthlyFee ?? 0,
              })))
            }).catch(() => {})
          }}
        />
      )}
    </div>
  )
}
