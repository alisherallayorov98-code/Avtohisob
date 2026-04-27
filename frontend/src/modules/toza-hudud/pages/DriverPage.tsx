import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Truck, MapPin, CheckCircle2, XCircle, Clock, Wifi, AlertTriangle, Trash2, ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
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
}

interface DriverData {
  vehicle: Vehicle
  date: string
  dayOfWeek: number
  summary: {
    total: number; visited: number; notVisited: number; pending: number;
    noGps: number; noPolygon: number; suspicious: number;
    containerVisits: number; landfillTrips: number;
  }
  items: DriverItem[]
  landfillTrips: Array<{ landfillName: string; arrivedAt: string; leftAt: string | null; durationMin: number | null }>
}

function todayStr() { return new Date().toISOString().split('T')[0] }
function shiftDate(s: string, days: number) {
  const d = new Date(s)
  d.setDate(d.getDate() + days)
  return d.toISOString().split('T')[0]
}
function fmtDate(s: string) {
  return new Date(s).toLocaleDateString('uz-UZ', { day: '2-digit', month: 'long', year: 'numeric' })
}
function fmtTime(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

const STATUS_STYLE: Record<DriverItem['status'], { bg: string; text: string; label: string; icon: any }> = {
  visited:     { bg: 'bg-emerald-500',  text: 'text-white', label: 'Borildi',     icon: CheckCircle2 },
  not_visited: { bg: 'bg-red-500',      text: 'text-white', label: 'Borilmadi',   icon: XCircle },
  no_gps:      { bg: 'bg-gray-400',     text: 'text-white', label: "GPS yo'q",    icon: Wifi },
  no_polygon:  { bg: 'bg-yellow-500',   text: 'text-white', label: "Polygon yo'q",icon: AlertTriangle },
  pending:     { bg: 'bg-blue-400',     text: 'text-white', label: 'Hali tahlil yo\'q', icon: Clock },
}

export default function DriverPage() {
  const [vehicleId, setVehicleId] = useState<string>(() => localStorage.getItem(VEHICLE_KEY) || '')
  const [date, setDate] = useState(todayStr())

  useEffect(() => {
    if (vehicleId) localStorage.setItem(VEHICLE_KEY, vehicleId)
  }, [vehicleId])

  const { data: vehicles, isLoading: vehiclesLoading } = useQuery<Vehicle[]>({
    queryKey: ['th-driver-vehicles'],
    queryFn: () => api.get('/th/driver/vehicles').then(r => r.data.data),
  })

  const { data, isLoading } = useQuery<DriverData>({
    queryKey: ['th-driver-today', vehicleId, date],
    queryFn: () => api.get('/th/driver/today', { params: { vehicleId, date } }).then(r => r.data.data),
    enabled: !!vehicleId,
  })

  // Mashina hali tanlanmagan — picker
  if (!vehicleId) {
    return (
      <div className="p-6 max-w-md mx-auto h-full overflow-y-auto">
        <div className="bg-white rounded-2xl p-6 shadow-sm border border-gray-200">
          <div className="flex items-center gap-3 mb-5">
            <div className="w-12 h-12 bg-emerald-500 rounded-xl flex items-center justify-center">
              <Truck className="w-6 h-6 text-white" />
            </div>
            <div>
              <p className="text-lg font-bold text-gray-800">Haydovchi rejimi</p>
              <p className="text-xs text-gray-500">Mashinangizni tanlang</p>
            </div>
          </div>
          {vehiclesLoading && <p className="text-sm text-gray-400 text-center py-4">Yuklanmoqda...</p>}
          <div className="space-y-1.5 max-h-[60vh] overflow-y-auto">
            {(vehicles || []).map(v => (
              <button
                key={v.id}
                onClick={() => setVehicleId(v.id)}
                className="w-full text-left px-4 py-3 bg-gray-50 hover:bg-emerald-50 hover:border-emerald-300 border border-gray-200 rounded-lg transition-colors"
              >
                <p className="font-mono font-semibold text-gray-800">{v.registrationNumber}</p>
                <p className="text-xs text-gray-500">{v.brand} {v.model}</p>
              </button>
            ))}
            {!vehiclesLoading && (vehicles || []).length === 0 && (
              <p className="text-sm text-gray-400 text-center py-6">Mashinalar topilmadi</p>
            )}
          </div>
        </div>
      </div>
    )
  }

  const cur = (vehicles || []).find(v => v.id === vehicleId)

  return (
    <div className="h-full overflow-y-auto bg-gray-50">
      <div className="max-w-2xl mx-auto p-4 space-y-3">
        {/* Header — mashina + sana */}
        <div className="bg-emerald-600 text-white rounded-2xl p-4 shadow">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <Truck className="w-5 h-5" />
              <p className="font-mono font-bold text-lg">{cur?.registrationNumber || '—'}</p>
            </div>
            <button
              onClick={() => { localStorage.removeItem(VEHICLE_KEY); setVehicleId('') }}
              className="text-xs bg-emerald-700 hover:bg-emerald-800 px-3 py-1 rounded-full"
            >
              O'zgartirish
            </button>
          </div>
          {cur && <p className="text-emerald-100 text-sm mb-3">{cur.brand} {cur.model}</p>}

          {/* Sana paneli */}
          <div className="flex items-center justify-between bg-emerald-700/60 rounded-lg p-2">
            <button onClick={() => setDate(d => shiftDate(d, -1))} className="p-1 hover:bg-emerald-800 rounded">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="text-center flex-1">
              <p className="text-sm font-medium">
                {data ? DAYS_FULL[data.dayOfWeek] : ''}
              </p>
              <p className="text-xs text-emerald-100">{fmtDate(date)}</p>
            </div>
            <button
              onClick={() => setDate(d => shiftDate(d, 1))}
              disabled={date >= todayStr()}
              className="p-1 hover:bg-emerald-800 rounded disabled:opacity-30"
            >
              <ChevronRight className="w-5 h-5" />
            </button>
            {date !== todayStr() && (
              <button
                onClick={() => setDate(todayStr())}
                className="ml-2 text-xs bg-emerald-800 px-2 py-1 rounded"
              >
                Bugun
              </button>
            )}
          </div>
        </div>

        {isLoading && (
          <div className="text-center py-10 text-gray-400 text-sm">Yuklanmoqda...</div>
        )}

        {/* Xulosa: 3 ta katta indikator */}
        {data && (
          <div className="grid grid-cols-3 gap-2">
            <div className="bg-emerald-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-emerald-700">{data.summary.visited}</p>
              <p className="text-xs text-emerald-600 mt-0.5">Borildi</p>
            </div>
            <div className="bg-red-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-red-700">{data.summary.notVisited}</p>
              <p className="text-xs text-red-600 mt-0.5">Qoldi</p>
            </div>
            <div className="bg-blue-50 rounded-xl p-3 text-center">
              <p className="text-2xl font-bold text-blue-700">{data.summary.pending}</p>
              <p className="text-xs text-blue-600 mt-0.5">Kutmoqda</p>
            </div>
          </div>
        )}

        {/* Qo'shimcha statistika */}
        {data && (data.summary.containerVisits > 0 || data.summary.landfillTrips > 0) && (
          <div className="bg-white rounded-xl p-3 border border-gray-200 flex items-center justify-around text-sm">
            {data.summary.containerVisits > 0 && (
              <div className="flex items-center gap-1.5">
                <Trash2 className="w-4 h-4 text-violet-600" />
                <span className="font-semibold text-violet-700">{data.summary.containerVisits}</span>
                <span className="text-gray-500">konteyner</span>
              </div>
            )}
            {data.summary.landfillTrips > 0 && (
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-blue-600" />
                <span className="font-semibold text-blue-700">{data.summary.landfillTrips}</span>
                <span className="text-gray-500">poligon</span>
              </div>
            )}
            {data.summary.suspicious > 0 && (
              <div className="flex items-center gap-1.5 text-orange-600">
                <AlertTriangle className="w-4 h-4" />
                <span className="font-semibold">{data.summary.suspicious}</span>
                <span className="text-gray-500">shubhali</span>
              </div>
            )}
          </div>
        )}

        {/* MFY ro'yxati */}
        {data && data.items.length === 0 && (
          <div className="bg-white rounded-xl p-8 text-center border border-gray-200">
            <Calendar className="w-10 h-10 text-gray-300 mx-auto mb-2" />
            <p className="text-sm text-gray-500">Bu kun uchun jadvalda MFY yo'q</p>
            <p className="text-xs text-gray-400 mt-1">Boshqa kunni tanlang yoki grafikda biriktiring</p>
          </div>
        )}

        {data && data.items.map((item, idx) => {
          const s = STATUS_STYLE[item.status]
          const Icon = s.icon
          return (
            <div key={item.mfy.id} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
              <div className="flex items-stretch">
                <div className={`${s.bg} ${s.text} flex flex-col items-center justify-center px-3 py-2 min-w-[60px]`}>
                  <Icon className="w-5 h-5 mb-1" />
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-center leading-tight">{s.label}</span>
                </div>
                <div className="flex-1 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-800 truncate">
                        <span className="text-gray-400 text-sm mr-1">{idx + 1}.</span>
                        {item.mfy.name}
                      </p>
                      {item.mfy.district && (
                        <p className="text-xs text-gray-500">{item.mfy.district}</p>
                      )}
                    </div>
                    {item.suspicious && (
                      <span className="text-orange-600 text-xs font-bold">⚠ shubhali</span>
                    )}
                  </div>
                  {(item.enteredAt || item.exitedAt) && (
                    <div className="flex items-center gap-3 mt-2 text-xs text-gray-500">
                      {item.enteredAt && (
                        <span>🟢 {fmtTime(item.enteredAt)}</span>
                      )}
                      {item.exitedAt && (
                        <span>🔴 {fmtTime(item.exitedAt)}</span>
                      )}
                    </div>
                  )}
                  {!item.mfy.hasPolygon && (
                    <p className="text-xs text-yellow-600 mt-1">⚠ Polygon chizilmagan</p>
                  )}
                </div>
              </div>
            </div>
          )
        })}

        {/* Poligon tashriflari */}
        {data && data.landfillTrips.length > 0 && (
          <div className="bg-white rounded-xl border border-gray-200 p-3">
            <p className="text-sm font-semibold text-gray-700 mb-2 flex items-center gap-1.5">
              <MapPin className="w-4 h-4 text-blue-600" />
              Poligon tashriflari
            </p>
            <div className="space-y-1.5">
              {data.landfillTrips.map((t, i) => (
                <div key={i} className="flex items-center justify-between text-sm bg-blue-50 rounded-lg px-3 py-2">
                  <span className="text-gray-700">{t.landfillName}</span>
                  <span className="text-gray-500 text-xs tabular-nums">
                    {fmtTime(t.arrivedAt)} → {fmtTime(t.leftAt)}
                    {t.durationMin != null && ` (${t.durationMin} daq)`}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
