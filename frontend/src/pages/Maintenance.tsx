import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Wrench, Trash2, DollarSign, Package, ClipboardList } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { formatCurrency, formatDate, CATEGORY_LABELS, PART_CATEGORIES } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'

interface MaintenanceRecord {
  id: string
  vehicleId: string
  installationDate: string
  quantityUsed: number
  cost: number
  notes?: string
  vehicle: { id: string; registrationNumber: string; brand: string; model: string }
  sparePart: { id: string; name: string; partCode: string; category: string }
  supplier?: { name: string }
  performedBy: { fullName: string }
}

interface MaintenanceForm {
  vehicleId: string
  sparePartId: string
  quantityUsed: string
  installationDate: string
  cost: string
  supplierId: string
  notes: string
}

const categoryColors: Record<string, any> = {
  engine: 'info', brake: 'danger', suspension: 'warning', electrical: 'secondary', body: 'default', other: 'default'
}

export default function Maintenance() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const params = {
    page, limit,
    vehicleId: vehicleFilter || undefined,
    category: categoryFilter || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', page, limit, vehicleFilter, categoryFilter, fromDate, toDate],
    queryFn: () => api.get('/maintenance', { params }).then(r => r.data),
  })

  const { data: statsData } = useQuery({
    queryKey: ['maintenance-stats', vehicleFilter, fromDate, toDate],
    queryFn: () => api.get('/maintenance/stats', { params: { vehicleId: vehicleFilter || undefined, from: fromDate || undefined, to: toDate || undefined } }).then(r => r.data.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<MaintenanceForm>()

  const createMutation = useMutation({
    mutationFn: (body: MaintenanceForm) => api.post('/maintenance', body),
    onSuccess: () => {
      toast.success("Ehtiyot qism o'rnatish qayd etildi")
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setModalOpen(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/maintenance/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi, ombor miqdori qaytarildi")
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    { key: 'vehicle', title: 'Avtomashina', render: (r: MaintenanceRecord) => (
      <Link to={`/vehicles/${r.vehicle?.id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
        <p className="font-medium text-gray-900 dark:text-white">{r.vehicle?.registrationNumber}</p>
        <p className="text-xs text-gray-400">{r.vehicle?.brand} {r.vehicle?.model}</p>
      </Link>
    )},
    { key: 'sparePart', title: 'Ehtiyot qism', render: (r: MaintenanceRecord) => (
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{r.sparePart?.name}</p>
        <p className="text-xs font-mono text-gray-400">{r.sparePart?.partCode}</p>
      </div>
    )},
    { key: 'category', title: 'Kategoriya', render: (r: MaintenanceRecord) => (
      <Badge variant={categoryColors[r.sparePart?.category] || 'default'}>
        {CATEGORY_LABELS[r.sparePart?.category] || r.sparePart?.category}
      </Badge>
    )},
    { key: 'quantityUsed', title: 'Miqdor', render: (r: MaintenanceRecord) => <span className="text-sm">{r.quantityUsed} ta</span> },
    { key: 'cost', title: 'Narxi', render: (r: MaintenanceRecord) => <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(Number(r.cost))}</span> },
    { key: 'installationDate', title: 'Sana', render: (r: MaintenanceRecord) => formatDate(r.installationDate) },
    { key: 'performedBy', title: 'Bajardi', render: (r: MaintenanceRecord) => <span className="text-sm text-gray-600 dark:text-gray-300">{r.performedBy?.fullName}</span> },
    { key: 'notes', title: 'Izoh', render: (r: MaintenanceRecord) => r.notes
      ? <span className="text-xs text-gray-500 dark:text-gray-400 italic line-clamp-1 max-w-32">{r.notes}</span>
      : <span className="text-gray-300 text-xs">—</span>
    },
    {
      key: 'actions', title: '', render: (r: MaintenanceRecord) => hasRole('admin', 'manager') ? (
        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />}
          onClick={() => { if (confirm("O'chirilsinmi? Ombor miqdori qaytariladi.")) deleteMutation.mutate(r.id) }} />
      ) : null
    },
  ]

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}` }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))
  const suppliers = [{ value: '', label: "Yetkazuvchi yo'q" }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Texnik Xizmat</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta yozuv</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/maintenance" label="Excel" />
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>Qayd etish</Button>
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jami xarajat</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(statsData.totalCost)}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <Package className="w-8 h-8 text-purple-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jami qismlar</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData.totalParts} ta</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <ClipboardList className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Yozuvlar soni</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData.count}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <SearchableSelect
              options={[{ value: '', label: 'Barcha avtomashinalari' }, ...vehicles]}
              value={vehicleFilter}
              onChange={v => { setVehicleFilter(v); setPage(1) }}
              placeholder="Avtomashina bo'yicha filter..."
            />
          </div>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha kategoriyalar</option>
            {PART_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(''); setToDate(''); setPage(1) }}
              className="px-3 py-2 text-sm text-red-500 hover:text-red-700 rounded-lg border border-red-200 hover:border-red-300">
              Tozalash
            </button>
          )}
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ehtiyot qism o'rnatish qayd etish" size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <SearchableSelect label="Avtomashina *" options={vehicles} value={watch('vehicleId') || ''}
              onChange={v => setValue('vehicleId', v, { shouldValidate: true })}
              placeholder="Avtomashina qidiring..." error={errors.vehicleId?.message} />
            <input type="hidden" {...register('vehicleId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label="Ehtiyot qism *" options={spareParts} value={watch('sparePartId') || ''}
              onChange={v => setValue('sparePartId', v, { shouldValidate: true })}
              placeholder="Kod yoki nom bilan qidiring..." error={errors.sparePartId?.message} />
            <input type="hidden" {...register('sparePartId', { required: 'Talab qilinadi' })} />
          </div>
          <Input label="Miqdor *" type="number" placeholder="1" error={errors.quantityUsed?.message}
            {...register('quantityUsed', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
          <Input label="Narxi (so'm) *" type="number" error={errors.cost?.message}
            {...register('cost', { required: 'Talab qilinadi', min: { value: 0, message: 'Manfiy emas' } })} />
          <Input label="O'rnatish sanasi *" type="datetime-local" error={errors.installationDate?.message}
            {...register('installationDate', { required: 'Talab qilinadi' })} />
          <SearchableSelect label="Yetkazuvchi" options={suppliers} value={watch('supplierId') || ''}
            onChange={v => setValue('supplierId', v)} placeholder="Yetkazuvchi qidiring..." />
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Izohlar</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
