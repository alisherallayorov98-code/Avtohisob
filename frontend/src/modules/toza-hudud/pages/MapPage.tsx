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

type LayerMode = 'mfy' | 'landfill' | 'gps' | 'container' | 'track' | 'live' | 'nazorat' | 'kocha'

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
// Ko'p mashina treki uchun — har biriga indeks bo'yicha alohida rang (palitra aylanadi)
function trackColorByIndex(i: number) {
  return MFY_COLORS[i % MFY_COLORS.length].stroke
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

// ─── Nazorat utilities ───────────────────────────────────────────────────────

interface NazoratTrip {
  id: string; vehicleId: string; mfyId: string; status: string
  coveragePct: number | null; enteredAt: string | null; exitedAt: string | null
  suspicious: boolean; maxSpeedKmh: number | null
  mfy: { id: string; name: string; polygon: any; district: { name: string } | null }
  vehicle: { registrationNumber: string; brand: string; model: string } | null
}

function exportNazoratCSV(date: string, trips: NazoratTrip[]) {
  const rows = [
    'MFY nomi,Tuman,Mashina,Kirdi,Chiqdi,Coverage%,Shubhali',
    ...trips.map(t => [
      t.mfy?.name || '',
      t.mfy?.district?.name || '',
      t.vehicle?.registrationNumber || '',
      t.enteredAt ? new Date(t.enteredAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '',
      t.exitedAt ? new Date(t.exitedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : '',
      t.coveragePct != null ? String(t.coveragePct) : '',
      t.suspicious ? 'Ha' : "Yo'q",
    ].map(v => `"${v}"`).join(','))
  ]
  const a = document.createElement('a')
  a.href = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' }))
  a.download = `nazorat-${date}.csv`; a.click()
}

// ─── Live utilities ───────────────────────────────────────────────────────────

function makeVehicleIcon(liveStatus: string, speed: number, heading: number, isSelected: boolean): L.DivIcon {
  const bgColor = liveStatus === 'active' ? '#059669' : liveStatus === 'scheduled' ? '#d97706' : '#64748b'
  const ringColor = isSelected ? '#3b82f6' : liveStatus === 'active' ? '#6ee7b7' : liveStatus === 'scheduled' ? '#fcd34d' : '#cbd5e1'
  const size = isSelected ? 44 : 36
  const bw = isSelected ? 4 : 3
  const shadow = isSelected ? '0 0 0 3px rgba(59,130,246,.5), 0 2px 8px rgba(0,0,0,.45)' : '0 2px 8px rgba(0,0,0,.35)'
  const arrow = speed > 3
    ? `<div style="position:absolute;top:-9px;left:50%;transform:translateX(-50%) rotate(${heading}deg);font-size:11px;line-height:1;color:${bgColor}">▲</div>`
    : ''
  return L.divIcon({
    html: `<div style="position:relative;width:${size}px;height:${size}px;background:${bgColor};border:${bw}px solid ${ringColor};border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:${isSelected ? 19 : 16}px;box-shadow:${shadow}">${arrow}🚛</div>`,
    className: '',
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
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
  const liveMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const tileLayerRef = useRef<L.TileLayer | null>(null)
  const kochaLayersRef = useRef<L.Layer[]>([])

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
  const [kochaDate, setKochaDate] = useState(() => new Date().toISOString().split('T')[0])
  const [nazoratDetailModal, setNazoratDetailModal] = useState<NazoratTrip | null>(null)
  const [nazoratSearch, setNazoratSearch] = useState('')
  const [nazoratListFilter, setNazoratListFilter] = useState<'all' | 'full' | 'partial' | 'bad' | 'nogps'>('all')
  const [showWeekHistory, setShowWeekHistory] = useState(false)
  // Live state
  const [selectedLiveVehicleId, setSelectedLiveVehicleId] = useState<string | null>(null)
  const [liveFilter, setLiveFilter] = useState<'all' | 'active' | 'scheduled' | 'idle'>('all')
  const [liveSearch, setLiveSearch] = useState('')
  const [refreshInterval, setRefreshInterval] = useState(60)
  const [refreshProgress, setRefreshProgress] = useState(0)
  const [contextPin, setContextPin] = useState<{ vehicleId: string; regNum: string; date?: string } | null>(null)
  const [nazoratMfyFilter, setNazoratMfyFilter] = useState<string | null>(null)

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

  // Jonli mashina pozitsiyalari — har N soniyada yangilanadi
  const { data: livePositions, dataUpdatedAt: liveUpdatedAt, refetch: refetchLivePositions, isFetching: liveLoading } = useQuery({
    queryKey: ['th-live-positions'],
    queryFn: () => api.get('/th/gps/positions').then(r => r.data.data as Array<{
      vehicleId: string; registrationNumber: string; brand: string; model: string
      lat: number; lon: number; speed: number; heading: number; capturedAt: string
      scheduled: boolean; liveStatus: 'active' | 'scheduled' | 'idle'
      coveragePct: number | null; visitedToday: number; totalToday: number
    }>),
    enabled: layerMode === 'live',
    refetchInterval: refreshInterval * 1000,
    staleTime: (refreshInterval - 5) * 1000,
  })

  // Live: ogohlantirishlar (tez yoki uzoq vaqt offline)
  const liveAlerts = useMemo(() => {
    if (!livePositions) return []
    return livePositions.filter(p => {
      if (p.speed > 90) return true
      if (p.liveStatus === 'scheduled') {
        const minsAgo = (Date.now() - new Date(p.capturedAt).getTime()) / 60000
        if (minsAgo > 30) return true
      }
      return false
    })
  }, [livePositions])

  // Live: filter + search
  const filteredLivePositions = useMemo(() => {
    if (!livePositions) return []
    return livePositions.filter(p => {
      if (liveFilter !== 'all' && p.liveStatus !== liveFilter) return false
      if (liveSearch) {
        const q = liveSearch.toLowerCase()
        return p.registrationNumber.toLowerCase().includes(q) || `${p.brand} ${p.model}`.toLowerCase().includes(q)
      }
      return true
    })
  }, [livePositions, liveFilter, liveSearch])

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
    queryFn: () => api.get('/th/trips/service', { params: { date: nazoratDate } }).then(r => r.data.data as NazoratTrip[]),
    enabled: layerMode === 'nazorat',
    staleTime: 60_000,
  })

  // Ko'cha nazorati: tanlangan sana uchun BARCHA mashina treki + ko'cha qamrovi
  const { data: kochaData, isFetching: kochaLoading } = useQuery({
    queryKey: ['th-kocha-day', kochaDate],
    queryFn: () => api.get('/th/coverage/day', { params: { date: kochaDate } }).then(r => r.data.data as {
      date: string
      vehicles: Array<{ vehicleId: string; registrationNumber: string; points: [number, number][] }>
      streets: Array<{ osmWayId: string; mfyId: string; mfyName: string; name: string | null; geometry: [number, number][]; covered: boolean; coverPct: number }>
      summary: { totalStreets: number; coveredStreets: number; coveragePct: number; totalVehicles: number; vehiclesWithGps: number }
    }),
    enabled: layerMode === 'kocha',
    staleTime: 5 * 60_000,
  })

  // 7 kunlik tarix heatmap uchun
  const weekDates = useMemo(() => {
    const dates: string[] = []
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i)
      dates.push(d.toISOString().split('T')[0])
    }
    return dates
  }, [])

  const weekHistoryQueries = useQueries({
    queries: weekDates.map(d => ({
      queryKey: ['th-nazorat-trips', d],
      queryFn: () => api.get('/th/trips/service', { params: { date: d } }).then(r => r.data.data as NazoratTrip[]),
      enabled: layerMode === 'nazorat' && showWeekHistory,
      staleTime: 5 * 60_000,
    })),
  })

  // Nazorat sozlamalari (yashil/sariq chegaralar)
  const { data: thSettings } = useQuery({
    queryKey: ['th-settings'],
    queryFn: () => api.get('/th/settings').then(r => r.data.data),
    staleTime: 5 * 60_000,
  })

  // Nazorat: mashina reytingi
  const vehicleRatings = useMemo(() => {
    if (!nazoratTrips) return []
    const map = new Map<string, { vehicleId: string; regNum: string; total: number; totalCoverage: number; count: number; suspicious: number }>()
    for (const trip of nazoratTrips) {
      if (!trip.vehicleId || !trip.vehicle) continue
      const e = map.get(trip.vehicleId) || { vehicleId: trip.vehicleId, regNum: trip.vehicle.registrationNumber, total: 0, totalCoverage: 0, count: 0, suspicious: 0 }
      e.total++
      if (trip.coveragePct != null && trip.coveragePct > 0) { e.count++; e.totalCoverage += trip.coveragePct }
      if (trip.suspicious) e.suspicious++
      map.set(trip.vehicleId, e)
    }
    return [...map.values()].sort((a, b) => (b.count ? b.totalCoverage / b.count : 0) - (a.count ? a.totalCoverage / a.count : 0))
  }, [nazoratTrips])

  // Nazorat: qidirish + filter
  const filteredNazoratTrips = useMemo(() => {
    if (!nazoratTrips) return []
    const greenThr = thSettings?.coverageGreenPct ?? 70
    const yellowThr = thSettings?.coverageYellowPct ?? 40
    return nazoratTrips.filter(t => {
      if (nazoratMfyFilter && t.mfyId !== nazoratMfyFilter) return false
      if (nazoratSearch && !t.mfy?.name.toLowerCase().includes(nazoratSearch.toLowerCase())) return false
      if (nazoratListFilter === 'full') return (t.coveragePct ?? 0) >= greenThr
      if (nazoratListFilter === 'partial') { const p = t.coveragePct ?? 0; return p >= yellowThr && p < greenThr }
      if (nazoratListFilter === 'bad') return t.status !== 'no_gps' && t.status !== 'no_polygon' && (t.coveragePct ?? 0) < yellowThr
      if (nazoratListFilter === 'nogps') return t.status === 'no_gps'
      return true
    }).sort((a, b) => (a.coveragePct ?? 0) - (b.coveragePct ?? 0))
  }, [nazoratTrips, nazoratSearch, nazoratListFilter, thSettings, nazoratMfyFilter])

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

    // Nazorat, GPS va Ko'cha: o'z layerlari bor — MFY layer shart emas
    if (layerMode === 'nazorat' || layerMode === 'gps' || layerMode === 'kocha') return

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
        layer.on('click', () => setNazoratDetailModal(trip))
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

  // Ko'cha nazorati layeri: ko'chalar (qoplangan=yashil, olinmagan=qizil) + barcha mashina treki
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    kochaLayersRef.current.forEach(l => { try { map.removeLayer(l) } catch {} })
    kochaLayersRef.current = []

    if (layerMode !== 'kocha' || !kochaData) return

    const bounds: L.LatLngBounds[] = []

    // 1) Ko'chalar — avval qoplangani (orqa fon), keyin olinmagani (ustida, qizil ajralib tursin)
    const drawStreet = (st: any) => {
      if (!st.geometry || st.geometry.length < 2) return
      const line = L.polyline(st.geometry as [number, number][], st.covered
        ? { color: '#16a34a', weight: 2, opacity: 0.45 }
        : { color: '#dc2626', weight: 4, opacity: 0.95 })
      line.bindTooltip(
        `<b>${st.name || "Noma'lum ko'cha"}</b><br>${st.mfyName}<br>` +
        (st.covered ? `✅ olingan (${st.coverPct}%)` : `❌ olinmagan (${st.coverPct}%)`),
        { sticky: true })
      line.addTo(map)
      kochaLayersRef.current.push(line)
    }
    for (const st of kochaData.streets) if (st.covered) drawStreet(st)
    for (const st of kochaData.streets) if (!st.covered) drawStreet(st)

    // 2) Mashina treklari — har biri alohida rangda
    kochaData.vehicles.forEach((v, idx) => {
      if (!v.points || v.points.length < 2) return
      const color = trackColorByIndex(idx)
      const poly = L.polyline(v.points, { color, weight: 2.5, opacity: 0.7 })
      poly.bindTooltip(`🚛 ${v.registrationNumber}`, { sticky: true })
      poly.addTo(map)
      kochaLayersRef.current.push(poly)
      try { bounds.push(poly.getBounds()) } catch {}
    })

    if (bounds.length > 0) {
      try { map.fitBounds(bounds.reduce((a, b) => a.extend(b)), { padding: [40, 40], maxZoom: 15 }) } catch {}
    }
  }, [kochaData, layerMode])

  // Jonli mashina markerlarini render qilish
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    // Barcha eski markerlarni tozalash
    liveMarkersRef.current.forEach(m => { try { map.removeLayer(m) } catch {} })
    liveMarkersRef.current.clear()

    if (layerMode !== 'live' || !livePositions || livePositions.length === 0) return

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

    const isFirstRender = liveMarkersRef.current.size === 0
    const bounds: L.LatLng[] = []

    for (const pos of livePositions) {
      const minsAgo = Math.round((Date.now() - new Date(pos.capturedAt).getTime()) / 60000)
      const currentMfy = findMfyForPoint(pos.lat, pos.lon)
      const isSelected = pos.vehicleId === selectedLiveVehicleId

      const icon = makeVehicleIcon(pos.liveStatus, pos.speed, pos.heading, isSelected)

      const statusLabel =
        pos.liveStatus === 'active' ? `✅ Faol (${pos.visitedToday}/${pos.totalToday} MFY)` :
        pos.liveStatus === 'scheduled' ? '⏳ Jadvalda — hali boshlamagan' : '⬜ Jadvalda emas'
      const pctStr = pos.coveragePct != null ? ` · ${pos.coveragePct}% qamrov` : ''

      const marker = L.marker([pos.lat, pos.lon], { icon, zIndexOffset: isSelected ? 1000 : 0 })
      marker.bindTooltip(
        `<b>${pos.registrationNumber}</b><br>${pos.brand} ${pos.model}<br>` +
        `${statusLabel}${pctStr}<br>` +
        (currentMfy ? `📍 <b>${currentMfy}</b><br>` : '') +
        `Tezlik: <b>${pos.speed} km/h</b><br>` +
        `${minsAgo < 1 ? 'Hozir yangilandi' : `${minsAgo} daqiqa oldin`}`,
        { direction: 'top', offset: [0, -22] }
      )
      marker.on('click', () => setSelectedLiveVehicleId(id => id === pos.vehicleId ? null : pos.vehicleId))
      marker.addTo(map)
      liveMarkersRef.current.set(pos.vehicleId, marker)
      bounds.push(L.latLng(pos.lat, pos.lon))
    }

    if (isFirstRender && bounds.length > 0) {
      try { map.fitBounds(L.latLngBounds(bounds), { padding: [60, 60], maxZoom: 14 }) } catch {}
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livePositions, layerMode, mfys])

  // Live: tanlangan mashina ikonini ko'k halqa bilan ajratib ko'rsatish
  useEffect(() => {
    liveMarkersRef.current.forEach((marker, vid) => {
      const pos = livePositions?.find(p => p.vehicleId === vid)
      if (!pos) return
      const isSelected = vid === selectedLiveVehicleId
      marker.setIcon(makeVehicleIcon(pos.liveStatus, pos.speed, pos.heading, isSelected))
      marker.setZIndexOffset(isSelected ? 1000 : 0)
      if (isSelected) mapRef.current?.panTo(marker.getLatLng(), { animate: true })
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedLiveVehicleId])

  // Live mode off bo'lsa markerlarni tozalash
  useEffect(() => {
    if (layerMode !== 'live') {
      const map = mapRef.current
      if (!map) return
      liveMarkersRef.current.forEach(m => { try { map.removeLayer(m) } catch {} })
      liveMarkersRef.current.clear()
      setSelectedLiveVehicleId(null)
    }
  }, [layerMode])

  // Refresh progress bar: har soniyada yangilanadi
  useEffect(() => {
    if (layerMode !== 'live') return
    setRefreshProgress(0)
    const start = Date.now()
    const t = setInterval(() => {
      const elapsed = (Date.now() - start) / 1000
      const pct = Math.min(100, (elapsed / refreshInterval) * 100)
      setRefreshProgress(pct)
      if (elapsed >= refreshInterval) { clearInterval(t); setRefreshProgress(0) }
    }, 500)
    return () => clearInterval(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveUpdatedAt, refreshInterval, layerMode])

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

  function goToTrek(vehicleId: string, regNum: string, date?: string) {
    setSelectedVehicleIds([vehicleId])
    if (date) setTrackDate(date)
    setContextPin({ vehicleId, regNum, date })
    setLayerMode('track')
    setNazoratDetailModal(null)
  }

  function goToNazorat(date: string, mfyId?: string | null, regNum?: string | null) {
    setNazoratDate(date)
    setNazoratMfyFilter(mfyId ?? null)
    setNazoratSearch(regNum ?? '')
    setLayerMode('nazorat')
    setNazoratDetailModal(null)
  }

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
            <button onClick={() => setLayerMode('kocha')}
              className={`col-span-2 py-1.5 text-xs rounded-lg font-medium transition-colors flex items-center justify-center gap-1.5 ${layerMode === 'kocha' ? 'bg-rose-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              🧹 Ko'cha nazorati
            </button>
          </div>

          {/* Kontekst pini — istalgan bo'limda ko'rinadi */}
          {contextPin && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-2 space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-bold text-amber-700 uppercase tracking-wide">📌 Tanlangan</span>
                <button onClick={() => setContextPin(null)} className="p-0.5 hover:bg-amber-100 rounded text-amber-500 text-xs leading-none">✕</button>
              </div>
              <p className="font-mono text-sm font-bold text-gray-900">{contextPin.regNum}</p>
              {contextPin.date && <p className="text-[10px] text-gray-400">{contextPin.date}</p>}
              <div className="flex gap-1">
                <button
                  onClick={() => { setSelectedVehicleIds([contextPin.vehicleId]); if (contextPin.date) setTrackDate(contextPin.date); setLayerMode('track') }}
                  className="flex-1 py-1 text-[10px] bg-sky-100 text-sky-700 rounded font-medium hover:bg-sky-200">
                  🛣 Trek
                </button>
                <button
                  onClick={() => { setSelectedLiveVehicleId(contextPin.vehicleId); setLayerMode('live') }}
                  className="flex-1 py-1 text-[10px] bg-orange-100 text-orange-700 rounded font-medium hover:bg-orange-200">
                  🔴 Jonli
                </button>
                <button
                  onClick={() => goToNazorat(contextPin.date ?? new Date().toISOString().split('T')[0], null, contextPin.regNum)}
                  className="flex-1 py-1 text-[10px] bg-rose-100 text-rose-700 rounded font-medium hover:bg-rose-200">
                  📊 Nazorat
                </button>
              </div>
            </div>
          )}

          {/* Jonli panel */}
          {layerMode === 'live' && (
            <div className="space-y-2 pt-1">
              {/* Sarlavha + yangilash */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-orange-600 uppercase tracking-wide flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
                  Jonli kuzatuv
                </p>
                <button onClick={() => { setRefreshProgress(0); refetchLivePositions() }}
                  disabled={liveLoading}
                  className="p-1 hover:bg-gray-100 rounded" title="Hozir yangilash">
                  <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${liveLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>

              {/* Refresh progress bar */}
              <div className="w-full h-1 bg-gray-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-orange-400 transition-all duration-500"
                  style={{ width: `${refreshProgress}%` }}
                />
              </div>

              {/* Refresh interval tanlash */}
              <div className="flex items-center gap-2 text-xs">
                <span className="text-gray-400 shrink-0">Refresh:</span>
                <select
                  value={refreshInterval}
                  onChange={e => setRefreshInterval(Number(e.target.value))}
                  className="flex-1 px-1.5 py-1 text-xs border border-gray-300 rounded focus:outline-none focus:ring-1 focus:ring-orange-400"
                >
                  <option value={30}>30 soniya</option>
                  <option value={60}>1 daqiqa</option>
                  <option value={120}>2 daqiqa</option>
                  <option value={300}>5 daqiqa</option>
                </select>
                {liveUpdatedAt > 0 && (
                  <span className="text-gray-400 shrink-0">
                    {new Date(liveUpdatedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
              </div>

              {/* Ogohlantirishlar */}
              {liveAlerts.length > 0 && (
                <div className="bg-red-50 border border-red-200 rounded-lg p-2 space-y-1">
                  <p className="text-[10px] font-bold text-red-700 uppercase tracking-wide">⚠️ Ogohlantirishlar</p>
                  {liveAlerts.map(p => (
                    <button key={p.vehicleId}
                      onClick={() => setSelectedLiveVehicleId(p.vehicleId)}
                      className="w-full text-left text-xs text-red-700 hover:text-red-900">
                      <span className="font-mono font-bold">{p.registrationNumber}</span>
                      {p.speed > 90 && <span className="ml-1">· {p.speed} km/h!</span>}
                      {p.liveStatus === 'scheduled' && (() => {
                        const m = Math.round((Date.now() - new Date(p.capturedAt).getTime()) / 60000)
                        return m > 30 ? <span className="ml-1">· {m} daq offline</span> : null
                      })()}
                    </button>
                  ))}
                </div>
              )}

              {livePositions && livePositions.length > 0 ? (
                <>
                  {/* Holat bo'yicha statistika */}
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
                      <p className="text-gray-400 leading-tight">⬜ Yo'q</p>
                    </div>
                  </div>

                  {/* Status filtr chiplar */}
                  <div className="flex gap-1 flex-wrap">
                    {(['all', 'active', 'scheduled', 'idle'] as const).map(f => (
                      <button key={f}
                        onClick={() => setLiveFilter(f)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${liveFilter === f
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-white text-gray-500 border-gray-200 hover:border-orange-300'}`}>
                        {f === 'all' ? 'Hammasi' : f === 'active' ? '🟢 Faol' : f === 'scheduled' ? '🟡 Jadvalda' : '⬜ Yo\'q'}
                      </button>
                    ))}
                  </div>

                  {/* Mashina qidirish */}
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <input
                      value={liveSearch}
                      onChange={e => setLiveSearch(e.target.value)}
                      placeholder="Mashina qidiring..."
                      className="w-full pl-6 pr-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-orange-400"
                    />
                  </div>
                </>
              ) : (
                <p className="text-xs text-gray-400 text-center py-3">
                  {liveLoading ? 'GPS pozitsiyalar yuklanmoqda...' : 'GPS pozitsiyalar topilmadi'}
                </p>
              )}
            </div>
          )}

          {/* Nazorat panel */}
          {layerMode === 'nazorat' && (() => {
            const today = new Date().toISOString().split('T')[0]
            const greenThr = thSettings?.coverageGreenPct ?? 70
            const yellowThr = thSettings?.coverageYellowPct ?? 40
            return (
            <div className="space-y-2 pt-1">
              {/* Sarlavha */}
              <div className="flex items-center justify-between">
                <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide">Nazorat xaritasi</p>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setShowWeekHistory(v => !v)}
                    className={`px-2 py-0.5 text-[10px] rounded font-medium transition-colors ${showWeekHistory ? 'bg-rose-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-rose-100 hover:text-rose-700'}`}
                    title="7 kunlik tarix">
                    📅 Tarix
                  </button>
                  <button onClick={() => refetchNazorat()} className="p-1 hover:bg-gray-100 rounded" title="Yangilash">
                    <RefreshCw className={`w-3.5 h-3.5 text-gray-400 ${nazoratLoading ? 'animate-spin' : ''}`} />
                  </button>
                </div>
              </div>

              {/* Sana */}
              <input type="date" value={nazoratDate} max={today}
                onChange={e => setNazoratDate(e.target.value)}
                className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500" />

              {/* 7 kunlik heatmap */}
              {showWeekHistory && (
                <div className="space-y-1">
                  <p className="text-[10px] text-gray-400 uppercase tracking-wide">Oxirgi 7 kun</p>
                  <div className="flex gap-1">
                    {weekDates.map((d, i) => {
                      const q = weekHistoryQueries[i]
                      const trips = q.data as NazoratTrip[] | undefined
                      let bg = 'bg-gray-200'
                      let pctAvg = 0
                      if (q.isFetching) { bg = 'bg-gray-300 animate-pulse' }
                      else if (trips && trips.length > 0) {
                        const w = trips.filter(t => t.coveragePct != null && t.status !== 'no_gps')
                        pctAvg = w.length ? Math.round(w.reduce((s, t) => s + (t.coveragePct ?? 0), 0) / w.length) : 0
                        bg = pctAvg >= greenThr ? 'bg-emerald-400' : pctAvg >= yellowThr ? 'bg-amber-400' : 'bg-red-400'
                      }
                      const dayLabel = new Date(d).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' })
                      return (
                        <button key={d} onClick={() => setNazoratDate(d)}
                          className={`flex-1 h-7 rounded transition-opacity hover:opacity-75 ${bg} ${nazoratDate === d ? 'ring-2 ring-rose-500' : ''}`}
                          title={`${dayLabel}${trips?.length ? ` — ${pctAvg}% o'rtacha` : ''}`} />
                      )
                    })}
                  </div>
                  <div className="flex justify-between text-[9px] text-gray-400">
                    <span>{new Date(weekDates[0]).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit' })}</span>
                    <span>Bugun</span>
                  </div>
                </div>
              )}

              {nazoratLoading && <p className="text-xs text-gray-400 text-center py-2">Yuklanmoqda...</p>}

              {/* Auto-tahlil eslatmasi */}
              {nazoratDate === today && nazoratTrips && nazoratTrips.length === 0 && !nazoratLoading && (
                <div className="bg-rose-50 border border-rose-200 rounded-lg p-2 space-y-1.5">
                  <p className="text-xs text-rose-700 font-medium">⚠️ Bugun hali tahlil qilinmagan</p>
                  <button onClick={() => nazoratRunMut.mutate(nazoratDate)} disabled={nazoratRunMut.isPending}
                    className="w-full flex items-center justify-center gap-1 py-1.5 bg-rose-600 text-white text-xs rounded-lg hover:bg-rose-700 disabled:opacity-50">
                    <Play className="w-3 h-3" /> Tahlil boshlash
                  </button>
                </div>
              )}

              {/* Statistika — clickable filter */}
              {nazoratTrips && nazoratTrips.length > 0 && (() => {
                const full = nazoratTrips.filter(t => (t.coveragePct ?? 0) >= greenThr).length
                const partial = nazoratTrips.filter(t => { const p = t.coveragePct ?? 0; return p >= yellowThr && p < greenThr }).length
                const low = nazoratTrips.filter(t => t.status !== 'no_gps' && t.status !== 'no_polygon' && (t.coveragePct ?? 0) < yellowThr).length
                const noGps = nazoratTrips.filter(t => t.status === 'no_gps').length
                return (
                  <div className="grid grid-cols-2 gap-1 text-xs">
                    {[
                      { key: 'full', label: "✅ To'liq", count: full, bg: 'bg-emerald-50', text: 'text-emerald-700', sub: 'text-emerald-600' },
                      { key: 'partial', label: '⚠️ Qisman', count: partial, bg: 'bg-amber-50', text: 'text-amber-700', sub: 'text-amber-600' },
                      { key: 'bad', label: '❌ Borilmadi', count: low, bg: 'bg-red-50', text: 'text-red-700', sub: 'text-red-600' },
                      { key: 'nogps', label: "GPS yo'q", count: noGps, bg: 'bg-gray-50', text: 'text-gray-500', sub: 'text-gray-400' },
                    ].map(item => (
                      <div key={item.key}
                        onClick={() => setNazoratListFilter(f => f === item.key as any ? 'all' : item.key as any)}
                        className={`${item.bg} rounded p-2 text-center cursor-pointer hover:opacity-80 transition-opacity ${nazoratListFilter === item.key ? 'ring-2 ring-rose-400' : ''}`}>
                        <p className={`${item.text} font-bold text-base`}>{item.count}</p>
                        <p className={item.sub}>{item.label}</p>
                      </div>
                    ))}
                  </div>
                )
              })()}

              {/* Tahlil + Export */}
              <div className="flex gap-1.5">
                <button onClick={() => nazoratRunMut.mutate(nazoratDate)} disabled={nazoratRunMut.isPending}
                  className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-rose-600 text-white text-xs rounded-lg hover:bg-rose-700 disabled:opacity-50">
                  <Play className={`w-3.5 h-3.5 ${nazoratRunMut.isPending ? 'animate-pulse' : ''}`} />
                  {nazoratRunMut.isPending ? 'Tahlil...' : 'GPS tahlil'}
                </button>
                {nazoratTrips && nazoratTrips.length > 0 && (
                  <button onClick={() => exportNazoratCSV(nazoratDate, nazoratTrips)}
                    className="flex items-center justify-center gap-1 px-3 py-2 bg-gray-100 text-gray-700 text-xs rounded-lg hover:bg-gray-200"
                    title="CSV hisobot yuklash">
                    <Download className="w-3.5 h-3.5" /> CSV
                  </button>
                )}
              </div>

              {/* Mashina reytingi */}
              {vehicleRatings.length > 0 && (
                <div className="border border-rose-100 rounded-lg overflow-hidden">
                  <p className="px-2 py-1.5 text-[10px] font-bold text-rose-700 uppercase tracking-wide bg-rose-50 border-b border-rose-100">
                    Mashina reytingi
                  </p>
                  {vehicleRatings.slice(0, 5).map((v, i) => {
                    const avgPct = v.count ? Math.round(v.totalCoverage / v.count) : 0
                    const color = avgPct >= greenThr ? 'text-emerald-600' : avgPct >= yellowThr ? 'text-amber-600' : 'text-red-600'
                    return (
                      <div key={v.vehicleId}
                        className="flex items-center gap-2 px-2 py-1.5 border-t border-rose-50 hover:bg-rose-50/50 cursor-pointer"
                        onClick={() => goToTrek(v.vehicleId, v.regNum, nazoratDate)}>
                        <span className={`text-[10px] font-bold w-4 text-center ${i === 0 ? 'text-amber-500' : 'text-gray-400'}`}>{i + 1}</span>
                        <span className="font-mono text-xs font-bold text-gray-800 truncate flex-1">{v.regNum}</span>
                        <span className={`text-xs font-semibold ${color}`}>{avgPct}%</span>
                        {v.suspicious > 0 && <span className="text-[10px] text-red-500" title="Shubhali tashriflar">⚡{v.suspicious}</span>}
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
            )
          })()}

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
          {layerMode === 'kocha' && (
            <div className="space-y-2 mt-2 pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-rose-700 uppercase tracking-wide">🧹 Ko'cha nazorati</p>

              <div>
                <p className="text-[10px] text-gray-400 mb-0.5">Sana (istalgan o'tgan kun)</p>
                <input type="date" value={kochaDate} max={new Date().toISOString().split('T')[0]}
                  onChange={e => setKochaDate(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500" />
              </div>

              {kochaLoading && (
                <div className="flex items-center gap-2 text-xs text-rose-600 py-1">
                  <RefreshCw className="w-3 h-3 animate-spin" />
                  <span>Barcha mashina treki yuklanmoqda... (biroz vaqt olishi mumkin)</span>
                </div>
              )}

              {kochaData && !kochaLoading && (() => {
                const uncovered = kochaData.streets.filter(x => !x.covered)
                return (
                  <>
                    <div className="grid grid-cols-2 gap-1 text-center">
                      <div className="bg-emerald-50 rounded-lg py-1.5">
                        <p className="text-base font-bold text-emerald-700">{kochaData.summary.coveragePct}%</p>
                        <p className="text-[10px] text-gray-500">Qoplandi</p>
                      </div>
                      <div className="bg-rose-50 rounded-lg py-1.5">
                        <p className="text-base font-bold text-rose-700">{uncovered.length}</p>
                        <p className="text-[10px] text-gray-500">Olinmagan ko'cha</p>
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400">
                      {kochaData.summary.coveredStreets}/{kochaData.summary.totalStreets} ko'cha · {kochaData.summary.vehiclesWithGps}/{kochaData.summary.totalVehicles} mashinada GPS bor
                    </p>
                    <div className="flex items-center gap-3 text-[10px] text-gray-500">
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-1 rounded bg-red-600" />olinmagan</span>
                      <span className="inline-flex items-center gap-1"><span className="inline-block w-4 h-0.5 rounded bg-green-600" />olingan</span>
                    </div>

                    {uncovered.length > 0 ? (
                      <div className="border border-rose-100 rounded-lg divide-y divide-rose-50 max-h-72 overflow-y-auto">
                        {uncovered.slice(0, 300).map(st => (
                          <button key={st.osmWayId + st.mfyId}
                            onClick={() => {
                              const m = mapRef.current
                              if (m && st.geometry?.length) {
                                try { m.fitBounds(L.polyline(st.geometry).getBounds(), { maxZoom: 17, padding: [60, 60] }) } catch {}
                              }
                            }}
                            className="w-full text-left px-2 py-1.5 hover:bg-rose-50 transition-colors">
                            <span className="text-xs font-medium text-gray-800">{st.name || "Noma'lum ko'cha"}</span>
                            <span className="block text-[10px] text-gray-400">{st.mfyName} · {st.coverPct}%</span>
                          </button>
                        ))}
                        {uncovered.length > 300 && (
                          <p className="px-2 py-1.5 text-[10px] text-gray-400">...va yana {uncovered.length - 300} ta</p>
                        )}
                      </div>
                    ) : (
                      <p className="text-[11px] text-emerald-600 bg-emerald-50 rounded-lg p-2">✅ Barcha ko'chalar qoplangan!</p>
                    )}
                  </>
                )
              })()}

              {kochaData && !kochaLoading && kochaData.streets.length === 0 && (
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded-lg p-2">
                  Ko'cha ma'lumoti yo'q. MFY'larga OSM ko'chalari yuklanmagan bo'lishi mumkin — "AI Tahlil" bo'limidan ko'chalarni yuklang.
                </p>
              )}
            </div>
          )}

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
                      <div className="flex gap-1">
                        <button
                          onClick={() => { setSelectedLiveVehicleId(vid); setLayerMode('live') }}
                          className="px-1.5 py-0.5 rounded bg-orange-100 hover:bg-orange-200 text-orange-700 text-[10px]"
                          title="Jonli kuzatish">
                          🔴 Jonli
                        </button>
                        <button
                          onClick={() => goToNazorat(trackDate, null, regNum)}
                          className="px-1.5 py-0.5 rounded bg-rose-100 hover:bg-rose-200 text-rose-700 text-[10px]"
                          title="Nazorat ma'lumotlari">
                          📊 Nazorat
                        </button>
                        {q.data.points?.length > 0 && (
                          <>
                            <button onClick={() => exportGPX(regNum, trackDate, q.data.points)}
                              className="px-1.5 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 text-[10px]" title="GPX yuklash">
                              <Download className="w-3 h-3 inline mr-0.5" />GPX
                            </button>
                            <button onClick={() => exportCSV(regNum, trackDate, q.data.points)}
                              className="px-1.5 py-0.5 rounded bg-gray-200 hover:bg-gray-300 text-gray-700 text-[10px]" title="CSV yuklash">
                              <Download className="w-3 h-3 inline mr-0.5" />CSV
                            </button>
                          </>
                        )}
                      </div>
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
                      onClick={e => { e.stopPropagation(); goToNazorat(new Date().toISOString().split('T')[0], mfy.id) }}
                      className="p-1 text-rose-600 hover:bg-rose-100 rounded text-xs"
                      title="Nazorat ko'rish">📊</button>
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
            return (
              <>
                {/* Qidirish + filter chiplar */}
                <div className="px-3 pt-2 pb-1.5 sticky top-0 bg-white border-b border-gray-100 z-10 space-y-1.5">
                  <div className="relative">
                    <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-400" />
                    <input value={nazoratSearch} onChange={e => setNazoratSearch(e.target.value)}
                      placeholder="MFY qidiring..."
                      className="w-full pl-6 pr-2 py-1.5 text-xs border border-gray-300 rounded-lg focus:outline-none focus:ring-1 focus:ring-rose-500" />
                  </div>
                  <div className="flex gap-1 flex-wrap">
                    {([
                      { key: 'all', label: 'Hammasi' },
                      { key: 'full', label: "✅ To'liq" },
                      { key: 'partial', label: '⚠️ Qisman' },
                      { key: 'bad', label: '❌ Kam' },
                      { key: 'nogps', label: "GPS yo'q" },
                    ] as const).map(f => (
                      <button key={f.key} onClick={() => setNazoratListFilter(f.key)}
                        className={`px-2 py-0.5 rounded-full text-[10px] font-medium border transition-colors ${nazoratListFilter === f.key ? 'bg-rose-600 text-white border-rose-600' : 'bg-white text-gray-500 border-gray-200 hover:border-rose-300'}`}>
                        {f.label}
                      </button>
                    ))}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] text-gray-400">
                      {filteredNazoratTrips.length}/{nazoratTrips.length} ta MFY
                    </p>
                    {nazoratMfyFilter && (
                      <button onClick={() => setNazoratMfyFilter(null)}
                        className="text-[10px] text-rose-600 bg-rose-50 px-1.5 py-0.5 rounded flex items-center gap-0.5 hover:bg-rose-100">
                        📌 MFY filtr ✕
                      </button>
                    )}
                  </div>
                </div>

                {filteredNazoratTrips.map(trip => {
                  const pct = trip.coveragePct ?? 0
                  const isGood = pct >= greenThr
                  const isPartial = pct >= yellowThr && pct < greenThr
                  const dot = trip.status === 'no_gps' ? 'bg-gray-400'
                    : isGood ? 'bg-emerald-500' : isPartial ? 'bg-amber-500' : 'bg-red-500'
                  const entT = trip.enteredAt
                    ? new Date(trip.enteredAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
                    : null
                  return (
                    <div key={trip.id}
                      className="flex items-center justify-between px-3 py-2 border-b border-gray-50 hover:bg-rose-50/30 cursor-pointer"
                      onClick={() => {
                        setNazoratDetailModal(trip)
                        const layer = nazoratLayersRef.current.get(trip.id)
                        if (layer) { try { mapRef.current?.fitBounds((layer as L.GeoJSON).getBounds(), { padding: [40, 40] }) } catch {} }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-800 truncate">{trip.mfy?.name}</p>
                        <p className="text-xs text-gray-400 truncate">
                          {trip.status === 'no_gps' ? "GPS yo'q"
                            : trip.status === 'no_polygon' ? "Polygon yo'q"
                            : `${pct}%${entT ? ` · ${entT}` : ''}`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {trip.vehicleId && (
                          <>
                            <button onClick={e => { e.stopPropagation(); setSelectedVehicleIds([trip.vehicleId]); setTrackDate(nazoratDate); setLayerMode('track') }}
                              className="px-1.5 py-0.5 text-[10px] bg-sky-100 text-sky-700 rounded hover:bg-sky-200" title="Trek">🛣</button>
                            <button onClick={e => { e.stopPropagation(); setSelectedLiveVehicleId(trip.vehicleId); setLayerMode('live') }}
                              className="px-1.5 py-0.5 text-[10px] bg-orange-100 text-orange-700 rounded hover:bg-orange-200" title="Jonli">🔴</button>
                          </>
                        )}
                        <span className={`w-2.5 h-2.5 rounded-full ${dot}`} />
                      </div>
                    </div>
                  )
                })}
              </>
            )
          })()}

          {layerMode === 'live' && filteredLivePositions.length > 0 && (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                Mashinalar ({filteredLivePositions.length} ta)
              </div>
              {filteredLivePositions.map(pos => {
                const isSelected = pos.vehicleId === selectedLiveVehicleId
                const minsAgo = Math.round((Date.now() - new Date(pos.capturedAt).getTime()) / 60000)
                const dotColor = pos.liveStatus === 'active' ? 'bg-emerald-500' : pos.liveStatus === 'scheduled' ? 'bg-amber-500' : 'bg-gray-400'
                return (
                  <div key={pos.vehicleId}
                    onClick={() => {
                      setSelectedLiveVehicleId(id => id === pos.vehicleId ? null : pos.vehicleId)
                      const marker = liveMarkersRef.current.get(pos.vehicleId)
                      if (marker) mapRef.current?.panTo(marker.getLatLng(), { animate: true })
                    }}
                    className={`flex items-center justify-between px-3 py-2 border-b border-gray-50 cursor-pointer transition-colors ${isSelected ? 'bg-orange-50 border-l-2 border-l-orange-400' : 'hover:bg-gray-50'}`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${dotColor}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-mono font-bold text-gray-800 truncate">{pos.registrationNumber}</p>
                        <p className="text-xs text-gray-400 truncate">{pos.brand} {pos.model}</p>
                      </div>
                    </div>
                    <div className="flex flex-col items-end gap-0.5 shrink-0 ml-2">
                      <p className="text-xs font-semibold text-gray-700">{pos.speed} km/h</p>
                      <p className="text-[10px] text-gray-400">{minsAgo < 1 ? 'hozir' : `${minsAgo} daq`}</p>
                      <div className="flex gap-0.5">
                        <button onClick={e => { e.stopPropagation(); goToTrek(pos.vehicleId, pos.registrationNumber, new Date().toISOString().split('T')[0]) }}
                          className="px-1 py-0.5 text-[9px] bg-sky-100 text-sky-700 rounded hover:bg-sky-200">🛣</button>
                        <button onClick={e => { e.stopPropagation(); goToNazorat(new Date().toISOString().split('T')[0], null, pos.registrationNumber) }}
                          className="px-1 py-0.5 text-[9px] bg-rose-100 text-rose-700 rounded hover:bg-rose-200">📊</button>
                      </div>
                    </div>
                  </div>
                )
              })}
            </>
          )}

          {/* Tanlangan mashina info kartasi (live) */}
          {layerMode === 'live' && selectedLiveVehicleId && (() => {
            const pos = livePositions?.find(p => p.vehicleId === selectedLiveVehicleId)
            if (!pos) return null
            const minsAgo = Math.round((Date.now() - new Date(pos.capturedAt).getTime()) / 60000)
            return (
              <div className="mx-3 my-2 p-3 bg-orange-50 border border-orange-200 rounded-xl space-y-2">
                <div className="flex items-start justify-between">
                  <div>
                    <p className="font-mono font-bold text-gray-900">{pos.registrationNumber}</p>
                    <p className="text-xs text-gray-500">{pos.brand} {pos.model}</p>
                  </div>
                  <button onClick={() => setSelectedLiveVehicleId(null)} className="p-1 hover:bg-orange-100 rounded">
                    <X className="w-3.5 h-3.5 text-gray-400" />
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
                  <span className="text-gray-500">Tezlik</span>
                  <span className={`font-bold ${pos.speed > 90 ? 'text-red-600' : 'text-gray-800'}`}>{pos.speed} km/h</span>
                  <span className="text-gray-500">Holat</span>
                  <span className="font-medium text-gray-800">
                    {pos.liveStatus === 'active' ? '🟢 Faol' : pos.liveStatus === 'scheduled' ? '🟡 Kutmoqda' : '⬜ Jadvalda yo\'q'}
                  </span>
                  {pos.visitedToday > 0 && <>
                    <span className="text-gray-500">MFY (bugun)</span>
                    <span className="font-bold text-gray-800">{pos.visitedToday}/{pos.totalToday}</span>
                  </>}
                  {pos.coveragePct != null && <>
                    <span className="text-gray-500">Qamrov</span>
                    <span className="font-bold text-gray-800">{pos.coveragePct}%</span>
                  </>}
                  <span className="text-gray-500">Yangilangan</span>
                  <span className="text-gray-700">{minsAgo < 1 ? 'hozir' : `${minsAgo} daq oldin`}</span>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => goToTrek(pos.vehicleId, pos.registrationNumber, new Date().toISOString().split('T')[0])}
                    className="flex-1 py-1.5 bg-sky-600 text-white text-xs rounded-lg hover:bg-sky-700 flex items-center justify-center gap-1"
                  >
                    🛣 Trek
                  </button>
                  <button
                    onClick={() => goToNazorat(new Date().toISOString().split('T')[0], null, pos.registrationNumber)}
                    className="flex-1 py-1.5 bg-rose-600 text-white text-xs rounded-lg hover:bg-rose-700 flex items-center justify-center gap-1"
                  >
                    📊 Nazorat
                  </button>
                </div>
              </div>
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
                    <div className="flex items-center gap-1 shrink-0">
                      {matched && (() => {
                        const mfy = (mfys || []).find((m: any) =>
                          m.name.trim().toLowerCase() === zone.name.trim().toLowerCase() ||
                          (m.gpsZoneName && m.gpsZoneName.trim().toLowerCase() === zone.name.trim().toLowerCase())
                        )
                        return mfy ? (
                          <button onClick={e => { e.stopPropagation(); goToNazorat(new Date().toISOString().split('T')[0], mfy.id) }}
                            className="px-1.5 py-0.5 text-[9px] bg-rose-100 text-rose-700 rounded hover:bg-rose-200" title="Nazorat">📊</button>
                        ) : null
                      })()}
                      <span className="w-3 h-3 rounded-full" style={{ backgroundColor: zone.color }} />
                    </div>
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

      {/* Nazorat MFY detail modali */}
      {nazoratDetailModal && (() => {
        const trip = nazoratDetailModal
        const greenThr = thSettings?.coverageGreenPct ?? 70
        const yellowThr = thSettings?.coverageYellowPct ?? 40
        const pct = trip.coveragePct ?? 0
        const coverageLabel = trip.status === 'no_gps' ? "GPS yo'q"
          : trip.status === 'no_polygon' ? "Polygon yo'q"
          : pct >= greenThr ? `✅ ${pct}% — To'liq` : pct >= yellowThr ? `⚠️ ${pct}% — Qisman` : `❌ ${pct}% — Kam`
        const entT = trip.enteredAt ? new Date(trip.enteredAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : null
        const extT = trip.exitedAt ? new Date(trip.exitedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }) : null
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-xl shadow-xl w-full max-w-sm">
              <div className="flex items-start justify-between px-5 py-4 border-b">
                <div>
                  <p className="font-semibold text-gray-800">{trip.mfy?.name}</p>
                  <p className="text-xs text-gray-400">{trip.mfy?.district?.name} · {nazoratDate}</p>
                </div>
                <button onClick={() => setNazoratDetailModal(null)} className="p-1.5 hover:bg-gray-100 rounded-lg mt-0.5">
                  <X className="w-4 h-4 text-gray-500" />
                </button>
              </div>
              <div className="px-5 py-4">
                <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                  <span className="text-gray-500">Qamrov</span>
                  <span className="font-semibold">{coverageLabel}</span>
                  {trip.vehicle && <>
                    <span className="text-gray-500">Mashina</span>
                    <span className="font-mono font-bold text-gray-800">{trip.vehicle.registrationNumber}</span>
                    <span className="text-gray-500">Model</span>
                    <span className="text-gray-700">{trip.vehicle.brand} {trip.vehicle.model}</span>
                  </>}
                  {entT && <><span className="text-gray-500">Kirdi</span><span className="text-gray-700">{entT}</span></>}
                  {extT && <><span className="text-gray-500">Chiqdi</span><span className="text-gray-700">{extT}</span></>}
                  {trip.maxSpeedKmh != null && <>
                    <span className="text-gray-500">Maks. tezlik</span>
                    <span className={`font-semibold ${trip.maxSpeedKmh > 90 ? 'text-red-600' : 'text-gray-800'}`}>{trip.maxSpeedKmh} km/h</span>
                  </>}
                  {trip.suspicious && <>
                    <span className="text-gray-500">Holat</span>
                    <span className="text-red-600 font-medium">⚡ Shubhali</span>
                  </>}
                </div>
              </div>
              <div className="px-5 py-3 border-t bg-gray-50 rounded-b-xl space-y-2">
                <div className="flex gap-2">
                  <button onClick={() => setNazoratDetailModal(null)}
                    className="flex-1 py-2 text-sm text-gray-600 bg-white border border-gray-300 rounded-lg hover:bg-gray-50">
                    Yopish
                  </button>
                  <button onClick={() => {
                    setNazoratDetailModal(null)
                    setLayerMode('mfy')
                    if (trip.mfy?.id && mfyLayersRef.current.has(trip.mfy.id)) {
                      const layer = mfyLayersRef.current.get(trip.mfy.id) as L.GeoJSON
                      try { mapRef.current?.fitBounds(layer.getBounds(), { padding: [40, 40] }) } catch {}
                    }
                  }}
                    className="flex-1 py-2 text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg hover:bg-emerald-100">
                    🗺 MFY
                  </button>
                </div>
                {trip.vehicleId && (
                  <div className="flex gap-2">
                    <button onClick={() => goToTrek(trip.vehicleId, trip.vehicle?.registrationNumber || '', nazoratDate)}
                      className="flex-1 py-2 text-sm text-white bg-sky-600 rounded-lg hover:bg-sky-700">
                      🛣 Trek
                    </button>
                    <button onClick={() => { setSelectedLiveVehicleId(trip.vehicleId); setLayerMode('live'); setNazoratDetailModal(null) }}
                      className="flex-1 py-2 text-sm text-white bg-orange-500 rounded-lg hover:bg-orange-600">
                      🔴 Jonli
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        )
      })()}

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
