import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Trash2, Warehouse, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'

interface WarehouseItem {
  id: string
  name: string
  location?: string
  isActive: boolean
  branches: { id: string; name: string }[]
  _count?: { inventory: number }
}

interface WarehouseForm {
  name: string
  location: string
  isActive: string
}

export default function Warehouses() {
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<WarehouseItem | null>(null)
  const [search, setSearch] = useState('')
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['warehouses'],
    queryFn: () => api.get('/warehouses').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<WarehouseForm>()

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/warehouses/${id}`),
    onSuccess: () => {
      toast.success("Sklad o'chirildi")
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      setDeleteConfirmId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const saveMutation = useMutation({
    mutationFn: (body: WarehouseForm) =>
      selected ? api.put(`/warehouses/${selected.id}`, body) : api.post('/warehouses', body),
    onSuccess: () => {
      toast.success(selected ? 'Sklad yangilandi' : "Sklad qo'shildi")
      qc.invalidateQueries({ queryKey: ['warehouses'] })
      qc.invalidateQueries({ queryKey: ['branches'] })
      setModalOpen(false); reset(); setSelected(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openEdit = (w: WarehouseItem) => {
    setSelected(w)
    setValue('name', w.name)
    setValue('location', w.location || '')
    setValue('isActive', w.isActive ? 'true' : 'false')
    setModalOpen(true)
  }

  const warehouses: WarehouseItem[] = data || []
  const q = search.trim().toLowerCase()
  const filtered = q
    ? warehouses.filter(w => w.name.toLowerCase().includes(q) || (w.location || '').toLowerCase().includes(q))
    : warehouses

  const columns = [
    { key: 'name', title: 'Nomi', render: (w: WarehouseItem) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
          <Warehouse className="w-4 h-4 text-green-600" />
        </div>
        <span className="font-medium text-gray-900 dark:text-white">{w.name}</span>
      </div>
    )},
    { key: 'location', title: 'Manzil', render: (w: WarehouseItem) =>
      w.location || <span className="text-gray-400 text-sm">—</span>
    },
    { key: 'branches', title: "Guruhlar", render: (w: WarehouseItem) => (
      <div className="flex flex-wrap gap-1">
        {w.branches.length === 0
          ? <span className="text-gray-400 text-sm">Biriktirilmagan</span>
          : w.branches.map(b => (
            <span key={b.id} className="text-xs bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">{b.name}</span>
          ))
        }
      </div>
    )},
    { key: 'inventory', title: "Pozitsiyalar", render: (w: WarehouseItem) =>
      `${w._count?.inventory || 0} ta`
    },
    { key: 'isActive', title: 'Holat', render: (w: WarehouseItem) =>
      <Badge variant={w.isActive ? 'success' : 'danger'}>{w.isActive ? 'Faol' : 'Nofaol'}</Badge>
    },
    { key: 'actions', title: '', render: (w: WarehouseItem) => (
      <div className="flex items-center gap-1">
        {isAdmin() && <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(w)} />}
        {isAdmin() && <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />} onClick={() => setDeleteConfirmId(w.id)} />}
      </div>
    )},
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Skladlar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {warehouses.length} ta sklad</p>
        </div>
        {isAdmin() && (
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setSelected(null); setModalOpen(true) }}>
            Qo'shish
          </Button>
        )}
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Sklad nomi yoki manzil..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        </div>
        <Table columns={columns} data={filtered} loading={isLoading} />
      </div>

      <ConfirmDialog
        open={!!deleteConfirmId}
        title="Skladni o'chirish"
        message="Bu skladni o'chirishni tasdiqlaysizmi? Sklad bo'sh bo'lishi shart."
        confirmLabel="Ha, o'chirish"
        danger
        loading={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate(deleteConfirmId!)}
        onCancel={() => setDeleteConfirmId(null)}
      />

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSelected(null); reset() }}
        title={selected ? 'Sklad tahrirlash' : "Sklad qo'shish"}
        size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Nomi *" error={errors.name?.message} {...register('name', { required: 'Talab qilinadi' })} />
          <Input label="Manzil" {...register('location')} />
          {selected && (
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Holat</label>
              <select {...register('isActive')}
                className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="true">Faol</option>
                <option value="false">Nofaol</option>
              </select>
            </div>
          )}
        </div>
      </Modal>
    </div>
  )
}
