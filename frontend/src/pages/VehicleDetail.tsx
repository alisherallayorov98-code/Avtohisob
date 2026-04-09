import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Truck, Fuel, Wrench, DollarSign, Calendar, MapPin, Gauge, Circle, Plus, CheckCircle2, AlertTriangle, AlertCircle, X } from 'lucide-react'
import api from '../lib/api'
import { formatCurrency, formatDate, FUEL_TYPES, VEHICLE_STATUS } from '../lib/utils'
import Badge from '../components/ui/Badge'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import toast from 'react-hot-toast'

const statusColors: Record<string, any> = { active: 'success', maintenance: 'warning', inactive: 'danger' }
const fuelColors: Record<string, any> = { petrol: 'info', diesel: 'warning', gas: 'success', electric: 'default' }

type Tab = 'maintenance' | 'fuel' | 'expenses' | 'tires' | 'service'

const TIRE_STATUS_LABELS: Record<string, string> = {
  in_stock: 'Omborda', installed: "O'rnatilgan",
  returned: 'Qaytarildi', written_off: 'Chiqarildi', damaged: 'Shikastlangan',
}
const TIRE_STATUS_COLORS: Record<string, any> = {
  in_stock: 'info', installed: 'success', returned: 'warning', written_off: 'secondary', damaged: 'danger',
}
const POSITION_LABELS: Record<string, string> = {
  'Front-Left': 'Old-Chap', 'Front-Right': "Old-O'ng",
  'Rear-Left': 'Orqa-Chap', 'Rear-Right': "Orqa-O'ng",
}

const SERVICE_TYPE_LABELS: Record<string, string> = {
  oil_change: 'Motor yog\'i',
  air_filter: 'Havo filtri',
  fuel_filter: 'Yoqilg\'i filtri',
  gearbox_oil: 'Tishli quti yog\'i',
  coolant: 'Sovutish suyuqligi',
  brake_fluid: 'Tormoz suyuqligi',
  timing_belt: 'Gaz taqsimot kamar',
  spark_plug: 'O\'t oldirish sham',
  brake_pads: 'Tormoz kolodkasi',
}

const SERVICE_TYPES = Object.keys(SERVICE_TYPE_LABELS)

const SERVICE_STATUS_CONFIG: Record<string, { icon: any; color: string; bg: string; label: string }> = {
  ok: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', label: 'Yaxshi' },
  due_soon: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800', label: 'Yaqinlashmoqda' },
  overdue: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800', label: 'Muddati o\'tgan' },
}

