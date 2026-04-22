import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleDot, Search, Settings, ChevronRight, Save, AlertTriangle, CheckCircle, AlertCircle, Filter, Car, Gauge, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Branch {
  id: string
  name: string
}

interface Vehicle {
  id: string
  registrationNumber: string
  brand: string
  model: string
  year: number
  mileage: number
  gpsUnitName?: string
  status: string
  branch?: { name: string } | null
  tireTrackings: { id: string; slotNumber: number }[]
}

interface TrackingSlot {
  id?: string
  slotNumber: number
  label: string
  serialCode: string
  installDate: string
  normKm: number
  notes: string
  usedKm?: number
  remainingKm?: number
  pct?: number
  status?: 'ok' | 'warning' | 'critical'
}

interface VehicleTracking {
  id: string
  registrationNumber: string
  brand: string
  model: string
  mileage: number
  gpsUnitName?: string
  slots: TrackingSlot[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const DEFAULT_LABELS: Record<number, string> = {
  1: 'Old chap',
  2: "Old o'ng",
  3: 'Orqa 1-chap',
  4: "Orqa 1-o'ng",
  5: 'Orqa 2-chap',
  6: "Orqa 2-o'ng",
  7: 'Orqa 3-chap',
  8: "Orqa 3-o'ng",
  9: 'Orqa 4-chap',
  10: "Orqa 4-o'ng",
  11: 'Zaxira 1',
  12: 'Zaxira 2',
}

function ProgressBar({ pct, status }: { pct: number; status: string }) {
  const color = status === 'critical' ? 'bg-red-500' : status === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'
  const bg = status === 'critical' ? 'bg-red-100 dark:bg-red-900/20' : status === 'warning' ? 'bg-amber-100 dark:bg-amber-900/20' : 'bg-emerald-100 dark:bg-emerald-900/20'
  return (
    <div className={`h-2 rounded-full ${bg} overflow-hidden w-full`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

function StatusIcon({ status }: { status?: string }) {
  if (status === 'critical') return <AlertTriangle className="w-4 h-4 text-red-500" />
  if (status === 'warning') return <AlertCircle className="w-4 h-4 text-amber-500" />
  return <CheckCircle className="w-4 h-4 text-emerald-500" />
}

function StatusBadge({ status }: { status?: string }) {
  if (status === 'critical')
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300">Kritik</span>
  if (status === 'warning')
    return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">Ogohlantirish</span>
  return <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">Yaxshi</span>
}

function emptySlots(count: number): TrackingSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    slotNumber: i + 1,
    label: DEFAULT_LABELS[i + 1] || `Shina ${i + 1}`,
    serialCode: '',
    installDate: '',
    normKm: 50000,
    notes: '',
  }))
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function TireTracking() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [branchId, setBranchId] = useState('')
  const [selected, setSelected] = useState<Vehicle | null>(null)
  const [tireCount, setTireCount] = useState(4)
  const [slots, setSlots] = useState<TrackingSlot[]>([])
  const [setupMode, setSetupMode] = useState(false)
  // GPS km preview per slot: { [slotNumber]: { km: number | null, loading: boolean } }
  const [gpsPreview, setGpsPreview] = useState<Record<number, { km: number | null; loading: boolean }>>({})
  const gpsTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const fetchGpsKm = useCallback((slotNumber: number, date: string) => {
    if (!selected || !date) return
    clearTimeout(gpsTimers.current[slotNumber])
    setGpsPreview(p => ({ ...p, [slotNumber]: { km: null, loading: true } }))
    gpsTimers.current[slotNumber] = setTimeout(async () => {
      try {
        const r = await api.get(`/tire-tracking/vehicles/${selected.id}/gps-km`, { params: { installDate: date } })
        setGpsPreview(p => ({ ...p, [slotNumber]: { km: r.data.data.usedKm, loading: false } }))
      } catch {
        setGpsPreview(p => ({ ...p, [slotNumber]: { km: null, loading: false } }))
      }
    }, 600)
  }, [selected])

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches-select'],
    queryFn: () => api.get('/branches?select=true').then(r => r.data.data),
  })

  const { data: vehicles = [], isLoading } = useQuery<Vehicle[]>({
    queryKey: ['tire-tracking-vehicles', branchId],
    queryFn: () => api.get('/tire-tracking/vehicles', { params: branchId ? { branchId } : {} }).then(r => r.data.data),
  })

  const { data: trackingData, isLoading: trackingLoading } = useQuery<VehicleTracking>({
    queryKey: ['tire-tracking', selected?.id],
    queryFn: () => api.get(`/tire-tracking/vehicles/${selected!.id}`).then(r => r.data.data),
    enabled: !!selected && !setupMode,
    retry: 1,
  })

  const saveMutation = useMutation({
    mutationFn: (data: { slots: TrackingSlot[] }) =>
      api.put(`/tire-tracking/vehicles/${selected!.id}`, data),
    onSuccess: () => {
      toast.success('Saqlandi')
      qc.invalidateQueries({ queryKey: ['tire-tracking', selected?.id] })
      qc.invalidateQueries({ queryKey: ['tire-tracking-vehicles'] })
      setSetupMode(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openVehicle = (v: Vehicle) => {
    setSelected(v)
    setSetupMode(false)
  }

  const openSetup = () => {
    const existing = trackingData?.slots || []
    const count = existing.length || selected?.tireTrackings.length || 4
    setTireCount(count)
    setGpsPreview({})
    if (existing.length > 0) {
      const mapped = existing.map(s => ({
        ...s,
        installDate: s.installDate ? s.installDate.split('T')[0] : '',
        label: s.label || DEFAULT_LABELS[s.slotNumber] || `Shina ${s.slotNumber}`,
        serialCode: (s as any).serialCode || '',
        notes: s.notes || '',
      }))
      setSlots(mapped)
      // Pre-populate GPS preview from already-loaded tracking data
      const preview: Record<number, { km: number | null; loading: boolean }> = {}
      existing.forEach(s => { if (s.usedKm !== undefined) preview[s.slotNumber] = { km: s.usedKm, loading: false } })
      setGpsPreview(preview)
    } else {
      setSlots(emptySlots(count))
    }
    setSetupMode(true)
  }

  const handleCountChange = (n: number) => {
    setTireCount(n)
    const current = slots.slice(0, n)
    const extra = emptySlots(n).slice(current.length)
    setSlots([...current, ...extra])
  }

  const updateSlot = (idx: number, field: keyof TrackingSlot, value: any) => {
    setSlots(prev => {
      const updated = prev.map((s, i) => i === idx ? { ...s, [field]: value } : s)
      if (field === 'installDate') {
        const slot = updated[idx]
        if (value) fetchGpsKm(slot.slotNumber, value)
        else setGpsPreview(p => { const n = { ...p }; delete n[slot.slotNumber]; return n })
      }
      return updated
    })
  }

  const handleSave = () => {
    const invalid = slots.find(s => !s.installDate)
    if (invalid) return toast.error(`Shina ${invalid.slotNumber} uchun o'rnatilgan sanani kiriting`)
    saveMutation.mutate({ slots })
  }

  const q = search.trim().toLowerCase()
  const filtered = vehicles.filter(v =>
    v.registrationNumber.toLowerCase().includes(q) ||
    `${v.brand} ${v.model}`.toLowerCase().includes(q) ||
    (v.branch?.name ?? '').toLowerCase().includes(q)
  )

  // Summary stats
  const totalVehicles = filtered.length
  const configured = filtered.filter(v => v.tireTrackings.length > 0).length
  const notConfigured = totalVehicles - configured

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <CircleDot className="w-6 h-6 text-blue-600" />
            Shina Nazorati
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            GPS asosida har bir shina yurgan km nazorati
          </p>
        </div>

        {/* Stats pills */}
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/20 rounded-lg text-sm">
            <Car className="w-4 h-4 text-blue-600" />
            <span className="font-semibold text-blue-700 dark:text-blue-300">{totalVehicles}</span>
            <span className="text-blue-600 dark:text-blue-400">mashina</span>
          </div>
          <div className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg text-sm">
            <CheckCircle className="w-4 h-4 text-emerald-600" />
            <span className="font-semibold text-emerald-700 dark:text-emerald-300">{configured}</span>
            <span className="text-emerald-600 dark:text-emerald-400">sozlangan</span>
          </div>
          {notConfigured > 0 && (
            <div className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 dark:bg-amber-900/20 rounded-lg text-sm">
              <AlertCircle className="w-4 h-4 text-amber-600" />
              <span className="font-semibold text-amber-700 dark:text-amber-300">{notConfigured}</span>
              <span className="text-amber-600 dark:text-amber-400">sozlanmagan</span>
            </div>
          )}
        </div>
      </div>

      {/* Filters row */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Mashina raqami yoki nomi..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        {branches.length > 1 && (
          <div className="relative">
            <Filter className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <select
              value={branchId}
              onChange={e => setBranchId(e.target.value)}
              className="pl-9 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 appearance-none cursor-pointer"
            >
              <option value="">Barcha filiallar</option>
              {branches.map(b => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* Vehicle cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="h-36 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
          <CircleDot className="w-14 h-14 mb-4 opacity-25" />
          <p className="text-base font-medium">Mashina topilmadi</p>
          <p className="text-sm mt-1 text-gray-400">Qidiruv yoki filtr shartlarini o'zgartiring</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(v => {
            const slotCount = v.tireTrackings.length
            const hasGps = !!v.gpsUnitName
            const isConfigured = slotCount > 0
            return (
              <button
                key={v.id}
                onClick={() => openVehicle(v)}
                className="text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-blue-400 dark:hover:border-blue-500 hover:shadow-lg transition-all group relative overflow-hidden"
              >
                {/* Left accent bar */}
                <div className={`absolute left-0 top-0 bottom-0 w-1 rounded-l-xl ${isConfigured ? 'bg-emerald-400' : 'bg-gray-200 dark:bg-gray-600'}`} />

                <div className="pl-2">
                  <div className="flex items-start justify-between mb-3">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${isConfigured ? 'bg-blue-100 dark:bg-blue-900/30' : 'bg-gray-100 dark:bg-gray-700'}`}>
                      <CircleDot className={`w-4 h-4 ${isConfigured ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`} />
                    </div>
                    <div className="flex items-center gap-1.5">
                      {!hasGps && (
                        <span title="GPS ulanmagan" className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 px-1.5 py-0.5 rounded font-medium">GPS yo'q</span>
                      )}
                      <ChevronRight className="w-4 h-4 text-gray-300 dark:text-gray-500 group-hover:text-blue-500 transition-colors" />
                    </div>
                  </div>

                  <p className="font-bold text-gray-900 dark:text-white text-sm">{v.registrationNumber}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{v.brand} {v.model} · {v.year}</p>
                  {v.branch?.name && (
                    <p className="text-xs text-gray-400 dark:text-gray-500 mt-0.5">{v.branch.name}</p>
                  )}

                  <div className="mt-3 flex items-center justify-between">
                    {isConfigured ? (
                      <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">
                        {slotCount} ta shina
                      </span>
                    ) : (
                      <span className="text-xs text-gray-400 italic">Sozlanmagan</span>
                    )}
                    <div className="flex items-center gap-1 text-xs text-gray-400">
                      <Gauge className="w-3 h-3" />
                      {Number(v.mileage).toLocaleString()} km
                    </div>
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {/* ── Vehicle Detail Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!selected && !setupMode}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.registrationNumber} — shina holati` : ''}
        size="xl"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={() => setSelected(null)}>Yopish</Button>
            <Button icon={<Settings className="w-4 h-4" />} onClick={openSetup}>
              Sozlash / Tahrirlash
            </Button>
          </div>
        }
      >
        {trackingLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="h-24 bg-gray-100 dark:bg-gray-700 rounded-xl animate-pulse" />
            ))}
          </div>
        ) : !trackingData?.slots.length ? (
          <div className="py-14 text-center space-y-4">
            <div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-full flex items-center justify-center mx-auto">
              <CircleDot className="w-8 h-8 text-gray-300" />
            </div>
            <div>
              <p className="text-gray-700 dark:text-gray-300 font-medium">Shina nazorati sozlanmagan</p>
              <p className="text-sm text-gray-400 mt-1">Bu mashina uchun hali shina ma'lumotlari kiritilmagan</p>
            </div>
            <Button icon={<Settings className="w-4 h-4" />} onClick={openSetup}>
              Hozir sozlash
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Vehicle info bar */}
            <div className="flex items-center gap-4 flex-wrap p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600 text-sm">
              <div className="flex items-center gap-2">
                <Car className="w-4 h-4 text-gray-400" />
                <span className="font-semibold text-gray-900 dark:text-white">
                  {trackingData.brand} {trackingData.model}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <Gauge className="w-4 h-4 text-blue-500" />
                <span className="font-bold text-blue-600 dark:text-blue-400">
                  {Number(trackingData.mileage).toLocaleString()} km
                </span>
                <span className="text-gray-400 text-xs">odometr</span>
              </div>
              {trackingData.gpsUnitName ? (
                <span className="text-xs bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-300 px-2 py-0.5 rounded-full font-medium">
                  GPS: {trackingData.gpsUnitName}
                </span>
              ) : (
                <span className="text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full">
                  GPS ulanmagan
                </span>
              )}
            </div>

            {/* Slots grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {trackingData.slots.map(slot => (
                <div
                  key={slot.slotNumber}
                  className={`p-4 rounded-xl border ${
                    slot.status === 'critical'
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
                      : slot.status === 'warning'
                      ? 'border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-900/10'
                      : 'border-emerald-200 dark:border-emerald-800 bg-emerald-50 dark:bg-emerald-900/10'
                  }`}
                >
                  {/* Slot header */}
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={slot.status} />
                      <div>
                        <p className="font-semibold text-gray-900 dark:text-white text-sm leading-tight">
                          {slot.label || `Shina ${slot.slotNumber}`}
                        </p>
                        {(slot as any).serialCode && (
                          <p className="text-xs text-gray-500 font-mono">{(slot as any).serialCode}</p>
                        )}
                      </div>
                    </div>
                    <div className="text-right">
                      <p className={`text-xl font-bold leading-none ${
                        slot.status === 'critical' ? 'text-red-600' :
                        slot.status === 'warning' ? 'text-amber-600' : 'text-emerald-600'
                      }`}>{slot.pct}%</p>
                      <StatusBadge status={slot.status} />
                    </div>
                  </div>

                  <ProgressBar pct={slot.pct ?? 0} status={slot.status ?? 'ok'} />

                  {/* Stats */}
                  <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                    <div>
                      <p className="text-gray-400 dark:text-gray-500">O'rnatilgan</p>
                      <p className="font-medium text-gray-800 dark:text-gray-200">{formatDate(slot.installDate as string)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-gray-500">Norma</p>
                      <p className="font-medium text-gray-800 dark:text-gray-200">{slot.normKm.toLocaleString()} km</p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-gray-500">Yurgan (GPS)</p>
                      <p className="font-semibold text-gray-900 dark:text-white">{(slot.usedKm ?? 0).toLocaleString()} km</p>
                    </div>
                    <div>
                      <p className="text-gray-400 dark:text-gray-500">Qolgan</p>
                      <p className={`font-bold ${
                        (slot.remainingKm ?? 0) < 5000 ? 'text-red-600' :
                        (slot.remainingKm ?? 0) < 15000 ? 'text-amber-600' : 'text-emerald-600'
                      }`}>{(slot.remainingKm ?? 0).toLocaleString()} km</p>
                    </div>
                  </div>

                  {slot.notes && (
                    <p className="mt-2 text-xs text-gray-500 dark:text-gray-400 italic border-t border-gray-200 dark:border-gray-700 pt-2">
                      {slot.notes}
                    </p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </Modal>

      {/* ── Setup Modal ──────────────────────────────────────────────────────── */}
      <Modal
        open={!!selected && setupMode}
        onClose={() => setSetupMode(false)}
        title={selected ? `${selected.registrationNumber} — shinalarni sozlash` : ''}
        size="xl"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={() => setSetupMode(false)}>Bekor qilish</Button>
            <Button icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending} onClick={handleSave}>
              Saqlash
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          {/* Shina soni */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              Shinalar soni:
            </span>
            <div className="flex gap-1.5">
              {[4, 6, 8, 10, 12].map(n => (
                <button
                  key={n}
                  onClick={() => handleCountChange(n)}
                  className={`w-10 h-9 text-sm rounded-lg font-bold border-2 transition-all ${
                    tireCount === n
                      ? 'bg-blue-600 text-white border-blue-600 shadow-md'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400 hover:text-blue-600'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400 hidden sm:block">4=sedan · 6=Isuzu · 8-12=yuk mashinasi</span>
          </div>

          {/* Column headers */}
          <div className="grid grid-cols-12 gap-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-2">Nom</div>
            <div className="col-span-2">Seriya №</div>
            <div className="col-span-3">O'rnatilgan sana *</div>
            <div className="col-span-2">Norma km</div>
            <div className="col-span-2">Izoh</div>
          </div>

          {/* Slot rows */}
          <div className="space-y-2 max-h-[440px] overflow-y-auto pr-1">
            {slots.map((slot, idx) => (
              <div
                key={slot.slotNumber}
                className={`grid grid-cols-12 gap-2 items-center px-3 py-2.5 rounded-xl border transition-colors ${
                  !slot.installDate
                    ? 'bg-red-50 dark:bg-red-900/10 border-red-200 dark:border-red-800'
                    : 'bg-gray-50 dark:bg-gray-700/40 border-gray-200 dark:border-gray-600'
                }`}
              >
                <div className="col-span-1 text-center">
                  <span className="w-6 h-6 inline-flex items-center justify-center rounded-full bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs font-bold">
                    {slot.slotNumber}
                  </span>
                </div>

                <div className="col-span-2">
                  <input
                    value={slot.label}
                    onChange={e => updateSlot(idx, 'label', e.target.value)}
                    placeholder={DEFAULT_LABELS[slot.slotNumber] || `Shina ${slot.slotNumber}`}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="col-span-2">
                  <input
                    value={slot.serialCode}
                    onChange={e => updateSlot(idx, 'serialCode', e.target.value)}
                    placeholder="ABC-12345"
                    className="w-full px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                <div className="col-span-3">
                  <input
                    type="date"
                    value={slot.installDate}
                    onChange={e => updateSlot(idx, 'installDate', e.target.value)}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  {slot.installDate && (() => {
                    const gps = gpsPreview[slot.slotNumber]
                    if (!gps) return null
                    if (gps.loading) return (
                      <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 pl-1">
                        <Loader2 className="w-3 h-3 animate-spin" /> GPS hisoblanmoqda...
                      </p>
                    )
                    if (gps.km === null) return null
                    return (
                      <p className="text-xs mt-0.5 pl-1 font-medium text-blue-600 dark:text-blue-400">
                        GPS: {gps.km.toLocaleString()} km yurgan
                      </p>
                    )
                  })()}
                </div>

                <div className="col-span-2">
                  <div className="relative">
                    <input
                      type="number"
                      min={1000}
                      step={5000}
                      value={slot.normKm}
                      onChange={e => updateSlot(idx, 'normKm', Number(e.target.value))}
                      className="w-full px-2 py-1.5 pr-7 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">km</span>
                  </div>
                </div>

                <div className="col-span-2">
                  <input
                    value={slot.notes}
                    onChange={e => updateSlot(idx, 'notes', e.target.value)}
                    placeholder="Izoh"
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            ))}
          </div>

          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-xl text-xs text-blue-700 dark:text-blue-300 flex items-start gap-2">
            <Gauge className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <span>
              <strong>GPS hisob:</strong> Har bir shina uchun o'rnatilgan sanadan bugunga qadar GPSda yurgan km avtomatik hisoblanadi.
              GPS ulanmagan mashinalarda km = 0 bo'ladi.
            </span>
          </div>
        </div>
      </Modal>
    </div>
  )
}
