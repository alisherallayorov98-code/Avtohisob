import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet.markercluster'
import 'leaflet.markercluster/dist/MarkerCluster.css'
import 'leaflet.markercluster/dist/MarkerCluster.Default.css'
import { MapEntity, MapBbox, debtOf } from './useMapEntities'
import { ensureMapStyle, makeIcon, makeClusterIcon, userLocationIcon } from './mapIcons'
import { getSavedView } from './geo'

// Leaflet default marker icon fix (Vite)
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export interface UserLoc { lat: number; lng: number; accuracy?: number }

interface Options {
  /** Ko'rinadigan (filtrlangan) tashkilotlar — markerlar */
  entities: MapEntity[]
  /** Hamma tashkilotlar — issiqlik qatlami uchun */
  allEntities: MapEntity[]
  satellite: boolean
  heatmap: boolean
  labels: boolean
  /** Marshrut chizig'i koordinatalari (null — chizilmaydi) */
  routeCoords: [number, number][] | null
  userLoc: UserLoc | null
  onSelect: (e: MapEntity) => void
  onBboxChange: (b: MapBbox) => void
  /** O'zgarsa xarita yangi hududga moslanadi (tuman almashganda) */
  fitKey: string
}

const OSM = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'

/**
 * Leaflet xaritasi: yaratish, klaster markerlar, issiqlik qatlami, nom yorliqlari,
 * marshrut chizig'i, foydalanuvchi joylashuvi. Konteyner `setContainer` ref-callback
 * orqali beriladi: mobil/desktop maket almashganda xarita qayta quriladi.
 */
