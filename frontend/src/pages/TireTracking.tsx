import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { CircleDot, Search, Settings, ChevronRight, Plus, Trash2, Save, AlertTriangle, CheckCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Badge from '../components/ui/Badge'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Vehicle {
  id: string
  registrationNumber: string
  brand: string
  model: string
  year: number
  mileage: number
  gpsUnitName?: string
  status: string
  branch: { name: string }
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
  const color = status === 'critical' ? 'bg-red-500' : status === 'warning' ? 'bg-yellow-400' : 'bg-green-500'
  const bg = status === 'critical' ? 'bg-red-100 dark:bg-red-900/20' : status === 'warning' ? 'bg-yellow-100 dark:bg-yellow-900/20' : 'bg-green-100 dark:bg-green-900/20'
  return (
    <div className={`h-2.5 rounded-full ${bg} overflow-hidden w-full`}>
      <div className={`h-full rounded-full transition-all ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

function StatusIcon({ status }: { status?: string }) {
  if (status === 'critical') return <AlertTriangle className="w-4 h-4 text-red-500" />
  if (status === 'warning') return <AlertCircle className="w-4 h-4 text-yellow-500" />
  return <CheckCircle className="w-4 h-4 text-green-500" />
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
  const [selected, setSelected] = useState<Vehicle | null>(null)
  const [tireCount, setTireCount] = useState(4)
  const [slots, setSlots] = useState<TrackingSlot[]>([])
  const [setupMode, setSetupMode] = useState(false) // true=sozlash, false=ko'rish

  // Mashinalar ro'yxati
  const { data: vehicles = [], isLoading } = useQuery<Vehicle[]>({
    queryKey: ['tire-tracking-vehicles'],
    queryFn: () => api.get('/tire-tracking/vehicles').then(r => r.data.data),
  })

  // Tanlangan mashina tracking ma'lumotlari
  const { data: trackingData, isLoading: trackingLoading } = useQuery<VehicleTracking>({
    queryKey: ['tire-tracking', selected?.id],
    queryFn: () => api.get(`/tire-tracking/vehicles/${selected!.id}`).then(r => r.data.data),
    enabled: !!selected,
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

  // Mashina tanlanganda
  const openVehicle = (v: Vehicle) => {
    setSelected(v)
    setSetupMode(false)
  }

  // Sozlash rejimini ochish
  const openSetup = () => {
    const existing = trackingData?.slots || []
    const count = existing.length || selected?.tireTrackings.length || 4
    setTireCount(count)
    if (existing.length > 0) {
      setSlots(existing.map(s => ({
        ...s,
        installDate: s.installDate ? s.installDate.split('T')[0] : '',
        label: s.label || DEFAULT_LABELS[s.slotNumber] || `Shina ${s.slotNumber}`,
        serialCode: (s as any).serialCode || '',
        notes: s.notes || '',
      })))
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
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, [field]: value } : s))
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
    v.branch.name.toLowerCase().includes(q)
  )

  const criticalCount = (v: Vehicle) => {
    if (!trackingData || trackingData.id !== v.id) return 0
    return trackingData.slots.filter(s => s.status === 'critical').length
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Shina Nazorati</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">GPS asosida har bir shina yurgan km nazorati</p>
        </div>
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Mashina raqami yoki nomi..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Vehicle cards grid */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Yuklanmoqda...</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {filtered.map(v => {
            const slotCount = v.tireTrackings.length
            const hasGps = !!v.gpsUnitName
            return (
              <button
                key={v.id}
                onClick={() => openVehicle(v)}
                className="text-left bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl p-4 hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-md transition-all group"
              >
                <div className="flex items-start justify-between mb-3">
                  <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
                    <CircleDot className="w-5 h-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <div className="flex items-center gap-1">
                    {!hasGps && (
                      <span title="GPS ulanmagan" className="text-xs text-amber-500">⚠</span>
                    )}
                    <ChevronRight className="w-4 h-4 text-gray-400 group-hover:text-blue-500 transition-colors" />
                  </div>
                </div>
                <p className="font-bold text-gray-900 dark:text-white">{v.registrationNumber}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">{v.brand} {v.model} ({v.year})</p>
                <p className="text-xs text-gray-400 mt-1">{v.branch.name}</p>
                <div className="mt-3 flex items-center justify-between">
                  {slotCount > 0 ? (
                    <span className="text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-2 py-0.5 rounded-full font-medium">
                      {slotCount} ta shina sozlangan
                    </span>
                  ) : (
                    <span className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 px-2 py-0.5 rounded-full">
                      Sozlanmagan
                    </span>
                  )}
                  <span className="text-xs text-gray-400">{Number(v.mileage).toLocaleString()} km</span>
                </div>
              </button>
            )
          })}
          {filtered.length === 0 && (
            <div className="col-span-full text-center py-12 text-gray-400">
              <CircleDot className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>Mashina topilmadi</p>
            </div>
          )}
        </div>
      )}

      {/* ── Vehicle Detail Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!selected && !setupMode}
        onClose={() => setSelected(null)}
        title={selected ? `${selected.registrationNumber} — shina nazorati` : ''}
        size="xl"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={() => setSelected(null)}>Yopish</Button>
            <Button icon={<Settings className="w-4 h-4" />} onClick={openSetup}>
              Sozlash
            </Button>
          </div>
        }
      >
        {trackingLoading ? (
          <div className="py-12 text-center text-gray-400">Yuklanmoqda...</div>
        ) : !trackingData?.slots.length ? (
          <div className="py-12 text-center space-y-3">
            <CircleDot className="w-12 h-12 mx-auto text-gray-300" />
            <p className="text-gray-500">Bu mashina uchun shina nazorati sozlanmagan</p>
            <Button icon={<Settings className="w-4 h-4" />} onClick={openSetup}>
              Hozir sozlash
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Vehicle info */}
            <div className="flex items-center gap-4 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-lg text-sm">
              <div>
                <span className="text-gray-500">Mashina:</span>{' '}
                <span className="font-medium text-gray-900 dark:text-white">{trackingData.brand} {trackingData.model}</span>
              </div>
              <div>
                <span className="text-gray-500">Hozirgi odometr:</span>{' '}
                <span className="font-bold text-blue-600">{Number(trackingData.mileage).toLocaleString()} km</span>
              </div>
              {trackingData.gpsUnitName && (
                <div>
                  <span className="text-gray-500">GPS:</span>{' '}
                  <span className="text-green-600 font-medium">{trackingData.gpsUnitName}</span>
                </div>
              )}
            </div>

            {/* Slots grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {trackingData.slots.map(slot => (
                <div
                  key={slot.slotNumber}
                  className={`p-4 rounded-xl border-2 ${
                    slot.status === 'critical'
                      ? 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'
                      : slot.status === 'warning'
                      ? 'border-yellow-200 dark:border-yellow-800 bg-yellow-50 dark:bg-yellow-900/10'
                      : 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10'
                  }`}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <StatusIcon status={slot.status} />
                      <span className="font-semibold text-gray-900 dark:text-white text-sm">
                        {slot.label || `Shina ${slot.slotNumber}`}
                      </span>
                    </div>
                    <span className={`text-lg font-bold ${
                      slot.status === 'critical' ? 'text-red-600' :
                      slot.status === 'warning' ? 'text-yellow-600' : 'text-green-600'
                    }`}>{slot.pct}%</span>
                  </div>

                  <ProgressBar pct={slot.pct ?? 0} status={slot.status ?? 'ok'} />

                  <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-400">
                    <div>
                      <p className="text-gray-400">O'rnatilgan sana</p>
                      <p className="font-medium text-gray-900 dark:text-white">{formatDate(slot.installDate as string)}</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Norma</p>
                      <p className="font-medium text-gray-900 dark:text-white">{(slot.normKm).toLocaleString()} km</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Yurgan (GPS)</p>
                      <p className="font-bold text-gray-900 dark:text-white">{(slot.usedKm ?? 0).toLocaleString()} km</p>
                    </div>
                    <div>
                      <p className="text-gray-400">Qolgan</p>
                      <p className={`font-bold ${
                        (slot.remainingKm ?? 0) < 5000 ? 'text-red-600' :
                        (slot.remainingKm ?? 0) < 15000 ? 'text-yellow-600' : 'text-green-600'
                      }`}>{(slot.remainingKm ?? 0).toLocaleString()} km</p>
                    </div>
                  </div>
                  {(slot as any).serialCode && (
                    <p className="mt-2 text-xs text-gray-500">
                      Raqam: <span className="font-mono font-medium text-gray-700 dark:text-gray-300">{(slot as any).serialCode}</span>
                    </p>
                  )}
                  {slot.notes && (
                    <p className="mt-2 text-xs text-gray-500 italic">{slot.notes}</p>
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
          <div className="flex items-center gap-3">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">
              Shinalar soni:
            </label>
            <div className="flex gap-1">
              {[4, 6, 8, 10, 12].map(n => (
                <button
                  key={n}
                  onClick={() => handleCountChange(n)}
                  className={`px-3 py-1.5 text-sm rounded-lg font-medium border transition-colors ${
                    tireCount === n
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-400 hover:border-blue-400'
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">(4=sedan/yengil, 6=Isuzu, 8-12=yuk mashinasi)</span>
          </div>

          {/* Slot rows */}
          <div className="space-y-2 max-h-[480px] overflow-y-auto pr-1">
            {slots.map((slot, idx) => (
              <div key={slot.slotNumber} className="grid grid-cols-12 gap-2 items-center p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl border border-gray-200 dark:border-gray-600">
                {/* Number */}
                <div className="col-span-1 text-center">
                  <span className="text-sm font-bold text-gray-400 dark:text-gray-500">{slot.slotNumber}</span>
                </div>

                {/* Label */}
                <div className="col-span-2">
                  <input
                    value={slot.label}
                    onChange={e => updateSlot(idx, 'label', e.target.value)}
                    placeholder={DEFAULT_LABELS[slot.slotNumber] || `Shina ${slot.slotNumber}`}
                    className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Serial code */}
                <div className="col-span-2">
                  <input
                    value={slot.serialCode}
                    onChange={e => updateSlot(idx, 'serialCode', e.target.value)}
                    placeholder="Seriya raqami"
                    className="w-full px-2 py-1.5 text-sm font-mono border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Install date */}
                <div className="col-span-3">
                  <input
                    type="date"
                    value={slot.installDate}
                    onChange={e => updateSlot(idx, 'installDate', e.target.value)}
                    className={`w-full px-2 py-1.5 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${
                      !slot.installDate ? 'border-red-300 dark:border-red-600' : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                </div>

                {/* Norm km */}
                <div className="col-span-2">
                  <div className="relative">
                    <input
                      type="number"
                      min={1000}
                      step={5000}
                      value={slot.normKm}
                      onChange={e => updateSlot(idx, 'normKm', Number(e.target.value))}
                      className="w-full px-2 py-1.5 pr-8 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-gray-400">km</span>
                  </div>
                </div>

                {/* Notes */}
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

          <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg text-xs text-blue-700 dark:text-blue-300">
            <strong>GPS hisob:</strong> Har bir shina uchun o'rnatilgan sanadan bugunga qadar GPSda yurgan km avtomatik hisoblanadi.
            GPS ulanmagan mashinalarda km = 0 bo'ladi.
          </div>
        </div>
      </Modal>
    </div>
  )
}
