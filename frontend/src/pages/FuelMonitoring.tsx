/**
 * Bakdagi yoqilg'i — real-time monitoring.
 *
 * - Har 30s avto-refresh (frontend polling)
 * - "Live" indikatori — oxirgi sync vaqti ko'rsatiladi
 * - Status badge: Live / Stale / No signal / Not configured
 * - Kritik (< 10%) va past (< 25%) darajalar rang bilan ajratiladi
 * - Mashinaga bosilganda — sutkalik grafik (Recharts)
 * - Bak hajmi va sensor nomini sozlash modal'i
 */
import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Fuel, RefreshCw, AlertTriangle, CheckCircle, Settings, X, TrendingDown, TrendingUp, Activity, HelpCircle, DollarSign, Sparkles, MapPin, FileDown } from 'lucide-react'
import api from '../lib/api'
import { fuelUnit, FUEL_TYPES } from '../lib/utils'
import Button from '../components/ui/Button'
import toast from 'react-hot-toast'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

interface FuelLevel {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  tankCapacity: number | null
  currentLiters: number | null
  percentage: number | null
  sensorName: string | null
  gpsUnitName: string | null
  lastUpdate: string | null
  ageSec: number | null
  status: 'no_setup' | 'no_signal' | 'live' | 'stale' | 'ok'
  level: 'critical' | 'low' | 'normal' | null
}

interface LevelsResponse {
  success: true
  data: FuelLevel[]
  meta: { total: number; cacheAgeSec: number | null; syncTriggered: boolean }
}

