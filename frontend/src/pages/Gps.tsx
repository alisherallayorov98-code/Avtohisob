import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Satellite, CheckCircle, AlertCircle, Clock, Link2, Link2Off, RefreshCw, ChevronDown } from 'lucide-react'
import api from '../lib/api'
import Button from '../components/ui/Button'
import toast from 'react-hot-toast'

interface GpsUnit {
  id: number
  name: string
  mileageKm: number
  engineHours: number
  lastSignal: string | null
}

interface MappedVehicle {
  id: string
  registrationNumber: string
  brand: string
  model: string
  gpsUnitName: string | null
  lastGpsSignal: string | null
  mileage: number
  gpsMatched: boolean
  effectiveLookup: string
}

function SignalBadge({ lastSignal }: { lastSignal: string | null }) {
  if (!lastSignal) return <span className="text-xs text-gray-400">Signal yo'q</span>
  const hoursAgo = (Date.now() - new Date(lastSignal).getTime()) / 3600000
  const label = hoursAgo < 1
    ? `${Math.round(hoursAgo * 60)} daqiqa oldin`
    : hoursAgo < 24
    ? `${Math.round(hoursAgo)} soat oldin`
    : `${Math.round(hoursAgo / 24)} kun oldin`
  const color = hoursAgo < 6 ? 'text-green-600' : hoursAgo < 24 ? 'text-yellow-600' : 'text-red-500'
  return <span className={`text-xs font-medium ${color}`}>{label}</span>
}

