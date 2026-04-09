import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Wrench, Trash2, DollarSign, Package, ClipboardList, Search, Edit2, BarChart2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts'
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
import ConfirmDialog from '../components/ui/ConfirmDialog'
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
const PIE_COLORS = ['#3B82F6', '#EF4444', '#F59E0B', '#8B5CF6', '#6B7280', '#10B981']

export default function Maintenance() {
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()
  const isAdmin = hasRole('admin', 'super_admin', 'manager')
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<MaintenanceRecord | null>(null)
  const [showChart, setShowChart] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const effectiveBranch = ['branch_manager', 'operator'].includes(user?.role || '') ? (user?.branchId || '') : branchFilter

  const params = {
    page, limit,
    search: search || undefined,
    vehicleId: vehicleFilter || undefined,
    category: categoryFilter || undefined,
    branchId: effectiveBranch || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', params],
    queryFn: () => api.get('/maintenance', { params }).then(r => r.data),
  })

  const { data: statsData } = useQuery({
    queryKey: ['maintenance-stats', vehicleFilter, effectiveBranch, fromDate, toDate],
    queryFn: () => api.get('/maintenance/stats', {
      params: { vehicleId: vehicleFilter || undefined, branchId: effectiveBranch || undefined, from: fromDate || undefined, to: toDate || undefined }
    }).then(r => r.data.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200, branchId: effectiveBranch || undefined } }).then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
    enabled: isAdmin,
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<MaintenanceForm>()

  const openAdd = () => { reset(); setEditRecord(null); setModalOpen(true) }
  const openEdit = (r: MaintenanceRecord) => {
    setEditRecord(r)
    setValue('vehicleId', r.vehicleId)
    setValue('sparePartId', r.sparePart.id)
    setValue('quantityUsed', String(r.quantityUsed))
    setValue('cost', String(r.cost))
    setValue('installationDate', r.installationDate.slice(0, 16))
    setValue('notes', r.notes || '')
    setModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: (body: MaintenanceForm) => editRecord
      ? api.put(`/maintenance/${editRecord.id}`, body)
      : api.post('/maintenance', body),
    onSuccess: () => {
      toast.success(editRecord ? 'Yozuv yangilandi' : "Ehtiyot qism o'rnatish qayd etildi")
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      setModalOpen(false); reset(); setEditRecord(null)
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
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Pie data from stats
  const pieCatData = Object.entries(statsData?.byCategory || {}).map(([name, val]: any) => ({
    name: CATEGORY_LABELS[name] || name,
    value: Math.round(Number(val)),
  })).filter(d => d.value > 0)

  const columns = [
    { key: 'vehicle', title: 'Avtomashina', render: (r: MaintenanceRecord) => (
      <Link to={`/vehicles/${r.vehicle?.id}`} className="hover:text-blue-600 dark:hover:text-blue-400">
        <p className="font-mono font-medium text-gray-900 dark:text-white">{r.vehicle?.registrationNumber}</p>
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
    { key: 'cost', title: 'Narxi', render: (r: MaintenanceRecord) => <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(Number(r.cost))}</span> },
    { key: 'installationDate', title: 'Sana', render: (r: MaintenanceRecord) => <span className="text-sm text-gray-500">{formatDate(r.installationDate)}</span> },
    { key: 'performedBy', title: 'Bajardi', render: (r: MaintenanceRecord) => <span className="text-sm text-gray-600 dark:text-gray-300">{r.performedBy?.fullName}</span> },
    { key: 'supplier', title: 'Yetkazuvchi', render: (r: MaintenanceRecord) => r.supplier?.name
      ? <span className="text-xs text-gray-500">{r.supplier.name}</span>
      : <span className="text-gray-300 text-xs">—</span>
    },
    { key: 'notes', title: 'Izoh', render: (r: MaintenanceRecord) => r.notes
      ? <span className="text-xs text-gray-500 dark:text-gray-400 italic line-clamp-1 max-w-28">{r.notes}</span>
      : <span className="text-gray-300 text-xs">—</span>
    },
    {
      key: 'actions', title: '', render: (r: MaintenanceRecord) => (
        <div className="flex items-center gap-1 justify-end">
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button size="sm" variant="ghost" icon={<Edit2 className="w-3.5 h-3.5 text-blue-500" />} onClick={() => openEdit(r)} />
          )}
          {hasRole('admin', 'manager') && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="w-3.5 h-3.5 text-red-500" />}
              onClick={() => setDeleteConfirmId(r.id)} />
          )}
        </div>
      )
    },
  ]

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}` }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))
  const suppliers = [{ value: '', label: "Yetkazuvchi yo'q" }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]

  const hasFilter = search || vehicleFilter || categoryFilter || fromDate || toDate || branchFilter
  const clearAll = () => { setSearch(''); setVehicleFilter(''); setCategoryFilter(''); setFromDate(''); setToDate(''); setBranchFilter(''); setPage(1) }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Texnik Xizmat</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta yozuv</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowChart(v => !v)}
            className={`p-2 rounded-lg border transition-colors ${showChart ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50'}`}
            title="Grafik"
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          <ExcelExportButton endpoint="/exports/maintenance" label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={openAdd}>Qayd etish</Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-blue-100 dark:border-blue-900/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <DollarSign className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Jami xarajat</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(statsData?.totalCost || 0)}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-purple-100 dark:border-purple-900/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Jami qismlar</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData?.totalParts ?? 0} ta</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-green-100 dark:border-green-900/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <ClipboardList className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Yozuvlar soni</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData?.count ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Category pie chart (toggle) */}
      {showChart && pieCatData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">Kategoriya bo'yicha xarajat</h3>
          <div className="h-48">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={pieCatData} dataKey="value" cx="50%" cy="50%" outerRadius={70} innerRadius={35} paddingAngle={3}>
                  {pieCatData.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v: any) => formatCurrency(Number(v))} contentStyle={{ backgroundColor: '#111827', border: '1px solid #374151', borderRadius: '8px', color: '#f9fafb', fontSize: 12 }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Filters + Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap items-center">
          {/* Text search */}
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Qism nomi yoki avtomobil raqami..."
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Vehicle filter */}
          <div className="min-w-48">
            <SearchableSelect
              options={[{ value: '', label: 'Barcha avtomashinalari' }, ...vehicles]}
              value={vehicleFilter}
              onChange={v => { setVehicleFilter(v); setPage(1) }}
              placeholder="Avtomashina..."
            />
          </div>

          {/* Category */}
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha kategoriyalar</option>
            {PART_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>

          {/* Branch (admin only) */}
          {isAdmin && (
            <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Barcha filiallar</option>
              {((branchesData as any[]) || []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          )}

          {/* Date range */}
          <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />

          {hasFilter && (
            <button onClick={clearAll} className="px-3 py-2 text-xs text-red-500 hover:text-red-700 rounded-lg border border-red-200 hover:border-red-300 whitespace-nowrap">
              Tozalash
            </button>
          )}
        </div>

        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditRecord(null); reset() }}
        title={editRecord ? 'Yozuvni tahrirlash' : "Ehtiyot qism o'rnatish qayd etish"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>Saqlash</Button>
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

      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Ta'mirlash yozuvini o'chirish"
        message="O'chirilsa ombor miqdori qaytariladi. Davom etasizmi?"
        confirmLabel="Ha, o'chirish"
        loading={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(deleteConfirmId!); setDeleteConfirmId(null) }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
