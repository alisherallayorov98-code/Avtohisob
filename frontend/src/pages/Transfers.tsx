import { useState, useEffect, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, ArrowRight, CheckCircle, Send, Package, ArrowLeftRight, Clock, Layers, Trash2, PlusCircle, AlertCircle, GitFork } from 'lucide-react'
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

interface DistributeItem {
  sparePartId: string
  quantity: string
  toWarehouseId: string
  notes: string
}

interface Transfer {
  id: string
  quantity: number
  status: string
  transferDate: string
  notes?: string
  createdAt: string
  fromWarehouse: { id: string; name: string }
  toWarehouse: { id: string; name: string }
  sparePart: { id: string; name: string; partCode: string }
  approvedBy?: { fullName: string }
}

interface TransferForm {
  fromWarehouseId: string
  toWarehouseId: string
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
  const [distOpen, setDistOpen] = useState(false)
  const [distFrom, setDistFrom] = useState('')
  const [distNotes, setDistNotes] = useState('')
  const [distItems, setDistItems] = useState<DistributeItem[]>([{ sparePartId: '', quantity: '1', toWarehouseId: '', notes: '' }])

  const { data, isLoading } = useQuery({
    queryKey: ['transfers', page, limit, statusFilter, fromDate, toDate],
    queryFn: () => api.get('/transfers', {
      params: { page, limit, status: statusFilter || undefined, from: fromDate || undefined, to: toDate || undefined }
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


  const { data: statsData } = useQuery({
    queryKey: ['transfer-stats'],
    queryFn: () => api.get('/transfers/stats').then(r => r.data.data),
  })

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: bulkInventory } = useQuery({
    queryKey: ['bulk-inventory', bulkFrom],
    queryFn: () => api.get('/inventory', { params: { warehouseId: bulkFrom, limit: 500 } }).then(r => r.data.data),
    enabled: !!bulkFrom,
  })

  const { data: distInventory } = useQuery({
    queryKey: ['dist-inventory', distFrom],
    queryFn: () => api.get('/inventory', { params: { warehouseId: distFrom, limit: 500 } }).then(r => r.data.data),
    enabled: !!distFrom,
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<TransferForm>()

  const singleFromWh = watch('fromWarehouseId')
  const singleSparePartId = watch('sparePartId')

  const { data: singleInventory } = useQuery({
    queryKey: ['single-inventory', singleFromWh],
    queryFn: () => api.get('/inventory', { params: { warehouseId: singleFromWh, limit: 500 } }).then(r => r.data.data),
    enabled: !!singleFromWh,
  })

  const singleInvMap = useMemo(() => {
    const m: Record<string, number> = {}
    ;(singleInventory || []).forEach((inv: any) => { m[inv.sparePartId] = inv.quantityOnHand })
    return m
  }, [singleInventory])

  const singlePartOptions = useMemo(() => {
    if (!singleInventory) return (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))
    return (singleInventory || [])
      .filter((inv: any) => inv.quantityOnHand > 0)
      .map((inv: any) => ({
        value: inv.sparePartId,
        label: `${inv.sparePart?.partCode} - ${inv.sparePart?.name} (${inv.quantityOnHand} ta)`,
      }))
  }, [singleInventory, sparePartsData])

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
    mutationFn: (body: { fromWarehouseId: string; toWarehouseId: string; items: BulkItem[]; notes: string }) =>
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

  const distributeMutation = useMutation({
    mutationFn: (body: { fromWarehouseId: string; items: DistributeItem[]; notes: string }) =>
      api.post('/transfers/distribute', body),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Tarqatish yaratildi')
      qc.invalidateQueries({ queryKey: ['transfers'] })
      qc.invalidateQueries({ queryKey: ['transfer-stats'] })
      qc.invalidateQueries({ queryKey: ['dist-inventory', distFrom] })
      setDistOpen(false)
      setDistFrom(''); setDistNotes('')
      setDistItems([{ sparePartId: '', quantity: '1', toWarehouseId: '', notes: '' }])
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

  const warehouses = (warehousesData || []).map((w: any) => ({ value: w.id, label: w.name }))

  // Distribute modal helpers
  const distInvMap = useMemo(() => {
    const m: Record<string, { qty: number; name: string; partCode: string }> = {}
    ;(distInventory || []).forEach((inv: any) => {
      m[inv.sparePartId] = { qty: inv.quantityOnHand, name: inv.sparePart?.name || '', partCode: inv.sparePart?.partCode || '' }
    })
    return m
  }, [distInventory])

  const distPartOptions = useMemo(() => {
    if (!distInventory) return (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))
    return (distInventory || []).map((inv: any) => ({
      value: inv.sparePartId,
      label: `${inv.sparePart?.partCode} - ${inv.sparePart?.name} (${inv.quantityOnHand} ta)`,
    }))
  }, [distInventory, sparePartsData])

  // Per-part total allocated across all rows
  const distAllocated = useMemo(() => {
    const m: Record<string, number> = {}
    distItems.forEach(it => {
      if (it.sparePartId) m[it.sparePartId] = (m[it.sparePartId] || 0) + Number(it.quantity || 0)
    })
    return m
  }, [distItems])

  // Summary grouped by warehouse
  const distSummary = useMemo(() => {
    const byWarehouse: Record<string, { warehouseName: string; items: { partName: string; qty: number }[] }> = {}
    distItems.forEach(it => {
      if (!it.sparePartId || !it.toWarehouseId || !Number(it.quantity)) return
      const warehouseLabel = warehouses.find((w: any) => w.value === it.toWarehouseId)?.label || it.toWarehouseId
      const partInfo = distInvMap[it.sparePartId]
      const partName = partInfo?.name || it.sparePartId
      if (!byWarehouse[it.toWarehouseId]) byWarehouse[it.toWarehouseId] = { warehouseName: warehouseLabel, items: [] }
      byWarehouse[it.toWarehouseId].items.push({ partName, qty: Number(it.quantity) })
    })
    return Object.values(byWarehouse)
  }, [distItems, distInvMap, warehouses])

  const handleDistSubmit = () => {
    if (!distFrom) return toast.error('Asosiy ombor tanlang')
    const validItems = distItems.filter(it => it.sparePartId && it.toWarehouseId && Number(it.quantity) > 0)
    if (!validItems.length) return toast.error('Kamida bitta qism kiriting')
    const hasInvalid = validItems.some(it => it.toWarehouseId === distFrom)
    if (hasInvalid) return toast.error("Ombor o'ziga jo'nata olmaydi")
    // Check over-allocation
    for (const [partId, total] of Object.entries(distAllocated)) {
      const avail = distInvMap[partId]?.qty ?? 0
      if (total > avail) {
        return toast.error(`"${distInvMap[partId]?.name}" — ajratilgan: ${total}, mavjud: ${avail}`)
      }
    }
    distributeMutation.mutate({ fromWarehouseId: distFrom, items: validItems, notes: distNotes })
  }

  const handleBulkSubmit = () => {
    if (!bulkFrom || !bulkTo) return toast.error('Omborlarni tanlang')
    if (bulkFrom === bulkTo) return toast.error("Bir xil omborga bo'lmaydi")
    const validItems = bulkItems.filter(it => it.sparePartId && Number(it.quantity) > 0)
    if (!validItems.length) return toast.error('Kamida bitta qism kiriting')
    bulkMutation.mutate({ fromWarehouseId: bulkFrom, toWarehouseId: bulkTo, items: validItems, notes: bulkNotes })
  }

  const columns = [
    { key: 'route', title: "Yo'nalish", render: (t: Transfer) => (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium text-gray-900 dark:text-white">{t.fromWarehouse?.name}</span>
        <ArrowRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
        <span className="font-medium text-gray-900 dark:text-white">{t.toWarehouse?.name}</span>
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
          {t.status === 'approved' && hasRole('admin', 'manager', 'branch_manager') && (
            <Button size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5 text-blue-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'ship' })}>Jo'nat</Button>
          )}
          {t.status === 'shipped' && hasRole('admin', 'manager', 'branch_manager') && (
            <Button size="sm" variant="secondary" icon={<Package className="w-3.5 h-3.5 text-purple-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'receive' })}>Qabul</Button>
          )}
        </div>
      )
    },
  ]

  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">O'tkazmalar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Omborlar orasida ehtiyot qismlar ko'chirish</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/transfers" label="Excel" />
          <Button variant="outline" icon={<GitFork className="w-4 h-4" />} onClick={() => setDistOpen(true)}>Tarqatish</Button>
          <Button variant="outline" icon={<Layers className="w-4 h-4" />} onClick={() => setBulkOpen(true)}>Ommaviy</Button>
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>Yaratish</Button>
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
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
            <CheckCircle className="w-8 h-8 text-indigo-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Tasdiqlangan</p>
              <p className="text-xl font-bold text-indigo-600">{statsData.approved}</p>
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
            <Package className="w-8 h-8 text-green-500 flex-shrink-0" />
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

      {/* Distribute Modal */}
      <Modal
        open={distOpen}
        onClose={() => setDistOpen(false)}
        title="Ombordan filiallarga tarqatish"
        size="xl"
        footer={
          <>
            <Button variant="outline" onClick={() => setDistOpen(false)}>Bekor qilish</Button>
            <Button
              loading={distributeMutation.isPending}
              icon={<GitFork className="w-4 h-4" />}
              onClick={handleDistSubmit}
            >
              {distItems.filter(i => i.sparePartId && i.toWarehouseId).length} ta taqsimot yuborish
            </Button>
          </>
        }
      >
        <div className="flex gap-4 min-h-[420px]">
          {/* Left: form */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* From branch */}
            <SearchableSelect
              label="Asosiy ombor (qayerdan) *"
              options={warehouses}
              value={distFrom}
              onChange={v => { setDistFrom(v); setDistItems([{ sparePartId: '', quantity: '1', toWarehouseId: '', notes: '' }]) }}
              placeholder="Asosiy ombor tanlang..."
            />

            {/* Shared notes */}
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Umumiy izoh</label>
              <input
                className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Ixtiyoriy..."
                value={distNotes}
                onChange={e => setDistNotes(e.target.value)}
              />
            </div>

            {/* Item rows */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Qismlar ro'yxati
                </span>
                {!distFrom && (
                  <span className="text-xs text-amber-500 flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" /> Avval asosiy omborni tanlang
                  </span>
                )}
              </div>

              <div className="space-y-2 max-h-64 overflow-y-auto pr-1">
                {distItems.map((item, idx) => {
                  const info = item.sparePartId ? distInvMap[item.sparePartId] : null
                  const allocated = item.sparePartId ? (distAllocated[item.sparePartId] ?? 0) : 0
                  const avail = info?.qty ?? 0
                  const overAlloc = !!info && allocated > avail
                  const selfBranch = !!item.toWarehouseId && item.toWarehouseId === distFrom

                  return (
                    <div key={idx} className={`p-3 rounded-xl border transition-colors ${overAlloc || selfBranch ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/10' : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700/40'}`}>
                      <div className="flex gap-2 items-start">
                        {/* Spare part */}
                        <div className="flex-1 min-w-0">
                          <SearchableSelect
                            label=""
                            options={distPartOptions}
                            value={item.sparePartId}
                            onChange={v => {
                              const u = [...distItems]; u[idx] = { ...u[idx], sparePartId: v }; setDistItems(u)
                            }}
                            placeholder="Ehtiyot qism..."
                          />
                          {info && (
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className={`text-xs font-medium ${overAlloc ? 'text-red-500' : 'text-gray-400'}`}>
                                Ombor: {avail} ta
                              </span>
                              {allocated > 0 && (
                                <span className={`text-xs ${overAlloc ? 'text-red-500 font-bold' : 'text-blue-500'}`}>
                                  · Ajratilgan: {allocated} ta
                                </span>
                              )}
                              {overAlloc && (
                                <span className="text-xs text-red-500 font-bold">· Yetarli emas!</span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Quantity */}
                        <div className="w-20 flex-shrink-0">
                          <input
                            type="number"
                            min={1}
                            value={item.quantity}
                            onChange={e => {
                              const u = [...distItems]; u[idx] = { ...u[idx], quantity: e.target.value }; setDistItems(u)
                            }}
                            className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${overAlloc ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
                            placeholder="Miqdor"
                          />
                        </div>

                        {/* To warehouse */}
                        <div className="w-36 flex-shrink-0">
                          <select
                            value={item.toWarehouseId}
                            onChange={e => {
                              const u = [...distItems]; u[idx] = { ...u[idx], toWarehouseId: e.target.value }; setDistItems(u)
                            }}
                            className={`w-full px-2 py-2 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-gray-700 dark:text-white ${selfBranch ? 'border-red-400' : 'border-gray-300 dark:border-gray-600'}`}
                          >
                            <option value="">Ombor tanlang</option>
                            {warehouses.filter((w: any) => w.value !== distFrom).map((w: any) => (
                              <option key={w.value} value={w.value}>{w.label}</option>
                            ))}
                          </select>
                          {selfBranch && <p className="text-xs text-red-500 mt-0.5">O'ziga bo'lmaydi</p>}
                        </div>

                        {/* Delete */}
                        <button
                          onClick={() => setDistItems(distItems.filter((_, i) => i !== idx))}
                          disabled={distItems.length === 1}
                          className="mt-1.5 p-1.5 text-red-400 hover:text-red-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors flex-shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  )
                })}
              </div>

              <button
                onClick={() => setDistItems([...distItems, { sparePartId: '', quantity: '1', toWarehouseId: '', notes: '' }])}
                className="mt-2 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 font-medium px-2 py-1 rounded-lg hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
              >
                <PlusCircle className="w-4 h-4" /> Qator qo'shish
              </button>
            </div>
          </div>

          {/* Right: summary */}
          <div className="w-52 flex-shrink-0">
            <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-3 h-full min-h-[300px]">
              <h4 className="text-xs font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Tarqatish xulosasi
              </h4>
              {distSummary.length === 0 ? (
                <div className="text-center py-8 text-gray-400">
                  <GitFork className="w-8 h-8 mx-auto mb-2 opacity-30" />
                  <p className="text-xs">Qism va ombor tanlang</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {distSummary.map((wh, i) => (
                    <div key={i} className="bg-white dark:bg-gray-800 rounded-lg p-2.5 border border-gray-200 dark:border-gray-600">
                      <p className="text-xs font-bold text-blue-600 dark:text-blue-400 mb-1.5 flex items-center gap-1">
                        <ArrowRight className="w-3 h-3" /> {wh.warehouseName}
                      </p>
                      {wh.items.map((it, j) => (
                        <div key={j} className="flex items-center justify-between text-xs py-0.5">
                          <span className="text-gray-600 dark:text-gray-400 truncate max-w-[110px]">{it.partName}</span>
                          <span className="font-bold text-gray-900 dark:text-white ml-1 flex-shrink-0">{it.qty} ta</span>
                        </div>
                      ))}
                    </div>
                  ))}

                  {/* Totals */}
                  <div className="border-t border-gray-200 dark:border-gray-600 pt-2 text-xs text-gray-500 dark:text-gray-400">
                    <div className="flex justify-between">
                      <span>Omborlar:</span>
                      <span className="font-bold text-gray-900 dark:text-white">{distSummary.length} ta</span>
                    </div>
                    <div className="flex justify-between mt-0.5">
                      <span>Taqsimotlar:</span>
                      <span className="font-bold text-gray-900 dark:text-white">
                        {distItems.filter(i => i.sparePartId && i.toWarehouseId).length} ta
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </Modal>

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
                label="Qaysi ombordan *"
                options={warehouses}
                value={bulkFrom}
                onChange={v => { setBulkFrom(v); setBulkItems([{ sparePartId: '', quantity: '1', notes: '' }]) }}
                placeholder="Manba ombor..."
              />
            </div>
            <div>
              <SearchableSelect
                label="Qaysi omborga *"
                options={warehouses.filter((w: any) => w.value !== bulkFrom)}
                value={bulkTo}
                onChange={v => setBulkTo(v)}
                placeholder="Qabul ombor..."
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
                  <AlertCircle className="w-3.5 h-3.5" /> Avval ombor tanlang
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

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); reset() }} title="O'tkazma yaratish" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); reset() }}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Yaratish</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <SearchableSelect label="Qaysi ombordan *" options={warehouses} value={singleFromWh || ''}
              onChange={v => { setValue('fromWarehouseId', v, { shouldValidate: true }); setValue('sparePartId', ''); setValue('quantity', '') }}
              placeholder="Ombor tanlang..." error={errors.fromWarehouseId?.message} />
            <input type="hidden" {...register('fromWarehouseId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label="Qaysi omborga *" options={warehouses.filter((w: any) => w.value !== singleFromWh)} value={watch('toWarehouseId') || ''}
              onChange={v => setValue('toWarehouseId', v, { shouldValidate: true })}
              placeholder="Ombor tanlang..." error={errors.toWarehouseId?.message} />
            <input type="hidden" {...register('toWarehouseId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect
              label={`Ehtiyot qism *${singleFromWh ? ` (${singlePartOptions.length} ta mavjud)` : ''}`}
              options={singlePartOptions}
              value={singleSparePartId || ''}
              onChange={v => { setValue('sparePartId', v, { shouldValidate: true }); setValue('quantity', '') }}
              placeholder={singleFromWh ? 'Qoldiq bor qismlar...' : 'Avval ombor tanlang...'}
              error={errors.sparePartId?.message}
            />
            <input type="hidden" {...register('sparePartId', { required: 'Talab qilinadi' })} />
            {singleSparePartId && singleFromWh && (() => {
              const avail = singleInvMap[singleSparePartId]
              return avail !== undefined ? (
                <p className={`text-xs mt-1 font-medium ${avail === 0 ? 'text-red-500' : 'text-gray-500'}`}>
                  Omborda mavjud: <span className={avail === 0 ? 'text-red-600' : 'text-green-600 dark:text-green-400'}>{avail} ta</span>
                </p>
              ) : null
            })()}
          </div>
          <div>
            {(() => {
              const avail = singleSparePartId ? (singleInvMap[singleSparePartId] ?? undefined) : undefined
              return (
                <Input
                  label={`Miqdor *${avail !== undefined ? ` (max: ${avail})` : ''}`}
                  type="number"
                  error={errors.quantity?.message}
                  {...register('quantity', {
                    required: 'Talab qilinadi',
                    min: { value: 1, message: 'Kamida 1' },
                    ...(avail !== undefined && { max: { value: avail, message: `Omborda faqat ${avail} ta bor` } }),
                  })}
                />
              )
            })()}
          </div>
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Izohlar</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
