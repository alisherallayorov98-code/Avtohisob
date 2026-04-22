import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Edit2, Search, Truck, Phone, Mail, MapPin, User, CheckCircle, XCircle, Wrench, Package } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'

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
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [isActiveFilter, setIsActiveFilter] = useState('true')
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<Supplier | null>(null)
  const [detailSupplier, setDetailSupplier] = useState<Supplier | null>(null)
  const [detailTab, setDetailTab] = useState<'maintenance' | 'parts'>('maintenance')

  const { data: supplierMaintenance, isLoading: maintLoading } = useQuery({
    queryKey: ['supplier-maintenance', detailSupplier?.id],
    queryFn: () => api.get('/maintenance', { params: { supplierId: detailSupplier!.id, limit: 50 } }).then(r => r.data),
    enabled: !!detailSupplier && detailTab === 'maintenance',
  })

  const { data: supplierParts, isLoading: partsLoading } = useQuery({
    queryKey: ['supplier-parts', detailSupplier?.id],
    queryFn: () => api.get('/spare-parts', { params: { supplierId: detailSupplier!.id, limit: 100 } }).then(r => r.data),
    enabled: !!detailSupplier && detailTab === 'parts',
  })

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', page, limit, debouncedSearch, isActiveFilter],
    queryFn: () => api.get('/suppliers', {
      params: {
        page, limit,
        search: debouncedSearch || undefined,
        isActive: isActiveFilter !== '' ? isActiveFilter : undefined,
        withCount: true,
      }
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


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
      <button
        onClick={() => { setDetailSupplier(s); setDetailTab('parts') }}
        className="text-sm font-medium text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
      >
        <Package className="w-3.5 h-3.5" />{s._count?.spareParts ?? 0} ta
      </button>
    )},
    { key: 'maintenance', title: "Ta'mirlar", render: (s: Supplier) => (
      <button
        onClick={() => { setDetailSupplier(s); setDetailTab('maintenance') }}
        className="text-sm text-purple-600 dark:text-purple-400 hover:underline flex items-center gap-1"
      >
        <Wrench className="w-3.5 h-3.5" />Ko'rish
      </button>
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
              onChange={e => { setSearch(e.target.value) }}
            />
          </div>
          <select value={isActiveFilter} onChange={e => { setIsActiveFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha holatlar</option>
            <option value="true">Faqat faollar</option>
            <option value="false">Faqat nofaollar</option>
          </select>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Supplier detail modal */}
      <Modal
        open={!!detailSupplier}
        onClose={() => setDetailSupplier(null)}
        title={detailSupplier?.name || ''}
        size="lg"
        footer={<Button variant="outline" onClick={() => setDetailSupplier(null)}>Yopish</Button>}
      >
        {/* Tabs */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => setDetailTab('maintenance')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === 'maintenance' ? 'bg-purple-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
          >
            <Wrench className="w-4 h-4" />Ta'mirlar
          </button>
          <button
            onClick={() => setDetailTab('parts')}
            className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${detailTab === 'parts' ? 'bg-blue-600 text-white' : 'bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-200'}`}
          >
            <Package className="w-4 h-4" />Ehtiyot qismlar
          </button>
        </div>

        {detailTab === 'maintenance' && (
          maintLoading ? <div className="py-8 text-center text-gray-500">Yuklanmoqda...</div>
          : !supplierMaintenance?.data?.length ? <div className="py-8 text-center text-gray-400">Bu yetkazuvchidan ta'mir amalga oshirilmagan</div>
          : (
            <div className="overflow-x-auto">
              <p className="text-xs text-gray-500 mb-2">Jami: {supplierMaintenance.meta?.total} ta</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Sana</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Mashina</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Qism</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Narxi</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierMaintenance.data.map((m: any) => (
                    <tr key={m.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{new Date(m.installationDate).toLocaleDateString('uz-UZ')}</td>
                      <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">{m.vehicle?.registrationNumber}</td>
                      <td className="py-2 px-3 text-gray-700 dark:text-gray-300">{m.sparePart?.name || '—'}</td>
                      <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{formatCurrency(Number(m.cost))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}

        {detailTab === 'parts' && (
          partsLoading ? <div className="py-8 text-center text-gray-500">Yuklanmoqda...</div>
          : !supplierParts?.data?.length ? <div className="py-8 text-center text-gray-400">Bu yetkazuvchidan qism kiritilmagan</div>
          : (
            <div className="overflow-x-auto">
              <p className="text-xs text-gray-500 mb-2">Jami: {supplierParts.meta?.total} ta</p>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-gray-200 dark:border-gray-700">
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Nomi</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Kod</th>
                    <th className="text-left py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Kategoriya</th>
                    <th className="text-right py-2 px-3 font-medium text-gray-600 dark:text-gray-400">Narxi</th>
                  </tr>
                </thead>
                <tbody>
                  {supplierParts.data.map((sp: any) => (
                    <tr key={sp.id} className="border-b border-gray-100 dark:border-gray-700/50 hover:bg-gray-50 dark:hover:bg-gray-700/30">
                      <td className="py-2 px-3 font-medium text-gray-900 dark:text-white">{sp.name}</td>
                      <td className="py-2 px-3"><span className="font-mono text-xs bg-gray-100 dark:bg-gray-700 px-1.5 py-0.5 rounded">{sp.partCode}</span></td>
                      <td className="py-2 px-3 text-gray-600 dark:text-gray-300">{sp.category}</td>
                      <td className="py-2 px-3 text-right text-gray-700 dark:text-gray-300">{formatCurrency(Number(sp.unitPrice))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )
        )}
      </Modal>

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
