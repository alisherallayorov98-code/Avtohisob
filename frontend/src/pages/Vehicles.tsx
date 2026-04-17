import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, Search, ArrowRightLeft, Eye, AlertCircle, AlertTriangle, Car, Wrench, XCircle, CheckCircle2, ChevronsUpDown, ChevronUp, ChevronDown as ChevronDownIcon, Satellite } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { FUEL_TYPES, VEHICLE_STATUS } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import ErrorAlert from '../components/ui/ErrorAlert'
import { useAuthStore } from '../stores/authStore'
import { Link } from 'react-router-dom'
import { useDebounce } from '../hooks/useDebounce'

const statusColors: Record<string, any> = { active: 'success', maintenance: 'warning', inactive: 'danger' }
const fuelColors: Record<string, any> = { petrol: 'info', diesel: 'warning', gas: 'success', electric: 'default' }

interface Vehicle {
  id: string
  registrationNumber: string
  brand: string
  model: string
  year: number
  fuelType: string
  status: string
  mileage: number
  engineHours?: number | null
  lastGpsSignal?: string | null
  branch: { id: string; name: string }
  purchaseDate: string
  notes?: string
  insuranceExpiry?: string | null
  techInspectionExpiry?: string | null
}

function GpsBadge({ lastGpsSignal }: { lastGpsSignal?: string | null }) {
  if (!lastGpsSignal) return null
  const hoursAgo = (Date.now() - new Date(lastGpsSignal).getTime()) / 3600000
  const isRecent = hoursAgo < 24
  return (
    <span title={`GPS signal: ${new Date(lastGpsSignal).toLocaleString('uz-UZ')}`}
      className={`inline-flex items-center gap-0.5 ${isRecent ? 'text-green-500' : 'text-gray-400'}`}>
      <Satellite className="w-3.5 h-3.5" />
    </span>
  )
}

interface VehicleForm {
  registrationNumber: string
  brand: string
  model: string
  year: string
  fuelType: string
  branchId: string
  purchaseDate: string
  mileage: string
  status: string
  notes: string
  insuranceExpiry: string
  techInspectionExpiry: string
}

function docExpiryStatus(expiry?: string | null): 'danger' | 'warning' | 'ok' | null {
  if (!expiry) return null
  const days = Math.ceil((new Date(expiry).getTime() - Date.now()) / 86400000)
  if (days < 0) return 'danger'
  if (days <= 7) return 'danger'
  if (days <= 30) return 'warning'
  return 'ok'
}

