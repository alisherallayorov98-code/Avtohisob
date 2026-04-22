import { useState } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { ClipboardCheck, Plus, Edit2, Trash2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { Link } from 'react-router-dom'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import Modal from '../components/ui/Modal'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'
import { Card } from '../components/ui/Card'
import SearchableSelect from '../components/ui/SearchableSelect'

type StatusVal = 'ok' | 'warning' | 'critical'

interface TechInspection {
  id: string
  vehicleId: string
  branchId: string
  inspectionDate: string
  engineOil: StatusVal
  coolant: StatusVal
  brakes: StatusVal
  transmission: StatusVal
  tires: StatusVal
  lights: StatusVal
  exhaust: StatusVal
  bodyCondition: StatusVal
  overallStatus: StatusVal
  notes?: string
  vehicle: { registrationNumber: string; brand: string; model: string }
  branch: { name: string }
  inspectedBy: { fullName: string }
}

const STATUS_CONFIG: Record<StatusVal, { label: string; variant: any }> = {
  ok:       { label: 'Yaxshi',  variant: 'success' },
  warning:  { label: 'Ehtiyot', variant: 'warning' },
  critical: { label: 'Kritik',  variant: 'danger'  },
}

const FIELD_LABELS: Record<string, string> = {
  engineOil:     'Motor yog\'i',
  coolant:       'Sovutuvchi',
  brakes:        'Tormoz',
  transmission:  'Uzatma qutisi',
  tires:         'Shinalar',
  lights:        'Chiroqlar',
  exhaust:       'Chiqindi',
  bodyCondition: 'Kuzov holati',
}

const STATUS_OPTIONS = [
  { value: 'ok',       label: 'Yaxshi' },
  { value: 'warning',  label: 'Ehtiyot' },
  { value: 'critical', label: 'Kritik' },
]

interface FormState {
  vehicleId: string
  inspectionDate: string
  engineOil: string
  coolant: string
  brakes: string
  transmission: string
  tires: string
  lights: string
  exhaust: string
  bodyCondition: string
  notes: string
}

const DEFAULT_FORM: FormState = {
  vehicleId: '',
  inspectionDate: new Date().toISOString().split('T')[0],
  engineOil: 'ok',
  coolant: 'ok',
  brakes: 'ok',
  transmission: 'ok',
  tires: 'ok',
  lights: 'ok',
  exhaust: 'ok',
  bodyCondition: 'ok',
  notes: '',
}

const PAGE_LIMIT = 15

function SimpleStatCard({ label, value, valueClass }: { label: string; value: number | string; valueClass?: string }) {
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
      <div className="text-sm text-gray-500 dark:text-gray-400">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${valueClass || 'text-gray-900 dark:text-white'}`}>{value}</div>
    </div>
  )
}

export default function TechInspections() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const canEdit = hasRole('super_admin', 'admin', 'manager', 'branch_manager')

  const [page, setPage] = useState(1)
  const [statusFilter, setStatusFilter] = useState('')
  const [search, setSearch] = useState('')

  const [modalOpen, setModalOpen] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [form, setForm] = useState<FormState>(DEFAULT_FORM)
  const [deleteId, setDeleteId] = useState<string | null>(null)

  // Vehicles for select
  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-select'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true', status: 'active' } }).then(r => r.data),
  })
  const vehicles: any[] = vehiclesData?.data || []

  // Inspections list
  const { data, isLoading } = useQuery({
    queryKey: ['tech-inspections', page, statusFilter, search],
    queryFn: () => api.get('/inspections', {
      params: {
        page,
        limit: PAGE_LIMIT,
        overallStatus: statusFilter || undefined,
        search: search || undefined,
      },
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  const inspections: TechInspection[] = data?.data || []
  const total: number = data?.total || 0
  const stats = data?.stats || { total: 0, ok: 0, warning: 0, critical: 0 }

  const saveMutation = useMutation({
    mutationFn: (payload: any) =>
      editId
        ? api.put(`/inspections/${editId}`, payload)
        : api.post('/inspections', payload),
    onSuccess: () => {
      toast.success(editId ? 'Tekshiruv yangilandi' : 'Tekshiruv qo\'shildi')
      qc.invalidateQueries({ queryKey: ['tech-inspections'] })
      setModalOpen(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/inspections/${id}`),
    onSuccess: () => {
      toast.success('O\'chirildi')
      qc.invalidateQueries({ queryKey: ['tech-inspections'] })
      setDeleteId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  function openAdd() {
    setEditId(null)
    setForm(DEFAULT_FORM)
    setModalOpen(true)
  }

  function openEdit(ins: TechInspection) {
    setEditId(ins.id)
    setForm({
      vehicleId: ins.vehicleId,
      inspectionDate: ins.inspectionDate.split('T')[0],
      engineOil: ins.engineOil,
      coolant: ins.coolant,
      brakes: ins.brakes,
      transmission: ins.transmission,
      tires: ins.tires,
      lights: ins.lights,
      exhaust: ins.exhaust,
      bodyCondition: ins.bodyCondition,
      notes: ins.notes || '',
    })
    setModalOpen(true)
  }

  function handleSave() {
    if (!form.vehicleId) return toast.error('Mashina tanlang')
    saveMutation.mutate(form)
  }

  const setField = (key: keyof FormState, val: string) =>
    setForm(f => ({ ...f, [key]: val }))

  const statusFields: (keyof FormState)[] = [
    'engineOil', 'coolant', 'brakes', 'transmission',
    'tires', 'lights', 'exhaust', 'bodyCondition',
  ]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <ClipboardCheck className="w-7 h-7 text-blue-600" />
            Oylik texnik tekshiruv
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">Har oy injener to'ldirishi shart</p>
        </div>
        {canEdit && (
          <Button onClick={openAdd} icon={<Plus className="w-4 h-4" />}>
            Yangi tekshiruv
          </Button>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <SimpleStatCard label="Jami" value={stats.total} />
        <SimpleStatCard label="Yaxshi" value={stats.ok} valueClass="text-green-600" />
        <SimpleStatCard label="Ehtiyot" value={stats.warning} valueClass="text-yellow-600" />
        <SimpleStatCard label="Kritik" value={stats.critical} valueClass="text-red-600" />
      </div>

      {/* Filters */}
      <Card>
        <div className="flex flex-wrap gap-3 p-4">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              type="text"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
              placeholder="Mashina raqami yoki brand..."
              className="w-full pl-9 pr-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
          >
            <option value="">Barcha holat</option>
            <option value="ok">Yaxshi</option>
            <option value="warning">Ehtiyot</option>
            <option value="critical">Kritik</option>
          </select>
        </div>

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
              <tr>
                {['Mashina', 'Filial', 'Sana', 'Injener', 'Motor yog\'i', 'Tormoz', 'Shinalar', 'Umumiy holat', ''].map(h => (
                  <th key={h} className="px-4 py-3 text-left font-medium text-gray-500 dark:text-gray-400 text-xs uppercase tracking-wider whitespace-nowrap">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
              {isLoading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Yuklanmoqda...</td></tr>
              ) : inspections.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400">Tekshiruvlar topilmadi</td></tr>
              ) : inspections.map(ins => (
                <tr key={ins.id} className="hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors">
                  <td className="px-4 py-3">
                    <Link to={`/vehicles/${ins.vehicleId}`} className="font-medium text-blue-600 hover:underline">
                      {ins.vehicle.registrationNumber}
                    </Link>
                    <div className="text-xs text-gray-400">{ins.vehicle.brand} {ins.vehicle.model}</div>
                  </td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{ins.branch?.name || '—'}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300 whitespace-nowrap">{formatDate(ins.inspectionDate)}</td>
                  <td className="px-4 py-3 text-gray-600 dark:text-gray-300">{ins.inspectedBy?.fullName || '—'}</td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_CONFIG[ins.engineOil]?.variant || 'info'}>
                      {STATUS_CONFIG[ins.engineOil]?.label || ins.engineOil}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_CONFIG[ins.brakes]?.variant || 'info'}>
                      {STATUS_CONFIG[ins.brakes]?.label || ins.brakes}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_CONFIG[ins.tires]?.variant || 'info'}>
                      {STATUS_CONFIG[ins.tires]?.label || ins.tires}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    <Badge variant={STATUS_CONFIG[ins.overallStatus]?.variant || 'info'}>
                      {STATUS_CONFIG[ins.overallStatus]?.label || ins.overallStatus}
                    </Badge>
                  </td>
                  <td className="px-4 py-3">
                    {canEdit && (
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(ins)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-blue-600 transition-colors">
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button onClick={() => setDeleteId(ins.id)} className="p-1.5 rounded hover:bg-gray-100 dark:hover:bg-gray-700 text-gray-500 hover:text-red-600 transition-colors">
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {total > PAGE_LIMIT && (
          <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-800">
            <Pagination
              page={page}
              totalPages={Math.ceil(total / PAGE_LIMIT)}
              onPageChange={setPage}
              total={total}
              limit={PAGE_LIMIT}
            />
          </div>
        )}
      </Card>

      {/* Create/Edit Modal */}
      <Modal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={editId ? 'Tekshiruvni tahrirlash' : 'Yangi oylik tekshiruv'}
        size="lg"
      >
        <div className="space-y-4">
          {/* Vehicle */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Mashina *</label>
            <SearchableSelect
              value={form.vehicleId}
              onChange={v => setField('vehicleId', v)}
              options={vehicles.map((v: any) => ({
                value: v.id,
                label: `${v.registrationNumber} — ${v.brand} ${v.model}`,
              }))}
              placeholder="Mashina tanlang"
            />
          </div>

          {/* Date */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tekshiruv sanasi *</label>
            <input
              type="date"
              value={form.inspectionDate}
              onChange={e => setField('inspectionDate', e.target.value)}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          {/* Status fields grid */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">Tekshiruv natijalari</label>
            <div className="grid grid-cols-2 gap-3">
              {statusFields.map(key => (
                <div key={key}>
                  <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">{FIELD_LABELS[key]}</label>
                  <select
                    value={form[key]}
                    onChange={e => setField(key, e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
                  >
                    {STATUS_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Izoh</label>
            <textarea
              value={form.notes}
              onChange={e => setField('notes', e.target.value)}
              rows={3}
              placeholder="Qo'shimcha izoh..."
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-white dark:bg-gray-800 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button onClick={handleSave} loading={saveMutation.isPending}>Saqlash</Button>
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteId}
        onCancel={() => setDeleteId(null)}
        onConfirm={() => deleteId && deleteMutation.mutate(deleteId)}
        title="Tekshiruvni o'chirish"
        message="Haqiqatan ham o'chirmoqchimisiz?"
        confirmLabel="O'chirish"
        danger
        loading={deleteMutation.isPending}
      />
    </div>
  )
}
