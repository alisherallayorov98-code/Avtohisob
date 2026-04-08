import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, AlertTriangle, Package, TrendingDown } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatCurrency, formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import SearchableSelect from '../components/ui/SearchableSelect'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'

interface InventoryItem {
  id: string
  quantityOnHand: number
  quantityReserved: number
  reorderLevel: number
  lastRestockDate?: string
  sparePart: { id: string; name: string; partCode: string; category: string; unitPrice: number }
  branch: { id: string; name: string }
}

interface AddStockForm {
  sparePartId: string
  branchId: string
  quantity: string
  reorderLevel: string
}

export default function Inventory() {
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()
  const [page, setPage] = useState(1)
  const [branchFilter, setBranchFilter] = useState(user?.branchId || '')
  const [showLowStock, setShowLowStock] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', page, branchFilter, showLowStock],
    queryFn: () => api.get('/inventory', { params: { page, limit: 20, branchId: branchFilter || undefined, lowStock: showLowStock ? 'true' : undefined } }).then(r => r.data),
  })

  const { data: lowStockData } = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => api.get('/inventory/low-stock').then(r => r.data.data),
  })

  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AddStockForm>()
  const selectedSparePartId = watch('sparePartId', '')

  const addStockMutation = useMutation({
    mutationFn: (body: AddStockForm) => api.post('/inventory/add', body),
    onSuccess: () => {
      toast.success('Ombor yangilandi')
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['low-stock'] })
      setModalOpen(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    { key: 'sparePart', title: 'Ehtiyot qism', render: (i: InventoryItem) => (
      <div><p className="font-medium">{i.sparePart.name}</p><p className="text-xs text-gray-400 font-mono">{i.sparePart.partCode}</p></div>
    )},
    { key: 'branch', title: 'Filial', render: (i: InventoryItem) => i.branch?.name },
    { key: 'quantityOnHand', title: 'Omborda', render: (i: InventoryItem) => (
      <div className="flex items-center gap-2">
        <span className={`font-bold text-lg ${i.quantityOnHand <= i.reorderLevel ? 'text-red-600' : 'text-gray-900'}`}>{i.quantityOnHand}</span>
        {i.quantityOnHand <= i.reorderLevel && <AlertTriangle className="w-4 h-4 text-red-500" />}
      </div>
    )},
    { key: 'reorderLevel', title: 'Min daraja', render: (i: InventoryItem) => i.reorderLevel },
    { key: 'status', title: 'Holat', render: (i: InventoryItem) => (
      <Badge variant={i.quantityOnHand <= i.reorderLevel ? 'danger' : i.quantityOnHand <= i.reorderLevel * 1.5 ? 'warning' : 'success'}>
        {i.quantityOnHand <= i.reorderLevel ? 'Kam qoldi' : 'Normal'}
      </Badge>
    )},
    { key: 'value', title: 'Qiymati', render: (i: InventoryItem) => formatCurrency(i.quantityOnHand * Number(i.sparePart.unitPrice)) },
    { key: 'lastRestockDate', title: 'Oxirgi to\'ldirish', render: (i: InventoryItem) => i.lastRestockDate ? formatDate(i.lastRestockDate) : '-' },
  ]

  const branches = (branchesData || []).map((b: any) => ({ value: b.id, label: b.name }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ombor</h1>
          <p className="text-gray-500 text-sm">
            {(lowStockData || []).length > 0 && <span className="text-red-500 font-medium">{(lowStockData || []).length} ta kam qolgan</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/inventory" params={{ branchId: branchFilter || undefined }} label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>Kirim</Button>
          )}
        </div>
      </div>

      {(lowStockData || []).length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-800">Ogohlantirish: {(lowStockData || []).length} ta ehtiyot qism kam qoldi</p>
            <p className="text-sm text-red-600">{(lowStockData || []).slice(0, 3).map((i: any) => i.sparePart?.name || i.spare_part_name).join(', ')}{(lowStockData || []).length > 3 ? ` va yana ${(lowStockData || []).length - 3} ta` : ''}</p>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex flex-col sm:flex-row gap-3">
          {!user?.branchId && (
            <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Barcha filiallar</option>
              {branches.map((b: { value: string; label: string }) => <option key={b.value} value={b.value}>{b.label}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showLowStock} onChange={e => { setShowLowStock(e.target.checked); setPage(1) }} className="rounded" />
            <span className="text-sm text-gray-600">Faqat kam qolganlar</span>
          </label>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={20} onPageChange={setPage} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ombor kirim" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={addStockMutation.isPending} onClick={handleSubmit(d => addStockMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-4">
          <SearchableSelect
            label="Ehtiyot qism *"
            options={spareParts}
            value={selectedSparePartId}
            onChange={val => setValue('sparePartId', val, { shouldValidate: true })}
            placeholder="Nom yoki kod bilan izlang..."
            error={errors.sparePartId?.message}
          />
          <input type="hidden" {...register('sparePartId', { required: 'Talab qilinadi' })} />
          <Select label="Filial *" options={branches} placeholder="Tanlang" error={errors.branchId?.message}
            {...register('branchId', { required: 'Talab qilinadi' })} />
          <Input label="Miqdor *" type="number" placeholder="0" error={errors.quantity?.message}
            {...register('quantity', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
          <Input label="Minimal daraja" type="number" placeholder="5" {...register('reorderLevel')} hint="Shu miqdordan kam bo'lganda ogohlantirish beriladi" />
        </div>
      </Modal>
    </div>
  )
}
