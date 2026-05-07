import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import toast from 'react-hot-toast'
import { Layers, Save, X, Download, Wifi, RefreshCw, Upload, Play } from 'lucide-react'
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
  const trackLayerRef = useRef<L.Layer | null>(null)
  const trackMarkersRef = useRef<L.Layer[]>([])
  const liveMarkersRef = useRef<L.Layer[]>([])

  const [districtFilter, setDistrictFilter] = useState('')
  const [layerMode, setLayerMode] = useState<LayerMode>('mfy')
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
  const [trackVehicleId, setTrackVehicleId] = useState('')
  const [trackDate, setTrackDate] = useState(() => new Date().toISOString().split('T')[0])
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

  const { data: trackData, isFetching: trackLoading, refetch: refetchTrack } = useQuery({
    queryKey: ['th-track', trackVehicleId, trackDate],
    queryFn: () => api.get('/th/tracks', {
      params: { vehicleId: trackVehicleId, date: trackDate },
    }).then(r => r.data.data),
    enabled: layerMode === 'track' && !!trackVehicleId,
  })
  // Jonli mashina pozitsiyalari — har 30 soniyada yangilanadi
  const { data: livePositions, dataUpdatedAt: liveUpdatedAt } = useQuery({
    queryKey: ['th-live-positions'],
    queryFn: () => api.get('/th/gps/positions').then(r => r.data.data as Array<{
      vehicleId: string; registrationNumber: string; brand: string; model: string
      lat: number; lon: number; speed: number; heading: number; capturedAt: string
    }>),
    enabled: layerMode === 'live',
    refetchInterval: 30_000,
    staleTime: 25_000,
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
    enabled: layerMode === 'gps',
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
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
      maxZoom: 19,
    }).addTo(map)

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

  // GPS Geozone layerlar
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    gpsLayersRef.current.forEach(l => map.removeLayer(l))
    gpsLayersRef.current.clear()

    if (layerMode !== 'gps' || !geoZones) return

    geoZones.forEach((zone: GeoZone) => {
      try {
        const latlngs = zone.points.map(p => [p.lat, p.lon] as [number, number])
        const layer = L.polygon(latlngs, {
          color: zone.color || '#6366f1',
          fillColor: zone.color || '#6366f1',
          fillOpacity: 0.15,
          weight: 2,
          dashArray: '6 4',
        })
        layer.bindTooltip(zone.name, { permanent: false, direction: 'center' })
        layer.on('click', () => setLinkModal({ zone }))
        layer.addTo(map)
        gpsLayersRef.current.set(zone.id, layer)
      } catch {}
    })
  }, [geoZones, layerMode])

  // GPS mode off bo'lsa layerlarni tozalash
  useEffect(() => {
    if (layerMode !== 'gps') {
      const map = mapRef.current
      if (!map) return
      gpsLayersRef.current.forEach(l => map.removeLayer(l))
      gpsLayersRef.current.clear()
    }
  }, [layerMode])

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

  // Trek polyline render
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    // Eski trekni o'chirish
    if (trackLayerRef.current) { map.removeLayer(trackLayerRef.current); trackLayerRef.current = null }
    trackMarkersRef.current.forEach(m => map.removeLayer(m))
    trackMarkersRef.current = []

    if (layerMode !== 'track' || !trackData?.points || trackData.points.length === 0) return

    const latlngs: [number, number][] = trackData.points.map((p: any) => [p.lat, p.lon])

    // Shadow: qalin, qoramtir — trek chizig'i ajralib ko'rinsin
    const shadow = L.polyline(latlngs, { color: '#0f172a', weight: 9, opacity: 0.18 })
    shadow.addTo(map)

    // Asosiy trek chizig'i: to'q sariq-to'q sariq (yo'l rang)
    const polyline = L.polyline(latlngs, { color: '#f59e0b', weight: 5, opacity: 0.95 })
    polyline.addTo(map)
    trackLayerRef.current = polyline

    // Boshlanish nuqtasi (yashil) va tugash nuqtasi (qizil)
    const start = latlngs[0]
    const end = latlngs[latlngs.length - 1]
    const startMarker = L.circleMarker(start, {
      radius: 9, color: '#fff', weight: 3, fillColor: '#10b981', fillOpacity: 1,
    }).bindTooltip('▶ Boshlanish', { permanent: false }).addTo(map)
    const endMarker = L.circleMarker(end, {
      radius: 9, color: '#fff', weight: 3, fillColor: '#ef4444', fillOpacity: 1,
    }).bindTooltip('⏹ Tugash', { permanent: false }).addTo(map)
    trackMarkersRef.current = [shadow as any, startMarker, endMarker]

    // Xaritani trekka moslab markazlash
    map.fitBounds(polyline.getBounds(), { padding: [40, 40] })
  }, [trackData, layerMode])

  // Trek mode off bo'lsa tozalash
  useEffect(() => {
    if (layerMode !== 'track') {
      const map = mapRef.current
      if (!map) return
      if (trackLayerRef.current) { map.removeLayer(trackLayerRef.current); trackLayerRef.current = null }
      trackMarkersRef.current.forEach(m => map.removeLayer(m))
      trackMarkersRef.current = []
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
      const isRecent = minsAgo < 10
      const currentMfy = findMfyForPoint(pos.lat, pos.lon)
      const color = pos.speed > 0 ? '#0ea5e9' : '#94a3b8'
      const icon = L.divIcon({
        html: `<div style="
          width:34px;height:34px;background:${color};border:2.5px solid #fff;
          border-radius:50%;display:flex;align-items:center;justify-content:center;
          font-size:16px;box-shadow:0 2px 8px rgba(0,0,0,.4);
          ${isRecent ? 'animation:live-pulse 2s ease-in-out infinite' : ''}
        ">🚛</div>`,
        className: '',
        iconSize: [34, 34],
        iconAnchor: [17, 17],
      })
      const marker = L.marker([pos.lat, pos.lon], { icon })
      marker.bindTooltip(
        `<b>${pos.registrationNumber}</b><br>${pos.brand} ${pos.model}<br>` +
        (currentMfy ? `📍 <b>${currentMfy}</b><br>` : '') +
        `Tezlik: <b>${pos.speed} km/h</b><br>` +
        `${minsAgo < 1 ? 'Hozir yangilandi' : `${minsAgo} daqiqa oldin`}`,
        { direction: 'top', offset: [0, -17] }
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
                  30s refresh
                </span>
              </div>
              {livePositions && livePositions.length > 0 ? (
                <>
                  <div className="grid grid-cols-2 gap-1.5 text-xs">
                    <div className="bg-orange-50 rounded-lg p-2 text-center">
                      <p className="text-orange-700 font-bold text-base">{livePositions.length}</p>
                      <p className="text-orange-600">GPS li mashina</p>
                    </div>
                    <div className="bg-sky-50 rounded-lg p-2 text-center">
                      <p className="text-sky-700 font-bold text-base">
                        {livePositions.filter(p => p.speed > 0).length}
                      </p>
                      <p className="text-sky-600">Harakatda</p>
                    </div>
                  </div>
                  {liveUpdatedAt > 0 && (
                    <p className="text-xs text-gray-400 text-center">
                      Yangilangan: {new Date(liveUpdatedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
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
              <select
                value={trackVehicleId}
                onChange={e => setTrackVehicleId(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
              >
                <option value="">Mashina tanlang...</option>
                {(trackVehicles || []).map((v: any) => (
                  <option key={v.id} value={v.id}>
                    {v.registrationNumber} — {v.brand} {v.model}
                  </option>
                ))}
              </select>
              <input
                type="date"
                value={trackDate}
                max={new Date().toISOString().split('T')[0]}
                onChange={e => setTrackDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-sky-500"
              />
              <button
                onClick={() => refetchTrack()}
                disabled={!trackVehicleId || trackLoading}
                className="w-full flex items-center justify-center gap-1.5 py-2 bg-sky-600 text-white text-xs rounded-lg hover:bg-sky-700 disabled:opacity-40"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${trackLoading ? 'animate-spin' : ''}`} />
                {trackLoading ? 'Yuklanmoqda...' : 'GPS treki ko\'rsatish'}
              </button>

              {/* Trek statistikasi */}
              {trackData && (
                <div className="bg-sky-50/50 border border-sky-200 rounded-lg p-2 space-y-1.5 text-xs">
                  {trackData.error ? (
                    <p className="text-amber-700">{trackData.error}</p>
                  ) : trackData.stats ? (
                    <>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Masofa:</span>
                        <span className="font-semibold text-gray-800">{trackData.stats.totalKm} km</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Maks. tezlik:</span>
                        <span className="font-semibold text-gray-800">{trackData.stats.maxSpeedKmh} km/h</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Davomiyligi:</span>
                        <span className="font-semibold text-gray-800">{trackData.stats.durationHours} soat</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">GPS nuqtalar:</span>
                        <span className="font-semibold text-gray-800">{trackData.stats.pointCount}</span>
                      </div>
                      <div className="flex items-center gap-2 pt-1 border-t border-sky-100">
                        <span className="w-3 h-3 rounded-full bg-emerald-500 border-2 border-white" />
                        <span className="text-gray-500 text-xs">Boshlanish</span>
                        <span className="w-3 h-3 rounded-full bg-red-500 border-2 border-white ml-auto" />
                        <span className="text-gray-500 text-xs">Tugash</span>
                      </div>
                    </>
                  ) : null}
                </div>
              )}

              {!trackVehicleId && (
                <p className="text-xs text-gray-400 text-center py-2">
                  Mashina tanlang va sanani belgilang
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
                              setTrackVehicleId(trip.vehicleId)
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
