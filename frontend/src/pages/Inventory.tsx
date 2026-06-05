import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, AlertTriangle, Package, TrendingDown, DollarSign, Edit2, Search, SlidersHorizontal, Trash2, MoveRight, History } from 'lucide-react'
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
  isOfficial?: boolean
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
  const { t } = useTranslation()
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
  const [newPartIsOfficial, setNewPartIsOfficial] = useState(true)
  const [editModalOpen, setEditModalOpen] = useState(false)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<InventoryItem | null>(null)
  const [selectedItem, setSelectedItem] = useState<InventoryItem | null>(null)
  const [moveModalOpen, setMoveModalOpen] = useState(false)
  const [moveFrom, setMoveFrom] = useState('')
  const [moveTo, setMoveTo] = useState('')
  const [movePreview, setMovePreview] = useState<any[] | null>(null)
  const [moveConfirmed, setMoveConfirmed] = useState(false)
  const [activeTab, setActiveTab] = useState<'inventory' | 'receipts'>('inventory')
  const [receiptPage, setReceiptPage] = useState(1)
  const [receiptWarehouse, setReceiptWarehouse] = useState('')
  const [stocktakeOpen, setStocktakeOpen] = useState(false)
  const [stocktakeWarehouse, setStocktakeWarehouse] = useState('')
  const [stocktakeDate, setStocktakeDate] = useState(() => new Date().toISOString().split('T')[0])
  const [actMode, setActMode] = useState(false)  // Akt rejimi: haqiqiy miqdor kiritish
  const [actualCounts, setActualCounts] = useState<Record<string, string>>({})  // itemId → haqiqiy son
  const [adjusting, setAdjusting] = useState(false)
  const [receiptDateFrom, setReceiptDateFrom] = useState('')
  const [receiptDateTo, setReceiptDateTo] = useState('')

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

  const { data: stocktakeData, isLoading: stocktakeLoading, refetch: refetchStocktake } = useQuery({
    queryKey: ['inventory-stocktake', stocktakeWarehouse],
    queryFn: () => api.get('/inventory/stocktake', {
      params: { warehouseId: stocktakeWarehouse || undefined },
    }).then(r => r.data.data),
    enabled: stocktakeOpen,
  })

  // ─── Inventarizatsiya akti hisoblash ────────────────────────────────────────
  // Har item uchun: haqiqiy son kiritilgan bo'lsa farq hisoblanadi
  const allStocktakeItems: any[] = (stocktakeData?.warehouses || []).flatMap((w: any) =>
    w.items.map((i: any) => ({ ...i, warehouseName: w.warehouseName }))
  )

  const actRows = allStocktakeItems
    .map(item => {
      const raw = actualCounts[item.id]
      if (raw === undefined || raw === '') return null
      const actual = parseInt(raw)
      if (isNaN(actual)) return null
      const diff = actual - item.quantityOnHand   // + ortiqcha, − kamomad
      if (diff === 0) return null
      return {
        id: item.id, name: item.name, partCode: item.partCode,
        warehouseName: item.warehouseName,
        system: item.quantityOnHand, actual, diff,
        unitPrice: item.unitPrice,
        diffValue: diff * item.unitPrice,
      }
    })
    .filter(Boolean) as Array<{ id: string; name: string; partCode: string; warehouseName: string; system: number; actual: number; diff: number; unitPrice: number; diffValue: number }>

  const shortageRows = actRows.filter(r => r.diff < 0)
  const surplusRows  = actRows.filter(r => r.diff > 0)
  const shortageTotal = Math.abs(shortageRows.reduce((s, r) => s + r.diffValue, 0))
  const surplusTotal  = surplusRows.reduce((s, r) => s + r.diffValue, 0)

  // Qoldiqni haqiqiy songa moslashtirish — har farqi bor item uchun adjust
  async function handleAdjustStock() {
    if (actRows.length === 0) return
    if (!window.confirm(`${actRows.length} ta qism qoldig'i haqiqiy songa moslashtiriladi. Davom etasizmi?`)) return
    setAdjusting(true)
    let ok = 0, fail = 0
    for (const row of actRows) {
      try {
        await api.post(`/inventory/${row.id}/adjust`, {
          quantityOnHand: row.actual,
          reason: `Inventarizatsiya ${stocktakeDate}: ${row.diff > 0 ? 'ortiqcha' : 'kamomad'} ${Math.abs(row.diff)} dona`,
        })
        ok++
      } catch { fail++ }
    }
    setAdjusting(false)
    toast.success(`${ok} ta moslashtirildi${fail > 0 ? `, ${fail} ta xato` : ''}`)
    setActualCounts({})
    refetchStocktake()
    qc.invalidateQueries({ queryKey: ['inventory'] })
    qc.invalidateQueries({ queryKey: ['inventory-stats'] })
  }

  // Aktni alohida oynada chop etish
  function printAct() {
    const el = document.getElementById('stocktake-act-area')
    if (!el) return
    const win = window.open('', '_blank', 'width=900,height=1100')
    if (!win) return
    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventarizatsiya akti</title>
    <style>
      @page { size: A4; margin: 15mm 12mm; }
      body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; }
      h1 { text-align: center; font-size: 16pt; margin-bottom: 4px; }
      .meta { text-align: center; font-size: 10pt; color: #555; margin-bottom: 14px; }
      h3 { font-size: 12pt; margin: 14px 0 4px; }
      table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10pt; }
      th { background: #e8e8e8; padding: 5px 6px; border: 1px solid #000; text-align: left; font-weight: bold; }
      td { padding: 4px 6px; border: 1px solid #000; }
      .num { text-align: right; }
      .neg { color: #b91c1c; font-weight: bold; }
      .pos { color: #15803d; font-weight: bold; }
      .summary { border: 2px solid #000; padding: 8px 10px; margin: 10px 0; font-size: 11pt; }
      .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 32px; font-size: 10.5pt; }
      .sig .role { font-weight: bold; margin-bottom: 24px; }
    </style></head><body>${el.innerHTML}</body></html>`)
    win.document.close()
    win.focus()
    setTimeout(() => win.print(), 500)
  }

  const { data: receiptsData, isLoading: receiptsLoading } = useQuery({
    queryKey: ['inventory-receipts', receiptPage, receiptWarehouse, receiptDateFrom, receiptDateTo],
    queryFn: () => api.get('/inventory/receipts', {
      params: {
        page: receiptPage, limit: 50,
        warehouseId: receiptWarehouse || undefined,
        dateFrom: receiptDateFrom || undefined,
        dateTo: receiptDateTo || undefined,
      }
    }).then(r => r.data),
    enabled: activeTab === 'receipts',
    placeholderData: keepPreviousData,
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { select: 'true' } }).then(r => r.data.data),
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, setValue, watch, formState: { errors } } = useForm<AddStockForm>({
    defaultValues: { isOfficial: true },
  })
  const { register: regNew, handleSubmit: handleNew, reset: resetNew, setValue: setNewValue, getValues: getNewValues, formState: { errors: newErrors } } = useForm<NewPartForm>()
  const { register: regEdit, handleSubmit: handleEdit, reset: resetEdit, setValue: setEditValue, formState: { errors: editErrors } } = useForm<EditForm>()
  const { register: regAdjust, handleSubmit: handleAdjust, reset: resetAdjust, setValue: setAdjustValue, formState: { errors: adjustErrors } } = useForm<AdjustForm>()
  const selectedSparePartId = watch('sparePartId', '')

  const addStockMutation = useMutation({
    mutationFn: (body: AddStockForm) => api.post('/inventory/add', body),
    onSuccess: () => {
      toast.success(t('inventory.toast.warehouseUpdated'))
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
      qc.invalidateQueries({ queryKey: ['low-stock'] })
      qc.invalidateQueries({ queryKey: ['spare-parts'] })
      setModalOpen(false); reset(); setNewPartMode(false); resetNew()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const suggestCodeMutation = useMutation({
    mutationFn: ({ category, name }: { category: string; name: string }) =>
      api.get('/spare-parts/suggest-code', { params: { category, name } }),
    onSuccess: (res) => {
      setNewValue('partCode', res.data.data.code, { shouldValidate: true })
      toast.success(`Artikul kod: ${res.data.data.code}`)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleSuggestCode = () => {
    const v = getNewValues()
    if (!v.category) return toast.error(t('inventory.toast.selectCategory'))
    suggestCodeMutation.mutate({ category: v.category, name: v.name || '' })
  }

  const createAndStockMutation = useMutation({
    mutationFn: async (data: { part: NewPartForm; stock: { warehouseId: string; quantity: string; reorderLevel: string; isOfficial?: boolean } }) => {
      const fd = new FormData()
      Object.entries(data.part).forEach(([k, v]) => v && fd.append(k, v))
      const partRes = await api.post('/spare-parts', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const sparePartId = partRes.data.data.id
      return api.post('/inventory/add', {
        sparePartId,
        ...data.stock,
        unitPrice: data.part.unitPrice,
        // Yangi qism rejimida ham rasmiy/norasmiy belgisi uzatiladi
        isOfficial: data.stock.isOfficial !== false,
      })
    },
    onSuccess: () => {
      toast.success(t('inventory.toast.partAdded'))
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
      toast.success(t('inventory.toast.warehouseUpdated'))
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
      toast.success(t('inventory.toast.deleted'))
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
            <Button size="sm" variant="ghost" title={t('inventory.adminAdjust')}
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
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('inventory.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('inventory.totalPositions', { count: data?.meta?.total || 0 })}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/inventory" params={{ warehouseId: warehouseFilter || undefined }} label="Excel" />
          <Button variant="outline" icon={<History className="w-4 h-4" />} onClick={() => setStocktakeOpen(true)}>
            Inventarizatsiya
          </Button>
          {hasRole('admin') && (
            <Button variant="outline" icon={<MoveRight className="w-4 h-4" />} onClick={() => setMoveModalOpen(true)}>
              Omborni ko'chirish
            </Button>
          )}
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>{t('inventory.receive')}</Button>
          )}
        </div>
      </div>

      {/* Tablar */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        <button
          onClick={() => setActiveTab('inventory')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'inventory' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          <Package className="w-4 h-4" /> Joriy qoldiq
        </button>
        <button
          onClick={() => setActiveTab('receipts')}
          className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'receipts' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
        >
          <History className="w-4 h-4" /> Kirimlar tarixi
        </button>
      </div>

      {activeTab === 'receipts' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 flex-wrap items-end">
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">{t('inventory.warehouse')}</label>
              <select value={receiptWarehouse} onChange={e => { setReceiptWarehouse(e.target.value); setReceiptPage(1) }}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">{t('inventory.allWarehouses')}</option>
                {(warehousesData || []).filter((w: any) => w.isActive).map((w: any) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">Dan</label>
              <input type="date" value={receiptDateFrom} onChange={e => { setReceiptDateFrom(e.target.value); setReceiptPage(1) }}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-500 dark:text-gray-400">{t('inventory.to')}</label>
              <input type="date" value={receiptDateTo} onChange={e => { setReceiptDateTo(e.target.value); setReceiptPage(1) }}
                className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
            {(receiptWarehouse || receiptDateFrom || receiptDateTo) && (
              <button onClick={() => { setReceiptWarehouse(''); setReceiptDateFrom(''); setReceiptDateTo(''); setReceiptPage(1) }}
                className="px-3 py-2 text-sm text-gray-500 hover:text-red-500 transition-colors">{t('inventory.clear')}</button>
            )}
            <span className="ml-auto text-sm text-gray-400">{receiptsData?.meta?.total || 0} ta yozuv</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/40">
                  <th className="px-4 py-3 text-left font-medium text-gray-500">#</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t('inventory.date')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t('inventory.sparePart')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t('inventory.warehouse')}</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">{t('inventory.quantity')}</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">{t('inventory.price')}</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-500">{t('inventory.total')}</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-500">{t('inventory.addedBy')}</th>
                </tr>
              </thead>
              <tbody>
                {receiptsLoading && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{t('inventory.loading')}</td></tr>
                )}
                {!receiptsLoading && (receiptsData?.data || []).length === 0 && (
                  <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">{t('inventory.noRecords')}</td></tr>
                )}
                {(receiptsData?.data || []).map((r: any, idx: number) => (
                  <tr key={r.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                    <td className="px-4 py-3 text-gray-400">{(receiptPage - 1) * 50 + idx + 1}</td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-3">
                      <p className="font-medium text-gray-900 dark:text-white">{r.sparePart?.name}</p>
                      <p className="text-xs text-gray-400 font-mono">{r.sparePart?.partCode}</p>
                    </td>
                    <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{r.warehouse?.name}</td>
                    <td className="px-4 py-3 text-right font-bold text-green-600">+{r.quantity}</td>
                    <td className="px-4 py-3 text-right text-gray-600 dark:text-gray-300">{formatCurrency(Number(r.unitPrice))}</td>
                    <td className="px-4 py-3 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(r.quantity * Number(r.unitPrice))}</td>
                    <td className="px-4 py-3 text-gray-500 dark:text-gray-400">{r.receivedBy?.fullName || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={receiptPage}
            totalPages={receiptsData?.meta?.totalPages || 1}
            total={receiptsData?.meta?.total || 0}
            limit={50}
            onPageChange={setReceiptPage}
            onLimitChange={() => {}}
          />
        </div>
      )}

      {activeTab === 'inventory' && <>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <Package className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('inventory.totalPositionsLabel')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData.totalItems}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('inventory.totalValue')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(statsData.totalValue)}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <TrendingDown className="w-8 h-8 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('inventory.lowStock')}</p>
              <p className="text-xl font-bold text-yellow-600">{statsData.lowStockCount}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-red-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('inventory.outOfStock')}</p>
              <p className="text-xl font-bold text-red-600">{statsData.outOfStockCount}</p>
            </div>
          </div>
        </div>
      )}

      {(lowStockData || []).length > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="font-medium text-red-800 dark:text-red-300">{t('inventory.lowStockWarning', { count: (lowStockData || []).length })}</p>
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
              placeholder={t('inventory.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => { setSearch(e.target.value) }}
            />
          </div>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t('inventory.allCategories')}</option>
            {PART_CATEGORIES.map(c => <option key={c} value={c}>{categoryLabel[c] || c}</option>)}
          </select>
          {!['branch_manager', 'operator'].includes(user?.role || '') && (
            <select value={warehouseFilter} onChange={e => { setWarehouseFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('inventory.allWarehouses')}</option>
              {warehouses.map((w: { value: string; label: string }) => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
          )}
          <label className="flex items-center gap-2 cursor-pointer">
            <input type="checkbox" checked={showLowStock} onChange={e => { setShowLowStock(e.target.checked); setPage(1) }} className="rounded" />
            <span className="text-sm text-gray-600 dark:text-gray-300">{t('inventory.onlyLow')}</span>
          </label>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      </>}

      {/* Add stock modal */}
      <Modal open={modalOpen}
        onClose={() => { setModalOpen(false); reset(); resetNew(); setNewPartMode(false) }}
        title={t('inventory.receiveTitle')} size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); reset(); resetNew(); setNewPartMode(false) }}>{t('common.cancel')}</Button>
            {newPartMode
              ? <Button loading={createAndStockMutation.isPending}
                  onClick={handleNew(partData => {
                    const warehouseId = (document.getElementById('new-wid') as HTMLSelectElement)?.value || ''
                    const quantity = (document.getElementById('new-qty') as HTMLInputElement)?.value || ''
                    const reorderLevel = (document.getElementById('new-rl') as HTMLInputElement)?.value || ''
                    if (!warehouseId || !quantity) return toast.error(t('inventory.toast.warehouseQuantityRequired'))
                    createAndStockMutation.mutate({ part: partData, stock: { warehouseId, quantity, reorderLevel, isOfficial: newPartIsOfficial } })
                  })}>{t('common.save')}</Button>
              : <Button loading={addStockMutation.isPending} onClick={handleSubmit(d => addStockMutation.mutate(d))}>{t('common.save')}</Button>
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
              placeholder={t('inventory.partSearchPlaceholder')}
              error={errors.sparePartId?.message}
            />
            <input type="hidden" {...register('sparePartId', { required: 'Talab qilinadi' })} />
            <Select label={t('inventory.warehouseRequired')} options={warehouses} placeholder="Tanlang" error={errors.warehouseId?.message}
              {...register('warehouseId', { required: 'Talab qilinadi' })} />
            <Input label={t('inventory.priceLabel')} type="number" placeholder={t('inventory.pricePlaceholder')} min={0}
              hint="Bo'sh qoldirilsa qismning mavjud narxi o'zgarmaydi"
              {...register('unitPrice')} />
            <Input label="Miqdor *" type="number" placeholder="0" min={0} error={errors.quantity?.message}
              {...register('quantity', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
            <Input label="Minimal daraja" type="number" placeholder="1" min={0} {...register('reorderLevel')}
              hint="Shu miqdordan kam bo'lganda ogohlantirish beriladi" />

            {/* Rasmiy/Norasmiy belgisi */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Kirim turi *
              </label>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={() => setValue('isOfficial', true)}
                  className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors text-left ${
                    watch('isOfficial') !== false
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                  }`}>
                  <span className="text-sm">
                    <span className="font-semibold text-emerald-700 dark:text-emerald-400">🟢 Rasmiy</span>
                    <span className="block text-xs text-gray-500">{t('inventory.officialHint')}</span>
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setValue('isOfficial', false)}
                  className={`flex items-center gap-2 px-3 py-2 border rounded-lg transition-colors text-left ${
                    watch('isOfficial') === false
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                  }`}>
                  <span className="text-sm">
                    <span className="font-semibold text-orange-700 dark:text-orange-400">🟠 Norasmiy</span>
                    <span className="block text-xs text-gray-500">Ko'chadan, hujjatsiz</span>
                  </span>
                </button>
              </div>
              <p className="text-xs text-gray-400 mt-1">{t('inventory.unofficialHint')}</p>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-2 rounded-lg">
              Yangi ehtiyot qism yaratiladi va avtomatik kirim qilinadi
            </p>
            <Input label={t('inventory.nameRequired')} placeholder={t('inventory.namePlaceholder')} error={newErrors.name?.message}
              {...regNew('name', { required: 'Talab qilinadi' })} />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('inventory.articleCode')}</label>
              <div className="flex gap-2">
                <input
                  type="text"
                  placeholder={t('inventory.articlePlaceholder')}
                  className={`flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${newErrors.partCode ? 'border-red-300' : 'border-gray-300 dark:border-gray-600'}`}
                  {...regNew('partCode', { required: 'Talab qilinadi' })}
                />
                <button
                  type="button"
                  onClick={handleSuggestCode}
                  disabled={suggestCodeMutation.isPending}
                  className="px-3 py-2 text-xs bg-yellow-500 hover:bg-yellow-600 text-white rounded-lg disabled:opacity-50 whitespace-nowrap flex items-center gap-1"
                  title="Kategoriya va nom asosida avto-kod"
                >
                  {suggestCodeMutation.isPending ? '...' : '⚡ Avto'}
                </button>
              </div>
              {newErrors.partCode && <p className="text-xs text-red-500 mt-1">{newErrors.partCode.message}</p>}
              <p className="text-xs text-gray-400 mt-1">{t('inventory.autoCodeHint')}</p>
            </div>
            <Select label={t('inventory.categoryRequired')} options={categoryOptions} placeholder="Tanlang" error={newErrors.category?.message}
              {...regNew('category', { required: 'Talab qilinadi' })} />
            <Input label="Narxi (so'm) *" type="number" placeholder="0" error={newErrors.unitPrice?.message}
              {...regNew('unitPrice', { required: 'Talab qilinadi', min: { value: 0, message: "Manfiy bo'lmaydi" } })} />
            <Select label={t('inventory.supplier')} options={suppliers} placeholder="Tanlang (ixtiyoriy)"
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

            {/* Rasmiy/Norasmiy belgisi (yangi qism rejimi) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('inventory.receiveType')}</label>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setNewPartIsOfficial(true)}
                  className={`px-3 py-2 border rounded-lg text-left transition-colors ${
                    newPartIsOfficial
                      ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                  }`}>
                  <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">🟢 Rasmiy</span>
                  <span className="block text-xs text-gray-500">Buxgalteriya orqali</span>
                </button>
                <button type="button" onClick={() => setNewPartIsOfficial(false)}
                  className={`px-3 py-2 border rounded-lg text-left transition-colors ${
                    !newPartIsOfficial
                      ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                      : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                  }`}>
                  <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">🟠 Norasmiy</span>
                  <span className="block text-xs text-gray-500">Ko'chadan, hujjatsiz</span>
                </button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Edit modal */}
      <Modal open={editModalOpen} onClose={() => { setEditModalOpen(false); setSelectedItem(null); resetEdit() }}
        title={t('inventory.editTitle')} size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setEditModalOpen(false); setSelectedItem(null); resetEdit() }}>{t('common.cancel')}</Button>
            <Button loading={editMutation.isPending} onClick={handleEdit(d => selectedItem && editMutation.mutate({ id: selectedItem.id, body: d }))}>{t('common.save')}</Button>
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
        title={t('inventory.adjustTitle')} size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setAdjustModalOpen(false); setSelectedItem(null); resetAdjust() }}>{t('common.cancel')}</Button>
            <Button loading={adjustMutation.isPending} onClick={handleAdjust(d => selectedItem && adjustMutation.mutate({ id: selectedItem.id, body: d }))}>{t('common.save')}</Button>
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('inventory.changeWarehouse')}</label>
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
                placeholder={t('inventory.adjustReason')}
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
            <Button variant="outline" onClick={() => setDeleteConfirmItem(null)}>{t('common.cancel')}</Button>
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
        title={t('inventory.moveTitle')} size="md">
        <div className="space-y-4 p-4">
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded-lg text-sm text-red-800 dark:text-red-300">
            <strong>Diqqat!</strong> {t('inventory.moveWarning')}
          </div>

          {/* 1-bosqich: Omborlarni tanlash */}
          <div className="grid grid-cols-2 gap-3 items-center">
            <div>
              <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('inventory.from')}</label>
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
            <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1">{t('inventory.moveTo')}</label>
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

      {/* Inventarizatsiya modali */}
      {stocktakeOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
          <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-5xl max-h-[90vh] flex flex-col">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 dark:border-gray-700 print:hidden">
              <h2 className="font-semibold text-gray-800 dark:text-white">📦 Inventarizatsiya qaydnomasi</h2>
              <div className="flex items-center gap-3">
                <div>
                  <label className="text-xs text-gray-500 mr-1">Sana:</label>
                  <input
                    type="date"
                    value={stocktakeDate}
                    onChange={e => setStocktakeDate(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  />
                </div>
                {(warehousesData || []).length > 1 && (
                  <select
                    value={stocktakeWarehouse}
                    onChange={e => setStocktakeWarehouse(e.target.value)}
                    className="text-sm border border-gray-300 dark:border-gray-600 rounded-lg px-2 py-1 bg-white dark:bg-gray-800 text-gray-700 dark:text-gray-300"
                  >
                    <option value="">Barcha skladlar</option>
                    {(warehousesData || []).map((w: any) => (
                      <option key={w.id} value={w.id}>{w.name}</option>
                    ))}
                  </select>
                )}
                <button
                  onClick={async () => {
                    try {
                      const res = await api.get('/inventory/stocktake/excel', {
                        params: {
                          warehouseId: stocktakeWarehouse || undefined,
                          date: stocktakeDate,
                        },
                        responseType: 'blob',
                      })
                      const blobUrl = URL.createObjectURL(res.data)
                      const a = document.createElement('a')
                      a.href = blobUrl
                      a.download = `inventarizatsiya-${stocktakeDate}.xlsx`
                      document.body.appendChild(a)
                      a.click()
                      a.remove()
                      URL.revokeObjectURL(blobUrl)
                      toast.success('Excel yuklab olindi')
                    } catch {
                      toast.error('Yuklab olishda xatolik')
                    }
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-sm rounded-lg hover:bg-green-700"
                >
                  📊 Excel
                </button>
                <button
                  onClick={() => {
                    const content = document.getElementById('stocktake-print-area')
                    if (!content) return
                    const win = window.open('', '_blank', 'width=1000,height=800')
                    if (!win) return
                    win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Inventarizatsiya</title>
                    <style>
                      @page { size: A4; margin: 15mm 12mm; }
                      body { font-family: 'Times New Roman', serif; font-size: 11pt; color: #000; }
                      h1 { text-align: center; font-size: 16pt; margin-bottom: 4px; }
                      .meta { text-align: center; font-size: 10pt; color: #555; margin-bottom: 14px; }
                      h3 { font-size: 12pt; margin: 12px 0 4px; border-bottom: 1px solid #000; padding-bottom: 2px; }
                      table { width: 100%; border-collapse: collapse; margin-bottom: 10px; font-size: 10pt; }
                      th { background: #e8e8e8; padding: 5px 6px; border: 1px solid #000; text-align: left; font-weight: bold; }
                      td { padding: 4px 6px; border: 1px solid #000; }
                      .num { text-align: right; }
                      .total-row td { font-weight: bold; background: #f0f0f0; }
                      .grand { font-size: 12pt; font-weight: bold; border: 2px solid #000; padding: 6px 8px; margin: 10px 0; }
                      .sigs { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 24px; margin-top: 32px; font-size: 10.5pt; }
                      .sig .role { font-weight: bold; margin-bottom: 24px; }
                      .sig .line { border-bottom: 1px solid #000; margin-bottom: 3px; }
                    </style></head><body>${content.innerHTML}</body></html>`)
                    win.document.close()
                    win.focus()
                    setTimeout(() => win.print(), 500)
                  }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm rounded-lg hover:bg-blue-700"
                >
                  🖨 Chop etish
                </button>
                <button
                  onClick={() => { setActMode(v => !v); setActualCounts({}) }}
                  className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg transition-colors ${actMode ? 'bg-orange-600 text-white hover:bg-orange-700' : 'border border-gray-300 dark:border-gray-600 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700'}`}
                >
                  {actMode ? '✓ Akt rejimi' : '📋 Akt tuzish'}
                </button>
                <button onClick={() => setStocktakeOpen(false)} className="p-1.5 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700">
                  <span className="text-gray-500 text-lg leading-none">×</span>
                </button>
              </div>
            </div>

            {/* Kontent */}
            <div className="overflow-y-auto flex-1 p-5">
              {stocktakeLoading ? (
                <div className="flex justify-center py-16 text-gray-400">Yuklanmoqda...</div>
              ) : !stocktakeData ? null : (
                <div id="stocktake-print-area">
                  <h1>INVENTARIZATSIYA QAYDNOMASI</h1>
                  <p className="meta text-center text-sm text-gray-500 mb-4">
                    Sana: <b>{new Date(stocktakeDate + 'T00:00:00').toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' })}</b>
                    &nbsp;·&nbsp; Jami: <b>{stocktakeData.grandQty}</b> dona
                    &nbsp;·&nbsp; Umumiy qiymat: <b>{formatCurrency(stocktakeData.grandTotal)}</b>
                  </p>

                  {stocktakeData.warehouses.map((w: any) => (
                    <div key={w.warehouseId} className="mb-6">
                      <h3 className="font-bold text-gray-800 dark:text-white text-sm mb-2 border-b border-gray-200 dark:border-gray-600 pb-1">
                        📦 {w.warehouseName} — {w.items.length} xil, {w.totalItems} dona, {formatCurrency(w.totalValue)}
                      </h3>
                      <table className="w-full text-sm border-collapse">
                        <thead>
                          <tr className="bg-gray-100 dark:bg-gray-700">
                            <th className="text-left px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-8">№</th>
                            <th className="text-left px-2 py-1.5 border border-gray-300 dark:border-gray-600">Artikul</th>
                            <th className="text-left px-2 py-1.5 border border-gray-300 dark:border-gray-600">Nomi</th>
                            <th className="text-left px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-24">Kategoriya</th>
                            <th className="text-right px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-20">{actMode ? 'Tizim' : 'Miqdor'}</th>
                            {actMode && <th className="text-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-24">Haqiqiy</th>}
                            {actMode && <th className="text-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-20">Farq</th>}
                            <th className="text-right px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-28">Birlik narx</th>
                            <th className="text-right px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-32">Jami qiymat</th>
                            {!actMode && <th className="text-center px-2 py-1.5 border border-gray-300 dark:border-gray-600 w-28 print:block hidden">Haqiqiy miqdor</th>}
                          </tr>
                        </thead>
                        <tbody>
                          {w.items.map((item: any, idx: number) => {
                            const raw = actualCounts[item.id]
                            const actual = raw !== undefined && raw !== '' ? parseInt(raw) : null
                            const diff = actual !== null && !isNaN(actual) ? actual - item.quantityOnHand : null
                            return (
                            <tr key={item.id} className={idx % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-750'}>
                              <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-gray-400 text-center">{idx + 1}</td>
                              <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 font-mono text-xs text-gray-600 dark:text-gray-400">{item.partCode}</td>
                              <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-gray-800 dark:text-gray-200">{item.name}</td>
                              <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-gray-500 dark:text-gray-400">{categoryLabel[item.category] || item.category}</td>
                              <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-right font-semibold text-gray-800 dark:text-gray-200">{item.quantityOnHand}</td>
                              {actMode && (
                                <td className="px-1 py-1 border border-gray-200 dark:border-gray-700">
                                  <input
                                    type="number"
                                    value={raw ?? ''}
                                    onChange={e => setActualCounts(p => ({ ...p, [item.id]: e.target.value }))}
                                    placeholder="—"
                                    className="w-full px-1 py-0.5 text-center text-sm border border-gray-300 dark:border-gray-600 rounded bg-yellow-50 dark:bg-yellow-900/20 focus:outline-none focus:ring-1 focus:ring-orange-500"
                                  />
                                </td>
                              )}
                              {actMode && (
                                <td className={`px-2 py-1 border border-gray-200 dark:border-gray-700 text-center font-bold ${diff === null ? 'text-gray-300' : diff < 0 ? 'text-red-600' : diff > 0 ? 'text-green-600' : 'text-gray-400'}`}>
                                  {diff === null ? '—' : diff === 0 ? '✓' : diff > 0 ? `+${diff}` : diff}
                                </td>
                              )}
                              <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-right text-gray-600 dark:text-gray-400">{formatCurrency(item.unitPrice)}</td>
                              <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 text-right font-medium text-gray-800 dark:text-gray-200">{formatCurrency(item.totalValue)}</td>
                              {!actMode && <td className="px-2 py-1 border border-gray-200 dark:border-gray-700 print:block hidden"></td>}
                            </tr>
                            )
                          })}
                          <tr className="bg-gray-100 dark:bg-gray-700 font-bold">
                            <td colSpan={4} className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 text-right text-sm">Jami ({w.warehouseName}):</td>
                            <td className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 text-right">{w.totalItems}</td>
                            {actMode && <td className="px-2 py-1.5 border border-gray-300 dark:border-gray-600"></td>}
                            {actMode && <td className="px-2 py-1.5 border border-gray-300 dark:border-gray-600"></td>}
                            <td className="px-2 py-1.5 border border-gray-300 dark:border-gray-600"></td>
                            <td className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 text-right">{formatCurrency(w.totalValue)}</td>
                            {!actMode && <td className="px-2 py-1.5 border border-gray-300 dark:border-gray-600 print:block hidden"></td>}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  ))}

                  {/* Umumiy jami */}
                  <div className="grand border-2 border-gray-900 p-3 text-sm font-bold mb-6">
                    UMUMIY JAMI: {stocktakeData.grandQty} dona · {formatCurrency(stocktakeData.grandTotal)}
                  </div>

                  {/* Akt natijasi — faqat akt rejimida va farq bo'lsa */}
                  {actMode && actRows.length > 0 && (
                    <div className="mb-6 border-2 border-orange-300 dark:border-orange-700 rounded-xl p-4 bg-orange-50/50 dark:bg-orange-900/10">
                      <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                        <h3 className="font-bold text-orange-800 dark:text-orange-300 text-sm">
                          📋 Inventarizatsiya akti — {actRows.length} ta farq aniqlandi
                        </h3>
                        <div className="flex gap-2">
                          <button onClick={printAct}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs rounded-lg hover:bg-blue-700">
                            🖨 Aktni chop etish
                          </button>
                          <button onClick={handleAdjustStock} disabled={adjusting}
                            className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-600 text-white text-xs rounded-lg hover:bg-orange-700 disabled:opacity-50">
                            {adjusting ? 'Moslashtirilmoqda...' : '⚖ Qoldiqni moslashtirish'}
                          </button>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-3 mb-2">
                        <div className="bg-red-100 dark:bg-red-900/30 rounded-lg p-3">
                          <p className="text-xs text-red-600 dark:text-red-400">🔴 Kamomad ({shortageRows.length} ta)</p>
                          <p className="text-lg font-bold text-red-700 dark:text-red-300">{formatCurrency(shortageTotal)}</p>
                        </div>
                        <div className="bg-green-100 dark:bg-green-900/30 rounded-lg p-3">
                          <p className="text-xs text-green-600 dark:text-green-400">🟢 Ortiqcha ({surplusRows.length} ta)</p>
                          <p className="text-lg font-bold text-green-700 dark:text-green-300">{formatCurrency(surplusTotal)}</p>
                        </div>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        ⚖ "Qoldiqni moslashtirish" — tizim qoldig'ini haqiqiy songa tenglashtiradi (audit logga yoziladi).
                        Kamomad bo'lsa avval sababini aniqlang.
                      </p>
                    </div>
                  )}

                  {/* Akt — chop etish uchun yashirin blok */}
                  {actMode && actRows.length > 0 && (
                    <div id="stocktake-act-area" className="hidden">
                      <h1>INVENTARIZATSIYA AKTI</h1>
                      <p className="meta">
                        Sana: {new Date(stocktakeDate + 'T00:00:00').toLocaleDateString('uz-UZ', { year: 'numeric', month: 'long', day: 'numeric' })}
                        &nbsp;·&nbsp; Aniqlangan farqlar: {actRows.length} ta
                      </p>

                      <table>
                        <thead>
                          <tr>
                            <th>№</th><th>Sklad</th><th>Artikul</th><th>Nomi</th>
                            <th className="num">Tizim</th><th className="num">Haqiqiy</th>
                            <th className="num">Farq</th><th className="num">Summa</th>
                          </tr>
                        </thead>
                        <tbody>
                          {actRows.map((r, i) => (
                            <tr key={r.id}>
                              <td>{i + 1}</td>
                              <td>{r.warehouseName}</td>
                              <td>{r.partCode}</td>
                              <td>{r.name}</td>
                              <td className="num">{r.system}</td>
                              <td className="num">{r.actual}</td>
                              <td className={`num ${r.diff < 0 ? 'neg' : 'pos'}`}>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                              <td className={`num ${r.diff < 0 ? 'neg' : 'pos'}`}>{formatCurrency(Math.abs(r.diffValue))}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>

                      <div className="summary">
                        🔴 Kamomad jami: {formatCurrency(shortageTotal)} ({shortageRows.length} ta)<br/>
                        🟢 Ortiqcha jami: {formatCurrency(surplusTotal)} ({surplusRows.length} ta)
                      </div>

                      <div className="sigs">
                        {['Ombor mudiri', 'Hisobchi', 'Komissiya raisi'].map(role => (
                          <div key={role} className="sig">
                            <div className="role">{role}:</div>
                            <div className="line" />
                            <div style={{ fontSize: '9pt', color: '#555' }}>Imzo / Sana</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Imzo joylari */}
                  <div className="grid grid-cols-3 gap-6 mt-8 text-sm">
                    {['Ombor mudiri', 'Hisobchi', 'Komissiya a\'zosi'].map(role => (
                      <div key={role}>
                        <p className="font-bold mb-6">{role}:</p>
                        <div className="border-b border-gray-800 mb-1" />
                        <p className="text-xs text-gray-500">Imzo: ________________</p>
                        <p className="text-xs text-gray-500 mt-1">Sana: ________________</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
