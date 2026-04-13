import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, ShieldCheck, ShieldAlert, ShieldOff, Calendar, Trash2, Search } from 'lucide-react'
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
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'

const PART_TYPES = [
  { value: 'tire', label: 'Avtoshina' },
  { value: 'spare_part', label: 'Ehtiyot qism' },
  { value: 'battery', label: 'Batareya' },
  { value: 'vehicle', label: 'Avtomobil' },
  { value: 'other', label: 'Boshqa' },
]

const statusColors: Record<string, any> = {
  active: 'success', expiring_soon: 'warning', expired: 'danger', claimed: 'secondary'
}
const statusLabels: Record<string, string> = {
  active: 'Faol', expiring_soon: 'Tugayapti', expired: 'Tugagan', claimed: 'Ishlatilgan'
}

interface WarrantyForm {
  partType: string; partName: string; partId: string
  vehicleId: string; startDate: string; endDate: string
  mileageLimit: string; coverageType: string; provider: string; notes: string
}

export default function Warranties() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [statusFilter, setStatusFilter] = useState('')
  const [partTypeFilter, setPartTypeFilter] = useState('')
  const [addModal, setAddModal] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { register: reg, handleSubmit, reset, watch: watchW, setValue: setValW, formState: { errors } } = useForm<WarrantyForm>({
    defaultValues: { coverageType: 'full', partType: 'tire' }
  })

  const { data: stats } = useQuery({
    queryKey: ['warranty-stats'],
    queryFn: () => api.get('/warranties/stats').then(r => r.data.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['warranties', page, limit, debouncedSearch, statusFilter, partTypeFilter],
    queryFn: () => api.get('/warranties', { params: { page, limit, search: debouncedSearch || undefined, status: statusFilter || undefined, partType: partTypeFilter || undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-for-warranties'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (d: WarrantyForm) => api.post('/warranties', d),
    onSuccess: () => {
      toast.success("Kafolat qo'shildi")
      qc.invalidateQueries({ queryKey: ['warranties'] })
      qc.invalidateQueries({ queryKey: ['warranty-stats'] })
      setAddModal(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/warranties/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi")
      qc.invalidateQueries({ queryKey: ['warranties'] })
      qc.invalidateQueries({ queryKey: ['warranty-stats'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    {
      key: 'partName', title: 'Qism', render: (w: any) => (
        <div>
          <p className="font-medium text-gray-900 dark:text-white">{w.partName}</p>
          <p className="text-xs text-gray-500">{PART_TYPES.find(t => t.value === w.partType)?.label || w.partType}</p>
        </div>
      )
    },
    {
      key: 'vehicle', title: 'Avtomobil', render: (w: any) => w.vehicle
        ? <span className="font-mono text-sm">{w.vehicle.registrationNumber}</span>
        : <span className="text-gray-400 text-sm">—</span>
    },
    {
      key: 'period', title: 'Muddat', render: (w: any) => (
        <div>
          <p className="text-sm">{formatDate(w.startDate)} — {formatDate(w.endDate)}</p>
          {w.mileageLimit && <p className="text-xs text-gray-500">Max: {Number(w.mileageLimit).toLocaleString()} km</p>}
        </div>
      )
    },
    {
      key: 'daysLeft', title: 'Qolgan kun', render: (w: any) => {
        const days = w.daysLeft
        if (days < 0) return <span className="text-red-500 font-medium text-sm">Tugagan</span>
        if (days <= 30) return <span className="text-yellow-600 font-medium text-sm">{days} kun</span>
        return <span className="text-green-600 font-medium text-sm">{days} kun</span>
      }
    },
    { key: 'coverageType', title: 'Qamrov', render: (w: any) => <span className="capitalize text-sm">{w.coverageType}</span> },
    { key: 'provider', title: 'Kafolat beruvchi', render: (w: any) => <span className="text-sm">{w.provider || '—'}</span> },
    { key: 'status', title: 'Status', render: (w: any) => <Badge variant={statusColors[w.computedStatus || w.status]}>{statusLabels[w.computedStatus || w.status] || w.status}</Badge> },
    {
      key: 'actions', title: '', render: (w: any) => (
        hasRole('admin', 'manager') && (
          <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />}
            onClick={() => setDeleteConfirmId(w.id)} />
        )
      )
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Kafolatlar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Ehtiyot qismlar va avtoshinalar kafolati</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/warranties" label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setAddModal(true) }}>Kafolat qo'shish</Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-xl p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Jami</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{stats.total}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-xl p-4 flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-green-500 mt-1" />
            <div>
              <p className="text-sm text-green-600 dark:text-green-400">Faol</p>
              <p className="text-2xl font-bold text-green-900 dark:text-green-100">{stats.active}</p>
            </div>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 flex items-start gap-3">
            <ShieldAlert className="w-5 h-5 text-yellow-500 mt-1" />
            <div>
              <p className="text-sm text-yellow-600 dark:text-yellow-400">Tugayapti</p>
              <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{stats.expiringSoon}</p>
            </div>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-start gap-3">
            <ShieldOff className="w-5 h-5 text-red-500 mt-1" />
            <div>
              <p className="text-sm text-red-600 dark:text-red-400">Tugagan</p>
              <p className="text-2xl font-bold text-red-900 dark:text-red-100">{stats.expired}</p>
            </div>
          </div>
        </div>
      )}

      {/* Expiring soon alert */}
      {stats?.expiringSoon > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4 flex items-center gap-3">
          <Calendar className="w-5 h-5 text-yellow-500 flex-shrink-0" />
          <p className="text-yellow-800 dark:text-yellow-300 text-sm font-medium">
            <span className="font-bold">{stats.expiringSoon} ta</span> kafolat 30 kun ichida tugaydi
          </p>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap">
          <div className="relative flex-1 min-w-48">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value) }}
              placeholder="Qism nomi yoki avtomobil raqami..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha statuslar</option>
            <option value="active">Faol</option>
            <option value="expiring_soon">Tugayapti</option>
            <option value="expired">Tugagan</option>
            <option value="claimed">Ishlatilgan</option>
          </select>
          <select value={partTypeFilter} onChange={e => { setPartTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha turlar</option>
            {PART_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Add Modal */}
      <Modal open={addModal} onClose={() => { setAddModal(false); reset() }} title="Yangi kafolat qo'shish" size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddModal(false)}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qism turi *</label>
            <select {...reg('partType', { required: true })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              {PART_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
          <Input label="Qism nomi *" placeholder="Michelin 205/55R16 yoki BOSCH filtr" error={errors.partName?.message} {...reg('partName', { required: 'Talab qilinadi' })} />
          <SearchableSelect
            label="Avtomobil"
            options={[{ value: '', label: '— Tanlang —' }, ...(vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))]}
            value={watchW('vehicleId') || ''}
            onChange={v => setValW('vehicleId', v)}
            placeholder="Avtomobil qidiring..."
          />
          <Input label="Kafolat beruvchi" placeholder="Michelin, Bosch..." {...reg('provider')} />
          <Input label="Boshlanish sanasi *" type="date" error={errors.startDate?.message} {...reg('startDate', { required: 'Talab qilinadi' })} />
          <Input label="Tugash sanasi *" type="date" error={errors.endDate?.message} {...reg('endDate', { required: 'Talab qilinadi' })} />
          <Input label="Kilometr chegarasi" type="number" placeholder="50000" min={0} {...reg('mileageLimit')} hint="Km limitdan o'tsa kafolat tugaydi" />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Qamrov turi</label>
            <select {...reg('coverageType')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="full">To'liq</option>
              <option value="limited">Cheklangan</option>
              <option value="partial">Qisman</option>
            </select>
          </div>
          <div className="sm:col-span-2">
            <Input label="Izoh" placeholder="Qo'shimcha ma'lumot..." {...reg('notes')} />
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Kafolatni o'chirish"
        message="Bu kafolat yozuvini o'chirishni tasdiqlaysizmi?"
        confirmLabel="Ha, o'chirish"
        loading={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(deleteConfirmId!); setDeleteConfirmId(null) }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
