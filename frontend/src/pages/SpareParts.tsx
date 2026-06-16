import { useState, useEffect, useRef, useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Edit2, Search, Package, QrCode, BarChart2, Zap, Upload, ImageIcon, Trash2, Wrench, PackagePlus, History, RotateCcw, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api, { apiBaseUrl, getFileUrl } from '../lib/api'
import { formatCurrency, CATEGORY_LABELS, PART_CATEGORIES } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Pagination from '../components/ui/Pagination'
import SparePartHistoryModal from '../components/SparePartHistoryModal'
import { useAuthStore } from '../stores/authStore'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { useDebounce } from '../hooks/useDebounce'

interface SparePart {
  id: string
  name: string
  partCode: string
  category: string
  unitPrice: number
  description?: string
  imageUrl?: string
  isActive: boolean
  supplier: { id: string; name: string }
}

interface SparePartForm {
  name: string
  partCode: string
  category: string
  unitPrice: string
  supplierId: string
  description: string
  // Optional initial stock (only used in create mode)
  warehouseId?: string
  initialQuantity?: string
  reorderLevel?: string
}

interface StockForm {
  warehouseId: string
  quantity: string
  reorderLevel: string
  unitPrice: string
}

type ViewTab = 'list' | 'stats'

export default function SpareParts() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  // Ehtiyot qismlar va Ombor o'zaro bog'liq — biri o'zgarsa ikkalasini ham yangilaymiz
  const invalidateStock = () => {
    ;['spare-parts', 'spare-parts-all', 'inventory', 'inventory-stats', 'low-stock', 'inventory-receipts'].forEach(k =>
      qc.invalidateQueries({ queryKey: [k] }))
  }
  const { hasRole } = useAuthStore()
  const [deleteConfirm, setDeleteConfirm] = useState<SparePart | null>(null)
  const [hardDeleteConfirm, setHardDeleteConfirm] = useState<SparePart | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [categoryFilter, setCategoryFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('') // '' = hammasi, 'true' = faol, 'false' = nofaol
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<SparePart | null>(null)
  const [qrModal, setQrModal] = useState<{ open: boolean; sparePartId: string; name: string } | null>(null)
  const [maintModal, setMaintModal] = useState<{ sparePartId: string; name: string } | null>(null)
  const [stockModal, setStockModal] = useState<{ sparePartId: string; name: string; unitPrice: number } | null>(null)
  const [historyModal, setHistoryModal] = useState<{ sparePartId: string; name: string } | null>(null)
  const [viewTab, setViewTab] = useState<ViewTab>('list')

  const { data, isLoading } = useQuery({
    queryKey: ['spare-parts', page, limit, debouncedSearch, categoryFilter, statusFilter],
    queryFn: () => api.get('/spare-parts', { params: { page, limit, search: debouncedSearch || undefined, category: categoryFilter || undefined, isActive: statusFilter || undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Ommaviy belgilash/o'chirish (faqat admin/manager)
  const canBulk = hasRole('admin', 'manager')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkConfirm, setBulkConfirm] = useState(false)
  // Sahifa/filtr o'zgarsa tanlovni tozalaymiz (chalkashmaslik uchun)
  useEffect(() => { setSelectedIds(new Set()) }, [page, debouncedSearch, categoryFilter, statusFilter])

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { data: statsOverview } = useQuery({
    queryKey: ['spare-part-stats-overview'],
    queryFn: () => api.get('/spare-part-stats/overview').then(r => r.data.data),
    enabled: viewTab === 'stats',
  })

  const { data: statsRanking } = useQuery({
    queryKey: ['spare-part-stats-ranking'],
    queryFn: () => api.get('/spare-part-stats/ranking?limit=10').then(r => r.data.data),
    enabled: viewTab === 'stats',
  })

  const { data: qrData, isLoading: qrLoading } = useQuery({
    queryKey: ['qr-code', qrModal?.sparePartId],
    queryFn: () => api.get(`/article-codes/${qrModal!.sparePartId}/qr?format=dataurl`).then(r => r.data.data),
    enabled: !!qrModal?.open,
  })

  const { data: maintData, isLoading: maintLoading } = useQuery({
    queryKey: ['spare-part-maintenance', maintModal?.sparePartId],
    queryFn: () => api.get('/maintenance', { params: { sparePartId: maintModal!.sparePartId, limit: 50 } }).then(r => r.data),
    enabled: !!maintModal,
  })

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })
  const warehouses = (warehousesData || []).filter((w: any) => w.isActive).map((w: any) => ({ value: w.id, label: w.name }))

  const { register: regStock, handleSubmit: handleStock, reset: resetStock, setValue: setStockValue, formState: { errors: stockErrors } } = useForm<StockForm>()

  const addStockMutation = useMutation({
    mutationFn: (body: any) => api.post('/inventory/add', body),
    onSuccess: () => {
      toast.success(t('spareParts.toast.received'))
      invalidateStock()
      setStockModal(null); resetStock()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const { register, handleSubmit, reset, setValue, getValues, formState: { errors } } = useForm<SparePartForm>()
  const [imageFile, setImageFile] = useState<File | null>(null)
  const [imagePreview, setImagePreview] = useState<string | null>(null)
  const [nameSearch, setNameSearch] = useState('')
  const [debouncedNameSearch, setDebouncedNameSearch] = useState('')
  const [showSuggestions, setShowSuggestions] = useState(false)
  const suggestRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedNameSearch(nameSearch), 300)
    return () => clearTimeout(t)
  }, [nameSearch])

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (suggestRef.current && !suggestRef.current.contains(e.target as Node)) {
        setShowSuggestions(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const { data: suggestions } = useQuery({
    queryKey: ['spare-parts-suggest', debouncedNameSearch],
    queryFn: () => api.get('/spare-parts', { params: { search: debouncedNameSearch, limit: 6 } }).then(r => r.data.data),
    enabled: debouncedNameSearch.length >= 2 && !selected,
  })

  const applySuggestion = async (sp: SparePart) => {
    setValue('name', sp.name)
    setValue('category', sp.category)
    setValue('unitPrice', String(sp.unitPrice))
    setValue('supplierId', sp.supplier?.id || '')
    setValue('description', sp.description || '')
    setNameSearch(sp.name)
    setShowSuggestions(false)
    // Yangi unikal kod avtomatik generatsiya
    try {
      const res = await api.get('/spare-parts/next-code', { params: { base: sp.partCode } })
      setValue('partCode', res.data.data.code)
    } catch {
      setValue('partCode', '')
    }
  }

  const saveMutation = useMutation({
    mutationFn: (body: SparePartForm) => {
      const fd = new FormData()
      Object.entries(body).forEach(([k, v]) => v !== undefined && fd.append(k, v))
      if (imageFile) fd.append('image', imageFile)
      return selected
        ? api.put(`/spare-parts/${selected.id}`, fd, { headers: { 'Content-Type': 'multipart/form-data' } })
        : api.post('/spare-parts', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      toast.success(selected ? 'Yangilandi' : "Qo'shildi")
      invalidateStock()
      setModalOpen(false); reset(); setSelected(null); setNameSearch(''); setImageFile(null); setImagePreview(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/spare-parts/${id}`),
    onSuccess: () => {
      toast.success(t('spareParts.toast.deleted'))
      invalidateStock()
      setDeleteConfirm(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "O'chirishda xato"),
  })

  const reactivateMutation = useMutation({
    mutationFn: (id: string) => api.post(`/spare-parts/${id}/reactivate`),
    onSuccess: () => {
      toast.success('Qayta faollashtirildi')
      invalidateStock()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const bulkDeleteMutation = useMutation({
    mutationFn: (ids: string[]) => api.post('/spare-parts/bulk-delete', { ids }).then(r => r.data),
    onSuccess: (r: any) => {
      toast.success(r?.message || 'O\'chirildi')
      setSelectedIds(new Set()); setBulkConfirm(false)
      invalidateStock()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "O'chirishda xato"),
  })

  const hardDeleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/spare-parts/${id}/hard`),
    onSuccess: () => {
      toast.success('Butunlay o\'chirildi')
      invalidateStock()
      setHardDeleteConfirm(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || "O'chirishda xato"),
  })

  const generateCodeMutation = useMutation({
    mutationFn: (sparePartId: string) => api.post('/article-codes/generate', { sparePartId }),
    onSuccess: (res) => {
      toast.success(`Artikul kod: ${res.data.data.code}`)
      invalidateStock()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const suggestCodeMutation = useMutation({
    mutationFn: ({ category, name }: { category: string; name: string }) =>
      api.get('/spare-parts/suggest-code', { params: { category, name } }),
    onSuccess: (res) => {
      setValue('partCode', res.data.data.code, { shouldValidate: true })
      toast.success(`Artikul kod: ${res.data.data.code}`)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleSuggestCode = () => {
    const v = getValues()
    if (!v.category) return toast.error(t('spareParts.toast.selectCategory'))
    suggestCodeMutation.mutate({ category: v.category, name: v.name || '' })
  }

  const openEdit = (sp: SparePart) => {
    setSelected(sp)
    setValue('name', sp.name); setValue('partCode', sp.partCode); setValue('category', sp.category)
    setValue('unitPrice', String(sp.unitPrice)); setValue('supplierId', sp.supplier.id)
    setValue('description', sp.description || '')
    setNameSearch(sp.name)
    setImageFile(null)
    setImagePreview(sp.imageUrl ? getFileUrl(sp.imageUrl) : null)
    setModalOpen(true)
  }

  const handleImageChange = useCallback((file: File | null) => {
    if (file && file.size > 5 * 1024 * 1024) {
      toast.error(t('spareParts.imageMaxSize'))
      return
    }
    setImageFile(file)
    if (file) {
      const reader = new FileReader()
      reader.onload = e => setImagePreview(e.target?.result as string)
      reader.readAsDataURL(file)
    } else {
      setImagePreview(null)
    }
  }, [])

  const catColors: Record<string, any> = { engine: 'danger', brake: 'warning', suspension: 'info', electrical: 'default', body: 'gray', other: 'gray' }

  const pageRows: SparePart[] = data?.data || []
  const allPageSelected = pageRows.length > 0 && pageRows.every(r => selectedIds.has(r.id))
  const toggleOne = (id: string) => setSelectedIds(prev => {
    const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n
  })
  const toggleAllPage = () => setSelectedIds(prev => {
    const n = new Set(prev)
    if (allPageSelected) pageRows.forEach(r => n.delete(r.id))
    else pageRows.forEach(r => n.add(r.id))
    return n
  })

  const selectColumn = {
    key: 'select',
    title: <input type="checkbox" checked={allPageSelected} onChange={toggleAllPage} className="w-4 h-4 rounded cursor-pointer accent-blue-600" title="Sahifadagi hammasini tanlash" />,
    render: (sp: SparePart) => (
      <input type="checkbox" checked={selectedIds.has(sp.id)} onChange={() => toggleOne(sp.id)} className="w-4 h-4 rounded cursor-pointer accent-blue-600" />
    ),
  }

  const columns = [
    ...(canBulk ? [selectColumn] : []),
    {
      key: 'image', title: '', render: (sp: SparePart) => sp.imageUrl
        ? <img src={getFileUrl(sp.imageUrl)} alt={sp.name} className="w-10 h-10 rounded-lg object-cover border border-gray-200 dark:border-gray-600" />
        : <div className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center"><ImageIcon className="w-4 h-4 text-gray-400" /></div>
    },
    { key: 'partCode', title: 'Kod', render: (sp: SparePart) => <span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded">{sp.partCode}</span> },
    { key: 'name', title: 'Nomi', render: (sp: SparePart) => <div><p className="font-medium">{sp.name}</p>{sp.description && <p className="text-xs text-gray-400 truncate max-w-xs">{sp.description}</p>}</div> },
    { key: 'category', title: 'Kategoriya', render: (sp: SparePart) => <Badge variant={catColors[sp.category]}>{CATEGORY_LABELS[sp.category] || sp.category}</Badge> },
    { key: 'unitPrice', title: 'Narxi', render: (sp: SparePart) => formatCurrency(Number(sp.unitPrice)) },
    { key: 'totalQuantity', title: 'Omborda', render: (sp: any) => (
      <span className={`font-semibold ${sp.totalQuantity === 0 ? 'text-red-500' : sp.totalQuantity <= 1 ? 'text-amber-500' : 'text-green-600 dark:text-green-400'}`}>
        {sp.totalQuantity ?? 0} ta
      </span>
    )},
    { key: 'supplier', title: "Yetkazuvchi", render: (sp: SparePart) => <span className="text-sm text-gray-700 dark:text-gray-300">{sp.supplier?.name}</span> },
    { key: 'maintenance', title: "Ta'mirlar", render: (sp: SparePart) => (
      <button
        onClick={() => setMaintModal({ sparePartId: sp.id, name: sp.name })}
        className="flex items-center gap-1 text-sm text-purple-600 dark:text-purple-400 hover:underline"
        title={t('spareParts.historyTitle')}
      >
        <Wrench className="w-3.5 h-3.5" />Ko'rish
      </button>
    )},
    { key: 'isActive', title: 'Holat', render: (sp: SparePart) => <Badge variant={sp.isActive ? 'success' : 'danger'}>{sp.isActive ? 'Faol' : 'Nofaol'}</Badge> },
    {
      key: 'actions', title: '', render: (sp: SparePart) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" title={t('spareParts.historyBtnTitle')} icon={<History className="w-4 h-4 text-blue-500" />}
            onClick={() => setHistoryModal({ sparePartId: sp.id, name: sp.name })} />
          <Button size="sm" variant="ghost" title="QR kod" icon={<QrCode className="w-4 h-4" />}
            onClick={() => setQrModal({ open: true, sparePartId: sp.id, name: sp.name })} />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button size="sm" variant="ghost" title={t('spareParts.receiveBtnTitle')} icon={<PackagePlus className="w-4 h-4 text-green-600" />}
              onClick={() => { resetStock(); setStockValue('unitPrice', String(sp.unitPrice)); setStockModal({ sparePartId: sp.id, name: sp.name, unitPrice: sp.unitPrice }) }} />
          )}
          {hasRole('admin', 'manager') && (
            <>
              <Button size="sm" variant="ghost" title={t('spareParts.codeGenBtnTitle')} icon={<Zap className="w-4 h-4 text-yellow-500" />}
                loading={generateCodeMutation.isPending}
                onClick={() => generateCodeMutation.mutate(sp.id)} />
              <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(sp)} />
            </>
          )}
          {hasRole('admin') && sp.isActive && (
            <Button size="sm" variant="ghost"
              icon={<Trash2 className="w-4 h-4 text-red-500" />}
              title="Nofaol qilish"
              onClick={() => setDeleteConfirm(sp)} />
          )}
          {hasRole('admin') && !sp.isActive && (
            <>
              <Button size="sm" variant="ghost"
                icon={<RotateCcw className="w-4 h-4 text-green-600" />}
                title="Qayta faollashtirish"
                loading={reactivateMutation.isPending}
                onClick={() => reactivateMutation.mutate(sp.id)} />
              <Button size="sm" variant="ghost"
                icon={<Trash2 className="w-4 h-4 text-red-600" />}
                title="Butunlay o'chirish"
                onClick={() => setHardDeleteConfirm(sp)} />
            </>
          )}
        </div>
      )
    },
  ]

  const suppliers = (suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))
  const categoryOptions = PART_CATEGORIES.map(c => ({ value: c, label: CATEGORY_LABELS[c] || c }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('spareParts.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('spareParts.totalCount', { count: data?.meta?.total || 0 })}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton
            endpoint="/exports/spare-parts"
            params={{ category: categoryFilter || undefined }}
            label="Excel yuklab olish"
          />
          {hasRole('admin', 'manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setSelected(null); setNameSearch(''); setImageFile(null); setImagePreview(null); setModalOpen(true) }}>Qo'shish</Button>
          )}
        </div>
      </div>

      {/* Tab switcher */}
      <div className="flex gap-2">
        <button onClick={() => setViewTab('list')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewTab === 'list' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
          <Package className="w-4 h-4" />Ro'yxat
        </button>
        <button onClick={() => setViewTab('stats')}
          className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${viewTab === 'stats' ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
          <BarChart2 className="w-4 h-4" />{t('spareParts.statistics')}
        </button>
      </div>

      {viewTab === 'list' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
              <input placeholder={t('spareParts.searchPlaceholder')} className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                value={search} onChange={e => { setSearch(e.target.value) }} />
            </div>
            <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('spareParts.allCategories')}</option>
              {categoryOptions.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Barcha holat</option>
              <option value="true">Faol</option>
              <option value="false">Nofaol</option>
            </select>
          </div>
          {canBulk && selectedIds.size > 0 && (
            <div className="px-4 py-2.5 bg-red-50 dark:bg-red-900/20 border-b border-red-200 dark:border-red-900/40 flex items-center justify-between gap-3">
              <span className="text-sm font-medium text-red-700 dark:text-red-300">{selectedIds.size} ta tanlandi</span>
              <div className="flex items-center gap-2">
                <button onClick={() => setSelectedIds(new Set())} className="text-sm text-gray-500 hover:text-gray-700 dark:hover:text-gray-300">Bekor</button>
                <button onClick={() => setBulkConfirm(true)}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors">
                  <Trash2 className="w-4 h-4" /> O'chirish ({selectedIds.size})
                </button>
              </div>
            </div>
          )}
          <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
          <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
        </div>
      )}

      {viewTab === 'stats' && (
        <div className="space-y-4">
          {/* Overview cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {[
              { label: 'Jami qismlar', value: statsOverview?.totalParts || 0 },
              { label: 'Kuzatilayotgan', value: statsOverview?.trackedParts || 0 },
              { label: 'Jami ishlatilgan', value: (statsOverview?.totalUsed || 0).toLocaleString() },
              { label: 'Jami xarajat', value: formatCurrency(statsOverview?.totalCost || 0) },
            ].map(card => (
              <div key={card.label} className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
                <p className="text-sm text-gray-500 dark:text-gray-400">{card.label}</p>
                <p className="text-xl font-bold text-gray-900 dark:text-white mt-1">{card.value}</p>
              </div>
            ))}
          </div>

          {/* Top used chart */}
          {statsRanking?.topUsed?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="font-semibold text-gray-800 dark:text-white mb-4">Ko'p ishlatilgan qismlar (Top 10)</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsRanking.topUsed} margin={{ top: 5, right: 5, bottom: 40, left: 5 }}>
                    <XAxis dataKey="sparePart.name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                    <YAxis tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="totalUsed" name="Ishlatilgan" fill="#3B82F6" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}

          {/* Top by cost chart */}
          {statsRanking?.topCost?.length > 0 && (
            <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
              <h3 className="font-semibold text-gray-800 dark:text-white mb-4">{t('spareParts.topExpensive')}</h3>
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={statsRanking.topCost} margin={{ top: 5, right: 5, bottom: 40, left: 5 }}>
                    <XAxis dataKey="sparePart.name" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => `${(v / 1_000_000).toFixed(0)}M`} />
                    <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                    <Bar dataKey="totalCost" name="Xarajat" fill="#10B981" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Add/Edit Modal */}
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setSelected(null); reset(); setNameSearch(''); setImageFile(null); setImagePreview(null) }}
        title={selected ? 'Ehtiyot qism tahrirlash' : "Ehtiyot qism qo'shish"} size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setNameSearch(''); setImageFile(null); setImagePreview(null) }}>{t('common.cancel')}</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Nomi field with autocomplete */}
          <div ref={suggestRef} className="relative">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('spareParts.nameRequired')}</label>
            <input
              className={`w-full px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${errors.name ? 'border-red-400 dark:border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
              value={nameSearch}
              onChange={e => {
                setNameSearch(e.target.value)
                setValue('name', e.target.value, { shouldValidate: true })
                setShowSuggestions(true)
              }}
              onFocus={() => { if (nameSearch.length >= 2) setShowSuggestions(true) }}
              placeholder={t('spareParts.namePlaceholder')}
              autoComplete="off"
            />
            <input type="hidden" {...register('name', { required: 'Talab qilinadi' })} />
            {errors.name && <p className="text-red-500 text-xs mt-1">{errors.name.message}</p>}
            {/* Suggestions dropdown */}
            {showSuggestions && !selected && suggestions && suggestions.length > 0 && (
              <div className="absolute z-50 left-0 right-0 mt-1 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg shadow-lg max-h-56 overflow-y-auto">
                <p className="text-xs text-gray-400 px-3 pt-2 pb-1">{t('spareParts.existingHint')}</p>
                {suggestions.map((sp: SparePart) => (
                  <button
                    key={sp.id}
                    type="button"
                    className="w-full text-left px-3 py-2 hover:bg-blue-50 dark:hover:bg-gray-700 transition-colors border-t border-gray-100 dark:border-gray-700 first:border-t-0"
                    onClick={() => applySuggestion(sp)}
                  >
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{sp.name}</p>
                    <p className="text-xs text-gray-400">{sp.partCode} · {CATEGORY_LABELS[sp.category] || sp.category} · {formatCurrency(Number(sp.unitPrice))}</p>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('spareParts.codeRequired')}</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder={t('spareParts.codePlaceholder')}
                className={`flex-1 px-3 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${errors.partCode ? 'border-red-300' : 'border-gray-300 dark:border-gray-600'}`}
                {...register('partCode', { required: 'Talab qilinadi' })}
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
            {errors.partCode && <p className="text-xs text-red-500 mt-1">{errors.partCode.message}</p>}
            <p className="text-xs text-gray-400 mt-1">"⚡ Avto" tugmasi kategoriya va nom asosida unikal kod yaratadi</p>
          </div>
          <Select label={t('spareParts.categoryRequired')} options={categoryOptions} placeholder="Tanlang" error={errors.category?.message} {...register('category', { required: 'Talab qilinadi' })} />
          <Input label="Narxi (so'm) *" type="number" error={errors.unitPrice?.message} {...register('unitPrice', { required: 'Talab qilinadi', min: { value: 0, message: "Manfiy bo'lmasligi kerak" } })} />
          <Select label={t('spareParts.supplierRequired')} options={suppliers} placeholder="Tanlang" error={errors.supplierId?.message} {...register('supplierId', { required: 'Talab qilinadi' })} />
          {/* Image upload */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('spareParts.image')}</label>
            <div
              className="mt-1 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-xl overflow-hidden cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => document.getElementById('sp-image-upload')?.click()}
              onDragOver={e => e.preventDefault()}
              onDrop={e => { e.preventDefault(); handleImageChange(e.dataTransfer.files[0] || null) }}
            >
              {imagePreview ? (
                <div className="relative group">
                  <img src={imagePreview} alt="preview" className="w-full h-40 object-contain bg-gray-50 dark:bg-gray-700" />
                  <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                    <p className="text-white text-sm font-medium">{t('spareParts.imageChange')}</p>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-2 py-6 text-gray-400">
                  <Upload className="w-8 h-8" />
                  <p className="text-sm">{t('spareParts.imagePlaceholder')}</p>
                  <p className="text-xs">JPG, PNG, WebP — max 5MB</p>
                </div>
              )}
            </div>
            <input id="sp-image-upload" type="file" accept="image/*" className="hidden"
              onChange={e => handleImageChange(e.target.files?.[0] || null)} />
            {imagePreview && (
              <button type="button" className="text-xs text-red-500 mt-1 hover:underline"
                onClick={() => handleImageChange(null)}>{t('spareParts.imageDelete')}</button>
            )}
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('spareParts.description')}</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('description')} />
          </div>

          {/* Boshlang'ich ombor kirimi — faqat yangi qism qo'shilayotganda ko'rsatiladi */}
          {!selected && (
            <div className="pt-3 border-t border-gray-200 dark:border-gray-700">
              <p className="text-xs font-medium text-gray-500 dark:text-gray-400 mb-2">
                Boshlang'ich ombor kirimi (ixtiyoriy)
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Select label={t('spareParts.warehouseLabel')} options={warehouses} placeholder="Tanlang" {...register('warehouseId')} />
                <Input label="Miqdor (dona)" type="number" min={0} placeholder="0" {...register('initialQuantity')} />
                <Input label="Min. daraja" type="number" min={0} placeholder="5" hint="Ogohlantirish darajasi" {...register('reorderLevel')} />
              </div>
              <p className="text-xs text-gray-400 mt-2">{t('spareParts.quantityHint')}</p>
            </div>
          )}
        </div>
      </Modal>

      {/* Add stock modal */}
      <Modal open={!!stockModal} onClose={() => { setStockModal(null); resetStock() }}
        title={`Kirim — ${stockModal?.name}`} size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setStockModal(null); resetStock() }}>{t('common.cancel')}</Button>
            <Button loading={addStockMutation.isPending}
              onClick={handleStock(d => addStockMutation.mutate({ sparePartId: stockModal?.sparePartId, ...d }))}>
              Saqlash
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <Select label={t('spareParts.warehouseRequired')} options={warehouses} placeholder="Tanlang" error={stockErrors.warehouseId?.message}
            {...regStock('warehouseId', { required: 'Sklad tanlanishi shart' })} />
          <Input label="Miqdor (dona) *" type="number" placeholder="0" min={1} error={stockErrors.quantity?.message}
            {...regStock('quantity', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
          <Input label="Narxi (so'm)" type="number" placeholder={String(stockModal?.unitPrice || '')} min={0}
            hint="Bo'sh qoldirilsa mavjud narx saqlanadi"
            {...regStock('unitPrice')} />
          <Input label="Minimal daraja" type="number" placeholder="5" min={0}
            hint="Shu miqdordan kam bo'lganda ogohlantirish beriladi"
            {...regStock('reorderLevel')} />
        </div>
      </Modal>

      {/* Maintenance usage modal */}
      <Modal open={!!maintModal} onClose={() => setMaintModal(null)} title={`"${maintModal?.name}" — ta'mirlarda ishlatilgan`} size="lg"
        footer={<Button variant="outline" onClick={() => setMaintModal(null)}>{t('common.close')}</Button>}>
        {maintLoading ? (
          <div className="py-8 text-center text-gray-500">{t('spareParts.loading')}</div>
        ) : !maintData?.data?.length ? (
          <div className="py-8 text-center text-gray-400">{t('spareParts.noMaintenanceUsage')}</div>
        ) : (
          <div>
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-3">{t('spareParts.totalMaintenance', { count: maintData.meta?.total || maintData.data.length })}</p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">{t('spareParts.date')}</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">{t('spareParts.vehicle')}</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">{t('spareParts.quantity')}</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">{t('spareParts.price')}</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">{t('spareParts.performedBy')}</th>
                  </tr>
                </thead>
                <tbody>
                  {maintData.data.map((m: any) => (
                    <tr key={m.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{new Date(m.installationDate).toLocaleDateString('uz-UZ')}</td>
                      <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">{m.vehicle?.registrationNumber} <span className="text-gray-400 font-normal">{m.vehicle?.brand} {m.vehicle?.model}</span></td>
                      <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{m.quantityUsed} ta</td>
                      <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{formatCurrency(Number(m.cost))}</td>
                      <td className="py-2 px-3 text-gray-500 dark:text-gray-400">{m.performedBy?.fullName || m.workerName || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      {/* QR Code Modal */}
      <Modal open={!!qrModal?.open} onClose={() => setQrModal(null)} title={`QR Kod — ${qrModal?.name}`} size="sm">
        <div className="flex flex-col items-center gap-4 py-4">
          {qrLoading ? (
            <div className="w-10 h-10 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          ) : qrData?.dataUrl ? (
            <>
              <img src={qrData.dataUrl} alt="QR Code" className="w-52 h-52" />
              <p className="text-sm font-mono bg-gray-100 dark:bg-gray-700 px-3 py-1.5 rounded text-gray-700 dark:text-gray-200">{qrData.code}</p>
              <a href={qrData.dataUrl} download={`${qrData.code}-qr.png`}>
                <Button size="sm" variant="outline">PNG yuklash</Button>
              </a>
            </>
          ) : (
            <div className="text-center space-y-3">
              <p className="text-gray-500 text-sm">{t('spareParts.noCode')}</p>
              {hasRole('admin', 'manager') && qrModal?.sparePartId && (
                <Button size="sm" icon={<Zap className="w-4 h-4" />}
                  loading={generateCodeMutation.isPending}
                  onClick={() => generateCodeMutation.mutate(qrModal.sparePartId)}>
                  Artikul kod yaratish
                </Button>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* Soft delete (nofaol qilish) confirmation */}
      <Modal open={!!deleteConfirm} onClose={() => setDeleteConfirm(null)} title="Nofaol qilish">
        <div className="space-y-4">
          <p className="text-gray-600 dark:text-gray-300">
            <span className="font-semibold text-gray-900 dark:text-white">{deleteConfirm?.name}</span> ehtiyot qismi <b>nofaol</b> qilinadi
            (ro'yxatdan yashiriladi, lekin tarix saqlanadi). Keyinchalik qayta faollashtirishingiz mumkin.
          </p>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={deleteMutation.isPending}
              onClick={() => deleteConfirm && deleteMutation.mutate(deleteConfirm.id)}>
              Nofaol qilish
            </Button>
          </div>
        </div>
      </Modal>

      {/* Hard delete (butunlay o'chirish) confirmation */}
      <Modal open={!!hardDeleteConfirm} onClose={() => setHardDeleteConfirm(null)} title="Butunlay o'chirish">
        <div className="space-y-4">
          <div className="flex items-start gap-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div className="text-sm text-red-700 dark:text-red-300">
              <p className="font-semibold mb-1">Diqqat! Bu amalni qaytarib bo'lmaydi.</p>
              <p>
                <span className="font-semibold">{hardDeleteConfirm?.name}</span> tizimdan <b>butunlay</b> o'chiriladi.
                Faqat <b>qoldig'i 0</b> va <b>hech qachon ishlatilmagan</b> (ta'mir/o'tkazma/so'rov tarixi yo'q)
                tovarlarni o'chirish mumkin. Aks holda tizim ruxsat bermaydi.
              </p>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <Button variant="secondary" onClick={() => setHardDeleteConfirm(null)}>{t('common.cancel')}</Button>
            <Button variant="danger" loading={hardDeleteMutation.isPending}
              onClick={() => hardDeleteConfirm && hardDeleteMutation.mutate(hardDeleteConfirm.id)}>
              Ha, butunlay o'chirish
            </Button>
          </div>
        </div>
      </Modal>

      <SparePartHistoryModal
        open={!!historyModal}
        onClose={() => setHistoryModal(null)}
        sparePartId={historyModal?.sparePartId || null}
        sparePartName={historyModal?.name}
      />

      <ConfirmDialog
        open={bulkConfirm}
        title="Ommaviy o'chirish"
        message={`${selectedIds.size} ta ehtiyot qism o'chiriladi. Ishlatilmaganlari qoldig'i bilan butunlay o'chadi, ishlatilganlari (ta'mir/o'tkazma tarixi borlari) nofaol qilinadi. Davom etasizmi?`}
        confirmLabel="Ha, o'chirish"
        cancelLabel="Yo'q"
        loading={bulkDeleteMutation.isPending}
        onConfirm={() => bulkDeleteMutation.mutate(Array.from(selectedIds))}
        onCancel={() => setBulkConfirm(false)}
      />
    </div>
  )
}
