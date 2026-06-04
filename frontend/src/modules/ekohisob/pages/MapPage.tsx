import { useEffect, useRef, useState, useMemo } from 'react'
import { MapPin, Building2, CheckCircle2, AlertCircle, Loader2, Navigation } from 'lucide-react'
import L from 'leaflet'
import ekoApi from '../lib/ekoApi'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import { useAuthStore } from '../../../stores/authStore'

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
}
interface District { id: string; name: string }

function makeIcon(color: string) {
  return L.divIcon({
    className: '',
    html: `<div style="width:14px;height:14px;border-radius:50%;background:${color};border:2px solid white;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`,
    iconSize: [14, 14], iconAnchor: [7, 7],
  })
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
  const mapRef     = useRef<L.Map | null>(null)
  const mapDivRef  = useRef<HTMLDivElement>(null)
  const markersRef = useRef<L.Marker[]>([])
  const fittedRef  = useRef(false)   // birinchi yuklanishda auto-fit qildikmi

  const [entities, setEntities]   = useState<MapEntity[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [loading, setLoading]     = useState(false)
  const [selected, setSelected]   = useState<MapEntity | null>(null)

  // Foydalanuvchi info — asosiy token yoki eko token
  const ekoUser  = useEkoAuthStore(s => s.user)
  const mainUser = useAuthStore(s => s.user)
  const isInspector = ekoUser?.role === 'inspector' || mainUser?.role === 'ekohisob_user'
  const userDistrictIds: string[] = ekoUser?.districtIds ?? []

  // Xarita boshlash
  useEffect(() => {
    if (mapRef.current || !mapDivRef.current) return
    const { center, zoom } = getSavedView()
    const map = L.map(mapDivRef.current, { center, zoom, zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap', maxZoom: 19,
    }).addTo(map)

    const saveView = () => {
      const c = map.getCenter()
      localStorage.setItem('eko_map_view', JSON.stringify({
        center: [c.lat, c.lng], zoom: map.getZoom(),
      }))
    }
    map.on('moveend', saveView)
    map.on('zoomend', saveView)

    mapRef.current = map
    return () => { map.remove(); mapRef.current = null }
  }, [])

  // Tumanlar
  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  // Inspektor uchun birinchi tuman avtomatik tanlash
  useEffect(() => {
    if (isInspector && userDistrictIds.length === 1 && !selectedDistrict) {
      setSelectedDistrict(userDistrictIds[0])
    }
  }, [isInspector, userDistrictIds.length])

  // Tashkilotlarni yuklash
  useEffect(() => {
    setLoading(true)
    fittedRef.current = false   // yangi filter — qayta fit qilish kerak
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
        }))
        setEntities(list)
      })
      .catch(() => setEntities([]))
      .finally(() => setLoading(false))
  }, [selectedDistrict])

  // Markerlar va auto-zoom
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markersRef.current.forEach(m => m.remove())
    markersRef.current = []

    const withCoords = entities.filter(e => e.lat && e.lng)
    withCoords.forEach(entity => {
      const color = entity.status === 'blacklisted' ? '#111827'
        : entity.status === 'inactive' ? '#9ca3af'
        : entity.paid ? '#16a34a' : '#dc2626'

      const marker = L.marker([entity.lat!, entity.lng!], { icon: makeIcon(color) })
        .addTo(map)
        .on('click', () => setSelected(entity))
      marker.bindTooltip(entity.name, { permanent: false, direction: 'top', offset: [0, -8] })
      markersRef.current.push(marker)
    })

    // Birinchi yuklanishda (yoki filter o'zgarganda) koordinatali tashkilotlarga zoom
    if (withCoords.length > 0 && !fittedRef.current) {
      const bounds = L.latLngBounds(withCoords.map(e => [e.lat!, e.lng!] as [number, number]))
      map.fitBounds(bounds, { padding: [60, 60], maxZoom: 15 })
      fittedRef.current = true
    }
  }, [entities])

  // Inspektor tumanlari nomlari
  const myDistrictNames = useMemo(() => {
    if (!isInspector || userDistrictIds.length === 0) return []
    return districts.filter(d => userDistrictIds.includes(d.id)).map(d => d.name)
  }, [districts, userDistrictIds, isInspector])

  const paidCount        = entities.filter(e => e.paid && e.status === 'active').length
  const unpaidCount      = entities.filter(e => !e.paid && e.status === 'active').length
  const blacklistedCount = entities.filter(e => e.status === 'blacklisted').length
  const withCoords       = entities.filter(e => e.lat && e.lng).length

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
          <div className="flex items-center gap-3">
            <div className="hidden sm:flex items-center gap-2 text-xs text-gray-600">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-green-600 inline-block"/>{paidCount} to'lagan</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-red-600 inline-block"/>{unpaidCount} to'lamagan</span>
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded-full bg-gray-900 inline-block"/>{blacklistedCount} qora</span>
            </div>

            {/* Tuman filter — inspektor bir tumanga biriktirilgan bo'lsa, ko'rsatish shart emas */}
            {!(isInspector && userDistrictIds.length === 1) && (
              <select
                value={selectedDistrict}
                onChange={e => { setSelectedDistrict(e.target.value); fittedRef.current = false }}
                className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              >
                <option value="">Barcha tumanlar</option>
                {/* Inspektor bo'lsa — faqat o'z tumanlarini ko'rsatish */}
                {(isInspector && userDistrictIds.length > 0
                  ? districts.filter(d => userDistrictIds.includes(d.id))
                  : districts
                ).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Inspektor tumanlari badge'lari */}
        {isInspector && myDistrictNames.length > 0 && (
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="text-xs text-gray-500">Sizning tumanlaringiz:</span>
            {myDistrictNames.map(name => (
              <span key={name} className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">
                📍 {name}
              </span>
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

        {/* Tanlangan tashkilot popup */}
        {selected && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-[1000] bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80">
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
                      <AlertCircle className="w-3.5 h-3.5" /> To'lamagan
                    </span>
                  )}
                  {selected.lat && selected.lng && (
                    <a
                      href={`https://maps.google.com/?q=${selected.lat},${selected.lng}`}
                      target="_blank" rel="noopener noreferrer"
                      className="flex items-center gap-1 text-xs text-blue-600 hover:underline"
                    >
                      <Navigation className="w-3 h-3" /> Navigator
                    </a>
                  )}
                </div>
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
    </div>
  )
}
