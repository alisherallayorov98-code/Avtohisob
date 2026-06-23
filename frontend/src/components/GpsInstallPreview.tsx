import { useState, useEffect } from 'react'
import api from '../lib/api'

// O'rnatish/tahrirlash formasida jonli GPS preview (motor yog'idagi km-at-date kabi):
// tanlangan sanadan bugungacha GPS km va "hozirgi km = o'rnatilgan odometr + GPS".
export default function GpsInstallPreview({ vehicleId, installDate, odometer }: {
  vehicleId?: string
  installDate?: string
  odometer?: string
}) {
  const [state, setState] = useState<{ loading: boolean; km: number | null }>({ loading: false, km: null })

  useEffect(() => {
    if (!vehicleId || !installDate) { setState({ loading: false, km: null }); return }
    setState({ loading: true, km: null })
    const t = setTimeout(async () => {
      try {
        const r = await api.get('/tires/gps-preview', { params: { vehicleId, installDate } })
        setState({ loading: false, km: r.data.data?.found ? Number(r.data.data.gpsKm) : null })
      } catch { setState({ loading: false, km: null }) }
    }, 500)
    return () => clearTimeout(t)
  }, [vehicleId, installDate])

  if (!vehicleId || !installDate) return null
  if (state.loading) return <p className="text-xs text-gray-400 mt-1">📡 GPS hisoblanmoqda...</p>
  if (state.km == null) return <p className="text-xs text-amber-600 dark:text-amber-400 mt-1">📡 GPS ma'lumoti topilmadi (qurilma nomi yoki sana tekshiring)</p>
  const base = Number(odometer) || 0
  return (
    <div className="text-xs mt-1 space-y-0.5">
      <p className="font-medium text-blue-600 dark:text-blue-400">📡 GPS: sanadan beri +{state.km.toLocaleString()} km yurgan</p>
      {base > 0 && (
        <p className="text-gray-500 dark:text-gray-400">
          Hozirgi km = {base.toLocaleString()} + {state.km.toLocaleString()} = <span className="font-bold text-gray-900 dark:text-white">{(base + state.km).toLocaleString()} km</span>
        </p>
      )}
    </div>
  )
}
