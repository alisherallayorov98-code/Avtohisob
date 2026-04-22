import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, AlertTriangle, Package, TrendingDown, DollarSign, Edit2, Search, SlidersHorizontal, Trash2, MoveRight } from 'lucide-react'
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
  unitPrice: string
}

interface NewPartForm {
  name: string
  partCode: string
  category: string
  unitPrice: string
  supplierId: string
}

interface EditForm {
  quantityOnHand: string
  reorderLevel: string
}

interface AdjustForm {
  quantityOnHand: string
  reason: string
  newWarehouseId: string
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
  const [newPartMode, setNewPartMode] = useState(false)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<InventoryItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveFrom, setMoveFrom] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [movePreview, setMovePreview] = useState<any[] | null>(null)
  const [moveConfirmed, setMoveConfirmed] = useState(false)

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

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AddStockForm>()
  const { register: regNew, handleSubmit: handleNew, reset: resetNew, formState: { errors: newErrors } } = useForm<NewPartForm>()
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
      qc.invalidateQueries({ queryKey: ['spare-parts'] })
      setModalOpen(false); reset(); setNewPartMode(false); resetNew()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const createAndStockMutation = useMutation({
    mutationFn: async (data: { part: NewPartForm; stock: { warehouseId: string; quantity: string; reorderLevel: string } }) => {
      const fd = new FormData()
      Object.entries(data.part).forEach(([k, v]) => v && fd.append(k, v))
      const partRes = await api.post('/spare-parts', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const sparePartId = partRes.data.data.id
      return api.post('/inventory/add', { sparePartId, ...data.stock, unitPrice: data.part.unitPrice })
    },
    onSuccess: () => {
      toast.success("Yangi qism qo'shildi va kirim qilindi")
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['spare-parts'] })
      qc.invalidateQueries({ queryKey: ['spare-parts-all'] })
      setModalOpen(false); reset(); resetNew(); setNewPartMode(false)
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
    mutationFn: ({ id, body }: { id: string; body: AdjustForm }) =>
      api.post(`/inventory/${id}/adjust`, {
        quantityOnHand: body.quantityOnHand,
        reason: body.reason,
        ...(body.newWarehouseId ? { newWarehouseId: body.newWarehouseId } : {}),
      }),
    onSuccess: (res) => {
      toast.success(res.data?.message || 'Ombor tuzatildi')
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['low-stock'] })
      setAdjustModalOpen(false); setSelectedItem(null); resetAdjust()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteInvMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inventory/${id}`),
    onSuccess: () => {
      toast.success("Ombor yozuvi o'chirildi")
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['low-stock'] })
      setDeleteConfirmItem(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const movePreviewMutation = useMutation({
    mutationFn: (fromWarehouseId: string) =>
      api.get('/inventory/move-preview', { params: { fromWarehouseId } }).then(r => r.data.data),
    onSuccess: (data) => setMovePreview(data.items),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const moveMutation = useMutation({
    mutationFn: (body: { fromWarehouseId: string; toWarehouseId: string }) =>
      api.post('/inventory/move-warehouse', body).then(r => r.data),
    onSuccess: (data) => {
      toast.success(data.message || "Ko'chirildi")
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      setMoveModalOpen(false)
      setMoveFrom(''); setMoveTo(''); setMovePreview(null); setMoveConfirmed(false)
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
    setAdjustValue('newWarehouseId', '')
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
            <Button size="sm" variant="ghost" title="Miqdor/sklad tuzatish (admin)"
              icon={<SlidersHorizontal className="w-4 h-4 text-amber-500" />} onClick={() => openAdjust(i)} />
          )}
          {hasRole('admin') && (
            <Button size="sm" variant="ghost" title="O'chirish (admin)"
              icon={<Trash2 className="w-4 h-4 text-red-500" />} onClick={() => setDeleteConfirmItem(i)} />
          )}
        </div>
      )
    },
  ]

  const warehouses = (warehousesData || []).filter((w: any) => w.isActive).map((w: any) => ({ value: w.id, label: w.name }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))
  const suppliers = (suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))
  const categoryOptions = PART_CATEGORIES.map((c: string) => ({ value: c, label: categoryLabel[c] || c }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Ombor</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta pozitsiya</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/inventory" params={{ warehouseId: warehouseFilter || undefined }} label="Excel" />
          {hasRole('admin') && (
            <Button variant="outline" icon={<MoveRight className="w-4 h-4" />} onClick={() => setMoveModalOpen(true)}>
              Omborni ko'chirish
            </Button>
          )}
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
        <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Add stock modal */}
      <Modal open={modalOpen}
        onClose={() => { setModalOpen(false); reset(); resetNew(); setNewPartMode(false) }}
        title="Ombor kirim" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); reset(); resetNew(); setNewPartMode(false) }}>Bekor qilish</Button>
            {newPartMode
              ? <Button loading={createAndStockMutation.isPending}
                  onClick={handleNew(partData => {
                    const warehouseId = (document.getElementById('new-wid') as HTMLSelectElement)?.value || ''
                    const quantity = (document.getElementById('new-qty') as HTMLInputElement)?.value || ''
                    const reorderLevel = (document.getElementById('new-rl') as HTMLInputElement)?.value || ''
                    if (!warehouseId || !quantity) return toast.error("Sklad va miqdor talab qilinadi")
                    createAndStockMutation.mutate({ part: partData, stock: { warehouseId, quantity, reorderLevel } })
                  })}>Saqlash</Button>
              : <Button loading={addStockMutation.isPending} onClick={handleSubmit(d => addStockMutation.mutate(d))}>Saqlash</Button>
            }
          </>
        }
      >
        {/* Mode toggle */}
        <div className="flex gap-2 mb-4">
          <button type="button"
            onClick={() => { setNewPartMode(false); reset() }}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium border transition-colors ${!newPartMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
            Mavjud qism
          </button>
          <button type="button"
            onClick={() => { setNewPartMode(true); resetNew() }}
            className={`flex-1 py-1.5 text-sm rounded-lg font-medium border transition-colors ${newPartMode ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-gray-800 border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300'}`}>
            Yangi qism
          </button>
        </div>

        {!newPartMode ? (
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
            <Input label="Narxi (so'm)" type="number" placeholder="Mavjud narx saqlanadi" min={0}
              hint="Bo'sh qoldirilsa qismning mavjud narxi o'zgarmaydi"
              {...register('unitPrice')} />
            <Input label="Miqdor *" type="number" placeholder="0" min={0} error={errors.quantity?.message}
              {...register('quantity', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
            <Input label="Minimal daraja" type="number" placeholder="1" min={0} {...register('reorderLevel')}
              hint="Shu miqdordan kam bo'lganda ogohlantirish beriladi" />
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
              Yangi ehtiyot qism yaratiladi va avtomatik kirim qilinadi
            </p>
            <Input label="Nomi *" placeholder="Masalan: Yog' filtri" error={newErrors.name?.message}
              {...regNew('name', { required: 'Talab qilinadi' })} />
            <Input label="Artikul kodi *" placeholder="Masalan: YF-001" error={newErrors.partCode?.message}
              {...regNew('partCode', { required: 'Talab qilinadi' })} />
            <Select label="Kategoriya *" options={categoryOptions} placeholder="Tanlang" error={newErrors.category?.message}
              {...regNew('category', { required: 'Talab qilinadi' })} />
            <Input label="Narxi (so'm) *" type="number" placeholder="0" error={newErrors.unitPrice?.message}
              {...regNew('unitPrice', { required: 'Talab qilinadi', min: { value: 0, message: "Manfiy bo'lmaydi" } })} />
            <Select label="Yetkazuvchi" options={suppliers} placeholder="Tanlang (ixtiyoriy)"
              {...regNew('supplierId')} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sklad *</label>
              <select id="new-wid" className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">Tanlang</option>
                {warehouses.map((w: any) => <option key={w.value} value={w.value}>{w.label}</option>)}
              </select>
            </div>
            <Input id="new-qty" label="Miqdor (dona) *" type="number" placeholder="0" min={1} />
            <Input id="new-rl" label="Minimal daraja" type="number" placeholder="5" min={0}
              hint="Shu miqdordan kam bo'lganda ogohlantirish" />
          </div>
        )}
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
        title="Tuzatish (Admin)" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setAdjustModalOpen(false); setSelectedItem(null); resetAdjust() }}>Bekor qilish</Button>
            <Button loading={adjustMutation.isPending} onClick={handleAdjust(d => selectedItem && adjustMutation.mutate({ id: selectedItem.id, body: d }))}>Saqlash</Button>
          </>
        }
      >
        {selectedItem && (
          <div className="space-y-4">
            <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-lg p-3">
              <p className="font-medium text-gray-900 dark:text-white">{selectedItem.sparePart.name}</p>
              <p className="text-xs text-gray-400 font-mono">{selectedItem.sparePart.partCode}</p>
              <p className="text-sm text-amber-700 dark:text-amber-300 mt-1">
                Hozirgi sklad: <span className="font-bold">{(selectedItem as any).warehouse?.name || '—'}</span> · Miqdor: <span className="font-bold">{selectedItem.quantityOnHand} ta</span>
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Skladi o'zgartirish (ixtiyoriy)</label>
              <select
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                {...regAdjust('newWarehouseId')}
              >
                <option value="">O'zgartirmaslik</option>
                {warehouses.filter((w: any) => w.value !== (selectedItem as any).warehouse?.id).map((w: any) => (
                  <option key={w.value} value={w.value}>{w.label}</option>
                ))}
              </select>
            </div>
            <Input label="Yangi miqdor *" type="number" min={0} error={adjustErrors.quantityOnHand?.message}
              {...regAdjust('quantityOnHand', { required: 'Talab qilinadi', min: { value: 0, message: 'Manfiy bo\'lmaydi' } })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Tuzatish sababi <span className="text-red-500">*</span>
              </label>
              <textarea
                rows={2}
                placeholder="Masalan: noto'g'ri sklad kiritilgan, inventarizatsiya..."
                className={`w-full border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white resize-none ${adjustErrors.reason ? 'border-red-500 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
                {...regAdjust('reason', { required: 'Sabab kiritilishi shart' })}
              />
              {adjustErrors.reason && <p className="text-xs text-red-500 mt-1">{adjustErrors.reason.message}</p>}
            </div>
          </div>
        )}
      </Modal>

      {/* Delete confirm modal */}
      <Modal open={!!deleteConfirmItem} onClose={() => setDeleteConfirmItem(null)}
        title="O'chirishni tasdiqlash" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setDeleteConfirmItem(null)}>Bekor qilish</Button>
            <Button
              loading={deleteInvMutation.isPending}
              className="bg-red-600 hover:bg-red-700 border-red-600 text-white"
              onClick={() => deleteConfirmItem && deleteInvMutation.mutate(deleteConfirmItem.id)}
            >
              O'chirish
            </Button>
          </>
        }
      >
        {deleteConfirmItem && (
          <div className="space-y-3">
            <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
              <p className="font-medium text-gray-900 dark:text-white">{deleteConfirmItem.sparePart.name}</p>
              <p className="text-xs text-gray-400 font-mono">{deleteConfirmItem.sparePart.partCode}</p>
              <p className="text-sm text-red-700 dark:text-red-300 mt-1">
                Sklad: <span className="font-bold">{(deleteConfirmItem as any).warehouse?.name || '—'}</span> · Miqdor: <span className="font-bold">{deleteConfirmItem.quantityOnHand} ta</span>
              </p>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Bu ombor yozuvini o'chirasizmi? Bu amalni qaytarib bo'lmaydi.
            </p>
          </div>
        )}
      </Modal>

      {/* Omborni ko'chirish modal */}
      <Modal open={moveModalOpen} onClose={() => { setMoveModalOpen(false); setMoveFrom(''); setMoveTo(''); setMovePreview(null); setMoveConfirmed(false) }}
        title="Omborni ko'chirish" size="md">
        <div className="space-y-4 p-4">
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-800 dark:text-red-300">
            <strong>Diqqat!</strong> Bu amal faqat admin tomonidan bajariladi va audit logga yoziladi. Barcha ko'chirishlar qayd etiladi.
          </div>

          {/* 1-bosqich: Omborlarni tanlash */}
          <div className="grid grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Qayerdan (noto'g'ri ombor)</label>
              <select value={moveFrom} onChange={e => { setMoveFrom(e.target.value); setMovePreview(null); setMoveConfirmed(false) }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Tanlang —</option>
                {(warehousesData || []).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>
            <div className="flex flex-col items-center gap-1">
              <MoveRight className="w-6 h-6 text-gray-400 mt-4" />
            </div>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">Qayerga (to'g'ri ombor)</label>
            <select value={moveTo} onChange={e => { setMoveTo(e.target.value); setMoveConfirmed(false) }}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Tanlang —</option>
              {(warehousesData || []).filter((w: any) => w.id !== moveFrom).map((w: any) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>

          {/* Preview tugmasi */}
          {!movePreview && (
            <Button variant="outline" disabled={!moveFrom} loading={movePreviewMutation.isPending}
              onClick={() => movePreviewMutation.mutate(moveFrom)}>
              Ko'chiriladigan mahsulotlarni ko'rish
            </Button>
          )}

          {/* Preview ro'yxati */}
          {movePreview && (
            <div className="border border-gray-200 dark:border-gray-600 rounded-lg overflow-hidden">
              <div className="bg-gray-50 dark:bg-gray-700 px-3 py-2 text-xs font-semibold text-gray-600 dark:text-gray-300">
                Ko'chiriladigan mahsulotlar: {movePreview.length} ta
              </div>
              <div className="max-h-48 overflow-y-auto divide-y divide-gray-100 dark:divide-gray-700">
                {movePreview.map((item: any) => (
                  <div key={item.id} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div>
                      <span className="font-medium text-gray-900 dark:text-white">{item.sparePart.name}</span>
                      <span className="ml-2 text-xs text-gray-400 font-mono">{item.sparePart.partCode}</span>
                    </div>
                    <span className="font-semibold text-blue-600 dark:text-blue-400">{item.quantityOnHand} ta</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Tasdiqlash checkbox */}
          {movePreview && movePreview.length > 0 && (
            <label className="flex items-start gap-2 cursor-pointer">
              <input type="checkbox" checked={moveConfirmed} onChange={e => setMoveConfirmed(e.target.checked)}
                className="mt-0.5 rounded" />
              <span className="text-sm text-gray-700 dark:text-gray-300">
                Men ushbu <strong>{movePreview.length} ta mahsulotni</strong> ko'chirishni tasdiqlayman.
                Bu amal audit logga yoziladi.
              </span>
            </label>
          )}

          <div className="flex gap-2 pt-1">
            <Button variant="outline" onClick={() => { setMoveModalOpen(false); setMoveFrom(''); setMoveTo(''); setMovePreview(null); setMoveConfirmed(false) }}>
              Bekor qilish
            </Button>
            <Button
              disabled={!moveFrom || !moveTo || !moveConfirmed || !movePreview?.length}
              loading={moveMutation.isPending}
              onClick={() => moveMutation.mutate({ fromWarehouseId: moveFrom, toWarehouseId: moveTo })}>
              Tasdiqlash va ko'chirish
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
