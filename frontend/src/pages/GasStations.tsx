import { useEffect, useRef, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { MapPin, Trash2, Flame, RefreshCw, Crosshair } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

interface Station { id: string; name: string; lat: number; lon: number; radiusM: number; isActive: boolean }

export default function GasStations() {
  const qc = useQueryClient()
  const mapEl = useRef<HTMLDivElement | null>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const tempRef = useRef<L.Layer | null>(null)

  const [picked, setPicked] = useState<{ lat: number; lon: number } | null>(null)
  const [form, setForm] = useState({ name: '', radiusM: '150' })

  const { data: stations } = useQuery({
    queryKey: ['gas-stations'],
    queryFn: () => api.get('/gas-stations').then(r => r.data.data as Station[]),
  })

  const createMut = useMutation({
    mutationFn: (b: any) => api.post('/gas-stations', b).then(r => r.data),
    onSuccess: () => { toast.success('Stansiya qo\'shildi'); qc.invalidateQueries({ queryKey: ['gas-stations'] }); setPicked(null); setForm({ name: '', radiusM: '150' }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const deleteMut = useMutation({
    mutationFn: (id: string) => api.delete(`/gas-stations/${id}`).then(r => r.data),
    onSuccess: () => { toast.success('O\'chirildi'); qc.invalidateQueries({ queryKey: ['gas-stations'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const rebuildMut = useMutation({
    mutationFn: () => api.post('/gps/backfill-daily-km', { force: true }).then(r => r.data),
    onSuccess: (r: any) => toast.success(r.message || 'Qayta qurish boshlandi'),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Xarita init (bir marta)
  useEffect(() => {
    if (!mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current).setView([41.311, 69.24], 12)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)
    layerRef.current = L.layerGroup().addTo(map)
    map.on('click', (e: L.LeafletMouseEvent) => {
      setPicked({ lat: e.latlng.lat, lon: e.latlng.lng })
    })
    mapRef.current = map
    setTimeout(() => map.invalidateSize(), 200)
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Stansiyalarni xaritaga chizish
  useEffect(() => {
    const lg = layerRef.current
    if (!lg) return
    lg.clearLayers()
    let first: [number, number] | null = null
    for (const s of stations || []) {
      L.circle([s.lat, s.lon], { radius: s.radiusM, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 0.15 }).addTo(lg)
      L.circleMarker([s.lat, s.lon], { radius: 6, color: '#16a34a', fillColor: '#16a34a', fillOpacity: 1 }).addTo(lg).bindTooltip(s.name)
      if (!first) first = [s.lat, s.lon]
    }
    if (first && mapRef.current) mapRef.current.setView(first, 12)
  }, [stations])

  // Tanlangan nuqta markeri
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    if (tempRef.current) { map.removeLayer(tempRef.current); tempRef.current = null }
    if (picked) {
      const r = parseInt(form.radiusM) || 150
      tempRef.current = L.layerGroup([
        L.circle([picked.lat, picked.lon], { radius: r, color: '#ef4444', dashArray: '4', fillOpacity: 0.1 }),
        L.circleMarker([picked.lat, picked.lon], { radius: 6, color: '#ef4444', fillColor: '#ef4444', fillOpacity: 1 }),
      ]).addTo(map)
    }
  }, [picked, form.radiusM])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Flame className="w-6 h-6 text-green-600" /> Gaz quyish nuqtalari
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Xaritadan zona belgilang — mashina shu zonaga kirgan vaqt "quyish" deb hisoblanadi (aniq sarf hisobi uchun)</p>
        </div>
        <Button variant="outline" loading={rebuildMut.isPending} icon={<RefreshCw className="w-4 h-4" />}
          onClick={() => { if (confirm('6 oylik GPS trekni qayta tortib, quyish to\'xtashlarini aniqlaymizmi? Bir necha daqiqa davom etadi.')) rebuildMut.mutate() }}>
          Hisobni qayta qurish
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Xarita */}
        <div className="lg:col-span-2 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div ref={mapEl} style={{ height: 460, width: '100%' }} />
          <div className="px-4 py-2 text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 flex items-center gap-1">
            <Crosshair className="w-3.5 h-3.5" /> Stansiya qo'shish uchun xaritada bosing
          </div>
        </div>

        {/* Panel */}
        <div className="space-y-4">
          {picked && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-green-200 dark:border-green-800 p-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Yangi stansiya</h3>
              <p className="text-xs text-gray-400">{picked.lat.toFixed(5)}, {picked.lon.toFixed(5)}</p>
              <Input label="Nomi" value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="CNG stansiya" />
              <Input label="Radius (metr)" type="number" value={form.radiusM} onChange={e => setForm(f => ({ ...f, radiusM: e.target.value }))} min={20} max={2000} />
              <div className="flex gap-2">
                <Button size="sm" loading={createMut.isPending} disabled={!form.name.trim()}
                  onClick={() => createMut.mutate({ name: form.name.trim(), lat: picked.lat, lon: picked.lon, radiusM: parseInt(form.radiusM) || 150 })}>Saqlash</Button>
                <Button size="sm" variant="outline" onClick={() => setPicked(null)}>Bekor</Button>
              </div>
            </div>
          )}

          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
            <div className="px-4 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center gap-2">
              <MapPin className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Stansiyalar ({stations?.length || 0})</h3>
            </div>
            <div className="divide-y divide-gray-50 dark:divide-gray-700/50 max-h-72 overflow-y-auto">
              {!stations?.length ? (
                <p className="px-4 py-6 text-sm text-gray-400 text-center">Hali stansiya yo'q</p>
              ) : stations.map(s => (
                <div key={s.id} className="px-4 py-2.5 flex items-center justify-between gap-2">
                  <button className="text-left flex-1" onClick={() => mapRef.current?.setView([s.lat, s.lon], 15)}>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{s.name}</p>
                    <p className="text-xs text-gray-400">{s.lat.toFixed(4)}, {s.lon.toFixed(4)} · {s.radiusM}m</p>
                  </button>
                  <button onClick={() => { if (confirm(`"${s.name}" o'chirilsinmi?`)) deleteMut.mutate(s.id) }}
                    className="text-red-400 hover:text-red-600 p-1"><Trash2 className="w-4 h-4" /></button>
                </div>
              ))}
            </div>
          </div>

          <p className="text-xs text-gray-400 px-1">
            Stansiyalarni belgilab bo'lgach, <b>"Hisobni qayta qurish"</b> tugmasini bosing — tizim 6 oylik trekni qayta o'qib, har quyishni aniqlaydi va sarfni aniq hisoblaydi.
          </p>
        </div>
      </div>
    </div>
  )
}
