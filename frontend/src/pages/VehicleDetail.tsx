import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useParams, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { ArrowLeft, Truck, Fuel, Wrench, DollarSign, Calendar, MapPin, Gauge, Circle, Plus, CheckCircle2, AlertTriangle, AlertCircle, X, ClipboardList, ShieldCheck, Edit2, Trash2, Satellite, Timer } from 'lucide-react'
import api from '../lib/api'
import { formatCurrency, formatDate, FUEL_TYPES, VEHICLE_STATUS } from '../lib/utils'
import Badge from '../components/ui/Badge'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import toast from 'react-hot-toast'
import { useAuthStore } from '../stores/authStore'
import { PeriodFilter } from '../components/vehicle/vehicleUi'
import OverviewTab, { buildAlerts } from '../components/vehicle/OverviewTab'
import MaintenanceTab from '../components/vehicle/MaintenanceTab'
import FuelTab from '../components/vehicle/FuelTab'
import TiresTab from '../components/vehicle/TiresTab'

const statusColors: Record<string, any> = { active: 'success', maintenance: 'warning', inactive: 'danger' }
const fuelColors: Record<string, any> = { petrol: 'info', diesel: 'warning', gas: 'success', electric: 'default' }

type Tab = 'overview' | 'maintenance' | 'fuel' | 'tires' | 'service'
type Sub = 'intervals' | 'engine' | 'waybills' | 'gps'

const TIRE_STATUS_COLORS: Record<string, any> = {
  in_stock: 'info', installed: 'success', returned: 'warning', written_off: 'secondary', damaged: 'danger',
}

const SERVICE_TYPES = [
  'oil_change', 'air_filter', 'fuel_filter', 'gearbox_oil',
  'coolant', 'brake_fluid', 'timing_belt', 'spark_plug', 'brake_pads',
]

const SERVICE_STATUS_COLORS: Record<string, { icon: any; color: string; bg: string }> = {
  ok: { icon: CheckCircle2, color: 'text-green-600', bg: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800' },
  due_soon: { icon: AlertTriangle, color: 'text-yellow-600', bg: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800' },
  overdue: { icon: AlertCircle, color: 'text-red-600', bg: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800' },
}

function OdometerModal({ vehicleId, currentMileage, hasGps, onClose }: { vehicleId: string; currentMileage: number; hasGps?: boolean; onClose: () => void }) {
  const { t } = useTranslation()
  const [value, setValue] = useState(String(currentMileage))
  const qc = useQueryClient()

  const mutation = useMutation({
    mutationFn: (mileage: number) => api.patch(`/service-intervals/vehicles/${vehicleId}/odometer`, { mileage }).then(r => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['vehicle-detail', vehicleId] })
      qc.invalidateQueries({ queryKey: ['vehicle-service-intervals', vehicleId] })
      toast.success(t('vehicleDetail.kmUpdated'))
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('vehicleDetail.error')),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-sm p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('vehicleDetail.odometerUpdate')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="mb-4">
          <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1.5">{t('vehicleDetail.currentKm')}</label>
          <input
            type="number" value={value} onChange={e => setValue(e.target.value)} min={currentMileage}
            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <p className="text-xs text-gray-400 mt-1">Hozir: {currentMileage.toLocaleString()} km</p>
          {hasGps && (
            <p className="text-xs text-green-600 mt-1 flex items-center gap-1">
              <Satellite className="w-3 h-3" />
              {t('vehicleDetail.gpsAutoKm', 'Bu mashina GPS ga ulangan — km har 6 soatda avtomatik yangilanadi')}
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">{t('vehicleDetail.cancel')}</button>
          <button
            onClick={() => mutation.mutate(Number(value))}
            disabled={mutation.isPending || Number(value) < currentMileage}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50"
          >
            {mutation.isPending ? t('common.loading') : t('common.save')}
          </button>
        </div>
      </div>
    </div>
  )
}

function AddIntervalModal({ vehicleId, existingTypes, onClose }: { vehicleId: string; existingTypes: string[]; onClose: () => void }) {
  const { t } = useTranslation()
  const availableTypes = SERVICE_TYPES.filter(st => !existingTypes.includes(st))
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
      toast.success(t('vehicleDetail.intervalAdded'))
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('vehicleDetail.error')),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t('vehicleDetail.addServiceInterval')}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{t('vehicleDetail.serviceTypeLabel')}</label>
            <select value={form.serviceType} onChange={e => setForm(f => ({ ...f, serviceType: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              {availableTypes.map(st => <option key={st} value={st}>{t(`vehicleDetail.serviceType.${st}`)}</option>)}
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
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">{t('vehicleDetail.cancel')}</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !form.serviceType}
            className="flex-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 text-white rounded-lg disabled:opacity-50">
            {mutation.isPending ? t('common.loading') : t('common.add')}
          </button>
        </div>
      </div>
    </div>
  )
}

function CompleteServiceModal({ interval, onClose }: { interval: any; onClose: () => void }) {
  const { t } = useTranslation()
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
      toast.success(`${t(`vehicleDetail.serviceType.${interval.serviceType}`)} bajarildi!`)
      onClose()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('vehicleDetail.error')),
  })

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{t(`vehicleDetail.serviceType.${interval.serviceType}`)} — bajarildi</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{t('vehicleDetail.odometer')} (km)</label>
              <input type="number" value={form.servicedAtKm} onChange={e => setForm(f => ({ ...f, servicedAtKm: e.target.value }))} placeholder="avtomatik"
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div>
              <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{t('vehicleDetail.date')}</label>
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
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{t('vehicleDetail.technician')}</label>
            <input type="text" value={form.technicianName} onChange={e => setForm(f => ({ ...f, technicianName: e.target.value }))} placeholder="ixtiyoriy"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div>
            <label className="block text-sm text-gray-600 dark:text-gray-400 mb-1">{t('vehicleDetail.comment')}</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} placeholder="ixtiyoriy"
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <div className="flex gap-2 mt-5">
          <button onClick={onClose} className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">{t('vehicleDetail.cancel')}</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 px-4 py-2 text-sm bg-green-600 hover:bg-green-700 text-white rounded-lg disabled:opacity-50">
            {mutation.isPending ? t('common.loading') : 'Bajarildi ✓'}
          </button>
        </div>
      </div>
    </div>
  )
}