export function useLeafletMap(o: Options) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null)
  const [map, setMap] = useState<L.Map | null>(null)
  const clusterRef = useRef<any>(null)
  const heatRef = useRef<L.LayerGroup | null>(null)
  const tileRef = useRef<L.TileLayer | null>(null)
  const routeRef = useRef<L.Polyline | null>(null)
  const userRef = useRef<{ marker: L.Marker; circle: L.Circle } | null>(null)
  const markerById = useRef<Map<string, L.Marker>>(new Map())
  const fittedRef = useRef(false)
  const bboxTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Eng so'nggi callbacklar (effektlarni qayta ishga tushirmaslik uchun)
  const cb = useRef({ onSelect: o.onSelect, onBboxChange: o.onBboxChange })
  cb.current = { onSelect: o.onSelect, onBboxChange: o.onBboxChange }

  // ─── Yaratish ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!container) return
    ensureMapStyle()
    const { center, zoom } = getSavedView()
    const m = L.map(container, { center, zoom, zoomControl: false, maxZoom: 21 })
    L.control.zoom({ position: 'bottomright', zoomInTitle: 'Yaqinlashtirish', zoomOutTitle: 'Uzoqlashtirish' }).addTo(m)

    tileRef.current = L.tileLayer(OSM, { attribution: '© OpenStreetMap', maxZoom: 21, maxNativeZoom: 19 }).addTo(m)

    clusterRef.current = (L as any).markerClusterGroup({
      maxClusterRadius: 50,
      spiderfyOnMaxZoom: true,
      showCoverageOnHover: false,
      iconCreateFunction: makeClusterIcon,
    })
    m.addLayer(clusterRef.current)
    heatRef.current = L.layerGroup()

    const onMove = () => {
      const c = m.getCenter()
      try {
        localStorage.setItem('eko_map_view', JSON.stringify({ center: [c.lat, c.lng], zoom: m.getZoom() }))
      } catch { /* saqlab bo'lmadi — muhim emas */ }
      // Ko'rinayotgan hudud o'zgardi — 500 ms jimlikdan keyin qayta so'raymiz
      if (bboxTimer.current) clearTimeout(bboxTimer.current)
      bboxTimer.current = setTimeout(() => {
        const b = m.getBounds().pad(0.2)
        cb.current.onBboxChange({
          minLat: b.getSouth(), maxLat: b.getNorth(), minLon: b.getWest(), maxLon: b.getEast(),
        })
      }, 500)
    }
    m.on('moveend', onMove)
    m.on('zoomend', onMove)
    setMap(m)

    return () => {
      if (bboxTimer.current) clearTimeout(bboxTimer.current)
      m.remove()
      clusterRef.current = null; heatRef.current = null; tileRef.current = null
      routeRef.current = null; userRef.current = null
      markerById.current.clear()
      fittedRef.current = false
      setMap(null)
    }
  }, [container])

  // ─── Tile (oddiy / sun'iy yo'ldosh) ─────────────────────────────────────
  useEffect(() => {
    if (!map) return
    if (tileRef.current) map.removeLayer(tileRef.current)
    tileRef.current = satellite2(o.satellite).addTo(map)
  }, [map, o.satellite])

  // Tuman almashdi — qayta moslash
  useEffect(() => { fittedRef.current = false }, [o.fitKey])

  // ─── Markerlar ──────────────────────────────────────────────────────────
  useEffect(() => {
    const cluster = clusterRef.current
    if (!cluster || !map) return
    cluster.clearLayers()
    markerById.current.clear()

    const withCoords = o.entities.filter(e => e.lat && e.lng)
    withCoords.forEach(entity => {
      const st = entity.status === 'blacklisted' ? 'blacklisted'
        : entity.status === 'draft' ? 'draft'
        : entity.status === 'inactive' ? 'inactive'
        : entity.paid ? 'paid' : 'unpaid'
      const marker = L.marker([entity.lat!, entity.lng!], {
        icon: makeIcon(st, entity.debtMonths, entity.billingMode),
        zIndexOffset: st === 'unpaid' ? 1000 : 0,
        ekoUnpaid: st === 'unpaid',
      } as any).on('click', () => cb.current.onSelect(entity))
      if (o.labels) marker.bindTooltip(entity.name, { permanent: true, direction: 'top', offset: [0, -10], className: 'eko-label' })
      else marker.bindTooltip(entity.name, { direction: 'top', offset: [0, -10] })
      cluster.addLayer(marker)
      markerById.current.set(entity.id, marker)
    })

    if (withCoords.length > 0 && !fittedRef.current) {
      map.fitBounds(L.latLngBounds(withCoords.map(e => [e.lat!, e.lng!] as [number, number])), { padding: [60, 60], maxZoom: 15 })
      fittedRef.current = true
    }
  }, [map, o.entities, o.labels])

  // ─── Issiqlik: qarz zonalari ────────────────────────────────────────────
  useEffect(() => {
    const heat = heatRef.current
    if (!map || !heat) return
    heat.clearLayers()
    if (!o.heatmap) { map.removeLayer(heat); return }
    const unpaid = o.allEntities.filter(e => e.lat && e.lng && !e.paid && e.status === 'active')
    const cells = new Map<string, { lat: number; lng: number; count: number; debt: number }>()
    for (const e of unpaid) {
      const key = `${(e.lat! * 100).toFixed(0)}:${(e.lng! * 100).toFixed(0)}`  // ~1km grid
      if (!cells.has(key)) cells.set(key, { lat: e.lat!, lng: e.lng!, count: 0, debt: 0 })
      const c = cells.get(key)!
      c.count++; c.debt += debtOf(e)
    }
    for (const c of cells.values()) {
      const intensity = Math.min(c.count, 8)
      const cls = intensity >= 5 ? 'eko-heat-3' : intensity >= 3 ? 'eko-heat-2' : 'eko-heat-1'
      L.circle([c.lat, c.lng], {
        radius: 200 + intensity * 80, className: cls, fillOpacity: 0.18, weight: 1, opacity: 0.4,
      }).bindTooltip(`${c.count} ta qarzdor · ${c.debt.toLocaleString('uz-UZ')} so'm`, { sticky: true }).addTo(heat)
    }
    map.addLayer(heat)
  }, [map, o.heatmap, o.allEntities])

  // ─── Marshrut chizig'i ──────────────────────────────────────────────────
  useEffect(() => {
    if (!map) return
    if (routeRef.current) { routeRef.current.remove(); routeRef.current = null }
    if (!o.routeCoords || o.routeCoords.length < 2) return
    routeRef.current = L.polyline(o.routeCoords, {
      className: 'eko-route-line', weight: 3, opacity: 0.7, dashArray: '8 6',
    }).addTo(map)
  }, [map, o.routeCoords])

  // ─── Foydalanuvchi joylashuvi ───────────────────────────────────────────
  useEffect(() => {
    if (!map) return
    if (userRef.current) { userRef.current.marker.remove(); userRef.current.circle.remove(); userRef.current = null }
    if (!o.userLoc) return
    const { lat, lng, accuracy } = o.userLoc
    const marker = L.marker([lat, lng], { icon: userLocationIcon(), zIndexOffset: 2000 }).addTo(map)
    marker.bindTooltip('Siz shu yerdasiz', { direction: 'top', offset: [0, -10] })
    const circle = L.circle([lat, lng], {
      radius: accuracy ?? 0, weight: 1, opacity: 0.4, fillOpacity: 0.08, interactive: false, className: 'eko-accuracy',
    }).addTo(map)
    userRef.current = { marker, circle }
  }, [map, o.userLoc])

  const flyTo = useCallback((lat: number, lng: number, zoom = 17) => {
    map?.flyTo([lat, lng], zoom, { duration: 0.8 })
  }, [map])

  /** Tashkilotga uchib borish; klaster ichida bo'lsa ochadi */
  const flyToEntity = useCallback((e: MapEntity) => {
    if (!map || !e.lat || !e.lng) return
    map.flyTo([e.lat, e.lng], 17, { duration: 0.8 })
    const marker = markerById.current.get(e.id)
    if (marker && clusterRef.current) {
      setTimeout(() => clusterRef.current?.zoomToShowLayer(marker, () => marker.openTooltip()), 850)
    }
  }, [map])

  return { setContainer, map, flyTo, flyToEntity }
}

function satellite2(sat: boolean) {
  // Esri sputnik tasvirlari 18-zoomgacha — undan keyin cho'ziladi (bo'sh qolmaydi)
  return sat
    ? L.tileLayer(ESRI, { attribution: '© Esri', maxZoom: 21, maxNativeZoom: 18 })
    : L.tileLayer(OSM, { attribution: '© OpenStreetMap', maxZoom: 21, maxNativeZoom: 19 })
}