function OdometerModal({ vehicleId, currentMileage, onClose }: { vehicleId: string; currentMileage: number; onClose: () => void }) {
  const [value, setValue] = useState(String(currentMileage))
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: (mileage: number) => api.patch(`/service-intervals/vehicles/${vehicleId}/odometer`, { mileage }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-detail', vehicleId] })
      qc.invalidateQueries({ queryKey: ['vehicle-service-intervals', vehicleId] })
      toast.success('Kilometr yangilandi')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Kilometrni yangilash</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="mb-4">
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1.5">Joriy kilometr (km)</label>
          <input
            type="number" value={value} onChange={e => setValue(e.target.value)} min={currentMileage}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">Hozir: {currentMileage.toLocaleString()} km</p>
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Bekor</button>
          <button
            onClick={() => mutation.mutate(Number(value))}
            disabled={mutation.isPending || Number(value) < currentMileage}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
          >
            {mutation.isPending ? 'Saqlanmoqda...' : 'Saqlash'}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddIntervalModal({ vehicleId, existingTypes, onClose }: { vehicleId: string; existingTypes: string[]; onClose: () => void }) {
  const availableTypes = SERVICE_TYPES.filter(t => !existingTypes.includes(t))
  const [form, setForm] = useState({ serviceType: availableTypes[0] || '', intervalKm: 5000, intervalDays: 180, warningKm: 500, lastServiceKm: '', lastServiceDate: '' })
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api.post(`/service-intervals/vehicles/${vehicleId}/intervals`, {
      ...form,
      lastServiceKm: form.lastServiceKm ? Number(form.lastServiceKm) : undefined,
      lastServiceDate: form.lastServiceDate || undefined,
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-service-intervals', vehicleId] })
      toast.success('Xizmat intervali qo\'shildi')
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Xizmat intervali qo'shish</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Xizmat turi</label>
            <select value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              {availableTypes.map(t => <option key={t} value={t}>{SERVICE_TYPE_LABELS[t]}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Interval (km)</label>
              <input type="number" value={form.intervalKm} onChange={e => setForm(f => ({ ...f, intervalKm: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Interval (kun)</label>
              <input type="number" value={form.intervalDays} onChange={e => setForm(f => ({ ...f, intervalDays: Number(e.target.value) }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Ogohlantirish (km oldin)</label>
            <input type="number" value={form.warningKm} onChange={e => setForm(f => ({ ...f, warningKm: Number(e.target.value) }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Oxirgi xizmat (km)</label>
              <input type="number" value={form.lastServiceKm} onChange={e => setForm(f => ({ ...f, lastServiceKm: e.target.value }))} placeholder="ixtiyoriy"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Oxirgi xizmat (sana)</label>
              <input type="date" value={form.lastServiceDate} onChange={e => setForm(f => ({ ...f, lastServiceDate: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Bekor</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.serviceType}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {mutation.isPending ? 'Saqlanmoqda...' : 'Qo\'shish'}
          </button>
        </div>
      </div>
    </div>
  )
}

function CompleteServiceModal({ interval, onClose }: { interval: any; onClose: () => void }) {
  const [form, setForm] = useState({ servicedAtKm: '', servicedAt: new Date().toISOString().split('T')[0], cost: '', technicianName: '', notes: '' })
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: () => api.post(`/service-intervals/${interval.id}/complete`, {
      servicedAtKm: form.servicedAtKm ? Number(form.servicedAtKm) : undefined,
      servicedAt: form.servicedAt,
      cost: form.cost ? Number(form.cost) : 0,
      technicianName: form.technicianName || undefined,
      notes: form.notes || undefined,
    }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-service-intervals', interval.vehicleId] })
      toast.success(`${SERVICE_TYPE_LABELS[interval.serviceType]} bajarildi!`)
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{SERVICE_TYPE_LABELS[interval.serviceType]} — bajarildi</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Odometr (km)</label>
              <input type="number" value={form.servicedAtKm} onChange={e => setForm(f => ({ ...f, servicedAtKm: e.target.value }))} placeholder="avtomatik"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Sana</label>
              <input type="date" value={form.servicedAt} onChange={e => setForm(f => ({ ...f, servicedAt: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Xarajat (so'm)</label>
            <input type="number" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))} placeholder="0"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Texnik</label>
            <input type="text" value={form.technicianName} onChange={e => setForm(f => ({ ...f, technicianName: e.target.value }))} placeholder="ixtiyoriy"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">Izoh</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="ixtiyoriy"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">Bekor</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50">
            {mutation.isPending ? 'Saqlanmoqda...' : 'Bajarildi ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ServiceIntervalCard({ interval, currentMileage }: { interval: any; currentMileage: number }) {
  const [completeModal, setCompleteModal] = useState(false)
  const cfg = SERVICE_STATUS_CONFIG[interval.status] || SERVICE_STATUS_CONFIG.ok
  const Icon = cfg.icon

  const progress = interval.lastServiceKm && interval.nextDueKm
    ? Math.min(100, Math.max(0, ((currentMileage - interval.lastServiceKm) / (interval.nextDueKm - interval.lastServiceKm)) * 100))
    : interval.nextDueKm
    ? Math.min(100, Math.max(0, (currentMileage / interval.nextDueKm) * 100))
    : 0

  const remainingKm = interval.nextDueKm ? interval.nextDueKm - currentMileage : null
  const barColor = interval.status === 'overdue' ? 'bg-red-500' : interval.status === 'due_soon' ? 'bg-yellow-500' : 'bg-green-500'

  return (
    <>
      <div className={`border rounded-xl p-4 ${cfg.bg}`}>
        <div className="flex items-start justify-between gap-2 mb-3">
          <div className="flex items-center gap-2">
            <Icon className={`w-4 h-4 ${cfg.color}`} />
            <span className="font-semibold text-sm text-gray-900 dark:text-white">{SERVICE_TYPE_LABELS[interval.serviceType]}</span>
          </div>
          <button onClick={() => setCompleteModal(true)}
            className="text-xs px-2.5 py-1 bg-white dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-600 flex items-center gap-1">
            <CheckCircle2 className="w-3 h-3" /> Bajarildi
          </button>
        </div>

        {interval.nextDueKm && (
          <div className="mb-2">
            <div className="flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1">
              <span>{interval.lastServiceKm ? `${Number(interval.lastServiceKm).toLocaleString()} km` : 'Boshlang\'ich'}</span>
              <span>{Number(interval.nextDueKm).toLocaleString()} km</span>
            </div>
            <div className="h-2 bg-gray-200 dark:bg-gray-600 rounded-full overflow-hidden">
              <div className={`h-2 rounded-full transition-all ${barColor}`} style={{ width: `${progress}%` }} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-3 gap-2 text-xs mt-2">
          <div>
            <p className="text-gray-400">Har</p>
            <p className="font-medium text-gray-700 dark:text-gray-300">{Number(interval.intervalKm).toLocaleString()} km</p>
          </div>
          <div>
            <p className="text-gray-400">Qolgan</p>
            <p className={`font-bold ${interval.status === 'overdue' ? 'text-red-600' : interval.status === 'due_soon' ? 'text-yellow-600' : 'text-green-600'}`}>
              {remainingKm !== null ? (remainingKm > 0 ? `${remainingKm.toLocaleString()} km` : `${Math.abs(remainingKm).toLocaleString()} km o'tdi`) : '—'}
            </p>
          </div>
          <div>
            <p className="text-gray-400">Oxirgi xizmat</p>
            <p className="font-medium text-gray-700 dark:text-gray-300">
              {interval.lastServiceDate ? formatDate(interval.lastServiceDate) : '—'}
            </p>
          </div>
        </div>
      </div>

      {completeModal && <CompleteServiceModal interval={interval} onClose={() => setCompleteModal(false)} />}
    </>
  )
}

export default function VehicleDetail() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('maintenance')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [odometerModal, setOdometerModal] = useState(false)
  const [addIntervalModal, setAddIntervalModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['vehicle-detail', id, from, to],
    queryFn: () => api.get(`/reports/vehicle/${id}`, { params: { from: from || undefined, to: to || undefined } }).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: tiresData } = useQuery({
    queryKey: ['vehicle-tires', id],
    queryFn: () => api.get(`/tires/by-vehicle/${id}`).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: serviceData } = useQuery({
    queryKey: ['vehicle-service-intervals', id],
    queryFn: () => api.get(`/service-intervals/vehicles/${id}/intervals`).then(r => r.data),
    enabled: !!id,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!data) return (
    <div className="text-center py-20 text-gray-400">Avtomobil topilmadi</div>
  )

  const { vehicle, summary, maintenance, fuelRecords, expenses, byPart } = data
  const currentMileage = Number(vehicle.mileage)
  const intervals: any[] = serviceData?.intervals || []
  const overdueCount = intervals.filter((i: any) => i.status === 'overdue').length
  const dueSoonCount = intervals.filter((i: any) => i.status === 'due_soon').length

  const tabs = [
    { key: 'maintenance' as Tab, label: `Ta'mirlash (${maintenance?.length || 0})`, icon: <Wrench className="w-4 h-4" /> },
    { key: 'fuel' as Tab, label: `Yoqilg'i (${fuelRecords?.length || 0})`, icon: <Fuel className="w-4 h-4" /> },
    { key: 'expenses' as Tab, label: `Xarajatlar (${expenses?.length || 0})`, icon: <DollarSign className="w-4 h-4" /> },
    { key: 'tires' as Tab, label: `Shinalar (${tiresData?.history?.length || 0})`, icon: <Circle className="w-4 h-4" /> },
    {
      key: 'service' as Tab,
      label: `Texnik xizmat (${intervals.length})`,
      icon: <Gauge className="w-4 h-4" />,
      badge: overdueCount > 0 ? overdueCount : dueSoonCount > 0 ? dueSoonCount : null,
      badgeColor: overdueCount > 0 ? 'bg-red-500' : 'bg-yellow-500',
    },
  ]

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link to="/vehicles" className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Avtomashinalari
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm font-medium text-gray-900 dark:text-white">{vehicle.registrationNumber}</span>
      </div>

      {/* Vehicle Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
              <Truck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white font-mono">{vehicle.registrationNumber}</h1>
                <Badge variant={statusColors[vehicle.status]}>{VEHICLE_STATUS[vehicle.status]}</Badge>
                <Badge variant={fuelColors[vehicle.fuelType]}>{FUEL_TYPES[vehicle.fuelType]}</Badge>
                {overdueCount > 0 && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full font-medium"><AlertCircle className="w-3 h-3" />{overdueCount} xizmat muddati o'tgan</span>}
                {overdueCount === 0 && dueSoonCount > 0 && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full font-medium"><AlertTriangle className="w-3 h-3" />{dueSoonCount} xizmat yaqinlashmoqda</span>}
              </div>
              <p className="text-gray-600 dark:text-gray-300 mt-0.5">{vehicle.brand} {vehicle.model} · {vehicle.year}</p>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400 flex-wrap">
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{vehicle.branch?.name}</span>
                <button onClick={() => setOdometerModal(true)} className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors group">
                  <Gauge className="w-3.5 h-3.5" />{currentMileage.toLocaleString()} km
                  <span className="text-xs text-blue-500 opacity-0 group-hover:opacity-100 transition-opacity">(yangilash)</span>
                </button>
              </div>
            </div>
          </div>
          <ExcelExportButton
            endpoint={`/exports/vehicles/${id}`}
            filename={`${vehicle.registrationNumber}-hisobot.xlsx`}
            label="Excel"
            size="sm"
          />
        </div>
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wrench className="w-4 h-4 text-blue-500" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Ta'mirlash</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(summary?.totalMaintenance || 0)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{summary?.maintenanceCount || 0} ta yozuv</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Fuel className="w-4 h-4 text-yellow-500" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Yoqilg'i</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(summary?.totalFuel || 0)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{summary?.fuelCount || 0} ta to'ldirish</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-green-500" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Boshqa xarajat</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(summary?.totalExpenses || 0)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{expenses?.length || 0} ta yozuv</p>
        </div>
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-4">
          <p className="text-xs text-blue-200 mb-1">Jami xarajat</p>
          <p className="text-lg font-bold text-white">{formatCurrency(summary?.grandTotal || 0)}</p>
          <p className="text-xs text-blue-300 mt-0.5">Barcha vaqt</p>
        </div>
      </div>

      {/* Date filter */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-600 dark:text-gray-400">Davr:</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-gray-400">—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo('') }}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded">
              Tozalash
            </button>
          )}
        </div>
      </div>

      {/* Top used parts */}
      {byPart && byPart.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Ko'p ishlatiladigan ehtiyot qismlar</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {byPart.slice(0, 5).map((p: any) => (
              <div key={p.name} className="px-5 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{p.category} · {p.count} ta ishlatilgan</p>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(p.totalCost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${tab === t.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {t.icon} {t.label}
              {(t as any).badge && (
                <span className={`text-white text-xs rounded-full w-4 h-4 flex items-center justify-center ${(t as any).badgeColor}`}>{(t as any).badge}</span>
              )}
            </button>
          ))}
        </div>

        {/* Maintenance tab */}
        {tab === 'maintenance' && (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(maintenance || []).length === 0
              ? <p className="py-10 text-center text-gray-400 text-sm">Ta'mirlash yozuvlari yo'q</p>
              : (maintenance || []).map((m: any) => (
                <div key={m.id} className="px-5 py-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{m.sparePart?.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {m.sparePart?.category} · {m.quantityUsed} ta · {m.performedBy?.fullName}
                      {m.supplier && ` · ${m.supplier.name}`}
                    </p>
                    {m.notes && <p className="text-xs text-gray-400 italic mt-0.5">{m.notes}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(Number(m.cost))}</p>
                    <p className="text-xs text-gray-400">{formatDate(m.installationDate)}</p>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* Fuel tab */}
        {tab === 'fuel' && (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(fuelRecords || []).length === 0
              ? <p className="py-10 text-center text-gray-400 text-sm">Yoqilg'i yozuvlari yo'q</p>
              : (fuelRecords || []).map((f: any) => (
                <div key={f.id} className="px-5 py-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {Number(f.amountLiters).toFixed(1)} litr · {FUEL_TYPES[f.fuelType] || f.fuelType}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Odometr: {Number(f.odometerReading).toLocaleString()} km
                      {f.supplier && ` · ${f.supplier.name}`}
                      {f.createdBy && ` · ${f.createdBy.fullName}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(Number(f.cost))}</p>
                    <p className="text-xs text-gray-400">{formatDate(f.refuelDate)}</p>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* Expenses tab */}
        {tab === 'expenses' && (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(expenses || []).length === 0
              ? <p className="py-10 text-center text-gray-400 text-sm">Xarajat yozuvlari yo'q</p>
              : (expenses || []).map((e: any) => (
                <div key={e.id} className="px-5 py-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{e.description}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {e.category?.name}
                      {e.createdBy && ` · ${e.createdBy.fullName}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(Number(e.amount))}</p>
                    <p className="text-xs text-gray-400">{formatDate(e.expenseDate)}</p>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* Tires tab */}
        {tab === 'tires' && (
          <div className="p-5 space-y-6">
            {tiresData?.summary && (
              <div className="grid grid-cols-3 gap-3">
                <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 text-center">
                  <p className="text-xs text-blue-600 dark:text-blue-400">Jami shinalar</p>
                  <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{tiresData.summary.totalTires}</p>
                </div>
                <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4 text-center">
                  <p className="text-xs text-green-600 dark:text-green-400">Umumiy yurgan km</p>
                  <p className="text-2xl font-bold text-green-900 dark:text-green-100">{tiresData.summary.totalKm.toLocaleString()}</p>
                </div>
                <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4 text-center">
                  <p className="text-xs text-red-600 dark:text-red-400">Ushlab qolish</p>
                  <p className="text-xl font-bold text-red-900 dark:text-red-100">{formatCurrency(tiresData.summary.totalDeductionAmount)}</p>
                </div>
              </div>
            )}
            {tiresData?.current?.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full inline-block" />
                  Hozir o'rnatilgan ({tiresData.current.length} ta)
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {tiresData.current.map((t: any) => (
                    <div key={t.id} className="bg-green-50 dark:bg-green-900/10 border border-green-200 dark:border-green-800 rounded-xl p-4">
                      <div className="flex items-start justify-between">
                        <div>
                          <p className="font-mono font-bold text-blue-700 dark:text-blue-400">{t.serialCode}</p>
                          <p className="text-sm font-medium text-gray-900 dark:text-white mt-0.5">{t.brand} {t.model} {t.size}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{t.type}</p>
                        </div>
                        <Badge variant="success">{t.position ? (POSITION_LABELS[t.position] || t.position) : "O'rnatilgan"}</Badge>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                        <div><p className="text-gray-400">O'rnatilgan</p><p className="font-medium">{t.installationDate ? formatDate(t.installationDate) : '—'}</p></div>
                        <div><p className="text-gray-400">Odometr</p><p className="font-medium">{t.installedMileageKm ? `${t.installedMileageKm.toLocaleString()} km` : '—'}</p></div>
                        <div><p className="text-gray-400">Norma</p><p className="font-medium">{(t.standardMileageKm || 40000).toLocaleString()} km</p></div>
                        <div><p className="text-gray-400">Haydovchi</p><p className="font-medium">{t.driver?.fullName || '—'}</p></div>
                      </div>
                      {t.currentTreadDepth && (
                        <div className="mt-2 flex items-center gap-2">
                          <div className="flex-1 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full">
                            <div className={`h-1.5 rounded-full ${Number(t.currentTreadDepth) < 1.6 ? 'bg-red-500' : Number(t.currentTreadDepth) < 3 ? 'bg-yellow-500' : 'bg-green-500'}`}
                              style={{ width: `${Math.min(100, (Number(t.currentTreadDepth) / 8.5) * 100)}%` }} />
                          </div>
                          <span className="text-xs font-medium text-gray-600 dark:text-gray-400">{Number(t.currentTreadDepth).toFixed(1)} mm</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3 flex items-center gap-2">
                <span className="w-2 h-2 bg-gray-400 rounded-full inline-block" />
                To'liq tarix ({tiresData?.history?.length || 0} ta)
              </h3>
              {(!tiresData?.history || tiresData.history.length === 0) ? (
                <p className="text-center py-8 text-gray-400 text-sm">Hali shinalar biriktirilmagan</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                        <th className="pb-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Serial kod</th>
                        <th className="pb-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Brand / O'lcham</th>
                        <th className="pb-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Haydovchi</th>
                        <th className="pb-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">O'rnatilgan</th>
                        <th className="pb-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Olib olingan</th>
                        <th className="pb-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Yurgan km</th>
                        <th className="pb-2 pr-4 text-xs font-semibold text-gray-500 dark:text-gray-400">Ushlab qolish</th>
                        <th className="pb-2 text-xs font-semibold text-gray-500 dark:text-gray-400">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                      {tiresData.history.map((t: any) => {
                        const deduction = t.tireDeductions?.[0]
                        const installEvent = t.tireEvents?.find((e: any) => e.eventType === 'installed')
                        const removeEvent = t.tireEvents?.find((e: any) => e.eventType === 'removed' || e.eventType === 'written_off')
                        return (
                          <tr key={t.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                            <td className="py-3 pr-4">
                              <p className="font-mono font-bold text-blue-700 dark:text-blue-400 text-xs">{t.serialCode}</p>
                              <p className="font-mono text-xs text-gray-400">{t.uniqueId}</p>
                            </td>
                            <td className="py-3 pr-4">
                              <p className="font-medium text-gray-900 dark:text-white">{t.brand} {t.model}</p>
                              <p className="text-xs text-gray-500">{t.size}</p>
                            </td>
                            <td className="py-3 pr-4 text-xs text-gray-600 dark:text-gray-400">{t.driver?.fullName || '—'}</td>
                            <td className="py-3 pr-4 text-xs text-gray-600 dark:text-gray-400">
                              {t.installationDate ? formatDate(t.installationDate) : '—'}
                              {installEvent?.mileageAtEvent && <p className="text-gray-400">{installEvent.mileageAtEvent.toLocaleString()} km</p>}
                            </td>
                            <td className="py-3 pr-4 text-xs text-gray-600 dark:text-gray-400">
                              {t.removedDate ? formatDate(t.removedDate) : (t.status === 'installed' ? <span className="text-green-600 font-medium">Hozir o'rnatilgan</span> : '—')}
                              {removeEvent?.mileageAtEvent && <p className="text-gray-400">{removeEvent.mileageAtEvent.toLocaleString()} km</p>}
                            </td>
                            <td className="py-3 pr-4">
                              {t.actualMileageUsed
                                ? <span className="font-medium text-gray-900 dark:text-white">{Number(t.actualMileageUsed).toLocaleString()} km</span>
                                : <span className="text-gray-400">—</span>}
                              <p className="text-xs text-gray-400">/ {(t.standardMileageKm || 40000).toLocaleString()} km</p>
                            </td>
                            <td className="py-3 pr-4">
                              {deduction
                                ? <div>
                                    <p className={`font-bold text-sm ${deduction.isSettled ? 'text-green-600' : 'text-red-600'}`}>{formatCurrency(Number(deduction.deductionAmount))}</p>
                                    <Badge variant={deduction.isSettled ? 'success' : 'danger'}>{deduction.isSettled ? "To'langan" : 'Kutmoqda'}</Badge>
                                  </div>
                                : <span className="text-gray-400 text-xs">—</span>}
                            </td>
                            <td className="py-3">
                              <Badge variant={TIRE_STATUS_COLORS[t.status] || 'secondary'}>{TIRE_STATUS_LABELS[t.status] || t.status}</Badge>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Service Intervals tab */}
        {tab === 'service' && (
          <div className="p-5">
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-gray-500 dark:text-gray-400">
                Joriy kilometr: <span className="font-bold text-gray-900 dark:text-white">{currentMileage.toLocaleString()} km</span>
              </p>
              {intervals.length < SERVICE_TYPES.length && (
                <button onClick={() => setAddIntervalModal(true)}
                  className="flex items-center gap-1.5 text-sm px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                  <Plus className="w-4 h-4" /> Interval qo'shish
                </button>
              )}
            </div>

            {intervals.length === 0 ? (
              <div className="text-center py-16">
                <Gauge className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-500 dark:text-gray-400 mb-1">Texnik xizmat intervallari sozlanmagan</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">Motor yog'i, filtrlar va boshqa xizmatlarni kuzating</p>
                <button onClick={() => setAddIntervalModal(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm">
                  <Plus className="w-4 h-4" /> Birinchi intervalni qo'shish
                </button>
              </div>
            ) : (
              <>
                {/* Status summary */}
                {(overdueCount > 0 || dueSoonCount > 0) && (
                  <div className="flex gap-2 mb-4 flex-wrap">
                    {overdueCount > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-sm text-red-700 dark:text-red-400">
                        <AlertCircle className="w-4 h-4" /> {overdueCount} ta xizmat muddati o'tgan
                      </div>
                    )}
                    {dueSoonCount > 0 && (
                      <div className="flex items-center gap-2 px-3 py-2 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg text-sm text-yellow-700 dark:text-yellow-400">
                        <AlertTriangle className="w-4 h-4" /> {dueSoonCount} ta xizmat yaqinlashmoqda
                      </div>
                    )}
                  </div>
                )}

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {intervals
                    .sort((a: any, b: any) => {
                      const order = { overdue: 0, due_soon: 1, ok: 2 }
                      return (order[a.status as keyof typeof order] ?? 2) - (order[b.status as keyof typeof order] ?? 2)
                    })
                    .map((interval: any) => (
                      <ServiceIntervalCard key={interval.id} interval={interval} currentMileage={currentMileage} />
                    ))
                  }
                </div>

                {intervals.length < SERVICE_TYPES.length && (
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700">
                    <p className="text-xs text-gray-400 mb-2">Hali qo'shilmagan xizmatlar:</p>
                    <div className="flex flex-wrap gap-2">
                      {SERVICE_TYPES.filter(t => !intervals.find((i: any) => i.serviceType === t)).map(t => (
                        <span key={t} className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg">{SERVICE_TYPE_LABELS[t]}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>

      {odometerModal && id && (
        <OdometerModal vehicleId={id} currentMileage={currentMileage} onClose={() => setOdometerModal(false)} />
      )}
      {addIntervalModal && id && (
        <AddIntervalModal
          vehicleId={id}
          existingTypes={intervals.map((i: any) => i.serviceType)}
          onClose={() => setAddIntervalModal(false)}
        />
      )}
    </div>
  )
}
