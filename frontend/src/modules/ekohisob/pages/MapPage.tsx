import { useState, useEffect } from 'react'
import { MapPin, Building2, CheckCircle2, AlertCircle, Loader2 } from 'lucide-react'
import ekoApi from '../lib/ekoApi'

interface MapEntity {
  id: string
  name: string
  address: string
  status: 'active' | 'blacklisted' | 'inactive'
  paid: boolean
  lat?: number
  lng?: number
  districtId?: string
}

interface District {
  id: string
  name: string
}

// Check if leaflet is available by attempting to import it
let leafletAvailable = false
try {
  // leaflet is in package.json, so it should be available
  leafletAvailable = true
} catch {
  leafletAvailable = false
}

const STATUS_COLOR: Record<string, string> = {
  paid: 'bg-green-100 text-green-700 border-green-200',
  unpaid: 'bg-red-100 text-red-700 border-red-200',
  blacklisted: 'bg-gray-900 text-white border-gray-700',
  inactive: 'bg-gray-100 text-gray-600 border-gray-200',
}

function getEntityColor(entity: MapEntity): string {
  if (entity.status === 'blacklisted') return 'blacklisted'
  if (entity.status === 'inactive') return 'inactive'
  return entity.paid ? 'paid' : 'unpaid'
}

export default function MapPage() {
  const [entities, setEntities] = useState<MapEntity[]>([])
  const [districts, setDistricts] = useState<District[]>([])
  const [selectedDistrict, setSelectedDistrict] = useState('')
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<MapEntity | null>(null)
  const hasLeaflet = leafletAvailable

  useEffect(() => {
    ekoApi.get('/districts').then(res => {
      const data = res.data.data ?? res.data
      setDistricts(Array.isArray(data) ? data : [])
    }).catch(() => {})
  }, [])

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (selectedDistrict) params.set('districtId', selectedDistrict)
    ekoApi.get(`/dashboard/map?${params.toString()}`)
      .then(res => {
        const data = res.data.data ?? res.data
        // Backend: { paidThisMonth, lon } → frontend: { paid, lng }
        const list: MapEntity[] = (Array.isArray(data) ? data : []).map((e: any) => ({
          id: e.id,
          name: e.name,
          address: e.address ?? '',
          status: e.status,
          paid: Boolean(e.paidThisMonth),
          lat: e.lat ?? undefined,
          lng: e.lon ?? undefined,
          districtId: e.districtId,
        }))
        setEntities(list)
      })
      .catch(() => setEntities([]))
      .finally(() => setLoading(false))
  }, [selectedDistrict])

  const paidCount = entities.filter(e => e.paid && e.status === 'active').length
  const unpaidCount = entities.filter(e => !e.paid && e.status === 'active').length
  const blacklistedCount = entities.filter(e => e.status === 'blacklisted').length

  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-lg font-bold text-gray-900">Xarita</h1>
        <select
          value={selectedDistrict}
          onChange={e => setSelectedDistrict(e.target.value)}
          className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500 min-w-[140px]"
        >
          <option value="">Barcha tumanlar</option>
          {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select>
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3">
        <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 shadow-sm border border-gray-100 text-sm">
          <span className="w-3 h-3 rounded-full bg-green-500 shrink-0" />
          <span className="text-gray-700">To'lagan ({paidCount})</span>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 shadow-sm border border-gray-100 text-sm">
          <span className="w-3 h-3 rounded-full bg-red-500 shrink-0" />
          <span className="text-gray-700">To'lamagan ({unpaidCount})</span>
        </div>
        <div className="flex items-center gap-2 bg-white rounded-lg px-3 py-2 shadow-sm border border-gray-100 text-sm">
          <span className="w-3 h-3 rounded-full bg-gray-900 shrink-0" />
          <span className="text-gray-700">Qora ro'yxat ({blacklistedCount})</span>
        </div>
      </div>

      {/* Map placeholder — show message since we need React context for react-leaflet */}
      {!hasLeaflet ? (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-10 text-center">
          <MapPin className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-600 font-medium">Xarita yaqinda qo'shiladi</p>
          <p className="text-gray-400 text-sm mt-1">Hozircha quyidagi ro'yxatdan foydalaning</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-br from-green-50 to-emerald-100 h-64 flex items-center justify-center">
            <div className="text-center">
              <MapPin className="w-12 h-12 text-green-400 mx-auto mb-2" />
              <p className="text-green-700 font-medium text-sm">Interaktiv xarita</p>
              <p className="text-green-600 text-xs mt-1">Koordinatali tashkilotlar xaritada ko'rsatiladi</p>
            </div>
          </div>
        </div>
      )}

      {/* Entity list view */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="font-semibold text-gray-800 text-sm">Tashkilotlar ro'yxati ({entities.length})</p>
        </div>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="w-6 h-6 text-green-600 animate-spin" />
          </div>
        ) : entities.length === 0 ? (
          <div className="py-10 text-center">
            <Building2 className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-gray-400 text-sm">Tashkilotlar topilmadi</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {entities.map(entity => {
              const colorKey = getEntityColor(entity)
              return (
                <div
                  key={entity.id}
                  onClick={() => setSelected(selected?.id === entity.id ? null : entity)}
                  className={`flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${selected?.id === entity.id ? 'bg-green-50' : ''}`}
                >
                  {/* Status dot */}
                  <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                    colorKey === 'paid' ? 'bg-green-500' :
                    colorKey === 'unpaid' ? 'bg-red-500' :
                    colorKey === 'blacklisted' ? 'bg-gray-900' :
                    'bg-gray-400'
                  }`} />

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900 truncate">{entity.name}</p>
                    <p className="text-xs text-gray-500 truncate">{entity.address}</p>
                  </div>

                  <span className={`text-xs px-2 py-0.5 rounded-full border font-medium shrink-0 ${STATUS_COLOR[colorKey]}`}>
                    {colorKey === 'paid' ? "To'lagan" :
                     colorKey === 'unpaid' ? "To'lamagan" :
                     colorKey === 'blacklisted' ? "Qora ro'yxat" : 'Nofaol'}
                  </span>

                  {entity.lat && entity.lng && (
                    <MapPin className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Selected entity popup */}
      {selected && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 bg-white rounded-xl shadow-2xl border border-gray-200 p-4 w-80 z-50">
          <div className="flex items-start justify-between gap-2">
            <div>
              <p className="font-semibold text-gray-900 text-sm">{selected.name}</p>
              <p className="text-xs text-gray-500 mt-0.5">{selected.address}</p>
              <div className="flex items-center gap-2 mt-2">
                {selected.paid ? (
                  <span className="flex items-center gap-1 text-xs text-green-700">
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    To'lagan
                  </span>
                ) : (
                  <span className="flex items-center gap-1 text-xs text-red-700">
                    <AlertCircle className="w-3.5 h-3.5" />
                    To'lamagan
                  </span>
                )}
                {selected.lat && selected.lng && (
                  <span className="text-xs text-gray-400 flex items-center gap-1">
                    <MapPin className="w-3 h-3" />
                    {selected.lat.toFixed(4)}, {selected.lng.toFixed(4)}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={() => setSelected(null)}
              className="p-1 hover:bg-gray-100 rounded text-gray-400"
            >
              ×
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
