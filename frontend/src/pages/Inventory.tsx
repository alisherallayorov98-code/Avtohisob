import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, AlertTriangle, Package, TrendingDown, DollarSign, Edit2, Search, SlidersHorizontal } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatCurrency, formatDate, PART_CATEGORIES } from '../lib/utils'
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
import { useDebounce } from '../hooks/useDebounce'

interface InventoryItem {
  id: string
  quantityOnHand: number
  quantityReserved: number
  reorderLevel: number
  lastRestockDate?: string
  sparePart: { id: string; name: string; partCode: string; category: string; unitPrice: number; supplier?: { id: string; name: string } }
  branch: { id: string; name: string }
}

interface AddStockForm {
  sparePartId: string
  warehouseId: string
  quantity: string
  reorderLevel: string
}

interface EditForm {
  quantityOnHand: string
  reorderLevel: string
}

interface AdjustForm {
  quantityOnHand: string
  reason: string
}

const categoryLabel: Record<string, string> = {
  engine: 'Dvigatel', brake: 'Tormoz', suspension: 'Osma', electrical: 'Elektr', body: 'Kuzov', other: 'Boshqa',
}

export default function Inventory() {
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [warehouseFilter, setWarehouseFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [showLowStock, setShowLowStock] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['inventory', page, limit, warehouseFilter, categoryFilter, showLowStock, debouncedSearch],
    queryFn: () => api.get('/inventory', {
      params: {
        page, limit,
        warehouseId: warehouseFilter || undefined,
        category: categoryFilter || undefined,
        lowStock: showLowStock ? 'true' : undefined,
        search: debouncedSearch || undefined,
      }
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


  const { data: statsData } = useQuery({
    queryKey: ['inventory-stats', warehouseFilter],
    queryFn: () => api.get('/inventory/stats', { params: { warehouseId: warehouseFilter || undefined } }).then(r => r.data.data),
  })

  const { data: lowStockData } = useQuery({
    queryKey: ['low-stock'],
    queryFn: () => api.get('/inventory/low-stock').then(r => r.data.data),
  })

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AddStockForm>()
  const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit, setValue: setEditValue, formState: { errors: editErrors } } = useForm<EditForm>()
  const { register: regAdjust, handleSubmit: handleAdjust, reset: resetAdjust, setValue: setAdjustValue, formState: { errors: adjustErrors } } = useForm<AdjustForm>()
  const selectedSparePartId = watch('sparePartId', '')

  const addStockMutation = useMutation({
    mutationFn: (body: AddStockForm) => api.post('/inventory/add', body),
    onSuccess: () => {
      toast.success('Ombor yangilandi')
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['low-stock'] })
      setModalOpen(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const editMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: EditForm }) => api.put(`/inventory/${id}`, body),
    onSuccess: () => {
      toast.success('Ombor yangilandi')
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['low-stock'] })
      setEditModalOpen(false); setSelectedItem(null); resetEdit()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const adjustMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: AdjustForm }) => api.post(`/inventory/${id}/adjust`, body),
    onSuccess: () => {
      toast.success('Ombor tuzatildi')
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['low-stock'] })
      setAdjustModalOpen(false); setSelectedItem(null); resetAdjust()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openEdit = (item: InventoryItem) => {
    setSelectedItem(item)
    setEditValue('quantityOnHand', String(item.quantityOnHand))
    setEditValue('reorderLevel', String(item.reorderLevel))
    setEditModalOpen(true)
  }

  const openAdjust = (item: InventoryItem) => {
    setSelectedItem(item)
    setAdjustValue('quantityOnHand', String(item.quantityOnHand))
    setAdjustValue('reason', '')
    setAdjustModalOpen(true)
  }

  const columns = [
    { key: 'sparePart', title: 'Ehtiyot qism', render: (i: InventoryItem) => (
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{i.sparePart.name}</p>
        <p className="text-xs text-gray-400 font-mono">{i.sparePart.partCode}</p>
        {i.sparePart.supplier && <p className="text-xs text-gray-400">{i.sparePart.supplier.name}</p>}
      </div>
    )},
    { key: 'category', title: 'Kategoriya', render: (i: InventoryItem) => (
      <span className="text-sm text-gray-600 dark:text-gray-300">{categoryLabel[i.sparePart.category] || i.sparePart.category}</span>
    )},
    { key: 'warehouse', title: 'Sklad', render: (i: InventoryItem) => (
      <span className="text-sm text-gray-600 dark:text-gray-300">{(i as any).warehouse?.name || '—'}</span>
    )},
    { key: 'quantityOnHand', title: 'Omborda', render: (i: InventoryItem) => (
      <div className="flex items-center gap-2">
        <span className={`font-bold text-lg ${i.quantityOnHand <= i.reorderLevel ? 'text-red-600' : 'text-gray-900 dark:text-white'}`}>{i.quantityOnHand}</span>
        {i.quantityOnHand <= i.reorderLevel && <AlertTriangle className="w-4 h-4 text-red-500" />}
      </div>
    )},
    { key: 'reorderLevel', title: 'Min daraja', render: (i: InventoryItem) => (
      <span className="text-sm text-gray-600 dark:text-gray-300">{i.reorderLevel}</span>
    )},
    { key: 'status', title: 'Holat', render: (i: InventoryItem) => (
      <Badge variant={i.quantityOnHand === 0 ? 'danger' : i.quantityOnHand <= i.reorderLevel ? 'warning' : 'success'}>
        {i.quantityOnHand === 0 ? 'Tugagan' : i.quantityOnHand <= i.reorderLevel ? 'Kam qoldi' : 'Normal'}
      </Badge>
    )},
    { key: 'value', title: 'Qiymati', render: (i: InventoryItem) => formatCurrency(i.quantityOnHand * Number(i.sparePart.unitPrice)) },
    { key: 'lastRestockDate', title: 'Oxirgi to\'ldirish', render: (i: InventoryItem) => (
      <span className="text-sm text-gray-500 dark:text-gray-400">{i.lastRestockDate ? formatDate(i.lastRestockDate) : '—'}</span>
    )},
    {
      key: 'actions', title: '', render: (i: InventoryItem) => (
        <div className="flex items-center gap-1">
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(i)} />
          )}
          {hasRole('admin') && (
            <Button size="sm" variant="ghost" title="Miqdorni tuzatish (admin)"
              icon={<SlidersHorizontal className="w-4 h-4 text-amber-500" />} onClick={() => openAdjust(i)} />
          )}
        </div>
      )
    },
  ]

  const warehouses = (warehousesData || []).filter((w: any) => w.isActive).map((w: any) => ({ value: w.id, label: w.name }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ombor</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta pozitsiya</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/inventory" params={{ warehouseId: warehouseFilter || undefined }} label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>Kirim</Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jami pozitsiya</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData.totalItems}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jami qiymat</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(statsData.totalValue)}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <TrendingDown className="w-8 h-8 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Kam qolgan</p>
              <p className="text-xl font-bold text-yellow-600">{statsData.lowStockCount}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Tugagan</p>
              <p className="text-xl font-bold text-red-600">{statsData.outOfStockCount}</p>
            </div>
          </div>
        </div>
      )}

      {(lowStockData || []).length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">Ogohlantirish: {(lowStockData || []).length} ta ehtiyot qism kam qoldi</p>
            <p className="text-sm text-red-600 dark:text-red-400">
              {(lowStockData || []).slice(0, 3).map((i: any) => i.sparePart?.name).join(', ')}
              {(lowStockData || []).length > 3 ? ` va yana ${(lowStockData || []).length - 3} ta` : ''}
            </p>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Nom yoki kod bo'yicha qidirish..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => { setSearch(e.target.value) }}
            />
          </div>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha kategoriyalar</option>
            {PART_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel[c] || c}</option>)}
          </select>
          {!['branch_manager', 'operator'].includes(user?.role || '') && (
            <select value={warehouseFilter} onChange={e => { setWarehouseFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Barcha skladlar</option>
              {warehouses.map((w: { value: string; label: string }) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showLowStock} onChange={e => { setShowLowStock(e.target.checked); setPage(1) }} className="rounded" />
            <span className="text-sm text-gray-600 dark:text-gray-300">Faqat kam qolganlar</span>
          </label>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Add stock modal */}
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="Ombor kirim" size="md"
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
          <Select label="Sklad *" options={warehouses} placeholder="Tanlang" error={errors.warehouseId?.message}
            {...register('warehouseId', { required: 'Talab qilinadi' })} />
          <Input label="Miqdor *" type="number" placeholder="0" min={0} error={errors.quantity?.message}
            {...register('quantity', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
          <Input label="Minimal daraja" type="number" placeholder="5" min={0} {...register('reorderLevel')}
            hint="Shu miqdordan kam bo'lganda ogohlantirish beriladi" />
        </div>
      </Modal>

      {/* Edit modal */}
      <Modal open={editModalOpen} onClose={() => { setEditModalOpen(false); setSelectedItem(null); resetEdit() }}
        title="Ombor tahrirlash" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setEditModalOpen(false); setSelectedItem(null); resetEdit() }}>Bekor qilish</Button>
            <Button loading={editMutation.isPending} onClick={handleEdit(d => selectedItem && editMutation.mutate({ id: selectedItem.id, body: d }))}>Saqlash</Button>
          </>
        }
      >
        {selectedItem && (
          <div className="space-y-4">
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
              <p className="font-medium text-gray-900 dark:text-white">{selectedItem.sparePart.name}</p>
              <p className="text-xs text-gray-400 font-mono">{selectedItem.sparePart.partCode}</p>
              <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">{(selectedItem as any).warehouse?.name || '—'}</p>
            </div>
            <Input label="Ombordagi miqdor *" type="number" min={0} error={editErrors.quantityOnHand?.message}
              {...regEdit('quantityOnHand', { required: 'Talab qilinadi', min: { value: 0, message: 'Manfiy bo\'lmaydi' } })} />
            <Input label="Minimal daraja *" type="number" min={0} error={editErrors.reorderLevel?.message}
              hint="Shu miqdordan kam bo'lganda ogohlantirish beriladi"
              {...regEdit('reorderLevel', { required: 'Talab qilinadi', min: { value: 0, message: 'Manfiy bo\'lmaydi' } })} />
          </div>
        )}
      </Modal>

      {/* Admin adjust modal */}
      <Modal open={adjustModalOpen} onClose={() => { setAdjustModalOpen(false); setSelectedItem(null); resetAdjust() }}
        title="Miqdorni tuzatish (Admin)" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setAdjustModalOpen(false); setSelectedItem(null); resetAdjust() }}>Bekor qilish</Button>
            <Button loading={adjustMutation.isPending} onClick={handleAdjust(d => selectedItem && adjustMutation.mutate({ id: selectedItem.id, body: d }))}>Tuzatish</Button>
          </>
        }
      >
        {selectedItem && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="font-medium text-gray-900 dark:text-white">{selectedItem.sparePart.name}</p>
              <p className="text-xs text-gray-400 font-mono">{selectedItem.sparePart.partCode} — {selectedItem.branch?.name}</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Hozirgi miqdor: <span className="font-bold">{selectedItem.quantityOnHand} ta</span>
              </p>
            </div>
            <Input label="Yangi miqdor *" type="number" min={0} error={adjustErrors.quantityOnHand?.message}
              {...regAdjust('quantityOnHand', { required: 'Talab qilinadi', min: { value: 0, message: 'Manfiy bo\'lmaydi' } })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tuzatish sababi <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={3}
                placeholder="Masalan: inventarizatsiya natijasida aniqlandi, noto'g'ri kiritilgan..."
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none ${adjustErrors.reason ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
                {...regAdjust('reason', { required: 'Sabab kiritilishi shart' })}
              />
              {adjustErrors.reason && <p className="text-xs text-red-500 mt-1">{adjustErrors.reason.message}</p>}
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
