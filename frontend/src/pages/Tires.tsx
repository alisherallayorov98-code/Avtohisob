import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, AlertTriangle, CheckCircle, XCircle, Wrench, RotateCcw, ChevronDown, Search, Filter, Car } from 'lucide-react'
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

const TIRE_TYPES = ['Summer', 'Winter', 'All-season', 'Off-road', 'Spare']
const POSITIONS = ['Front-Left', 'Front-Right', 'Rear-Left', 'Rear-Right']
const MAINTENANCE_TYPES = ['rotation', 'repair', 'inspection', 'pressure_check']

const conditionColors: Record<string, string> = {
  excellent: 'success', good: 'success', fair: 'warning',
  poor: 'warning', critical: 'danger', unknown: 'secondary'
}
const conditionLabels: Record<string, string> = {
  excellent: 'A\'lo', good: 'Yaxshi', fair: "O'rtacha",
  poor: 'Yomon', critical: 'Kritik', unknown: 'Noma\'lum'
}

const statusColors: Record<string, string> = {
  active: 'success', warning: 'warning', critical: 'danger',
  replaced: 'secondary', retired: 'secondary', damaged: 'danger',
  warranty_expiring: 'warning'
}
const statusLabels: Record<string, string> = {
  active: 'Faol', warning: 'Ogohlantirish', critical: 'Kritik',
  replaced: 'Almashtirilgan', retired: 'Chiqarilgan', damaged: 'Shikastlangan',
  warranty_expiring: 'Kafolat tugayapti'
}

interface TireForm {
  brand: string; model: string; size: string; type: string
  serialNumber: string; dotCode: string
  purchaseDate: string; purchasePrice: string; supplierId: string
  vehicleId: string; installationDate: string; position: string
  initialTreadDepth: string; currentTreadDepth: string
  warrantyEndDate: string; branchId: string; notes: string
}

interface MaintenanceForm {
  type: string; date: string; position: string; cost: string; notes: string
}

interface UpdateTreadForm { currentTreadDepth: string; totalMileage: string; notes: string }