function ServiceIntervalCard({ interval, currentMileage }: { interval: any; currentMileage: number }) {
  const { t } = useTranslation()
  const [completeModal, setCompleteModal] = useState(false)
  const cfg = SERVICE_STATUS_COLORS[interval.status] || SERVICE_STATUS_COLORS.ok
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
            <span className="font-semibold text-sm text-gray-900 dark:text-white">{t(`vehicleDetail.serviceType.${interval.serviceType}`)}</span>
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
            <p className="text-gray-400">{t('vehicleDetail.every')}</p>
            <p className="font-medium text-gray-700 dark:text-gray-300">{Number(interval.intervalKm).toLocaleString()} km</p>
          </div>
          <div>
            <p className="text-gray-400">{t('vehicleDetail.remaining')}</p>
            <p className={`font-bold ${interval.status === 'overdue' ? 'text-red-600' : interval.status === 'due_soon' ? 'text-yellow-600' : 'text-green-600'}`}>
              {remainingKm !== null ? (remainingKm > 0 ? `${remainingKm.toLocaleString()} km` : `${Math.abs(remainingKm).toLocaleString()} km o'tdi`) : '—'}
            </p>
          </div>
          <div>
            <p className="text-gray-400">{t('vehicleDetail.lastService')}</p>
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

function DocExpiryBadge({ label, expiry }: { label: string; expiry: string }) {
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000)
  const dateStr = new Date(expiry).toLocaleDateString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric' })
  if (days < 0) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full font-medium">
      <AlertCircle className="w-3 h-3" />{label}: muddati o'tdi ({dateStr})
    </span>
  )
  if (days <= 7) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-400 rounded-full font-medium">
      <AlertCircle className="w-3 h-3" />{label}: {days} kun ({dateStr})
    </span>
  )
  if (days <= 30) return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-orange-100 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400 rounded-full font-medium">
      <AlertTriangle className="w-3 h-3" />{label}: {days} kun ({dateStr})
    </span>
  )
  return (
    <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
      <ShieldCheck className="w-3 h-3" />{label}: {dateStr}
    </span>
  )
}


