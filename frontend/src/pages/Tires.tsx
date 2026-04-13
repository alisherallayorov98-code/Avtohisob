import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  Plus, AlertTriangle, CheckCircle, Search, ChevronDown,
  Wrench, Package, ArrowDown, ArrowUp, ShieldAlert, History,
  Car, QrCode, DollarSign, RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatCurrency, formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'

const TIRE_TYPES = ['Summer', 'Winter', 'All-season', 'Off-road', 'Spare']
const POSITIONS = ['Front-Left', 'Front-Right', 'Rear-Left', 'Rear-Right']

const STATUS_LABELS: Record<string, string> = {
  in_stock: 'Omborda', installed: "O'rnatilgan",
  returned: 'Qaytarildi', written_off: 'Chiqarildi',
  damaged: 'Shikastlangan', warning: 'Ogohlantirish',
  critical: 'Kritik', warranty_expiring: 'Kafolat tugayapti',
}
const STATUS_COLORS: Record<string, any> = {
  in_stock: 'info', installed: 'success',
  returned: 'warning', written_off: 'secondary',
  damaged: 'danger', warning: 'warning',
  critical: 'danger', warranty_expiring: 'warning',
}
const CONDITION_LABELS: Record<string, string> = {
  excellent: "A'lo", good: 'Yaxshi', fair: "O'rtacha",
  poor: 'Yomon', critical: 'Kritik', unknown: "Noma'lum",
}
const CONDITION_COLORS: Record<string, any> = {
  excellent: 'success', good: 'success', fair: 'warning',
  poor: 'warning', critical: 'danger', unknown: 'secondary',
}

type ActiveModal =
  | { type: 'add' }
  | { type: 'detail'; tire: any }
  | { type: 'install'; tire: any }
  | { type: 'remove'; tire: any }
  | { type: 'verify-return' }
  | { type: 'write-off'; tire: any }
  | { type: 'maintenance'; tire: any }
  | { type: 'events'; tire: any }
  | { type: 'deductions' }
  | null

