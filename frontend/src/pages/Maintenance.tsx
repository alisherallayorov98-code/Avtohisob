import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useDebounce } from '../hooks/useDebounce'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Wrench, Trash2, DollarSign, Package, ClipboardList, Search, Edit2, BarChart2, X, Circle, Clock, CheckCircle, XCircle, RotateCcw, FileText, AlertTriangle } from 'lucide-react'
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
import MaintenanceEvidenceUpload from '../components/maintenance/MaintenanceEvidenceUpload'
import MaintenanceDocumentModal from '../components/maintenance/MaintenanceDocumentModal'
import MaintenancePendingApprovals from '../components/maintenance/MaintenancePendingApprovals'
import SparePartReturnForm from '../components/maintenance/SparePartReturnForm'
import SparePartReturnPending from '../components/maintenance/SparePartReturnPending'
import OldPartDebtWorker from '../components/maintenance/OldPartDebtWorker'
import OldPartDebtAdmin from '../components/maintenance/OldPartDebtAdmin'

interface MaintenanceItem {
  id: string
  sparePartId: string
  warehouseId?: string
  quantityUsed: number
  unitCost: number
  isTire?: boolean
  tireSerial?: string
  sparePart: { id: string; name: string; partCode: string; category: string }
  warehouse?: { id: string; name: string }
}

interface MaintenanceRecord {
  id: string
  vehicleId: string
  installationDate: string
  quantityUsed: number
  cost: number
  laborCost: number
  workerName?: string
  paymentType: string
  isPaid: boolean
  isOfficial?: boolean
  notes?: string
  status: string
  rejectedReason?: string | null
  vehicle: { id: string; registrationNumber: string; brand: string; model: string }
  sparePart?: { id: string; name: string; partCode: string; category: string }
  supplier?: { name: string }
  performedBy: { fullName: string }
  items?: MaintenanceItem[]
  evidence?: { id: string; fileUrl: string }[]
}

const isVideoUrl = (url: string) => /\.(mp4|webm|mov)$/i.test(url)

interface PartLineItem {
  key: number
  sparePartId: string
  quantityUsed: string
  unitCost: string
  stockOnHand: number
  partName: string
  isTire?: boolean
  tireSerial?: string
  tirePosition?: string
}

interface MaintenanceForm {
  vehicleId: string
  installationDate: string
  laborCost: string
  workerName: string
  paymentType: string
  isPaid: string
  supplierId: string
  notes: string
  isOfficial?: boolean
}

const categoryColors: Record<string, any> = {
  engine: 'info', brake: 'danger', suspension: 'warning', electrical: 'secondary', body: 'default', other: 'default'
}
const PIE_COLORS = ['#3B82F6', '#EF4444', '#F59E0B', '#8B5CF6', '#6B7280', '#10B981']