// ─── Eski tablar tarkibi — "Hujjat va xizmat" tabining ichki bo'limlari sifatida ───
function WaybillsSection({ vehicleWaybills }: { vehicleWaybills: any[] }) {
  const { t } = useTranslation()
  return (
          <div className="p-5">
            {vehicleWaybills.length === 0 ? (
              <div className="text-center py-12">
                <ClipboardList className="w-10 h-10 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">{t('vehicleDetail.noWaybills')}</p>
                <Link to="/waybills" className="mt-2 inline-block text-sm text-blue-600 hover:text-blue-700">{t('vehicleDetail.createWaybill')}</Link>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-gray-200 dark:border-gray-700 text-left">
                      <th className="pb-2 pr-4 text-xs font-semibold text-gray-500">{t('vehicleDetail.number')}</th>
                      <th className="pb-2 pr-4 text-xs font-semibold text-gray-500">{t('vehicleDetail.driver')}</th>
                      <th className="pb-2 pr-4 text-xs font-semibold text-gray-500">{t('vehicleDetail.route')}</th>
                      <th className="pb-2 pr-4 text-xs font-semibold text-gray-500">{t('vehicleDetail.date')}</th>
                      <th className="pb-2 pr-4 text-xs font-semibold text-gray-500">{t('vehicleDetail.distance')}</th>
                      <th className="pb-2 pr-4 text-xs font-semibold text-gray-500">{t('vehicleDetail.fuel')}</th>
                      <th className="pb-2 text-xs font-semibold text-gray-500">{t('vehicleDetail.status')}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                    {vehicleWaybills.map((w: any) => (
                      <tr key={w.id} className="hover:bg-gray-50 dark:hover:bg-gray-700/30">
                        <td className="py-2.5 pr-4 font-mono text-xs font-bold text-blue-700 dark:text-blue-400">{w.number}</td>
                        <td className="py-2.5 pr-4 text-gray-700 dark:text-gray-300">{w.driver?.fullName}</td>
                        <td className="py-2.5 pr-4">
                          <p className="text-gray-900 dark:text-white">{w.purpose}</p>
                          <p className="text-xs text-gray-400">{w.destination}</p>
                        </td>
                        <td className="py-2.5 pr-4 text-xs text-gray-500">{formatDate(w.plannedDeparture)}</td>
                        <td className="py-2.5 pr-4 text-xs text-gray-600">{w.distanceTraveled ? `${w.distanceTraveled.toLocaleString()} km` : '—'}</td>
                        <td className="py-2.5 pr-4 text-xs text-gray-600">{w.fuelConsumed ? `${Number(w.fuelConsumed).toFixed(1)} L` : '—'}</td>
                        <td className="py-2.5">
                          <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            w.status === 'completed' ? 'bg-green-100 text-green-700' :
                            w.status === 'active'    ? 'bg-yellow-100 text-yellow-700' :
                            w.status === 'cancelled' ? 'bg-red-100 text-red-700' :
                            'bg-gray-100 text-gray-600'
                          }`}>
                            {w.status === 'completed' ? 'Yakunlandi' : w.status === 'active' ? "Yo'lda" : w.status === 'cancelled' ? 'Bekor' : 'Qoralama'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
  )
}

function ServiceSection({ intervals, currentMileage, overdueCount, dueSoonCount, setAddIntervalModal }: {
  intervals: any[]; currentMileage: number; overdueCount: number; dueSoonCount: number; setAddIntervalModal: (v: boolean) => void
}) {
  const { t } = useTranslation()
  return (
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
                <p className="text-gray-500 dark:text-gray-400 mb-1">{t('vehicleDetail.intervalsNotConfigured')}</p>
                <p className="text-sm text-gray-400 dark:text-gray-500 mb-4">{t('vehicleDetail.intervalsHint')}</p>
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
                      {SERVICE_TYPES.filter(st => !intervals.find((i: any) => i.serviceType === st)).map(st => (
                        <span key={st} className="text-xs px-2 py-1 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 rounded-lg">{t(`vehicleDetail.serviceType.${st}`, st)}</span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
  )
}

function GpsSection({ gpsHistoryData }: { gpsHistoryData: any[] | undefined }) {
  const { t } = useTranslation()
  return (
    <div className="p-5">
          <div className="space-y-2">
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">
              GPS orqali so'nggi 30 ta km yangilanishi
            </p>
            {!gpsHistoryData || gpsHistoryData.length === 0 ? (
              <div className="text-center py-10 text-gray-400 text-sm">
                <Satellite className="w-8 h-8 mx-auto mb-2 opacity-30" />
                Hali GPS orqali km yangilanmagan. Sync tugagach bu yerda ko'rinadi.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-gray-400 border-b border-gray-100 dark:border-gray-700">
                      <th className="pb-2 pr-4">{t('vehicleDetail.date')}</th>
                      <th className="pb-2 pr-4">GPS km</th>
                      <th className="pb-2 pr-4">{t('vehicleDetail.previousKm')}</th>
                      <th className="pb-2 pr-4">{t('vehicleDetail.change')}</th>
                      <th className="pb-2">{t('vehicleDetail.state')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {gpsHistoryData.map((log: any) => {
                      const diff = Number(log.gpsMileageKm) - Number(log.prevMileageKm)
                      return (
                        <tr key={log.id} className="border-b border-gray-50 dark:border-gray-800">
                          <td className="py-2 pr-4 text-gray-600 dark:text-gray-300 whitespace-nowrap">
                            {new Date(log.syncedAt).toLocaleString('uz-UZ', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                          </td>
                          <td className="py-2 pr-4 font-medium text-gray-900 dark:text-white">
                            {Number(log.gpsMileageKm).toLocaleString()} km
                          </td>
                          <td className="py-2 pr-4 text-gray-500">
                            {Number(log.prevMileageKm).toLocaleString()} km
                          </td>
                          <td className="py-2 pr-4">
                            {log.skipped ? '—' : (
                              <span className="text-green-600 font-medium">+{diff.toLocaleString()} km</span>
                            )}
                          </td>
                          <td className="py-2">
                            {log.skipped ? (
                              <span className="text-xs px-2 py-0.5 bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400 rounded-full">
                                {log.skipReason || "O'tkazib yuborildi"}
                              </span>
                            ) : (
                              <span className="text-xs px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400 rounded-full">
                                Yangilandi
                              </span>
                            )}
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
  )
}

export default function VehicleDetail() {
  const { t } = useTranslation()
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const canAddMaintenance = hasRole('admin', 'super_admin', 'manager', 'branch_manager')
  const [tab, setTab] = useState<Tab>('overview')
  const [sub, setSub] = useState<Sub>('intervals')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [odometerModal, setOdometerModal] = useState(false)
  const [addIntervalModal, setAddIntervalModal] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['vehicle-detail', id, from, to],
    queryFn: () => api.get(`/reports/vehicle/${id}`, { params: { from: from || undefined, to: to || undefined } }).then(r => r.data.data),
    enabled: !!id,
    placeholderData: (prev: any) => prev,
  })

  const { data: overviewData } = useQuery({
    queryKey: ['vehicle-overview', id],
    queryFn: () => api.get(`/reports/vehicle/${id}/overview`).then(r => r.data.data),
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

  const { data: waybillsData } = useQuery({
    queryKey: ['vehicle-waybills', id],
    queryFn: () => api.get('/waybills', { params: { vehicleId: id, limit: 50 } }).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: engineData, refetch: refetchEngine } = useQuery({
    queryKey: ['vehicle-engine-records', id],
    queryFn: () => api.get('/engine-records', { params: { vehicleId: id, limit: 50 } }).then(r => r.data),
    enabled: !!id && tab === 'service' && sub === 'engine',
  })

  const { data: gpsHistoryData } = useQuery({
    queryKey: ['vehicle-gps-history', id],
    queryFn: () => api.get(`/vehicles/${id}/gps-history`).then(r => r.data.data as any[]),
    enabled: !!id && tab === 'service' && sub === 'gps',
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!data) return (
    <div className="text-center py-20 text-gray-400">{t('vehicleDetail.vehicleNotFound')}</div>
  )

  const { vehicle, summary, maintenance, fuelRecords, byPart } = data
  const currentMileage = Number(vehicle.mileage)
  const intervals: any[] = serviceData?.intervals || []
  const vehicleWaybills: any[] = waybillsData || []
  const tiresCurrent: any[] = tiresData?.current || []
  const overdueCount = intervals.filter((i: any) => i.status === 'overdue').length
  const dueSoonCount = intervals.filter((i: any) => i.status === 'due_soon').length
  const serviceLabel = (st: string) => String(t(`vehicleDetail.serviceType.${st}`, st))

  const alerts = buildAlerts({ vehicle, intervals, currentMileage, tiresCurrent, label: serviceLabel })
  const critAlerts = alerts.filter(a => a.level === 'critical').length
  const serviceBadge = alerts.filter(a => a.tab === 'service').length
  const tireBadge = tiresCurrent.filter((x: any) => x.usageLevel !== 'ok').length

  const goTab = (k: Tab) => { setTab(k); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const addMaintenance = () => navigate(`/maintenance?add=${id}`)

  const tabs: { key: Tab; label: string; icon: any; count?: number; badge?: number; badgeCls?: string }[] = [
    { key: 'overview', label: 'Umumiy', icon: <Truck className="w-4 h-4" /> },
    { key: 'maintenance', label: "Ta'mirlash", icon: <Wrench className="w-4 h-4" />, count: maintenance?.length || 0 },
    { key: 'fuel', label: "Yoqilg'i", icon: <Fuel className="w-4 h-4" />, count: fuelRecords?.length || 0 },
    { key: 'tires', label: 'Shinalar', icon: <Circle className="w-4 h-4" />, count: tiresCurrent.length, badge: tireBadge || undefined, badgeCls: 'bg-amber-500' },
    { key: 'service', label: 'Hujjat va xizmat', icon: <Gauge className="w-4 h-4" />, badge: serviceBadge || undefined, badgeCls: overdueCount > 0 ? 'bg-red-500' : 'bg-amber-500' },
  ]

  const subs: { key: Sub; label: string }[] = [
    { key: 'intervals', label: `Xizmat intervallari (${intervals.length})` },
    { key: 'engine', label: 'Dvigatel passporti' },
    { key: 'waybills', label: `Yo'l varaqlari (${vehicleWaybills.length})` },
    ...(vehicle.lastGpsSignal ? [{ key: 'gps' as Sub, label: 'GPS tarixi' }] : []),
  ]

  const showPeriod = tab === 'overview' || tab === 'maintenance' || tab === 'fuel'

  return (
    <div className="space-y-4">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link to="/vehicles" className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          {t('nav.vehicles', 'Avtomashinalari')}
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm font-medium text-gray-900 dark:text-white">{vehicle.registrationNumber}</span>
      </div>

      {/* Sarlavha — ixcham */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-4 sm:p-5">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
          <div className="flex items-center gap-4 min-w-0">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
              <Truck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white font-mono">{vehicle.registrationNumber}</h1>
                <Badge variant={statusColors[vehicle.status]}>{VEHICLE_STATUS[vehicle.status]}</Badge>
                <Badge variant={fuelColors[vehicle.fuelType]}>{FUEL_TYPES[vehicle.fuelType]}</Badge>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 mt-0.5">{vehicle.brand} {vehicle.model} · {vehicle.year}</p>
              <div className="flex items-center gap-4 mt-1.5 text-sm text-gray-500 dark:text-gray-400 flex-wrap">
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{vehicle.branch?.name}</span>
                <button onClick={() => setOdometerModal(true)} title="Kilometrni yangilash" className="flex items-center gap-1 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
                  <Gauge className="w-3.5 h-3.5" />{currentMileage.toLocaleString('uz-UZ')} km
                  {vehicle.lastGpsSignal && (
                    <span title={`GPS signal: ${new Date(vehicle.lastGpsSignal).toLocaleString('uz-UZ')}`}
                      className={`flex items-center gap-0.5 text-xs font-medium ${(Date.now() - new Date(vehicle.lastGpsSignal).getTime()) < 86400000 ? 'text-green-500' : 'text-gray-400'}`}>
                      <Satellite className="w-3 h-3" />GPS
                    </span>
                  )}
                </button>
                {vehicle.engineHours != null && Number(vehicle.engineHours) > 0 && (
                  <span className="flex items-center gap-1" title="Dvigatel soatlari (GPS)">
                    <Timer className="w-3.5 h-3.5" />{Number(vehicle.engineHours).toLocaleString('uz-UZ')} s.soat
                  </span>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {canAddMaintenance && (
              <button onClick={addMaintenance} className="flex items-center gap-1.5 text-sm px-3 h-9 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
                <Plus className="w-4 h-4" /> Ta'mirlash qo'shish
              </button>
            )}
            <button onClick={() => setOdometerModal(true)} className="flex items-center gap-1.5 text-sm px-3 h-9 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">
              <Gauge className="w-4 h-4" /> Km yangilash
            </button>
            <ExcelExportButton
              endpoint={`/exports/vehicle-report/${id}`}
              filename={`${vehicle.registrationNumber}-hisobot.xlsx`}
              label="Excel"
              size="sm"
            />
          </div>
        </div>

        {/* Diqqat talab qiladigan narsalar — bir qarashda */}
        {alerts.length > 0 && (
          <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700 flex flex-wrap gap-2">
            {alerts.slice(0, 4).map((a, i) => (
              <button key={i} onClick={() => goTab(a.tab)}
                className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium ${a.level === 'critical'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' : 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'}`}>
                {a.level === 'critical' ? <AlertCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                {a.text}
              </button>
            ))}
            {alerts.length > 4 && (
              <button onClick={() => goTab('overview')} className="text-xs px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                +{alerts.length - 4} ta yana{critAlerts > 0 ? '' : ''}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Tablar */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {tabs.map(tb => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={`flex items-center gap-2 px-4 sm:px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${tab === tb.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {tb.icon} {tb.label}
              {tb.count != null && <span className="text-xs text-gray-400 font-normal">{tb.count}</span>}
              {tb.badge ? <span className={`text-white text-[10px] rounded-full min-w-[16px] h-4 px-1 flex items-center justify-center ${tb.badgeCls}`}>{tb.badge}</span> : null}
            </button>
          ))}
        </div>

        {showPeriod && (
          <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 bg-gray-50/60 dark:bg-gray-900/30">
            <PeriodFilter from={from} to={to} onChange={(f, tt) => { setFrom(f); setTo(tt) }} />
          </div>
        )}

        {tab === 'overview' && (
          <OverviewTab
            summary={summary}
            byPart={byPart || []}
            intervals={intervals}
            currentMileage={currentMileage}
            tiresCurrent={tiresCurrent}
            alerts={alerts}
            overview={overviewData}
            label={serviceLabel}
            goTab={goTab}
          />
        )}

        {tab === 'maintenance' && <MaintenanceTab maintenance={maintenance || []} onAdd={addMaintenance} />}

        {tab === 'fuel' && <FuelTab fuelRecords={fuelRecords || []} />}

        {tab === 'tires' && <TiresTab tiresData={tiresData} />}

        {tab === 'service' && (
          <div>
            {/* Hujjatlar muddati */}
            {(vehicle.insuranceExpiry || vehicle.techInspectionExpiry) && (
              <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex flex-wrap gap-2">
                {vehicle.insuranceExpiry && <DocExpiryBadge label={t('vehicleDetail.insurance')} expiry={vehicle.insuranceExpiry} />}
                {vehicle.techInspectionExpiry && <DocExpiryBadge label={t('vehicleDetail.techInspection')} expiry={vehicle.techInspectionExpiry} />}
              </div>
            )}
            <div className="px-5 pt-4 flex gap-2 flex-wrap">
              {subs.map(s => (
                <button key={s.key} onClick={() => setSub(s.key)}
                  className={`px-3 h-8 text-sm rounded-lg border transition-colors ${sub === s.key
                    ? 'bg-blue-600 border-blue-600 text-white'
                    : 'bg-white dark:bg-gray-800 border-gray-200 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}>
                  {s.label}
                </button>
              ))}
            </div>
            {sub === 'intervals' && (
              <ServiceSection intervals={intervals} currentMileage={currentMileage} overdueCount={overdueCount} dueSoonCount={dueSoonCount} setAddIntervalModal={setAddIntervalModal} />
            )}
            {sub === 'engine' && id && <EnginePassportTab vehicleId={id} engineData={engineData} refetch={refetchEngine} />}
            {sub === 'waybills' && <WaybillsSection vehicleWaybills={vehicleWaybills} />}
            {sub === 'gps' && <GpsSection gpsHistoryData={gpsHistoryData} />}
          </div>
        )}
      </div>

      {odometerModal && id && (
        <OdometerModal vehicleId={id} currentMileage={currentMileage} hasGps={!!vehicle.lastGpsSignal} onClose={() => setOdometerModal(false)} />
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

// ─── Dvigatel Passport Tab ────────────────────────────────────────────────────
const ENGINE_TYPE_LABELS: Record<string, string> = {
  overhaul: 'Kapital remont',
  major_repair: "Yirik ta'mirlash",
  minor_repair: "Kichik ta'mirlash",
  inspection: "Texnik ko'rik",
}
const ENGINE_TYPE_COLORS: Record<string, string> = {
  overhaul: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400',
  major_repair: 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400',
  minor_repair: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
  inspection: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400',
}

function EnginePassportTab({ vehicleId, engineData, refetch }: { vehicleId: string; engineData: any; refetch: () => void }) {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const [modal, setModal] = useState(false)
  const [editing, setEditing] = useState<any>(null)
  const [form, setForm] = useState({ recordType: 'inspection', mileage: '', date: new Date().toISOString().split('T')[0], description: '', cost: '', nextServiceMileage: '', performedBy: '', notes: '' })

  const records: any[] = engineData?.data || []

  const saveMut = useMutation({
    mutationFn: (body: any) => editing
      ? api.put(`/engine-records/${editing.id}`, body)
      : api.post('/engine-records', { ...body, vehicleId }),
    onSuccess: () => { toast.success(editing ? t('success.updated') : t('success.saved')); qc.invalidateQueries({ queryKey: ['vehicle-engine-records', vehicleId] }); refetch(); setModal(false); setEditing(null) },
    onError: (e: any) => toast.error(e.response?.data?.error || t('vehicleDetail.error')),
  })
  const delMut = useMutation({
    mutationFn: (id: string) => api.delete(`/engine-records/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['vehicle-engine-records', vehicleId] }); refetch() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openAdd = () => { setEditing(null); setForm({ recordType: 'inspection', mileage: '', date: new Date().toISOString().split('T')[0], description: '', cost: '', nextServiceMileage: '', performedBy: '', notes: '' }); setModal(true) }
  const openEdit = (r: any) => { setEditing(r); setForm({ recordType: r.recordType, mileage: String(r.mileage), date: r.date.split('T')[0], description: r.description, cost: String(r.cost), nextServiceMileage: r.nextServiceMileage ? String(r.nextServiceMileage) : '', performedBy: r.performedBy || '', notes: r.notes || '' }); setModal(true) }

  // Statistika
  const overhaulCount = records.filter(r => r.recordType === 'overhaul' || r.recordType === 'major_repair').length
  const lastOverhaul = records.find(r => r.recordType === 'overhaul' || r.recordType === 'major_repair')

  return (
    <div className="p-5 space-y-4">
      {/* Statistika */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: 'Jami yozuv', value: records.length, color: 'text-blue-600' },
          { label: 'Kapital/Yirik ta\'mirat', value: overhaulCount, color: overhaulCount >= 2 ? 'text-red-600' : 'text-orange-600' },
          { label: 'Oxirgi ta\'mirat km', value: lastOverhaul ? Number(lastOverhaul.mileage).toLocaleString() + ' km' : '—', color: 'text-gray-700 dark:text-gray-300' },
          { label: 'Keyingi xizmat km', value: lastOverhaul?.nextServiceMileage ? Number(lastOverhaul.nextServiceMileage).toLocaleString() + ' km' : '—', color: 'text-green-600' },
        ].map(s => (
          <div key={s.label} className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400 mb-1">{s.label}</p>
            <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
          </div>
        ))}
      </div>

      {overhaulCount >= 2 && (
        <div className="flex items-center gap-2 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-sm text-red-700 dark:text-red-400">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />
          Bu mashina 12 oy ichida {overhaulCount} marta yirik ta'mirga tushgan — hisobdan chiqarishni ko'rib chiqing!
        </div>
      )}

      <div className="flex justify-end">
        <button onClick={openAdd} className="flex items-center gap-1.5 text-sm px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg">
          <Plus className="w-4 h-4" /> Yozuv qo'shish
        </button>
      </div>

      {records.length === 0 ? (
        <div className="text-center py-12">
          <Wrench className="w-12 h-12 text-gray-300 dark:text-gray-600 mx-auto mb-3" />
          <p className="text-gray-500 dark:text-gray-400">{t('vehicleDetail.noEngineRecords')}</p>
          <p className="text-sm text-gray-400 dark:text-gray-500">{t('vehicleDetail.engineRecordsHint')}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {records.map((r: any) => (
            <div key={r.id} className="border border-gray-200 dark:border-gray-700 rounded-xl p-4 bg-white dark:bg-gray-800">
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <span className={`inline-flex items-center text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 ${ENGINE_TYPE_COLORS[r.recordType]}`}>
                    {String(t(`vehicleDetail.engineType.${r.recordType}`, r.recordType))}
                  </span>
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 dark:text-white text-sm">{r.description}</p>
                    <div className="flex flex-wrap gap-3 mt-1 text-xs text-gray-500 dark:text-gray-400">
                      <span>{new Date(r.date).toLocaleDateString('uz-UZ')}</span>
                      <span>{Number(r.mileage).toLocaleString()} km</span>
                      {r.performedBy && <span>Usta: {r.performedBy}</span>}
                      {Number(r.cost) > 0 && <span className="text-orange-600 dark:text-orange-400 font-medium">{Number(r.cost).toLocaleString()} so'm</span>}
                      {r.nextServiceMileage && <span className="text-green-600 dark:text-green-400">Keyingi: {Number(r.nextServiceMileage).toLocaleString()} km</span>}
                    </div>
                    {r.notes && <p className="text-xs text-gray-400 italic mt-1">{r.notes}</p>}
                  </div>
                </div>
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => openEdit(r)} className="p-1.5 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg text-gray-400 hover:text-gray-600 dark:hover:text-gray-300">
                    <Edit2 className="w-3.5 h-3.5" />
                  </button>
                  <button onClick={() => { if (confirm('O\'chirishni tasdiqlaysizmi?')) delMut.mutate(r.id) }} className="p-1.5 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg text-gray-400 hover:text-red-500">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-800 rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{editing ? t('vehicleDetail.editRecord') : t('vehicleDetail.newRecord')}</h3>
              <button onClick={() => setModal(false)}><X className="w-5 h-5 text-gray-400" /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.recordType')}</label>
                <select value={form.recordType} onChange={e => setForm(f => ({ ...f, recordType: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {Object.keys(ENGINE_TYPE_COLORS).map(k => <option key={k} value={k}>{t(`vehicleDetail.engineType.${k}`, k)}</option>)}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.dateRequired', t('vehicleDetail.date'))}</label>
                  <input type="date" value={form.date} onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.km')}</label>
                  <input type="number" placeholder="0" value={form.mileage} onChange={e => setForm(f => ({ ...f, mileage: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.description')}</label>
                <input type="text" placeholder="Dvigatel kapital remont..." value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.cost')}</label>
                  <input type="number" placeholder="0" value={form.cost} onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.nextServiceKm')}</label>
                  <input type="number" placeholder="0" value={form.nextServiceMileage} onChange={e => setForm(f => ({ ...f, nextServiceMileage: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.workerName')}</label>
                <input type="text" placeholder={t('vehicleDetail.workerHint')} value={form.performedBy} onChange={e => setForm(f => ({ ...f, performedBy: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('vehicleDetail.comment')}</label>
                <textarea rows={2} placeholder={t('vehicleDetail.notesHint')} value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={() => setModal(false)} className="flex-1 px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700">{t('vehicleDetail.cancel')}</button>
              <button disabled={saveMut.isPending || !form.mileage || !form.date || !form.description}
                onClick={() => saveMut.mutate(form)}
                className="flex-1 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-lg">
                {saveMut.isPending ? t('common.loading') : t('common.save')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
