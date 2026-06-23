import { useState, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useForm } from 'react-hook-form'
import {
  ArrowLeft, Edit2, ArrowDown, ArrowUp, ShieldAlert, Wrench,
  Package, History, CheckCircle, AlertTriangle, Loader2,
  DollarSign, RotateCcw, Car, Calendar, Hash,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatCurrency, formatDate } from '../lib/utils'
import { useAuthStore } from '../stores/authStore'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import SearchableSelect from '../components/ui/SearchableSelect'
import GpsInstallPreview from '../components/GpsInstallPreview'

const TIRE_TYPES = ['Summer', 'Winter', 'All-season', 'Off-road', 'Spare']
const POSITIONS = ['Front-Left', 'Front-Right', 'Rear-Left', 'Rear-Right']
const MIN_TREAD = 1.6

const STATUS_MAP: Record<string, { label: string; variant: any }> = {
  in_stock:  { label: 'Omborда', variant: 'info' },
  installed: { label: "O'rnatilgan", variant: 'success' },
  returned:  { label: 'Qaytarilgan', variant: 'warning' },
  written_off: { label: 'Hisobdan chiqarilgan', variant: 'secondary' },
  damaged:   { label: 'Shikastlangan', variant: 'danger' },
}
const CONDITION_MAP: Record<string, { label: string; variant: any }> = {
  excellent: { label: 'Juda yaxshi', variant: 'success' },
  good:      { label: 'Yaxshi', variant: 'success' },
  fair:      { label: 'Qoniqarli', variant: 'warning' },
  poor:      { label: 'Yomon', variant: 'warning' },
  critical:  { label: 'Kritik', variant: 'danger' },
  unknown:   { label: "Noma'lum", variant: 'secondary' },
}
const EVENT_ICONS: Record<string, React.ReactNode> = {
  purchased:        <Package className="w-4 h-4 text-blue-500" />,
  installed:        <ArrowDown className="w-4 h-4 text-green-500" />,
  removed:          <ArrowUp className="w-4 h-4 text-yellow-500" />,
  returned:         <RotateCcw className="w-4 h-4 text-orange-500" />,
  written_off:      <ShieldAlert className="w-4 h-4 text-red-500" />,
  deduction_applied:<DollarSign className="w-4 h-4 text-purple-500" />,
}
const EVENT_LABELS: Record<string, string> = {
  purchased: 'Sotib olindi', installed: "O'rnatildi",
  removed: 'Olib olindi', returned: 'Qaytarildi',
  written_off: 'Hisobdan chiqarildi', deduction_applied: 'Ushlab qolish',
}

type ActiveModal = 'edit' | 'install' | 'remove' | 'write-off' | 'maintenance' | null

