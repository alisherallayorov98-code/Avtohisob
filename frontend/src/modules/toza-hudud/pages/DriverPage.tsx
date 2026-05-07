import { useEffect, useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import {
  Truck, MapPin, CheckCircle2, XCircle, Clock, Wifi, AlertTriangle,
  Trash2, ChevronLeft, ChevronRight, RefreshCw, Search,
  QrCode, Download, X, Shield, ExternalLink,
} from 'lucide-react'
import api from '../../../lib/api'

const VEHICLE_KEY = 'th-driver-vehicleId'
const DAYS_FULL = ['Dushanba', 'Seshanba', 'Chorshanba', 'Payshanba', 'Juma', 'Shanba', 'Yakshanba']

interface Vehicle {
  id: string
  registrationNumber: string
  brand?: string
  model?: string
}

interface DriverItem {
  mfy: { id: string; name: string; district: string | null; hasPolygon: boolean }
  status: 'visited' | 'not_visited' | 'no_gps' | 'no_polygon' | 'pending'
  enteredAt: string | null
  exitedAt: string | null
  suspicious: boolean
  coveragePct: number | null
}

interface DriverData {
  vehicle: Vehicle
  date: string
  dayOfWeek: number
  summary: {
    total: number; visited: number; notVisited: number; pending: number
    noGps: number; noPolygon: number; suspicious: number
    containerVisits: number; landfillTrips: number
  }
  items: DriverItem[]
  landfillTrips: Array<{ landfillName: string; arrivedAt: string; leftAt: string | null; durationMin: number | null }>
}

interface QrData {
  vehicle: Vehicle
  token: string
  url: string
  qrDataUrl: string
  pinRequired: boolean
}

function todayStr() { return new Date().toISOString().split('T')[0] }
function shiftDate(s: string, days: number) {
  const d = new Date(s); d.setDate(d.getDate() + days); return d.toISOString().split('T')[0]
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtTime(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}
function duration(a: string | null, b: string | null) {
  if (!a || !b) return null
  const min = Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000)
  if (min < 1) return null
  return `${min} daq`
}

const STATUS_CONFIG = {
  visited:     { stripe: 'bg-emerald-500', badge: 'bg-emerald-100 text-emerald-700', label: 'Borildi',      icon: CheckCircle2 },
  not_visited: { stripe: 'bg-red-500',     badge: 'bg-red-100 text-red-700',         label: 'Borilmadi',    icon: XCircle },
  no_gps:      { stripe: 'bg-gray-400',    badge: 'bg-gray-100 text-gray-500',       label: "GPS yo'q",     icon: Wifi },
  no_polygon:  { stripe: 'bg-yellow-400',  badge: 'bg-yellow-100 text-yellow-700',   label: "Polygon yo'q", icon: AlertTriangle },
  pending:     { stripe: 'bg-blue-400',    badge: 'bg-blue-100 text-blue-700',       label: 'Kutmoqda',     icon: Clock },
} as const

function ProgressRing({ visited, total }: { visited: number; total: number }) {
  const r = 42
  const circ = 2 * Math.PI * r
  const pct = total > 0 ? visited / total : 0
  const offset = circ * (1 - pct)
  const color = pct >= 0.8 ? '#10b981' : pct >= 0.5 ? '#f59e0b' : '#ef4444'
  return (
    <svg width="110" height="110" viewBox="0 0 100 100">
      <circle cx="50" cy="50" r={r} fill="none" stroke="rgba(255,255,255,0.2)" strokeWidth="9" />
      <circle cx="50" cy="50" r={r} fill="none" stroke={color} strokeWidth="9"
        strokeDasharray={circ} strokeDashoffset={offset}
        strokeLinecap="round" transform="rotate(-90 50 50)"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
      <text x="50" y="46" textAnchor="middle" fontSize="20" fontWeight="bold" fill="white">{visited}</text>
      <text x="50" y="60" textAnchor="middle" fontSize="11" fill="rgba(255,255,255,0.7)">/ {total}</text>
    </svg>
  )
}

// ── QR Modal ──────────────────────────────────────────────────────────────────
function QrModal({ vehicleId, onClose }: { vehicleId: string; onClose: () => void }) {
  const { data, isLoading, isError } = useQuery<QrData>({
    queryKey: ['th-driver-qr', vehicleId],
    queryFn: () => api.get(`/th/driver/qr/${vehicleId}`).then(r => r.data.data),
    retry: false,
  })

  const handleDownload = () => {
    if (!data?.qrDataUrl) return
    const a = document.createElement('a')
    a.href = data.qrDataUrl
    a.download = `haydovchi-qr-${data.vehicle.registrationNumber}.png`
    a.click()
  }

  const handleCopyLink = () => {
    if (!data?.url) return
    navigator.clipboard.writeText(data.url).then(() => toast.success('Havola nusxalandi'))
  }

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between p-4 border-b border-gray-100">
          <div className="flex items-center gap-2">
            <QrCode className="w-5 h-5 text-emerald-600" />
            <p className="font-semibold text-gray-800">Haydovchi QR kodi</p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        <div className="p-5 text-center">
          {isLoading && (
            <div className="py-10 text-gray-400">
              <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2" />
              <p className="text-sm">Yaratilmoqda...</p>
            </div>
          )}

          {isError && (
            <div className="py-8">
              <p className="text-red-600 text-sm font-medium mb-1">QR yaratib bo'lmadi</p>
              <p className="text-gray-500 text-xs">Sozlamalar → Haydovchi kirish tizimini yoqing</p>
            </div>
          )}

          {data && (
            <>
              <p className="text-sm text-gray-600 mb-1">
                <span className="font-mono font-bold text-gray-800">{data.vehicle.registrationNumber}</span>
                {' '}{data.vehicle.brand} {data.vehicle.model}
              </p>
              {data.pinRequired && (
                <div className="flex items-center justify-center gap-1.5 mb-3">
                  <Shield className="w-3.5 h-3.5 text-amber-600" />
                  <span className="text-xs text-amber-700">PIN himoyalangan</span>
                </div>
              )}

              <div className="bg-emerald-50 rounded-xl p-3 mb-4 inline-block">
                <img src={data.qrDataUrl} alt="QR kod" className="w-52 h-52 rounded-lg" />
              </div>

              <p className="text-xs text-gray-500 mb-4">
                Haydovchi shu QR kodni skaner qiladi va bugungi jadvalini ko'radi
              </p>

              <div className="space-y-2">
                <button
                  onClick={handleDownload}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-emerald-600 text-white text-sm font-medium rounded-xl hover:bg-emerald-700 transition-colors"
                >
                  <Download className="w-4 h-4" />
                  PNG sifatida yuklab olish
                </button>
                <button
                  onClick={handleCopyLink}
                  className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-gray-100 text-gray-700 text-sm font-medium rounded-xl hover:bg-gray-200 transition-colors"
                >
                  <ExternalLink className="w-4 h-4" />
                  Havolani nusxalash
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function DriverPage() {
  const [vehicleId, setVehicleId] = useState<string>(() => localStorage.getItem(VEHICLE_KEY) || '')
  const [date, setDate] = useState(todayStr)
  const [search, setSearch] = useState('')
  const [qrVehicleId, setQrVehicleId] = useState<string | null>(null)

  useEffect(() => {
    if (vehicleId) localStorage.setItem(VEHICLE_KEY, vehicleId)
  }, [vehicleId])

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['th-driver-vehicles'],
    queryFn: () => api.get('/th/driver/vehicles').then(r => r.data.data),
  })

  const { data, isLoading, refetch, dataUpdatedAt } = useQuery<DriverData>({
    queryKey: ['th-driver-today', vehicleId, date],
    queryFn: () => api.get('/th/driver/today', { params: { vehicleId, date } }).then(r => r.data.data),
    enabled: !!vehicleId,
    refetchInterval: date === todayStr() ? 3 * 60 * 1000 : false,
  })

  // ── Mashina tanlanmagan: picker + QR admin tools ───────────────────────────
  if (!vehicleId) {
    const filtered = (vehicles || []).filter(v =>
      v.registrationNumber.toLowerCase().includes(search.toLowerCase()) ||
      `${v.brand} ${v.model}`.toLowerCase().includes(search.toLowerCase())
    )
    return (
      <div className="h-full overflow-y-auto bg-gradient-to-b from-emerald-50 to-white">
        {qrVehicleId && <QrModal vehicleId={qrVehicleId} onClose={() => setQrVehicleId(null)} />}
        <div className="max-w-md mx-auto p-5 space-y-4">
          {/* Hero */}
          <div className="text-center pt-6 pb-2">
            <div className="w-16 h-16 bg-emerald-500 rounded-2xl flex items-center justify-center mx-auto mb-3 shadow-lg shadow-emerald-200">
              <Truck className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-800">Haydovchi rejimi</h1>
            <p className="text-sm text-gray-500 mt-1">Mashinani tanlang yoki QR kod yarating</p>
          </div>

          {/* Qidiruv */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Raqam yoki model bo'yicha qidirish..."
              className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl bg-white shadow-sm focus:outline-none focus:ring-2 focus:ring-emerald-400"
            />
          </div>

          {vehiclesLoading && (
            <div className="text-center py-8 text-gray-400 text-sm">Yuklanmoqda...</div>
          )}

          <div className="space-y-2">
            {filtered.map(v => (
              <div key={v.id} className="flex items-center gap-2">
                <button
                  onClick={() => setVehicleId(v.id)}
                  className="flex-1 text-left flex items-center gap-3 px-4 py-3.5 bg-white hover:bg-emerald-50 border border-gray-200 hover:border-emerald-300 rounded-xl transition-all shadow-sm group"
                >
                  <div className="w-9 h-9 bg-emerald-100 group-hover:bg-emerald-200 rounded-lg flex items-center justify-center shrink-0 transition-colors">
                    <Truck className="w-4 h-4 text-emerald-600" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-mono font-bold text-gray-800 tracking-wide">{v.registrationNumber}</p>
                    <p className="text-xs text-gray-500 truncate">{v.brand} {v.model}</p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-emerald-500 transition-colors" />
                </button>
                {/* QR tugma */}
                <button
                  onClick={() => setQrVehicleId(v.id)}
                  title="QR kod yaratish"
                  className="w-11 h-11 flex items-center justify-center bg-white border border-gray-200 rounded-xl hover:bg-emerald-50 hover:border-emerald-300 transition-colors shrink-0"
                >
                  <QrCode className="w-4.5 h-4.5 text-gray-400" />
                </button>
              </div>
            ))}
            {!vehiclesLoading && filtered.length === 0 && (
              <p className="text-center text-sm text-gray-400 py-8">Mashina topilmadi</p>
            )}
          </div>

          {/* QR tushuntirish */}
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-start gap-2.5">
            <QrCode className="w-4 h-4 text-blue-500 shrink-0 mt-0.5" />
            <div>
              <p className="text-xs font-semibold text-blue-800 mb-1">Haydovchi QR kodi</p>
              <p className="text-xs text-blue-700">
                Har mashina yonidagi QR belgisini bosib, haydovchi uchun QR kod yarating.
                Haydovchi skanerlaydi → telefonda jadvalini ko'radi.
                PIN sozlamalari: Sozlamalar → Haydovchi kirish.
              </p>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const cur = (vehicles || []).find(v => v.id === vehicleId)
  const isToday = date === todayStr()
  const updatedAgo = dataUpdatedAt ? Math.round((Date.now() - dataUpdatedAt) / 1000) : null
  const pendingItems = data?.items.filter(i => i.status === 'pending') || []
  const nextItem = pendingItems[0]

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      {qrVehicleId && <QrModal vehicleId={qrVehicleId} onClose={() => setQrVehicleId(null)} />}
      <div className="max-w-2xl mx-auto p-3 space-y-3">

        {/* ── Header ── */}
        <div className="bg-gradient-to-br from-emerald-600 to-emerald-700 text-white rounded-2xl p-4 shadow-lg shadow-emerald-200">
          <div className="flex items-start justify-between mb-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-white/20 rounded-xl flex items-center justify-center">
                <Truck className="w-5 h-5" />
              </div>
              <div>
                <p className="font-mono font-bold text-xl tracking-wider">{cur?.registrationNumber || '—'}</p>
                <p className="text-emerald-200 text-xs">{cur?.brand} {cur?.model}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setQrVehicleId(vehicleId)}
                title="QR kod yaratish"
                className="text-xs bg-white/15 hover:bg-white/25 px-2.5 py-1.5 rounded-full transition-colors flex items-center gap-1.5"
              >
                <QrCode className="w-3.5 h-3.5" />
                QR
              </button>
              <button
                onClick={() => { localStorage.removeItem(VEHICLE_KEY); setVehicleId('') }}
                className="text-xs bg-white/15 hover:bg-white/25 px-3 py-1.5 rounded-full transition-colors"
              >
                O'zgartirish
              </button>
            </div>
          </div>

          <div className="flex items-center gap-4">
            {data && <ProgressRing visited={data.summary.visited} total={data.summary.total} />}
            <div className="flex-1 space-y-3">
              {/* Sana navigatsiya */}
              <div className="flex items-center gap-1 bg-white/15 rounded-xl p-1">
                <button onClick={() => setDate(d => shiftDate(d, -1))} className="p-1.5 hover:bg-white/20 rounded-lg">
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <div className="flex-1 text-center">
                  <p className="text-xs font-semibold">{data ? DAYS_FULL[data.dayOfWeek] : '—'}</p>
                  <p className="text-[10px] text-emerald-200">{fmtDate(date)}</p>
                </div>
                <button onClick={() => setDate(d => shiftDate(d, 1))} disabled={isToday}
                  className="p-1.5 hover:bg-white/20 rounded-lg disabled:opacity-30">
                  <ChevronRight className="w-4 h-4" />
                </button>
                {!isToday && (
                  <button onClick={() => setDate(todayStr())} className="text-[10px] bg-white/20 px-2 py-1 rounded-lg">
                    Bugun
                  </button>
                )}
              </div>

              {data && (
                <div className="grid grid-cols-3 gap-1.5">
                  <div className="bg-white/15 rounded-lg p-1.5 text-center">
                    <p className="text-lg font-bold">{data.summary.visited}</p>
                    <p className="text-[10px] text-emerald-200">Borildi</p>
                  </div>
                  <div className="bg-white/15 rounded-lg p-1.5 text-center">
                    <p className="text-lg font-bold text-red-300">{data.summary.notVisited}</p>
                    <p className="text-[10px] text-emerald-200">Borilmadi</p>
                  </div>
                  <div className="bg-white/15 rounded-lg p-1.5 text-center">
                    <p className="text-lg font-bold text-blue-200">{data.summary.pending}</p>
                    <p className="text-[10px] text-emerald-200">Kutmoqda</p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {isToday && (
            <div className="flex items-center justify-between mt-3 pt-3 border-t border-white/20">
              <span className="text-[11px] text-emerald-300">
                {updatedAgo !== null ? `${updatedAgo}s oldin yangilandi` : 'Yuklanmoqda...'}
              </span>
              <button onClick={() => refetch()}
                className="flex items-center gap-1.5 text-[11px] bg-white/15 hover:bg-white/25 px-2.5 py-1 rounded-full transition-colors">
                <RefreshCw className="w-3 h-3" /> Yangilash
              </button>
            </div>
          )}
        </div>

        {isLoading && (
          <div className="bg-white rounded-xl p-8 text-center text-gray-400 text-sm">Yuklanmoqda...</div>
        )}

        {/* Keyingi navbatdagi MFY */}
        {nextItem && isToday && (
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-100 rounded-xl flex items-center justify-center shrink-0">
              <MapPin className="w-4 h-4 text-blue-600" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[10px] font-semibold text-blue-500 uppercase tracking-wide mb-0.5">Keyingi navbatda</p>
              <p className="font-semibold text-gray-800 truncate">{nextItem.mfy.name}</p>
              {nextItem.mfy.district && <p className="text-xs text-gray-500">{nextItem.mfy.district}</p>}
            </div>
            <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full shrink-0">
              {pendingItems.length} ta qoldi
            </span>
          </div>
        )}

        {/* Qo'shimcha statistika */}
        {data && (data.summary.containerVisits > 0 || data.summary.landfillTrips > 0 || data.summary.suspicious > 0) && (
          <div className="bg-white rounded-xl p-3 border border-gray-200 flex items-center justify-around gap-2">
            {data.summary.containerVisits > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <Trash2 className="w-4 h-4 text-violet-600" />
                <span className="font-bold text-violet-700">{data.summary.containerVisits}</span>
                <span className="text-gray-500 text-xs">konteyner</span>
              </div>
            )}
            {data.summary.landfillTrips > 0 && (
              <div className="flex items-center gap-1.5 text-sm">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span className="font-bold text-blue-700">{data.summary.landfillTrips}</span>
                <span className="text-gray-500 text-xs">poligon</span>
              </div>
            )}
            {data.summary.suspicious > 0 && (
              <div className="flex items-center gap-1.5 text-sm text-orange-600">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-bold">{data.summary.suspicious}</span>
                <span className="text-gray-500 text-xs">shubhali</span>
              </div>
            )}
          </div>
        )}

        {/* Bo'sh holat */}
        {data && data.items.length === 0 && (
          <div className="bg-white rounded-xl p-10 text-center border border-gray-200">
            <div className="w-14 h-14 bg-gray-100 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <MapPin className="w-7 h-7 text-gray-300" />
            </div>
            <p className="font-medium text-gray-600">Bu kun uchun jadvalda MFY yo'q</p>
            <p className="text-xs text-gray-400 mt-1">Boshqa kunni tanlang yoki grafikda biriktiring</p>
          </div>
        )}

        {/* MFY ro'yxati */}
        {data && data.items.length > 0 && (
          <div className="space-y-2">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
              Bugungi marshrut — {data.items.length} ta MFY
            </p>
            {data.items.map((item, idx) => {
              const s = STATUS_CONFIG[item.status]
              const Icon = s.icon
              const dur = duration(item.enteredAt, item.exitedAt)
              return (
                <div key={item.mfy.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden shadow-sm">
                  <div className="flex">
                    <div className={`${s.stripe} w-1.5 shrink-0`} />
                    <div className="flex-1 p-3">
                      <div className="flex items-start gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-gray-400 font-mono">{String(idx + 1).padStart(2, '0')}</span>
                            <span className="font-semibold text-gray-800 truncate">{item.mfy.name}</span>
                            {item.suspicious && (
                              <span className="text-[10px] bg-orange-100 text-orange-600 px-1.5 py-0.5 rounded-full font-semibold">⚠ shubhali</span>
                            )}
                          </div>
                          {item.mfy.district && (
                            <p className="text-xs text-gray-400 mt-0.5">{item.mfy.district}</p>
                          )}
                        </div>
                        <span className={`flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0 ${s.badge}`}>
                          <Icon className="w-3 h-3" />
                          {s.label}
                        </span>
                      </div>

                      {(item.enteredAt || item.exitedAt) && (
                        <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                          {item.enteredAt && <span>🟢 {fmtTime(item.enteredAt)}</span>}
                          {item.exitedAt && <span>🔴 {fmtTime(item.exitedAt)}</span>}
                          {dur && <span className="text-gray-400">({dur})</span>}
                        </div>
                      )}

                      {item.coveragePct != null && item.status === 'visited' && (
                        <div className="mt-2">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-[10px] text-gray-400">Ko'cha qamrovi</span>
                            <span className={`text-[10px] font-bold ${
                              item.coveragePct >= 70 ? 'text-emerald-600' :
                              item.coveragePct >= 40 ? 'text-amber-600' : 'text-red-600'
                            }`}>{item.coveragePct}%</span>
                          </div>
                          <div className="h-1.5 bg-gray-100 rounded-full overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all ${
                                item.coveragePct >= 70 ? 'bg-emerald-500' :
                                item.coveragePct >= 40 ? 'bg-amber-400' : 'bg-red-400'
                              }`}
                              style={{ width: `${item.coveragePct}%` }}
                            />
                          </div>
                        </div>
                      )}

                      {!item.mfy.hasPolygon && (
                        <p className="text-[11px] text-yellow-600 mt-1.5">⚠ Polygon chizilmagan</p>
                      )}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {/* Landfill tashriflari */}
        {data && data.landfillTrips.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3 shadow-sm">
            <p className="text-xs font-semibold text-gray-600 uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5 text-blue-600" />
              Chiqindi poligon tashriflari
            </p>
            <div className="space-y-1.5">
              {data.landfillTrips.map((t, i) => (
                <div key={i} className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-2 text-sm">
                  <span className="font-medium text-gray-700">{t.landfillName}</span>
                  <span className="text-xs text-gray-500 tabular-nums">
                    {fmtTime(t.arrivedAt)} → {fmtTime(t.leftAt)}
                    {t.durationMin != null && ` · ${t.durationMin} daq`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="h-4" />
      </div>
    </div>
  )
}
