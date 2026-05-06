import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, Wallet, TrendingDown, Car, Tag, Calendar, Edit2, Trash2, Image as ImageIcon, TrendingUp, X, Upload } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import api, { getFileUrl } from '../lib/api'
import { formatCurrency } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Pagination from '../components/ui/Pagination'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'

interface Expense {
  id: string
  amount: number
  description?: string
  expenseDate: string
  receiptUrl?: string | null
  vehicle?: { id: string; registrationNumber: string; brand: string; model: string }
  category?: { id: string; name: string }
  createdBy?: { fullName: string }
}

interface ExpenseForm {
  vehicleId: string
  categoryId: string
  amount: string
  description: string
  expenseDate: string
}

export default function Expenses() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [deleteId, setDeleteId] = useState<string | null>(null)
  const [catModalOpen, setCatModalOpen] = useState(false)
  const [newCatName, setNewCatName] = useState('')
  const [receiptFile, setReceiptFile] = useState<File | null>(null)
  const [lightboxImage, setLightboxImage] = useState<string | null>(null)

  // Lightbox Esc bilan yopish
  useEffect(() => {
    if (!lightboxImage) return
    const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightboxImage(null) }
    window.addEventListener('keydown', onEsc)
    return () => window.removeEventListener('keydown', onEsc)
  }, [lightboxImage])

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', page, limit, vehicleFilter, categoryFilter, from, to, debouncedSearch],
    queryFn: () => api.get('/expenses', {
      params: {
        page, limit,
        vehicleId: vehicleFilter || undefined,
        categoryId: categoryFilter || undefined,
        from: from || undefined,
        to: to || undefined,
        search: debouncedSearch || undefined,
      }
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])

  const { data: categoriesData } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get('/expenses/categories').then(r => r.data.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-list'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
  })

  const { data: stats } = useQuery({
    queryKey: ['expense-stats'],
    queryFn: () => api.get('/expenses/stats').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ExpenseForm>({
    defaultValues: { expenseDate: new Date().toISOString().slice(0, 10) }
  })

  const saveMutation = useMutation({
    mutationFn: (body: ExpenseForm) => {
      const fd = new FormData()
      Object.entries(body).forEach(([k, v]) => v != null && fd.append(k, String(v)))
      if (receiptFile) fd.append('receipt', receiptFile)
      const config = { headers: { 'Content-Type': 'multipart/form-data' } }
      if (editing) return api.put(`/expenses/${editing.id}`, fd, config)
      return api.post('/expenses', fd, config)
    },
    onSuccess: () => {
      toast.success(editing ? t('expenses.toastUpdated') : t('expenses.toastAdded'))
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['expense-stats'] })
      setModalOpen(false)
      setEditing(null)
      setReceiptFile(null)
      reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('expenses.toastError')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/expenses/${id}`),
    onSuccess: () => {
      toast.success(t('expenses.toastDeleted'))
      qc.invalidateQueries({ queryKey: ['expenses'] })
      qc.invalidateQueries({ queryKey: ['expense-stats'] })
      setDeleteId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('expenses.toastError')),
  })

  const createCatMutation = useMutation({
    mutationFn: (name: string) => api.post('/expenses/categories', { name }),
    onSuccess: () => {
      toast.success(t('expenses.toastCatAdded'))
      qc.invalidateQueries({ queryKey: ['expense-categories'] })
      setCatModalOpen(false)
      setNewCatName('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('expenses.toastError')),
  })

  const openEdit = (e: Expense) => {
    setEditing(e)
    setReceiptFile(null)
    reset({
      vehicleId: e.vehicle?.id || '',
      categoryId: e.category?.id || '',
      amount: String(e.amount),
      description: e.description || '',
      expenseDate: new Date(e.expenseDate).toISOString().slice(0, 10),
    })
    setModalOpen(true)
  }

  // Summary stats
  const expenses: Expense[] = data?.data || []
  const pageAmount = expenses.reduce((s, e) => s + Number(e.amount), 0)
  // Backend filter bo'yicha umumiy summa qaytaradi (sahifa emas, hammasi)
  const totalAmount: number = Number(data?.meta?.totalSum ?? pageAmount)

  const columns = [
    {
      key: 'date', title: t('expenses.colDate'), render: (e: Expense) => (
        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <Calendar className="w-3.5 h-3.5 text-gray-400" />
          {new Date(e.expenseDate).toLocaleDateString('uz-UZ')}
        </div>
      )
    },
    {
      key: 'vehicle', title: t('expenses.colVehicle'), render: (e: Expense) => e.vehicle ? (
        <button
          onClick={() => navigate(`/vehicles/${e.vehicle!.id}`)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          <Car className="w-3.5 h-3.5" />
          {e.vehicle.registrationNumber} — {e.vehicle.brand} {e.vehicle.model}
        </button>
      ) : <span className="text-gray-400 text-sm">—</span>
    },
    {
      key: 'category', title: t('expenses.colCategory'), render: (e: Expense) => e.category ? (
        <span className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
          <Tag className="w-3 h-3" />{e.category.name}
        </span>
      ) : <span className="text-gray-400 text-sm">—</span>
    },
    {
      key: 'description', title: t('expenses.colDescription'), render: (e: Expense) => (
        <span className="text-sm text-gray-600 dark:text-gray-300 line-clamp-1 max-w-xs">{e.description || '—'}</span>
      )
    },
    {
      key: 'receipt', title: t('expenses.colReceipt'), render: (e: Expense) => e.receiptUrl ? (
        <button
          onClick={() => setLightboxImage(getFileUrl(e.receiptUrl!))}
          className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20"
          title={t('expenses.tooltipViewReceipt')}
        >
          <ImageIcon className="w-4 h-4 text-blue-500" />
        </button>
      ) : <span className="text-gray-300 text-xs">—</span>
    },
    {
      key: 'amount', title: t('expenses.colAmount'), render: (e: Expense) => (
        <span className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(Number(e.amount))}</span>
      )
    },
    {
      key: 'createdBy', title: t('expenses.colCreatedBy'), render: (e: Expense) => (
        <span className="text-xs text-gray-500 dark:text-gray-400">{e.createdBy?.fullName || '—'}</span>
      )
    },
    ...(hasRole('admin', 'manager', 'branch_manager') ? [{
      key: 'actions', title: '', render: (e: Expense) => (
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => openEdit(e)}
            className="p-1.5 text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded"
            title={t('expenses.tooltipEdit')}
          >
            <Edit2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={() => setDeleteId(e.id)}
            className="p-1.5 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded"
            title={t('expenses.tooltipDelete')}
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      )
    }] : []),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('expenses.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('expenses.subtitle', { count: data?.meta?.total || 0 })}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/expenses" label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>
              {t('expenses.addBtn')}
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards — bu oy / o'tgan oy / filter / kategoriya */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
              <Wallet className="w-4 h-4 text-red-500" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('expenses.statThisMonth')}</p>
          </div>
          <p className="text-lg font-bold text-red-600 dark:text-red-400">
            {stats?.thisMonth ? formatCurrency(Number(stats.thisMonth.sum)) : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">{t('expenses.statRecords', { count: stats?.thisMonth?.count || 0 })}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-amber-100 dark:bg-amber-900/30 rounded-lg flex items-center justify-center">
              {stats?.changePct != null && stats.changePct > 0
                ? <TrendingUp className="w-4 h-4 text-amber-500" />
                : <TrendingDown className="w-4 h-4 text-amber-500" />}
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('expenses.statVsLast')}</p>
          </div>
          <p className={`text-lg font-bold ${stats?.changePct != null && stats.changePct > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
            {stats?.changePct != null ? `${stats.changePct > 0 ? '+' : ''}${stats.changePct}%` : '—'}
          </p>
          <p className="text-xs text-gray-400 mt-0.5">
            {stats?.lastMonth ? t('expenses.statLastMonth', { amount: formatCurrency(Number(stats.lastMonth.sum)) }) : '—'}
          </p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
              <TrendingDown className="w-4 h-4 text-blue-500" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('expenses.statFilterTotal')}</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(totalAmount)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{t('expenses.statRecords', { count: data?.meta?.total || 0 })}</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <div className="w-8 h-8 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <Tag className="w-4 h-4 text-purple-500" />
            </div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('expenses.statTopCategory')}</p>
          </div>
          {stats?.byCategory?.[0] ? (
            <>
              <p className="text-sm font-bold text-gray-900 dark:text-white truncate">{stats.byCategory[0].name}</p>
              <p className="text-xs text-purple-600 dark:text-purple-400 mt-0.5">{formatCurrency(Number(stats.byCategory[0].sum))}</p>
            </>
          ) : (
            <p className="text-lg font-bold text-gray-400">—</p>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder={t('expenses.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select value={vehicleFilter} onChange={e => { setVehicleFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t('expenses.filterAllVehicles')}</option>
            {(vehiclesData || []).map((v: any) => (
              <option key={v.id} value={v.id}>{v.registrationNumber} — {v.brand} {v.model}</option>
            ))}
          </select>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t('expenses.filterAllCategories')}</option>
            {(categoriesData || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {(vehicleFilter || categoryFilter || from || to) && (
            <Button size="sm" variant="outline" onClick={() => { setVehicleFilter(''); setCategoryFilter(''); setFrom(''); setTo(''); setPage(1) }}>
              {t('expenses.clearFilter')}
            </Button>
          )}
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Add/Edit expense modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditing(null); reset() }}
        title={editing ? t('expenses.modalEditTitle') : t('expenses.modalAddTitle')}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); setEditing(null) }}>{t('expenses.cancelBtn')}</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>
              {editing ? t('expenses.updateBtn') : t('expenses.saveBtn')}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('expenses.labelVehicle')}</label>
            <select {...register('vehicleId', { required: t('expenses.validVehicle') })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('expenses.selectDefault')}</option>
              {(vehiclesData || []).map((v: any) => (
                <option key={v.id} value={v.id}>{v.registrationNumber} — {v.brand} {v.model}</option>
              ))}
            </select>
            {errors.vehicleId && <p className="text-xs text-red-500 mt-1">{errors.vehicleId.message}</p>}
          </div>
          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('expenses.labelCategory')}</label>
              {hasRole('admin', 'manager') && (
                <button
                  type="button"
                  onClick={() => setCatModalOpen(true)}
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-0.5"
                >
                  <Plus className="w-3 h-3" /> {t('expenses.addCategoryBtn')}
                </button>
              )}
            </div>
            <select {...register('categoryId', { required: t('expenses.validCategory') })}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('expenses.selectDefault')}</option>
              {(categoriesData || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
            {errors.categoryId && <p className="text-xs text-red-500 mt-1">{errors.categoryId.message}</p>}
          </div>
          <Input
            label={t('expenses.labelAmount')}
            type="number"
            min="0"
            error={errors.amount?.message}
            {...register('amount', { required: t('expenses.validRequired'), min: { value: 0, message: t('expenses.validNonNegative') } })}
          />
          <Input label={t('expenses.labelDescription')} {...register('description')} />
          <Input
            label={t('expenses.labelDate')}
            type="date"
            error={errors.expenseDate?.message}
            {...register('expenseDate', { required: t('expenses.validRequired') })}
          />
          {/* Chek rasmi */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('expenses.labelReceipt')}</label>
            <div className="flex items-center gap-2">
              <label className="flex-1 flex items-center gap-2 px-3 py-2 border border-dashed border-gray-300 dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-700 text-sm text-gray-600 dark:text-gray-300">
                <Upload className="w-4 h-4 shrink-0" />
                <span className="truncate">{receiptFile ? receiptFile.name : (editing?.receiptUrl ? t('expenses.newPhotoLabel') : t('expenses.selectPhotoLabel'))}</span>
                <input type="file" accept="image/*" className="hidden" onChange={e => setReceiptFile(e.target.files?.[0] || null)} />
              </label>
              {receiptFile && (
                <button type="button" onClick={() => setReceiptFile(null)} className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded">
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
            {editing?.receiptUrl && !receiptFile && (
              <button
                type="button"
                onClick={() => setLightboxImage(getFileUrl(editing.receiptUrl!))}
                className="mt-2 text-xs text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
              >
                <ImageIcon className="w-3 h-3" /> {t('expenses.viewExistingReceipt')}
              </button>
            )}
          </div>
        </div>
      </Modal>

      {/* O'chirish tasdiqlash */}
      <ConfirmDialog
        open={!!deleteId}
        title={t('expenses.deleteTitle')}
        message={t('expenses.deleteMessage')}
        confirmLabel={t('expenses.deleteConfirm')}
        loading={deleteMutation.isPending}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        onCancel={() => setDeleteId(null)}
      />

      {/* Yangi kategoriya modali */}
      <Modal
        open={catModalOpen}
        onClose={() => { setCatModalOpen(false); setNewCatName('') }}
        title={t('expenses.catModalTitle')}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => { setCatModalOpen(false); setNewCatName('') }}>{t('expenses.catCancelBtn')}</Button>
            <Button
              loading={createCatMutation.isPending}
              disabled={!newCatName.trim()}
              onClick={() => createCatMutation.mutate(newCatName.trim())}
            >
              {t('expenses.catSaveBtn')}
            </Button>
          </>
        }
      >
        <div className="space-y-3">
          <Input
            label={t('expenses.catLabel')}
            placeholder={t('expenses.catPlaceholder')}
            value={newCatName}
            onChange={e => setNewCatName(e.target.value)}
            autoFocus
          />
          <p className="text-xs text-gray-500">{t('expenses.catHint')}</p>
        </div>
      </Modal>

      {/* Chek lightbox */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/90 p-4 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxImage(null) }}
            className="absolute top-4 right-4 p-2 bg-black/60 hover:bg-black/80 text-white rounded-full"
            title={t('expenses.lightboxClose')}
          >
            <X className="w-6 h-6" />
          </button>
          <a
            href={lightboxImage}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute top-4 left-4 px-3 py-1.5 bg-black/60 hover:bg-black/80 text-white rounded-lg text-xs"
            onClick={(e) => e.stopPropagation()}
          >
            {t('expenses.lightboxOpen')}
          </a>
          <img
            src={lightboxImage}
            alt="receipt-full"
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
    </div>
  )
}