export default function TireDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()
  const [modal, setModal] = useState<ActiveModal>(null)
  const [activeTab, setActiveTab] = useState<'events' | 'maintenance'>('events')

  const editForm = useForm<any>()
  const installForm = useForm<any>()
  const removeForm = useForm<any>()
  const writeOffForm = useForm<any>()
  const maintForm = useForm<any>({ defaultValues: { type: 'rotation', cost: '0' } })

  const { data: tireData, isLoading } = useQuery({
    queryKey: ['tire', id],
    queryFn: () => api.get(`/tires/${id}`).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: eventsData } = useQuery({
    queryKey: ['tire-events', id],
    queryFn: () => api.get(`/tires/${id}/events`).then(r => r.data.data),
    enabled: !!id,
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-for-tires'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
    enabled: modal === 'install',
  })

  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/expenses/users', { params: { limit: 200 } }).then(r => r.data.data),
    enabled: modal === 'install',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tire', id] })
    qc.invalidateQueries({ queryKey: ['tire-events', id] })
    qc.invalidateQueries({ queryKey: ['tires'] })
    qc.invalidateQueries({ queryKey: ['tire-stats'] })
  }

  const [installKmInput, setInstallKmInput] = useState('')
  const installKmRef = useRef<HTMLInputElement>(null)

  const editMutation = useMutation({
    mutationFn: (d: any) => api.patch(`/tires/${id}`, d),
    onSuccess: () => { toast.success("Ma'lumotlar yangilandi"); invalidate(); setModal(null) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const saveInstallKmMutation = useMutation({
    mutationFn: (km: number) => api.patch(`/tires/${id}`, { installedMileageKm: km }),
    onSuccess: () => { toast.success("O'rnatilgan km saqlandi"); setInstallKmInput(''); invalidate() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const installMutation = useMutation({
    mutationFn: (d: any) => api.post(`/tires/${id}/install`, d),
    onSuccess: () => { toast.success("Avtoshina o'rnatildi"); invalidate(); setModal(null); installForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const removeMutation = useMutation({
    mutationFn: (d: any) => api.post(`/tires/${id}/remove`, d),
    onSuccess: (res) => {
      const km = res.data.data?.actualMileageUsed
      toast.success(`Olib olindi. Yurgan km: ${km?.toLocaleString() ?? 0}`)
      invalidate(); setModal(null); removeForm.reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const writeOffMutation = useMutation({
    mutationFn: (d: any) => api.post(`/tires/${id}/write-off`, d),
    onSuccess: (res) => {
      const { deductionAmount } = res.data.data
      toast.success(deductionAmount > 0
        ? `Hisobdan chiqarildi. Ushlab qolish: ${formatCurrency(deductionAmount)}`
        : 'Hisobdan chiqarildi')
      invalidate(); setModal(null); writeOffForm.reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const maintMutation = useMutation({
    mutationFn: (d: any) => api.post(`/tires/${id}/maintenance`, d),
    onSuccess: () => { toast.success('Texnik xizmat qo\'shildi'); invalidate(); setModal(null); maintForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    )
  }

  if (!tireData) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p>Avtoshina topilmadi</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/tires')}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Orqaga
        </Button>
      </div>
    )
  }

  const t = tireData
  const status = t.displayStatus || t.status
  const statusInfo = STATUS_MAP[status] || STATUS_MAP[t.status]
  const conditionInfo = CONDITION_MAP[t.condition] || CONDITION_MAP['unknown']
  const depth = Number(t.currentTreadDepth || 0)
  const depthColor = depth < 1.6 ? 'text-red-600' : depth < 3 ? 'text-yellow-600' : 'text-green-600'
  const depthBarColor = depth < 1.6 ? 'bg-red-500' : depth < 3 ? 'bg-yellow-500' : 'bg-green-500'
  const stdKm = t.standardMileageKm || 40000
  const installKm = t.installedMileageKm != null ? Number(t.installedMileageKm) : null
  const gpsKmSinceInstall = t.gpsKmSinceInstall != null ? Number(t.gpsKmSinceInstall) : null
  const totalDriven = Number(t.totalMileage || 0)
  const usedPct = Math.min(100, Math.round(((totalDriven + (gpsKmSinceInstall ?? 0)) / stdKm) * 100))

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))
  const users = [{ value: '', label: '— Tanlang —' }, ...(usersData || []).map((u: any) => ({ value: u.id, label: u.fullName }))]

  const isAdmin = hasRole('admin', 'manager', 'branch_manager')

  const openEdit = () => {
    editForm.reset({
      brand: t.brand, model: t.model, size: t.size, type: t.type,
      serialNumber: t.serialNumber || '', dotCode: t.dotCode || '',
      purchasePrice: String(t.purchasePrice),
      purchaseDate: t.purchaseDate ? t.purchaseDate.slice(0, 10) : '',
      currentTreadDepth: t.currentTreadDepth ? String(t.currentTreadDepth) : '',
      standardMileageKm: String(t.standardMileageKm || 40000),
      warrantyEndDate: t.warrantyEndDate ? t.warrantyEndDate.slice(0, 10) : '',
      installedMileageKm: t.installedMileageKm != null ? String(t.installedMileageKm) : '',
      installationDate: t.installationDate ? t.installationDate.slice(0, 10) : '',
      notes: t.notes || '',
    })
    setModal('edit')
  }

  return (
    <div className="space-y-5 max-w-4xl mx-auto pb-10">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button onClick={() => navigate('/tires')}
          className="p-2 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 dark:text-gray-400 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-bold text-gray-900 dark:text-white font-mono">{t.serialCode}</h1>
            <Badge variant={statusInfo.variant}>{statusInfo.label}</Badge>
            <Badge variant={conditionInfo.variant}>{conditionInfo.label}</Badge>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{t.brand} {t.model} · {t.size} · {t.type}</p>
          <p className="text-xs text-gray-400 font-mono">{t.uniqueId}</p>
        </div>
        {isAdmin && (
          <Button icon={<Edit2 className="w-4 h-4" />} onClick={openEdit}>
            Tahrirlash
          </Button>
        )}
      </div>

      {/* Action buttons */}
      {isAdmin && status !== 'written_off' && (
        <div className="flex gap-2 flex-wrap">
          {status !== 'installed' && (
            <Button icon={<ArrowDown className="w-4 h-4" />} onClick={() => { installForm.reset(); setModal('install') }}>
              O'rnatish
            </Button>
          )}
          {status === 'installed' && (
            <Button variant="outline" icon={<ArrowUp className="w-4 h-4" />}
              onClick={() => { removeForm.reset(); setModal('remove') }}>
              Olib olish
            </Button>
          )}
          <Button variant="outline" icon={<Wrench className="w-4 h-4" />}
            onClick={() => { maintForm.reset({ type: 'rotation', cost: '0', date: new Date().toISOString().slice(0, 10) }); setModal('maintenance') }}>
            Texnik xizmat
          </Button>
          {hasRole('admin', 'manager') && (
            <Button variant="outline" icon={<ShieldAlert className="w-4 h-4" />}
              className="text-red-600 border-red-300 hover:bg-red-50"
              onClick={() => { writeOffForm.reset(); setModal('write-off') }}>
              Hisobdan chiqarish
            </Button>
          )}
        </div>
      )}

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {/* Asosiy ma'lumot */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Shina ma'lumoti</p>
          {[
            ['Brand / Model', `${t.brand} ${t.model}`],
            ['O\'lcham', t.size],
            ['Turi', t.type],
            ['Zavod seriya', t.serialCode],
            ['Seriya №', t.serialNumber || '—'],
            ['DOT kodi', t.dotCode || '—'],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">{k}</span>
              <span className="font-medium text-gray-900 dark:text-white text-right max-w-[55%] break-all">{v}</span>
            </div>
          ))}
        </div>

        {/* Sotib olish */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Xarid</p>
          {[
            ['Narxi', formatCurrency(Number(t.purchasePrice))],
            ['Xarid sanasi', formatDate(t.purchaseDate)],
            ['Yetkazuvchi', t.supplier?.name || '—'],
            ['Kafolat', t.warrantyEndDate ? formatDate(t.warrantyEndDate) : '—'],
            ['Norma', `${stdKm.toLocaleString()} km`],
          ].map(([k, v]) => (
            <div key={k} className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">{k}</span>
              <span className="font-medium text-gray-900 dark:text-white">{v}</span>
            </div>
          ))}
        </div>

        {/* Km statistika */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 space-y-3">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Km hisobi</p>

          {installKm != null ? (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">O'rnatilgan km</span>
              <span className="font-medium text-gray-900 dark:text-white">{installKm.toLocaleString()} km</span>
            </div>
          ) : t.status === 'installed' && (
            <div className="space-y-1.5">
              <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
                O'rnatilgan km kiritilmagan — GPS aniq hisoblay olmaydi
              </p>
              <div className="flex gap-2">
                <input
                  ref={installKmRef}
                  type="number"
                  value={installKmInput}
                  onChange={e => setInstallKmInput(e.target.value)}
                  placeholder="Masalan: 85000"
                  className="flex-1 px-2.5 py-1.5 text-sm border border-amber-300 dark:border-amber-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500"
                  onKeyDown={e => {
                    if (e.key === 'Enter' && installKmInput) {
                      saveInstallKmMutation.mutate(parseInt(installKmInput))
                    }
                  }}
                />
                <button
                  onClick={() => { if (installKmInput) saveInstallKmMutation.mutate(parseInt(installKmInput)) }}
                  disabled={!installKmInput || saveInstallKmMutation.isPending}
                  className="px-3 py-1.5 text-xs font-medium bg-amber-500 hover:bg-amber-600 text-white rounded-lg disabled:opacity-50 transition-colors">
                  {saveInstallKmMutation.isPending ? '...' : 'Saqlash'}
                </button>
              </div>
            </div>
          )}

          {t.installationDate && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">O'rnatilgan sana</span>
              <span className="font-medium text-gray-900 dark:text-white">{formatDate(t.installationDate)}</span>
            </div>
          )}
          {t.status === 'installed' && !t.installationDate && (
            <p className="text-xs text-amber-700 dark:text-amber-400 font-medium">
              O'rnatilgan sana kiritilmagan — "Tahrirlash" da sanani belgilang, GPS shu sanadan hisoblaydi
            </p>
          )}

          {gpsKmSinceInstall != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">📡 GPS — o'rnatilganidan beri</span>
              <span className="font-bold text-blue-600 dark:text-blue-400">+{gpsKmSinceInstall.toLocaleString()} km</span>
            </div>
          )}
          {gpsKmSinceInstall != null && installKm != null && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">Hozirgi km (o'rnatilgan + GPS)</span>
              <span className="font-bold text-gray-900 dark:text-white">{(installKm + gpsKmSinceInstall).toLocaleString()} km</span>
            </div>
          )}
          {t.status === 'installed' && gpsKmSinceInstall == null && installKm != null && (
            <p className="text-xs text-amber-600 dark:text-amber-400">GPS ma'lumoti hali mavjud emas (keyingi sync da yangilanadi)</p>
          )}

          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">Jami yurgan</span>
            <span className="font-bold text-gray-900 dark:text-white">{totalDriven.toLocaleString()} km</span>
          </div>

          {/* Progress */}
          <div>
            <div className="flex justify-between text-xs text-gray-400 mb-1">
              <span>Norm ishlatilishi</span>
              <span className={usedPct >= 90 ? 'text-red-600 font-bold' : ''}>{usedPct}%</span>
            </div>
            <div className="w-full h-2.5 bg-gray-200 dark:bg-gray-600 rounded-full">
              <div className={`h-2.5 rounded-full transition-all ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${usedPct}%` }} />
            </div>
          </div>

          {/* Protector */}
          {depth > 0 && (
            <div>
              <div className="flex justify-between text-xs text-gray-400 mb-1">
                <span>Protector chuqurligi</span>
                <span className={`font-bold ${depthColor}`}>{depth.toFixed(1)} mm</span>
              </div>
              <div className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-full">
                <div className={`h-2 rounded-full ${depthBarColor}`}
                  style={{ width: `${Math.min(100, (depth / 8.5) * 100)}%` }} />
              </div>
              {depth < MIN_TREAD && (
                <p className="text-xs text-red-600 dark:text-red-400 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Minimum chegara ({MIN_TREAD} mm) dan past
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* O'rnatilgan avtomobil */}
      {t.vehicle && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Car className="w-4 h-4 text-blue-500" />
            <p className="text-sm font-semibold text-gray-800 dark:text-gray-200">O'rnatilgan avtomobil</p>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
            {[
              ['Davlat raqami', t.vehicle.registrationNumber],
              ['Marka / Model', `${t.vehicle.brand} ${t.vehicle.model}`],
              ['Pozitsiya', t.position || '—'],
              ['Haydovchi', t.driver?.fullName || '—'],
            ].map(([k, v]) => (
              <div key={k}>
                <p className="text-xs text-gray-400">{k}</p>
                <p className="font-medium text-gray-900 dark:text-white font-mono">{v}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Izoh */}
      {t.notes && (
        <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-4 text-sm text-blue-700 dark:text-blue-300">
          <span className="font-semibold">Izoh: </span>{t.notes}
        </div>
      )}

      {/* Tarix & Texnik xizmat tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="flex border-b border-gray-200 dark:border-gray-700">
          {([
            { key: 'events', label: 'Voqealar tarixi', icon: <History className="w-4 h-4" /> },
            { key: 'maintenance', label: 'Texnik xizmatlar', icon: <Wrench className="w-4 h-4" /> },
          ] as const).map(tab => (
            <button key={tab.key} onClick={() => setActiveTab(tab.key)}
              className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-500 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'
              }`}>
              {tab.icon} {tab.label}
            </button>
          ))}
        </div>

        <div className="p-4">
          {activeTab === 'events' && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {!eventsData ? (
                <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
              ) : eventsData.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">Voqealar yo'q</p>
              ) : eventsData.map((ev: any) => (
                <div key={ev.id} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                  <div className="mt-0.5 shrink-0">{EVENT_ICONS[ev.eventType] || <History className="w-4 h-4 text-gray-400" />}</div>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-sm text-gray-900 dark:text-white">{EVENT_LABELS[ev.eventType] || ev.eventType}</p>
                    {ev.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ev.notes}</p>}
                    {ev.mileageAtEvent != null && <p className="text-xs text-blue-500">{Number(ev.mileageAtEvent).toLocaleString()} km</p>}
                  </div>
                  <p className="text-xs text-gray-400 shrink-0">{formatDate(ev.createdAt)}</p>
                </div>
              ))}
            </div>
          )}

          {activeTab === 'maintenance' && (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {!t.tireMaintenances || t.tireMaintenances.length === 0 ? (
                <p className="text-center text-gray-400 py-8 text-sm">Texnik xizmat yozuvlari yo'q</p>
              ) : t.tireMaintenances.map((m: any) => (
                <div key={m.id} className="flex items-center gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                  <Wrench className="w-4 h-4 text-purple-500 shrink-0" />
                  <div className="flex-1">
                    <p className="text-sm font-medium text-gray-900 dark:text-white capitalize">{m.type}</p>
                    {m.notes && <p className="text-xs text-gray-500">{m.notes}</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-xs text-gray-400">{formatDate(m.date)}</p>
                    {Number(m.cost) > 0 && <p className="text-xs font-medium text-gray-700 dark:text-gray-300">{formatCurrency(Number(m.cost))}</p>}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ===== EDIT MODAL ===== */}
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Avtoshina ma'lumotlarini tahrirlash" size="lg"
        footer={<>
          <Button variant="outline" onClick={() => setModal(null)}>Bekor qilish</Button>
          <Button loading={editMutation.isPending}
            onClick={editForm.handleSubmit(d => editMutation.mutate(d))}>
            Saqlash
          </Button>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Brand" {...editForm.register('brand', { required: true })} />
          <Input label="Model" {...editForm.register('model', { required: true })} />
          <Input label="O'lcham (masalan 205/55R16)" {...editForm.register('size', { required: true })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Turi</label>
            <select {...editForm.register('type')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TIRE_TYPES.map(tp => <option key={tp}>{tp}</option>)}
            </select>
          </div>
          <Input label="Seriya № (ixtiyoriy)" {...editForm.register('serialNumber')} />
          <Input label="DOT kodi (ixtiyoriy)" placeholder="2524" {...editForm.register('dotCode')} />
          <Input label="Narxi (UZS)" type="number" {...editForm.register('purchasePrice')} />
          <Input label="Xarid sanasi" type="date" {...editForm.register('purchaseDate')} />
          <Input label="Protector chuqurligi (mm)" type="number" step="0.1" placeholder="8.5"
            {...editForm.register('currentTreadDepth')} />
          <Input label="Norma km" type="number" placeholder="40000"
            {...editForm.register('standardMileageKm')} />
          <Input label="Kafolat tugash sanasi" type="date"
            {...editForm.register('warrantyEndDate')} />
          {t.status === 'installed' && t.vehicleId && (
            <>
              <Input label="O'rnatilgan km (odometr)" type="number" placeholder="85000"
                {...editForm.register('installedMileageKm')} />
              <Input label="O'rnatilgan sana" type="date"
                {...editForm.register('installationDate')} />
              <div className="sm:col-span-2">
                <GpsInstallPreview vehicleId={t.vehicleId}
                  installDate={editForm.watch('installationDate')}
                  odometer={editForm.watch('installedMileageKm')} />
              </div>
            </>
          )}
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              {...editForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== INSTALL MODAL ===== */}
      <Modal open={modal === 'install'} onClose={() => setModal(null)} title="Avtomobilga o'rnatish" size="md"
        footer={<>
          <Button variant="outline" onClick={() => setModal(null)}>Bekor qilish</Button>
          <Button loading={installMutation.isPending} icon={<ArrowDown className="w-4 h-4" />}
            onClick={installForm.handleSubmit(d => {
              if (!d.vehicleId) { toast.error('Avtomobilni tanlang'); return }
              installMutation.mutate(d)
            })}>
            O'rnatish
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3 text-sm">
            <p className="font-mono font-bold text-blue-700 dark:text-blue-300">{t.brand} {t.model} {t.size}</p>
            <p className="text-xs text-blue-600 dark:text-blue-400 mt-0.5">Serial: {t.serialCode}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Avtomobil *</label>
            <SearchableSelect label="" options={vehicles}
              value={installForm.watch('vehicleId') || ''}
              onChange={v => installForm.setValue('vehicleId', v)}
              placeholder="Avtomobilni tanlang" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Haydovchi</label>
            <SearchableSelect label="" options={users}
              value={installForm.watch('driverId') || ''}
              onChange={v => installForm.setValue('driverId', v)}
              placeholder="Haydovchini tanlang" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pozitsiya</label>
            <select {...installForm.register('position')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg">
              <option value="">— Tanlang —</option>
              {POSITIONS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <Input label="Odometr (km)" type="number" placeholder="85000"
            hint="Bo'sh qoldirsangiz, avtomobil joriy km olinadi"
            {...installForm.register('installedMileageKm')} />
          <Input label="O'rnatish sanasi" type="date" {...installForm.register('installationDate')} />
        </div>
      </Modal>

      {/* ===== REMOVE MODAL ===== */}
      <Modal open={modal === 'remove'} onClose={() => setModal(null)} title="Avtomobildan olib olish" size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setModal(null)}>Bekor qilish</Button>
          <Button loading={removeMutation.isPending} icon={<ArrowUp className="w-4 h-4" />}
            onClick={removeForm.handleSubmit(d => removeMutation.mutate(d))}>
            Olib olish
          </Button>
        </>}
      >
        <div className="space-y-4">
          {installKm != null && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-sm">
              <p className="text-gray-500">O'rnatilgan km: <span className="font-bold text-gray-900 dark:text-white">{installKm.toLocaleString()} km</span></p>
              {gpsKmSinceInstall != null && (
                <p className="text-blue-600 dark:text-blue-400 font-medium mt-0.5">📡 Joriy: +{gpsKmSinceInstall.toLocaleString()} km yurdi</p>
              )}
            </div>
          )}
          <Input label="Joriy odometr (km) *" type="number" placeholder="110000"
            hint="Olib olish vaqtidagi km ko'rsatgichi"
            error={removeForm.formState.errors.removedMileageKm?.message as string}
            {...removeForm.register('removedMileageKm', { required: 'Km kiritilmadi' })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
              placeholder="Sabab..."
              {...removeForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== WRITE-OFF MODAL ===== */}
      {modal === 'write-off' && (() => {
        const actualKm = Number(t.actualMileageUsed || t.totalMileage || 0)
        const remainingKm = Math.max(0, stdKm - actualKm)
        const deductionPerKm = Number(t.purchasePrice) / stdKm
        const deductionAmount = remainingKm * deductionPerKm
        return (
          <Modal open onClose={() => setModal(null)} title="Hisobdan chiqarish" size="md"
            footer={<>
              <Button variant="outline" onClick={() => setModal(null)}>Bekor qilish</Button>
              <Button loading={writeOffMutation.isPending} variant="danger"
                onClick={writeOffForm.handleSubmit(d => writeOffMutation.mutate(d))}>
                Hisobdan chiqarish
              </Button>
            </>}
          >
            <div className="space-y-4">
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 grid grid-cols-3 gap-3 text-center text-sm">
                <div><p className="text-gray-400 text-xs">Norma</p><p className="font-bold">{stdKm.toLocaleString()} km</p></div>
                <div><p className="text-gray-400 text-xs">Yurgan</p><p className="font-bold text-blue-600">{actualKm.toLocaleString()} km</p></div>
                <div><p className="text-gray-400 text-xs">Qolgan</p><p className={`font-bold ${remainingKm > 0 ? 'text-red-600' : 'text-green-600'}`}>{remainingKm.toLocaleString()} km</p></div>
              </div>
              {remainingKm > 0 && t.driverId && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-xl p-4 text-sm">
                  <p className="font-semibold text-red-800 dark:text-red-300 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" /> Haydovchidan ushlab qolish
                  </p>
                  <p className="text-red-700 dark:text-red-400 text-lg font-bold mt-1">{formatCurrency(Math.round(deductionAmount))}</p>
                  <p className="text-xs text-red-500 mt-0.5">1 km = {formatCurrency(Math.round(deductionPerKm))}</p>
                </div>
              )}
              <Input label="Haqiqiy km (ixtiyoriy o'zgartirish)" type="number" placeholder={String(actualKm)}
                hint="Bo'sh qoldirsangiz, yuqoridagi km ishlatiladi"
                {...writeOffForm.register('overrideActualKm')} />
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sabab *</label>
                <select {...writeOffForm.register('reason', { required: true })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg">
                  <option value="">— Tanlang —</option>
                  <option value="worn_out">To'liq eskirgan</option>
                  <option value="worn_early">Muddatidan oldin eskirgan</option>
                  <option value="damaged">Shikastlangan</option>
                  <option value="lost">Yo'qolgan</option>
                  <option value="other">Boshqa</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
                <textarea rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                  {...writeOffForm.register('notes')} />
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ===== MAINTENANCE MODAL ===== */}
      <Modal open={modal === 'maintenance'} onClose={() => setModal(null)} title="Texnik xizmat qo'shish" size="sm"
        footer={<>
          <Button variant="outline" onClick={() => setModal(null)}>Bekor qilish</Button>
          <Button loading={maintMutation.isPending} icon={<Wrench className="w-4 h-4" />}
            onClick={maintForm.handleSubmit(d => maintMutation.mutate(d))}>
            Saqlash
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Xizmat turi</label>
            <select {...maintForm.register('type', { required: true })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg">
              <option value="rotation">Joyini almashtirish</option>
              <option value="repair">Ta'mirlash</option>
              <option value="inspection">Tekshiruv</option>
              <option value="pressure_check">Bosim tekshiruvi</option>
            </select>
          </div>
          <Input label="Sana" type="date" {...maintForm.register('date', { required: true })} />
          <Input label="Narxi (UZS)" type="number" placeholder="0" {...maintForm.register('cost')} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea rows={2} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
              {...maintForm.register('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