export default function Tires() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [statusFilter, setStatusFilter] = useState('')
  const [modal, setModal] = useState<ActiveModal>(null)
  const close = () => setModal(null)

  // Form instances
  const addForm = useForm<any>({ defaultValues: { type: 'Summer', standardMileageKm: '40000' } })
  const installForm = useForm<any>()
  const removeForm = useForm<any>()
  const verifyForm = useForm<any>()
  const writeOffForm = useForm<any>()
  const maintForm = useForm<any>()

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['tire-stats'],
    queryFn: () => api.get('/tires/stats').then(r => r.data.data),
  })
  const { data, isLoading } = useQuery({
    queryKey: ['tires', page, limit, debouncedSearch, statusFilter],
    queryFn: () => api.get('/tires', { params: { page, limit, debouncedSearch: debouncedSearch || undefined, status: statusFilter || undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-for-tires'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })
  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/expenses/users', { params: { limit: 200 } }).then(r => r.data.data),
  })
  const { data: eventsData } = useQuery({
    queryKey: ['tire-events', modal?.type === 'events' ? (modal as any).tire?.id : null],
    queryFn: () => api.get(`/tires/${(modal as any).tire.id}/events`).then(r => r.data.data),
    enabled: modal?.type === 'events',
  })
  const { data: deductionsData, isLoading: deductionsLoading } = useQuery({
    queryKey: ['tire-deductions'],
    queryFn: () => api.get('/tires/deductions').then(r => r.data),
    enabled: modal?.type === 'deductions',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tires'] })
    qc.invalidateQueries({ queryKey: ['tire-stats'] })
  }

  // Mutations
  const createMutation = useMutation({
    mutationFn: (d: any) => api.post('/tires', d),
    onSuccess: () => { toast.success("Avtoshina qo'shildi"); invalidate(); close(); addForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const installMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/install`, d),
    onSuccess: () => { toast.success("Avtoshina o'rnatildi"); invalidate(); close(); installForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const removeMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/remove`, d),
    onSuccess: (res) => {
      toast.success(`Olib olindi. Yurgan: ${res.data.data?.actualMileageUsed?.toLocaleString() || 0} km`)
      invalidate(); close(); removeForm.reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const verifyMutation = useMutation({
    mutationFn: (d: any) => api.post('/tires/verify-return', d),
    onSuccess: (res) => setVerifyResult(res.data.data),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Topilmadi'),
  })
  const writeOffMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/write-off`, d),
    onSuccess: (res) => {
      const { deductionAmount, standardKm, actualKm } = res.data.data
      if (deductionAmount > 0) {
        toast.success(`Chiqarildi. Ushlab qolish: ${formatCurrency(deductionAmount)} (${standardKm - actualKm} km qolgan)`, { duration: 6000 })
      } else {
        toast.success('Hisobdan chiqarildi')
      }
      invalidate(); close(); writeOffForm.reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const maintMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/maintenance`, d),
    onSuccess: () => { toast.success('Texnik xizmat qo\'shildi'); invalidate(); close(); maintForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const settleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/tires/deductions/${id}/settle`, {}),
    onSuccess: () => { toast.success("To'landi deb belgilandi"); qc.invalidateQueries({ queryKey: ['tire-deductions'] }); invalidate() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))
  const suppliers = [{ value: '', label: '— Tanlang —' }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]
  const users = [{ value: '', label: '— Tanlang —' }, ...(usersData || []).map((u: any) => ({ value: u.id, label: u.fullName }))]

  const columns = [
    {
      key: 'serial', title: 'Serial kod', render: (t: any) => (
        <div>
          <p className="font-mono font-bold text-blue-700 dark:text-blue-400 text-sm">{t.serialCode}</p>
          <p className="text-xs text-gray-400 font-mono">{t.uniqueId}</p>
          {t.dotCode && <p className="text-xs text-gray-400">DOT: {t.dotCode}</p>}
        </div>
      )
    },
    {
      key: 'brand', title: 'Brand / Model', render: (t: any) => (
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">{t.brand} {t.model}</p>
          <p className="text-xs text-gray-500">{t.size} · {t.type}</p>
          <p className="text-xs text-gray-400">Norma: {(t.standardMileageKm || 40000).toLocaleString()} km</p>
        </div>
      )
    },
    {
      key: 'status', title: 'Status', render: (t: any) => {
        const s = t.displayStatus || t.status
        return (
          <div className="space-y-1">
            <Badge variant={STATUS_COLORS[s]}>{STATUS_LABELS[s] || s}</Badge>
            <Badge variant={CONDITION_COLORS[t.condition]}>{CONDITION_LABELS[t.condition]}</Badge>
          </div>
        )
      }
    },
    {
      key: 'vehicle', title: 'Avtomobil', render: (t: any) => t.vehicle ? (
        <div>
          <p className="font-mono text-sm font-medium">{t.vehicle.registrationNumber}</p>
          <p className="text-xs text-gray-500">{t.vehicle.brand} {t.vehicle.model}</p>
          <p className="text-xs text-blue-500">{t.position || '—'}</p>
          {t.driver && <p className="text-xs text-gray-400">👤 {t.driver.fullName}</p>}
        </div>
      ) : <span className="text-gray-400 text-xs">—</span>
    },
    {
      key: 'mileage', title: 'Km / Protektor', render: (t: any) => {
        const depth = Number(t.currentTreadDepth || 0)
        const color = depth < 1.6 ? 'bg-red-500' : depth < 3 ? 'bg-yellow-500' : 'bg-green-500'
        return (
          <div className="space-y-1">
            <p className="text-xs text-gray-500">Yurgan: <span className="font-medium text-gray-800 dark:text-gray-200">{Number(t.totalMileage || 0).toLocaleString()} km</span></p>
            {depth > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full">
                  <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(100, (depth / 8.5) * 100)}%` }} />
                </div>
                <span className={`text-xs font-bold ${depth < 1.6 ? 'text-red-600' : depth < 3 ? 'text-yellow-600' : 'text-green-600'}`}>{depth.toFixed(1)} mm</span>
              </div>
            )}
          </div>
        )
      }
    },
    {
      key: 'price', title: 'Narx', render: (t: any) => (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(Number(t.purchasePrice))}</p>
          <p className="text-xs text-gray-400">{formatDate(t.purchaseDate)}</p>
        </div>
      )
    },
    {
      key: 'actions', title: '', render: (t: any) => {
        const s = t.displayStatus || t.status
        return (
          <div className="flex flex-col gap-1 min-w-[90px]">
            <button onClick={() => setModal({ type: 'detail', tire: t })}
              className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200">
              Ko'rish
            </button>
            <button onClick={() => setModal({ type: 'events', tire: t })}
              className="text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 hover:bg-blue-100">
              Tarix
            </button>
            {hasRole('admin', 'manager', 'branch_manager') && s !== 'written_off' && (
              <>
                {s !== 'installed' && (
                  <button onClick={() => { installForm.reset({ installedMileageKm: '' }); setModal({ type: 'install', tire: t }) }}
                    className="text-xs px-2 py-1 rounded bg-green-50 dark:bg-green-900/30 text-green-700 hover:bg-green-100">
                    O'rnatish
                  </button>
                )}
                {s === 'installed' && (
                  <button onClick={() => { removeForm.reset(); setModal({ type: 'remove', tire: t }) }}
                    className="text-xs px-2 py-1 rounded bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 hover:bg-yellow-100">
                    Olish
                  </button>
                )}
                <button onClick={() => { maintForm.reset({ date: new Date().toISOString().split('T')[0], cost: '0' }); setModal({ type: 'maintenance', tire: t }) }}
                  className="text-xs px-2 py-1 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 hover:bg-purple-100">
                  Xizmat
                </button>
                {hasRole('admin', 'manager') && (
                  <button onClick={() => { writeOffForm.reset(); setModal({ type: 'write-off', tire: t }) }}
                    className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-700 hover:bg-red-100">
                    Chiqarish
                  </button>
                )}
              </>
            )}
          </div>
        )
      }
    },
  ]

  const pendingDeductionsCount = stats?.pendingDeductions || 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Avtoshinalar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Serial kod bo'yicha to'liq lifecycle nazorat</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExcelExportButton endpoint="/exports/tires" label="Excel" />
          <Button variant="outline" icon={<QrCode className="w-4 h-4" />}
            onClick={() => { setVerifyResult(null); verifyForm.reset(); setModal({ type: 'verify-return' }) }}>
            Qaytarishni tekshirish
          </Button>
          {pendingDeductionsCount > 0 && (
            <Button variant="outline" icon={<DollarSign className="w-4 h-4 text-red-500" />}
              onClick={() => setModal({ type: 'deductions' })}>
              Ushlab qolishlar ({pendingDeductionsCount})
            </Button>
          )}
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { addForm.reset({ type: 'Summer', standardMileageKm: '40000' }); setModal({ type: 'add' }) }}>
              Yangi shina
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: 'Jami', value: stats.total, color: 'blue' },
            { label: 'Omborda', value: stats.inStock, color: 'indigo' },
            { label: "O'rnatilgan", value: stats.installed, color: 'green' },
            { label: 'Qaytarildi', value: stats.returned, color: 'yellow' },
            { label: 'Chiqarildi', value: stats.writtenOff, color: 'gray' },
          ].map(({ label, value, color }) => (
            <div key={label} className={`bg-${color}-50 dark:bg-${color}-900/20 border border-${color}-200 dark:border-${color}-800 rounded-xl p-4`}>
              <p className={`text-xs text-${color}-600 dark:text-${color}-400`}>{label}</p>
              <p className={`text-2xl font-bold text-${color}-900 dark:text-${color}-100`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pending deductions alert */}
      {pendingDeductionsCount > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-red-800 dark:text-red-300">
              {pendingDeductionsCount} ta to'lanmagan ushlab qolish —{' '}
              <span className="font-bold">{formatCurrency(stats?.pendingDeductionsTotal || 0)}</span>
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">Haydovchi ish haqidan ushlab qolish talab qilinadi</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setModal({ type: 'deductions' })}>Ko'rish</Button>
        </div>
      )}

      {/* Urgent tires alert */}
      {stats?.urgentTires?.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-300">Zudlik bilan almashtirish talab etiladi</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {stats.urgentTires.map((t: any) => (
                  <span key={t.id} className="text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 px-2 py-1 rounded-full font-mono">
                    {t.serialCode} · {t.vehicle?.registrationNumber || '—'} — {Number(t.currentTreadDepth).toFixed(1)} mm
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value) }}
              placeholder="Serial kod, brand, model, o'lcham..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="relative">
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Barcha statuslar</option>
              <option value="in_stock">Omborda</option>
              <option value="installed">O'rnatilgan</option>
              <option value="returned">Qaytarildi</option>
              <option value="written_off">Chiqarildi</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* ===== ADD TIRE MODAL ===== */}
      <Modal open={modal?.type === 'add'} onClose={close} title="Yangi avtoshina qo'shish" size="lg"
        footer={<>
          <Button variant="outline" onClick={close}>Bekor qilish</Button>
          <Button loading={createMutation.isPending} onClick={addForm.handleSubmit(d => createMutation.mutate(d))}>Saqlash</Button>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Input label="Zavod serial kodi *" placeholder="5091609750"
              error={addForm.formState.errors.serialCode?.message as string}
              {...addForm.register('serialCode', { required: 'Serial kod majburiy' })}
              hint="Har bir avtoshinaning o'ziga xos zavod kodi — takrorlanmaydi" />
          </div>
          <Input label="Brand *" placeholder="Michelin"
            error={addForm.formState.errors.brand?.message as string}
            {...addForm.register('brand', { required: 'Talab qilinadi' })} />
          <Input label="Model *" placeholder="Pilot Sport"
            error={addForm.formState.errors.model?.message as string}
            {...addForm.register('model', { required: 'Talab qilinadi' })} />
          <Input label="O'lcham *" placeholder="205/55R16"
            error={addForm.formState.errors.size?.message as string}
            {...addForm.register('size', { required: 'Talab qilinadi' })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tur *</label>
            <select {...addForm.register('type')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TIRE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <Input label="DOT kod" placeholder="2524" hint="Hafta+yil: 2524 = 2024 yil 25-hafta"
            {...addForm.register('dotCode')} />
          <Input label="Seriya raqami (qo'shimcha)" placeholder="ABC123"
            {...addForm.register('serialNumber')} />
          <Input label="Sotib olingan sana *" type="date"
            error={addForm.formState.errors.purchaseDate?.message as string}
            {...addForm.register('purchaseDate', { required: 'Talab qilinadi' })} />
          <Input label="Narxi *" type="number" placeholder="850000" min={0}
            error={addForm.formState.errors.purchasePrice?.message as string}
            {...addForm.register('purchasePrice', { required: 'Talab qilinadi' })} />
          <Input label="Standart norma (km)" type="number" placeholder="40000" min={0}
            hint="O'rtacha xizmat muddati km da"
            {...addForm.register('standardMileageKm')} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yetkazuvchi</label>
            <SearchableSelect label="" options={suppliers}
              value={addForm.watch('supplierId') || ''}
              onChange={v => addForm.setValue('supplierId', v)}
              placeholder="Yetkazuvchi tanlang..." />
          </div>
          <Input label="Boshlang'ich protektor (mm)" type="number" step="0.1" placeholder="8.5"
            {...addForm.register('initialTreadDepth')} />
          <Input label="Kafolat muddati" type="date"
            {...addForm.register('warrantyEndDate')} />
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2}
              {...addForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== INSTALL MODAL ===== */}
      <Modal open={modal?.type === 'install'} onClose={close}
        title={`O'rnatish: ${(modal as any)?.tire?.serialCode || ''}`} size="md"
        footer={<>
          <Button variant="outline" onClick={close}>Bekor qilish</Button>
          <Button loading={installMutation.isPending} icon={<ArrowDown className="w-4 h-4" />}
            onClick={installForm.handleSubmit(d => installMutation.mutate({ id: (modal as any).tire.id, d }))}>
            O'rnatish
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
            <p className="font-mono font-bold">{(modal as any)?.tire?.brand} {(modal as any)?.tire?.model} {(modal as any)?.tire?.size}</p>
            <p className="text-xs mt-0.5">Serial: {(modal as any)?.tire?.serialCode}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Avtomobil *</label>
            <SearchableSelect label="" options={vehicles}
              value={installForm.watch('vehicleId') || ''}
              onChange={v => installForm.setValue('vehicleId', v)}
              placeholder="Avtomobil tanlang..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Haydovchi</label>
            <SearchableSelect label="" options={users}
              value={installForm.watch('driverId') || ''}
              onChange={v => installForm.setValue('driverId', v)}
              placeholder="Haydovchi tanlang..." />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pozitsiya</label>
            <select {...installForm.register('position')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Tanlang —</option>
              {POSITIONS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <Input label="Odometr (km)" type="number" placeholder="85000"
            hint="O'rnatilgan paytdagi avtomobil odometri"
            {...installForm.register('installedMileageKm')} />
          <Input label="O'rnatish sanasi" type="date"
            {...installForm.register('installationDate')} />
        </div>
      </Modal>

      {/* ===== REMOVE MODAL ===== */}
      <Modal open={modal?.type === 'remove'} onClose={close}
        title={`Avtomobildan olish: ${(modal as any)?.tire?.serialCode || ''}`} size="sm"
        footer={<>
          <Button variant="outline" onClick={close}>Bekor qilish</Button>
          <Button loading={removeMutation.isPending} icon={<ArrowUp className="w-4 h-4" />}
            onClick={removeForm.handleSubmit(d => removeMutation.mutate({ id: (modal as any).tire.id, d }))}>
            Olib olish
          </Button>
        </>}
      >
        <div className="space-y-4">
          {(modal as any)?.tire?.installedMileageKm && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-sm">
              <p className="text-gray-500">O'rnatilgan paytdagi odometr: <span className="font-bold text-gray-900 dark:text-white">{Number((modal as any).tire.installedMileageKm).toLocaleString()} km</span></p>
            </div>
          )}
          <Input label="Joriy odometr (km) *" type="number" placeholder="110000"
            hint="Hozirgi avtomobil odometri — yurgan km hisoblanadi"
            error={removeForm.formState.errors.removedMileageKm?.message as string}
            {...removeForm.register('removedMileageKm', { required: 'Odometr kiriting' })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg" rows={2}
              placeholder="Almashtirish sababi..."
              {...removeForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== VERIFY RETURN MODAL ===== */}
      <Modal open={modal?.type === 'verify-return'} onClose={() => { close(); setVerifyResult(null) }}
        title="Qaytarishni serial kod bilan tekshirish" size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">Haydovchi avtoshinani qaytarayotganda serial kodni skanerlang yoki kiriting va haqiqiy ekanligi tekshiriladi.</p>
          <Input label="Zavod serial kodi *" placeholder="5091609750"
            {...verifyForm.register('serialCode', { required: true })} />
          <Input label="DOT kod (ixtiyoriy)" placeholder="2524"
            hint="Qo'shimcha tekshiruv uchun"
            {...verifyForm.register('dotCode')} />
          <Button loading={verifyMutation.isPending} className="w-full"
            onClick={verifyForm.handleSubmit(d => verifyMutation.mutate(d))}>
            Tekshirish
          </Button>

          {verifyResult && (
            <div className={`rounded-xl border p-4 space-y-3 ${verifyResult.verified ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' : 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'}`}>
              <div className="flex items-center gap-2">
                {verifyResult.verified
                  ? <CheckCircle className="w-5 h-5 text-green-600" />
                  : <AlertTriangle className="w-5 h-5 text-red-600" />}
                <p className={`font-bold ${verifyResult.verified ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                  {verifyResult.verified ? 'Tasdiqlandi — haqiqiy avtoshina' : 'Diqqat: mos kelmagan ma\'lumotlar!'}
                </p>
              </div>
              {verifyResult.warning && <p className="text-sm text-red-700 dark:text-red-300">{verifyResult.warning}</p>}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  ['Serial', verifyResult.tire?.serialCode],
                  ['DOT', verifyResult.tire?.dotCode || '—'],
                  ['Brand', `${verifyResult.tire?.brand} ${verifyResult.tire?.model}`],
                  ["O'lcham", verifyResult.tire?.size],
                  ['Status', STATUS_LABELS[verifyResult.tire?.status] || verifyResult.tire?.status],
                  ['Sotib olingan', formatDate(verifyResult.tire?.purchaseDate)],
                  ['Norma km', (verifyResult.tire?.standardMileageKm || 40000).toLocaleString()],
                  ['Yurgan km', Number(verifyResult.tire?.totalMileage || 0).toLocaleString()],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white dark:bg-gray-800 rounded-lg p-2">
                    <p className="text-gray-400">{k}</p>
                    <p className="font-bold text-gray-900 dark:text-white">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ===== WRITE-OFF MODAL ===== */}
      <Modal open={modal?.type === 'write-off'} onClose={close}
        title={`Hisobdan chiqarish: ${(modal as any)?.tire?.serialCode || ''}`} size="md"
        footer={<>
          <Button variant="outline" onClick={close}>Bekor qilish</Button>
          <Button loading={writeOffMutation.isPending} variant="danger"
            onClick={writeOffForm.handleSubmit(d => writeOffMutation.mutate({ id: (modal as any).tire.id, d }))}>
            Hisobdan chiqarish
          </Button>
        </>}
      >
        {modal?.type === 'write-off' && (() => {
          const t = (modal as any).tire
          const stdKm = t.standardMileageKm || 40000
          const actualKm = Number(t.actualMileageUsed || t.totalMileage || 0)
          const remainingKm = Math.max(0, stdKm - actualKm)
          const deductionPerKm = Number(t.purchasePrice) / stdKm
          const deductionAmount = remainingKm * deductionPerKm
          return (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                  <p className="text-gray-500 text-xs">Norma</p>
                  <p className="font-bold text-gray-900 dark:text-white">{stdKm.toLocaleString()} km</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Yurgan</p>
                  <p className="font-bold text-blue-600">{actualKm.toLocaleString()} km</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">Qolgan norma</p>
                  <p className={`font-bold ${remainingKm > 0 ? 'text-red-600' : 'text-green-600'}`}>{remainingKm.toLocaleString()} km</p>
                </div>
              </div>

              {remainingKm > 0 && t.driverId && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    Haydovchidan ushlab qolish hisoblanadi
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div><p className="text-gray-500">1 km uchun</p><p className="font-bold">{formatCurrency(Math.round(deductionPerKm))}</p></div>
                    <div><p className="text-gray-500">Ushlab qolish</p><p className="font-bold text-red-700 dark:text-red-300 text-base">{formatCurrency(Math.round(deductionAmount))}</p></div>
                  </div>
                </div>
              )}

              {remainingKm > 0 && !t.driverId && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700 dark:text-yellow-300">
                  Haydovchi belgilanmagan — ushlab qolish yaratilmaydi. O'rnatishda haydovchi belgilangan bo'lishi kerak.
                </div>
              )}

              <Input label="Haqiqiy yurgan km (ixtiyoriy qayta kiritish)" type="number"
                placeholder={String(actualKm)}
                hint="Bo'sh qoldirilsa hisobdagi qiymat ishlatiladi"
                {...writeOffForm.register('overrideActualKm')} />

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sabab *</label>
                <select {...writeOffForm.register('reason', { required: true })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">— Sabab tanlang —</option>
                  <option value="worn_out">Eskirdi (norma to'ldi)</option>
                  <option value="worn_early">Muddatdan oldin eskirdi</option>
                  <option value="damaged">Shikastlandi / portladi</option>
                  <option value="lost">Yo'qoldi / o'g'irlandi</option>
                  <option value="other">Boshqa</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Utilizatsiya usuli</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                  placeholder="Tashlandi / Sotilib yuborildi..."
                  {...writeOffForm.register('disposalMethod')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
                <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg" rows={2}
                  {...writeOffForm.register('notes')} />
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ===== MAINTENANCE MODAL ===== */}
      <Modal open={modal?.type === 'maintenance'} onClose={close}
        title={`Texnik xizmat: ${(modal as any)?.tire?.serialCode || ''}`} size="sm"
        footer={<>
          <Button variant="outline" onClick={close}>Bekor qilish</Button>
          <Button loading={maintMutation.isPending} icon={<Wrench className="w-4 h-4" />}
            onClick={maintForm.handleSubmit(d => maintMutation.mutate({ id: (modal as any).tire.id, d }))}>
            Saqlash
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Xizmat turi *</label>
            <select {...maintForm.register('type', { required: true })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg">
              <option value="rotation">Aylanish (rotation)</option>
              <option value="repair">Ta'mirlash</option>
              <option value="inspection">Ko'rik</option>
              <option value="pressure_check">Bosim tekshiruvi</option>
            </select>
          </div>
          <Input label="Sana *" type="date" {...maintForm.register('date', { required: true })} />
          <Input label="Narxi (UZS)" type="number" placeholder="0" min={0} {...maintForm.register('cost')} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg" rows={2}
              {...maintForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== EVENTS / HISTORY MODAL ===== */}
      <Modal open={modal?.type === 'events'} onClose={close}
        title={`Tarix: ${(modal as any)?.tire?.serialCode || ''}`} size="md">
        <div className="space-y-2">
          {/* Tire summary */}
          {modal?.type === 'events' && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 grid grid-cols-3 gap-2 text-xs mb-4">
              {[
                ['Serial', (modal as any).tire.serialCode],
                ['Brand', `${(modal as any).tire.brand} ${(modal as any).tire.model}`],
                ["O'lcham", (modal as any).tire.size],
                ['Narx', formatCurrency(Number((modal as any).tire.purchasePrice))],
                ['Norma', `${((modal as any).tire.standardMileageKm || 40000).toLocaleString()} km`],
                ['Jami km', Number((modal as any).tire.totalMileage || 0).toLocaleString()],
              ].map(([k, v]) => (
                <div key={k} className="text-center">
                  <p className="text-gray-400">{k}</p>
                  <p className="font-bold text-gray-900 dark:text-white">{v}</p>
                </div>
              ))}
            </div>
          )}
          {!eventsData ? (
            <div className="py-8 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : eventsData.length === 0 ? (
            <p className="text-center text-gray-400 py-8">Hali voqealar yo'q</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {eventsData.map((ev: any) => {
                const icons: Record<string, React.ReactNode> = {
                  purchased: <Package className="w-4 h-4 text-blue-500" />,
                  installed: <ArrowDown className="w-4 h-4 text-green-500" />,
                  removed: <ArrowUp className="w-4 h-4 text-yellow-500" />,
                  returned: <RotateCcw className="w-4 h-4 text-orange-500" />,
                  written_off: <ShieldAlert className="w-4 h-4 text-red-500" />,
                  deduction_applied: <DollarSign className="w-4 h-4 text-purple-500" />,
                }
                const labels: Record<string, string> = {
                  purchased: 'Sotib olindi', installed: "O'rnatildi",
                  removed: 'Olib olindi', returned: 'Qaytarildi',
                  written_off: 'Chiqarildi', deduction_applied: 'Ushlab qolindi',
                }
                return (
                  <div key={ev.id} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                    <div className="mt-0.5">{icons[ev.eventType] || <History className="w-4 h-4 text-gray-400" />}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 dark:text-white">{labels[ev.eventType] || ev.eventType}</p>
                      {ev.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ev.notes}</p>}
                      {ev.mileageAtEvent && <p className="text-xs text-blue-500">{ev.mileageAtEvent.toLocaleString()} km</p>}
                    </div>
                    <p className="text-xs text-gray-400 flex-shrink-0">{formatDate(ev.createdAt)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* ===== DEDUCTIONS MODAL ===== */}
      <Modal open={modal?.type === 'deductions'} onClose={close}
        title="Ushlab qolishlar — haydovchi ish haqidan" size="xl">
        <div className="space-y-3">
          {deductionsLoading ? (
            <div className="py-8 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : (deductionsData?.data || []).length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>Barcha ushlab qolishlar to'langan</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {(deductionsData?.data || []).map((d: any) => (
                <div key={d.id} className={`p-4 rounded-xl border ${d.isSettled ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono font-bold text-sm text-blue-700 dark:text-blue-400">{d.tire?.serialCode}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{d.tire?.brand} {d.tire?.model} {d.tire?.size}</p>
                        {d.isSettled
                          ? <Badge variant="success">To'langan</Badge>
                          : <Badge variant="danger">To'lanmagan</Badge>}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        Haydovchi: <span className="font-medium">{d.driverName || '—'}</span>
                      </p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        <span>Norma: <b>{d.standardMileageKm.toLocaleString()} km</b></span>
                        <span>Yurgan: <b>{d.actualMileageKm.toLocaleString()} km</b></span>
                        <span>Qolgan: <b className="text-red-600">{d.remainingMileageKm.toLocaleString()} km</b></span>
                        <span>1 km: <b>{formatCurrency(Number(d.deductionPerKm))}</b></span>
                      </div>
                      <p className="text-base font-bold text-red-700 dark:text-red-400 mt-1">
                        Ushlab qolish: {formatCurrency(Number(d.deductionAmount))}
                      </p>
                      {d.reason && <p className="text-xs text-gray-400 mt-0.5">Sabab: {d.reason}</p>}
                    </div>
                    {!d.isSettled && hasRole('admin', 'manager') && (
                      <Button size="sm" icon={<CheckCircle className="w-3.5 h-3.5" />}
                        loading={settleMutation.isPending}
                        onClick={() => settleMutation.mutate(d.id)}>
                        To'landi
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
