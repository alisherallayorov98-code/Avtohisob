import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, FileText, Search, Eye, CheckCircle, XCircle, Play, Printer, X, ChevronDown } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate, formatDateTime } from '../lib/utils'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import SearchableSelect from '../components/ui/SearchableSelect'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'

// ─── Constants ──────────────────────────────────────────────────────────────

const STATUS_CONFIG: Record<string, { label: string; variant: any }> = {
  draft:     { label: 'Qoralama',    variant: 'secondary' },
  active:    { label: 'Yo\'lda',     variant: 'warning'   },
  completed: { label: 'Yakunlandi',  variant: 'success'   },
  cancelled: { label: 'Bekor',       variant: 'danger'    },
}

const PURPOSE_OPTIONS = [
  'Xizmat safari',
  'Yuk tashish',
  'Yo\'lovchi tashish',
  'Ta\'mirlashga olib borish',
  'Texnik ko\'rik',
  'Boshqa',
]

// ─── Types ───────────────────────────────────────────────────────────────────

interface Waybill {
  id: string
  number: string
  status: string
  purpose: string
  destination: string
  plannedDeparture: string
  plannedReturn?: string
  actualDeparture?: string
  actualReturn?: string
  departureOdometer?: number
  returnOdometer?: number
  distanceTraveled?: number
  fuelAtDeparture: number
  fuelIssued: number
  fuelAtReturn: number
  fuelConsumed?: number
  mechanicName?: string
  mechanicApproved: boolean
  dispatcherName?: string
  notes?: string
  vehicle: { id: string; registrationNumber: string; brand: string; model: string; mileage: number }
  driver: { id: string; fullName: string }
  branch: { id: string; name: string }
}

// ─── Print View ──────────────────────────────────────────────────────────────

