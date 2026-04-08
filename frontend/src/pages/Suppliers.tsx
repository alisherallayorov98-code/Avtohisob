import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Edit2, Search, Truck, Phone, Mail, MapPin, User, CheckCircle, XCircle } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'

interface Supplier {
  id: string
  name: string
  contactPerson?: string
  phone: string
  email?: string
  address?: string
  paymentTerms?: string
  isActive: boolean
  _count?: { spareParts: number }
}

interface SupplierForm {
  name: string
  contactPerson: string
  phone: string
  email: string
  address: string
  paymentTerms: string
}

export default function Suppliers() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const [isActiveFilter, setIsActiveFilter] = useState('true')
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<Supplier | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, limit, search, isActiveFilter],
    queryFn: () => api.get('/suppliers', {
      params: {
        page, limit,
        search: search || undefined,
        isActive: isActiveFilter !== '' ? isActiveFilter : undefined,
        withCount: true,
      }
    }).then(r => r.data),
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<SupplierForm>()

  const saveMutation = useMutation({
    mutationFn: (body: SupplierForm) => selected
      ? api.put(`/suppliers/${selected.id}`, body)
      : api.post('/suppliers', body),
    onSuccess: () => {
      toast.success(selected ? 'Yetkazuvchi yangilandi' : "Yetkazuvchi qo'shildi")
      qc.invalidateQueries({ queryKey: ['suppliers'] })
      qc.invalidateQueries({ queryKey: ['suppliers-list'] })
      setModalOpen(false); reset(); setSelected(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const toggleActiveMutation = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) =>
      api.put(`/suppliers/${id}`, { isActive }),
    onSuccess: () => {
      toast.success('Holat yangilandi')
      qc.invalidateQueries({ queryKey: ['suppliers'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openEdit = (s: Supplier) => {
    setSelected(s)
    setValue('name', s.name)
    setValue('contactPerson', s.contactPerson || '')
    setValue('phone', s.phone)
    setValue('email', s.email || '')
    setValue('address', s.address || '')
    setValue('paymentTerms', s.paymentTerms || '')
    setModalOpen(true)
  }

  const columns = [
    { key: 'name', title: 'Nomi', render: (s: Supplier) => (
      <div>
        <p className="font-medium text-gray-900 dark:text-white">{s.name}</p>
        {s.contactPerson && (
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
            <User className="w-3 h-3" />{s.contactPerson}
          </p>
        )}
      </div>
    )},
    { key: 'phone', title: 'Telefon', render: (s: Supplier) => (
      <a href={`tel:${s.phone}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1">
        <Phone className="w-3.5 h-3.5" />{s.phone}
      </a>
    )},
    { key: 'email', title: 'Email', render: (s: Supplier) => s.email
      ? <a href={`mailto:${s.email}`} className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{s.email}</a>
      : <span className="text-gray-400 text-sm">—</span>
    },
    { key: 'address', title: 'Manzil', render: (s: Supplier) => s.address
      ? <span className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1"><MapPin className="w-3.5 h-3.5 flex-shrink-0" />{s.address}</span>
      : <span className="text-gray-400 text-sm">—</span>
    },
    { key: 'paymentTerms', title: "To'lov", render: (s: Supplier) => (
      <span className="text-sm text-gray-600 dark:text-gray-300">{s.paymentTerms || '—'}</span>
    )},
    { key: 'parts', title: "Qismlar", render: (s: Supplier) => (
      <span className="text-sm font-medium text-gray-900 dark:text-white">{s._count?.spareParts ?? '—'} ta</span>
    )},
    { key: 'isActive', title: 'Holat', render: (s: Supplier) => (
      <Badge variant={s.isActive ? 'success' : 'danger'}>{s.isActive ? 'Faol' : 'Nofaol'}</Badge>
    )},
    {
      key: 'actions', title: '', render: (s: Supplier) => hasRole('admin', 'manager') ? (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={s.isActive
            ? <XCircle className="w-4 h-4 text-red-500" />
            : <CheckCircle className="w-4 h-4 text-green-500" />}
            title={s.isActive ? 'Nofaol qilish' : 'Faollashtirish'}
            onClick={() => toggleActiveMutation.mutate({ id: s.id, isActive: !s.isActive })} />
          <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(s)} />
        </div>
      ) : null
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Yetkazuvchilar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/suppliers" label="Excel" />
          {hasRole('admin', 'manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setSelected(null); setModalOpen(true) }}>
              Qo'shish
            </Button>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <Truck className="w-8 h-8 text-blue-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Jami</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{data?.meta?.total || 0}</p>
          </div>
        </div>
        <div className="bg-green-50 dark:bg-green-900/20 rounded-xl border border-green-200 dark:border-green-700 p-4 flex items-center gap-3">
          <CheckCircle className="w-8 h-8 text-green-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-green-600 dark:text-green-400">Faol</p>
            <p className="text-2xl font-bold text-green-900 dark:text-green-100">
              {(data?.data || []).filter((s: Supplier) => s.isActive).length}
            </p>
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-700 p-4 flex items-center gap-3">
          <XCircle className="w-8 h-8 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-red-600 dark:text-red-400">Nofaol</p>
            <p className="text-2xl font-bold text-red-900 dark:text-red-100">
              {(data?.data || []).filter((s: Supplier) => !s.isActive).length}
            </p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Nom yoki telefon bo'yicha qidirish..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => { setSearch(e.target.value); setPage(1) }}
            />
          </div>
          <select value={isActiveFilter} onChange={e => { setIsActiveFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha holatlar</option>
            <option value="true">Faqat faollar</option>
            <option value="false">Faqat nofaollar</option>
          </select>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setSelected(null); reset() }}
        title={selected ? 'Yetkazuvchi tahrirlash' : "Yetkazuvchi qo'shish"} size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Nomi *" placeholder="ООО Avtomobil qismlari" error={errors.name?.message}
            {...register('name', { required: 'Talab qilinadi' })} />
          <Input label="Kontakt shaxs" placeholder="Alisher Karimov" {...register('contactPerson')} />
          <Input label="Telefon *" placeholder="+998901234567" error={errors.phone?.message}
            {...register('phone', { required: 'Talab qilinadi' })} />
          <Input label="Email" type="email" placeholder="info@company.uz" {...register('email')} />
          <Input label="Manzil" placeholder="Toshkent, Yunusobod..." {...register('address')} />
          <Input label="To'lov shartlari" placeholder="30 kun kechiktirib, naqd..." {...register('paymentTerms')} />
        </div>
      </Modal>
    </div>
  )
}