function DuplicateAlertsWidget({
  alerts, onOpenDoc, onViewInList,
}: {
  alerts: any[]
  onOpenDoc: (id: string) => void
  onViewInList: (vehicleId: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const visible = expanded ? alerts : alerts.slice(0, 5)

  return (
    <div className="bg-orange-50 dark:bg-orange-900/20 border border-orange-300 dark:border-orange-700 rounded-xl p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="w-5 h-5 text-orange-600 dark:text-orange-400 flex-shrink-0" />
          <h3 className="font-semibold text-orange-800 dark:text-orange-300 text-sm">
            Shubhali: {alerts.length} ta holat — bitta mashinaga bitta qism 2+ marta yozilgan (30 kun ichida)
          </h3>
        </div>
        {alerts.length > 5 && (
          <button
            onClick={() => setExpanded(v => !v)}
            className="text-xs text-orange-700 dark:text-orange-400 font-medium hover:underline flex-shrink-0"
          >
            {expanded ? '↑ Yig\'ish' : `Barchasini ko'rish (${alerts.length})`}
          </button>
        )}
      </div>
      <div className="space-y-2">
        {visible.map((alert: any, i: number) => (
          <div key={i} className="flex items-start justify-between gap-3 bg-white dark:bg-orange-900/30 rounded-lg px-3 py-2 text-sm">
            <div className="min-w-0 flex items-center gap-2 flex-wrap">
              <span className="font-mono font-semibold text-gray-800 dark:text-gray-200">{alert.vehicleLabel}</span>
              <span className="text-gray-400">·</span>
              <span className="text-orange-700 dark:text-orange-300 font-medium">{alert.partName}</span>
              <span className="bg-orange-100 dark:bg-orange-800 text-orange-700 dark:text-orange-200 text-xs px-1.5 py-0.5 rounded-full font-bold">
                {alert.records.length}× yozilgan
              </span>
              <button
                onClick={() => onViewInList(alert.vehicleId)}
                className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:underline"
              >
                → Ro'yxatda ko'rish
              </button>
            </div>
            <div className="flex gap-1 flex-shrink-0 flex-wrap justify-end">
              {alert.records.map((r: any) => (
                <button
                  key={r.id}
                  onClick={() => onOpenDoc(r.id)}
                  title="Dalolatnomani ochish"
                  className="text-xs text-blue-600 dark:text-blue-400 hover:underline bg-blue-50 dark:bg-blue-900/30 px-2 py-0.5 rounded"
                >
                  {r.date}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function Maintenance() {
  const { t } = useTranslation()
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()
  const isAdmin = hasRole('admin', 'super_admin', 'manager')
  const isSuperAdmin = hasRole('admin', 'super_admin')
  const [activeTab, setActiveTab] = useState<'list' | 'pending' | 'returns' | 'old-parts'>('list')
  const [statusFilter, setStatusFilter] = useState<'' | 'pending_approval' | 'approved' | 'rejected'>('')
  const [evidenceMaintenanceId, setEvidenceMaintenanceId] = useState<string | null>(null)
  const [returnForRecord, setReturnForRecord] = useState<{ maintenanceId: string; vehicleLabel: string; warehouseId: string } | null>(null)
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [branchFilter, setBranchFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [editRecord, setEditRecord] = useState<MaintenanceRecord | null>(null)
  const [showChart, setShowChart] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [docModalId, setDocModalId] = useState<string | null>(null)

  const effectiveBranch = ['branch_manager', 'operator'].includes(user?.role || '') ? (user?.branchId || '') : branchFilter

  const params = {
    page, limit,
    search: debouncedSearch || undefined,
    vehicleId: vehicleFilter || undefined,
    category: categoryFilter || undefined,
    branchId: effectiveBranch || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    status: statusFilter || undefined,
  }

  useEffect(() => { setPage(1) }, [debouncedSearch])

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', params],
    queryFn: () => api.get('/maintenance', { params }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


  const { data: statsData } = useQuery({
    queryKey: ['maintenance-stats', vehicleFilter, effectiveBranch, fromDate, toDate],
    queryFn: () => api.get('/maintenance/stats', {
      params: { vehicleId: vehicleFilter || undefined, branchId: effectiveBranch || undefined, from: fromDate || undefined, to: toDate || undefined }
    }).then(r => r.data.data),
  })

  const { data: duplicateAlerts } = useQuery({
    queryKey: ['maintenance-duplicate-alerts'],
    queryFn: () => api.get('/maintenance/duplicate-alerts').then(r => r.data.data || []),
    enabled: isAdmin,
    staleTime: 5 * 60 * 1000,
  })

  const { data: pendingData } = useQuery({
    queryKey: ['maintenance-pending'],
    queryFn: () => api.get('/maintenance/pending').then(r => r.data),
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
  })
  const pendingCount = pendingData?.meta?.count || 0

  const { data: returnsPendingData } = useQuery({
    queryKey: ['returns-pending'],
    queryFn: () => api.get('/spare-part-returns/pending').then(r => r.data),
    enabled: isSuperAdmin,
    refetchInterval: 30_000,
  })
  const returnsPendingCount = returnsPendingData?.meta?.count || 0

  const { data: oldDebtData } = useQuery({
    queryKey: isSuperAdmin ? ['old-part-debts', 'submitted'] : ['my-old-part-debts'],
    queryFn: () => isSuperAdmin
      ? api.get('/old-part-debts', { params: { status: 'submitted' } }).then(r => r.data.data)
      : api.get('/old-part-debts/my').then(r => r.data.data),
    refetchInterval: 30_000,
  })
  const oldDebtCount = isSuperAdmin
    ? (oldDebtData || []).length
    : (oldDebtData || []).filter((d: any) => d.status === 'open' || d.status === 'rejected').length

  const [warehouseId, setWarehouseId] = useState('')
  const [partItems, setPartItems] = useState<PartLineItem[]>([])
  const nextKey = () => Date.now() + Math.random()

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true', branchId: effectiveBranch || undefined } }).then(r => r.data.data),
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

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses-list'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })

  // Inventory for selected warehouse (spare parts with stock)
  const { data: warehouseInventory } = useQuery({
    queryKey: ['inventory-warehouse', warehouseId],
    queryFn: () => api.get('/inventory', { params: { warehouseId, limit: 500 } }).then(r => r.data.data),
    enabled: !!warehouseId,
  })

  const inventoryMap: Record<string, { quantityOnHand: number; unitPrice: number; name: string }> = {}
  ;(warehouseInventory || []).forEach((inv: any) => {
    inventoryMap[inv.sparePart.id] = {
      quantityOnHand: inv.quantityOnHand,
      unitPrice: Number(inv.sparePart.unitPrice),
      name: inv.sparePart.name,
    }
  })

  const warehousePartOptions = (warehouseInventory || []).map((inv: any) => ({
    value: inv.sparePart.id,
    label: `${inv.sparePart.partCode} - ${inv.sparePart.name} (${inv.quantityOnHand} ta)`,
  }))

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<MaintenanceForm>({
    defaultValues: { isOfficial: true },
  })

  const addPartLine = () => {
    setPartItems(prev => [...prev, { key: nextKey(), sparePartId: '', quantityUsed: '1', unitCost: '0', stockOnHand: 0, partName: '' }])
  }

  const removePartLine = (key: number) => {
    setPartItems(prev => prev.filter(p => p.key !== key))
  }

  const updatePartLine = (key: number, field: keyof PartLineItem, value: string) => {
    setPartItems(prev => prev.map(p => {
      if (p.key !== key) return p
      if (field === 'sparePartId' && value) {
        const inv = inventoryMap[value]
        return { ...p, sparePartId: value, unitCost: inv ? String(inv.unitPrice) : p.unitCost, stockOnHand: inv?.quantityOnHand || 0, partName: inv?.name || '' }
      }
      return { ...p, [field]: value }
    }))
  }

  const openAdd = () => {
    reset()
    setEditRecord(null)
    setWarehouseId('')
    setPartItems([{ key: nextKey(), sparePartId: '', quantityUsed: '1', unitCost: '0', stockOnHand: 0, partName: '' }])
    setModalOpen(true)
  }
  const openEdit = (r: MaintenanceRecord) => {
    setEditRecord(r)
    setValue('vehicleId', r.vehicleId)
    setValue('laborCost', String(r.laborCost || 0))
    setValue('workerName', r.workerName || '')
    setValue('paymentType', r.paymentType || 'cash')
    setValue('isPaid', r.isPaid ? 'true' : 'false')
    setValue('installationDate', r.installationDate.slice(0, 16))
    setValue('notes', r.notes || '')
    setValue('isOfficial', (r as any).isOfficial !== false)
    // Load existing items for display (read-only in edit mode)
    setPartItems([])
    setWarehouseId('')
    setModalOpen(true)
  }

  const saveMutation = useMutation({
    mutationFn: (body: MaintenanceForm) => {
      if (editRecord) {
        return api.put(`/maintenance/${editRecord.id}`, body)
      }
      // Build items array from partItems — preserve per-item key to avoid same-sparePartId collision
      const validItems = partItems.filter(p => p.sparePartId && Number(p.quantityUsed) > 0)
      return api.post('/maintenance', {
        ...body,
        items: validItems.map(p => ({
          sparePartId: p.sparePartId,
          warehouseId: warehouseId || undefined,
          quantityUsed: Number(p.quantityUsed),
          unitCost: Number(p.unitCost),
          isTire: p.isTire || false,
          tireSerial: p.isTire ? (p.tireSerial || undefined) : undefined,
          tirePosition: p.isTire ? (p.tirePosition || undefined) : undefined,
        })),
      })
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['inventory-warehouse', warehouseId] })
      setModalOpen(false); reset(); setEditRecord(null); setPartItems([]); setWarehouseId('')
      if (!editRecord && !isSuperAdmin) {
        // Non-admin: show evidence upload modal
        const newId = res.data?.data?.id
        if (newId) {
          setEvidenceMaintenanceId(newId)
          toast('Ta\'mirlash saqlandi. Endi foto yuklansin.', { icon: '📷' })
        } else {
          toast.success(t('maintenance.toast.createdAwaitingApproval'))
        }
      } else {
        toast.success(t(editRecord ? 'maintenance.toast.updated' : 'maintenance.toast.created'))
      }
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('errors.generic')),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/maintenance/${id}`),
    onSuccess: () => {
      toast.success(t('maintenance.toast.deletedRestored'))
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['maintenance-stats'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || t('errors.generic')),
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
    { key: 'sparePart', title: t('maintenance.spareParts'), render: (r: MaintenanceRecord) => {
      const items = r.items && r.items.length > 0 ? r.items : (r.sparePart ? [{ sparePart: r.sparePart, quantityUsed: r.quantityUsed, unitCost: 0, isTire: false, tireSerial: null }] : [])
      if (items.length === 0) return <span className="text-gray-400 text-xs italic">{t('maintenance.onlyWorkerFee')}</span>
      return (
        <div className="space-y-0.5">
          {items.slice(0, 2).map((item: any, i) => (
            <div key={i} className="flex items-center gap-1">
              {item.isTire && (
                <span title={t('maintenance.tire')} className="text-blue-500 text-xs font-bold shrink-0">🔵</span>
              )}
              <p className="text-sm font-medium text-gray-900 dark:text-white">{item.sparePart.name}</p>
              <span className="text-xs text-gray-400">× {item.quantityUsed}</span>
              {item.isTire && item.tireSerial && (
                <span className="text-xs font-mono bg-blue-50 dark:bg-blue-900/30 text-blue-600 px-1 rounded">{item.tireSerial}</span>
              )}
            </div>
          ))}
          {items.length > 2 && <p className="text-xs text-blue-500">+{items.length - 2} ta yana</p>}
        </div>
      )
    }},
    { key: 'cost', title: 'Qism narxi', render: (r: MaintenanceRecord) => <span className="text-sm text-gray-700 dark:text-gray-300">{formatCurrency(Number(r.cost))}</span> },
    { key: 'laborCost', title: 'Usta haqi', render: (r: MaintenanceRecord) => Number(r.laborCost) > 0
      ? <div>
          <span className="font-semibold text-orange-600 dark:text-orange-400">{formatCurrency(Number(r.laborCost))}</span>
          {r.workerName && <p className="text-xs text-gray-400">{r.workerName}</p>}
        </div>
      : <span className="text-gray-300 text-xs">—</span>
    },
    { key: 'payment', title: 'To\'lov', render: (r: MaintenanceRecord) => (
      <div className="flex flex-col gap-0.5">
        <Badge variant={r.paymentType === 'cash' ? 'success' : 'warning'}>
          {r.paymentType === 'cash' ? 'Naqd' : 'Qarz'}
        </Badge>
        {r.paymentType === 'credit' && (
          <Badge variant={r.isPaid ? 'success' : 'danger'}>{r.isPaid ? t('maintenance.paidLabel') : t('maintenance.debtor')}</Badge>
        )}
      </div>
    )},
    { key: 'isOfficial', title: t('maintenance.documentColumn'), render: (r: MaintenanceRecord) => r.isOfficial !== false ? (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-emerald-50 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400" title={t('maintenance.officialHint')}>
        🟢 {t('maintenance.official')}
      </span>
    ) : (
      <span className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-orange-50 dark:bg-orange-900/30 text-orange-700 dark:text-orange-400" title={t('maintenance.unofficialHint')}>
        🟠 {t('maintenance.unofficial')}
      </span>
    )},
    { key: 'installationDate', title: t('common.date'), render: (r: MaintenanceRecord) => <span className="text-sm text-gray-500">{formatDate(r.installationDate)}</span> },
    { key: 'performedBy', title: t('maintenance.performedBy'), render: (r: MaintenanceRecord) => <span className="text-sm text-gray-600 dark:text-gray-300">{r.performedBy?.fullName}</span> },
    { key: 'supplier', title: 'Yetkazuvchi', render: (r: MaintenanceRecord) => r.supplier?.name
      ? <span className="text-xs text-gray-500">{r.supplier.name}</span>
      : <span className="text-gray-300 text-xs">—</span>
    },
    { key: 'notes', title: 'Izoh', render: (r: MaintenanceRecord) => r.notes
      ? <span className="text-xs text-gray-500 dark:text-gray-400 italic line-clamp-1 max-w-28">{r.notes}</span>
      : <span className="text-gray-300 text-xs">—</span>
    },
    { key: 'status', title: t('common.status'), render: (r: MaintenanceRecord) => {
      if (!r.status || r.status === 'approved') return <span className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400"><CheckCircle className="w-3.5 h-3.5" />{t('maintenance.approved')}</span>
      if (r.status === 'pending_approval') return <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"><Clock className="w-3.5 h-3.5" />{t('maintenance.pending')}</span>
      return (
        <div>
          <span className="flex items-center gap-1 text-xs text-red-500"><XCircle className="w-3.5 h-3.5" />{t('maintenance.rejected')}</span>
          {r.rejectedReason && <p className="text-xs text-red-400 italic mt-0.5 max-w-32 line-clamp-2">{r.rejectedReason}</p>}
        </div>
      )
    }},
    {
      key: 'actions', title: '', render: (r: MaintenanceRecord) => {
        const photoCount = (r.evidence || []).filter(e => !isVideoUrl(e.fileUrl)).length
        const videoCount = (r.evidence || []).filter(e => isVideoUrl(e.fileUrl)).length
        return (
        <div className="flex items-center gap-1 justify-end">
          <button
            onClick={() => setDocModalId(r.id)}
            title={t('maintenance.deedFiles')}
            className="relative inline-flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
          >
            <FileText className="w-3.5 h-3.5 text-gray-500" />
            {photoCount > 0 && (
              <span className="text-[10px] font-medium text-blue-600 dark:text-blue-400">📷{photoCount}</span>
            )}
            {videoCount > 0 && (
              <span className="text-[10px] font-medium text-purple-600 dark:text-purple-400">🎬{videoCount}</span>
            )}
          </button>
          {/* Qaytarish: faqat approved, items bo'lgan recordlar uchun */}
          {hasRole('admin', 'manager', 'branch_manager') && r.status === 'approved' && (r.items?.length || 0) > 0 && (
            <Button
              size="sm" variant="ghost"
              icon={<RotateCcw className="w-3.5 h-3.5 text-orange-500" />}
              title={t('maintenance.sparePartReturn')}
              onClick={() => setReturnForRecord({
                maintenanceId: r.id,
                vehicleLabel: `${r.vehicle.registrationNumber} — ${r.vehicle.brand} ${r.vehicle.model}`,
                warehouseId: r.items?.[0]?.warehouse?.id || '',
              })}
            />
          )}
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
    },
  ]

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}` }))
  const suppliers = [{ value: '', label: "Yetkazuvchi yo'q" }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]
  const warehouses = (warehousesData || []).filter((w: any) => w.isActive).map((w: any) => ({ value: w.id, label: w.name }))

  const hasFilter = search || vehicleFilter || categoryFilter || fromDate || toDate || branchFilter
  const clearAll = () => { setSearch(''); setVehicleFilter(''); setCategoryFilter(''); setFromDate(''); setToDate(''); setBranchFilter(''); setPage(1) }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('maintenance.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('maintenance.totalRecords', { count: data?.meta?.total || 0 })}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowChart(v => !v)}
            className={`p-2 rounded-lg border transition-colors ${showChart ? 'bg-blue-50 border-blue-200 text-blue-600' : 'border-gray-200 dark:border-gray-700 text-gray-500 hover:bg-gray-50'}`}
            title={t('maintenance.chart')}
          >
            <BarChart2 className="w-4 h-4" />
          </button>
          <ExcelExportButton endpoint="/exports/maintenance" label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={openAdd}>{t('maintenance.createButton')}</Button>
          )}
        </div>
      </div>

      {/* Takroriy qismlar ogohlantirishi — faqat admin */}
      {isAdmin && duplicateAlerts && duplicateAlerts.length > 0 && (
        <DuplicateAlertsWidget
          alerts={duplicateAlerts}
          onOpenDoc={setDocModalId}
          onViewInList={(vehicleId) => {
            setVehicleFilter(vehicleId)
            setPage(1)
            setTimeout(() => {
              document.getElementById('maintenance-list')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
            }, 100)
          }}
        />
      )}

      {/* Tabs (admin only) */}
      {isSuperAdmin && (
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
          <button
            onClick={() => setActiveTab('list')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === 'list' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            Ro'yxat
          </button>
          <button
            onClick={() => setActiveTab('pending')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'pending' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            <Clock className="w-4 h-4" />
            Ta'mirlash
            {pendingCount > 0 && (
              <span className="bg-amber-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {pendingCount > 9 ? '9+' : pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('returns')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'returns' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            <RotateCcw className="w-4 h-4" />
            Qaytarish
            {returnsPendingCount > 0 && (
              <span className="bg-orange-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {returnsPendingCount > 9 ? '9+' : returnsPendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('old-parts')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${activeTab === 'old-parts' ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : 'text-gray-500 hover:text-gray-700 dark:hover:text-gray-300'}`}
          >
            <Package className="w-4 h-4" />
            Eski qismlar
            {oldDebtCount > 0 && (
              <span className="bg-red-500 text-white text-xs rounded-full w-5 h-5 flex items-center justify-center font-bold">
                {oldDebtCount > 9 ? '9+' : oldDebtCount}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Pending approvals tab */}
      {isSuperAdmin && activeTab === 'pending' && <MaintenancePendingApprovals />}
      {isSuperAdmin && activeTab === 'returns' && <SparePartReturnPending />}
      {activeTab === 'old-parts' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <h3 className="font-semibold text-gray-800 dark:text-gray-200 mb-4 flex items-center gap-2">
            <Package className="w-5 h-5 text-red-500" />
            {isSuperAdmin ? 'Eski qism topshirishlar — admin nazorati' : 'Mening eski qism qarzlarim'}
          </h3>
          {isSuperAdmin ? <OldPartDebtAdmin /> : <OldPartDebtWorker />}
        </div>
      )}

      {/* Stats + table (list tab only) */}
      {activeTab === 'list' && <div id="maintenance-list">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-blue-100 dark:border-blue-900/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <DollarSign className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('maintenance.totalCost')}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(statsData?.totalCost || 0)}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-purple-100 dark:border-purple-900/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <Package className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('maintenance.totalParts')}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData?.totalParts ?? 0} ta</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-green-100 dark:border-green-900/30 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-green-100 dark:bg-green-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <ClipboardList className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">{t('maintenance.recordCount')}</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData?.count ?? 0}</p>
          </div>
        </div>
      </div>

      {/* Category pie chart (toggle) */}
      {showChart && pieCatData.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-5">
          <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-3">{t('maintenance.byCategory')}</h3>
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

      {/* Status tabs */}
      <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
        {([
          { value: '', label: t('maintenance.all') },
          { value: 'pending_approval', label: t('maintenance.pending'), color: 'text-amber-600' },
          { value: 'approved', label: t('maintenance.approved'), color: 'text-green-600' },
          { value: 'rejected', label: t('maintenance.rejectedAlt'), color: 'text-red-500' },
        ] as const).map(tab => (
          <button
            key={tab.value}
            onClick={() => { setStatusFilter(tab.value); setPage(1) }}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${statusFilter === tab.value ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm' : `text-gray-500 hover:text-gray-700 dark:hover:text-gray-300`}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Filters + Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap items-center">
          {/* Text search */}
          <div className="relative flex-1 min-w-40">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder={t('maintenance.searchPlaceholder')}
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
              placeholder={t('maintenance.vehiclePlaceholder')}
            />
          </div>

          {/* Category */}
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t('maintenance.allCategories')}</option>
            {PART_CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_LABELS[c]}</option>)}
          </select>

          {/* Branch (admin only) */}
          {isAdmin && (
            <select value={branchFilter} onChange={e => { setBranchFilter(e.target.value); setPage(1) }}
              className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{t('maintenance.allBranches')}</option>
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

        <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>
      </div> /* end activeTab === 'list' */}

      {/* Add/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setEditRecord(null); reset(); setPartItems([]); setWarehouseId('') }}
        title={editRecord ? 'Yozuvni tahrirlash' : "Texnik xizmat qayd etish"}
        size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => { setModalOpen(false); reset(); setPartItems([]); setWarehouseId('') }}>{t('common.cancel')}</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => {
              // Tire serial validation: if isTire checked, serial must be filled
              const tiresWithoutSerial = partItems.filter(p => p.isTire && !p.tireSerial?.trim())
              if (tiresWithoutSerial.length > 0) {
                toast.error(t('maintenance.toast.tireSerialMissing'))
                return
              }
              saveMutation.mutate(d)
            })}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="space-y-4">
          {/* Avtomashina */}
          <div>
            <SearchableSelect label="Avtomashina *" options={vehicles} value={watch('vehicleId') || ''}
              onChange={v => setValue('vehicleId', v, { shouldValidate: true })}
              placeholder={t('maintenance.vehicleSearchPlaceholder')} error={errors.vehicleId?.message} />
            <input type="hidden" {...register('vehicleId', { required: 'Talab qilinadi' })} />
          </div>

          {/* ── Ehtiyot qismlar ── */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
            <div className="flex items-center justify-between mb-3">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{t('maintenance.sparePartsOptional')}</p>
            </div>

            {/* Sklad tanlash */}
            {!editRecord && (
              <div className="mb-3">
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{t('maintenance.warehouse')}</label>
                <select
                  value={warehouseId}
                  onChange={e => { setWarehouseId(e.target.value); setPartItems(prev => prev.map(p => ({ ...p, sparePartId: '', stockOnHand: 0, partName: '' }))) }}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">{t('maintenance.noWarehouseSelected')}</option>
                  {warehouses.map((w: any) => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
                {warehouseId && (
                  <p className="text-xs text-green-600 dark:text-green-400 mt-1">
                    {t('maintenance.partsAvailable', { count: (warehouseInventory || []).length })}
                  </p>
                )}
              </div>
            )}

            {/* Qismlar ro'yxati */}
            {!editRecord ? (
              <div className="space-y-2">
                {/* Header */}
                {partItems.length > 0 && (
                  <div className="grid grid-cols-12 gap-2 text-xs font-medium text-gray-500 dark:text-gray-400 px-1">
                    <div className="col-span-6">{t('maintenance.sparePart')}</div>
                    <div className="col-span-2 text-center">{t('maintenance.quantity')}</div>
                    <div className="col-span-3">{t('maintenance.price')}</div>
                    <div className="col-span-1"></div>
                  </div>
                )}
                {partItems.map((item) => (
                  <div key={item.key} className="bg-gray-50 dark:bg-gray-700/50 rounded-lg p-2 space-y-1.5">
                    <div className="grid grid-cols-12 gap-2 items-center">
                      <div className="col-span-6">
                        <SearchableSelect
                          options={warehouseId ? warehousePartOptions : []}
                          value={item.sparePartId}
                          onChange={val => updatePartLine(item.key, 'sparePartId', val)}
                          placeholder={warehouseId ? 'Qism tanlang...' : 'Avval sklad tanlang'}
                        />
                        {item.sparePartId && item.stockOnHand !== undefined && (
                          <p className={`text-xs mt-0.5 ${item.stockOnHand <= 0 ? 'text-red-500' : 'text-green-600'}`}>
                            Qoldiq: {item.stockOnHand} ta
                          </p>
                        )}
                      </div>
                      <div className="col-span-2">
                        <input
                          type="number" min={1} value={item.quantityUsed}
                          onChange={e => updatePartLine(item.key, 'quantityUsed', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-center"
                        />
                      </div>
                      <div className="col-span-3">
                        <input
                          type="number" min={0} value={item.unitCost}
                          onChange={e => updatePartLine(item.key, 'unitCost', e.target.value)}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                      </div>
                      <div className="col-span-1 flex justify-center">
                        <button type="button" onClick={() => removePartLine(item.key)}
                          className="text-red-400 hover:text-red-600 transition-colors">
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Tire checkbox */}
                    <div className="flex items-center gap-2 pl-1">
                      <label className="flex items-center gap-1.5 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={!!item.isTire}
                          onChange={e => setPartItems(prev => prev.map(p =>
                            p.key === item.key ? { ...p, isTire: e.target.checked, tireSerial: '', tirePosition: '' } : p
                          ))}
                          className="w-3.5 h-3.5 rounded accent-blue-600"
                        />
                        <span className="text-xs text-gray-600 dark:text-gray-400 font-medium">{t('maintenance.thisTire')}</span>
                      </label>
                    </div>

                    {/* Tire fields */}
                    {item.isTire && (
                      <div className="grid grid-cols-2 gap-2 pl-1 pt-0.5">
                        <div>
                          <input
                            type="text"
                            value={item.tireSerial || ''}
                            onChange={e => setPartItems(prev => prev.map(p =>
                              p.key === item.key ? { ...p, tireSerial: e.target.value } : p
                            ))}
                            placeholder={t('maintenance.tireSerialPlaceholder')}
                            className="w-full px-2 py-1.5 text-sm border border-blue-300 dark:border-blue-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          />
                        </div>
                        <div>
                          <select
                            value={item.tirePosition || ''}
                            onChange={e => setPartItems(prev => prev.map(p =>
                              p.key === item.key ? { ...p, tirePosition: e.target.value } : p
                            ))}
                            className="w-full px-2 py-1.5 text-sm border border-blue-300 dark:border-blue-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                          >
                            <option value="">{t('maintenance.positionOptional')}</option>
                            <option value="Front-Left">{t('maintenance.positionFL')}</option>
                            <option value="Front-Right">{t('maintenance.positionFR')}</option>
                            <option value="Rear-Left">{t('maintenance.positionRL')}</option>
                            <option value="Rear-Right">{t('maintenance.positionRR')}</option>
                            <option value="Spare">Zapas</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
                <Button type="button" variant="outline" size="sm" icon={<Plus className="w-4 h-4" />}
                  onClick={addPartLine}>
                  Qism qo'shish
                </Button>
                {partItems.filter(p => p.sparePartId && Number(p.quantityUsed) > 0).length > 0 && (
                  <div className="text-right text-sm font-medium text-gray-700 dark:text-gray-300">
                    Jami qism narxi: <span className="text-blue-600 font-bold">
                      {formatCurrency(partItems.reduce((sum, p) => sum + (Number(p.unitCost) * Number(p.quantityUsed)), 0))}
                    </span>
                  </div>
                )}
              </div>
            ) : (
              /* Edit mode: show existing items read-only */
              editRecord?.items && editRecord.items.length > 0 ? (
                <div className="space-y-1 mb-2">
                  {editRecord.items.map((item, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-sm">
                      <span className="font-medium text-gray-800 dark:text-gray-200">{item.sparePart.name}</span>
                      <span className="text-gray-500">× {item.quantityUsed} · {formatCurrency(Number(item.unitCost) * item.quantityUsed)}</span>
                    </div>
                  ))}
                  <p className="text-xs text-gray-400 mt-1">{t('maintenance.editPartsDisabled')}</p>
                </div>
              ) : (
                editRecord?.sparePart && (
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-lg px-3 py-2 text-sm mb-2">
                    <span className="font-medium text-gray-800 dark:text-gray-200">{editRecord.sparePart.name}</span>
                    <span className="text-gray-500 ml-2">× {editRecord.quantityUsed}</span>
                  </div>
                )
              )
            )}
          </div>

          {/* ── Usta haqi ── */}
          <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">{t('maintenance.workerFee')}</p>
            <div className="grid grid-cols-2 gap-3">
              <Input label={t('maintenance.workerFeeAmount')} type="number" placeholder="0"
                {...register('laborCost', { min: { value: 0, message: t('maintenance.negativeNotAllowed') } })} />
              <Input label={t('maintenance.workerName')} placeholder={t('maintenance.workerNamePlaceholder')}
                {...register('workerName')} />
            </div>
          </div>

          {/* ── To'lov ── */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('maintenance.paymentType')}</label>
              <select {...register('paymentType')} defaultValue="cash"
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="cash">{t('maintenance.cash')}</option>
                <option value="credit">{t('maintenance.credit')}</option>
              </select>
            </div>
            {watch('paymentType') === 'credit' ? (
              <div>
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">{t('maintenance.debtStatus')}</label>
                <select {...register('isPaid')} defaultValue="false"
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="false">{t('maintenance.unpaid')}</option>
                  <option value="true">{t('maintenance.paid')}</option>
                </select>
              </div>
            ) : <div />}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Input label={t('maintenance.dateRequired')} type="datetime-local" error={errors.installationDate?.message}
              {...register('installationDate', { required: t('maintenance.fieldRequired') })} />
            <SearchableSelect label={t('maintenance.supplier')} options={suppliers} value={watch('supplierId') || ''}
              onChange={v => setValue('supplierId', v)} placeholder={t('maintenance.supplierPlaceholder')} />
          </div>

          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('maintenance.notes')}</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>

          {/* Rasmiy/Norasmiy belgisi */}
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300 block mb-1">
              {t('maintenance.documentTypeRequired')}
            </label>
            <div className="grid grid-cols-2 gap-2">
              <button type="button" onClick={() => setValue('isOfficial', true)}
                className={`px-3 py-2 border rounded-lg text-left transition-colors ${
                  watch('isOfficial') !== false
                    ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                }`}>
                <span className="text-sm font-semibold text-emerald-700 dark:text-emerald-400">🟢 {t('maintenance.official')}</span>
                <span className="block text-xs text-gray-500">{t('maintenance.officialHint')}</span>
              </button>
              <button type="button" onClick={() => setValue('isOfficial', false)}
                className={`px-3 py-2 border rounded-lg text-left transition-colors ${
                  watch('isOfficial') === false
                    ? 'border-orange-500 bg-orange-50 dark:bg-orange-900/20'
                    : 'border-gray-300 dark:border-gray-600 hover:border-gray-400'
                }`}>
                <span className="text-sm font-semibold text-orange-700 dark:text-orange-400">🟠 {t('maintenance.unofficial')}</span>
                <span className="block text-xs text-gray-500">{t('maintenance.unofficialFullHint')}</span>
              </button>
            </div>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirmId}
        title={t('maintenance.deleteTitle')}
        message={t('maintenance.deleteConfirm')}
        confirmLabel={t('common.confirmDelete')}
        loading={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(deleteConfirmId!); setDeleteConfirmId(null) }}
        onCancel={() => setDeleteConfirmId(null)}
      />

      {/* Evidence upload modal — shown after non-admin creates maintenance */}
      {evidenceMaintenanceId && (
        <MaintenanceEvidenceUpload
          maintenanceId={evidenceMaintenanceId}
          onClose={() => setEvidenceMaintenanceId(null)}
          onDone={() => {
            setEvidenceMaintenanceId(null)
            toast.success(t('maintenance.toast.savedAwaitingApproval'))
          }}
        />
      )}

      {/* Dalolatnoma / rasmlar modali */}
      {docModalId && (
        <MaintenanceDocumentModal
          maintenanceId={docModalId}
          onClose={() => setDocModalId(null)}
        />
      )}

      {/* Qaytarish formasi */}
      {returnForRecord && (
        <SparePartReturnForm
          maintenanceId={returnForRecord.maintenanceId}
          vehicleLabel={returnForRecord.vehicleLabel}
          warehouseId={returnForRecord.warehouseId}
          onClose={() => setReturnForRecord(null)}
          onDone={() => setReturnForRecord(null)}
        />
      )}
    </div>
  )
}