export default function Vehicles() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [statusFilter, setStatusFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [fuelTypeFilter, setFuelTypeFilter] = useState('')
  const [sortBy, setSortBy] = useState('')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (col: string) => {
    if (sortBy === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortBy(col); setSortDir('asc') }
    setPage(1)
  }
  const SortIcon = ({ col }: { col: string }) => {
    if (sortBy !== col) return <ChevronsUpDown className="w-3 h-3 text-gray-400 ml-1 inline" />
    return sortDir === 'asc' ? <ChevronUp className="w-3 h-3 text-blue-500 ml-1 inline" /> : <ChevronDownIcon className="w-3 h-3 text-blue-500 ml-1 inline" />
  }
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [transferModal, setTransferModal] = useState<Vehicle | null>(null)
  const [transferBranchId, setTransferBranchId] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['vehicles', page, limit, debouncedSearch, statusFilter, branchFilter, fuelTypeFilter, sortBy, sortDir],
    queryFn: () => api.get('/vehicles', { params: { page, limit, search: debouncedSearch || undefined, status: statusFilter || undefined, branchId: branchFilter || undefined, fuelType: fuelTypeFilter || undefined, sortBy: sortBy || undefined, sortDir: sortBy ? sortDir : undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


  // Aggregated stats — bitta groupBy so'rovi (backend /vehicles/stats)
  const { data: statsData } = useQuery({
    queryKey: ['vehicles', 'stats', branchFilter],
    queryFn: () => api.get('/vehicles/stats', { params: { branchId: branchFilter || undefined } })
      .then(r => r.data.data as { total: number; active: number; maintenance: number; inactive: number }),
    staleTime: 30000,
  })

  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: dueIntervals } = useQuery({
    queryKey: ['service-intervals-due'],
    queryFn: () => api.get('/service-intervals/due').then(r => r.data as any[]),
    staleTime: 60000,
  })
  const dueMap = (dueIntervals || []).reduce<Record<string, { overdue: number; due_soon: number }>>((acc, i) => {
    if (!acc[i.vehicleId]) acc[i.vehicleId] = { overdue: 0, due_soon: 0 }
    if (i.status === 'overdue') acc[i.vehicleId].overdue++
    else if (i.status === 'due_soon') acc[i.vehicleId].due_soon++
    return acc
  }, {})

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<VehicleForm>()

  const saveMutation = useMutation({
    mutationFn: (body: VehicleForm) => selectedVehicle
      ? api.put(`/vehicles/${selectedVehicle.id}`, body)
      : api.post('/vehicles', body),
    onSuccess: () => {
      toast.success(selectedVehicle ? 'Avtomashina yangilandi' : "Avtomashina qo'shildi")
      qc.invalidateQueries({ queryKey: ['vehicles'] })
      setModalOpen(false)
      reset()
      setSelectedVehicle(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato yuz berdi'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/vehicles/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['vehicles'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const transferMutation = useMutation({
    mutationFn: ({ id, toBranchId }: { id: string; toBranchId: string }) =>
      api.post(`/vehicles/${id}/transfer`, { toBranchId }),
    onSuccess: (res) => {
      toast.success(res.data.message || "Ko'chirildi")
      qc.invalidateQueries({ queryKey: ['vehicles'] })
      setTransferModal(null)
      setTransferBranchId('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openAdd = () => { reset(); setSelectedVehicle(null); setModalOpen(true) }
  const openEdit = (v: Vehicle) => {
    setSelectedVehicle(v)
    setValue('registrationNumber', v.registrationNumber)
    setValue('brand', v.brand)
    setValue('model', v.model)
    setValue('year', String(v.year))
    setValue('fuelType', v.fuelType)
    setValue('branchId', v.branch.id)
    setValue('purchaseDate', v.purchaseDate.split('T')[0])
    setValue('mileage', String(v.mileage))
    setValue('status', v.status)
    setValue('notes', v.notes || '')
    setValue('insuranceExpiry', v.insuranceExpiry ? v.insuranceExpiry.split('T')[0] : '')
    setValue('techInspectionExpiry', v.techInspectionExpiry ? v.techInspectionExpiry.split('T')[0] : '')
    setModalOpen(true)
  }

  const columns = [
    {
      key: 'registrationNumber', render: (v: Vehicle) => <span className="font-mono font-medium text-gray-900 dark:text-white">{v.registrationNumber}</span>,
      title: <button onClick={() => handleSort('registrationNumber')} className="flex items-center hover:text-blue-600">Raqam<SortIcon col="registrationNumber" /></button>,
    },
    {
      key: 'brand', render: (v: Vehicle) => <span>{v.brand} {v.model} <span className="text-gray-400 text-xs">({v.year})</span></span>,
      title: <button onClick={() => handleSort('brand')} className="flex items-center hover:text-blue-600">Model<SortIcon col="brand" /></button>,
    },
    { key: 'fuelType', title: 'Yoqilg\'i', render: (v: Vehicle) => <Badge variant={fuelColors[v.fuelType]}>{FUEL_TYPES[v.fuelType]}</Badge> },
    { key: 'status', title: 'Holat', render: (v: Vehicle) => <Badge variant={statusColors[v.status]}>{VEHICLE_STATUS[v.status]}</Badge> },
    { key: 'branch', title: 'Filial', render: (v: Vehicle) => <span className="text-sm text-gray-600 dark:text-gray-300">{v.branch?.name || '—'}</span> },
    {
      key: 'mileage',
      render: (v: Vehicle) => (
        <div className="flex items-center gap-1.5">
          <span>{Number(v.mileage).toLocaleString()} km</span>
          <GpsBadge lastGpsSignal={v.lastGpsSignal} />
        </div>
      ),
      title: <button onClick={() => handleSort('mileage')} className="flex items-center hover:text-blue-600">Masofa<SortIcon col="mileage" /></button>,
    },
    {
      key: 'service', title: 'Texnik / Hujjat', render: (v: Vehicle) => {
        const s = dueMap[v.id]
        const ins = docExpiryStatus(v.insuranceExpiry)
        const tech = docExpiryStatus(v.techInspectionExpiry)
        const hasDanger = ins === 'danger' || tech === 'danger'
        const hasWarning = ins === 'warning' || tech === 'warning'
        return (
          <div className="flex flex-col gap-0.5">
            {s?.overdue > 0 && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium"><AlertCircle className="w-3 h-3" />{s.overdue} xizmat o'tgan</span>}
            {!s?.overdue && s?.due_soon > 0 && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-medium"><AlertTriangle className="w-3 h-3" />{s.due_soon} xizmat yaqin</span>}
            {hasDanger && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium"><AlertCircle className="w-3 h-3" />{ins === 'danger' ? "Sug'urta" : ''}{ins === 'danger' && tech === 'danger' ? ' / ' : ''}{tech === 'danger' ? 'Texosmotr' : ''} muddati o'tdi</span>}
            {!hasDanger && hasWarning && <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-orange-100 text-orange-700 rounded-full font-medium"><AlertTriangle className="w-3 h-3" />{ins === 'warning' ? "Sug'urta" : ''}{ins === 'warning' && tech === 'warning' ? ' / ' : ''}{tech === 'warning' ? 'Texosmotr' : ''} tugayapti</span>}
            {!s?.overdue && !s?.due_soon && !hasDanger && !hasWarning && <span className="text-xs text-gray-400">—</span>}
          </div>
        )
      }
    },
    {
      key: 'actions', title: '', render: (v: Vehicle) => (
        <div className="flex items-center gap-1 justify-end">
          <Link to={`/vehicles/${v.id}`}>
            <Button size="sm" variant="ghost" icon={<Eye className="w-4 h-4 text-gray-500" />} />
          </Link>
          {hasRole('admin', 'manager') && (
            <Button size="sm" variant="ghost" title="Filialni o'zgartirish"
              icon={<ArrowRightLeft className="w-4 h-4 text-blue-500" />}
              onClick={() => { setTransferModal(v); setTransferBranchId('') }} />
          )}
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(v)} />
          )}
          {hasRole('admin', 'manager') && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />} onClick={() => setDeleteConfirmId(v.id)} />
          )}
        </div>
      )
    },
  ]

  const branches = (branchesData || []).map((b: any) => ({ value: b.id, label: b.name }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Avtomashinalari</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {statsData?.total ?? data?.meta?.total ?? 0} ta</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/vehicles" params={{ branchId: branchFilter || undefined }} label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={openAdd}>Qo'shish</Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { label: 'Jami transport', value: statsData?.total ?? '—', icon: <Car className="w-4 h-4 text-blue-600" />, color: 'bg-blue-50 dark:bg-blue-900/20 border-blue-100 dark:border-blue-800', onClick: () => { setStatusFilter(''); setPage(1) } },
          { label: 'Faol', value: statsData?.active ?? '—', icon: <CheckCircle2 className="w-4 h-4 text-emerald-600" />, color: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-100 dark:border-emerald-800', onClick: () => { setStatusFilter('active'); setPage(1) } },
          { label: "Ta'mirda", value: statsData?.maintenance ?? '—', icon: <Wrench className="w-4 h-4 text-yellow-600" />, color: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-100 dark:border-yellow-800', onClick: () => { setStatusFilter('maintenance'); setPage(1) } },
          { label: 'Nofaol', value: statsData?.inactive ?? '—', icon: <XCircle className="w-4 h-4 text-red-500" />, color: 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800', onClick: () => { setStatusFilter('inactive'); setPage(1) } },
        ].map(s => (
          <button key={s.label} onClick={s.onClick} className={`rounded-xl border p-4 flex items-center gap-3 text-left transition-all hover:shadow-md ${s.color}`}>
            <div className="w-9 h-9 rounded-lg bg-white dark:bg-gray-800 flex items-center justify-center shadow-sm flex-shrink-0">{s.icon}</div>
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 font-medium">{s.label}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{s.value}</p>
            </div>
          </button>
        ))}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Qidirish (raqam, model, brend)..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => { setSearch(e.target.value) }}
            />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha holatlar</option>
            {Object.entries(VEHICLE_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={fuelTypeFilter} onChange={e => { setFuelTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha yoqilg'i</option>
            {Object.entries(FUEL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha filiallar</option>
            {(branchesData || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
        </div>

        {isError ? (
          <ErrorAlert error={error} onRetry={() => refetch()} fallback="Avtomobillar ro'yxatini yuklab bo'lmadi" />
        ) : (
          <>
            <Table columns={columns} data={data?.data || []} loading={isLoading} />
            <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
          </>
        )}
      </div>

      {/* Transfer Modal */}
      <Modal
        open={!!transferModal}
        onClose={() => { setTransferModal(null); setTransferBranchId('') }}
        title="Mashinani boshqa filialga ko'chirish"
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setTransferModal(null)}>Bekor qilish</Button>
            <Button
              loading={transferMutation.isPending}
              disabled={!transferBranchId}
              onClick={() => transferMutation.mutate({ id: transferModal!.id, toBranchId: transferBranchId })}
            >
              Ko'chirish
            </Button>
          </>
        }
      >
        {transferModal && (
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p className="text-xs text-gray-500 dark:text-gray-400">Mashina</p>
              <p className="font-semibold text-gray-900 dark:text-white">{transferModal.registrationNumber} — {transferModal.brand} {transferModal.model}</p>
              <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                Hozirgi filial: <span className="font-medium text-blue-600">{transferModal.branch?.name}</span>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yangi filial *</label>
              <select
                value={transferBranchId}
                onChange={e => setTransferBranchId(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="">— Filial tanlang —</option>
                {(branchesData || [])
                  .filter((b: any) => b.id !== transferModal.branch?.id)
                  .map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSelectedVehicle(null); reset() }}
        title={selectedVehicle ? 'Avtomashina tahrirlash' : "Avtomashina qo'shish"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Davlat raqami *" placeholder="01 A 123 BC" error={errors.registrationNumber?.message}
            {...register('registrationNumber', { required: 'Talab qilinadi' })} />
          <Input label="Brend *" placeholder="Toyota, Chevrolet..." error={errors.brand?.message}
            {...register('brand', { required: 'Talab qilinadi' })} />
          <Input label="Model *" placeholder="Cobalt, Nexia..." error={errors.model?.message}
            {...register('model', { required: 'Talab qilinadi' })} />
          <Input label="Yili *" type="number" placeholder="2020" error={errors.year?.message}
            {...register('year', { required: 'Talab qilinadi', min: { value: 1990, message: "Min 1990" }, max: { value: new Date().getFullYear(), message: "Kelajak emas" } })} />
          <Select label="Yoqilg'i turi *" options={Object.entries(FUEL_TYPES).map(([k, v]) => ({ value: k, label: v }))} placeholder="Tanlang"
            error={errors.fuelType?.message} {...register('fuelType', { required: 'Talab qilinadi' })} />
          <Select label="Filial *" options={branches} placeholder="Tanlang"
            error={errors.branchId?.message} {...register('branchId', { required: 'Talab qilinadi' })} />
          <Input label="Sotib olingan sana *" type="date" error={errors.purchaseDate?.message}
            {...register('purchaseDate', { required: 'Talab qilinadi' })} />
          <Input label="Haydash masofasi (km)" type="number" placeholder="0" {...register('mileage')} />
          <Select label="Holat" options={Object.entries(VEHICLE_STATUS).map(([k, v]) => ({ value: k, label: v }))}
            {...register('status')} />
          <Input label="Sug'urta muddati tugashi" type="date" {...register('insuranceExpiry')} />
          <Input label="Texosmotr muddati tugashi" type="date" {...register('techInspectionExpiry')} />
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-gray-700">Izohlar</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Transportni o'chirish"
        message="Bu transportni o'chirishni tasdiqlaysizmi? Bu amal qaytarilmaydi."
        confirmLabel="Ha, o'chirish"
        loading={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(deleteConfirmId!); setDeleteConfirmId(null) }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
