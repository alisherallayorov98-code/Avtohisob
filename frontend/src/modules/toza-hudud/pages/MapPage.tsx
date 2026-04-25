import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import 'leaflet-draw/dist/leaflet.draw.css'
import 'leaflet-draw'
import toast from 'react-hot-toast'
import { Layers, Save, X, Download, Wifi, RefreshCw, Upload } from 'lucide-react'
import api from '../../../lib/api'

delete (L.Icon.Default.prototype as any)._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

type LayerMode = 'mfy' | 'landfill' | 'gps'

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
  const landfillLayersRef = useRef<Map<string, L.Layer>>(new Map())
  const gpsLayersRef = useRef<Map<number, L.Layer>>(new Map())

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
    mutationFn: ({ mfyId, points }: { mfyId: string; points: Array<{ lat: number; lon: number }> }) =>
      api.post('/th/gps/zones/link', { mfyId, points }),
    onSuccess: () => {
      toast.success("Geozona MFYga biriktirildi")
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
      setLinkModal(null); setLinkMfyId('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const autoImportMut = useMutation({
    mutationFn: () => api.post('/th/gps/zones/auto-import'),
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`${d.matched} ta geozona MFYlarga biriktirildi (jami ${d.total} ta)`)
      qc.invalidateQueries({ queryKey: ['th-mfys-map'] })
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

  const importKmlMut = useMutation({
    mutationFn: ({ file, districtId }: { file: File; districtId: string }) => {
      const form = new FormData()
      form.append('file', file)
      form.append('districtId', districtId)
      return api.post('/th/mfys/import-kml', form, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: (res) => {
      const d = res.data.data
      toast.success(`${d.created} ta yangi MFY, ${d.updated} ta mavjud yangilandi`)
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

  // MFY layerlar
  useEffect(() => {
    const map = mapRef.current
    if (!map || !mfys) return
    mfyLayersRef.current.forEach(l => map.removeLayer(l))
    mfyLayersRef.current.clear()
    mfys.forEach((mfy: any) => {
      if (!mfy.polygon) return
      try {
        const layer = L.geoJSON(mfy.polygon, {
          style: { color: '#059669', fillColor: '#6ee7b7', fillOpacity: 0.25, weight: 2 },
        })
        layer.bindTooltip(mfy.name, { permanent: false, direction: 'center' })
        layer.addTo(map)
        mfyLayersRef.current.set(mfy.id, layer)
      } catch {}
    })
  }, [mfys])

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

  // Auto-match: geozone nomi MFY nomiga to'g'ri keladi
  const mfyNameSet = new Set((mfys || []).map((m: any) => m.name.trim().toLowerCase()))
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
          <div className="flex gap-1">
            <button onClick={() => setLayerMode('mfy')}
              className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'mfy' ? 'bg-emerald-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              MFYlar
            </button>
            <button onClick={() => setLayerMode('landfill')}
              className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'landfill' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              Poligonlar
            </button>
            <button onClick={() => setLayerMode('gps')}
              className={`flex-1 py-1.5 text-xs rounded-lg font-medium transition-colors ${layerMode === 'gps' ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
              GPS
            </button>
          </div>

          {/* Stats */}
          {layerMode !== 'gps' && (
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

              {/* KML fayl yuklash */}
              <div className="border border-emerald-200 rounded-lg p-2 space-y-1.5 bg-emerald-50/50">
                <p className="text-xs font-semibold text-emerald-700">KML fayl yuklash</p>
                <select
                  value={kmlDistrictId}
                  onChange={e => setKmlDistrictId(e.target.value)}
                  className="w-full px-2 py-1.5 text-xs border border-emerald-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-emerald-500 bg-white"
                >
                  <option value="">Tuman tanlang...</option>
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
                  onClick={() => kmlFile && kmlDistrictId && importKmlMut.mutate({ file: kmlFile, districtId: kmlDistrictId })}
                  disabled={!kmlFile || !kmlDistrictId || importKmlMut.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-2 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-40"
                >
                  <Upload className="w-3.5 h-3.5" />
                  {importKmlMut.isPending ? 'Yuklanmoqda...' : 'MFY chegaralarini yuklash'}
                </button>
              </div>

              {matchedCount > 0 && (
                <button
                  onClick={() => autoImportMut.mutate()}
                  disabled={autoImportMut.isPending}
                  className="w-full flex items-center justify-center gap-1.5 py-2 bg-emerald-600 text-white text-xs rounded-lg hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Download className="w-3.5 h-3.5" />
                  {autoImportMut.isPending ? 'Biriktirilmoqda...' : `${matchedCount} ta polygon biriktirish`}
                </button>
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
                      className="opacity-0 group-hover:opacity-100 p-1 text-emerald-600 hover:bg-emerald-100 rounded text-xs transition-opacity"
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
                      className="opacity-0 group-hover:opacity-100 p-1 text-red-600 hover:bg-red-100 rounded text-xs transition-opacity"
                    >✏️</button>
                  </div>
                </div>
              ))}
            </>
          )}

          {layerMode === 'gps' && (
            <>
              <div className="px-3 py-2 text-xs font-semibold text-gray-500 uppercase tracking-wide sticky top-0 bg-white border-b border-gray-100">
                GPS Geozones ({(geoZones || []).length} ta)
              </div>
              {gpsLoading && (
                <div className="flex items-center gap-2 px-3 py-4 text-xs text-gray-400">
                  <Wifi className="w-3.5 h-3.5 animate-pulse" /> GPS tizimidan yuklanmoqda (802 zone)...
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
            Geozonadagi qo'rdim → MFY ga biriktirish
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
                onClick={() => linkMut.mutate({ mfyId: linkMfyId, points: linkModal.zone.points })}
                disabled={!linkMfyId || linkMut.isPending}
                className="flex-1 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-50">
                {linkMut.isPending ? 'Saqlanmoqda...' : 'Biriktirish'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
