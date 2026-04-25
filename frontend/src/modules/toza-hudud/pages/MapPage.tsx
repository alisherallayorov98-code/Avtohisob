import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import toast from 'react-hot-toast'
import { Layers, Trash2, Save, X } from 'lucide-react'
import api from '../../../lib/api'

// Fix default marker icons
delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

type LayerMode = 'mfy' | 'landfill'

export default function MapPage() {
  const qc = useQueryClient()
  const mapRef = useRef<L.Map | null>(null)
  const mapDivRef = useRef<HTMLDivElement>(null)
  const drawnLayersRef = useRef<L.FeatureGroup | null>(null)
  const mfyLayersRef = useRef<Map<string, L.Layer>>(new Map())
  const landfillLayersRef = useRef<Map<string, L.Layer>>(new Map())

  const [districtFilter, setDistrictFilter] = useState('')
  const [layerMode, setLayerMode] = useState<LayerMode>('mfy')
  const [drawingFor, setDrawingFor] = useState<{ id: string; name: string; type: LayerMode } | null>(null)
  const [pendingGeoJson, setPendingGeoJson] = useState<any>(null)

  const { data: districts } = useQuery({
    queryKey: ['th-districts-all', ''],
    queryFn: () => api.get('/th/districts', { params: { limit: 200 } }).then(r => r.data.data),
  })
  const { data: mfys } = useQuery({
    queryKey: ['th-mfys-map', districtFilter],
    queryFn: () => api.get('/th/mfys', {
      params: { districtId: districtFilter || undefined, limit: 500 }
    }).then(r => r.data.data),
  })
  const { data: landfills } = useQuery({
    queryKey: ['th-landfills'],
    queryFn: () => api.get('/th/landfills').then(r => r.data.data),
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

  // Xaritani ishga tushirish
  useEffect(() => {
    if (!mapDivRef.current || mapRef.current) return

    const map = L.map(mapDivRef.current, {
      center: [39.65, 66.97], // Samarqand markazi
      zoom: 11,
    })

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
        polygon: {
          allowIntersection: false,
          showArea: true,
          shapeOptions: { color: '#059669', fillOpacity: 0.3 },
        },
        polyline: false, rectangle: false, circle: false,
        circlemarker: false, marker: false,
      },
    })
    map.addControl(drawControl)

    map.on((L as any).Draw.Event.CREATED, (e: any) => {
      drawnItems.clearLayers()
      drawnItems.addLayer(e.layer)
      const geoJson = e.layer.toGeoJSON()
      setPendingGeoJson(geoJson)
    })

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // MFY layerlarini chizish
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mfys) return

    // Eski layerlarni tozalash
    mfyLayersRef.current.forEach(l => map.removeLayer(l))
    mfyLayersRef.current.clear()

    mfys.forEach((mfy: any) => {
      if (!mfy.polygon) return
      try {
        const layer = L.geoJSON(mfy.polygon, {
          style: {
            color: '#059669',
            fillColor: '#6ee7b7',
            fillOpacity: 0.25,
            weight: 2,
          },
        })
        layer.bindTooltip(mfy.name, { permanent: false, direction: 'center' })
        layer.on('click', () => {
          if (layerMode === 'mfy') startDrawingFor(mfy.id, mfy.name, 'mfy')
        })
        layer.addTo(map)
        mfyLayersRef.current.set(mfy.id, layer)
      } catch {}
    })
  }, [mfys])

  // Landfill layerlarini chizish
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

  const startDrawingFor = (id: string, name: string, type: LayerMode) => {
    drawnLayersRef.current?.clearLayers()
    setPendingGeoJson(null)
    setDrawingFor({ id, name, type })
    toast(`"${name}" chegarasini xaritada chizing`, { icon: '✏️', duration: 3000 })
  }

  const savePolygon = () => {
    if (!pendingGeoJson || !drawingFor) return
    if (drawingFor.type === 'mfy') {
      saveMfyPolygon.mutate({ id: drawingFor.id, polygon: pendingGeoJson })
    } else {
      saveLandfillPolygon.mutate({ id: drawingFor.id, polygon: pendingGeoJson })
    }
    drawnLayersRef.current?.clearLayers()
  }

  const cancelDraw = () => {
    drawnLayersRef.current?.clearLayers()
    setDrawingFor(null); setPendingGeoJson(null)
  }

  const mfysWithPolygon = (mfys || []).filter((m: any) => m.polygon).length
  const mfysWithout = (mfys || []).filter((m: any) => !m.polygon).length
  const landfillsWithPolygon = (landfills || []).filter((l: any) => l.polygon).length

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
          <div className="flex gap-1">
            <button onClick={() => setLayerMode('mfy')}
              className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'mfy' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              MFYlar
            </button>
            <button onClick={() => setLayerMode('landfill')}
              className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'landfill' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Poligonlar
            </button>
          </div>

          {/* Statistika */}
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
        </div>

        {/* Chizish panel — aktiv bo'lsa */}
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
          {layerMode === 'mfy' ? (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                MFYlar ({(mfys || []).length} ta)
              </div>
              {(mfys || []).map((mfy: any) => (
                <div key={mfy.id}
                  className="flex items-center justify-between px-3 py-2 border-b border-gray-50 hover:bg-gray-50 cursor-pointer group"
                  onClick={() => {
                    // Agar polygon bo'lsa — xaritada ko'rsatish
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
                      ? <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" title="Chizilgan" />
                      : <span className="w-2 h-2 rounded-full bg-amber-400 shrink-0" title="Chizilmagan" />
                    }
                    <button
                      onClick={e => { e.stopPropagation(); startDrawingFor(mfy.id, mfy.name, 'mfy') }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-emerald-600 hover:bg-emerald-100 rounded text-xs transition-opacity"
                      title="Polygon chizish"
                    >
                      ✏️
                    </button>
                  </div>
                </div>
              ))}
              {(mfys || []).length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-gray-400">MFYlar topilmadi</p>
              )}
            </>
          ) : (
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
                      ? <span className="w-2 h-2 rounded-full bg-red-500" title="Chizilgan" />
                      : <span className="w-2 h-2 rounded-full bg-amber-400" title="Chizilmagan" />
                    }
                    <button
                      onClick={e => { e.stopPropagation(); startDrawingFor(lf.id, lf.name, 'landfill') }}
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-600 hover:bg-red-100 rounded text-xs transition-opacity"
                      title="Polygon chizish"
                    >
                      ✏️
                    </button>
                  </div>
                </div>
              ))}
              {landfillsWithPolygon === 0 && (
                <p className="px-3 py-6 text-center text-sm text-gray-400">Hali hech narsa yo'q</p>
              )}
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
        </div>
      </div>

      {/* Xarita */}
      <div className="flex-1 relative">
        <div ref={mapDivRef} className="w-full h-full" />

        {/* Xaritada ko'rsatma */}
        {!drawingFor && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 bg-white/90 backdrop-blur-sm px-4 py-2 rounded-full shadow text-xs text-gray-600 flex items-center gap-2 pointer-events-none">
            <Layers className="w-3.5 h-3.5" />
            Ro'yxatdan MFY tanlang yoki ✏️ bosing → polygon chizing
          </div>
        )}
      </div>
    </div>
  )
}