function PrintView({ waybill, onClose }: { waybill: Waybill; onClose: () => void }) {
  const handlePrint = () => window.print()

  return (
    <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4 print:p-0 print:bg-white print:inset-auto print:fixed print:inset-0">
      <div className="bg-white w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl shadow-2xl print:max-w-none print:max-h-none print:rounded-none print:shadow-none print:overflow-visible">
        {/* Print toolbar */}
        <div className="flex items-center justify-between p-4 border-b print:hidden">
          <h3 className="font-semibold text-gray-900">Yo'l varag'i — {waybill.number}</h3>
          <div className="flex gap-2">
            <button onClick={handlePrint}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700">
              <Printer className="w-4 h-4" /> Chop etish
            </button>
            <button onClick={onClose} className="p-1.5 text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
          </div>
        </div>

        {/* Document */}
        <div className="p-8 print:p-6 font-serif text-sm text-gray-900">
          {/* Header */}
          <div className="text-center mb-6 border-b-2 border-gray-900 pb-4">
            <div className="text-xs text-gray-500 mb-1">{waybill.branch.name}</div>
            <h1 className="text-xl font-bold uppercase tracking-widest">YO'L VARAG'I</h1>
            <div className="text-xs text-gray-500 mt-1">(Путевой лист)</div>
            <div className="mt-2 text-base font-bold">№ {waybill.number}</div>
          </div>

          {/* Vehicle & Driver info */}
          <div className="grid grid-cols-2 gap-4 mb-4">
            <div>
              <table className="w-full text-xs border-collapse">
                <tbody>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold w-2/5">Avtomobil</td>
                      <td className="border border-gray-400 px-2 py-1">{waybill.vehicle.brand} {waybill.vehicle.model}</td></tr>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold">Davlat raqami</td>
                      <td className="border border-gray-400 px-2 py-1 font-mono font-bold">{waybill.vehicle.registrationNumber}</td></tr>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold">Haydovchi</td>
                      <td className="border border-gray-400 px-2 py-1">{waybill.driver.fullName}</td></tr>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold">Maqsad</td>
                      <td className="border border-gray-400 px-2 py-1">{waybill.purpose}</td></tr>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold">Marshrut</td>
                      <td className="border border-gray-400 px-2 py-1">{waybill.destination}</td></tr>
                </tbody>
              </table>
            </div>
            <div>
              <table className="w-full text-xs border-collapse">
                <tbody>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold w-2/5">Rejalashtirilgan jo'nash</td>
                      <td className="border border-gray-400 px-2 py-1">{formatDateTime(waybill.plannedDeparture)}</td></tr>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold">Rejalashtirilgan qaytish</td>
                      <td className="border border-gray-400 px-2 py-1">{waybill.plannedReturn ? formatDateTime(waybill.plannedReturn) : '—'}</td></tr>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold">Haqiqiy jo'nash</td>
                      <td className="border border-gray-400 px-2 py-1">{waybill.actualDeparture ? formatDateTime(waybill.actualDeparture) : '—'}</td></tr>
                  <tr><td className="border border-gray-400 bg-gray-50 px-2 py-1 font-semibold">Haqiqiy qaytish</td>
                      <td className="border border-gray-400 px-2 py-1">{waybill.actualReturn ? formatDateTime(waybill.actualReturn) : '—'}</td></tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Odometer & Fuel */}
          <table className="w-full text-xs border-collapse mb-4">
            <thead>
              <tr className="bg-gray-100">
                <th className="border border-gray-400 px-2 py-1.5 text-left" colSpan={2}>Odometr (km)</th>
                <th className="border border-gray-400 px-2 py-1.5 text-left" colSpan={3}>Yoqilg'i (litr)</th>
              </tr>
              <tr className="bg-gray-50">
                <th className="border border-gray-400 px-2 py-1">Ketishda</th>
                <th className="border border-gray-400 px-2 py-1">Qaytishda</th>
                <th className="border border-gray-400 px-2 py-1">Ketishda</th>
                <th className="border border-gray-400 px-2 py-1">Berildi</th>
                <th className="border border-gray-400 px-2 py-1">Qaytishda</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td className="border border-gray-400 px-2 py-2 text-center font-mono">{waybill.departureOdometer?.toLocaleString() ?? '___________'}</td>
                <td className="border border-gray-400 px-2 py-2 text-center font-mono">{waybill.returnOdometer?.toLocaleString() ?? '___________'}</td>
                <td className="border border-gray-400 px-2 py-2 text-center font-mono">{Number(waybill.fuelAtDeparture).toFixed(1)}</td>
                <td className="border border-gray-400 px-2 py-2 text-center font-mono">{Number(waybill.fuelIssued).toFixed(1)}</td>
                <td className="border border-gray-400 px-2 py-2 text-center font-mono">{waybill.status === 'completed' ? Number(waybill.fuelAtReturn).toFixed(1) : '___________'}</td>
              </tr>
            </tbody>
          </table>

          {/* Results row */}
          {(waybill.distanceTraveled || waybill.fuelConsumed) && (
            <div className="grid grid-cols-2 gap-4 mb-4 p-3 bg-gray-50 border border-gray-300 rounded">
              <div className="text-xs"><span className="font-semibold">Bosib o'tilgan masofa:</span> {waybill.distanceTraveled?.toLocaleString()} km</div>
              <div className="text-xs"><span className="font-semibold">Sarflangan yoqilg'i:</span> {Number(waybill.fuelConsumed).toFixed(1)} litr</div>
            </div>
          )}

          {/* Mechanic check */}
          <div className="grid grid-cols-2 gap-6 mt-6 text-xs">
            <div>
              <div className="font-semibold mb-2 border-b border-gray-300 pb-1">Mexanik tekshiruvi</div>
              <div className="space-y-3">
                <div>Texnik holati: <span className={waybill.mechanicApproved ? 'text-green-700 font-bold' : ''}>{waybill.mechanicApproved ? 'RUXSAT BERILDI ✓' : '_______________'}</span></div>
                <div>Mexanik: {waybill.mechanicName || '___________________________'}</div>
                <div className="mt-4">Imzo: _______________________</div>
              </div>
            </div>
            <div>
              <div className="font-semibold mb-2 border-b border-gray-300 pb-1">Dispetcher</div>
              <div className="space-y-3">
                <div>F.I.Sh: {waybill.dispatcherName || '___________________________'}</div>
                <div className="mt-4">Imzo: _______________________</div>
                <div className="mt-2">Sana: {formatDate(waybill.plannedDeparture)}</div>
              </div>
            </div>
          </div>

          {/* Signatures */}
          <div className="grid grid-cols-2 gap-6 mt-6 text-xs">
            <div>
              <div className="font-semibold mb-3 border-b border-gray-300 pb-1">Haydovchi</div>
              <div>F.I.Sh: {waybill.driver.fullName}</div>
              <div className="mt-4">Imzo: _______________________</div>
            </div>
            <div>
              <div className="font-semibold mb-3 border-b border-gray-300 pb-1">Rahbar</div>
              <div className="mt-4">Imzo: _______________________</div>
              <div className="mt-2">M.O. (muhr o'rni)</div>
            </div>
          </div>

          {waybill.notes && (
            <div className="mt-4 p-2 border border-gray-300 rounded text-xs">
              <span className="font-semibold">Izoh:</span> {waybill.notes}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Create/Edit Form Modal ───────────────────────────────────────────────────

function WaybillForm({ waybill, onClose }: { waybill?: Waybill; onClose: () => void }) {
  const qc = useQueryClient()
  const { user } = useAuthStore()

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })
  const { data: driversData } = useQuery({
    queryKey: ['drivers-list'],
    queryFn: () => api.get('/expenses/users', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const now = new Date()
  const localNow = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16)

  const [form, setForm] = useState({
    vehicleId:       waybill?.vehicle.id        ?? '',
    driverId:        waybill?.driver.id         ?? '',
    purpose:         waybill?.purpose           ?? 'Xizmat safari',
    destination:     waybill?.destination       ?? '',
    routeDescription: waybill?.destination      ?? '',
    plannedDeparture: waybill?.plannedDeparture
      ? new Date(waybill.plannedDeparture).toISOString().slice(0, 16)
      : localNow,
    plannedReturn:   waybill?.plannedReturn
      ? new Date(waybill.plannedReturn).toISOString().slice(0, 16)
      : '',
    fuelAtDeparture: String(waybill?.fuelAtDeparture ?? 0),
    fuelIssued:      String(waybill?.fuelIssued      ?? 0),
    mechanicName:    waybill?.mechanicName    ?? '',
    dispatcherName:  waybill?.dispatcherName  ?? '',
    notes:           waybill?.notes           ?? '',
  })

  const mutation = useMutation({
    mutationFn: () => waybill
      ? api.patch(`/waybills/${waybill.id}`, { ...form })
      : api.post('/waybills', { ...form }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waybills'] })
      toast.success(waybill ? 'Yangilandi' : 'Yo\'l varag\'i yaratildi')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const f = (k: keyof typeof form) => (e: any) => setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between p-5 border-b border-gray-200 dark:border-gray-700">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {waybill ? 'Yo\'l varag\'ini tahrirlash' : 'Yangi yo\'l varag\'i'}
          </h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Vehicle */}
          <div className="grid grid-cols-2 gap-3">
            <SearchableSelect
              label="Avtomobil *"
              options={[
                { value: '', label: '— Tanlang —' },
                ...(vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))
              ]}
              value={form.vehicleId}
              onChange={v => setForm(p => ({ ...p, vehicleId: v }))}
              placeholder="Raqam yoki model qidiring..."
            />
            <SearchableSelect
              label="Haydovchi *"
              options={[
                { value: '', label: '— Tanlang —' },
                ...(driversData || []).map((u: any) => ({ value: u.id, label: u.fullName }))
              ]}
              value={form.driverId}
              onChange={v => setForm(p => ({ ...p, driverId: v }))}
              placeholder="Ism qidiring..."
            />
          </div>

          {/* Purpose */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Maqsad *</label>
              <select value={form.purpose} onChange={f('purpose')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm">
                {PURPOSE_OPTIONS.map(o => <option key={o} value={o}>{o}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Marshrut *</label>
              <input value={form.destination} onChange={f('destination')} placeholder="Toshkent → Samarqand"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Jo'nash vaqti *</label>
              <input type="datetime-local" value={form.plannedDeparture} onChange={f('plannedDeparture')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qaytish vaqti</label>
              <input type="datetime-local" value={form.plannedReturn} onChange={f('plannedReturn')}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
          </div>

          {/* Fuel */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Ketishda yoqilg'i (litr)</label>
              <input type="number" value={form.fuelAtDeparture} onChange={f('fuelAtDeparture')} min={0} step={0.1}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Berilgan yoqilg'i (litr)</label>
              <input type="number" value={form.fuelIssued} onChange={f('fuelIssued')} min={0} step={0.1}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
          </div>

          {/* Mechanic & Dispatcher */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mexanik</label>
              <input value={form.mechanicName} onChange={f('mechanicName')} placeholder="Mexanik F.I.Sh"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dispetcher</label>
              <input value={form.dispatcherName} onChange={f('dispatcherName')} placeholder="Dispetcher F.I.Sh"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea value={form.notes} onChange={f('notes')} rows={2}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
          </div>
        </div>

        <div className="flex gap-2 p-5 border-t border-gray-200 dark:border-gray-700">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Bekor
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.vehicleId || !form.driverId || !form.destination}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {mutation.isPending ? 'Saqlanmoqda...' : waybill ? 'Saqlash' : 'Yaratish'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Complete Modal ───────────────────────────────────────────────────────────

function CompleteModal({ waybill, onClose }: { waybill: Waybill; onClose: () => void }) {
  const qc = useQueryClient()
  const [form, setForm] = useState({
    returnOdometer: '',
    fuelAtReturn: '',
    actualReturn: new Date().toISOString().slice(0, 16),
    notes: waybill.notes ?? '',
  })

  const mutation = useMutation({
    mutationFn: () => api.post(`/waybills/${waybill.id}/complete`, {
      returnOdometer: form.returnOdometer ? Number(form.returnOdometer) : undefined,
      fuelAtReturn: Number(form.fuelAtReturn),
      actualReturn: form.actualReturn,
      notes: form.notes || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['waybills'] })
      toast.success('Yo\'l varag\'i yakunlandi')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Yo'l varag'ini yakunlash</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Qaytish odometri (km)</label>
              <input type="number" value={form.returnOdometer}
                onChange={e => setForm(p => ({ ...p, returnOdometer: e.target.value }))}
                placeholder={waybill.departureOdometer ? `> ${waybill.departureOdometer}` : 'km'}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Qaytishda yoqilg'i (litr)</label>
              <input type="number" value={form.fuelAtReturn} step={0.1}
                onChange={e => setForm(p => ({ ...p, fuelAtReturn: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Qaytish vaqti</label>
            <input type="datetime-local" value={form.actualReturn}
              onChange={e => setForm(p => ({ ...p, actualReturn: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Izoh</label>
            <textarea value={form.notes} rows={2}
              onChange={e => setForm(p => ({ ...p, notes: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose}
            className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
            Bekor
          </button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50">
            {mutation.isPending ? 'Saqlanmoqda...' : 'Yakunlash ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Waybills() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const isManager = hasRole('admin', 'super_admin', 'manager')

  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [createModal, setCreateModal] = useState(false)
  const [editModal, setEditModal]   = useState<Waybill | null>(null)
  const [printModal, setPrintModal] = useState<Waybill | null>(null)
  const [completeModal, setCompleteModal] = useState<Waybill | null>(null)
  const [cancelConfirmId, setCancelConfirmId] = useState<string | null>(null)

  const qParams = {
    page, limit,
    status: statusFilter || undefined,
    search: search || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['waybills', qParams],
    queryFn: () => api.get('/waybills', { params: qParams }).then(r => r.data),
  })

  const activateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/waybills/${id}/activate`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['waybills'] }); toast.success('Yo\'l varag\'i aktivlashtirildi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const cancelMutation = useMutation({
    mutationFn: (id: string) => api.post(`/waybills/${id}/cancel`, {}),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['waybills'] }); toast.success('Bekor qilindi') },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const waybills: Waybill[] = data?.data || []
  const meta = data?.meta

  const filtered = waybills

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Yo'l varaqlari</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-0.5">
            {meta?.total || 0} ta yo'l varag'i
          </p>
        </div>
        {isManager && (
          <button onClick={() => setCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> Yangi yo'l varag'i
          </button>
        )}
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Raqam, mashina, haydovchi..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">Barcha statuslar</option>
          {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1) }}
          className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
        {(fromDate || toDate || statusFilter) && (
          <button onClick={() => { setFromDate(''); setToDate(''); setStatusFilter(''); setPage(1) }}
            className="px-3 py-2 text-xs text-red-500 border border-red-200 rounded-lg hover:border-red-300">
            Tozalash
          </button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {Object.entries(STATUS_CONFIG).map(([key, cfg]) => {
          const count = waybills.filter(w => w.status === key).length
          return (
            <div key={key} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">{cfg.label}</p>
              <p className="text-2xl font-bold text-gray-900 dark:text-white mt-1">{count}</p>
            </div>
          )
        })}
      </div>

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16">
            <FileText className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
            <p className="text-gray-500 dark:text-gray-400">Yo'l varaqlari topilmadi</p>
            {isManager && (
              <button onClick={() => setCreateModal(true)}
                className="mt-3 text-sm text-blue-600 hover:text-blue-700">
                Birinchi yo'l varag'ini yarating
              </button>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-700/50">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Raqam</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Mashina</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Haydovchi</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Marshrut</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Jo'nash</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Masofa</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 dark:text-gray-400"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map(w => (
                  <tr key={w.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <span className="font-mono font-bold text-blue-700 dark:text-blue-400 text-xs">{w.number}</span>
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-mono font-semibold text-gray-900 dark:text-white">{w.vehicle.registrationNumber}</p>
                      <p className="text-xs text-gray-400">{w.vehicle.brand} {w.vehicle.model}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-700 dark:text-gray-300">{w.driver.fullName}</td>
                    <td className="px-4 py-3">
                      <p className="text-gray-900 dark:text-white">{w.purpose}</p>
                      <p className="text-xs text-gray-400">{w.destination}</p>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {formatDateTime(w.plannedDeparture)}
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-600 dark:text-gray-400">
                      {w.distanceTraveled ? `${w.distanceTraveled.toLocaleString()} km` : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={STATUS_CONFIG[w.status]?.variant || 'secondary'}>
                        {STATUS_CONFIG[w.status]?.label || w.status}
                      </Badge>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        {/* Print */}
                        <button onClick={() => setPrintModal(w)} title="Chop etish"
                          className="p-1.5 text-gray-400 hover:text-blue-600 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20">
                          <Printer className="w-4 h-4" />
                        </button>
                        {/* Activate */}
                        {isManager && w.status === 'draft' && (
                          <button onClick={() => activateMutation.mutate(w.id)} title="Jo'naydi"
                            className="p-1.5 text-gray-400 hover:text-green-600 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20">
                            <Play className="w-4 h-4" />
                          </button>
                        )}
                        {/* Complete */}
                        {isManager && w.status === 'active' && (
                          <button onClick={() => setCompleteModal(w)} title="Yakunlash"
                            className="p-1.5 text-gray-400 hover:text-green-600 rounded-lg hover:bg-green-50 dark:hover:bg-green-900/20">
                            <CheckCircle className="w-4 h-4" />
                          </button>
                        )}
                        {/* Edit */}
                        {isManager && (w.status === 'draft') && (
                          <button onClick={() => setEditModal(w)} title="Tahrirlash"
                            className="p-1.5 text-gray-400 hover:text-yellow-600 rounded-lg hover:bg-yellow-50 dark:hover:bg-yellow-900/20">
                            <Eye className="w-4 h-4" />
                          </button>
                        )}
                        {/* Cancel */}
                        {isManager && (w.status === 'draft' || w.status === 'active') && (
                          <button onClick={() => setCancelConfirmId(w.id)}
                            title="Bekor qilish"
                            className="p-1.5 text-gray-400 hover:text-red-600 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20">
                            <XCircle className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={meta?.totalPages || 1} total={meta?.total || 0} limit={limit}
        onPageChange={setPage} onLimitChange={setLimit} />

      {/* Modals */}
      {createModal  && <WaybillForm onClose={() => setCreateModal(false)} />}
      {editModal    && <WaybillForm waybill={editModal} onClose={() => setEditModal(null)} />}
      {printModal   && <PrintView waybill={printModal} onClose={() => setPrintModal(null)} />}
      {completeModal && <CompleteModal waybill={completeModal} onClose={() => setCompleteModal(null)} />}

      <ConfirmDialog
        open={!!cancelConfirmId}
        title="Yo'l varaqini bekor qilish"
        message="Bu yo'l varaqini bekor qilishni tasdiqlaysizmi?"
        confirmLabel="Ha, bekor qilish"
        danger={false}
        loading={cancelMutation.isPending}
        onConfirm={() => { cancelMutation.mutate(cancelConfirmId!); setCancelConfirmId(null) }}
        onCancel={() => setCancelConfirmId(null)}
      />
    </div>
  )
}
