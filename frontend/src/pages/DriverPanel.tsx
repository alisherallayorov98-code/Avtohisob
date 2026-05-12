import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardList, MapPin, Gauge, Fuel, TrendingUp,
  PlayCircle, CheckCircle, Clock, ChevronRight, RefreshCw,
} from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'
import toast from 'react-hot-toast'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string
  registrationNumber: string
  brand: string
  model: string
}

interface Waybill {
  id: string
  number: string
  status: 'draft' | 'active' | 'completed' | 'cancelled'
  destination: string
  purpose: string | null
  plannedDeparture: string | null
  actualDeparture: string | null
  actualReturn: string | null
  departureOdometer: number | null
  returnOdometer: number | null
  fuelAtDeparture: number
  fuelIssued: number
  fuelConsumed: number | null
  distanceTraveled: number | null
  vehicle: Vehicle
  createdAt: string
}

interface Stats {
  trips: number
  totalKm: number
  totalFuel: number
  efficiency: number
}

interface MyWaybillsData {
  active: Waybill | null
  drafts: Waybill[]
  recent: Waybill[]
  stats: Stats
  month: number
  year: number
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MONTHS = ['', 'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

function fmtDate(s: string | null) {
  if (!s) return '—'
  return new Date(s).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
}
function fmtTime(s: string | null) {
  if (!s) return ''
  return new Date(s).toLocaleTimeString('uz-UZ', { hour: '2-digit', minute: '2-digit' })
}

// ─── Active waybill card ──────────────────────────────────────────────────────

function ActiveCard({ waybill, onComplete, onActivate }: {
  waybill: Waybill
  onComplete: (id: string, data: { returnOdometer: number; fuelAtReturn: number; notes?: string }) => void
  onActivate: (id: string, data: { departureOdometer?: number }) => void
}) {
  const [showForm, setShowForm] = useState(false)
  const [retOdo, setRetOdo] = useState('')
  const [fuelRet, setFuelRet] = useState('')
  const [notes, setNotes] = useState('')
  const [depOdo, setDepOdo] = useState('')

  const isActive = waybill.status === 'active'
  const isDraft  = waybill.status === 'draft'

  return (
    <div className={`rounded-xl border-2 p-5 ${isActive ? 'border-green-400 bg-green-50 dark:bg-green-900/10 dark:border-green-700' : 'border-blue-300 bg-blue-50 dark:bg-blue-900/10 dark:border-blue-700'}`}>
      <div className="flex items-start justify-between mb-3">
        <div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${isActive ? 'bg-green-500 text-white' : 'bg-blue-500 text-white'}`}>
              {isActive ? '● AKTIV' : '○ DRAFT'}
            </span>
            <span className="font-mono text-sm text-gray-500">{waybill.number}</span>
          </div>
          <div className="text-lg font-bold text-gray-900 dark:text-white mt-1 flex items-center gap-1">
            <MapPin className="w-4 h-4 text-gray-400" />
            {waybill.destination}
          </div>
          <div className="text-sm text-gray-500 mt-0.5">
            {waybill.vehicle.registrationNumber} · {waybill.vehicle.brand} {waybill.vehicle.model}
          </div>
        </div>
        <button onClick={() => setShowForm(o => !o)} className="text-xs text-blue-600 hover:underline font-medium">
          {showForm ? 'Yopish' : isActive ? 'Yakunlash' : "Jo'nash"}
        </button>
      </div>

      {isActive && (
        <div className="flex gap-4 text-sm text-gray-600 dark:text-gray-400 mb-3">
          {waybill.actualDeparture && (
            <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5" /> {fmtTime(waybill.actualDeparture)}</span>
          )}
          {waybill.departureOdometer && (
            <span className="flex items-center gap-1"><Gauge className="w-3.5 h-3.5" /> {waybill.departureOdometer.toLocaleString()} km</span>
          )}
          <span className="flex items-center gap-1"><Fuel className="w-3.5 h-3.5" /> {waybill.fuelAtDeparture + waybill.fuelIssued} L</span>
        </div>
      )}

      {/* Draft — activate form */}
      {isDraft && showForm && (
        <div className="mt-3 pt-3 border-t border-blue-200 dark:border-blue-800 space-y-3">
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Jo'nash odometri (km)</label>
            <input
              type="number"
              value={depOdo}
              onChange={e => setDepOdo(e.target.value)}
              placeholder="Masalan: 125400"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <button
            onClick={() => {
              onActivate(waybill.id, { departureOdometer: depOdo ? Number(depOdo) : undefined })
              setShowForm(false)
            }}
            className="w-full flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <PlayCircle className="w-4 h-4" />
            Sayohatni boshlash
          </button>
        </div>
      )}

      {/* Active — complete form */}
      {isActive && showForm && (
        <div className="mt-3 pt-3 border-t border-green-200 dark:border-green-800 space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Qaytish odometri (km)</label>
              <input
                type="number"
                value={retOdo}
                onChange={e => setRetOdo(e.target.value)}
                placeholder="Masalan: 125650"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
            <div>
              <label className="text-xs text-gray-500 mb-1 block">Yoqilg'i qoldiq (L)</label>
              <input
                type="number"
                value={fuelRet}
                onChange={e => setFuelRet(e.target.value)}
                placeholder="Masalan: 45"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-gray-500 mb-1 block">Izoh (ixtiyoriy)</label>
            <input
              type="text"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Izoh..."
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-sm dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 focus:ring-green-500"
            />
          </div>
          <button
            onClick={() => {
              if (!retOdo) { toast.error('Qaytish odometrini kiriting'); return }
              if (!fuelRet) { toast.error("Yoqilg'i qoldig'ini kiriting"); return }
              onComplete(waybill.id, { returnOdometer: Number(retOdo), fuelAtReturn: Number(fuelRet), notes: notes || undefined })
              setShowForm(false)
            }}
            className="w-full flex items-center justify-center gap-2 bg-green-600 hover:bg-green-700 text-white py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <CheckCircle className="w-4 h-4" />
            Sayohatni yakunlash
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DriverPanel() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const now = new Date()
  const [month] = useState(now.getMonth() + 1)
  const [year]  = useState(now.getFullYear())

  const { data, isLoading, refetch, isFetching } = useQuery<MyWaybillsData>({
    queryKey: ['my-waybills', month, year],
    queryFn: () => api.get('/waybills/my', { params: { month, year } }).then(r => r.data),
    staleTime: 30_000,
  })

  const activate = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.post(`/waybills/${id}/activate`, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-waybills'] }); toast.success('Sayohat boshlandi!') },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Xato yuz berdi'),
  })

  const complete = useMutation({
    mutationFn: ({ id, data }: { id: string; data: any }) =>
      api.post(`/waybills/${id}/complete`, data).then(r => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['my-waybills'] }); toast.success('Sayohat yakunlandi!') },
    onError: (e: any) => toast.error(e?.response?.data?.error || 'Xato yuz berdi'),
  })

  const stats = data?.stats
  const active = data?.active
  const drafts = data?.drafts ?? []
  const recent = data?.recent ?? []
  const hasActive = active || drafts.length > 0

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ClipboardList className="w-7 h-7 text-blue-600" />
            Sayohatlarim
          </h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {user?.fullName} · {MONTHS[month]} {year}
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-800 text-gray-400 transition-colors"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">Sayohatlar</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.trips}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">Umumiy km</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalKm.toLocaleString()}</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">Yoqilg'i</div>
            <div className="text-2xl font-bold text-gray-900 dark:text-white">{stats.totalFuel} L</div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
            <div className="text-xs text-gray-400 mb-1">Samaradorlik</div>
            <div className={`text-2xl font-bold ${stats.efficiency > 15 ? 'text-red-500' : stats.efficiency > 12 ? 'text-amber-500' : 'text-green-600'}`}>
              {stats.efficiency > 0 ? `${stats.efficiency} L` : '—'}
            </div>
            {stats.efficiency > 0 && <div className="text-xs text-gray-400">/100 km</div>}
          </div>
        </div>
      )}

      {/* Active / Draft waybills */}
      {isLoading ? (
        <div className="py-8 flex justify-center">
          <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : hasActive ? (
        <div className="space-y-3">
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300">Joriy sayohat</div>
          {active && (
            <ActiveCard
              waybill={active}
              onActivate={(id, d) => activate.mutate({ id, data: d })}
              onComplete={(id, d) => complete.mutate({ id, data: d })}
            />
          )}
          {drafts.map(w => (
            <ActiveCard
              key={w.id}
              waybill={w}
              onActivate={(id, d) => activate.mutate({ id, data: d })}
              onComplete={(id, d) => complete.mutate({ id, data: d })}
            />
          ))}
        </div>
      ) : (
        <div className="bg-gray-50 dark:bg-gray-800 rounded-xl border border-dashed border-gray-300 dark:border-gray-600 py-10 text-center">
          <ClipboardList className="w-10 h-10 text-gray-300 mx-auto mb-2" />
          <div className="text-gray-500 dark:text-gray-400 text-sm">Hozirda aktiv yo'l varaqasi yo'q</div>
          <div className="text-xs text-gray-400 mt-1">Dispetcher tomonidan tayinlanadi</div>
        </div>
      )}

      {/* Recent completed waybills */}
      {recent.length > 0 && (
        <div>
          <div className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">
            Oxirgi sayohatlar
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden">
            {recent.map((w, i) => (
              <div
                key={w.id}
                className={`flex items-center gap-3 px-4 py-3 ${i < recent.length - 1 ? 'border-b border-gray-50 dark:border-gray-700' : ''}`}
              >
                <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium text-gray-900 dark:text-white truncate">{w.destination}</span>
                    <span className="text-xs text-gray-400 font-mono flex-shrink-0">{w.number}</span>
                  </div>
                  <div className="text-xs text-gray-400 flex items-center gap-2 mt-0.5">
                    <span>{fmtDate(w.actualDeparture)}</span>
                    <span>{w.vehicle.registrationNumber}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  {w.distanceTraveled != null && (
                    <div className="text-sm font-medium text-gray-700 dark:text-gray-300 flex items-center gap-1">
                      <TrendingUp className="w-3.5 h-3.5 text-blue-400" />
                      {Math.round(w.distanceTraveled)} km
                    </div>
                  )}
                  {w.fuelConsumed != null && (
                    <div className="text-xs text-gray-400">{Math.round(Number(w.fuelConsumed))} L</div>
                  )}
                </div>
                <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
