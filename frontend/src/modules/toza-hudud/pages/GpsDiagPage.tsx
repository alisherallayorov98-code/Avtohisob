import { useQuery } from '@tanstack/react-query'
import { Wifi, WifiOff, CheckCircle2, AlertTriangle, RefreshCw, Cpu } from 'lucide-react'
import api from '../../../lib/api'

interface HealthData {
  connected: boolean
  unitCount?: number
  tokenExpiresAt?: string | null
  error?: string
  lastSyncAt?: string | null
  lastSyncStatus?: string | null
  lastSyncError?: string | null
  host?: string
}

interface VehicleMatch {
  vehicleId: string
  lookupKey: string
  gpsUnitName?: string
  registrationNumber: string
}

function fmt(dt?: string | null) {
  if (!dt) return '—'
  return new Date(dt).toLocaleString('uz-UZ', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

export default function GpsDiagPage() {
  const { data: health, isLoading: hLoading, refetch: refetchHealth, isFetching: hFetching } = useQuery<HealthData>({
    queryKey: ['th-gps-health'],
    queryFn: () => api.get('/th/gps/health-check').then(r => r.data.data),
    refetchInterval: 2 * 60 * 1000,
  })

  const { data: matchData, isLoading: mLoading } = useQuery<{ vehicles: VehicleMatch[] }>({
    queryKey: ['th-gps-unit-match'],
    queryFn: () => api.get('/th/gps/unit-match').then(r => r.data.data),
  })

  return (
    <div className="p-5 space-y-5 overflow-y-auto h-full max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-gray-800">GPS Diagnostika</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Wialon/SmartGPS ulanishi holati va mashina moslashuvi
        </p>
      </div>

      {/* Ulanish holati */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Cpu className="w-4 h-4 text-gray-600" />
            <p className="font-semibold text-gray-800">GPS server holati</p>
          </div>
          <button
            onClick={() => refetchHealth()}
            disabled={hFetching}
            className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${hFetching ? 'animate-spin' : ''}`} />
            Yangilash
          </button>
        </div>

        {hLoading ? (
          <div className="text-sm text-gray-400">Yuklanmoqda...</div>
        ) : health ? (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              {health.connected
                ? <Wifi className="w-5 h-5 text-emerald-600" />
                : <WifiOff className="w-5 h-5 text-red-500" />}
              <span className={`px-2.5 py-0.5 rounded-full text-sm font-medium ${
                health.connected
                  ? 'bg-emerald-100 text-emerald-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {health.connected ? 'Ulangan' : 'Uzilgan'}
              </span>
              {health.connected && health.unitCount != null && (
                <span className="text-sm text-gray-500">{health.unitCount} ta unit</span>
              )}
            </div>

            {health.error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-xs text-red-700">
                <p className="font-medium mb-0.5">Xato:</p>
                <p>{health.error}</p>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {health.host && (
                <div>
                  <p className="text-xs text-gray-400 mb-0.5">Server</p>
                  <p className="font-mono text-xs text-gray-700 truncate">{health.host}</p>
                </div>
              )}
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Oxirgi sinx</p>
                <p className="text-xs text-gray-700">{fmt(health.lastSyncAt)}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400 mb-0.5">Token muddati</p>
                <p className={`text-xs ${
                  health.tokenExpiresAt && new Date(health.tokenExpiresAt) < new Date(Date.now() + 10 * 24 * 3600 * 1000)
                    ? 'text-amber-600 font-medium'
                    : 'text-gray-700'
                }`}>
                  {fmt(health.tokenExpiresAt)}
                </p>
              </div>
            </div>

            {health.lastSyncError && (
              <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-xs text-amber-800">
                <p className="font-medium mb-0.5">Sinx xatosi:</p>
                <p>{health.lastSyncError}</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">GPS ulanishi topilmadi</p>
        )}
      </div>

      {/* Mashina — GPS unit moslashuvi */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-center gap-2 mb-4">
          <CheckCircle2 className="w-4 h-4 text-gray-600" />
          <p className="font-semibold text-gray-800">Mashina — GPS unit moslashuvi</p>
        </div>

        {mLoading ? (
          <div className="text-sm text-gray-400">Yuklanmoqda...</div>
        ) : matchData?.vehicles && matchData.vehicles.length > 0 ? (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 mb-3">
              GPS da unit nomi "Lookup key" bilan mos kelishi kerak (katta-kichik harf farqsiz, ± 2 ta imlo xatosi ruxsat).
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="text-left py-2 pr-3 text-gray-500 font-medium">Ro'yxatdan o'tish raqami</th>
                    <th className="text-left py-2 pr-3 text-gray-500 font-medium">GPS unit nomi (qo'lda)</th>
                    <th className="text-left py-2 text-gray-500 font-medium">GPS qidiruv kaliti</th>
                  </tr>
                </thead>
                <tbody>
                  {matchData.vehicles.map(v => (
                    <tr key={v.vehicleId} className="border-b border-gray-50 hover:bg-gray-50">
                      <td className="py-2 pr-3 font-mono text-gray-700">{v.registrationNumber}</td>
                      <td className="py-2 pr-3 text-gray-500">{v.gpsUnitName || <span className="italic text-gray-300">sozlanmagan</span>}</td>
                      <td className="py-2 font-mono font-medium text-emerald-700">{v.lookupKey}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 bg-blue-50 border border-blue-200 rounded-lg p-3 text-xs text-blue-800">
              <AlertTriangle className="w-3.5 h-3.5 inline mr-1" />
              GPS da unit nomi "Lookup key" bilan mos kelmasa — mashina treki olinmaydi.
              Avtohisob → Mashina → GPS unit nomi maydonida nomi moslang.
            </div>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Mashina topilmadi</p>
        )}
      </div>
    </div>
  )
}
