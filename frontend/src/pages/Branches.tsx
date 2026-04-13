import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, Building2, Search, UserPlus, Database } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Select from '../components/ui/Select'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'

interface Branch {
  id: string
  name: string
  location: string
  contactPhone: string
  warehouseCapacity: number
  isActive: boolean
  warehouseId?: string | null
  warehouse?: { id: string; name: string } | null
  manager?: { id: string; fullName: string }
  _count?: { vehicles: number; users: number }
}

interface BranchForm {
  name: string
  location: string
  contactPhone: string
  warehouseCapacity: string
  managerId: string
  isActive: string
  warehouseId: string
}

export default function Branches() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { isAdmin } = useAuthStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<Branch | null>(null)
  const [search, setSearch] = useState('')
  const [newManagerMode, setNewManagerMode] = useState(false)
  const [newManager, setNewManager] = useState({ fullName: '', login: '', password: '' })
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: managersData } = useQuery({
    queryKey: ['managers'],
    queryFn: () => api.get('/expenses/users', { params: { limit: 100 } }).then(r => r.data.data),
  })

  const { data: warehousesData } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<BranchForm>()

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/branches/${id}`),
    onSuccess: () => { toast.success("Guruh o'chirildi"); qc.invalidateQueries({ queryKey: ['branches'] }); setDeleteConfirmId(null) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const saveMutation = useMutation({
    mutationFn: (body: BranchForm) => {
      if (selected) return api.put(`/branches/${selected.id}`, body)
      const payload: any = { ...body }
      if (newManagerMode && newManager.login && newManager.password && newManager.fullName) {
        payload.newManager = newManager
      }
      return api.post('/branches', payload)
    },
    onSuccess: () => {
      toast.success(selected ? 'Guruh yangilandi' : "Guruh qo'shildi")
      qc.invalidateQueries({ queryKey: ['branches'] })
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      setModalOpen(false); reset(); setSelected(null)
      setNewManagerMode(false); setNewManager({ fullName: '', login: '', password: '' })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openEdit = (b: Branch) => {
    setSelected(b)
    setValue('name', b.name)
    setValue('location', b.location)
    setValue('contactPhone', b.contactPhone)
    setValue('warehouseCapacity', String(b.warehouseCapacity))
    setValue('managerId', b.manager?.id || '')
    setValue('isActive', b.isActive ? 'true' : 'false')
    setValue('warehouseId', b.warehouseId || '')
    setModalOpen(true)
  }

  const branches: Branch[] = data || []
  const warehouses = [
    { value: '', label: '— Sklad tanlanmagan —' },
    ...(warehousesData || []).filter((w: any) => w.isActive).map((w: any) => ({ value: w.id, label: w.name })),
  ]
  const managers = [
    { value: '', label: '— Menejer tanlang (ixtiyoriy) —' },
    ...(managersData || []).map((u: any) => ({ value: u.id, label: u.fullName })),
  ]

  const q = search.trim().toLowerCase()
  const filtered = q
    ? branches.filter(b => b.name.toLowerCase().includes(q) || b.location.toLowerCase().includes(q))
    : branches

  const columns = [
    { key: 'name', title: 'Nomi', render: (b: Branch) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <Building2 className="w-4 h-4 text-blue-600" />
        </div>
        <span className="font-medium text-gray-900 dark:text-white">{b.name}</span>
      </div>
    )},
    { key: 'location', title: 'Joylashuvi' },
    { key: 'warehouse', title: 'Sklad', render: (b: Branch) =>
      b.warehouse ? (
        <button
          onClick={() => navigate('/warehouses')}
          className="flex items-center gap-1 text-xs text-green-600 dark:text-green-400 font-medium hover:underline"
        >
          <Database className="w-3 h-3" />{b.warehouse.name}
        </button>
      ) : <span className="text-xs text-gray-400">Belgilanmagan</span>
    },
    { key: 'manager', title: 'Menejer', render: (b: Branch) => b.manager?.fullName || <span className="text-gray-400 text-sm">Belgilanmagan</span> },
    { key: 'vehicles', title: 'Avtomashinalari', render: (b: Branch) => `${b._count?.vehicles || 0} ta` },
    { key: 'users', title: 'Xodimlar', render: (b: Branch) => `${b._count?.users || 0} ta` },
    { key: 'contactPhone', title: 'Telefon' },
    { key: 'isActive', title: 'Holat', render: (b: Branch) => <Badge variant={b.isActive ? 'success' : 'danger'}>{b.isActive ? 'Faol' : 'Nofaol'}</Badge> },
    {
      key: 'actions', title: '', render: (b: Branch) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(b)} />
          {isAdmin() && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />} onClick={() => setDeleteConfirmId(b.id)} />
          )}
        </div>
      )
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Guruhlar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {branches.length} ta guruh</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/branches" label="Excel" />
          {isAdmin() && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setSelected(null); setModalOpen(true) }}>
              Qo'shish
            </Button>
          )}
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Guruh nomi yoki joylashuv..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <Table columns={columns} data={filtered} loading={isLoading} />
      </div>

      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Guruhni o'chirish"
        message="Bu guruhni o'chirishni tasdiqlaysizmi? Guruh bilan bog'liq foydalanuvchilar ham ulanmay qoladi."
        confirmLabel="Ha, o'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteConfirmId!)}
        onCancel={() => setDeleteConfirmId(null)}
      />

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSelected(null); reset() }}
        title={selected ? 'Guruh tahrirlash' : "Guruh qo'shish"}
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Nomi *" error={errors.name?.message} {...register('name', { required: 'Talab qilinadi' })} />
          <Input label="Joylashuvi *" error={errors.location?.message} {...register('location', { required: 'Talab qilinadi' })} />
          <Input label="Telefon *" placeholder="+998901234567" error={errors.contactPhone?.message} {...register('contactPhone', { required: 'Talab qilinadi' })} />
          <Input label="Ombor sig'imi (m²)" type="number" {...register('warehouseCapacity')} />

          {/* Warehouse selector */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Sklad</label>
            <select {...register('warehouseId')}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              {warehouses.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
            </select>
            <p className="text-xs text-gray-400 mt-1">Bu guruh qaysi skladdan foydalanishini tanlang</p>
          </div>

          {!selected && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Menejer</label>
                <button
                  type="button"
                  onClick={() => setNewManagerMode(m => !m)}
                  className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  {newManagerMode ? 'Mavjuddan tanlash' : 'Yangi menejer yaratish'}
                </button>
              </div>
              {newManagerMode ? (
                <div className="space-y-2 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                  <input value={newManager.fullName} onChange={e => setNewManager(m => ({ ...m, fullName: e.target.value }))}
                    placeholder="Ism familiya *"
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input value={newManager.login} onChange={e => setNewManager(m => ({ ...m, login: e.target.value }))}
                    placeholder="Telefon yoki email *"
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <input type="password" value={newManager.password} onChange={e => setNewManager(m => ({ ...m, password: e.target.value }))}
                    placeholder="Parol *"
                    className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
              ) : (
                <Select label="" options={managers} {...register('managerId')} />
              )}
            </div>
          )}
          {selected && (
            <Select label="Menejer (ixtiyoriy)" options={managers} {...register('managerId')} />
          )}
          {selected && (
            <Select label="Holat" options={[{ value: 'true', label: 'Faol' }, { value: 'false', label: 'Nofaol' }]} {...register('isActive')} />
          )}
        </div>
      </Modal>
    </div>
  )
}
