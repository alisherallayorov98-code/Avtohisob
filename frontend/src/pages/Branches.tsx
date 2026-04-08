import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Building2 } from 'lucide-react'
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
import { useAuthStore } from '../stores/authStore'

interface Branch {
  id: string
  name: string
  location: string
  contactPhone: string
  warehouseCapacity: number
  isActive: boolean
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
}

export default function Branches() {
  const qc = useQueryClient()
  const { isAdmin } = useAuthStore()
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<Branch | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['branches'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: managersData } = useQuery({
    queryKey: ['managers'],
    queryFn: () => api.get('/expenses/users', { params: { limit: 100 } }).then(r => r.data.data),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<BranchForm>()

  const saveMutation = useMutation({
    mutationFn: (body: BranchForm) => selected
      ? api.put(`/branches/${selected.id}`, body)
      : api.post('/branches', body),
    onSuccess: () => {
      toast.success(selected ? 'Filial yangilandi' : "Filial qo'shildi")
      qc.invalidateQueries({ queryKey: ['branches'] })
      setModalOpen(false); reset(); setSelected(null)
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
    setModalOpen(true)
  }

  const columns = [
    { key: 'name', title: 'Nomi', render: (b: Branch) => (
      <div className="flex items-center gap-2">
        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
          <Building2 className="w-4 h-4 text-blue-600" />
        </div>
        <span className="font-medium">{b.name}</span>
      </div>
    )},
    { key: 'location', title: 'Joylashuvi' },
    { key: 'manager', title: 'Menejer', render: (b: Branch) => b.manager?.fullName || <span className="text-gray-400 text-sm">Belgilanmagan</span> },
    { key: 'vehicles', title: 'Avtomashinalari', render: (b: Branch) => `${b._count?.vehicles || 0} ta` },
    { key: 'users', title: 'Xodimlar', render: (b: Branch) => `${b._count?.users || 0} ta` },
    { key: 'contactPhone', title: 'Telefon' },
    { key: 'isActive', title: 'Holat', render: (b: Branch) => <Badge variant={b.isActive ? 'success' : 'danger'}>{b.isActive ? 'Faol' : 'Nofaol'}</Badge> },
    {
      key: 'actions', title: '', render: (b: Branch) => (
        <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(b)} />
      )
    },
  ]

  const managers = [
    { value: '', label: 'Menejer belgilash...' },
    ...(managersData || []).map((u: any) => ({ value: u.id, label: u.fullName })),
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Filiallar</h1>
          <p className="text-gray-500 text-sm">Jami: {(data || []).length} ta filial</p>
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

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <Table columns={columns} data={data || []} loading={isLoading} />
      </div>

      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); setSelected(null); reset() }}
        title={selected ? 'Filial tahrirlash' : "Filial qo'shish"}
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
          <Select label="Menejer" options={managers} {...register('managerId')} />
          {selected && (
            <Select label="Holat" options={[{ value: 'true', label: 'Faol' }, { value: 'false', label: 'Nofaol' }]} {...register('isActive')} />
          )}
        </div>
      </Modal>
    </div>
  )
}
