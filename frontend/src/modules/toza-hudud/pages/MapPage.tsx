import { useEffect, useRef, useState, useMemo } from 'react'
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import toast from 'react-hot-toast'
import { Layers, Save, X, Download, Wifi, RefreshCw, Upload, Play, Pause, Search } from 'lucide-react'
import api from '../../../lib/api'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

type LayerMode = 'mfy' | 'landfill' | 'gps' | 'container' | 'track' | 'live' | 'nazorat'

// Har bir MFY o'ziga xos rangda ko'rinsin — ID hash orqali palitradan tanlanadi
const MFY_COLORS = [
  { stroke: '#e11d48', fill: '#fda4af' }, // rose
  { stroke: '#d97706', fill: '#fde68a' }, // amber
  { stroke: '#16a34a', fill: '#86efac' }, // green
  { stroke: '#0284c7', fill: '#7dd3fc' }, // sky
  { stroke: '#7c3aed', fill: '#c4b5fd' }, // violet
  { stroke: '#db2777', fill: '#f9a8d4' }, // pink
  { stroke: '#0891b2', fill: '#67e8f9' }, // cyan
  { stroke: '#65a30d', fill: '#bef264' }, // lime
  { stroke: '#9333ea', fill: '#d8b4fe' }, // purple
  { stroke: '#ea580c', fill: '#fdba74' }, // orange
  { stroke: '#0d9488', fill: '#5eead4' }, // teal
  { stroke: '#4f46e5', fill: '#a5b4fc' }, // indigo
  { stroke: '#be185d', fill: '#fbcfe8' }, // rose-dark
  { stroke: '#b45309', fill: '#fef08a' }, // yellow-dark
  { stroke: '#166534', fill: '#bbf7d0' }, // green-dark
  { stroke: '#1d4ed8', fill: '#bfdbfe' }, // blue
]
function getMfyColor(id: string) {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff
  return MFY_COLORS[h % MFY_COLORS.length]
}

interface GeoZone {
  id: number
  name: string
  color: string
  points: Array<{ lat: number; lon: number }>
}

// ─── Trek utilities ──────────────────────────────────────────────────────────

const TRACK_COLORS = ['#f59e0b', '#3b82f6', '#ef4444', '#10b981', '#8b5cf6']

interface TrackPoint { lat: number; lon: number; speed: number; ts: number }

interface StopPoint { lat: number; lon: number; durationMin: number; startTs: number }

function detectStops(points: TrackPoint[], minDurSec = 180, maxSpeedKmh = 5): StopPoint[] {
  const stops: StopPoint[] = []
  let slowStart: number | null = null
  let sLat = 0, sLon = 0
  for (let i = 0; i < points.length; i++) {
    const p = points[i]
    if (p.speed <= maxSpeedKmh) {
      if (slowStart === null) { slowStart = p.ts; sLat = p.lat; sLon = p.lon }
    } else {
      if (slowStart !== null) {
        const dur = p.ts - slowStart
        if (dur >= minDurSec) stops.push({ lat: sLat, lon: sLon, durationMin: Math.round(dur / 60), startTs: slowStart })
        slowStart = null
      }
    }
  }
  if (slowStart !== null && points.length > 0) {
    const dur = points[points.length - 1].ts - slowStart
    if (dur >= minDurSec) stops.push({ lat: sLat, lon: sLon, durationMin: Math.round(dur / 60), startTs: slowStart })
  }
  return stops
}

