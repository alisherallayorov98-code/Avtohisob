import { useState } from 'react'
import { X, Loader2, ShieldCheck, ShieldAlert, Truck, MapPin, Clock } from 'lucide-react'
import ekoApi from '../lib/ekoApi'

interface PassingVehicle {
  vehicleId: string
  registrationNumber: string
  closestMeters: number
  passedAt: string
  nearbyCount: number
}

interface ProofData {
  available: boolean
  reason?: string
  date?: string
  radiusM?: number
  served?: boolean
  entity?: { id: string; name: string; lat: number; lon: number; address?: string }
  passingVehicles?: PassingVehicle[]
}

interface Props {
  entityId: string
  entityName: string
  hasLocation: boolean
  onClose: () => void
}

function today(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString('uz-UZ', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
  } catch { return iso }
}

export default function ServiceProofModal({ entityId, entityName, hasLocation, onClose }: Props) {
  const [date, setDate] = useState(today())
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState<ProofData | null>(null)

  async function check() {
    setLoading(true)
    setData(null)
    try {
      const res = await ekoApi.get(`/entities/${entityId}/service-proof`, { params: { date } })
      setData(res.data.data ?? res.data)
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error || 'Xato yuz berdi'
      setData({ available: false, reason: msg })
    } finally {
      setLoading(false)
    }
  }

  const entity = data?.entity
  const osmSrc = entity
    ? `https://www.openstreetmap.org/export/embed.html?bbox=${entity.lon - 0.004}%2C${entity.lat - 0.003}%2C${entity.lon + 0.004}%2C${entity.lat + 0.003}&layer=mapnik&marker=${entity.lat}%2C${entity.lon}`
    : ''

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2 min-w-0">
            <ShieldCheck className="w-5 h-5 text-green-600 shrink-0" />
            <div className="min-w-0">
              <h3 className="font-semibold text-gray-800 truncate">{entityName}</h3>
              <p className="text-xs text-gray-500">Xizmat isboti (GPS)</p>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
          {!hasLocation ? (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
              Bu tashkilotning koordinatasi belgilanmagan. Avval xaritada joyini belgilang
              yoki dala-bot orqali geolokatsiya yuboring.
            </div>
          ) : (
            <>
              {/* Date picker + check */}
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <label className="block text-xs font-medium text-gray-600 mb-1">Sana</label>
                  <input
                    type="date"
                    value={date}
                    max={today()}
                    onChange={e => setDate(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
                  />
                </div>
                <button
                  onClick={check}
                  disabled={loading}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-60 text-white rounded-lg text-sm font-medium flex items-center gap-2"
                >
                  {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                  Tekshirish
                </button>
              </div>

              {/* Result */}
              {data && !loading && (
                <>
                  {!data.available ? (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-sm text-gray-600">
                      {data.reason || "Ma'lumot yo'q"}
                    </div>
                  ) : data.served ? (
                    <div className="space-y-3">
                      <div className="bg-green-50 border border-green-200 rounded-lg p-4 flex items-start gap-3">
                        <ShieldCheck className="w-6 h-6 text-green-600 shrink-0" />
                        <div>
                          <p className="font-semibold text-green-800 text-sm">Xizmat ko'rsatilgan</p>
                          <p className="text-xs text-green-700 mt-0.5">
                            Chiqindi mashinasi {data.radiusM} m radius ichidan o'tgan — isbot mavjud.
                          </p>
                        </div>
                      </div>

                      {(data.passingVehicles ?? []).map(v => (
                        <div key={v.vehicleId} className="border border-gray-100 rounded-lg p-3 text-sm">
                          <div className="flex items-center gap-2 font-medium text-gray-800">
                            <Truck className="w-4 h-4 text-gray-500" />
                            {v.registrationNumber || 'Mashina'}
                          </div>
                          <div className="flex items-center gap-4 mt-1.5 text-xs text-gray-600">
                            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" />{formatTime(v.passedAt)}</span>
                            <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{v.closestMeters} m</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-start gap-3">
                      <ShieldAlert className="w-6 h-6 text-red-600 shrink-0" />
                      <div>
                        <p className="font-semibold text-red-800 text-sm">Xizmat tasdiqlanmadi</p>
                        <p className="text-xs text-red-700 mt-0.5">
                          Shu kuni hech bir mashina {data.radiusM} m radius ichidan o'tmagan.
                        </p>
                      </div>
                    </div>
                  )}
                </>
              )}

              {/* Entity location map (proof context) */}
              {entity && osmSrc && (
                <div className="rounded-lg overflow-hidden border border-gray-200">
                  <iframe
                    title="Tashkilot joylashuvi"
                    src={osmSrc}
                    className="w-full h-48"
                    loading="lazy"
                  />
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
