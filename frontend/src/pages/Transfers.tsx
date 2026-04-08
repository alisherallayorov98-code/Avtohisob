import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowRight, CheckCircle, Send, Package, ArrowLeftRight, Clock, Layers, Trash2, PlusCircle, AlertCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatDate, TRANSFER_STATUS } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'

interface BulkItem {
  sparePartId: string
  quantity: string
  notes: string
}

interface Transfer {
  id: string
  quantity: number
  status: string
  transferDate: string
  notes?: string
  createdAt: string
  fromBranch: { id: string; name: string }
  toBranch: { id: string; name: string }
  sparePart: { id: string; name: string; partCode: string }
  approvedBy?: { fullName: string }
}

interface TransferForm {
  fromBranchId: string
  toBranchId: string
  sparePartId: string
  quantity: string
  notes: string
}

const statusColors: Record<string, any> = { pending: 'warning', approved: 'info', shipped: 'default', received: 'success' }

export default function Transfers() {
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [statusFilter, setStatusFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [bulkFrom, setBulkFrom] = useState('')
  const [bulkTo, setBulkTo] = useState('')
  const [bulkNotes, setBulkNotes] = useState('')
  const [bulkItems, setBulkItems] = useState<BulkItem[]>([{ sparePartId: '', quantity: '1', notes: '' }])

  const { data, isLoading } = useQuery({
    queryKey: ['transfers', page, limit, statusFilter, fromDate, toDate],
    queryFn: () => api.get('/transfers', {
      params: { page, limit, status: statusFilter || undefined, from: fromDate || undefined, to: toDate || undefined }
    }).then(r => r.data),
  })

  const { data: statsData } = useQuery({
    queryKey: ['transfer-stats'],
    queryFn: () => api.get('/transfers/stats').then(r => r.data.data),
  })

  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: bulkInventory } = useQuery({
    queryKey: ['bulk-inventory', bulkFrom],
    queryFn: () => api.get('/inventory', { params: { branchId: bulkFrom, limit: 500 } }).then(r => r.data.data),
    enabled: !!bulkFrom,
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<TransferForm>()

  const createMutation = useMutation({
    mutationFn: (body: TransferForm) => api.post('/transfers', body),
    onSuccess: () => {
      toast.success('Taqsimot yaratildi')
      qc.invalidateQueries({ queryKey: ['transfers'] })
      qc.invalidateQueries({ queryKey: ['transfer-stats'] })
      setModalOpen(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const bulkMutation = useMutation({
    mutationFn: (body: { fromBranchId: string; toBranchId: string; items: BulkItem[]; notes: string }) =>
      api.post('/transfers/bulk', body),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Taqsimotlar yaratildi')
      qc.invalidateQueries({ queryKey: ['transfers'] })
      qc.invalidateQueries({ queryKey: ['transfer-stats'] })
      qc.invalidateQueries({ queryKey: ['bulk-inventory', bulkFrom] })
      setBulkOpen(false)
      setBulkFrom(''); setBulkTo(''); setBulkNotes('')
      setBulkItems([{ sparePartId: '', quantity: '1', notes: '' }])
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.put(`/transfers/${id}/${action}`),
    onSuccess: (_, { action }) => {
      const msgs: Record<string, string> = { approve: 'Tasdiqlandi', ship: "Jo'natildi", receive: 'Qabul qilindi' }
      toast.success(msgs[action] || 'Yangilandi')
      qc.invalidateQueries({ queryKey: ['transfers'] })
      qc.invalidateQueries({ queryKey: ['transfer-stats'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-stats'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Map sparePartId → quantityOnHand for the selected from-branch
  const invMap = useMemo(() => {
    const m: Record<string, number> = {}
    ;(bulkInventory || []).forEach((inv: any) => { m[inv.sparePartId] = inv.quantityOnHand })
    return m
  }, [bulkInventory])

  // Spare parts that have stock in the from-branch
  const bulkPartOptions = useMemo(() => {
    if (!bulkInventory) return (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))
    return (bulkInventory || []).map((inv: any) => ({
      value: inv.sparePartId,
      label: `${inv.sparePart?.partCode} - ${inv.sparePart?.name} (${inv.quantityOnHand} ta)`,
    }))
  }, [bulkInventory, sparePartsData])

  const handleBulkSubmit = () => {
    if (!bulkFrom || !bulkTo) return toast.error('Filiallarni tanlang')
    if (bulkFrom === bulkTo) return toast.error("Bir xil filialga bo'lmaydi")
    const validItems = bulkItems.filter(it => it.sparePartId && Number(it.quantity) > 0)
    if (!validItems.length) return toast.error('Kamida bitta qism kiriting')
    bulkMutation.mutate({ fromBranchId: bulkFrom, toBranchId: bulkTo, items: validItems, notes: bulkNotes })
  }

  const columns = [
    { key: 'route', title: "Yo'nalish", render: (t: Transfer) => (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-900 dark:text-white">{t.fromBranch?.name}</span>
        <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="font-medium text-gray-900 dark:text-white">{t.toBranch?.name}</span>
      </div>
    )},
    { key: 'sparePart', title: 'Ehtiyot qism', render: (t: Transfer) => (
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{t.sparePart?.name}</p>
        <p className="text-xs font-mono text-gray-400">{t.sparePart?.partCode}</p>
      </div>
    )},
    { key: 'quantity', title: 'Miqdor', render: (t: Transfer) => (
      <span className="font-medium text-gray-900 dark:text-white">{t.quantity} ta</span>
    )},
    { key: 'status', title: 'Holat', render: (t: Transfer) => <Badge variant={statusColors[t.status]}>{TRANSFER_STATUS[t.status]}</Badge> },
    { key: 'createdAt', title: 'Sana', render: (t: Transfer) => (
      <span className="text-sm text-gray-500 dark:text-gray-400">{formatDate(t.createdAt)}</span>
    )},
    { key: 'approvedBy', title: 'Tasdiqladi', render: (t: Transfer) => (
      <span className="text-sm text-gray-500 dark:text-gray-400">{t.approvedBy?.fullName || '—'}</span>
    )},
    { key: 'notes', title: 'Izoh', render: (t: Transfer) => (
      <span className="text-xs text-gray-500 dark:text-gray-400 italic max-w-32 truncate block">{t.notes || '—'}</span>
    )},
    {
      key: 'actions', title: '', render: (t: Transfer) => (
        <div className="flex items-center gap-1">
          {t.status === 'pending' && hasRole('admin', 'manager') && (
            <Button size="sm" variant="secondary" icon={<CheckCircle className="w-3.5 h-3.5 text-green-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'approve' })}>Tasdiq</Button>
          )}
          {t.status === 'approved' && (hasRole('admin', 'manager') || user?.branchId === t.fromBranch?.id) && (
            <Button size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5 text-blue-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'ship' })}>Jo'nat</Button>
          )}
          {t.status === 'shipped' && (hasRole('admin', 'manager') || user?.branchId === t.toBranch?.id) && (
            <Button size="sm" variant="secondary" icon={<Package className="w-3.5 h-3.5 text-purple-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'receive' })}>Qabul</Button>
          )}
        </div>
      )
    },
  ]

  const branches = (branchesData || []).map((b: any) => ({ value: b.id, label: b.name }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Taqsimotlar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Filiallar orasida ehtiyot qismlar ko'chirish</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/transfers" label="Excel" />
          <Button variant="outline" icon={<Layers className="w-4 h-4" />} onClick={() => setBulkOpen(true)}>Ommaviy</Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>Yaratish</Button>
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <ArrowLeftRight className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jami</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData.total}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <Clock className="w-8 h-8 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Kutmoqda</p>
              <p className="text-xl font-bold text-yellow-600">{statsData.pending}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <Send className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jo'natildi</p>
              <p className="text-xl font-bold text-blue-600">{statsData.shipped}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <CheckCircle className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Qabul qilindi</p>
              <p className="text-xl font-bold text-green-600">{statsData.received}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha holatlar</option>
            {Object.entries(TRANSFER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
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

      {/* Bulk Transfer Modal */}
      <Modal
        open={bulkOpen}
        onClose={() => setBulkOpen(false)}
        title="Ommaviy taqsimot"
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setBulkOpen(false)}>Bekor qilish</Button>
            <Button loading={bulkMutation.isPending} icon={<Layers className="w-4 h-4" />} onClick={handleBulkSubmit}>
              {bulkItems.filter(i => i.sparePartId).length} ta qism jo'natish
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* From / To */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <SearchableSelect
                label="Qaysi filialdan *"
                options={branches}
                value={bulkFrom}
                onChange={v => { setBulkFrom(v); setBulkItems([{ sparePartId: '', quantity: '1', notes: '' }]) }}
                placeholder="Asosiy sklad..."
              />
            </div>
            <div>
              <SearchableSelect
                label="Qaysi filialga *"
                options={branches.filter((b: any) => b.value !== bulkFrom)}
                value={bulkTo}
                onChange={v => setBulkTo(v)}
                placeholder="Filial tanlang..."
              />
            </div>
          </div>

          {/* Shared notes */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Umumiy izoh</label>
            <input
              className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Ixtiyoriy..."
              value={bulkNotes}
              onChange={e => setBulkNotes(e.target.value)}
            />
          </div>

          {/* Items list */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Ehtiyot qismlar ({bulkItems.filter(i => i.sparePartId).length} ta tanlangan)
              </label>
              {!bulkFrom && (
                <span className="text-xs text-amber-500 flex items-center gap-1">
                  <AlertCircle className="w-3.5 h-3.5" /> Avval filial tanlang
                </span>
              )}
            </div>

            <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
              {bulkItems.map((item, idx) => {
                const avail = item.sparePartId ? (invMap[item.sparePartId] ?? 0) : null
                const qty = Number(item.quantity)
                const overStock = avail !== null && qty > avail
                return (
                  <div key={idx} className="flex items-start gap-2 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                    {/* Part selector */}
                    <div className="flex-1 min-w-0">
                      <SearchableSelect
                        label=""
                        options={bulkPartOptions}
                        value={item.sparePartId}
                        onChange={v => {
                          const updated = [...bulkItems]
                          updated[idx] = { ...updated[idx], sparePartId: v }
                          setBulkItems(updated)
                        }}
                        placeholder="Ehtiyot qism tanlang..."
                      />
                      {avail !== null && (
                        <p className={`text-xs mt-0.5 ${overStock ? 'text-red-500' : 'text-gray-400'}`}>
                          Mavjud: {avail} ta{overStock ? ' — yetarli emas!' : ''}
                        </p>
                      )}
                    </div>
                    {/* Quantity */}
                    <div className="w-24 flex-shrink-0">
                      <input
                        type="number"
                        min={1}
                        max={avail ?? undefined}
                        value={item.quantity}
                        onChange={e => {
                          const updated = [...bulkItems]
                          updated[idx] = { ...updated[idx], quantity: e.target.value }
                          setBulkItems(updated)
                        }}
                        className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${overStock ? 'border-red-400 dark:border-red-500' : 'border-gray-300 dark:border-gray-600'}`}
                        placeholder="Miqdor"
                      />
                    </div>
                    {/* Remove */}
                    <button
                      onClick={() => setBulkItems(bulkItems.filter((_, i) => i !== idx))}
                      disabled={bulkItems.length === 1}
                      className="mt-1 p-1.5 text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                )
              })}
            </div>

            <button
              onClick={() => setBulkItems([...bulkItems, { sparePartId: '', quantity: '1', notes: '' }])}
              className="mt-2 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
            >
              <PlusCircle className="w-4 h-4" /> Qism qo'shish
            </button>
          </div>
        </div>
      </Modal>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Taqsimot yaratish" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Yaratish</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <SearchableSelect label="Qaysi filialdan *" options={branches} value={watch('fromBranchId') || ''}
              onChange={v => setValue('fromBranchId', v, { shouldValidate: true })}
              placeholder="Filial tanlang..." error={errors.fromBranchId?.message} />
            <input type="hidden" {...register('fromBranchId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label="Qaysi filialga *" options={branches} value={watch('toBranchId') || ''}
              onChange={v => setValue('toBranchId', v, { shouldValidate: true })}
              placeholder="Filial tanlang..." error={errors.toBranchId?.message} />
            <input type="hidden" {...register('toBranchId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label="Ehtiyot qism *" options={spareParts} value={watch('sparePartId') || ''}
              onChange={v => setValue('sparePartId', v, { shouldValidate: true })}
              placeholder="Kod yoki nom bilan qidiring..." error={errors.sparePartId?.message} />
            <input type="hidden" {...register('sparePartId', { required: 'Talab qilinadi' })} />
          </div>
          <Input label="Miqdor *" type="number" error={errors.quantity?.message}
            {...register('quantity', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Izohlar</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