function exportGPX(regNum: string, date: string, points: TrackPoint[]) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="AvtoHisob">\n  <trk><name>${regNum} ${date}</name><trkseg>\n${points.map(p => `    <trkpt lat="${p.lat}" lon="${p.lon}"><time>${new Date(p.ts * 1000).toISOString()}</time></trkpt>`).join('\n')}\n  </trkseg></trk>\n</gpx>`
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([xml], { type: 'application/gpx+xml' }))
  a.download = `trek-${regNum}-${date}.gpx`; a.click()
}

function exportCSV(regNum: string, date: string, points: TrackPoint[]) {
  const rows = ['timestamp,lat,lon,speed_kmh', ...points.map(p => `${new Date(p.ts * 1000).toISOString()},${p.lat},${p.lon},${p.speed}`)]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv' }))
  a.download = `trek-${regNum}-${date}.csv`; a.click()
}

export default function MapPage() {
  const qc = useQueryClient()
  const mapRef = useRef<L.Map | null>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const drawnLayersRef = useRef<L.FeatureGroup | null>(null)
  const mfyLayersRef = useRef<Map<string, L.Layer>>(new Map())
  const nazoratLayersRef = useRef<Map<string, L.Layer>>(new Map())
  const landfillLayersRef = useRef<Map<string, L.Layer>>(new Map())
  const gpsLayersRef = useRef<Map<number, L.Layer>>(new Map())
  const containerLayersRef = useRef<Map<string, L.Layer>>(new Map())
  const trackLayersRef = useRef<Map<string, L.Layer[]>>(new Map())
  const playbackMarkerRef = useRef<L.Marker | null>(null)
  const playbackTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const liveMarkersRef = useRef<L.Layer[]>([])
  const tileLayerRef = useRef<L.TileLayer | null>(null)

  const [districtFilter, setDistrictFilter] = useState('')
  const [layerMode, setLayerMode] = useState<LayerMode>('mfy')
  const [mapStyle, setMapStyle] = useState<'street' | 'satellite'>('street')
  const [drawingFor, setDrawingFor] = useState<{ id: string; name: string; type: 'mfy' | 'landfill' } | null>(null)
  const [pendingGeoJson, setPendingGeoJson] = useState<any>(null)
  // GPS geozone → MFY biriktirish modali
  const [linkModal, setLinkModal] = useState<{ zone: GeoZone } | null>(null)
  const [linkMfyId, setLinkMfyId] = useState('')
  const [importDistrictId, setImportDistrictId] = useState('')
  const [kmlFile, setKmlFile] = useState<File | null>(null)
  const [kmlDistrictId, setKmlDistrictId] = useState('')
  const [unmatchedZones, setUnmatchedZones] = useState<Array<{ name: string; points: number }>>([])
  const [mapZoneModal, setMapZoneModal] = useState<string | null>(null) // GPS zone name → MFY ga moslash
  const [mapZoneMfyId, setMapZoneMfyId] = useState('')
  // Trek layer
  const [selectedVehicleIds, setSelectedVehicleIds] = useState<string[]>([])
  const [vehicleSearch, setVehicleSearch] = useState('')
  const [showVehicleDropdown, setShowVehicleDropdown] = useState(false)
  const [trackDate, setTrackDate] = useState(() => new Date().toISOString().split('T')[0])
  const [trackDateTo, setTrackDateTo] = useState(() => new Date().toISOString().split('T')[0])
  const [trackTimeFrom, setTrackTimeFrom] = useState('00:00')
  const [trackTimeTo, setTrackTimeTo] = useState('23:59')
  const [showStops, setShowStops] = useState(true)
  const [isPlaying, setIsPlaying] = useState(false)
  const [playbackSpeed, setPlaybackSpeed] = useState(5)
  const [playbackIdx, setPlaybackIdx] = useState(0)
  const [nazoratDate, setNazoratDate] = useState(() => new Date().toISOString().split('T')[0])

  const { data: districts } = useQuery({
    queryKey: ['th-districts-all', ''],
    queryFn: () => api.get('/th/districts', { params: { limit: 200 } }).then(r => r.data.data),
  })
  const { data: mfys } = useQuery({
    queryKey: ['th-mfys-map', districtFilter],
    queryFn: () => api.get('/th/mfys', {
      params: { districtId: districtFilter || undefined, limit: 2000 }
    }).then(r => r.data.data),
  })
  const { data: landfills } = useQuery({
    queryKey: ['th-landfills'],
    queryFn: () => api.get('/th/landfills').then(r => r.data.data),
  })
  const { data: containers } = useQuery({
    queryKey: ['th-containers-map'],
    queryFn: () => api.get('/th/containers', { params: { limit: 5000 } }).then(r => r.data.data),
    enabled: layerMode === 'container',
  })

  const { data: trackVehicles } = useQuery({
    queryKey: ['th-driver-vehicles'],
    queryFn: () => api.get('/th/driver/vehicles').then(r => r.data.data),
    enabled: layerMode === 'track',
  })

  const trackQueries = useQueries({
    queries: selectedVehicleIds.map(vid => ({
      queryKey: ['th-track', vid, trackDate, trackDateTo, trackTimeFrom, trackTimeTo],
      queryFn: () => api.get('/th/tracks', {
        params: { vehicleId: vid, date: trackDate, dateTo: trackDateTo !== trackDate ? trackDateTo : undefined, timeFrom: trackTimeFrom, timeTo: trackTimeTo },
      }).then(r => r.data.data),
      enabled: layerMode === 'track' && !!vid,
    })),
  })
  const anyTrackLoading = trackQueries.some(q => q.isFetching)

  // Stable dep key for trek render effect
  const trekDataKey = useMemo(
    () => trackQueries.map(q => String(q.dataUpdatedAt ?? 0)).join('|'),
    [trackQueries],
  )
  // Jonli mashina pozitsiyalari — har 2 daqiqada yangilanadi
  const { data: livePositions, dataUpdatedAt: liveUpdatedAt } = useQuery({
    queryKey: ['th-live-positions'],
    queryFn: () => api.get('/th/gps/positions').then(r => r.data.data as Array<{
      vehicleId: string; registrationNumber: string; brand: string; model: string
      lat: number; lon: number; speed: number; heading: number; capturedAt: string
      scheduled: boolean; liveStatus: 'active' | 'scheduled' | 'idle'
      coveragePct: number | null; visitedToday: number; totalToday: number
    }>),
    enabled: layerMode === 'live',
    refetchInterval: 120_000,
    staleTime: 110_000,
  })

  const nazoratRunMut = useMutation({
    mutationFn: (date: string) => api.post('/th/trips/run', {}, { params: { date } }),
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`Tahlil tugadi: ${d.analyzed} MFY tahlil qilindi`)
      qc.invalidateQueries({ queryKey: ['th-nazorat-trips'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Nazorat: kunlik monitoring natijalari (har bir MFY + coveragePct)
  const { data: nazoratTrips, isLoading: nazoratLoading, refetch: refetchNazorat } = useQuery({
    queryKey: ['th-nazorat-trips', nazoratDate],
    queryFn: () => api.get('/th/trips/service', { params: { date: nazoratDate } }).then(r => r.data.data as Array<{
      id: string; vehicleId: string; mfyId: string; status: string
      coveragePct: number | null; enteredAt: string | null; exitedAt: string | null
      suspicious: boolean; maxSpeedKmh: number | null
      mfy: { id: string; name: string; polygon: any; district: { name: string } | null }
      vehicle: { registrationNumber: string; brand: string; model: string } | null
    }>),
    enabled: layerMode === 'nazorat',
    staleTime: 60_000,
  })

  // Nazorat sozlamalari (yashil/sariq chegaralar)
  const { data: thSettings } = useQuery({
    queryKey: ['th-settings'],
    queryFn: () => api.get('/th/settings').then(r => r.data.data),
    staleTime: 5 * 60_000,
  })

  const { data: geoZones, isLoading: gpsLoading, refetch: refetchZones, error: gpsError } = useQuery({
    queryKey: ['th-gps-zones'],
    queryFn: () => api.get('/th/gps/zones').then(r => r.data.data as GeoZone[]),
    staleTime: 5 * 60 * 1000,
    retry: 1,
  })

  const saveMfyPolygon = useMutation({
    mutationFn: ({ id, polygon }: { id: string; polygon: any }) =>
      api.put(`/th/mfys/${id}`, { name: mfys?.find((m: any) => m.id === id)?.name || '', polygon }),
    onSuccess: () => {
      toast.success("MFY chegarasi saqlandi")
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
      setDrawingFor(null); setPendingGeoJson(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const saveLandfillPolygon = useMutation({
    mutationFn: ({ id, polygon }: { id: string; polygon: any }) =>
      api.put(`/th/landfills/${id}`, { name: landfills?.find((l: any) => l.id === id)?.name || '', polygon }),
    onSuccess: () => {
      toast.success("Poligon chegarasi saqlandi")
      qc.invalidateQueries({ queryKey: ['th-landfills'] })
      setDrawingFor(null); setPendingGeoJson(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const linkMut = useMutation({
    mutationFn: ({ mfyId, points, zoneName }: { mfyId: string; points: Array<{ lat: number; lon: number }>; zoneName?: string }) =>
      api.post('/th/gps/zones/link', { mfyId, points, zoneName }),
    onSuccess: () => {
      toast.success("Geozona MFYga biriktirildi")
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
      setLinkModal(null); setLinkMfyId('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const importMfysMut = useMutation({
    mutationFn: (districtId: string) => api.post('/th/gps/import-mfys', { districtId }),
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`${d.created} ta MFY yaratildi (${d.skipped} ta mavjud, jami ${d.total} ta geozone)`)
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const syncFromGpsMut = useMutation({
    mutationFn: () => api.post('/th/gps/sync-polygons'),
    onSuccess: (res) => {
      toast.success(res.data.message)
      setUnmatchedZones(res.data.data.unmatchedZones || [])
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const mapZoneMut = useMutation({
    mutationFn: ({ mfyId, gpsZoneName }: { mfyId: string; gpsZoneName: string }) =>
      api.put(`/th/mfys/${mfyId}`, {
        name: mfys?.find((m: any) => m.id === mfyId)?.name || '',
        gpsZoneName,
      }),
    onSuccess: (_data, vars) => {
      toast.success('Geozona MFY ga moslandi')
      setUnmatchedZones(prev => prev.filter(z => z.name !== vars.gpsZoneName))
      setMapZoneModal(null)
      setMapZoneMfyId('')
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const importKmlMut = useMutation({
    mutationFn: ({ file, districtId }: { file: File; districtId?: string }) => {
      const form = new FormData()
      form.append('file', file)
      if (districtId) form.append('districtId', districtId)
      return api.post('/th/mfys/import-kml', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => {
      toast.success(res.data.message)
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
      setKmlFile(null)
      setKmlDistrictId('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Xaritani ishga tushirish
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return

    const map = L.map(mapDivRef.current, { center: [39.65, 66.97], zoom: 11 })
    const tile = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    })
    tile.addTo(map)
    tileLayerRef.current = tile

    const drawnItems = new L.FeatureGroup()
    map.addLayer(drawnItems)
    drawnLayersRef.current = drawnItems

    const drawControl = new (L as any).Control.Draw({
      edit: { featureGroup: drawnItems },
      draw: {
        polygon: { allowIntersection: false, showArea: true, shapeOptions: { color: '#059669', fillOpacity: 0.3 } },
        polyline: false, rectangle: false, circle: false, circlemarker: false, marker: false,
      },
    })
    map.addControl(drawControl)

    map.on((L as any).Draw.Event.CREATED, (e: any) => {
      drawnItems.clearLayers()
      drawnItems.addLayer(e.layer)
      setPendingGeoJson(e.layer.toGeoJSON())
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Sputnik / ko'cha xaritasini almashtirish
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tileLayerRef.current) { map.removeLayer(tileLayerRef.current) }
    const url = mapStyle === 'satellite'
      ? 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'
      : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
    const attr = mapStyle === 'satellite'
      ? 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
      : '© OpenStreetMap contributors'
    const tile = L.tileLayer(url, { attribution: attr, maxZoom: 19 })
    tile.addTo(map)
    tileLayerRef.current = tile
  }, [mapStyle])

  // MFY layerlar — layerMode ga qarab uslub o'zgaradi
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mfys) return
    mfyLayersRef.current.forEach(l => map.removeLayer(l))
    mfyLayersRef.current.clear()

    // Nazorat va GPS: o'z layerlari bor — MFY layer shart emas
    if (layerMode === 'nazorat' || layerMode === 'gps') return

    // Live va Trek: MFY chegaralarini yengilgina ko'rsatish (kontekst uchun)
    const isContext = layerMode === 'live' || layerMode === 'track'

    mfys.forEach((mfy: any) => {
      if (!mfy.polygon) return
      try {
        const clr = getMfyColor(mfy.id)
        const layer = L.geoJSON(mfy.polygon, {
          style: isContext
            ? { color: clr.stroke, fillColor: clr.fill, fillOpacity: 0.06, weight: 1.5, dashArray: '6 5', opacity: 0.4 }
            : { color: clr.stroke, fillColor: clr.fill, fillOpacity: 0.28, weight: 2.5 },
        })
        if (!isContext) {
          layer.bindTooltip(mfy.name, { permanent: false, direction: 'center' })
        }
        layer.addTo(map)
        mfyLayersRef.current.set(mfy.id, layer)
      } catch {}
    })
  }, [mfys, layerMode])

  // Landfill layerlar
  useEffect(() => {
    const map = mapRef.current
    if (!map || !landfills) return
    landfillLayersRef.current.forEach(l => map.removeLayer(l))
    landfillLayersRef.current.clear()
    landfills.forEach((lf: any) => {
      if (!lf.polygon) return
      try {
        const layer = L.geoJSON(lf.polygon, {
          style: { color: '#dc2626', fillColor: '#fca5a5', fillOpacity: 0.3, weight: 2 },
        })
        layer.bindTooltip(`🗑 ${lf.name}`, { permanent: false, direction: 'center' })
        layer.addTo(map)
        landfillLayersRef.current.set(lf.id, layer)
      } catch {}
    })
  }, [landfills])

  // GPS Geozone layerlar — barcha rejimlarda ko'rinadi (GPS rejimida to'liq, boshqalarda yengil kontur)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    gpsLayersRef.current.forEach(l => map.removeLayer(l))
    gpsLayersRef.current.clear()

    if (!geoZones || geoZones.length === 0) return

    const isGpsMode = layerMode === 'gps'

    geoZones.forEach((zone: GeoZone) => {
      try {
        const latlngs = zone.points.map(p => [p.lat, p.lon] as [number, number])
        if (latlngs.length < 3) return // polygon uchun kamida 3 nuqta kerak
        const color = zone.color || '#6366f1'
        const layer = L.polygon(latlngs, isGpsMode
          ? { color, fillColor: color, fillOpacity: 0.22, weight: 2, opacity: 1 }
          : { color, fillColor: color, fillOpacity: 0.04, weight: 1, opacity: 0.35, dashArray: '5 7' }
        )
        layer.bindTooltip(zone.name, { permanent: false, direction: 'center' })
        if (isGpsMode) layer.on('click', () => setLinkModal({ zone }))
        layer.addTo(map)
        gpsLayersRef.current.set(zone.id, layer)
      } catch {}
    })
  }, [geoZones, layerMode])

  // Konteyner layerlar (kichik doiralar)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    containerLayersRef.current.forEach(l => map.removeLayer(l))
    containerLayersRef.current.clear()

    if (layerMode !== 'container' || !containers) return

    for (const c of containers as any[]) {
      try {
        const layer = L.circle([c.latitude, c.longitude], {
          radius: c.radiusM || 10,
          color: '#7c3aed',
          fillColor: '#a78bfa',
          fillOpacity: 0.5,
          weight: 1,
        })
        layer.bindTooltip(`🗑 ${c.name}${c.mfy?.name ? ` (${c.mfy.name})` : ''}`, { direction: 'top' })
        layer.addTo(map)
        containerLayersRef.current.set(c.id, layer)
      } catch {}
    }
  }, [containers, layerMode])

  // Konteyner mode off bo'lsa tozalash
  useEffect(() => {
    if (layerMode !== 'container') {
      const map = mapRef.current
      if (!map) return
      containerLayersRef.current.forEach(l => map.removeLayer(l))
      containerLayersRef.current.clear()
    }
  }, [layerMode])

  // Trek polyline render — har bir tanlangan mashina uchun
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Barcha trek layerlarni tozalash
    trackLayersRef.current.forEach(layers => layers.forEach(l => { try { map.removeLayer(l) } catch {} }))
    trackLayersRef.current.clear()

    if (layerMode !== 'track') return

    const allBounds: L.LatLngBounds[] = []

    trackQueries.forEach((query, idx) => {
      const vid = selectedVehicleIds[idx]
      if (!vid || !query.data?.points || query.data.points.length === 0) return

      const color = TRACK_COLORS[idx % TRACK_COLORS.length]
      const latlngs: [number, number][] = query.data.points.map((p: TrackPoint) => [p.lat, p.lon])
      const layers: L.Layer[] = []

      // Shadow
      const shadow = L.polyline(latlngs, { color: '#0f172a', weight: 9, opacity: 0.15 })
      shadow.addTo(map); layers.push(shadow)

      // Asosiy trek chizig'i
      const poly = L.polyline(latlngs, { color, weight: 5, opacity: 0.92 })
      poly.addTo(map); layers.push(poly)
      try { allBounds.push(poly.getBounds()) } catch {}

      // Boshlanish / tugash markerlar
      const regNum = query.data.vehicle?.registrationNumber || vid
      const startM = L.circleMarker(latlngs[0], { radius: 9, color: '#fff', weight: 3, fillColor: '#10b981', fillOpacity: 1 })
        .bindTooltip(`▶ ${regNum}`, { permanent: false })
      startM.addTo(map); layers.push(startM)

      const endM = L.circleMarker(latlngs[latlngs.length - 1], { radius: 9, color: '#fff', weight: 3, fillColor: '#ef4444', fillOpacity: 1 })
        .bindTooltip(`⏹ ${regNum}`, { permanent: false })
      endM.addTo(map); layers.push(endM)

      // To'xtash nuqtalari
      if (showStops) {
        detectStops(query.data.points).forEach(stop => {
          const stopM = L.circleMarker([stop.lat, stop.lon], {
            radius: 7, color: '#fff', weight: 2, fillColor: '#f59e0b', fillOpacity: 0.9,
          }).bindTooltip(`🅿 To'xtash: ${stop.durationMin} daq`, { direction: 'top' })
          stopM.addTo(map); layers.push(stopM)
        })
      }

      trackLayersRef.current.set(vid, layers)
    })

    // Barcha treklarni ko'rsat
    if (allBounds.length > 0) {
      try {
        const combined = allBounds.reduce((acc, b) => acc.extend(b))
        map.fitBounds(combined, { padding: [40, 40] })
      } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trekDataKey, layerMode, showStops, selectedVehicleIds.join(',')])

  // Trek mode o'chganda tozalash
  useEffect(() => {
    if (layerMode !== 'track') {
      const map = mapRef.current
      if (!map) return
      trackLayersRef.current.forEach(layers => layers.forEach(l => { try { map.removeLayer(l) } catch {} }))
      trackLayersRef.current.clear()
      if (playbackMarkerRef.current) { try { map.removeLayer(playbackMarkerRef.current) } catch {} ; playbackMarkerRef.current = null }
    }
  }, [layerMode])

  // Nazorat layeri: MFY poligonlar coveragePct rangida bo'yaladi
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    nazoratLayersRef.current.forEach(l => map.removeLayer(l))
    nazoratLayersRef.current.clear()

    if (layerMode !== 'nazorat' || !nazoratTrips) return

    const greenThr = thSettings?.coverageGreenPct ?? 70
    const yellowThr = thSettings?.coverageYellowPct ?? 40

    for (const trip of nazoratTrips) {
      if (!trip.mfy?.polygon) continue
      try {
        let color: string
        let fillColor: string
        let label: string

        if (trip.status === 'no_gps') {
          color = '#94a3b8'; fillColor = '#cbd5e1'; label = 'GPS yo\'q'
        } else if (trip.status === 'no_polygon') {
          continue // poligon yo'q — ko'rsatib bo'lmaydi
        } else {
          const pct = trip.coveragePct ?? 0
          if (pct >= greenThr) {
            color = '#059669'; fillColor = '#6ee7b7'; label = `✅ ${pct}% qoplandi`
          } else if (pct >= yellowThr) {
            color = '#d97706'; fillColor = '#fcd34d'; label = `⚠️ ${pct}% qoplandi`
          } else if (pct > 0) {
            color = '#dc2626'; fillColor = '#fca5a5'; label = `❌ ${pct}% — kam`
          } else {
            color = '#7f1d1d'; fillColor = '#fecaca'; label = '❌ Borilmadi'
          }
        }

        const layer = L.geoJSON(trip.mfy.polygon, {
          style: { color, fillColor, fillOpacity: 0.45, weight: 2 },
        })

        const enteredTime = trip.enteredAt
          ? new Date(trip.enteredAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
          : null
        const exitedTime = trip.exitedAt
          ? new Date(trip.exitedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
          : null

        layer.bindTooltip(
          `<b>${trip.mfy.name}</b><br>${label}` +
          (enteredTime ? `<br>Kirdi: ${enteredTime}${exitedTime ? ` → ${exitedTime}` : ''}` : '') +
          (trip.vehicle ? `<br>🚛 ${trip.vehicle.registrationNumber}` : '') +
          (trip.suspicious ? '<br>⚡ Shubhali (tez harakatlanган)' : ''),
          { direction: 'center', sticky: true }
        )
        layer.addTo(map)
        nazoratLayersRef.current.set(trip.id, layer)
      } catch {}
    }

    // Hamma nazorat layerlarini ko'rsatuvchi zoom
    if (nazoratLayersRef.current.size > 0) {
      try {
        const group = L.featureGroup(Array.from(nazoratLayersRef.current.values()))
        map.fitBounds(group.getBounds(), { padding: [30, 30], maxZoom: 14 })
      } catch {}
    }
  }, [nazoratTrips, layerMode, thSettings])

  // Nazorat mode off bo'lsa tozalash
  useEffect(() => {
    if (layerMode !== 'nazorat') {
      const map = mapRef.current
      if (!map) return
      nazoratLayersRef.current.forEach(l => map.removeLayer(l))
      nazoratLayersRef.current.clear()
    }
  }, [layerMode])

  // Jonli mashina markerlarini render qilish (MFY konteksti bilan integratsiya)
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    liveMarkersRef.current.forEach(m => map.removeLayer(m))
    liveMarkersRef.current = []

    if (layerMode !== 'live' || !livePositions || livePositions.length === 0) return

    // Mashina qaysi MFYda ekanini aniqlash (client-side ray-casting)
    const findMfyForPoint = (lat: number, lon: number): string | null => {
      if (!mfys) return null
      for (const mfy of mfys as any[]) {
        if (!mfy.polygon) continue
        try {
          let coords: number[][] | null = null
          const pg = mfy.polygon
          if (pg.type === 'Feature') coords = pg.geometry?.coordinates?.[0]
          else if (pg.type === 'Polygon') coords = pg.coordinates?.[0]
          else if (pg.type === 'FeatureCollection') coords = pg.features?.[0]?.geometry?.coordinates?.[0]
          if (!coords || coords.length < 3) continue
          let inside = false
          for (let i = 0, j = coords.length - 1; i < coords.length; j = i++) {
            const xi = coords[i][0], yi = coords[i][1]
            const xj = coords[j][0], yj = coords[j][1]
            if (((yi > lat) !== (yj > lat)) && (lon < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside
          }
          if (inside) return mfy.name
        } catch {}
      }
      return null
    }

    for (const pos of livePositions) {
      const minsAgo = Math.round((Date.now() - new Date(pos.capturedAt).getTime()) / 60000)
      const currentMfy = findMfyForPoint(pos.lat, pos.lon)

      // Rang: yashil = faol (borildi), sariq = jadvalda lekin hali boshlamagan, kulrang = GPS bor lekin jadvalda yo'q
      const bgColor =
        pos.liveStatus === 'active' ? '#059669' :
        pos.liveStatus === 'scheduled' ? '#d97706' : '#64748b'
      const ringColor =
        pos.liveStatus === 'active' ? '#6ee7b7' :
        pos.liveStatus === 'scheduled' ? '#fcd34d' : '#cbd5e1'

      const icon = L.divIcon({
        html: `<div style="
          width:36px;height:36px;background:${bgColor};border:3px solid ${ringColor};
          border-radius:50%;display:flex;align-items:center;justify-content:center;
          font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,.35);
        ">🚛</div>`,
        className: '',
        iconSize: [36, 36],
        iconAnchor: [18, 18],
      })

      const statusLabel =
        pos.liveStatus === 'active' ? `✅ Faol (${pos.visitedToday}/${pos.totalToday} MFY)` :
        pos.liveStatus === 'scheduled' ? '⏳ Jadvalda — hali boshlamagan' : '⬜ Jadvalda emas'
      const pctStr = pos.coveragePct != null ? ` · ${pos.coveragePct}% qamrov` : ''

      const marker = L.marker([pos.lat, pos.lon], { icon })
      marker.bindTooltip(
        `<b>${pos.registrationNumber}</b><br>${pos.brand} ${pos.model}<br>` +
        `${statusLabel}${pctStr}<br>` +
        (currentMfy ? `📍 <b>${currentMfy}</b><br>` : '') +
        `Tezlik: <b>${pos.speed} km/h</b><br>` +
        `${minsAgo < 1 ? 'Hozir yangilandi' : `${minsAgo} daqiqa oldin`}`,
        { direction: 'top', offset: [0, -18] }
      )
      marker.addTo(map)
      liveMarkersRef.current.push(marker)
    }

    if (livePositions.length > 0 && liveMarkersRef.current.length > 0) {
      const group = L.featureGroup(liveMarkersRef.current)
      map.fitBounds(group.getBounds(), { padding: [60, 60], maxZoom: 14 })
    }
  }, [livePositions, layerMode, mfys])

  // Live mode off bo'lsa markerlarni tozalash
  useEffect(() => {
    if (layerMode !== 'live') {
      const map = mapRef.current
      if (!map) return
      liveMarkersRef.current.forEach(m => map.removeLayer(m))
      liveMarkersRef.current = []
    }
  }, [layerMode])

  // Playback: isPlaying o'zgarganda interval boshla/to'xtat
  useEffect(() => {
    if (playbackTimerRef.current) { clearInterval(playbackTimerRef.current); playbackTimerRef.current = null }
    if (!isPlaying) return
    const intervalMs = Math.max(30, Math.round(200 / playbackSpeed))
    playbackTimerRef.current = setInterval(() => {
      setPlaybackIdx(prev => {
        const pts = trackQueries[0]?.data?.points
        if (!pts || pts.length === 0) return prev
        const next = prev + 1
        if (next >= pts.length) { setIsPlaying(false); return prev }
        return next
      })
    }, intervalMs)
    return () => { if (playbackTimerRef.current) clearInterval(playbackTimerRef.current) }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPlaying, playbackSpeed])

  // Playback: marker pozitsiyasini yangilash
  useEffect(() => {
    if (!isPlaying || selectedVehicleIds.length !== 1) return
    const map = mapRef.current
    if (!map) return
    const pts: TrackPoint[] = trackQueries[0]?.data?.points
    if (!pts || !pts[playbackIdx]) return
    const p = pts[playbackIdx]
    if (!playbackMarkerRef.current) {
      const color = TRACK_COLORS[0]
      const icon = L.divIcon({
        html: `<div style="width:28px;height:28px;background:${color};border:3px solid #fff;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;box-shadow:0 2px 6px rgba(0,0,0,.4)">🚛</div>`,
        className: '', iconSize: [28, 28], iconAnchor: [14, 14],
      })
      playbackMarkerRef.current = L.marker([p.lat, p.lon], { icon, zIndexOffset: 1000 }).addTo(map)
    } else {
      playbackMarkerRef.current.setLatLng([p.lat, p.lon])
    }
    map.panTo([p.lat, p.lon], { animate: true, duration: 0.2 })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playbackIdx, isPlaying])

  // Playback: mashina o'zgarganda yoki trek modidan chiqqanda markerni o'chirish
  useEffect(() => {
    if (playbackMarkerRef.current) {
      try { mapRef.current?.removeLayer(playbackMarkerRef.current) } catch {}
      playbackMarkerRef.current = null
    }
    setIsPlaying(false)
    setPlaybackIdx(0)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedVehicleIds.join(','), layerMode])

  const startDrawingFor = (id: string, name: string, type: 'mfy' | 'landfill') => {
    drawnLayersRef.current?.clearLayers()
    setPendingGeoJson(null)
    setDrawingFor({ id, name, type })
    toast(`"${name}" chegarasini xaritada chizing`, { icon: '✏️', duration: 3000 })
  }

  const savePolygon = () => {
    if (!pendingGeoJson || !drawingFor) return
    if (drawingFor.type === 'mfy') saveMfyPolygon.mutate({ id: drawingFor.id, polygon: pendingGeoJson })
    else saveLandfillPolygon.mutate({ id: drawingFor.id, polygon: pendingGeoJson })
    drawnLayersRef.current?.clearLayers()
  }

  const cancelDraw = () => {
    drawnLayersRef.current?.clearLayers()
    setDrawingFor(null); setPendingGeoJson(null)
  }

  // Trek helpers
  const toggleVehicle = (vid: string) => {
    setSelectedVehicleIds(prev =>
      prev.includes(vid) ? prev.filter(id => id !== vid) : prev.length < 5 ? [...prev, vid] : prev
    )
  }
  const filteredVehicles = useMemo(() => {
    const q = vehicleSearch.toLowerCase()
    return (trackVehicles || []).filter((v: any) =>
      !q || v.registrationNumber.toLowerCase().includes(q) || `${v.brand} ${v.model}`.toLowerCase().includes(q)
    )
  }, [trackVehicles, vehicleSearch])

  const mfysWithPolygon = (mfys || []).filter((m: any) => m.polygon).length
  const mfysWithout = (mfys || []).filter((m: any) => !m.polygon).length

  // Auto-match: geozone nomi MFY nomi (yoki gpsZoneName) ga to'g'ri keladi
  const mfyNameSet = new Set<string>()
  for (const m of (mfys || [])) {
    mfyNameSet.add(m.name.trim().toLowerCase())
    if (m.gpsZoneName) mfyNameSet.add(m.gpsZoneName.trim().toLowerCase())
  }
  const matchedCount = (geoZones || []).filter(z => mfyNameSet.has(z.name.trim().toLowerCase())).length

  return (
    <div className="flex h-full">
      {/* Chap panel */}
      <div className="w-72 shrink-0 bg-white border-r border-gray-200 flex flex-col overflow-hidden">
        {/* Filtr */}
        <div className="p-3 border-b border-gray-100 space-y-2">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Filtr</p>
          <select value={districtFilter} onChange={e => setDistrictFilter(e.target.value)}
            className="w-full px-2.5 py-1.5 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500">
            <option value="">Barcha tumanlar</option>
            {(districts || []).map((d: any) => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>

          {/* Xarita uslubi: ko'cha / sputnik */}
          <div className="flex rounded-lg overflow-hidden border border-gray-200 text-xs font-medium">
            <button
              onClick={() => setMapStyle('street')}
              className={`flex-1 py-1.5 transition-colors ${mapStyle === 'street' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >🗺 Ko'cha</button>
            <button
              onClick={() => setMapStyle('satellite')}
              className={`flex-1 py-1.5 transition-colors ${mapStyle === 'satellite' ? 'bg-gray-800 text-white' : 'bg-white text-gray-600 hover:bg-gray-50'}`}
            >🛰 Sputnik</button>
          </div>

          {/* Layer tugmalari */}
          <div className="grid grid-cols-2 gap-1">
            <button onClick={() => setLayerMode('mfy')}
              className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'mfy' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              MFYlar
            </button>
            <button onClick={() => setLayerMode('landfill')}
              className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'landfill' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Poligonlar
            </button>
            <button onClick={() => setLayerMode('container')}
              className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'container' ? 'bg-violet-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Konteynerlar
            </button>
            <button onClick={() => setLayerMode('gps')}
              className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'gps' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              GPS
            </button>
            <button onClick={() => setLayerMode('track')}
              className={`py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'track' ? 'bg-sky-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              🛣 Treki
            </button>
            <button onClick={() => setLayerMode('live')}
              className={`py-1.5 text-xs rounded-lg font-medium transition-colors flex items-center justify-center gap-1 ${layerMode === 'live' ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              <span className={`w-2 h-2 rounded-full ${layerMode === 'live' ? 'bg-white animate-pulse' : 'bg-orange-400'}`} />
              Jonli
            </button>
            <button onClick={() => setLayerMode('nazorat')}
              className={`col-span-2 py-1.5 text-xs rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${layerMode === 'nazorat' ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              🗺 Nazorat xaritasi
            </button>
          </div>

          {/* Jonli panel */}
          {layerMode === 'live' && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide">
                  Jonli kuzatuv
                </p>
                <span className="flex items-center gap-1 text-xs text-gray-400">
                  <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                  2 daq refresh
                </span>
              </div>
              {livePositions && livePositions.length > 0 ? (
                <>
                  <div className="grid grid-cols-3 gap-1 text-xs">
                    <div className="bg-emerald-50 rounded-lg p-2 text-center">
                      <p className="text-emerald-700 font-bold text-base">
                        {livePositions.filter(p => p.liveStatus === 'active').length}
                      </p>
                      <p className="text-emerald-600 leading-tight">🟢 Faol</p>
                    </div>
                    <div className="bg-amber-50 rounded-lg p-2 text-center">
                      <p className="text-amber-700 font-bold text-base">
                        {livePositions.filter(p => p.liveStatus === 'scheduled').length}
                      </p>
                      <p className="text-amber-600 leading-tight">🟡 Kutmoqda</p>
                    </div>
                    <div className="bg-gray-50 rounded-lg p-2 text-center">
                      <p className="text-gray-500 font-bold text-base">
                        {livePositions.filter(p => p.liveStatus === 'idle').length}
                      </p>
                      <p className="text-gray-400 leading-tight">⬜ Jadvalda yo'q</p>
                    </div>
                  </div>
                  <div className="text-xs space-y-0.5">
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" />
                      <span className="text-gray-500">Faol (bugun borildi)</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-amber-500 shrink-0" />
                      <span className="text-gray-500">Jadvalda, hali boshlamagan</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-3 h-3 rounded-full bg-slate-400 shrink-0" />
                      <span className="text-gray-500">GPS bor, jadvalda yo'q</span>
                    </div>
                  </div>
                  {liveUpdatedAt > 0 && (
                    <p className="text-xs text-gray-400 text-center">
                      Yangilangan: {new Date(liveUpdatedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                    </p>
                  )}
                </>
              ) : (
                <p className="text-xs text-gray-400 text-center py-3">
                  GPS pozitsiyalar yuklanmoqda...
                </p>
              )}
            </div>
          )}

          {/* Nazorat panel */}
          {layerMode === 'nazorat' && (
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide">Nazorat xaritasi</p>
                <button onClick={() => refetchNazorat()} className="p-1 hover:bg-gray-100 rounded" title="Yangilash">
                  <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${nazoratLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
              <input
                type="date"
                value={nazoratDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => setNazoratDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500"
              />
              {nazoratLoading && (
                <p className="text-xs text-gray-400 text-center py-2">Yuklanmoqda...</p>
              )}
              {nazoratTrips && nazoratTrips.length > 0 && (() => {
                const greenThr = thSettings?.coverageGreenPct ?? 70
                const yellowThr = thSettings?.coverageYellowPct ?? 40
                const full = nazoratTrips.filter(t => (t.coveragePct ?? 0) >= greenThr).length
                const partial = nazoratTrips.filter(t => { const p = t.coveragePct ?? 0; return p >= yellowThr && p < greenThr }).length
                const low = nazoratTrips.filter(t => { const p = t.coveragePct ?? 0; return t.status !== 'no_gps' && p < yellowThr }).length
                const noGps = nazoratTrips.filter(t => t.status === 'no_gps').length
                return (
                  <div className="space-y-1.5">
                    <div className="grid grid-cols-2 gap-1 text-xs">
                      <div className="bg-emerald-50 rounded p-2 text-center">
                        <p className="text-emerald-700 font-bold text-base">{full}</p>
                        <p className="text-emerald-600">✅ To'liq</p>
                      </div>
                      <div className="bg-amber-50 rounded p-2 text-center">
                        <p className="text-amber-700 font-bold text-base">{partial}</p>
                        <p className="text-amber-600">⚠️ Qisman</p>
                      </div>
                      <div className="bg-red-50 rounded p-2 text-center">
                        <p className="text-red-700 font-bold text-base">{low}</p>
                        <p className="text-red-600">❌ Borilmadi</p>
                      </div>
                      <div className="bg-gray-50 rounded p-2 text-center">
                        <p className="text-gray-500 font-bold text-base">{noGps}</p>
                        <p className="text-gray-400">GPS yo'q</p>
                      </div>
                    </div>
                  </div>
                )
              })()}
              <button
                onClick={() => nazoratRunMut.mutate(nazoratDate)}
                disabled={nazoratRunMut.isPending}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-rose-600 text-white text-xs rounded-lg hover:bg-rose-700 disabled:opacity-50"
              >
                <Play className={`w-3.5 h-3.5 ${nazoratRunMut.isPending ? 'animate-pulse' : ''}`} />
                {nazoratRunMut.isPending ? 'Tahlil qilinmoqda...' : 'GPS tahlil qilish'}
              </button>

              {nazoratTrips && nazoratTrips.length === 0 && !nazoratLoading && (
                <p className="text-xs text-gray-400 text-center py-2">
                  Hali ma'lumot yo'q — tahlil bosing
                </p>
              )}
            </div>
          )}

          {/* Stats */}
          {layerMode !== 'gps' && layerMode !== 'live' && layerMode !== 'nazorat' && (
            <div className="grid grid-cols-2 gap-1.5 text-xs">
              <div className="bg-emerald-50 rounded-lg p-2 text-center">
                <p className="text-emerald-700 font-bold text-base">{mfysWithPolygon}</p>
                <p className="text-emerald-600">Chizilgan</p>
              </div>
              <div className="bg-amber-50 rounded-lg p-2 text-center">
                <p className="text-amber-700 font-bold text-base">{mfysWithout}</p>
                <p className="text-amber-600">Chizilmagan</p>
              </div>
            </div>
          )}

          {/* GPS avto-import */}
          {layerMode === 'gps' && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-2 gap-1.5 text-xs">
                <div className="bg-indigo-50 rounded-lg p-2 text-center">
                  <p className="text-indigo-700 font-bold text-base">{(geoZones || []).length}</p>
                  <p className="text-indigo-600">GPS geozones</p>
                </div>
                <div className="bg-emerald-50 rounded-lg p-2 text-center">
                  <p className="text-emerald-700 font-bold text-base">{matchedCount}</p>
                  <p className="text-emerald-600">Mos nom</p>
                </div>
              </div>

              {/* GPS geozones → MFY sifatida import */}
              <div className="border border-indigo-200 rounded-lg p-2 space-y-1.5 bg-indigo-50/50">
                <p className="text-xs font-semibold text-indigo-700">GPS → MFY yaratish</p>
                <select
                  value={importDistrictId}
                  onChange={e => setImportDistrictId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-indigo-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500 bg-white"
                >
                  <option value="">Tuman tanlang...</option>
                  {(districts || []).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <button
                  onClick={() => importMfysMut.mutate(importDistrictId)}
                  disabled={!importDistrictId || importMfysMut.isPending || (geoZones || []).length === 0}
                  className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-40"
                >
                  <Download className="w-3.5 h-3.5" />
                  {importMfysMut.isPending ? 'Yaratilmoqda...' : `${(geoZones || []).length} ta MFY import`}
                </button>
              </div>

              {/* SmartGPS dan to'g'ridan-to'g'ri sinxronlash */}
              <button
                onClick={() => syncFromGpsMut.mutate()}
                disabled={syncFromGpsMut.isPending}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700 disabled:opacity-50"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${syncFromGpsMut.isPending ? 'animate-spin' : ''}`} />
                {syncFromGpsMut.isPending ? 'SmartGPS dan yuklanmoqda...' : 'SmartGPS dan sinxronlash'}
              </button>

              {/* KML fayl yuklash (zaxira: agar SmartGPS sync ishlamasa) */}
              <div className="border border-emerald-200 rounded-lg p-2 space-y-1.5 bg-emerald-50/50">
                <p className="text-xs font-semibold text-emerald-700">KML fayl yuklash</p>
                <select
                  value={kmlDistrictId}
                  onChange={e => setKmlDistrictId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-emerald-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
                >
                  <option value="">Barcha tumanlar (nom bo'yicha)</option>
                  {(districts || []).map((d: any) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </select>
                <label className="w-full flex items-center gap-1.5 px-2 py-1.5 border border-dashed border-emerald-300 rounded-lg cursor-pointer hover:bg-emerald-50 text-xs text-emerald-700">
                  <Upload className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">{kmlFile ? kmlFile.name : 'KML fayl tanlang...'}</span>
                  <input
                    type="file"
                    accept=".kml,.kmz"
                    className="hidden"
                    onChange={e => setKmlFile(e.target.files?.[0] || null)}
                  />
                </label>
                <button
                  onClick={() => kmlFile && importKmlMut.mutate({ file: kmlFile, districtId: kmlDistrictId || undefined })}
                  disabled={!kmlFile || importKmlMut.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-2 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-40"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {importKmlMut.isPending ? 'Yuklanmoqda...' : 'MFY chegaralarini yuklash'}
                </button>
              </div>

              {/* Sinxronizatsiyadan keyin moslamagan zonalar */}
              {unmatchedZones.length > 0 && (
                <div className="border border-amber-200 rounded-lg p-2 bg-amber-50/50 space-y-1.5 max-h-72 overflow-hidden flex flex-col">
                  <p className="text-xs font-semibold text-amber-700 shrink-0">
                    Moslamagan zonalar: {unmatchedZones.length}
                  </p>
                  <p className="text-xs text-amber-600 shrink-0">
                    Bu nomlar DB dagi MFY nomlari bilan mos kelmadi. Har biriga MFY ni tanlang ↓
                  </p>
                  <div className="flex-1 overflow-y-auto space-y-1">
                    {unmatchedZones.map(z => (
                      <button
                        key={z.name}
                        onClick={() => { setMapZoneModal(z.name); setMapZoneMfyId('') }}
                        className="w-full text-left px-2 py-1.5 bg-white border border-amber-200 rounded text-xs hover:bg-amber-100"
                      >
                        <p className="font-medium text-gray-800 truncate">{z.name}</p>
                        <p className="text-gray-400">{z.points} nuqta — bosing va MFY tanlang</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Trek paneli */}
          {layerMode === 'track' && (
            <div className="space-y-2 mt-2 pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-sky-700 uppercase tracking-wide">Mashina treki</p>

              {/* Sana oralig'i */}
              <div className="space-y-1">
                <div className="flex items-center gap-1">
                  <div className="flex-1">
                    <p className="text-[10px] text-gray-400 mb-0.5">Dan</p>
                    <input type="date" value={trackDate} max={trackDateTo}
                      onChange={e => { setTrackDate(e.target.value); if (e.target.value > trackDateTo) setTrackDateTo(e.target.value) }}
                      className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                  <span className="text-gray-400 text-xs mt-4">—</span>
                  <div className="flex-1">
                    <p className="text-[10px] text-gray-400 mb-0.5">Gacha</p>
                    <input type="date" value={trackDateTo} min={trackDate} max={new Date().toISOString().split('T')[0]}
                      onChange={e => setTrackDateTo(e.target.value)}
                      className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500" />
                  </div>
                </div>
              </div>

              {/* Vaqt oralig'i */}
              <div className="flex items-center gap-1">
                <input type="time" value={trackTimeFrom} onChange={e => setTrackTimeFrom(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500" />
                <span className="text-gray-400 text-xs">—</span>
                <input type="time" value={trackTimeTo} onChange={e => setTrackTimeTo(e.target.value)}
                  className="flex-1 px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500" />
              </div>

              {/* Mashina qidirish */}
              <div className="relative">
                <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
                <input
                  value={vehicleSearch}
                  onChange={e => { setVehicleSearch(e.target.value); setShowVehicleDropdown(true) }}
                  onFocus={() => setShowVehicleDropdown(true)}
                  onBlur={() => setTimeout(() => setShowVehicleDropdown(false), 150)}
                  placeholder="Mashina qidiring..."
                  className="w-full pl-7 pr-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
                />
                {showVehicleDropdown && filteredVehicles.length > 0 && (
                  <div className="absolute top-full left-0 right-0 bg-white border border-gray-200 rounded-lg shadow-lg z-20 max-h-44 overflow-y-auto">
                    {filteredVehicles.slice(0, 20).map((v: any) => {
                      const isSelected = selectedVehicleIds.includes(v.id)
                      return (
                        <button key={v.id} onMouseDown={() => toggleVehicle(v.id)}
                          className={`w-full text-left px-3 py-2 text-xs hover:bg-sky-50 flex items-center gap-2 ${isSelected ? 'bg-sky-50' : ''}`}>
                          <span className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 ${isSelected ? 'bg-sky-600 border-sky-600 text-white' : 'border-gray-300'}`}>
                            {isSelected && '✓'}
                          </span>
                          <span className="font-mono font-bold text-gray-800">{v.registrationNumber}</span>
                          <span className="text-gray-400 truncate">{v.brand} {v.model}</span>
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Tanlangan mashinalar chips */}
              {selectedVehicleIds.length > 0 && (
                <div className="flex flex-wrap gap-1">
                  {selectedVehicleIds.map((vid, idx) => {
                    const v = (trackVehicles || []).find((x: any) => x.id === vid)
                    const color = TRACK_COLORS[idx % TRACK_COLORS.length]
                    return (
                      <span key={vid} style={{ borderColor: color, backgroundColor: color + '18' }}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-xs font-medium">
                        <span style={{ color }} className="text-[10px]">●</span>
                        <span style={{ color }}>{v?.registrationNumber || vid}</span>
                        <button onClick={() => toggleVehicle(vid)} style={{ color }}
                          className="hover:opacity-70 leading-none ml-0.5">×</button>
                      </span>
                    )
                  })}
                  <button onClick={() => setSelectedVehicleIds([])}
                    className="text-[10px] text-gray-400 hover:text-red-500 px-1 py-0.5">
                    Hammasini o'chirish
                  </button>
                </div>
              )}

              {/* To'xtash nuqtalari */}
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <input type="checkbox" checked={showStops} onChange={e => setShowStops(e.target.checked)}
                  className="w-3.5 h-3.5 accent-sky-600" />
                <span className="text-gray-600">🅿 To'xtash nuqtalari</span>
              </label>

              {anyTrackLoading && (
                <div className="flex items-center gap-2 text-xs text-sky-600 py-1">
                  <RefreshCw className="w-3 h-3 animate-spin" /> Yuklanmoqda...
                </div>
              )}

              {/* Har bir mashina statistikasi */}
              {trackQueries.map((q, idx) => {
                const vid = selectedVehicleIds[idx]
                if (!vid || !q.data) return null
                const color = TRACK_COLORS[idx % TRACK_COLORS.length]
                const regNum = q.data.vehicle?.registrationNumber || vid
                const stops = q.data.points?.length ? detectStops(q.data.points) : []
                return (
                  <div key={vid} style={{ borderColor: color + '60' }} className="border rounded-lg p-2 space-y-1.5 text-xs bg-gray-50/80">
                    <div className="flex items-center justify-between">
                      <span style={{ color }} className="font-bold">● {regNum}</span>
                      {q.data.points?.length > 0 && (
                        <div className="flex gap-1">
                          <button onClick={() => exportGPX(regNum, trackDate, q.data.points)}
                            className="px-1.5 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 text-[10px]" title="GPX yuklash">
                            <Download className="w-3 h-3 inline mr-0.5" />GPX
                          </button>
                          <button onClick={() => exportCSV(regNum, trackDate, q.data.points)}
                            className="px-1.5 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 text-[10px]" title="CSV yuklash">
                            <Download className="w-3 h-3 inline mr-0.5" />CSV
                          </button>
                        </div>
                      )}
                    </div>
                    {q.data.error ? (
                      <p className="text-amber-600">{q.data.error}</p>
                    ) : q.data.stats ? (
                      <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                        <span className="text-gray-500">📍 Masofa</span><span className="font-semibold text-gray-800">{q.data.stats.totalKm} km</span>
                        <span className="text-gray-500">⚡ Maks.</span><span className="font-semibold text-gray-800">{q.data.stats.maxSpeedKmh} km/h</span>
                        <span className="text-gray-500">⏱ Davom.</span><span className="font-semibold text-gray-800">{q.data.stats.durationHours} soat</span>
                        <span className="text-gray-500">🅿 To'xtash</span><span className="font-semibold text-gray-800">{stops.length} ta</span>
                      </div>
                    ) : q.isFetching ? null : <p className="text-gray-400">Ma'lumot yo'q</p>}
                  </div>
                )
              })}

              {/* Ijro (playback) — faqat bitta mashina tanlanganda */}
              {selectedVehicleIds.length === 1 && trackQueries[0]?.data?.points?.length > 0 && (
                <div className="border border-sky-200 rounded-lg p-2 space-y-1.5 bg-sky-50/30">
                  <p className="text-xs font-semibold text-sky-700">Trek ijrosi</p>
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => { if (isPlaying) { setIsPlaying(false) } else { setPlaybackIdx(0); setIsPlaying(true) } }}
                      className="flex items-center gap-1 px-2 py-1.5 bg-sky-600 text-white text-xs rounded-lg hover:bg-sky-700">
                      {isPlaying ? <><Pause className="w-3 h-3" />Pauza</> : <><Play className="w-3 h-3" />Ijro</>}
                    </button>
                    <select value={playbackSpeed} onChange={e => setPlaybackSpeed(Number(e.target.value))}
                      className="text-xs border border-gray-300 rounded px-1.5 py-1">
                      <option value={2}>×2</option>
                      <option value={5}>×5</option>
                      <option value={10}>×10</option>
                      <option value={20}>×20</option>
                    </select>
                  </div>
                  <input type="range" min={0} max={trackQueries[0].data.points.length - 1}
                    value={playbackIdx}
                    onChange={e => { setIsPlaying(false); setPlaybackIdx(Number(e.target.value)) }}
                    className="w-full accent-sky-600" />
                  <p className="text-[10px] text-gray-400 text-center">
                    {playbackIdx + 1} / {trackQueries[0].data.points.length} nuqta
                    {trackQueries[0].data.points[playbackIdx] && (
                      <> · {new Date(trackQueries[0].data.points[playbackIdx].ts * 1000).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}</>
                    )}
                  </p>
                </div>
              )}

              {selectedVehicleIds.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-2">
                  Mashina qidiring va tanlang (maks. 5 ta)
                </p>
              )}
            </div>
          )}
        </div>

        {/* Chizish panel */}
        {drawingFor && (
          <div className="p-3 bg-emerald-50 border-b border-emerald-200">
            <p className="text-xs font-semibold text-emerald-800 mb-1">Chizilmoqda:</p>
            <p className="text-sm font-medium text-emerald-900 mb-2">"{drawingFor.name}"</p>
            <p className="text-xs text-emerald-600 mb-3">Xaritada polygon chizing, so'ng saqlang</p>
            <div className="flex gap-1.5">
              <button onClick={savePolygon} disabled={!pendingGeoJson || saveMfyPolygon.isPending || saveLandfillPolygon.isPending}
                className="flex-1 flex items-center justify-center gap-1 py-1.5 bg-emerald-600 text-white text-xs rounded-lg disabled:opacity-40 hover:bg-emerald-700">
                <Save className="w-3.5 h-3.5" /> Saqlash
              </button>
              <button onClick={cancelDraw} className="p-1.5 text-gray-500 hover:bg-white rounded-lg">
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* Ro'yxat */}
        <div className="flex-1 overflow-y-auto">
          {layerMode === 'mfy' && (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                MFYlar ({(mfys || []).length} ta)
              </div>
              {(mfys || []).map((mfy: any) => (
                <div key={mfy.id}
                  className="flex items-center justify-between px-3 py-2 border-b border-gray-50 hover:bg-gray-50 cursor-pointer group"
                  onClick={() => {
                    if (mfy.polygon && mfyLayersRef.current.has(mfy.id)) {
                      const layer = mfyLayersRef.current.get(mfy.id) as L.GeoJSON
                      mapRef.current?.fitBounds(layer.getBounds(), { padding: [40, 40] })
                    }
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{mfy.name}</p>
                    <p className="text-xs text-gray-400 truncate">{mfy.district?.name}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {mfy.polygon
                      ? <span className="w-2 h-2 rounded-full bg-emerald-500" title="Chizilgan" />
                      : <span className="w-2 h-2 rounded-full bg-amber-400" title="Chizilmagan" />}
                    <button
                      onClick={e => { e.stopPropagation(); startDrawingFor(mfy.id, mfy.name, 'mfy') }}
                      className="p-1 text-emerald-600 hover:bg-emerald-100 rounded text-xs"
                      title="Polygon chizish"
                    >✏️</button>
                  </div>
                </div>
              ))}
              {(mfys || []).length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-gray-400">MFYlar topilmadi</p>
              )}
            </>
          )}

          {layerMode === 'landfill' && (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                Chiqindi poligonlari ({(landfills || []).length} ta)
              </div>
              {(landfills || []).map((lf: any) => (
                <div key={lf.id}
                  className="flex items-center justify-between px-3 py-2 border-b border-gray-50 hover:bg-gray-50 cursor-pointer group"
                  onClick={() => {
                    if (lf.polygon && landfillLayersRef.current.has(lf.id)) {
                      const layer = landfillLayersRef.current.get(lf.id) as L.GeoJSON
                      mapRef.current?.fitBounds(layer.getBounds(), { padding: [40, 40] })
                    }
                  }}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">🗑 {lf.name}</p>
                    {lf.location && <p className="text-xs text-gray-400 truncate">{lf.location}</p>}
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {lf.polygon
                      ? <span className="w-2 h-2 rounded-full bg-red-500" />
                      : <span className="w-2 h-2 rounded-full bg-amber-400" />}
                    <button
                      onClick={e => { e.stopPropagation(); startDrawingFor(lf.id, lf.name, 'landfill') }}
                      className="p-1 text-red-600 hover:bg-red-100 rounded text-xs"
                    >✏️</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {layerMode === 'nazorat' && nazoratTrips && nazoratTrips.length > 0 && (() => {
            const greenThr = thSettings?.coverageGreenPct ?? 70
            const yellowThr = thSettings?.coverageYellowPct ?? 40
            const sorted = [...nazoratTrips].sort((a, b) => (a.coveragePct ?? 0) - (b.coveragePct ?? 0))
            return (
              <>
                <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                  MFYlar ({nazoratTrips.length} ta jadvalda)
                </div>
                {sorted.map(trip => {
                  const pct = trip.coveragePct ?? 0
                  const isGood = pct >= greenThr
                  const isPartial = pct >= yellowThr && pct < greenThr
                  const isBad = !isGood && trip.status !== 'no_gps' && trip.status !== 'no_polygon'
                  const dot = trip.status === 'no_gps' ? 'bg-gray-400'
                    : isGood ? 'bg-emerald-500' : isPartial ? 'bg-amber-500' : 'bg-red-500'
                  const entT = trip.enteredAt
                    ? new Date(trip.enteredAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
                    : null
                  return (
                    <div key={trip.id}
                      className="flex items-center justify-between px-3 py-2 border-b border-gray-50 hover:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        const layer = nazoratLayersRef.current.get(trip.id)
                        if (layer) {
                          try { mapRef.current?.fitBounds((layer as L.GeoJSON).getBounds(), { padding: [40, 40] }) } catch {}
                        }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{trip.mfy?.name}</p>
                        <p className="text-xs text-gray-400 truncate">
                          {trip.status === 'no_gps' ? 'GPS yo\'q'
                            : trip.status === 'no_polygon' ? 'Polygon yo\'q'
                            : `${pct}%${entT ? ` · ${entT}` : ''}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {isBad && trip.vehicleId && (
                          <button
                            onClick={e => {
                              e.stopPropagation()
                              setSelectedVehicleIds([trip.vehicleId])
                              setTrackDate(nazoratDate)
                              setLayerMode('track')
                            }}
                            className="px-1.5 py-0.5 text-[10px] bg-sky-100 text-sky-700 rounded hover:bg-sky-200"
                            title="Bu mashina trekini ko'rsatish"
                          >🛣 Trek</button>
                        )}
                        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                      </div>
                    </div>
                  )
                })}
              </>
            )
          })()}

          {layerMode === 'gps' && (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                GPS Geozones ({(geoZones || []).length} ta)
              </div>
              {gpsLoading && (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-400">
                  <Wifi className="w-3.5 h-3.5 animate-pulse" /> GPS tizimidan yuklanmoqda...
                </div>
              )}
              {!gpsLoading && (geoZones || []).length === 0 && (
                <div className="px-3 py-6 text-center space-y-2">
                  <p className="text-sm text-gray-400">
                    {gpsError ? 'Xato yuz berdi' : 'GPS tizimida geozone topilmadi'}
                  </p>
                  <button
                    onClick={() => refetchZones()}
                    className="flex items-center gap-1.5 mx-auto px-3 py-1.5 bg-indigo-600 text-white text-xs rounded-lg hover:bg-indigo-700"
                  >
                    <RefreshCw className="w-3.5 h-3.5" /> Qayta yuklash
                  </button>
                </div>
              )}
              {(geoZones || []).map((zone: GeoZone) => {
                const matched = mfyNameSet.has(zone.name.trim().toLowerCase())
                return (
                  <div key={zone.id}
                    className="flex items-center justify-between px-3 py-2 border-b border-gray-50 hover:bg-indigo-50/50 cursor-pointer"
                    onClick={() => {
                      // Xaritada ko'rsatish
                      if (gpsLayersRef.current.has(zone.id)) {
                        const layer = gpsLayersRef.current.get(zone.id) as L.Polygon
                        mapRef.current?.fitBounds(layer.getBounds(), { padding: [40, 40] })
                      }
                      setLinkModal({ zone })
                    }}
                  >
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800 truncate">{zone.name}</p>
                      <p className="text-xs">{matched
                        ? <span className="text-emerald-600">✓ MFY nomi mos</span>
                        : <span className="text-gray-400">{zone.points.length} nuqta</span>
                      }</p>
                    </div>
                    <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: zone.color }} />
                  </div>
                )
              })}
            </>
          )}
        </div>

        {/* Izoh */}
        <div className="p-3 border-t border-gray-100 space-y-1">
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-full bg-emerald-500 shrink-0" /> Chizilgan MFY
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-full bg-amber-400 shrink-0" /> Chizilmagan MFY
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" /> Chiqindi poligoni
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-full bg-indigo-500 shrink-0" /> GPS Geozone
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-3 h-3 rounded-full bg-violet-500 shrink-0" /> Konteyner
          </div>
          <div className="flex items-center gap-2 text-xs text-gray-500">
            <span className="w-3 h-1 bg-amber-400 shrink-0 rounded-full" /> Mashina treki
          </div>
        </div>
      </div>

      {/* Xarita */}
      <div className="flex-1 relative">
        <div ref={mapDivRef} className="w-full h-full" />
        {!drawingFor && layerMode !== 'gps' && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow text-xs text-gray-600 flex items-center gap-2 pointer-events-none">
            <Layers className="w-3.5 h-3.5" />
            Ro'yxatdan MFY tanlang yoki ✏️ bosing → polygon chizing
          </div>
        )}
        {layerMode === 'gps' && !gpsLoading && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow text-xs text-gray-600 flex items-center gap-2 pointer-events-none">
            <Wifi className="w-3.5 h-3.5" />
            Geozonani bosib MFY ga biriktirishingiz mumkin
          </div>
        )}
      </div>

      {/* Geozone → MFY biriktirish modali */}
      {linkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <p className="font-semibold text-gray-800">{linkModal.zone.name}</p>
                <p className="text-xs text-gray-400">GPS Geozone → MFY ga biriktirish</p>
              </div>
              <button onClick={() => setLinkModal(null)} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-600">Qaysi MFYga biriktirish kerak?</p>
              <select value={linkMfyId} onChange={e => setLinkMfyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500">
                <option value="">MFY tanlang...</option>
                {(mfys || []).map((m: any) => (
                  <option key={m.id} value={m.id}>{m.name} — {m.district?.name}</option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
              <button onClick={() => setLinkModal(null)}
                className="flex-1 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Bekor
              </button>
              <button
                onClick={() => linkMut.mutate({ mfyId: linkMfyId, points: linkModal.zone.points, zoneName: linkModal.zone.name })}
                disabled={!linkMfyId || linkMut.isPending}
                className="flex-1 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {linkMut.isPending ? 'Saqlanmoqda...' : 'Biriktirish'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Moslamagan GPS zona → MFY ga gpsZoneName moslash modali */}
      {mapZoneModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b">
              <div>
                <p className="font-semibold text-gray-800">{mapZoneModal}</p>
                <p className="text-xs text-gray-400">SmartGPS zona nomi → MFY ga moslash</p>
              </div>
              <button onClick={() => { setMapZoneModal(null); setMapZoneMfyId('') }} className="p-1.5 hover:bg-gray-100 rounded-lg">
                <X className="w-4 h-4 text-gray-500" />
              </button>
            </div>
            <div className="px-5 py-4 space-y-3">
              <p className="text-sm text-gray-600">
                Bu nomdagi GPS zonani DB dagi qaysi MFY ga moslaymiz?
                Keyingi sinxronlashda polygon avtomatik tushadi.
              </p>
              <select value={mapZoneMfyId} onChange={e => setMapZoneMfyId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500">
                <option value="">MFY tanlang...</option>
                {(mfys || []).map((m: any) => (
                  <option key={m.id} value={m.id}>
                    {m.name} — {m.district?.name}{m.gpsZoneName ? ` (GPS: ${m.gpsZoneName})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t bg-gray-50 rounded-b-xl">
              <button onClick={() => { setMapZoneModal(null); setMapZoneMfyId('') }}
                className="flex-1 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                Bekor
              </button>
              <button
                onClick={() => mapZoneMut.mutate({ mfyId: mapZoneMfyId, gpsZoneName: mapZoneModal })}
                disabled={!mapZoneMfyId || mapZoneMut.isPending}
                className="flex-1 py-2 text-sm text-white bg-amber-600 rounded-lg hover:bg-amber-700 disabled:opacity-50">
                {mapZoneMut.isPending ? 'Saqlanmoqda...' : 'Moslash'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