export default function Tires() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [addModal, setAddModal] = useState(false)
  const [detailTire, setDetailTire] = useState<any>(null)
  const [maintenanceModal, setMaintenanceModal] = useState<any>(null)
  const [updateTreadModal, setUpdateTreadModal] = useState<any>(null)
  const [retireModal, setRetireModal] = useState<any>(null)

  const { register: reg, handleSubmit, reset, watch: watchT, setValue: setValT, formState: { errors } } = useForm<TireForm>()
  const { register: mReg, handleSubmit: mSubmit, reset: mReset } = useForm<MaintenanceForm>()
  const { register: tReg, handleSubmit: tSubmit, reset: tReset } = useForm<UpdateTreadForm>()

  const { data: stats } = useQuery({
    queryKey: ['tire-stats'],
    queryFn: () => api.get('/tires/stats').then(r => r.data.data),
  })

  const { data, isLoading } = useQuery({
    queryKey: ['tires', page, search, statusFilter],
    queryFn: () => api.get('/tires', { params: { page, limit: 20, search: search || undefined, status: statusFilter || undefined } }).then(r => r.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-for-tires'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const createMutation = useMutation({
    mutationFn: (d: TireForm) => api.post('/tires', d),
    onSuccess: () => {
      toast.success("Avtoshina qo'shildi")
      qc.invalidateQueries({ queryKey: ['tires'] })
      qc.invalidateQueries({ queryKey: ['tire-stats'] })
      setAddModal(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const maintenanceMutation = useMutation({
    mutationFn: ({ tireId, data }: any) => api.post(`/tires/${tireId}/maintenance`, data),
    onSuccess: () => {
      toast.success('Texnik xizmat qo\'shildi')
      qc.invalidateQueries({ queryKey: ['tires'] })
      setMaintenanceModal(null); mReset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const updateTreadMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.patch(`/tires/${id}`, data),
    onSuccess: () => {
      toast.success('Yangilandi')
      qc.invalidateQueries({ queryKey: ['tires'] })
      qc.invalidateQueries({ queryKey: ['tire-stats'] })
      setUpdateTreadModal(null); tReset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const retireMutation = useMutation({
    mutationFn: ({ id, data }: any) => api.post(`/tires/${id}/retire`, data),
    onSuccess: () => {
      toast.success("Avtoshina xizmatdan chiqarildi")
      qc.invalidateQueries({ queryKey: ['tires'] })
      qc.invalidateQueries({ queryKey: ['tire-stats'] })
      setRetireModal(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    {
      key: 'uniqueId', title: 'ID / Brand', render: (t: any) => (
        <div>
          <p className="font-mono text-xs text-gray-400">{t.uniqueId}</p>
          <p className="font-medium text-gray-900 dark:text-white">{t.brand} {t.model}</p>
          <p className="text-xs text-gray-500">{t.size} • {t.type}</p>
        </div>
      )
    },
    {
      key: 'vehicle', title: 'Avtomobil', render: (t: any) => t.vehicle ? (
        <div>
          <p className="font-mono text-sm">{t.vehicle.registrationNumber}</p>
          <p className="text-xs text-gray-500">{t.vehicle.brand} {t.vehicle.model}</p>
          <p className="text-xs text-blue-500">{t.position || '—'}</p>
        </div>
      ) : <span className="text-gray-400 text-sm">O'rnatilmagan</span>
    },
    {
      key: 'tread', title: "Protktor (mm)", render: (t: any) => {
        const depth = Number(t.currentTreadDepth)
        if (!depth) return <span className="text-gray-400">—</span>
        const pct = Math.min(100, (depth / 8.5) * 100)
        const color = depth < 1.6 ? 'bg-red-500' : depth < 3 ? 'bg-yellow-500' : 'bg-green-500'
        return (
          <div className="space-y-1">
            <span className={`font-bold ${depth < 1.6 ? 'text-red-600' : depth < 3 ? 'text-yellow-600' : 'text-green-600'}`}>{depth} mm</span>
            <div className="w-24 h-2 bg-gray-200 rounded-full"><div className={`h-2 rounded-full ${color}`} style={{ width: `${pct}%` }} /></div>
          </div>
        )
      }
    },
    { key: 'condition', title: 'Holat', render: (t: any) => <Badge variant={conditionColors[t.condition] as any}>{conditionLabels[t.condition] || t.condition}</Badge> },
    {
      key: 'status', title: 'Status', render: (t: any) => {
        const s = t.computedStatus || t.status
        return <Badge variant={statusColors[s] as any}>{statusLabels[s] || s}</Badge>
      }
    },
    {
      key: 'purchaseDate', title: 'Sotib olingan', render: (t: any) => (
        <div>
          <p className="text-sm">{formatDate(t.purchaseDate)}</p>
          <p className="text-xs text-gray-500">{formatCurrency(Number(t.purchasePrice))}</p>
        </div>
      )
    },
    {
      key: 'actions', title: '', render: (t: any) => (
        <div className="flex gap-1 flex-wrap">
          <button onClick={() => setDetailTire(t)} className="text-xs px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100">Ko'rish</button>
          {hasRole('admin', 'manager', 'branch_manager') && (
            <>
              <button onClick={() => { setUpdateTreadModal(t); tReset({ currentTreadDepth: t.currentTreadDepth, totalMileage: t.totalMileage }) }}
                className="text-xs px-2 py-1 rounded bg-green-50 text-green-600 hover:bg-green-100">Yangilash</button>
              <button onClick={() => setMaintenanceModal(t)}
                className="text-xs px-2 py-1 rounded bg-yellow-50 text-yellow-600 hover:bg-yellow-100">Xizmat</button>
            </>
          )}
          {hasRole('admin', 'manager') && t.status === 'active' && (
            <button onClick={() => setRetireModal(t)} className="text-xs px-2 py-1 rounded bg-red-50 text-red-600 hover:bg-red-100">Chiqarish</button>
          )}
        </div>
      )
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Avtoshinalar</h1>
          <p className="text-gray-500 text-sm">Shina inventori va lifecycle nazorati</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/tires" label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setAddModal(true) }}>Shina qo'shish</Button>
          )}
        </div>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
            <p className="text-sm text-blue-600 dark:text-blue-400">Jami</p>
            <p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{stats.total}</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
            <p className="text-sm text-green-600 dark:text-green-400">Faol</p>
            <p className="text-2xl font-bold text-green-900 dark:text-green-100">{stats.active}</p>
          </div>
          <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4">
            <p className="text-sm text-yellow-600 dark:text-yellow-400">Almashtirish kerak</p>
            <p className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{stats.needsReplacement}</p>
          </div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4">
            <p className="text-sm text-red-600 dark:text-red-400">Kritik</p>
            <p className="text-2xl font-bold text-red-900 dark:text-red-100">{stats.critical}</p>
          </div>
        </div>
      )}

      {/* Urgent replacements alert */}
      {stats?.urgentTires?.length > 0 && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-red-800">Zudlik bilan almashtirish talab etiladi</p>
              <div className="flex flex-wrap gap-2 mt-2">
                {stats.urgentTires.map((t: any) => (
                  <span key={t.id} className="text-xs bg-red-100 text-red-700 px-2 py-1 rounded-full">
                    {t.vehicle?.registrationNumber || '—'} / {t.position || t.uniqueId} — {Number(t.currentTreadDepth).toFixed(1)} mm
                  </span>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Brand, model, o'lcham, seriya bo'yicha..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
          <div className="relative">
            <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
              className="appearance-none pl-3 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">Barcha statuslar</option>
              <option value="active">Faol</option>
              <option value="replaced">Almashtirilgan</option>
              <option value="retired">Chiqarilgan</option>
              <option value="damaged">Shikastlangan</option>
            </select>
            <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          </div>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={20} onPageChange={setPage} />
      </div>

      {/* Add Tire Modal */}
      <Modal open={addModal} onClose={() => setAddModal(false)} title="Yangi avtoshina qo'shish" size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setAddModal(false)}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input label="Brand *" placeholder="Michelin" error={errors.brand?.message} {...reg('brand', { required: 'Talab qilinadi' })} />
          <Input label="Model *" placeholder="Pilot Sport" error={errors.model?.message} {...reg('model', { required: 'Talab qilinadi' })} />
          <Input label="O'lcham *" placeholder="205/55R16" error={errors.size?.message} {...reg('size', { required: 'Talab qilinadi' })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tur *</label>
            <select {...reg('type', { required: true })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              {TIRE_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
          </div>
          <Input label="Seriya raqami" placeholder="ABC123XYZ" {...reg('serialNumber')} />
          <Input label="DOT kod" placeholder="2524" {...reg('dotCode')} hint="Hafta va yil (masalan: 2524 = 2024 yil 25-hafta)" />
          <Input label="Sotib olingan sana *" type="date" error={errors.purchaseDate?.message} {...reg('purchaseDate', { required: 'Talab qilinadi' })} />
          <Input label="Narxi *" type="number" placeholder="850000" error={errors.purchasePrice?.message} {...reg('purchasePrice', { required: 'Talab qilinadi' })} />
          <SearchableSelect
            label="Yetkazuvchi"
            options={[{ value: '', label: '— Tanlang —' }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]}
            value={watchT('supplierId') || ''}
            onChange={v => setValT('supplierId', v)}
            placeholder="Yetkazuvchi qidiring..."
          />
          <SearchableSelect
            label="Avtomobil"
            options={[{ value: '', label: "— O'rnatilmagan —" }, ...(vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} — ${v.brand} ${v.model}` }))]}
            value={watchT('vehicleId') || ''}
            onChange={v => setValT('vehicleId', v)}
            placeholder="Avtomobil qidiring..."
          />
          <Input label="O'rnatish sanasi" type="date" {...reg('installationDate')} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Pozitsiya</label>
            <select {...reg('position')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Tanlang —</option>
              {POSITIONS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <Input label="Boshlang'ich protektor (mm)" type="number" step="0.1" placeholder="8.5" {...reg('initialTreadDepth')} />
          <Input label="Joriy protektor (mm)" type="number" step="0.1" placeholder="8.5" {...reg('currentTreadDepth')} />
          <Input label="Kafolat muddati" type="date" {...reg('warrantyEndDate')} hint="Kafolat tugash sanasi" />
          <div className="sm:col-span-2">
            <Input label="Izoh" placeholder="Qo'shimcha ma'lumot..." {...reg('notes')} />
          </div>
        </div>
      </Modal>

      {/* Tire Detail Modal */}
      <Modal open={!!detailTire} onClose={() => setDetailTire(null)} title={`${detailTire?.brand || ''} ${detailTire?.model || ''} tafsilotlari`} size="lg">
        {detailTire && (
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
              {[
                ['ID', detailTire.uniqueId],
                ['Seriya', detailTire.serialNumber || '—'],
                ["O'lcham", detailTire.size],
                ['Tur', detailTire.type],
                ['DOT', detailTire.dotCode || '—'],
                ['Pozitsiya', detailTire.position || '—'],
                ['Boshlang\'ich protektor', detailTire.initialTreadDepth ? `${detailTire.initialTreadDepth} mm` : '—'],
                ['Joriy protektor', detailTire.currentTreadDepth ? `${Number(detailTire.currentTreadDepth).toFixed(1)} mm` : '—'],
                ['Jami masofa', `${Number(detailTire.totalMileage).toLocaleString()} km`],
                ['Sotib olingan', formatDate(detailTire.purchaseDate)],
                ['Narxi', formatCurrency(Number(detailTire.purchasePrice))],
                ['Kafolat tugaydi', detailTire.warrantyEndDate ? formatDate(detailTire.warrantyEndDate) : '—'],
              ].map(([label, value]) => (
                <div key={label as string} className="bg-gray-50 dark:bg-gray-700 rounded-lg p-3">
                  <p className="text-xs text-gray-500 dark:text-gray-400">{label}</p>
                  <p className="font-medium text-gray-900 dark:text-white mt-0.5">{value}</p>
                </div>
              ))}
            </div>

            {detailTire.tireMaintenances?.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Texnik xizmat tarixi</h4>
                <div className="space-y-2">
                  {detailTire.tireMaintenances.map((m: any) => (
                    <div key={m.id} className="flex items-center justify-between text-sm bg-gray-50 dark:bg-gray-700 rounded-lg px-3 py-2">
                      <div>
                        <span className="font-medium capitalize">{m.type.replace('_', ' ')}</span>
                        {m.position && <span className="text-gray-500 ml-2">→ {m.position}</span>}
                        {m.notes && <span className="text-gray-400 ml-2 text-xs">{m.notes}</span>}
                      </div>
                      <div className="text-right">
                        <p className="text-gray-500">{formatDate(m.date)}</p>
                        {Number(m.cost) > 0 && <p className="font-medium">{formatCurrency(Number(m.cost))}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Update Tread Depth Modal */}
      <Modal open={!!updateTreadModal} onClose={() => setUpdateTreadModal(null)} title="Protektor va masofa yangilash" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setUpdateTreadModal(null)}>Bekor qilish</Button>
            <Button loading={updateTreadMutation.isPending} onClick={tSubmit(d => updateTreadMutation.mutate({ id: updateTreadModal?.id, data: d }))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Joriy protektor (mm)" type="number" step="0.1" placeholder="7.2" {...tReg('currentTreadDepth')} hint="Minimal ruxsat: 1.6 mm" />
          <Input label="Jami masofa (km)" type="number" placeholder="15000" {...tReg('totalMileage')} />
          <Input label="Izoh" placeholder="..." {...tReg('notes')} />
        </div>
      </Modal>

      {/* Add Maintenance Modal */}
      <Modal open={!!maintenanceModal} onClose={() => setMaintenanceModal(null)} title={`Texnik xizmat — ${maintenanceModal?.brand || ''}`} size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setMaintenanceModal(null)}>Bekor qilish</Button>
            <Button loading={maintenanceMutation.isPending}
              onClick={mSubmit(d => maintenanceMutation.mutate({ tireId: maintenanceModal?.id, data: d }))}>
              Saqlash
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tur *</label>
            <select {...mReg('type', { required: true })} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="rotation">Rotation (almashtirish)</option>
              <option value="repair">Repair (ta'mirlash)</option>
              <option value="inspection">Inspection (tekshirish)</option>
              <option value="pressure_check">Pressure check (bosim)</option>
            </select>
          </div>
          <Input label="Sana *" type="date" {...mReg('date', { required: true })} />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Yangi pozitsiya</label>
            <select {...mReg('position')} className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Tanlang —</option>
              {POSITIONS.map(p => <option key={p}>{p}</option>)}
            </select>
          </div>
          <Input label="Xarajat (so'm)" type="number" placeholder="50000" {...mReg('cost')} />
          <Input label="Izoh" placeholder="..." {...mReg('notes')} />
        </div>
      </Modal>

      {/* Retire Tire Modal */}
      <Modal open={!!retireModal} onClose={() => setRetireModal(null)} title="Avtoshinani xizmatdan chiqarish" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setRetireModal(null)}>Bekor qilish</Button>
            <Button variant="danger" loading={retireMutation.isPending}
              onClick={() => retireMutation.mutate({ id: retireModal?.id, data: { disposalMethod: 'retired', notes: 'Xizmat muddati tugadi' } })}>
              Tasdiqlash
            </Button>
          </>
        }
      >
        <div className="text-center py-4 space-y-3">
          <XCircle className="w-12 h-12 text-red-500 mx-auto" />
          <p className="font-medium text-gray-900 dark:text-white">{retireModal?.brand} {retireModal?.model} ({retireModal?.size})</p>
          <p className="text-sm text-gray-500">Bu avtoshina xizmatdan chiqariladi va inventordan o'chiriladi</p>
        </div>
      </Modal>
    </div>
  )
}
