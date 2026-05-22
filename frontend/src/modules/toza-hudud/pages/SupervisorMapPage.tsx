import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { RefreshCw, AlertTriangle, CheckCircle2, Clock, Truck, MapPin } from 'lucide-react'
import api from '../../../lib/api'

interface MfyStatus {
  mfyId: string
  mfyName: string
  status: 'done' | 'pending' | 'overdue'
}

interface VehicleData {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  lat: number | null
  lon: number | null
  speedKmh: number
  lastSeenAt: string | null
  todayMfys: MfyStatus[]
  hasOverdue: boolean
  isActive: boolean
}

interface MfyMapData {
  mfyId: string
  mfyName: string
  lat: number | null
  lon: number | null
  polygon: any
  status: 'done' | 'pending' | 'overdue'
}

interface MapStats {
  totalVehicles: number
  activeVehicles: number
  overdueMfyCount: number
  doneMfyCount: number
  totalMfys: number
}

interface MapData {
  vehicles: VehicleData[]
  mfys: MfyMapData[]
  stats: MapStats
}

const MFY_COLORS = {
  done: '#10b981',
  pending: '#f59e0b',
  overdue: '#ef4444',
} as const

function fmtTime(dt: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

export default function SupervisorMapPage() {
  const mapRef = useRef<HTMLDivElement>(null)
  const leafletRef = useRef<any>(null)
  const markersRef = useRef<Record<string, any>>({})
  const polygonsRef = useRef<any[]>([])
  const [selectedVehicle, setSelectedVehicle] = useState<VehicleData | null>(null)
  const [mapReady, setMapReady] = useState(false)

  const { data, isLoading, dataUpdatedAt, refetch, isFetching } = useQuery<{ data: MapData }>({
    queryKey: ['th-supervisor-map'],
    queryFn: () => api.get('/th/supervisor/map').then(r => r.data),
    refetchInterval: 30 * 1000,
  })

  const mapData = data?.data

  // Leaflet xaritani bir marta initialize qilish
  useEffect(() => {
    if (!mapRef.current || leafletRef.current) return

    import('leaflet').then(L => {
      import('leaflet/dist/leaflet.css' as any).catch(() => null)

      // Default icon fix
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(mapRef.current!, {
        center: [41.299, 69.24],
        zoom: 11,
        zoomControl: true,
      })

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      leafletRef.current = { map, L }
      setMapReady(true)
    })

    return () => {
      if (leafletRef.current) {
        leafletRef.current.map.remove()
        leafletRef.current = null
        markersRef.current = {}
        polygonsRef.current = []
      }
    }
  }, [])

  // Ma'lumotlar kelganda markerlarni yangilash
  useEffect(() => {
    if (!mapReady || !leafletRef.current || !mapData) return
    const { map, L } = leafletRef.current

    // Eski polygonlarni o'chirish
    polygonsRef.current.forEach(p => map.removeLayer(p))
    polygonsRef.current = []

    // MFY polygonlar
    for (const mfy of mapData.mfys) {
      if (!mfy.polygon) continue
      try {
        const color = MFY_COLORS[mfy.status] || '#6b7280'
        const coords: number[][][] = mfy.polygon?.geometry?.coordinates ?? mfy.polygon?.coordinates
        if (!Array.isArray(coords) || !Array.isArray(coords[0])) continue
        const latLngs = coords[0].map((c: number[]) => [c[1], c[0]] as [number, number])
        const poly = L.polygon(latLngs, {
          color,
          weight: 2,
          fillColor: color,
          fillOpacity: mfy.status === 'overdue' ? 0.25 : 0.15,
        }).addTo(map)
        poly.bindTooltip(mfy.mfyName, { sticky: true, className: 'text-xs' })
        polygonsRef.current.push(poly)
      } catch { /* skip bad polygon */ }
    }

    // Eski markerlarni yangilash yoki yangi qo'shish
    const seenIds = new Set<string>()
    for (const v of mapData.vehicles) {
      if (v.lat === null || v.lon === null) continue
      seenIds.add(v.vehicleId)

      const color = v.hasOverdue ? '#ef4444' : v.isActive ? '#10b981' : '#6b7280'
      const svgIcon = L.divIcon({
        html: `<div style="
          width:28px;height:28px;border-radius:50%;
          background:${color};border:2px solid white;
          box-shadow:0 2px 6px rgba(0,0,0,0.3);
          display:flex;align-items:center;justify-content:center;
          font-size:10px;font-weight:700;color:white;
        ">${v.registrationNumber.slice(-3)}</div>`,
        iconSize: [28, 28],
        iconAnchor: [14, 14],
        className: '',
      })

      if (markersRef.current[v.vehicleId]) {
        markersRef.current[v.vehicleId].setLatLng([v.lat, v.lon])
        markersRef.current[v.vehicleId].setIcon(svgIcon)
      } else {
        const marker = L.marker([v.lat, v.lon], { icon: svgIcon }).addTo(map)
        marker.on('click', () => setSelectedVehicle(v))
        markersRef.current[v.vehicleId] = marker
      }
    }

    // Ko'rinmaydigan mashinalar markerlarini o'chirish
    for (const id of Object.keys(markersRef.current)) {
      if (!seenIds.has(id)) {
        map.removeLayer(markersRef.current[id])
        delete markersRef.current[id]
      }
    }

    // Birinchi yuklanishda mashinalar bo'lgan joyga zoom
    if (mapData.vehicles.filter(v => v.lat).length > 0) {
      const pts = mapData.vehicles.filter(v => v.lat && v.lon).map(v => [v.lat!, v.lon!] as [number, number])
      if (pts.length > 0) {
        try { map.fitBounds(L.latLngBounds(pts), { padding: [30, 30], maxZoom: 14 }) } catch { /* skip */ }
      }
    }
  }, [mapReady, mapData])

  const stats = mapData?.stats

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Stats bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-white border-b border-gray-200 shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-medium text-gray-600">Jonli xarita</span>
        </div>

        {stats && (
          <>
            <div className="h-4 w-px bg-gray-200" />
            <div className="flex items-center gap-1 text-xs text-gray-600">
              <Truck className="w-3.5 h-3.5 text-emerald-600" />
              <span>{stats.activeVehicles} ta mashina ishlayapti</span>
            </div>
            {stats.overdueMfyCount > 0 && (
              <div className="flex items-center gap-1 text-xs text-red-600 font-medium">
                <AlertTriangle className="w-3.5 h-3.5" />
                <span>{stats.overdueMfyCount} ta MFY kechikmoqda</span>
              </div>
            )}
            <div className="flex items-center gap-1 text-xs text-emerald-600">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{stats.doneMfyCount}/{stats.totalMfys} MFY bajarildi</span>
            </div>
          </>
        )}

        <div className="ml-auto flex items-center gap-2">
          {dataUpdatedAt > 0 && (
            <span className="text-[10px] text-gray-400">
              Yangilandi: {fmtTime(new Date(dataUpdatedAt).toISOString())}
            </span>
          )}
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="flex items-center gap-1 px-2 py-1 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
            Yangilash
          </button>
        </div>
      </div>

      {/* Legenda */}
      <div className="flex items-center gap-4 px-4 py-1.5 bg-gray-50 border-b border-gray-100 shrink-0 text-[10px] text-gray-500">
        <span className="font-medium">Mashinalar:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-emerald-500 inline-block" /> Faol</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-500 inline-block" /> Kechikkan MFY bor</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-400 inline-block" /> To'xtagan</span>
        <span className="font-medium ml-2">MFY:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-emerald-500/30 border border-emerald-500 inline-block" /> Bajarildi</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-amber-400/30 border border-amber-400 inline-block" /> Kutilmoqda</span>
        <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400/30 border border-red-400 inline-block" /> Kechikdi</span>
      </div>

      <div className="flex flex-1 overflow-hidden relative">
        {/* Xarita */}
        <div ref={mapRef} className="flex-1 h-full" />

        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/70 z-10">
            <div className="text-sm text-gray-500 animate-pulse">Xarita yuklanmoqda...</div>
          </div>
        )}

        {/* Tanlangan mashina info paneli */}
        {selectedVehicle && (
          <div className="absolute top-3 right-3 z-20 w-72 bg-white rounded-xl shadow-xl border border-gray-200 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-50 border-b border-gray-200">
              <div className="flex items-center gap-2">
                <div className={`w-2.5 h-2.5 rounded-full ${selectedVehicle.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-gray-400'}`} />
                <p className="font-semibold text-sm text-gray-800">{selectedVehicle.registrationNumber}</p>
              </div>
              <button onClick={() => setSelectedVehicle(null)} className="text-gray-400 hover:text-gray-600 text-lg leading-none">×</button>
            </div>

            <div className="p-3 space-y-2">
              <div className="flex items-center gap-3 text-xs text-gray-600">
                <span className="flex items-center gap-1">
                  <MapPin className="w-3 h-3" />
                  {selectedVehicle.speedKmh > 0 ? `${selectedVehicle.speedKmh} km/h` : 'To\'xtagan'}
                </span>
                {selectedVehicle.lastSeenAt && (
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {fmtTime(selectedVehicle.lastSeenAt)}
                  </span>
                )}
              </div>

              {selectedVehicle.todayMfys.length > 0 ? (
                <div className="space-y-1">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide">Bugungi MFY'lar</p>
                  <div className="max-h-44 overflow-y-auto space-y-1">
                    {selectedVehicle.todayMfys.map(m => (
                      <div key={m.mfyId} className="flex items-center gap-2 text-xs">
                        {m.status === 'done'
                          ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                          : m.status === 'overdue'
                          ? <AlertTriangle className="w-3.5 h-3.5 text-red-500 shrink-0" />
                          : <Clock className="w-3.5 h-3.5 text-amber-400 shrink-0" />}
                        <span className={`${m.status === 'overdue' ? 'text-red-600 font-medium' : 'text-gray-700'}`}>
                          {m.mfyName}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-xs text-gray-400 italic">Bugun jadval yo'q</p>
              )}
            </div>
          </div>
        )}

        {/* GPS yo'q mashinalar ro'yxati */}
        {mapData && mapData.vehicles.filter(v => !v.lat).length > 0 && (
          <div className="absolute bottom-3 left-3 z-20 bg-white/90 rounded-lg border border-gray-200 shadow px-3 py-2 max-w-xs">
            <p className="text-[10px] font-semibold text-gray-500 mb-1">GPS pozitsiyasi yo'q:</p>
            <div className="flex flex-wrap gap-1">
              {mapData.vehicles.filter(v => !v.lat).map(v => (
                <span key={v.vehicleId} className="text-[10px] px-1.5 py-0.5 bg-gray-100 rounded text-gray-600 font-mono">
                  {v.registrationNumber}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
