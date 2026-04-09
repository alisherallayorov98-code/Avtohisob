import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, Truck, Search, ArrowRightLeft, Eye, AlertCircle, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatDate, FUEL_TYPES, VEHICLE_STATUS } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'
import { Link } from 'react-router-dom'

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
  branch: { id: string; name: string }
  purchaseDate: string
  notes?: string
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
}

export default function Vehicles() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [fuelTypeFilter, setFuelTypeFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedVehicle, setSelectedVehicle] = useState<Vehicle | null>(null)
  const [transferModal, setTransferModal] = useState<Vehicle | null>(null)
  const [transferBranchId, setTransferBranchId] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['vehicles', page, limit, search, statusFilter, branchFilter, fuelTypeFilter],
    queryFn: () => api.get('/vehicles', { params: { page, limit, search: search || undefined, status: statusFilter || undefined, branchId: branchFilter || undefined, fuelType: fuelTypeFilter || undefined } }).then(r => r.data),
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
    setModalOpen(true)
  }

  const columns = [
    { key: 'registrationNumber', title: 'Raqam', render: (v: Vehicle) => <span className="font-mono font-medium text-gray-900">{v.registrationNumber}</span> },
    { key: 'brand', title: 'Model', render: (v: Vehicle) => <span>{v.brand} {v.model} <span className="text-gray-400 text-xs">({v.year})</span></span> },
    { key: 'fuelType', title: 'Yoqilg\'i', render: (v: Vehicle) => <Badge variant={fuelColors[v.fuelType]}>{FUEL_TYPES[v.fuelType]}</Badge> },
    { key: 'status', title: 'Holat', render: (v: Vehicle) => <Badge variant={statusColors[v.status]}>{VEHICLE_STATUS[v.status]}</Badge> },
    { key: 'branch', title: 'Filial', render: (v: Vehicle) => v.branch?.name },
    { key: 'mileage', title: 'Masofa', render: (v: Vehicle) => `${Number(v.mileage).toLocaleString()} km` },
    {
      key: 'service', title: 'Texnik xizmat', render: (v: Vehicle) => {
        const s = dueMap[v.id]
        if (!s) return <span className="text-xs text-gray-400">—</span>
        if (s.overdue > 0) return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded-full font-medium"><AlertCircle className="w-3 h-3" />{s.overdue} muddati o'tgan</span>
        if (s.due_soon > 0) return <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded-full font-medium"><AlertTriangle className="w-3 h-3" />{s.due_soon} yaqinlashmoqda</span>
        return <span className="text-xs text-gray-400">—</span>
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
            <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />} onClick={() => { if (confirm('O\'chirishni tasdiqlaysizmi?')) deleteMutation.mutate(v.id) }} />
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
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/vehicles" params={{ branchId: branchFilter || undefined }} label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={openAdd}>Qo'shish</Button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Qidirish (raqam, model, brend)..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
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

        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
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
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-gray-700">Izohlar</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