const STATUS_CONFIG: Record<FuelLevel['status'], { label: string; color: string; dot: string }> = {
  live:      { label: 'Live',         color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400', dot: 'bg-green-500 animate-pulse' },
  stale:     { label: 'Eskirayapti',  color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400', dot: 'bg-yellow-500' },
  ok:        { label: 'OK',           color: 'bg-gray-100 text-gray-700 dark:bg-gray-900/30 dark:text-gray-400', dot: 'bg-gray-400' },
  no_signal: { label: 'Signal yo\'q', color: 'bg-rose-100 text-rose-700 dark:bg-rose-900/30 dark:text-rose-400', dot: 'bg-rose-500' },
  no_setup:  { label: 'Sozlanmagan',  color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400', dot: 'bg-blue-400' },
}

function formatAge(sec: number | null): string {
  if (sec == null) return '—'
  if (sec < 60) return `${sec} sek`
  if (sec < 3600) return `${Math.floor(sec / 60)} daq`
  if (sec < 86400) return `${Math.floor(sec / 3600)} soat`
  return `${Math.floor(sec / 86400)} kun`
}

function levelBarColor(level: FuelLevel['level']): string {
  if (level === 'critical') return 'bg-rose-500'
  if (level === 'low') return 'bg-amber-500'
  if (level === 'normal') return 'bg-green-500'
  return 'bg-gray-300'
}

export default function FuelMonitoring() {
  const qc = useQueryClient()
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [settingsVehicleId, setSettingsVehicleId] = useState<string | null>(null)
  const [bulkOpen, setBulkOpen] = useState(false)

  // ─── Levels (real-time, polling every 30s) ──────────────────────────────
  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<LevelsResponse>({
    queryKey: ['fuel-monitoring', 'levels'],
    queryFn: () => api.get('/fuel-monitoring/levels').then(r => r.data),
    refetchInterval: 30 * 1000,           // 30s polling
    refetchIntervalInBackground: false,    // tab background bo'lsa to'xtaydi (battery save)
  })

  // Manual refresh — backend Wialon'dan tortib oladi
  const refreshMut = useMutation({
    mutationFn: () => api.post('/fuel-monitoring/refresh').then(r => r.data),
    onSuccess: () => {
      toast.success('Yangilandi — qiymatlar 30 sekund ichida ko\'rinadi')
      qc.invalidateQueries({ queryKey: ['fuel-monitoring', 'levels'] })
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Xatolik'),
  })

  const vehicles = data?.data || []

  // Tartiblash: kritik birinchi, keyin pastlar, keyin oddiy, oxirida sozlanmaganlar
  const sorted = useMemo(() => {
    const order = (v: FuelLevel) => {
      if (v.level === 'critical') return 0
      if (v.level === 'low') return 1
      if (v.status === 'no_signal') return 2
      if (v.level === 'normal') return 3
      return 4  // no_setup oxirida
    }
    return [...vehicles].sort((a, b) => order(a) - order(b) || a.registrationNumber.localeCompare(b.registrationNumber))
  }, [vehicles])

  // Statistika
  const stats = useMemo(() => ({
    total: vehicles.length,
    live: vehicles.filter(v => v.status === 'live').length,
    critical: vehicles.filter(v => v.level === 'critical').length,
    low: vehicles.filter(v => v.level === 'low').length,
    noSignal: vehicles.filter(v => v.status === 'no_signal').length,
    noSetup: vehicles.filter(v => v.status === 'no_setup').length,
  }), [vehicles])

  // "Sahifa ochiq" indikatori — oxirgi yangilanish vaqti
  const [tick, setTick] = useState(0)
  useEffect(() => {
    const i = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(i)
  }, [])
  const ageSinceFetch = dataUpdatedAt ? Math.floor((Date.now() - dataUpdatedAt) / 1000) : null
  void tick // satisfy linter — used to retrigger render

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <Fuel className="w-7 h-7 text-amber-500" />
            Bakdagi yoqilg'i
          </h1>
          <div className="text-sm text-gray-500 mt-1 flex items-center gap-3">
            <span className="flex items-center gap-1.5">
              <span className={`w-2 h-2 rounded-full ${isFetching ? 'bg-amber-500 animate-pulse' : 'bg-green-500'}`} />
              {isFetching ? 'Yangilanmoqda...' : 'Real-time · har 30s yangilanadi'}
            </span>
            {ageSinceFetch != null && <span>· oxirgi: {ageSinceFetch}s oldin</span>}
          </div>
        </div>
        <div className="flex gap-2">
          <ExcelReportButton />
          <Button onClick={() => refreshMut.mutate()} disabled={refreshMut.isPending} variant="secondary">
            <RefreshCw className={`w-4 h-4 ${refreshMut.isPending ? 'animate-spin' : ''}`} />
            Yangilash
          </Button>
        </div>
      </div>

      {/* Savings widget — sliv aniqlash bilan tejov hisobi */}
      <SavingsWidget />

      {/* Efficiency widget — eng yomon va eng yaxshi mashinalar */}
      <EfficiencyWidget />

      {/* Stats cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Jami" value={stats.total} icon={<Activity className="w-4 h-4" />} color="text-gray-700" />
        <StatCard label="Live" value={stats.live} icon={<CheckCircle className="w-4 h-4" />} color="text-green-600" />
        <StatCard label="Kritik" value={stats.critical} icon={<AlertTriangle className="w-4 h-4" />} color="text-rose-600" highlight={stats.critical > 0} />
        <StatCard label="Past" value={stats.low} icon={<TrendingDown className="w-4 h-4" />} color="text-amber-600" />
        <StatCard label="Signal yo'q" value={stats.noSignal} icon={<HelpCircle className="w-4 h-4" />} color="text-rose-500" />
        <StatCard label="Sozlanmagan" value={stats.noSetup} icon={<Settings className="w-4 h-4" />} color="text-blue-600" />
      </div>

      {/* No-setup hint + bulk action */}
      {stats.noSetup > 0 && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-xl p-4 text-sm flex flex-wrap items-start justify-between gap-3">
          <div className="flex-1">
            <div className="font-semibold text-blue-900 dark:text-blue-300 mb-1">{stats.noSetup} ta mashina sozlanmagan</div>
            <div className="text-blue-700 dark:text-blue-400">
              Bak hajmi (litr) va Wialon sensor nomini kiriting — keyin sensor qiymatlari avtomatik o'qiladi.
              Sozlash uchun mashinaning yonidagi <Settings className="inline w-3 h-3" /> tugmasini bosing yoki <b>ommaviy import</b> tugmasidan foydalaning.
            </div>
          </div>
          <Button onClick={() => setBulkOpen(true)} variant="primary">
            <Settings className="w-4 h-4" />
            Ommaviy sozlash
          </Button>
        </div>
      )}

      {/* Vehicle list */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-500">Yuklanmoqda...</div>
      ) : sorted.length === 0 ? (
        <div className="text-center py-12 bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
          <Fuel className="w-12 h-12 mx-auto text-gray-300 mb-3" />
          <div className="text-gray-500">Mashinalar topilmadi</div>
        </div>
      ) : (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
          <div className="divide-y divide-gray-100 dark:divide-gray-700">
            {sorted.map(v => (
              <VehicleRow
                key={v.vehicleId}
                v={v}
                onSelect={() => setSelectedVehicleId(v.vehicleId)}
                onSettings={() => setSettingsVehicleId(v.vehicleId)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Detail modal — sutkalik grafik */}
      {selectedVehicleId && (
        <FuelHistoryModal
          vehicleId={selectedVehicleId}
          onClose={() => setSelectedVehicleId(null)}
        />
      )}

      {/* Settings modal — bak hajmi va sensor nomi */}
      {settingsVehicleId && (
        <FuelSettingsModal
          vehicleId={settingsVehicleId}
          vehicle={vehicles.find(v => v.vehicleId === settingsVehicleId)!}
          onClose={() => setSettingsVehicleId(null)}
          onSaved={() => {
            setSettingsVehicleId(null)
            qc.invalidateQueries({ queryKey: ['fuel-monitoring', 'levels'] })
          }}
        />
      )}

      {/* Bulk setup modal */}
      {bulkOpen && (
        <BulkTankSetupModal
          vehicles={vehicles}
          onClose={() => setBulkOpen(false)}
          onSaved={() => {
            setBulkOpen(false)
            qc.invalidateQueries({ queryKey: ['fuel-monitoring', 'levels'] })
          }}
        />
      )}
    </div>
  )
}

// ─── Stat card ───────────────────────────────────────────────────────────────
function StatCard({ label, value, icon, color, highlight }: { label: string; value: number; icon: React.ReactNode; color: string; highlight?: boolean }) {
  return (
    <div className={`rounded-xl border p-3 ${highlight ? 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800' : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-700'}`}>
      <div className={`flex items-center gap-1.5 text-xs font-medium ${color} mb-1`}>
        {icon}
        {label}
      </div>
      <div className={`text-2xl font-bold ${highlight ? 'text-rose-700 dark:text-rose-400' : 'text-gray-900 dark:text-white'}`}>{value}</div>
    </div>
  )
}

// ─── Vehicle row ─────────────────────────────────────────────────────────────
function VehicleRow({ v, onSelect, onSettings }: { v: FuelLevel; onSelect: () => void; onSettings: () => void }) {
  const cfg = STATUS_CONFIG[v.status]
  const pct = v.percentage ?? 0

  return (
    <div className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors flex items-center gap-4">
      <button onClick={onSelect} className="flex-1 text-left flex items-center gap-4 min-w-0">
        <div className="w-32 flex-shrink-0">
          <div className="font-semibold text-gray-900 dark:text-white truncate">{v.registrationNumber}</div>
          <div className="text-xs text-gray-500 truncate">{v.brand} {v.model}</div>
        </div>

        {/* Tank visual */}
        <div className="flex-1 min-w-0">
          {v.percentage != null ? (
            <>
              <div className="flex items-baseline gap-2 mb-1">
                <span className="text-lg font-bold text-gray-900 dark:text-white">
                  {v.currentLiters?.toFixed(1)} L
                </span>
                <span className="text-sm text-gray-500">
                  / {v.tankCapacity} L
                </span>
                <span className={`text-sm font-semibold ${v.level === 'critical' ? 'text-rose-600' : v.level === 'low' ? 'text-amber-600' : 'text-gray-700 dark:text-gray-300'}`}>
                  {v.percentage.toFixed(1)}%
                </span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all ${levelBarColor(v.level)}`}
                  style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                />
              </div>
            </>
          ) : (
            <div className="text-sm text-gray-400 italic">
              {v.status === 'no_setup' ? 'Bak hajmi sozlanmagan' : 'Ma\'lumot yo\'q'}
            </div>
          )}
        </div>

        {/* Status & age */}
        <div className="text-right flex-shrink-0 hidden sm:block">
          <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-semibold ${cfg.color}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
            {cfg.label}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">{formatAge(v.ageSec)} oldin</div>
        </div>
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onSettings() }}
        className="p-2 rounded-lg hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
        title="Sozlash"
      >
        <Settings className="w-4 h-4" />
      </button>
    </div>
  )
}

// ─── History modal — sutkalik grafik ─────────────────────────────────────────
function FuelHistoryModal({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const [hours, setHours] = useState(24)
  const [mapAnomaly, setMapAnomaly] = useState<{ lat: number; lon: number; time: string; level: number; deltaL: number | null; anomaly: string; reg: string; driverName: string | null } | null>(null)
  const { data, isLoading } = useQuery({
    queryKey: ['fuel-monitoring', 'history', vehicleId, hours],
    queryFn: () => api.get(`/fuel-monitoring/${vehicleId}/history`, { params: { hours } }).then(r => r.data),
  })

  const chartData = useMemo(() => {
    const r = data?.data?.readings || []
    return r.map((p: any) => ({
      time: new Date(p.capturedAt).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' }),
      level: p.level,
      anomaly: p.anomaly,
      deltaL: p.deltaL,
      lat: p.lat,
      lon: p.lon,
      driverName: p.driverName,
      capturedAt: p.capturedAt,
    }))
  }, [data])

  // Anomaliya nuqtalari (xaritada ko'rsatish uchun)
  const anomalyPoints = useMemo(() => {
    return chartData.filter((p: any) => p.anomaly && p.lat != null && p.lon != null)
  }, [chartData])

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">
              {data?.data?.vehicle?.registrationNumber || '...'}
            </h3>
            <div className="text-sm text-gray-500">Bak miqdori tarixi · {data?.data?.meta?.count || 0} ta yozuv</div>
          </div>
          <div className="flex items-center gap-2">
            <select value={hours} onChange={e => setHours(Number(e.target.value))} className="text-sm border border-gray-200 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-700 text-gray-900 dark:text-white">
              <option value={6}>6 soat</option>
              <option value={24}>24 soat</option>
              <option value={72}>3 kun</option>
              <option value={168}>7 kun</option>
            </select>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="p-5">
          {isLoading ? (
            <div className="h-64 flex items-center justify-center text-gray-400">Yuklanmoqda...</div>
          ) : chartData.length === 0 ? (
            <div className="h-64 flex flex-col items-center justify-center text-gray-400">
              <Activity className="w-12 h-12 mb-2" />
              <div>Bu davr uchun ma'lumot yo'q</div>
            </div>
          ) : (
            <>
              <div className="h-72">
                <ResponsiveContainer>
                  <LineChart data={chartData}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="time" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} label={{ value: 'Litr', angle: -90, position: 'insideLeft' }} />
                    <Tooltip
                      content={({ active, payload }) => {
                        if (!active || !payload?.[0]) return null
                        const p = payload[0].payload as any
                        return (
                          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg px-3 py-2 text-xs max-w-xs">
                            <div className="font-semibold">{p.time}</div>
                            <div>{Number(p.level).toFixed(1)} L</div>
                            {p.anomaly === 'theft' && <div className="text-rose-600 font-semibold mt-1">🚨 Sliv ehtimoli</div>}
                            {p.anomaly === 'refuel' && <div className="text-green-600 font-semibold mt-1">✓ Zapravka (chek bilan)</div>}
                            {p.anomaly === 'unrecorded_refuel' && <div className="text-amber-600 font-semibold mt-1">⚠️ Qayd etilmagan zapravka</div>}
                            {p.driverName && p.anomaly && (
                              <div className="text-gray-600 dark:text-gray-300 mt-1 pt-1 border-t border-gray-100 dark:border-gray-700">
                                👤 {p.driverName}
                              </div>
                            )}
                          </div>
                        )
                      }}
                    />
                    {data?.data?.vehicle?.tankCapacity && <ReferenceLine y={data.data.vehicle.tankCapacity} stroke="#22c55e" strokeDasharray="3 3" label="Bak hajmi" />}
                    <Line
                      type="monotone"
                      dataKey="level"
                      stroke="#f59e0b"
                      strokeWidth={2}
                      dot={(props: any) => {
                        const { cx, cy, payload } = props
                        if (!payload?.anomaly) return null as any  // oddiy nuqtalar ko'rsatilmaydi (chiziq toza)
                        const color =
                          payload.anomaly === 'theft' ? '#dc2626' :        // qizil — sliv
                          payload.anomaly === 'unrecorded_refuel' ? '#d97706' : // sariq — shubhali
                          '#16a34a'                                         // yashil — qonuniy refuel
                        const hasGps = payload.lat != null && payload.lon != null
                        return (
                          <circle
                            key={`d-${cx}-${cy}`}
                            cx={cx} cy={cy} r={5}
                            fill={color}
                            stroke="#fff"
                            strokeWidth={2}
                            style={{ cursor: hasGps ? 'pointer' : 'default' }}
                            onClick={() => {
                              if (!hasGps) return
                              setMapAnomaly({
                                lat: payload.lat,
                                lon: payload.lon,
                                time: payload.time,
                                level: payload.level,
                                deltaL: payload.deltaL,
                                anomaly: payload.anomaly,
                                reg: data?.data?.vehicle?.registrationNumber || '',
                                driverName: payload.driverName ?? null,
                              })
                            }}
                          />
                        )
                      }}
                      activeDot={{ r: 6 }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              {/* Legend */}
              <div className="mt-4 flex flex-wrap gap-4 text-xs text-gray-600 dark:text-gray-400 justify-center">
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-rose-600 border-2 border-white" />
                  Sliv ehtimoli
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-amber-600 border-2 border-white" />
                  Qayd etilmagan zapravka
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-full bg-green-600 border-2 border-white" />
                  Qonuniy zapravka
                </span>
              </div>
              {anomalyPoints.length > 0 && (
                <div className="mt-3 text-center text-xs text-blue-600 dark:text-blue-400 flex items-center justify-center gap-1.5">
                  <MapPin className="w-3 h-3" />
                  Anomaliya nuqtasiga bosing — xaritada qaerda bo'lganini ko'ring
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Theft location map modal */}
      {mapAnomaly && <TheftLocationModal {...mapAnomaly} onClose={() => setMapAnomaly(null)} />}
    </div>
  )
}

// ─── Theft location map modal ────────────────────────────────────────────────
function TheftLocationModal(props: {
  lat: number; lon: number; time: string; level: number; deltaL: number | null;
  anomaly: string; reg: string; driverName: string | null; onClose: () => void
}) {
  const { lat, lon, time, level, deltaL, anomaly, reg, driverName, onClose } = props
  // Custom div icon — Leaflet default ikonkalari Vite/React bilan ishlamaydi
  const icon = useMemo(() => L.divIcon({
    className: 'theft-location-marker',
    html: `<div style="background:${anomaly === 'theft' ? '#dc2626' : '#d97706'};width:24px;height:24px;border-radius:50%;border:3px solid white;box-shadow:0 2px 8px rgba(0,0,0,0.3);"></div>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
  }), [anomaly])

  const title = anomaly === 'theft' ? '🚨 Sliv joyi' : '⚠️ Qayd etilmagan zapravka'
  const yandexUrl = `https://yandex.com/maps/?ll=${lon},${lat}&z=17&pt=${lon},${lat}`

  return (
    <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{title}</h3>
            <div className="text-sm text-gray-500 mt-0.5">
              <span className="font-semibold text-gray-700 dark:text-gray-300">{reg}</span> · {time}
              {deltaL != null && <span className={`ml-2 font-semibold ${deltaL < 0 ? 'text-rose-600' : 'text-amber-600'}`}>{deltaL > 0 ? '+' : ''}{deltaL.toFixed(1)} L</span>}
            </div>
            {driverName && (
              <div className="text-sm mt-1.5 inline-flex items-center gap-1.5 px-2.5 py-1 bg-amber-50 dark:bg-amber-900/30 text-amber-800 dark:text-amber-300 rounded-lg">
                <span className="text-base">👤</span>
                <span className="font-semibold">{driverName}</span>
                <span className="text-amber-600 dark:text-amber-400 text-xs">— yo'l varaqasida</span>
              </div>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="flex-1 min-h-[400px] relative">
          <MapContainer center={[lat, lon]} zoom={16} style={{ height: '100%', minHeight: 400, width: '100%' }} scrollWheelZoom>
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            />
            <Marker position={[lat, lon]} icon={icon}>
              <Popup>
                <div className="text-sm">
                  <div className="font-bold mb-1">{reg}</div>
                  <div>{title}</div>
                  <div className="text-gray-500 mt-1">{time}</div>
                  <div>Bak: {level.toFixed(1)} L</div>
                  {deltaL != null && <div className={deltaL < 0 ? 'text-rose-600 font-semibold' : 'text-amber-600 font-semibold'}>O'zgarish: {deltaL > 0 ? '+' : ''}{deltaL.toFixed(1)} L</div>}
                </div>
              </Popup>
            </Marker>
          </MapContainer>
        </div>

        <div className="flex items-center justify-between gap-3 p-4 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="text-xs text-gray-500 font-mono">
            {lat.toFixed(6)}, {lon.toFixed(6)}
          </div>
          <a
            href={yandexUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-medium text-blue-600 hover:underline flex items-center gap-1.5"
          >
            <MapPin className="w-4 h-4" />
            Yandex Maps'da ochish
          </a>
        </div>
      </div>
    </div>
  )
}

// ─── Settings modal — bak hajmi va sensor ────────────────────────────────────
function FuelSettingsModal({ vehicleId, vehicle, onClose, onSaved }: { vehicleId: string; vehicle: FuelLevel; onClose: () => void; onSaved: () => void }) {
  const [tankCapacity, setTankCapacity] = useState(vehicle.tankCapacity?.toString() ?? '')
  const [sensorName, setSensorName] = useState(vehicle.sensorName ?? '')

  const saveMut = useMutation({
    mutationFn: () => api.patch(`/fuel-monitoring/${vehicleId}/settings`, {
      tankCapacity: tankCapacity ? Number(tankCapacity) : null,
      fuelSensorName: sensorName || null,
    }).then(r => r.data),
    onSuccess: () => {
      toast.success('Saqlandi')
      onSaved()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Xatolik'),
  })

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-md w-full" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">{vehicle.registrationNumber}</h3>
            <div className="text-sm text-gray-500">Yoqilg'i sensor sozlash</div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Bak hajmi (litr)</label>
            <input
              type="number"
              value={tankCapacity}
              onChange={e => setTankCapacity(e.target.value)}
              placeholder="masalan, 400"
              min={0}
              max={10000}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
            />
            <div className="text-xs text-gray-500 mt-1">Mashina texnik passportidan oling. Buni sozlamasdan foiz hisobi ko'rinmaydi.</div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">Wialon sensor nomi (ixtiyoriy)</label>
            <input
              type="text"
              value={sensorName}
              onChange={e => setSensorName(e.target.value)}
              placeholder="Bo'sh qoldirsangiz, avto-aniqlash (Топливо, FLS1...)"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
            />
            <div className="text-xs text-gray-500 mt-1">Wialon kabinetida sensor nomi xuddi shunday yozilgan bo'lishi kerak.</div>
          </div>

          <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3 text-xs text-amber-800 dark:text-amber-300">
            <strong>Eslatma:</strong> bak hajmi va sensor faqat <em>foiz hisobi</em> uchun kerak. Sensor topilmasa, litr qiymati ko'rinmaydi.
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-gray-200 dark:border-gray-700">
          <Button variant="secondary" onClick={onClose} className="flex-1">Bekor</Button>
          <Button onClick={() => saveMut.mutate()} disabled={saveMut.isPending} className="flex-1">Saqlash</Button>
        </div>
      </div>
    </div>
  )
}

// ─── Excel hisobot tugmasi (3 tarif: 7 kun / oy / yil) ──────────────────────
function ExcelReportButton() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState<number | null>(null)
  const { i18n } = useTranslation()
  const getToken = () => localStorage.getItem('accessToken')

  async function downloadReport(days: number) {
    setLoading(days)
    try {
      const res = await fetch(`/api/fuel-monitoring/report?days=${days}&lang=${i18n.language}`, {
        headers: { Authorization: `Bearer ${getToken()}` },
      })
      if (!res.ok) {
        toast.error('Hisobot yuklab bo\'lmadi')
        return
      }
      const cd = res.headers.get('Content-Disposition') || ''
      const m = cd.match(/filename\*=UTF-8''([^\s;]+)/i) || cd.match(/filename="([^"]+)"/)
      const fname = m ? decodeURIComponent(m[1]) : `yoqilgi-hisobot-${days}kun.xlsx`
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast.success('Excel yuklab olindi')
      setOpen(false)
    } catch {
      toast.error('Tarmoq xatosi')
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg font-medium text-sm bg-emerald-600 hover:bg-emerald-700 text-white transition-colors"
      >
        <FileDown className="w-4 h-4" />
        Excel hisobot
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-30" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 w-44 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-40 py-1">
            {([
              [7, '7 kun'],
              [30, 'Oy (30 kun)'],
              [90, '3 oy'],
              [365, 'Yil'],
            ] as const).map(([d, label]) => (
              <button
                key={d}
                onClick={() => downloadReport(d)}
                disabled={loading !== null}
                className="w-full text-left px-4 py-2 text-sm hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-200 disabled:opacity-50"
              >
                {loading === d ? 'Yuklanmoqda...' : label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// ─── Efficiency widget — L/100km bo'yicha eng yomon/yaxshi mashinalar ────────
function EfficiencyWidget() {
  const [days, setDays] = useState<7 | 30 | 90>(30)
  const { data, isLoading } = useQuery({
    queryKey: ['fuel-monitoring', 'efficiency', days],
    queryFn: () => api.get('/fuel-monitoring/efficiency', { params: { days } }).then(r => r.data),
    staleTime: 5 * 60_000,  // 5 daqiqa cache
    refetchOnWindowFocus: false,
  })

  if (isLoading) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5 animate-pulse">
        <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-32 mb-3" />
        <div className="h-20 bg-gray-100 dark:bg-gray-700 rounded" />
      </div>
    )
  }

  const stats = data?.data
  if (!stats) return null

  const items = stats.items as any[]
  const computed = items.filter(i => i.lPer100km != null)

  // Yetarli ma'lumot yo'q — widget'ni yashiramiz
  if (computed.length === 0) {
    return (
      <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-2xl p-5 text-sm text-blue-700 dark:text-blue-300">
        <div className="font-semibold mb-1 flex items-center gap-2">
          <TrendingUp className="w-4 h-4" />
          Yoqilg'i samaradorligi
        </div>
        <div className="text-xs">
          {stats.days} kun ichida yetarli ma'lumot to'planmagan (km va yoqilg'i kirimi).
          Mashinalar GPS bilan ulansin va FuelRecord kiritilsin — keyin L/100km hisoblanadi.
        </div>
      </div>
    )
  }

  const worst = computed.slice(0, 3)
  const best = [...computed].reverse().slice(0, 3)
  const avgRate = stats.stats.avg
  // Birlik: gaz m³, qolgani L. Park bir xil bo'lsa header shu birlikni ko'rsatadi.
  const headerUnit = computed.length ? fuelUnit(computed[0].fuelType) : 'L'

  const colorForRate = (r: number) => {
    if (avgRate == null) return 'text-gray-700'
    if (r > avgRate * 1.3) return 'text-rose-600 dark:text-rose-400'
    if (r > avgRate * 1.1) return 'text-amber-600 dark:text-amber-400'
    return 'text-green-600 dark:text-green-400'
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
        <div>
          <h3 className="font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <TrendingUp className="w-4 h-4 text-blue-500" />
            Yoqilg'i samaradorligi ({headerUnit}/100 km)
          </h3>
          <div className="text-xs text-gray-500 mt-0.5">
            O'rtacha: <b className="text-gray-700 dark:text-gray-300">{avgRate} {headerUnit}/100km</b>
            {' · '} Min: {stats.stats.min} {' · '} Max: {stats.stats.max}
            {' · '} Hisoblangan: {stats.stats.computedCount}/{stats.stats.totalVehicles} mashina
          </div>
        </div>
        <div className="flex gap-1 p-1 bg-gray-100 dark:bg-gray-700 rounded-lg text-xs font-semibold" data-no-translate>
          {([7, 30, 90] as const).map(d => (
            <button key={d} onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded transition-colors ${days === d ? 'bg-white dark:bg-gray-800 text-blue-700 dark:text-blue-400 shadow-sm' : 'text-gray-600 dark:text-gray-400 hover:text-gray-900'}`}
            >{d} kun</button>
          ))}
        </div>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        {/* Worst — sarflagan ko'p */}
        <div>
          <div className="text-xs font-semibold text-rose-700 dark:text-rose-400 mb-2 uppercase">⚠️ Eng ko'p sarflaydigan</div>
          <div className="space-y-1.5">
            {worst.map((v, i) => (
              <div key={v.vehicleId} className="flex items-center justify-between text-sm bg-rose-50/40 dark:bg-rose-900/10 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                  <span className="font-semibold truncate">{v.registrationNumber}</span>
                  <span className="text-xs text-gray-500 truncate hidden sm:inline">{v.brand}</span>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className={`font-bold ${colorForRate(v.lPer100km)}`}>{v.lPer100km} {fuelUnit(v.fuelType)}/100km</div>
                  <div className="text-[10px] text-gray-500">{v.km} km · {v.liters} {fuelUnit(v.fuelType)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Best */}
        <div>
          <div className="text-xs font-semibold text-green-700 dark:text-green-400 mb-2 uppercase">✓ Eng tejamkor</div>
          <div className="space-y-1.5">
            {best.map((v, i) => (
              <div key={v.vehicleId} className="flex items-center justify-between text-sm bg-green-50/40 dark:bg-green-900/10 rounded-lg px-3 py-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-400 w-4">{i + 1}.</span>
                  <span className="font-semibold truncate">{v.registrationNumber}</span>
                  <span className="text-xs text-gray-500 truncate hidden sm:inline">{v.brand}</span>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="font-bold text-green-700 dark:text-green-400">{v.lPer100km} {fuelUnit(v.fuelType)}/100km</div>
                  <div className="text-[10px] text-gray-500">{v.km} km · {v.liters} {fuelUnit(v.fuelType)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Bulk tank capacity setup modal ──────────────────────────────────────────
// 60-80 mashinali avtoparkda bittama-bitta sozlash — uzoq.
// Bu modal: jadval ko'rinishida hamma mashinalar, har biri uchun input.
// Saqlash → bitta API chaqiruvi — POST /fuel-monitoring/bulk-tank-capacity
function BulkTankSetupModal({
  vehicles, onClose, onSaved,
}: {
  vehicles: FuelLevel[]
  onClose: () => void
  onSaved: () => void
}) {
  // Joriy qiymatlardan mahalliy state'ga o'tkazamiz
  const [edits, setEdits] = useState<Record<string, { tankCapacity: string; sensor: string }>>(() => {
    const m: Record<string, { tankCapacity: string; sensor: string }> = {}
    for (const v of vehicles) {
      m[v.vehicleId] = {
        tankCapacity: v.tankCapacity?.toString() ?? '',
        sensor: v.sensorName ?? '',
      }
    }
    return m
  })

  const setEdit = (id: string, field: 'tankCapacity' | 'sensor', value: string) => {
    setEdits(prev => ({ ...prev, [id]: { ...prev[id], [field]: value } }))
  }

  // Filter — sozlanmagan / sozlangan / hammasi
  const [filter, setFilter] = useState<'all' | 'pending' | 'configured'>('pending')
  const filteredVehicles = useMemo(() => {
    if (filter === 'pending') return vehicles.filter(v => v.tankCapacity == null)
    if (filter === 'configured') return vehicles.filter(v => v.tankCapacity != null)
    return vehicles
  }, [vehicles, filter])

  // O'zgargan yozuvlar
  const dirty = useMemo(() => {
    return vehicles.filter(v => {
      const e = edits[v.vehicleId]
      if (!e) return false
      const origTank = v.tankCapacity?.toString() ?? ''
      const origSensor = v.sensorName ?? ''
      return e.tankCapacity !== origTank || e.sensor !== origSensor
    })
  }, [vehicles, edits])

  const saveMut = useMutation({
    mutationFn: () => api.post('/fuel-monitoring/bulk-tank-capacity', {
      items: dirty.map(v => ({
        vehicleId: v.vehicleId,
        tankCapacity: edits[v.vehicleId].tankCapacity ? Number(edits[v.vehicleId].tankCapacity) : null,
        fuelSensorName: edits[v.vehicleId].sensor || null,
      })),
    }).then(r => r.data),
    onSuccess: (res: any) => {
      const d = res.data
      if (d.errors?.length > 0) {
        toast.error(`${d.updated} ta saqlandi, ${d.skipped} ta xato. Birinchi xato: ${d.errors[0]}`, { duration: 8000 })
      } else {
        toast.success(res.message || `${d.updated} ta mashina yangilandi`)
      }
      onSaved()
    },
    onError: (err: any) => toast.error(err?.response?.data?.error || 'Xatolik'),
  })

  // Tezkor "common preset" — bir nechta tayyor bak hajmlari
  const PRESETS = [200, 250, 300, 400, 500, 600, 800]
  const applyPresetTo = (vehicleId: string, value: number) => {
    setEdit(vehicleId, 'tankCapacity', String(value))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white dark:bg-gray-800 rounded-2xl max-w-5xl w-full max-h-[90vh] flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <div>
            <h3 className="text-lg font-bold text-gray-900 dark:text-white">Bak hajmlarini ommaviy sozlash</h3>
            <div className="text-sm text-gray-500 mt-0.5">
              Jami: {vehicles.length} ta · Sozlangan: {vehicles.filter(v => v.tankCapacity != null).length} ta · O'zgargan: {dirty.length} ta
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1 p-3 border-b border-gray-100 dark:border-gray-700">
          {([
            ['pending', `Sozlanmagan (${vehicles.filter(v => v.tankCapacity == null).length})`],
            ['configured', `Sozlangan (${vehicles.filter(v => v.tankCapacity != null).length})`],
            ['all', `Hammasi (${vehicles.length})`],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                filter === key
                  ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300'
                  : 'text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {/* Table */}
        <div className="flex-1 overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-900/50 sticky top-0 z-10">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300">Mashina</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 w-48">Bak hajmi (L)</th>
                <th className="text-left px-4 py-3 font-semibold text-gray-700 dark:text-gray-300 w-56">Sensor nomi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
              {filteredVehicles.length === 0 ? (
                <tr><td colSpan={3} className="text-center py-12 text-gray-400">Bu filterda mashina yo'q</td></tr>
              ) : filteredVehicles.map(v => {
                const e = edits[v.vehicleId] || { tankCapacity: '', sensor: '' }
                const origTank = v.tankCapacity?.toString() ?? ''
                const isDirty = e.tankCapacity !== origTank || e.sensor !== (v.sensorName ?? '')
                return (
                  <tr key={v.vehicleId} className={isDirty ? 'bg-amber-50/40 dark:bg-amber-900/10' : ''}>
                    <td className="px-4 py-2.5">
                      <div className="font-semibold text-gray-900 dark:text-white">{v.registrationNumber}</div>
                      <div className="text-xs text-gray-500">{v.brand} {v.model}</div>
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="number"
                        value={e.tankCapacity}
                        onChange={ev => setEdit(v.vehicleId, 'tankCapacity', ev.target.value)}
                        placeholder="masalan, 400"
                        min={0}
                        max={10000}
                        className="w-24 px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                      />
                      <div className="flex flex-wrap gap-1 mt-1">
                        {PRESETS.map(p => (
                          <button
                            key={p}
                            onClick={() => applyPresetTo(v.vehicleId, p)}
                            className="text-[10px] px-1.5 py-0.5 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded text-gray-600 dark:text-gray-400 font-medium"
                          >
                            {p}
                          </button>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-2.5">
                      <input
                        type="text"
                        value={e.sensor}
                        onChange={ev => setEdit(v.vehicleId, 'sensor', ev.target.value)}
                        placeholder="Avto-aniqlash"
                        className="w-full px-2 py-1 text-sm border border-gray-200 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-base"
                      />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 p-5 border-t border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/50">
          <div className="text-sm text-gray-600 dark:text-gray-400">
            {dirty.length > 0
              ? <span className="text-amber-700 dark:text-amber-400 font-semibold">{dirty.length} ta o'zgarish saqlanmagan</span>
              : <span>O'zgarish yo'q</span>}
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Yopish</Button>
            <Button
              onClick={() => saveMut.mutate()}
              disabled={dirty.length === 0 || saveMut.isPending}
            >
              {saveMut.isPending ? 'Saqlanmoqda...' : `Saqlash (${dirty.length})`}
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Savings widget — tejov hisoblagichi ─────────────────────────────────────
// Sahifa yuqorisida: aniqlangan sliv va qayd etilmagan zapravkalardan
// kompaniya qancha so'm tejaganini ko'rsatadi.
// Mantiq: backend FuelReading.deltaL ni litr bo'yicha yig'ib, diesel narxiga
// ko'paytiradi. Diesel narxi oxirgi 30 kun FuelRecord'lardan o'rtacha.
function SavingsWidget() {
  const [days, setDays] = useState<7 | 30 | 365>(7)
  const { data, isLoading } = useQuery({
    queryKey: ['fuel-monitoring', 'savings', days],
    queryFn: () => api.get('/fuel-monitoring/savings', { params: { days } }).then(r => r.data),
    staleTime: 60_000,        // 1 daqiqa cache (har refresh'da qayta olishga hojat yo'q)
    refetchOnWindowFocus: false,
  })

  const stats = data?.data
  const formatUzs = (n: number) => new Intl.NumberFormat('uz-UZ').format(n) + " so'm"

  if (isLoading) {
    return (
      <div className="bg-gradient-to-br from-emerald-500 to-green-600 rounded-2xl p-6 text-white shadow-lg shadow-emerald-200/40 animate-pulse">
        <div className="h-4 bg-white/20 rounded w-32 mb-4" />
        <div className="h-10 bg-white/30 rounded w-64 mb-3" />
        <div className="h-3 bg-white/20 rounded w-48" />
      </div>
    )
  }

  if (!stats) return null

  const hasSavings = stats.totalSavings > 0
  const periodLabel = days === 7 ? '7 kunda' : days === 30 ? 'oyda' : 'yilda'

  return (
    <div className={`rounded-2xl p-6 text-white shadow-lg relative overflow-hidden ${
      hasSavings
        ? 'bg-gradient-to-br from-emerald-500 to-green-600 shadow-emerald-200/40'
        : 'bg-gradient-to-br from-slate-500 to-slate-600 shadow-slate-200/40'
    }`}>
      {/* Decoration */}
      <div className="absolute -top-6 -right-6 w-32 h-32 bg-white/10 rounded-full blur-2xl" />
      <div className="absolute -bottom-4 -left-4 w-24 h-24 bg-white/5 rounded-full blur-xl" />

      <div className="relative flex flex-wrap items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide opacity-90 mb-2">
            <Sparkles className="w-4 h-4" />
            {hasSavings ? `Avtohisob ${periodLabel} tejadi` : `Bu ${periodLabel} sliv aniqlanmadi`}
          </div>
          <div className="text-4xl sm:text-5xl font-black mb-2 tracking-tight">
            {hasSavings ? formatUzs(stats.totalSavings) : '0 so\'m'}
          </div>
          {hasSavings && (
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm opacity-95">
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-white rounded-full" />
                <b>{stats.totalLiters} {stats.unit || 'L'}</b> aniqlangan (sliv + qayd etilmagan)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 bg-white rounded-full" />
                <b>{stats.theft.events + stats.unrecordedRefuel.events}</b> hodisa
              </span>
            </div>
          )}
        </div>

        {/* Period selector */}
        <div className="flex gap-1 p-1 bg-white/15 backdrop-blur rounded-lg text-sm font-semibold" data-no-translate>
          <button
            onClick={() => setDays(7)}
            className={`px-3 py-1.5 rounded transition-colors ${days === 7 ? 'bg-white text-emerald-700' : 'text-white hover:bg-white/10'}`}
          >7 kun</button>
          <button
            onClick={() => setDays(30)}
            className={`px-3 py-1.5 rounded transition-colors ${days === 30 ? 'bg-white text-emerald-700' : 'text-white hover:bg-white/10'}`}
          >Oy</button>
          <button
            onClick={() => setDays(365)}
            className={`px-3 py-1.5 rounded transition-colors ${days === 365 ? 'bg-white text-emerald-700' : 'text-white hover:bg-white/10'}`}
          >Yil</button>
        </div>
      </div>

      {/* Detail breakdown */}
      {hasSavings && (
        <div className="relative mt-5 pt-5 border-t border-white/20 grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <div className="text-xs uppercase opacity-80 mb-1">🚨 Sliv (kraja)</div>
            <div className="text-xl font-bold">{stats.theft.liters} {stats.unit || 'L'}</div>
            <div className="text-sm opacity-90">{formatUzs(stats.theft.cost)} · {stats.theft.events} hodisa</div>
          </div>
          <div>
            <div className="text-xs uppercase opacity-80 mb-1">⚠️ Qayd etilmagan zapravka</div>
            <div className="text-xl font-bold">{stats.unrecordedRefuel.liters} {stats.unit || 'L'}</div>
            <div className="text-sm opacity-90">{formatUzs(stats.unrecordedRefuel.cost)} · {stats.unrecordedRefuel.events} hodisa</div>
          </div>
        </div>
      )}

      {/* Top vehicles */}
      {hasSavings && stats.topVehicles?.length > 0 && (
        <div className="relative mt-4 pt-4 border-t border-white/20">
          <div className="text-xs uppercase opacity-80 mb-2">Eng ko'p sliv aniqlangan mashinalar</div>
          <div className="flex flex-wrap gap-2">
            {stats.topVehicles.slice(0, 5).map((v: any) => (
              <div key={v.vehicleId} className="bg-white/15 backdrop-blur rounded-lg px-3 py-1.5 text-sm">
                <span className="font-semibold">{v.registrationNumber}</span>
                <span className="opacity-80 ml-2">{v.liters}{v.unit || stats.unit || 'L'} · {v.events} hodisa</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Footer note */}
      <div className="relative mt-4 pt-4 border-t border-white/20 text-xs opacity-75 flex flex-wrap gap-x-4 gap-y-1">
        <span className="flex items-center gap-1">
          <DollarSign className="w-3 h-3" />
          {(FUEL_TYPES[stats.fuelType] || 'Yoqilg\'i')}: {formatUzs(stats.unitPrice ?? stats.dieselPrice)} / {stats.unit || 'L'}
          <span className="opacity-70">
            ({stats.priceSource === 'price_history' ? 'Narxlar' : stats.priceSource === 'fuel_records_avg' ? 'chek o\'rtachasi' : 'standart'})
          </span>
        </span>
        {!hasSavings && (
          <span className="opacity-90">Sliv aniqlanmadi — yaxshi! Real-time sliv nazorati uchun yoqilg'i sensori kerak (metan gazda odatda yo'q).</span>
        )}
      </div>
    </div>
  )
}
