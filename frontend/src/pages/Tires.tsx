import { useState, useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import {
  Plus, AlertTriangle, CheckCircle, Search, ChevronDown,
  Wrench, Package, ArrowDown, ArrowUp, ShieldAlert, History,
  Car, QrCode, DollarSign, RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatCurrency, formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'

const TIRE_TYPES = ['Summer', 'Winter', 'All-season', 'Off-road', 'Spare']
const POSITIONS = ['Front-Left', 'Front-Right', 'Rear-Left', 'Rear-Right']

const STATUS_COLORS: Record<string, any> = {
  in_stock: 'info', installed: 'success',
  returned: 'warning', written_off: 'secondary',
  damaged: 'danger', warning: 'warning',
  critical: 'danger', warranty_expiring: 'warning',
}
const CONDITION_COLORS: Record<string, any> = {
  excellent: 'success', good: 'success', fair: 'warning',
  poor: 'warning', critical: 'danger', unknown: 'secondary',
}

type ActiveModal =
  | { type: 'add' }
  | { type: 'detail'; tire: any }
  | { type: 'install'; tire: any }
  | { type: 'remove'; tire: any }
  | { type: 'verify-return' }
  | { type: 'write-off'; tire: any }
  | { type: 'maintenance'; tire: any }
  | { type: 'events'; tire: any }
  | { type: 'deductions' }
  | null

export default function Tires() {
  const { t: tr } = useTranslation()
  const qc = useQueryClient()
  const { hasRole, user } = useAuthStore()

  const STATUS_LABELS: Record<string, string> = {
    in_stock: tr('tires.statusInStock'), installed: tr('tires.statusInstalled'),
    returned: tr('tires.statusReturned'), written_off: tr('tires.statusWrittenOff'),
    damaged: tr('tires.statusDamaged'), warning: tr('tires.statusWarning'),
    critical: tr('tires.statusCritical'), warranty_expiring: tr('tires.statusWarrantyExpiring'),
  }
  const CONDITION_LABELS: Record<string, string> = {
    excellent: tr('tires.condExcellent'), good: tr('tires.condGood'), fair: tr('tires.condFair'),
    poor: tr('tires.condPoor'), critical: tr('tires.condCritical'), unknown: tr('tires.condUnknown'),
  }
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [statusFilter, setStatusFilter] = useState('')
  const [modal, setModal] = useState<ActiveModal>(null)
  const close = () => setModal(null)

  // Form instances
  const addForm = useForm<any>({ defaultValues: { type: 'Summer', standardMileageKm: '40000' } })
  const installForm = useForm<any>()
  const removeForm = useForm<any>()
  const verifyForm = useForm<any>()
  const writeOffForm = useForm<any>()
  const maintForm = useForm<any>()

  // Queries
  const { data: stats } = useQuery({
    queryKey: ['tire-stats'],
    queryFn: () => api.get('/tires/stats').then(r => r.data.data),
  })
  const { data, isLoading } = useQuery({
    queryKey: ['tires', page, limit, debouncedSearch, statusFilter],
    queryFn: () => api.get('/tires', { params: { page, limit, search: debouncedSearch || undefined, status: statusFilter || undefined } }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-for-tires'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
  })
  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })
  const { data: usersData } = useQuery({
    queryKey: ['users-list'],
    queryFn: () => api.get('/expenses/users', { params: { limit: 200 } }).then(r => r.data.data),
  })
  const { data: eventsData } = useQuery({
    queryKey: ['tire-events', modal?.type === 'events' ? (modal as any).tire?.id : null],
    queryFn: () => api.get(`/tires/${(modal as any).tire.id}/events`).then(r => r.data.data),
    enabled: modal?.type === 'events',
  })
  const { data: deductionsData, isLoading: deductionsLoading } = useQuery({
    queryKey: ['tire-deductions'],
    queryFn: () => api.get('/tires/deductions').then(r => r.data),
    enabled: modal?.type === 'deductions',
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tires'] })
    qc.invalidateQueries({ queryKey: ['tire-stats'] })
  }

  // Mutations
  const createMutation = useMutation({
    mutationFn: (d: any) => api.post('/tires', { ...d, branchId: user?.branchId || undefined }),
    onSuccess: () => { toast.success(tr('tires.toastAdded')); invalidate(); close(); addForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || tr('tires.toastError')),
  })
  const installMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/install`, d),
    onSuccess: () => { toast.success(tr('tires.toastInstalled')); invalidate(); close(); installForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || tr('tires.toastError')),
  })
  const removeMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/remove`, d),
    onSuccess: (res) => {
      toast.success(tr('tires.toastRemoved', { km: res.data.data?.actualMileageUsed?.toLocaleString() || 0 }))
      invalidate(); close(); removeForm.reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || tr('tires.toastError')),
  })
  const [verifyResult, setVerifyResult] = useState<any>(null)
  const verifyMutation = useMutation({
    mutationFn: (d: any) => api.post('/tires/verify-return', d),
    onSuccess: (res) => setVerifyResult(res.data.data),
    onError: (e: any) => toast.error(e.response?.data?.error || tr('tires.toastNotFound')),
  })
  const writeOffMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/write-off`, d),
    onSuccess: (res) => {
      const { deductionAmount, standardKm, actualKm } = res.data.data
      if (deductionAmount > 0) {
        toast.success(tr('tires.toastWrittenOff', { amount: formatCurrency(deductionAmount), km: standardKm - actualKm }), { duration: 6000 })
      } else {
        toast.success(tr('tires.toastWrittenOffFull'))
      }
      invalidate(); close(); writeOffForm.reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || tr('tires.toastError')),
  })
  const maintMutation = useMutation({
    mutationFn: ({ id, d }: any) => api.post(`/tires/${id}/maintenance`, d),
    onSuccess: () => { toast.success(tr('tires.toastMaintAdded')); invalidate(); close(); maintForm.reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || tr('tires.toastError')),
  })
  const settleMutation = useMutation({
    mutationFn: (id: string) => api.patch(`/tires/deductions/${id}/settle`, {}),
    onSuccess: () => { toast.success(tr('tires.toastSettled')); qc.invalidateQueries({ queryKey: ['tire-deductions'] }); invalidate() },
    onError: (e: any) => toast.error(e.response?.data?.error || tr('tires.toastError')),
  })

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))
  const suppliers = [{ value: '', label: '— Tanlang —' }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]
  const users = [{ value: '', label: '— Tanlang —' }, ...(usersData || []).map((u: any) => ({ value: u.id, label: u.fullName }))]

  const columns = [
    {
      key: 'serial', title: tr('tires.colSerial'), render: (t: any) => (
        <div>
          <p className="font-mono font-bold text-blue-700 dark:text-blue-400 text-sm">{t.serialCode}</p>
          <p className="text-xs text-gray-400 font-mono">{t.uniqueId}</p>
          {t.dotCode && <p className="text-xs text-gray-400">DOT: {t.dotCode}</p>}
        </div>
      )
    },
    {
      key: 'brand', title: tr('tires.colBrand'), render: (t: any) => (
        <div>
          <p className="font-semibold text-gray-900 dark:text-white">{t.brand} {t.model}</p>
          <p className="text-xs text-gray-500">{t.size} · {t.type}</p>
          <p className="text-xs text-gray-400">{tr('tires.colNorma')}: {(t.standardMileageKm || 40000).toLocaleString()} km</p>
        </div>
      )
    },
    {
      key: 'status', title: tr('tires.colStatus'), render: (t: any) => {
        const s = t.displayStatus || t.status
        return (
          <div className="space-y-1">
            <Badge variant={STATUS_COLORS[s]}>{STATUS_LABELS[s] || s}</Badge>
            <Badge variant={CONDITION_COLORS[t.condition]}>{CONDITION_LABELS[t.condition]}</Badge>
          </div>
        )
      }
    },
    {
      key: 'vehicle', title: tr('tires.colVehicle'), render: (t: any) => t.vehicle ? (
        <div>
          <p className="font-mono text-sm font-medium">{t.vehicle.registrationNumber}</p>
          <p className="text-xs text-gray-500">{t.vehicle.brand} {t.vehicle.model}</p>
          <p className="text-xs text-blue-500">{t.position || '—'}</p>
          {t.driver && <p className="text-xs text-gray-400">👤 {t.driver.fullName}</p>}
        </div>
      ) : <span className="text-gray-400 text-xs">—</span>
    },
    {
      key: 'mileage', title: tr('tires.colMileage'), render: (t: any) => {
        const depth = Number(t.currentTreadDepth || 0)
        const color = depth < 1.6 ? 'bg-red-500' : depth < 3 ? 'bg-yellow-500' : 'bg-green-500'
        const installKm = t.installedMileageKm != null ? Number(t.installedMileageKm) : null
        const vehicleKm = t.vehicle?.mileage != null ? Number(t.vehicle.mileage) : null
        const kmSinceInstall = t.status === 'installed' && installKm != null && vehicleKm != null
          ? Math.max(0, vehicleKm - installKm) : null
        const stdKm = t.standardMileageKm || 40000
        const usedTotal = Number(t.totalMileage || 0) + (kmSinceInstall ?? 0)
        const usedPct = Math.min(100, Math.round((usedTotal / stdKm) * 100))
        return (
          <div className="space-y-1">
            {installKm != null && (
              <p className="text-xs text-gray-400">O'rnatildi: <span className="font-medium">{installKm.toLocaleString()} km</span></p>
            )}
            {kmSinceInstall != null && (
              <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">+{kmSinceInstall.toLocaleString()} km yurdi</p>
            )}
            <p className="text-xs text-gray-500">{tr('tires.colMileageDriven')}: <span className="font-medium text-gray-800 dark:text-gray-200">{Number(t.totalMileage || 0).toLocaleString()} km</span></p>
            <div className="w-20 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full">
              <div className={`h-1.5 rounded-full ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                style={{ width: `${usedPct}%` }} />
            </div>
            {depth > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="w-16 h-1.5 bg-gray-200 dark:bg-gray-600 rounded-full">
                  <div className={`h-1.5 rounded-full ${color}`} style={{ width: `${Math.min(100, (depth / 8.5) * 100)}%` }} />
                </div>
                <span className={`text-xs font-bold ${depth < 1.6 ? 'text-red-600' : depth < 3 ? 'text-yellow-600' : 'text-green-600'}`}>{depth.toFixed(1)} mm</span>
              </div>
            )}
          </div>
        )
      }
    },
    {
      key: 'price', title: tr('tires.colPrice'), render: (t: any) => (
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(Number(t.purchasePrice))}</p>
          <p className="text-xs text-gray-400">{formatDate(t.purchaseDate)}</p>
        </div>
      )
    },
    {
      key: 'actions', title: '', render: (t: any) => {
        const s = t.displayStatus || t.status
        return (
          <div className="flex flex-col gap-1 min-w-[90px]">
            <button onClick={() => setModal({ type: 'detail', tire: t })}
              className="text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200">
              {tr('tires.actionView')}
            </button>
            <button onClick={() => setModal({ type: 'events', tire: t })}
              className="text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 hover:bg-blue-100">
              {tr('tires.actionHistory')}
            </button>
            {hasRole('admin', 'manager', 'branch_manager') && s !== 'written_off' && (
              <>
                {s !== 'installed' && (
                  <button onClick={() => { installForm.reset({ installedMileageKm: '' }); setModal({ type: 'install', tire: t }) }}
                    className="text-xs px-2 py-1 rounded bg-green-50 dark:bg-green-900/30 text-green-700 hover:bg-green-100">
                    {tr('tires.actionInstall')}
                  </button>
                )}
                {s === 'installed' && (
                  <button onClick={() => { removeForm.reset(); setModal({ type: 'remove', tire: t }) }}
                    className="text-xs px-2 py-1 rounded bg-yellow-50 dark:bg-yellow-900/30 text-yellow-700 hover:bg-yellow-100">
                    {tr('tires.actionRemove')}
                  </button>
                )}
                <button onClick={() => { maintForm.reset({ date: new Date().toISOString().split('T')[0], cost: '0' }); setModal({ type: 'maintenance', tire: t }) }}
                  className="text-xs px-2 py-1 rounded bg-purple-50 dark:bg-purple-900/30 text-purple-700 hover:bg-purple-100">
                  {tr('tires.actionMaintenance')}
                </button>
                {hasRole('admin', 'manager') && (
                  <button onClick={() => { writeOffForm.reset(); setModal({ type: 'write-off', tire: t }) }}
                    className="text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-700 hover:bg-red-100">
                    {tr('tires.actionWriteOff')}
                  </button>
                )}
              </>
            )}
          </div>
        )
      }
    },
  ]

  const pendingDeductionsCount = stats?.pendingDeductions || 0

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{tr('tires.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{tr('tires.subtitle')}</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExcelExportButton endpoint="/exports/tires" label="Excel" />
          <Button variant="outline" icon={<QrCode className="w-4 h-4" />}
            onClick={() => { setVerifyResult(null); verifyForm.reset(); setModal({ type: 'verify-return' }) }}>
            {tr('tires.verifyBtn')}
          </Button>
          {pendingDeductionsCount > 0 && (
            <Button variant="outline" icon={<DollarSign className="w-4 h-4 text-red-500" />}
              onClick={() => setModal({ type: 'deductions' })}>
              {tr('tires.deductionsBtn', { count: pendingDeductionsCount })}
            </Button>
          )}
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { addForm.reset({ type: 'Summer', standardMileageKm: '40000' }); setModal({ type: 'add' }) }}>
              {tr('tires.addBtn')}
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { label: tr('tires.statTotal'), value: stats.total, card: 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800', lbl: 'text-blue-600 dark:text-blue-400', val: 'text-blue-900 dark:text-blue-100' },
            { label: tr('tires.statInStock'), value: stats.inStock, card: 'bg-indigo-50 dark:bg-indigo-900/20 border-indigo-200 dark:border-indigo-800', lbl: 'text-indigo-600 dark:text-indigo-400', val: 'text-indigo-900 dark:text-indigo-100' },
            { label: tr('tires.statInstalled'), value: stats.installed, card: 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800', lbl: 'text-green-600 dark:text-green-400', val: 'text-green-900 dark:text-green-100' },
            { label: tr('tires.statReturned'), value: stats.returned, card: 'bg-yellow-50 dark:bg-yellow-900/20 border-yellow-200 dark:border-yellow-800', lbl: 'text-yellow-600 dark:text-yellow-400', val: 'text-yellow-900 dark:text-yellow-100' },
            { label: tr('tires.statWrittenOff'), value: stats.writtenOff, card: 'bg-gray-100 dark:bg-gray-700/50 border-gray-200 dark:border-gray-600', lbl: 'text-gray-500 dark:text-gray-400', val: 'text-gray-700 dark:text-gray-200' },
          ].map(({ label, value, card, lbl, val }) => (
            <div key={label} className={`border rounded-xl p-4 ${card}`}>
              <p className={`text-xs font-medium ${lbl}`}>{label}</p>
              <p className={`text-2xl font-bold ${val}`}>{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Pending deductions alert */}
      {pendingDeductionsCount > 0 && (
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4 flex items-center gap-3">
          <ShieldAlert className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div className="flex-1">
            <p className="font-medium text-red-800 dark:text-red-300">
              {tr('tires.alertDeductions', { count: pendingDeductionsCount, amount: formatCurrency(stats?.pendingDeductionsTotal || 0) })}
            </p>
            <p className="text-xs text-red-600 dark:text-red-400 mt-0.5">{tr('tires.alertDeductionsHint')}</p>
          </div>
          <Button size="sm" variant="outline" onClick={() => setModal({ type: 'deductions' })}>{tr('tires.alertViewBtn')}</Button>
        </div>
      )}

      {/* Urgent tires alert */}
      {stats?.urgentTires?.length > 0 && (
        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-yellow-600 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-yellow-800 dark:text-yellow-300">{tr('tires.alertUrgent')}</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {stats.urgentTires.map((t: any) => (
                  <span key={t.id} className="text-xs bg-yellow-100 dark:bg-yellow-900/40 text-yellow-800 dark:text-yellow-300 px-2 py-1 rounded-full font-mono">
                    {t.serialCode} · {t.vehicle?.registrationNumber || '—'} — {Number(t.currentTreadDepth).toFixed(1)} mm
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value) }}
              placeholder={tr('tires.searchPlaceholder')}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="relative">
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{tr('tires.filterAllStatuses')}</option>
              <option value="in_stock">{tr('tires.statusInStock')}</option>
              <option value="installed">{tr('tires.statusInstalled')}</option>
              <option value="returned">{tr('tires.statusReturned')}</option>
              <option value="written_off">{tr('tires.statusWrittenOff')}</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* ===== DETAIL MODAL ===== */}
      {modal?.type === 'detail' && (() => {
        const t = (modal as any).tire
        const s = t.displayStatus || t.status
        const depth = Number(t.currentTreadDepth || 0)
        const depthColor = depth < 1.6 ? 'text-red-600' : depth < 3 ? 'text-yellow-600' : 'text-green-600'
        const depthBarColor = depth < 1.6 ? 'bg-red-500' : depth < 3 ? 'bg-yellow-500' : 'bg-green-500'
        const stdKm = t.standardMileageKm || 40000
        const usedKm = Number(t.totalMileage || 0)
        const usedPct = Math.min(100, Math.round((usedKm / stdKm) * 100))
        return (
          <Modal open onClose={close} title={tr('tires.detailTitle')} size="lg">
            <div className="space-y-5">
              {/* Header strip */}
              <div className="flex flex-wrap items-center gap-3">
                <div className="flex-1 min-w-0">
                  <p className="font-mono font-bold text-blue-700 dark:text-blue-400 text-lg">{t.serialCode}</p>
                  <p className="text-sm text-gray-500 font-mono">{t.uniqueId}{t.dotCode ? ` · DOT: ${t.dotCode}` : ''}</p>
                </div>
                <div className="flex gap-2 flex-wrap">
                  <Badge variant={STATUS_COLORS[s]}>{STATUS_LABELS[s] || s}</Badge>
                  <Badge variant={CONDITION_COLORS[t.condition]}>{CONDITION_LABELS[t.condition]}</Badge>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Left: basic info */}
                <div className="space-y-3">
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{tr('tires.detailSectionTire')}</p>
                    {[
                      [tr('tires.detailBrandModel'), `${t.brand} ${t.model}`],
                      [tr('tires.detailSize'), t.size],
                      [tr('tires.detailType'), t.type],
                      [tr('tires.detailSerial'), t.serialNumber || '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">{k}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{v}</span>
                      </div>
                    ))}
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{tr('tires.detailSectionPurchase')}</p>
                    {[
                      [tr('tires.detailPurchasePrice'), formatCurrency(Number(t.purchasePrice))],
                      [tr('tires.detailPurchaseDate'), formatDate(t.purchaseDate)],
                      [tr('tires.detailSupplier'), t.supplier?.name || '—'],
                      [tr('tires.detailWarranty'), t.warrantyEndDate ? formatDate(t.warrantyEndDate) : '—'],
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">{k}</span>
                        <span className="font-medium text-gray-900 dark:text-white">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right: vehicle + mileage */}
                <div className="space-y-3">
                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-2">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{tr('tires.detailSectionInstalled')}</p>
                    {t.vehicle ? (
                      <>
                        {[
                          [tr('tires.detailCar'), t.vehicle.registrationNumber],
                          [tr('tires.detailModel'), `${t.vehicle.brand} ${t.vehicle.model}`],
                          [tr('tires.detailPosition'), t.position || '—'],
                          [tr('tires.detailDriver'), t.driver?.fullName || '—'],
                        ].map(([k, v]) => (
                          <div key={k} className="flex justify-between text-sm">
                            <span className="text-gray-500 dark:text-gray-400">{k}</span>
                            <span className="font-medium text-gray-900 dark:text-white font-mono">{v}</span>
                          </div>
                        ))}
                      </>
                    ) : (
                      <p className="text-sm text-gray-400">{tr('tires.detailNotInstalled')}</p>
                    )}
                  </div>

                  <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider">{tr('tires.detailSectionMileage')}</p>
                    {t.installedMileageKm != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">O'rnatilgan km</span>
                        <span className="font-medium text-gray-900 dark:text-white">{Number(t.installedMileageKm).toLocaleString()} km</span>
                      </div>
                    )}
                    {t.status === 'installed' && t.installedMileageKm != null && t.vehicle?.mileage != null && (
                      <div className="flex justify-between text-sm">
                        <span className="text-gray-500 dark:text-gray-400">O'rnatilganidan beri</span>
                        <span className="font-bold text-blue-600 dark:text-blue-400">
                          +{Math.max(0, Number(t.vehicle.mileage) - Number(t.installedMileageKm)).toLocaleString()} km
                        </span>
                      </div>
                    )}
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">{tr('tires.detailTotalDriven')}</span>
                      <span className="font-bold text-gray-900 dark:text-white">{usedKm.toLocaleString()} km</span>
                    </div>
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">{tr('tires.detailStdNorm')}</span>
                      <span className="font-medium text-gray-900 dark:text-white">{stdKm.toLocaleString()} km</span>
                    </div>
                    <div>
                      <div className="flex justify-between text-xs text-gray-400 mb-1">
                        <span>{tr('tires.detailUsage')}</span>
                        <span>{usedPct}%</span>
                      </div>
                      <div className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-full">
                        <div className={`h-2 rounded-full ${usedPct >= 90 ? 'bg-red-500' : usedPct >= 70 ? 'bg-yellow-500' : 'bg-green-500'}`}
                          style={{ width: `${usedPct}%` }} />
                      </div>
                    </div>
                    {depth > 0 && (
                      <div>
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>{tr('tires.detailTread')}</span>
                          <span className={`font-bold ${depthColor}`}>{depth.toFixed(1)} mm</span>
                        </div>
                        <div className="w-full h-2 bg-gray-200 dark:bg-gray-600 rounded-full">
                          <div className={`h-2 rounded-full ${depthBarColor}`}
                            style={{ width: `${Math.min(100, (depth / 8.5) * 100)}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {t.notes && (
                <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl p-3 text-sm text-blue-700 dark:text-blue-300">
                  <span className="font-medium">{tr('tires.detailNote')}: </span>{t.notes}
                </div>
              )}

              <div className="flex justify-end gap-2 pt-1">
                <Button variant="outline" onClick={close}>{tr('tires.detailCloseBtn')}</Button>
                <Button variant="outline" icon={<History className="w-4 h-4" />}
                  onClick={() => setModal({ type: 'events', tire: t })}>
                  {tr('tires.detailHistoryBtn')}
                </Button>
              </div>
            </div>
          </Modal>
        )
      })()}

      {/* ===== ADD TIRE MODAL ===== */}
      <Modal open={modal?.type === 'add'} onClose={close} title={tr('tires.addTitle')} size="lg"
        footer={<>
          <Button variant="outline" onClick={close}>{tr('tires.addCancelBtn')}</Button>
          <Button loading={createMutation.isPending} onClick={addForm.handleSubmit(d => createMutation.mutate(d))}>{tr('tires.addSaveBtn')}</Button>
        </>}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Input label={tr('tires.addLabelSerial')} placeholder="5091609750"
              error={addForm.formState.errors.serialCode?.message as string}
              {...addForm.register('serialCode', { required: tr('tires.addErrSerial') })}
              hint={tr('tires.addHintSerial')} />
          </div>
          <Input label={tr('tires.addLabelBrand')} placeholder="Michelin"
            error={addForm.formState.errors.brand?.message as string}
            {...addForm.register('brand', { required: tr('tires.addErrRequired') })} />
          <Input label={tr('tires.addLabelModel')} placeholder="Pilot Sport"
            error={addForm.formState.errors.model?.message as string}
            {...addForm.register('model', { required: tr('tires.addErrRequired') })} />
          <Input label={tr('tires.addLabelSize')} placeholder="205/55R16"
            error={addForm.formState.errors.size?.message as string}
            {...addForm.register('size', { required: tr('tires.addErrRequired') })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.addLabelType')}</label>
            <select {...addForm.register('type')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TIRE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <Input label={tr('tires.addLabelDot')} placeholder="2524" hint={tr('tires.addHintDot')}
            {...addForm.register('dotCode')} />
          <Input label={tr('tires.addLabelSerialNo')} placeholder="ABC123"
            {...addForm.register('serialNumber')} />
          <Input label={tr('tires.addLabelDate')} type="date"
            error={addForm.formState.errors.purchaseDate?.message as string}
            {...addForm.register('purchaseDate', { required: tr('tires.addErrRequired') })} />
          <Input label={tr('tires.addLabelPrice')} type="number" placeholder="850000" min={0}
            error={addForm.formState.errors.purchasePrice?.message as string}
            {...addForm.register('purchasePrice', { required: tr('tires.addErrRequired') })} />
          <Input label={tr('tires.addLabelNorm')} type="number" placeholder="40000" min={0}
            hint={tr('tires.addHintNorm')}
            {...addForm.register('standardMileageKm')} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.addLabelSupplier')}</label>
            <SearchableSelect label="" options={suppliers}
              value={addForm.watch('supplierId') || ''}
              onChange={v => addForm.setValue('supplierId', v)}
              placeholder={tr('tires.addPlaceholderSupplier')} />
          </div>
          <Input label={tr('tires.addLabelTread')} type="number" step="0.1" placeholder="8.5"
            {...addForm.register('initialTreadDepth')} />
          <Input label={tr('tires.addLabelWarranty')} type="date"
            {...addForm.register('warrantyEndDate')} />
          <div className="sm:col-span-2">
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.addLabelNotes')}</label>
            <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2}
              {...addForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== INSTALL MODAL ===== */}
      <Modal open={modal?.type === 'install'} onClose={close}
        title={`O'rnatish: ${(modal as any)?.tire?.serialCode || ''}`} size="md"
        footer={<>
          <Button variant="outline" onClick={close}>{tr('tires.installCancelBtn')}</Button>
          <Button loading={installMutation.isPending} icon={<ArrowDown className="w-4 h-4" />}
            onClick={installForm.handleSubmit(d => {
              if (!installForm.getValues('vehicleId')) { toast.error(tr('tires.toastVehicleRequired')); return }
              installMutation.mutate({ id: (modal as any).tire.id, d })
            })}>
            {tr('tires.installConfirmBtn')}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-3 text-sm text-blue-700 dark:text-blue-300">
            <p className="font-mono font-bold">{(modal as any)?.tire?.brand} {(modal as any)?.tire?.model} {(modal as any)?.tire?.size}</p>
            <p className="text-xs mt-0.5">Serial: {(modal as any)?.tire?.serialCode}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.installLabelVehicle')}</label>
            <SearchableSelect label="" options={vehicles}
              value={installForm.watch('vehicleId') || ''}
              onChange={v => installForm.setValue('vehicleId', v)}
              placeholder={tr('tires.installPlaceholderVehicle')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.installLabelDriver')}</label>
            <SearchableSelect label="" options={users}
              value={installForm.watch('driverId') || ''}
              onChange={v => installForm.setValue('driverId', v)}
              placeholder={tr('tires.installPlaceholderDriver')} />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.installLabelPosition')}</label>
            <select {...installForm.register('position')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">{tr('tires.installSelectDefault')}</option>
              {POSITIONS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <Input label={tr('tires.installLabelOdometer')} type="number" placeholder="85000"
            hint={tr('tires.installHintOdometer')}
            {...installForm.register('installedMileageKm')} />
          <Input label={tr('tires.installLabelDate')} type="date"
            {...installForm.register('installationDate')} />
        </div>
      </Modal>

      {/* ===== REMOVE MODAL ===== */}
      <Modal open={modal?.type === 'remove'} onClose={close}
        title={`Avtomobildan olish: ${(modal as any)?.tire?.serialCode || ''}`} size="sm"
        footer={<>
          <Button variant="outline" onClick={close}>{tr('tires.removeCancelBtn')}</Button>
          <Button loading={removeMutation.isPending} icon={<ArrowUp className="w-4 h-4" />}
            onClick={removeForm.handleSubmit(d => removeMutation.mutate({ id: (modal as any).tire.id, d }))}>
            {tr('tires.removeConfirmBtn')}
          </Button>
        </>}
      >
        <div className="space-y-4">
          {(modal as any)?.tire?.installedMileageKm && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3 text-sm">
              <p className="text-gray-500">{tr('tires.removeInstalledAt')}: <span className="font-bold text-gray-900 dark:text-white">{Number((modal as any).tire.installedMileageKm).toLocaleString()} km</span></p>
            </div>
          )}
          <Input label={tr('tires.removeLabelOdometer')} type="number" placeholder="110000"
            hint={tr('tires.removeHintOdometer')}
            error={removeForm.formState.errors.removedMileageKm?.message as string}
            {...removeForm.register('removedMileageKm', { required: tr('tires.removeErrOdometer') })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.removeLabelNotes')}</label>
            <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg" rows={2}
              placeholder={tr('tires.removePlaceholderNotes')}
              {...removeForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== VERIFY RETURN MODAL ===== */}
      <Modal open={modal?.type === 'verify-return'} onClose={() => { close(); setVerifyResult(null) }}
        title={tr('tires.verifyTitle')} size="md">
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-400">{tr('tires.verifyDesc')}</p>
          <Input label={tr('tires.verifyLabelSerial')} placeholder="5091609750"
            {...verifyForm.register('serialCode', { required: true })} />
          <Input label={tr('tires.verifyLabelDot')} placeholder="2524"
            hint={tr('tires.verifyHintDot')}
            {...verifyForm.register('dotCode')} />
          <Button loading={verifyMutation.isPending} className="w-full"
            onClick={verifyForm.handleSubmit(d => verifyMutation.mutate(d))}>
            {tr('tires.verifyCheckBtn')}
          </Button>

          {verifyResult && (
            <div className={`rounded-xl border p-4 space-y-3 ${verifyResult.verified ? 'bg-green-50 dark:bg-green-900/20 border-green-300 dark:border-green-700' : 'bg-red-50 dark:bg-red-900/20 border-red-300 dark:border-red-700'}`}>
              <div className="flex items-center gap-2">
                {verifyResult.verified
                  ? <CheckCircle className="w-5 h-5 text-green-600" />
                  : <AlertTriangle className="w-5 h-5 text-red-600" />}
                <p className={`font-bold ${verifyResult.verified ? 'text-green-800 dark:text-green-300' : 'text-red-800 dark:text-red-300'}`}>
                  {verifyResult.verified ? tr('tires.verifySuccess') : tr('tires.verifyFailed')}
                </p>
              </div>
              {verifyResult.warning && <p className="text-sm text-red-700 dark:text-red-300">{verifyResult.warning}</p>}
              <div className="grid grid-cols-2 gap-2 text-xs">
                {[
                  [tr('tires.verifyRowSerial'), verifyResult.tire?.serialCode],
                  [tr('tires.verifyRowDot'), verifyResult.tire?.dotCode || '—'],
                  [tr('tires.verifyRowBrand'), `${verifyResult.tire?.brand} ${verifyResult.tire?.model}`],
                  [tr('tires.verifyRowSize'), verifyResult.tire?.size],
                  [tr('tires.verifyRowStatus'), STATUS_LABELS[verifyResult.tire?.status] || verifyResult.tire?.status],
                  [tr('tires.verifyRowPurchased'), formatDate(verifyResult.tire?.purchaseDate)],
                  [tr('tires.verifyRowNormKm'), (verifyResult.tire?.standardMileageKm || 40000).toLocaleString()],
                  [tr('tires.verifyRowDrivenKm'), Number(verifyResult.tire?.totalMileage || 0).toLocaleString()],
                ].map(([k, v]) => (
                  <div key={k} className="bg-white dark:bg-gray-800 rounded-lg p-2">
                    <p className="text-gray-400">{k}</p>
                    <p className="font-bold text-gray-900 dark:text-white">{v}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* ===== WRITE-OFF MODAL ===== */}
      <Modal open={modal?.type === 'write-off'} onClose={close}
        title={`Hisobdan chiqarish: ${(modal as any)?.tire?.serialCode || ''}`} size="md"
        footer={<>
          <Button variant="outline" onClick={close}>{tr('tires.writeOffCancelBtn')}</Button>
          <Button loading={writeOffMutation.isPending} variant="danger"
            onClick={writeOffForm.handleSubmit(d => writeOffMutation.mutate({ id: (modal as any).tire.id, d }))}>
            {tr('tires.writeOffConfirmBtn')}
          </Button>
        </>}
      >
        {modal?.type === 'write-off' && (() => {
          const t = (modal as any).tire
          const stdKm = t.standardMileageKm || 40000
          const actualKm = Number(t.actualMileageUsed || t.totalMileage || 0)
          const remainingKm = Math.max(0, stdKm - actualKm)
          const deductionPerKm = Number(t.purchasePrice) / stdKm
          const deductionAmount = remainingKm * deductionPerKm
          return (
            <div className="space-y-4">
              {/* Summary */}
              <div className="bg-gray-50 dark:bg-gray-700/50 rounded-xl p-4 grid grid-cols-3 gap-3 text-center text-sm">
                <div>
                  <p className="text-gray-500 text-xs">{tr('tires.writeOffNorm')}</p>
                  <p className="font-bold text-gray-900 dark:text-white">{stdKm.toLocaleString()} km</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">{tr('tires.writeOffDriven')}</p>
                  <p className="font-bold text-blue-600">{actualKm.toLocaleString()} km</p>
                </div>
                <div>
                  <p className="text-gray-500 text-xs">{tr('tires.writeOffRemaining')}</p>
                  <p className={`font-bold ${remainingKm > 0 ? 'text-red-600' : 'text-green-600'}`}>{remainingKm.toLocaleString()} km</p>
                </div>
              </div>

              {remainingKm > 0 && t.driverId && (
                <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl p-4">
                  <p className="text-sm font-semibold text-red-800 dark:text-red-300 flex items-center gap-2">
                    <DollarSign className="w-4 h-4" />
                    {tr('tires.writeOffDeductionTitle')}
                  </p>
                  <div className="grid grid-cols-2 gap-2 mt-2 text-xs">
                    <div><p className="text-gray-500">{tr('tires.writeOffPerKm')}</p><p className="font-bold">{formatCurrency(Math.round(deductionPerKm))}</p></div>
                    <div><p className="text-gray-500">{tr('tires.writeOffAmount')}</p><p className="font-bold text-red-700 dark:text-red-300 text-base">{formatCurrency(Math.round(deductionAmount))}</p></div>
                  </div>
                </div>
              )}

              {remainingKm > 0 && !t.driverId && (
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 rounded-lg p-3 text-xs text-yellow-700 dark:text-yellow-300">
                  {tr('tires.writeOffNoDriver')}
                </div>
              )}

              <Input label={tr('tires.writeOffLabelOverride')} type="number"
                placeholder={String(actualKm)}
                hint={tr('tires.writeOffHintOverride')}
                {...writeOffForm.register('overrideActualKm')} />

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.writeOffLabelReason')}</label>
                <select {...writeOffForm.register('reason', { required: true })}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="">{tr('tires.writeOffReasonSelect')}</option>
                  <option value="worn_out">{tr('tires.writeOffReasonWornOut')}</option>
                  <option value="worn_early">{tr('tires.writeOffReasonWornEarly')}</option>
                  <option value="damaged">{tr('tires.writeOffReasonDamaged')}</option>
                  <option value="lost">{tr('tires.writeOffReasonLost')}</option>
                  <option value="other">{tr('tires.writeOffReasonOther')}</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.writeOffLabelDisposal')}</label>
                <input className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                  placeholder={tr('tires.writeOffPlaceholderDisposal')}
                  {...writeOffForm.register('disposalMethod')} />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.writeOffLabelNotes')}</label>
                <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg" rows={2}
                  {...writeOffForm.register('notes')} />
              </div>
            </div>
          )
        })()}
      </Modal>

      {/* ===== MAINTENANCE MODAL ===== */}
      <Modal open={modal?.type === 'maintenance'} onClose={close}
        title={`Texnik xizmat: ${(modal as any)?.tire?.serialCode || ''}`} size="sm"
        footer={<>
          <Button variant="outline" onClick={close}>{tr('tires.maintCancelBtn')}</Button>
          <Button loading={maintMutation.isPending} icon={<Wrench className="w-4 h-4" />}
            onClick={maintForm.handleSubmit(d => maintMutation.mutate({ id: (modal as any).tire.id, d }))}>
            {tr('tires.maintSaveBtn')}
          </Button>
        </>}
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.maintLabelType')}</label>
            <select {...maintForm.register('type', { required: true })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg">
              <option value="rotation">{tr('tires.maintTypeRotation')}</option>
              <option value="repair">{tr('tires.maintTypeRepair')}</option>
              <option value="inspection">{tr('tires.maintTypeInspection')}</option>
              <option value="pressure_check">{tr('tires.maintTypePressure')}</option>
            </select>
          </div>
          <Input label={tr('tires.maintLabelDate')} type="date" {...maintForm.register('date', { required: true })} />
          <Input label={tr('tires.maintLabelCost')} type="number" placeholder="0" min={0} {...maintForm.register('cost')} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">{tr('tires.maintLabelNotes')}</label>
            <textarea className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg" rows={2}
              {...maintForm.register('notes')} />
          </div>
        </div>
      </Modal>

      {/* ===== EVENTS / HISTORY MODAL ===== */}
      <Modal open={modal?.type === 'events'} onClose={close}
        title={`Tarix: ${(modal as any)?.tire?.serialCode || ''}`} size="md">
        <div className="space-y-2">
          {/* Tire summary */}
          {modal?.type === 'events' && (
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-3 grid grid-cols-3 gap-2 text-xs mb-4">
              {[
                [tr('tires.eventsRowSerial'), (modal as any).tire.serialCode],
                [tr('tires.eventsRowBrand'), `${(modal as any).tire.brand} ${(modal as any).tire.model}`],
                [tr('tires.eventsRowSize'), (modal as any).tire.size],
                [tr('tires.eventsRowPrice'), formatCurrency(Number((modal as any).tire.purchasePrice))],
                [tr('tires.eventsRowNorm'), `${((modal as any).tire.standardMileageKm || 40000).toLocaleString()} km`],
                [tr('tires.eventsRowTotalKm'), Number((modal as any).tire.totalMileage || 0).toLocaleString()],
              ].map(([k, v]) => (
                <div key={k} className="text-center">
                  <p className="text-gray-400">{k}</p>
                  <p className="font-bold text-gray-900 dark:text-white">{v}</p>
                </div>
              ))}
            </div>
          )}
          {!eventsData ? (
            <div className="py-8 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : eventsData.length === 0 ? (
            <p className="text-center text-gray-400 py-8">{tr('tires.eventsEmpty')}</p>
          ) : (
            <div className="space-y-2 max-h-80 overflow-y-auto">
              {eventsData.map((ev: any) => {
                const icons: Record<string, React.ReactNode> = {
                  purchased: <Package className="w-4 h-4 text-blue-500" />,
                  installed: <ArrowDown className="w-4 h-4 text-green-500" />,
                  removed: <ArrowUp className="w-4 h-4 text-yellow-500" />,
                  returned: <RotateCcw className="w-4 h-4 text-orange-500" />,
                  written_off: <ShieldAlert className="w-4 h-4 text-red-500" />,
                  deduction_applied: <DollarSign className="w-4 h-4 text-purple-500" />,
                }
                const labels: Record<string, string> = {
                  purchased: tr('tires.eventsLabelPurchased'), installed: tr('tires.eventsLabelInstalled'),
                  removed: tr('tires.eventsLabelRemoved'), returned: tr('tires.eventsLabelReturned'),
                  written_off: tr('tires.eventsLabelWrittenOff'), deduction_applied: tr('tires.eventsLabelDeduction'),
                }
                return (
                  <div key={ev.id} className="flex items-start gap-3 p-3 bg-gray-50 dark:bg-gray-700/50 rounded-xl">
                    <div className="mt-0.5">{icons[ev.eventType] || <History className="w-4 h-4 text-gray-400" />}</div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-sm text-gray-900 dark:text-white">{labels[ev.eventType] || ev.eventType}</p>
                      {ev.notes && <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">{ev.notes}</p>}
                      {ev.mileageAtEvent && <p className="text-xs text-blue-500">{ev.mileageAtEvent.toLocaleString()} km</p>}
                    </div>
                    <p className="text-xs text-gray-400 flex-shrink-0">{formatDate(ev.createdAt)}</p>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </Modal>

      {/* ===== DEDUCTIONS MODAL ===== */}
      <Modal open={modal?.type === 'deductions'} onClose={close}
        title={tr('tires.deductionsTitle')} size="xl">
        <div className="space-y-3">
          {deductionsLoading ? (
            <div className="py-8 text-center"><div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" /></div>
          ) : (deductionsData?.data || []).length === 0 ? (
            <div className="py-8 text-center text-gray-400">
              <CheckCircle className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>{tr('tires.deductionsEmpty')}</p>
            </div>
          ) : (
            <div className="space-y-2 max-h-[500px] overflow-y-auto">
              {(deductionsData?.data || []).map((d: any) => (
                <div key={d.id} className={`p-4 rounded-xl border ${d.isSettled ? 'border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/10' : 'border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/10'}`}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-mono font-bold text-sm text-blue-700 dark:text-blue-400">{d.tire?.serialCode}</p>
                        <p className="text-sm text-gray-600 dark:text-gray-300">{d.tire?.brand} {d.tire?.model} {d.tire?.size}</p>
                        {d.isSettled
                          ? <Badge variant="success">{tr('tires.deductionsPaid')}</Badge>
                          : <Badge variant="danger">{tr('tires.deductionsUnpaid')}</Badge>}
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
                        {tr('tires.deductionsDriver')}: <span className="font-medium">{d.driverName || '—'}</span>
                      </p>
                      <div className="flex flex-wrap gap-3 mt-2 text-xs text-gray-500">
                        <span>{tr('tires.deductionsNorm')}: <b>{d.standardMileageKm.toLocaleString()} km</b></span>
                        <span>{tr('tires.deductionsDriven')}: <b>{d.actualMileageKm.toLocaleString()} km</b></span>
                        <span>{tr('tires.deductionsRemaining')}: <b className="text-red-600">{d.remainingMileageKm.toLocaleString()} km</b></span>
                        <span>{tr('tires.deductionsPerKm')}: <b>{formatCurrency(Number(d.deductionPerKm))}</b></span>
                      </div>
                      <p className="text-base font-bold text-red-700 dark:text-red-400 mt-1">
                        {tr('tires.deductionsAmount')}: {formatCurrency(Number(d.deductionAmount))}
                      </p>
                      {d.reason && <p className="text-xs text-gray-400 mt-0.5">{tr('tires.deductionsReason')}: {d.reason}</p>}
                    </div>
                    {!d.isSettled && hasRole('admin', 'manager') && (
                      <Button size="sm" icon={<CheckCircle className="w-3.5 h-3.5" />}
                        loading={settleMutation.isPending}
                        onClick={() => settleMutation.mutate(d.id)}>
                        {tr('tires.deductionsSettleBtn')}
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