function VehicleRow({
  vehicle, gpsUnits, onMap,
}: {
  vehicle: MappedVehicle
  gpsUnits: GpsUnit[]
  mappedUnitNames: Set<string>
  onMap: (vehicleId: string, unitName: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [unitSearch, setUnitSearch] = useState('')
  const currentUnit = gpsUnits.find(u => u.name.trim().toUpperCase() === vehicle.effectiveLookup)

  const filteredUnits = gpsUnits.filter(u => {
    // Allaqachon boshqa mashina bilan bog'langan unitlarni chiqarib tashlash
    // (faqat o'zining hozirgi uniti bundan mustasno)
    const isMappedElsewhere = mappedUnitNames.has(u.name) && vehicle.gpsUnitName !== u.name
    if (isMappedElsewhere) return false
    if (!unitSearch.trim()) return true
    return u.name.toLowerCase().includes(unitSearch.trim().toLowerCase())
  })

  return (
    <tr className="border-b border-gray-50 dark:border-gray-800 hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
      <td className="py-3 pr-4">
        <div className="font-medium text-gray-900 dark:text-white text-sm">{vehicle.registrationNumber}</div>
        <div className="text-xs text-gray-400">{vehicle.brand} {vehicle.model}</div>
      </td>
      <td className="py-3 pr-4">
        {vehicle.gpsMatched ? (
          <div>
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3.5 h-3.5 text-green-500 flex-shrink-0" />
              <span className="text-sm text-gray-700 dark:text-gray-200 font-mono">
                {vehicle.gpsUnitName || vehicle.registrationNumber}
              </span>
            </div>
            {vehicle.gpsUnitName && (
              <div className="text-xs text-gray-400 mt-0.5 ml-5">Qo'lda bog'langan</div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
            <span className="text-xs text-red-500">
              "{vehicle.effectiveLookup}" — GPS da topilmadi
            </span>
          </div>
        )}
      </td>
      <td className="py-3 pr-4 text-sm text-gray-600 dark:text-gray-300">
        {currentUnit ? `${currentUnit.mileageKm.toLocaleString()} km` : '—'}
      </td>
      <td className="py-3 pr-4">
        <SignalBadge lastSignal={currentUnit?.lastSignal ?? null} />
      </td>
      <td className="py-3">
        <div className="relative">
          <button
            onClick={() => { setOpen(v => !v); setUnitSearch('') }}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-lg border border-gray-200 dark:border-gray-600 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors text-gray-600 dark:text-gray-300"
          >
            <Link2 className="w-3 h-3" />
            Bog'lash
            <ChevronDown className={`w-3 h-3 transition-transform ${open ? 'rotate-180' : ''}`} />
          </button>
          {open && (
            <div className="absolute right-0 top-8 z-20 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl shadow-xl w-80">
              {/* Search input */}
              <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                <input
                  autoFocus
                  value={unitSearch}
                  onChange={e => setUnitSearch(e.target.value)}
                  placeholder="Qidirish..."
                  className="w-full text-xs px-2.5 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div className="max-h-56 overflow-y-auto">
                {vehicle.gpsUnitName && !unitSearch && (
                  <button
                    onClick={() => { onMap(vehicle.id, null); setOpen(false) }}
                    className="w-full text-left px-3 py-2 text-xs hover:bg-red-50 dark:hover:bg-red-900/20 text-red-500 flex items-center gap-2"
                  >
                    <Link2Off className="w-3 h-3" /> Bog'lashni olib tashlash
                  </button>
                )}
                {!unitSearch && (
                  <button
                    onClick={() => { onMap(vehicle.id, vehicle.registrationNumber); setOpen(false) }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-between ${!vehicle.gpsUnitName ? 'bg-blue-50/50 dark:bg-blue-900/10' : ''}`}
                  >
                    <span className="font-mono font-medium">{vehicle.registrationNumber}</span>
                    <span className="text-gray-400 ml-2">(davlat raqami)</span>
                  </button>
                )}
                {filteredUnits.length === 0 ? (
                  <div className="px-3 py-4 text-xs text-gray-400 text-center">Topilmadi</div>
                ) : filteredUnits.map(u => (
                  <button
                    key={u.id}
                    onClick={() => { onMap(vehicle.id, u.name); setOpen(false); setUnitSearch('') }}
                    className={`w-full text-left px-3 py-2 text-xs hover:bg-blue-50 dark:hover:bg-blue-900/20 flex items-center justify-between ${vehicle.gpsUnitName === u.name ? 'bg-blue-50 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300' : ''}`}
                  >
                    <span className="font-mono font-medium">{u.name}</span>
                    <span className="text-gray-400 ml-2 text-right flex-shrink-0">
                      {u.mileageKm > 0 ? `${u.mileageKm.toLocaleString()} km` : '—'}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </td>
    </tr>
  )
}

export default function GpsPage() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')

  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ['gps-units-mapping'],
    queryFn: () => api.get('/gps/units-mapping').then(r => r.data.data as { gpsUnits: GpsUnit[]; vehicles: MappedVehicle[] }),
    retry: false,
  })

  const { data: gpsStatus } = useQuery({
    queryKey: ['gps-status'],
    queryFn: () => api.get('/gps/status').then(r => r.data.data),
  })

  const mapMut = useMutation({
    mutationFn: ({ vehicleId, gpsUnitName }: { vehicleId: string; gpsUnitName: string | null }) =>
      api.post('/gps/set-unit-mapping', { vehicleId, gpsUnitName }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['gps-units-mapping'] })
      toast.success('GPS bog\'lash saqlandi')
    },
    onError: () => toast.error('Xato yuz berdi'),
  })

  const syncMut = useMutation({
    mutationFn: () => api.post('/gps/sync').then(r => r.data),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['gps-units-mapping'] })
      const { synced, skipped } = data.data
      toast.success(`Sync: ${synced} mashina yangilandi, ${skipped} o'tkazildi`)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Sync xatosi'),
  })

  const gpsUnits: GpsUnit[] = data?.gpsUnits || []
  const vehicles: MappedVehicle[] = data?.vehicles || []

  const filteredVehicles = vehicles.filter(v =>
    v.registrationNumber.toLowerCase().includes(search.toLowerCase()) ||
    (v.gpsUnitName || '').toLowerCase().includes(search.toLowerCase())
  )

  const matchedCount = vehicles.filter(v => v.gpsMatched).length
  const unmatchedCount = vehicles.length - matchedCount

  // Allaqachon biriktirilgan GPS unit nomlarini set sifatida saqlaymiz
  const mappedUnitNames = new Set(
    vehicles
      .filter(v => v.gpsUnitName)
      .map(v => v.gpsUnitName as string)
  )

  if (!gpsStatus && !isLoading) {
    return (
      <div className="max-w-2xl mx-auto py-20 text-center">
        <Satellite className="w-16 h-16 text-gray-300 mx-auto mb-4" />
        <h2 className="text-xl font-semibold text-gray-700 dark:text-gray-300 mb-2">GPS ulanmagan</h2>
        <p className="text-gray-400 mb-6">GPS integratsiyasini yoqish uchun Sozlamalar → GPS bo'limiga o'ting</p>
        <a href="/settings" className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm">
          Sozlamalarga o'tish
        </a>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Satellite className="w-7 h-7 text-blue-600" />
            GPS Monitoring
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            GPS unitlarni mashinalar bilan bog'lash va signal holatini kuzatish
          </p>
        </div>
        <Button
          variant="primary"
          icon={<RefreshCw className="w-4 h-4" />}
          onClick={() => syncMut.mutate()}
          loading={syncMut.isPending}
        >
          Sync
        </Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">GPS Unitlar</div>
          <div className="text-2xl font-bold text-blue-600">{gpsUnits.length}</div>
          <div className="text-xs text-gray-400 mt-0.5">SmartGPS da</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">Bogʻlangan</div>
          <div className="text-2xl font-bold text-green-600">{matchedCount}</div>
          <div className="text-xs text-gray-400 mt-0.5">mashina mos keldi</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">Bogʻlanmagan</div>
          <div className={`text-2xl font-bold ${unmatchedCount > 0 ? 'text-red-500' : 'text-gray-400'}`}>{unmatchedCount}</div>
          <div className="text-xs text-gray-400 mt-0.5">qo'lda sozlash kerak</div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="text-xs text-gray-400 mb-1">Oxirgi Sync</div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-200 mt-1">
            {gpsStatus?.lastSyncAt
              ? new Date(gpsStatus.lastSyncAt).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })
              : '—'}
          </div>
          <div className={`text-xs mt-0.5 ${gpsStatus?.lastSyncStatus === 'ok' ? 'text-green-500' : gpsStatus?.lastSyncStatus === 'error' ? 'text-red-500' : 'text-gray-400'}`}>
            {gpsStatus?.lastSyncStatus === 'ok' ? 'Muvaffaqiyatli' : gpsStatus?.lastSyncStatus === 'error' ? 'Xato' : '—'}
          </div>
        </div>
      </div>

      {/* GPS Units table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between gap-3 flex-wrap">
          <h2 className="font-semibold text-gray-900 dark:text-white">Mashinalar va GPS bog'lash</h2>
          <div className="flex items-center gap-2">
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Qidirish..."
              className="text-sm px-3 py-1.5 border border-gray-200 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 w-48"
            />
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
              title="Yangilash"
            >
              <RefreshCw className={`w-4 h-4 text-gray-400 ${isFetching ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {isLoading ? (
          <div className="py-16 text-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">
            <Satellite className="w-10 h-10 mx-auto mb-3 opacity-30" />
            {search ? 'Qidiruv natijalari topilmadi' : 'Mashinalar topilmadi'}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 pb-3 pt-2 font-medium">Mashina</th>
                  <th className="pb-3 pt-2 pr-4 font-medium">GPS Unit</th>
                  <th className="pb-3 pt-2 pr-4 font-medium">GPS Km</th>
                  <th className="pb-3 pt-2 pr-4 font-medium flex items-center gap-1"><Clock className="w-3 h-3" /> Signal</th>
                  <th className="pb-3 pt-2 pr-5 font-medium text-right">Amal</th>
                </tr>
              </thead>
              <tbody>
                {filteredVehicles.map(v => (
                  <VehicleRow
                    key={v.id}
                    vehicle={v}
                    gpsUnits={gpsUnits}
                    mappedUnitNames={mappedUnitNames}
                    onMap={(vehicleId, unitName) => mapMut.mutate({ vehicleId, gpsUnitName: unitName })}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* GPS Units from SmartGPS */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
          <h2 className="font-semibold text-gray-900 dark:text-white">SmartGPS da barcha unitlar ({gpsUnits.length})</h2>
          <p className="text-xs text-gray-400 mt-0.5">GPS tizimda ro'yxatdan o'tgan barcha transport vositalari</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                <th className="px-5 pb-3 pt-2 font-medium">GPS Unit Nomi</th>
                <th className="pb-3 pt-2 pr-4 font-medium">Km (odometr)</th>
                <th className="pb-3 pt-2 pr-4 font-medium">Dvigatel soat</th>
                <th className="pb-3 pt-2 pr-5 font-medium">Oxirgi signal</th>
              </tr>
            </thead>
            <tbody>
              {gpsUnits.map(u => {
                const hoursAgo = u.lastSignal ? (Date.now() - new Date(u.lastSignal).getTime()) / 3600000 : Infinity
                return (
                  <tr key={u.id} className="border-b border-gray-50 dark:border-gray-800">
                    <td className="px-5 py-3 font-mono text-sm text-gray-900 dark:text-white">{u.name}</td>
                    <td className="py-3 pr-4 text-sm text-gray-600 dark:text-gray-300">
                      {u.mileageKm > 0 ? `${u.mileageKm.toLocaleString()} km` : '—'}
                    </td>
                    <td className="py-3 pr-4 text-sm text-gray-600 dark:text-gray-300">
                      {u.engineHours > 0 ? `${u.engineHours} s.soat` : '—'}
                    </td>
                    <td className="py-3 pr-5">
                      <div className="flex items-center gap-1.5">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${hoursAgo < 6 ? 'bg-green-500' : hoursAgo < 24 ? 'bg-yellow-500' : 'bg-red-400'}`} />
                        <SignalBadge lastSignal={u.lastSignal} />
                      </div>
                    </td>
                  </tr>
                )
              })}
              {gpsUnits.length === 0 && (
                <tr><td colSpan={4} className="py-10 text-center text-gray-400 text-sm">GPS unitlar topilmadi</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Help */}
      <div className="rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 p-4 text-sm text-blue-700 dark:text-blue-300">
        <div className="font-medium mb-1">Qanday bog'lash kerak?</div>
        <ul className="text-xs space-y-1 list-disc list-inside">
          <li>Agar GPS unit nomi bizning davlat raqamiga mos kelsa — avtomatik aniqlanadi (yashil belgi)</li>
          <li>Mos kelmasa — "Bog'lash" tugmasi orqali GPS unitni tanlab bog'lang</li>
          <li>Bir marta sozlangan — keyinchalik avtomatik ishlaydi</li>
          <li>GPS km olish uchun "Sync" bosing yoki har 6 soatda avtomatik yangilanadi</li>
        </ul>
      </div>
    </div>
  )
}
