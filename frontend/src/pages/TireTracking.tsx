import { useState, useCallback, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  CircleDot, Search, Settings, Save, AlertTriangle, CheckCircle,
  AlertCircle, Filter, Car, Gauge, Loader2, RefreshCw, ChevronUp, ChevronDown,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'

// ─── Types ───────────────────────────────────────────────────────────────────

interface Branch { id: string; name: string }

interface SlotRow {
  vehicleId: string
  registrationNumber: string
  brand: string
  model: string
  branchName: string | null
  hasGps: boolean
  slotNumber: number
  label: string | null
  serialCode: string | null
  installDate: string
  normKm: number
  notes: string | null
  usedKm: number
  remainingKm: number
  pct: number
  status: 'ok' | 'warning' | 'critical'
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

const DEFAULT_LABELS: Record<number, string> = {
  1: 'Old chap', 2: "Old o'ng", 3: 'Orqa 1-chap', 4: "Orqa 1-o'ng",
  5: 'Orqa 2-chap', 6: "Orqa 2-o'ng", 7: 'Orqa 3-chap', 8: "Orqa 3-o'ng",
  9: 'Orqa 4-chap', 10: "Orqa 4-o'ng", 11: 'Zaxira 1', 12: 'Zaxira 2',
}

function StatusBadge({ status, pct }: { status?: string; pct?: number }) {
  if (status === 'critical')
    return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300"><AlertTriangle className="w-3 h-3" />Kritik {pct}%</span>
  if (status === 'warning')
    return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><AlertCircle className="w-3 h-3" />Ogohlantirish {pct}%</span>
  return <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><CheckCircle className="w-3 h-3" />Yaxshi {pct}%</span>
}

function MiniBar({ pct, status }: { pct: number; status: string }) {
  const color = status === 'critical' ? 'bg-red-500' : status === 'warning' ? 'bg-amber-400' : 'bg-emerald-500'
  return (
    <div className="h-1.5 w-20 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  )
}

function emptySlots(count: number): TrackingSlot[] {
  return Array.from({ length: count }, (_, i) => ({
    slotNumber: i + 1,
    label: DEFAULT_LABELS[i + 1] || `Shina ${i + 1}`,
    serialCode: '', installDate: '', normKm: 50000, notes: '',
  }))
}

type SortKey = 'registrationNumber' | 'slotNumber' | 'installDate' | 'usedKm' | 'remainingKm' | 'pct'

// ─── Main ────────────────────────────────────────────────────────────────────

export default function TireTracking() {
  const qc = useQueryClient()
  const [search, setSearch] = useState('')
  const [branchId, setBranchId] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | 'critical' | 'warning' | 'ok'>('all')
  const [sortKey, setSortKey] = useState<SortKey>('pct')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Setup modal state
  const [setupVehicle, setSetupVehicle] = useState<Vehicle | null>(null)
  const [tireCount, setTireCount] = useState(4)
  const [slots, setSlots] = useState<TrackingSlot[]>([])
  const [gpsPreview, setGpsPreview] = useState<Record<number, { km: number | null; loading: boolean }>>({})
  const gpsTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})

  const fetchGpsKm = useCallback((slotNumber: number, date: string) => {
    if (!setupVehicle || !date) return
    clearTimeout(gpsTimers.current[slotNumber])
    setGpsPreview(p => ({ ...p, [slotNumber]: { km: null, loading: true } }))
    gpsTimers.current[slotNumber] = setTimeout(async () => {
      try {
        const r = await api.get(`/tire-tracking/vehicles/${setupVehicle.id}/gps-km`, { params: { installDate: date } })
        setGpsPreview(p => ({ ...p, [slotNumber]: { km: r.data.data.usedKm, loading: false } }))
      } catch {
        setGpsPreview(p => ({ ...p, [slotNumber]: { km: null, loading: false } }))
      }
    }, 600)
  }, [setupVehicle])

  const { data: branches = [] } = useQuery<Branch[]>({
    queryKey: ['branches-select'],
    queryFn: () => api.get('/branches?select=true').then(r => r.data.data),
  })

  // Barcha shinalar — GPS km bilan (asosiy jadval)
  const { data: allSlots = [], isLoading, refetch, isFetching } = useQuery<SlotRow[]>({
    queryKey: ['tire-tracking-slots', branchId],
    queryFn: () => api.get('/tire-tracking/slots', { params: branchId ? { branchId } : {} }).then(r => r.data.data),
    staleTime: 2 * 60 * 1000,
  })

  // Setup uchun vehicle detail
  const { data: trackingDetail } = useQuery<VehicleTracking>({
    queryKey: ['tire-tracking', setupVehicle?.id],
    queryFn: () => api.get(`/tire-tracking/vehicles/${setupVehicle!.id}`).then(r => r.data.data),
    enabled: !!setupVehicle,
    retry: 1,
  })

  const saveMutation = useMutation({
    mutationFn: (data: { slots: TrackingSlot[] }) =>
      api.put(`/tire-tracking/vehicles/${setupVehicle!.id}`, data),
    onSuccess: () => {
      toast.success('Saqlandi')
      qc.invalidateQueries({ queryKey: ['tire-tracking-slots'] })
      qc.invalidateQueries({ queryKey: ['tire-tracking', setupVehicle?.id] })
      setSetupVehicle(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openSetup = (vehicleId: string) => {
    // vehicleId bo'yicha vehicles listdan vehicle topish uchun API call
    api.get('/tire-tracking/vehicles', { params: { branchId } })
      .then(r => {
        const v = r.data.data.find((x: Vehicle) => x.id === vehicleId)
        if (!v) return
        setSetupVehicle(v)
        const existing = trackingDetail?.slots || []
        const count = existing.length || v.tireTrackings.length || 4
        setTireCount(count)
        setGpsPreview({})
        if (existing.length > 0) {
          setSlots(existing.map((s: any) => ({
            ...s,
            installDate: s.installDate ? s.installDate.split('T')[0] : '',
            label: s.label || DEFAULT_LABELS[s.slotNumber] || `Shina ${s.slotNumber}`,
            serialCode: s.serialCode || '',
            notes: s.notes || '',
          })))
        } else {
          setSlots(emptySlots(count))
        }
      })
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

  const handleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortKey(key); setSortDir('asc') }
  }

  // Filter + sort
  const q = search.trim().toLowerCase()
  const filtered = allSlots
    .filter(s =>
      (statusFilter === 'all' || s.status === statusFilter) &&
      (
        s.registrationNumber.toLowerCase().includes(q) ||
        (s.serialCode ?? '').toLowerCase().includes(q) ||
        (s.label ?? '').toLowerCase().includes(q) ||
        (s.branchName ?? '').toLowerCase().includes(q)
      )
    )
    .sort((a, b) => {
      let va: any = a[sortKey], vb: any = b[sortKey]
      if (typeof va === 'string') va = va.toLowerCase()
      if (typeof vb === 'string') vb = vb.toLowerCase()
      if (va < vb) return sortDir === 'asc' ? -1 : 1
      if (va > vb) return sortDir === 'asc' ? 1 : -1
      return 0
    })

  const criticalCount = allSlots.filter(s => s.status === 'critical').length
  const warningCount = allSlots.filter(s => s.status === 'warning').length
  const okCount = allSlots.filter(s => s.status === 'ok').length

  const SortIcon = ({ k }: { k: SortKey }) => {
    if (sortKey !== k) return <ChevronUp className="w-3 h-3 text-gray-300 dark:text-gray-600" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 text-blue-500" />
      : <ChevronDown className="w-3 h-3 text-blue-500" />
  }

  const thCls = 'px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wider select-none'
  const sortTh = (k: SortKey, label: string) => (
    <th className={`${thCls} cursor-pointer hover:text-gray-900 dark:hover:text-white`} onClick={() => handleSort(k)}>
      <span className="inline-flex items-center gap-1">{label}<SortIcon k={k} /></span>
    </th>
  )

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
            Har bir shina — o'rnatilgan sana, seriya raqami, GPS km
          </p>
        </div>
        <button
          onClick={() => refetch()}
          disabled={isFetching}
          className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isFetching ? 'animate-spin' : ''}`} />
          Yangilash
        </button>
      </div>

      {/* Stats */}
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => setStatusFilter('all')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${statusFilter === 'all' ? 'bg-blue-600 text-white border-blue-600' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800 text-blue-700 dark:text-blue-300 hover:border-blue-400'}`}
        >
          <CircleDot className="w-4 h-4" />
          <span className="font-semibold">{allSlots.length}</span>
          <span>ta shina</span>
        </button>
        {criticalCount > 0 && (
          <button
            onClick={() => setStatusFilter(statusFilter === 'critical' ? 'all' : 'critical')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${statusFilter === 'critical' ? 'bg-red-600 text-white border-red-600' : 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-700 dark:text-red-300 hover:border-red-400'}`}
          >
            <AlertTriangle className="w-4 h-4" />
            <span className="font-semibold">{criticalCount}</span>
            <span>kritik</span>
          </button>
        )}
        {warningCount > 0 && (
          <button
            onClick={() => setStatusFilter(statusFilter === 'warning' ? 'all' : 'warning')}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${statusFilter === 'warning' ? 'bg-amber-500 text-white border-amber-500' : 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-700 dark:text-amber-300 hover:border-amber-400'}`}
          >
            <AlertCircle className="w-4 h-4" />
            <span className="font-semibold">{warningCount}</span>
            <span>ogohlantirish</span>
          </button>
        )}
        <button
          onClick={() => setStatusFilter(statusFilter === 'ok' ? 'all' : 'ok')}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm border transition-all ${statusFilter === 'ok' ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-700 dark:text-emerald-300 hover:border-emerald-400'}`}
        >
          <CheckCircle className="w-4 h-4" />
          <span className="font-semibold">{okCount}</span>
          <span>yaxshi</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Mashina raqami, seriya yoki o'rin..."
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
              {branches.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 overflow-hidden shadow-sm">
        {isLoading ? (
          <div className="flex items-center justify-center py-20 text-gray-400">
            <Loader2 className="w-8 h-8 animate-spin mr-3" />
            <span>GPS ma'lumotlari yuklanmoqda...</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-gray-400 dark:text-gray-500">
            <CircleDot className="w-14 h-14 mb-4 opacity-25" />
            <p className="text-base font-medium">
              {allSlots.length === 0 ? 'Hech bir shinaga sozlama kiritilmagan' : 'Natija topilmadi'}
            </p>
            <p className="text-sm mt-1">
              {allSlots.length === 0
                ? 'Mashinalar bo\'limidan shina ma\'lumotlarini kiriting'
                : 'Qidiruv yoki filtr shartlarini o\'zgartiring'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
              <thead className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  {sortTh('registrationNumber', 'Mashina')}
                  <th className={thCls}>O'rin / Seriya</th>
                  {sortTh('installDate', "O'rnatilgan")}
                  {sortTh('usedKm', 'GPS yurgan')}
                  {sortTh('remainingKm', 'Qolgan')}
                  {sortTh('pct', 'Holat')}
                  <th className={thCls}>Amal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700/50">
                {filtered.map((row, idx) => (
                  <tr
                    key={`${row.vehicleId}-${row.slotNumber}`}
                    className={`transition-colors hover:bg-gray-50 dark:hover:bg-gray-700/30 ${
                      row.status === 'critical' ? 'bg-red-50/30 dark:bg-red-900/5' :
                      row.status === 'warning' ? 'bg-amber-50/30 dark:bg-amber-900/5' : ''
                    }`}
                  >
                    {/* Mashina */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                          row.status === 'critical' ? 'bg-red-500' :
                          row.status === 'warning' ? 'bg-amber-400' : 'bg-emerald-400'
                        }`} />
                        <div>
                          <p className="font-semibold text-gray-900 dark:text-white text-sm">{row.registrationNumber}</p>
                          <p className="text-xs text-gray-400 dark:text-gray-500">{row.brand} {row.model}</p>
                          {row.branchName && <p className="text-xs text-gray-300 dark:text-gray-600">{row.branchName}</p>}
                        </div>
                      </div>
                    </td>

                    {/* O'rin / Seriya */}
                    <td className="px-4 py-3">
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {row.label || `Shina ${row.slotNumber}`}
                      </p>
                      {row.serialCode ? (
                        <p className="text-xs font-mono text-blue-600 dark:text-blue-400">{row.serialCode}</p>
                      ) : (
                        <p className="text-xs text-gray-300 dark:text-gray-600 italic">Seriya yo'q</p>
                      )}
                      {!row.hasGps && (
                        <span className="text-xs text-amber-500">GPS yo'q</span>
                      )}
                    </td>

                    {/* O'rnatilgan sana */}
                    <td className="px-4 py-3">
                      <p className="text-sm text-gray-800 dark:text-gray-200">{formatDate(row.installDate)}</p>
                    </td>

                    {/* GPS yurgan */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Gauge className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                        <span className={`text-sm font-semibold ${
                          row.usedKm === 0 && !row.hasGps ? 'text-gray-400' : 'text-gray-900 dark:text-white'
                        }`}>
                          {row.usedKm.toLocaleString()} km
                        </span>
                      </div>
                    </td>

                    {/* Qolgan */}
                    <td className="px-4 py-3">
                      <span className={`text-sm font-bold ${
                        row.remainingKm < 5000 ? 'text-red-600' :
                        row.remainingKm < 15000 ? 'text-amber-600' : 'text-emerald-600 dark:text-emerald-400'
                      }`}>
                        {row.remainingKm.toLocaleString()} km
                      </span>
                      <p className="text-xs text-gray-400 mt-0.5">/ {row.normKm.toLocaleString()} norma</p>
                    </td>

                    {/* Holat */}
                    <td className="px-4 py-3">
                      <StatusBadge status={row.status} pct={row.pct} />
                      <MiniBar pct={row.pct} status={row.status} />
                    </td>

                    {/* Amal */}
                    <td className="px-4 py-3">
                      <button
                        onClick={() => openSetup(row.vehicleId)}
                        className="inline-flex items-center gap-1.5 text-xs px-2.5 py-1.5 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 hover:border-blue-400 hover:text-blue-600 dark:hover:text-blue-400 transition-all"
                      >
                        <Settings className="w-3.5 h-3.5" />
                        Sozlash
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/30 border-t border-gray-200 dark:border-gray-700 text-xs text-gray-400 dark:text-gray-500">
              Jami: {filtered.length} ta shina{filtered.length !== allSlots.length ? ` (${allSlots.length} dan)` : ''}
            </div>
          </div>
        )}
      </div>

      {/* ── Setup Modal ──────────────────────────────────────────────────────── */}
      <Modal
        open={!!setupVehicle}
        onClose={() => setSetupVehicle(null)}
        title={setupVehicle ? `${setupVehicle.registrationNumber} — shinalarni sozlash` : ''}
        size="xl"
        footer={
          <div className="flex gap-2 w-full">
            <Button variant="outline" onClick={() => setSetupVehicle(null)}>Bekor qilish</Button>
            <Button icon={<Save className="w-4 h-4" />} loading={saveMutation.isPending} onClick={handleSave}>
              Saqlash
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm font-medium text-gray-700 dark:text-gray-300 whitespace-nowrap">Shinalar soni:</span>
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
                >{n}</button>
              ))}
            </div>
            <span className="text-xs text-gray-400 hidden sm:block">4=sedan · 6=Isuzu · 8-12=yuk mashinasi</span>
          </div>

          <div className="grid grid-cols-12 gap-2 px-3 text-xs font-medium text-gray-500 dark:text-gray-400 uppercase tracking-wide">
            <div className="col-span-1 text-center">#</div>
            <div className="col-span-2">Nom</div>
            <div className="col-span-2">Seriya №</div>
            <div className="col-span-3">O'rnatilgan sana *</div>
            <div className="col-span-2">Norma km</div>
            <div className="col-span-2">Izoh</div>
          </div>

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
                    if (gps.loading) return <p className="flex items-center gap-1 text-xs text-gray-400 mt-0.5 pl-1"><Loader2 className="w-3 h-3 animate-spin" /> GPS hisoblanmoqda...</p>
                    if (gps.km === null) return null
                    return <p className="text-xs mt-0.5 pl-1 font-medium text-blue-600 dark:text-blue-400">GPS: {gps.km.toLocaleString()} km yurgan</p>
                  })()}
                </div>
                <div className="col-span-2">
                  <div className="relative">
                    <input
                      type="number" min={1000} step={5000}
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
              <strong>GPS hisob:</strong> O'rnatilgan sanadan bugunga qadar GPSda yurgan km avtomatik hisoblanadi.
              GPS ulanmagan mashinalarda km = 0 bo'ladi.
            </span>
          </div>
        </div>
      </Modal>
    </div>
  )
}
