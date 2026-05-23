/**
 * TrekReplayModal — trackSnapshot nuqtalarini Leaflet xaritada ko'rsatadi.
 * MFY polygon overlay + kirish/chiqish vaqti + statistika.
 */

import { useEffect, useRef } from 'react'
import { X, Clock, Gauge, MapPin, Timer } from 'lucide-react'

interface TrackPoint {
  lat: number
  lon: number
  ts: number
}

interface TrekReplayModalProps {
  registrationNumber: string
  mfyName: string
  date: string
  enteredAt: string | null
  exitedAt: string | null
  timeInsideMin: number | null
  maxSpeedKmh: number | null
  coveragePct: number | null
  trackSnapshot: TrackPoint[] | null
  mfyPolygon: any
  onClose: () => void
}

function fmtTime(iso: string | null) {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function fmtDate(dateStr: string) {
  return new Date(dateStr).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}

export default function TrekReplayModal({
  registrationNumber, mfyName, date,
  enteredAt, exitedAt, timeInsideMin, maxSpeedKmh, coveragePct,
  trackSnapshot, mfyPolygon,
  onClose,
}: TrekReplayModalProps) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)

  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return

    import('leaflet').then(L => {
      delete (L.Icon.Default.prototype as any)._getIconUrl
      L.Icon.Default.mergeOptions({
        iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
        iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
        shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
      })

      const map = L.map(mapRef.current!, { zoomControl: true })
      mapInstanceRef.current = map

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap',
        maxZoom: 19,
      }).addTo(map)

      const layers: any[] = []

      // MFY polygon
      if (mfyPolygon) {
        try {
          const coords: number[][][] = mfyPolygon?.geometry?.coordinates ?? mfyPolygon?.coordinates
          if (Array.isArray(coords?.[0])) {
            const latlngs = coords[0].map((c: number[]) => [c[1], c[0]] as [number, number])
            const poly = L.polygon(latlngs, {
              color: '#10b981', weight: 2.5,
              fillColor: '#10b981', fillOpacity: 0.12,
              dashArray: '6 4',
            }).addTo(map)
            poly.bindTooltip(mfyName, { permanent: false })
            layers.push(poly)
          }
        } catch { /* skip bad polygon */ }
      }

      // Trek nuqtalar
      const points = trackSnapshot ?? []
      if (points.length > 0) {
        // Trek chizig'i — normal (ko'k)
        const latlngs = points.map(p => [p.lat, p.lon] as [number, number])
        L.polyline(latlngs, { color: '#3b82f6', weight: 3, opacity: 0.8 }).addTo(map)

        // Tez harakatlar qizil
        const fastPts = points.filter(p => {
          // Tezlikni approx hisoblash (keyingi nuqtaga qarab)
          return false // trackSnapshot'da speed yo'q, maxSpeedKmh umumiy
        })

        // Boshlanish markeri (yashil)
        const startIcon = L.divIcon({
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#10b981;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
          iconSize: [12, 12], iconAnchor: [6, 6], className: '',
        })
        const endIcon = L.divIcon({
          html: `<div style="width:12px;height:12px;border-radius:50%;background:#ef4444;border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
          iconSize: [12, 12], iconAnchor: [6, 6], className: '',
        })

        const startPt = points[0]
        const endPt = points[points.length - 1]

        L.marker([startPt.lat, startPt.lon], { icon: startIcon })
          .addTo(map)
          .bindTooltip(`Boshlash: ${new Date(startPt.ts * 1000).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}`)

        L.marker([endPt.lat, endPt.lon], { icon: endIcon })
          .addTo(map)
          .bindTooltip(`Tugash: ${new Date(endPt.ts * 1000).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })}`)

        // Vaqt tooltip'lari — har 10ta nuqtadan birida
        const step = Math.max(1, Math.floor(points.length / 8))
        for (let i = step; i < points.length - 1; i += step) {
          const p = points[i]
          const timeStr = new Date(p.ts * 1000).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
          const dot = L.circleMarker([p.lat, p.lon], {
            radius: 3, color: '#6366f1', fillColor: '#6366f1', fillOpacity: 0.8, weight: 1,
          }).addTo(map)
          dot.bindTooltip(timeStr, { permanent: false, className: 'text-xs' })
        }

        // Zoom to fit all points + polygon
        try {
          const bounds = L.latLngBounds(latlngs)
          if (layers.length > 0) {
            for (const l of layers) {
              try { bounds.extend(l.getBounds()) } catch { /* skip */ }
            }
          }
          map.fitBounds(bounds, { padding: [30, 30] })
        } catch { map.setView([points[0].lat, points[0].lon], 14) }
      } else if (mfyPolygon) {
        // Trek yo'q ama polygon bor
        try {
          const coords: number[][][] = mfyPolygon?.geometry?.coordinates ?? mfyPolygon?.coordinates
          if (Array.isArray(coords?.[0])) {
            const latlngs = coords[0].map((c: number[]) => [c[1], c[0]] as [number, number])
            map.fitBounds(L.latLngBounds(latlngs), { padding: [30, 30] })
          }
        } catch { map.setView([41.3, 69.24], 13) }
      } else {
        map.setView([41.3, 69.24], 12)
      }
    })

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove()
        mapInstanceRef.current = null
      }
    }
  }, [])

  const hasTrack = (trackSnapshot?.length ?? 0) > 0

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onClick={e => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[90vh] overflow-hidden">
        {/* Sarlavha */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200 shrink-0">
          <div>
            <p className="font-bold text-gray-800">{registrationNumber} — GPS Trek Replay</p>
            <p className="text-xs text-gray-500 mt-0.5">{mfyName} · {fmtDate(date)}</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400 hover:text-gray-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Statistika */}
        <div className="grid grid-cols-4 gap-3 px-5 py-3 bg-gray-50 border-b border-gray-100 shrink-0">
          <div className="text-center">
            <p className="text-[10px] text-gray-400 mb-0.5 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />Kirish
            </p>
            <p className="text-sm font-semibold text-gray-700">{fmtTime(enteredAt)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 mb-0.5 flex items-center justify-center gap-1">
              <Clock className="w-3 h-3" />Chiqish
            </p>
            <p className="text-sm font-semibold text-gray-700">{fmtTime(exitedAt)}</p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 mb-0.5 flex items-center justify-center gap-1">
              <Timer className="w-3 h-3" />Ichida
            </p>
            <p className={`text-sm font-semibold ${(timeInsideMin ?? 99) < 3 ? 'text-red-600' : 'text-gray-700'}`}>
              {timeInsideMin != null ? `${timeInsideMin} daq` : '—'}
            </p>
          </div>
          <div className="text-center">
            <p className="text-[10px] text-gray-400 mb-0.5 flex items-center justify-center gap-1">
              <Gauge className="w-3 h-3" />Tezlik
            </p>
            <p className={`text-sm font-semibold ${(maxSpeedKmh ?? 0) > 30 ? 'text-red-600' : 'text-gray-700'}`}>
              {maxSpeedKmh != null ? `${Math.round(maxSpeedKmh)} km/h` : '—'}
            </p>
          </div>
        </div>

        {/* Xarita */}
        <div className="relative flex-1 min-h-0" style={{ minHeight: 320 }}>
          <div ref={mapRef} className="w-full h-full" style={{ minHeight: 320 }} />

          {!hasTrack && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/80 z-10">
              <div className="text-center">
                <MapPin className="w-8 h-8 text-gray-300 mx-auto mb-2" />
                <p className="text-sm text-gray-500">Bu uchun GPS trek saqlangan emas</p>
                <p className="text-xs text-gray-400 mt-1">trackSnapshot bo'sh yoki yangi monitoring kerak</p>
              </div>
            </div>
          )}
        </div>

        {/* Izoh */}
        {hasTrack && (
          <div className="px-5 py-2.5 bg-gray-50 border-t border-gray-100 shrink-0">
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-emerald-500 rounded inline-block" />
                MFY chegarasi
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 h-0.5 bg-blue-500 rounded inline-block" />
                Haydovchi yo'li
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />
                Kirish nuqtasi
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                Chiqish nuqtasi
              </span>
              <span className="ml-auto">{trackSnapshot?.length ?? 0} ta GPS nuqta</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
