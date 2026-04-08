import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, ArrowRight, CheckCircle, Send, Package } from 'lucide-react'
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

interface Transfer {
  id: string
  quantity: number
  status: string
  transferDate: string
  notes?: string
  fromBranch: { id: string; name: string }
  toBranch: { id: string; name: string }
  sparePart: { id: string; name: string; partCode: string }
  approvedBy?: { fullName: string }
}

interface TransferForm {
  fromBranchId: string
  toBranchId: string
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
  const [modalOpen, setModalOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['transfers', page, limit, statusFilter],
    queryFn: () => api.get('/transfers', { params: { page, limit, status: statusFilter || undefined } }).then(r => r.data),
  })

  const { data: branchesData } = useQuery({
    queryKey: ['branches-list'],
    queryFn: () => api.get('/branches').then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<TransferForm>()

  const createMutation = useMutation({
    mutationFn: (body: TransferForm) => api.post('/transfers', body),
    onSuccess: () => { toast.success('Taqsimot yaratildi'); qc.invalidateQueries({ queryKey: ['transfers'] }); setModalOpen(false); reset() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: string }) => api.put(`/transfers/${id}/${action}`),
    onSuccess: (_, { action }) => {
      const msgs: Record<string, string> = { approve: 'Tasdiqlandi', ship: "Jo'natildi", receive: 'Qabul qilindi' }
      toast.success(msgs[action] || 'Yangilandi')
      qc.invalidateQueries({ queryKey: ['transfers'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    { key: 'route', title: "Yo'nalish", render: (t: Transfer) => (
      <div className="flex items-center gap-2 text-sm">
        <span className="font-medium">{t.fromBranch?.name}</span>
        <ArrowRight className="w-4 h-4 text-gray-400" />
        <span className="font-medium">{t.toBranch?.name}</span>
      </div>
    )},
    { key: 'sparePart', title: 'Ehtiyot qism', render: (t: Transfer) => (
      <div><p className="font-medium">{t.sparePart?.name}</p><p className="text-xs font-mono text-gray-400">{t.sparePart?.partCode}</p></div>
    )},
    { key: 'quantity', title: 'Miqdor', render: (t: Transfer) => `${t.quantity} ta` },
    { key: 'status', title: 'Holat', render: (t: Transfer) => <Badge variant={statusColors[t.status]}>{TRANSFER_STATUS[t.status]}</Badge> },
    { key: 'transferDate', title: 'Sana', render: (t: Transfer) => formatDate(t.transferDate) },
    { key: 'approvedBy', title: 'Tasdiqladi', render: (t: Transfer) => t.approvedBy?.fullName || '-' },
    {
      key: 'actions', title: '', render: (t: Transfer) => (
        <div className="flex items-center gap-1">
          {t.status === 'pending' && hasRole('admin', 'manager') && (
            <Button size="sm" variant="secondary" icon={<CheckCircle className="w-3.5 h-3.5 text-green-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'approve' })}>Tasdiq</Button>
          )}
          {t.status === 'approved' && (hasRole('admin', 'manager') || user?.branchId === t.fromBranch?.id) && (
            <Button size="sm" variant="secondary" icon={<Send className="w-3.5 h-3.5 text-blue-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'ship' })}>Jo'nat</Button>
          )}
          {t.status === 'shipped' && (hasRole('admin', 'manager') || user?.branchId === t.toBranch?.id) && (
            <Button size="sm" variant="secondary" icon={<Package className="w-3.5 h-3.5 text-purple-600" />}
              onClick={() => actionMutation.mutate({ id: t.id, action: 'receive' })}>Qabul</Button>
          )}
        </div>
      )
    },
  ]

  const branches = (branchesData || []).map((b: any) => ({ value: b.id, label: b.name }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Taqsimotlar</h1>
          <p className="text-gray-500 text-sm">Filiallar orasida ehtiyot qismlar ko'chirish</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/transfers" label="Excel" />
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>Yaratish</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3">
          <select value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha holatlar</option>
            {Object.entries(TRANSFER_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Taqsimot yaratish" size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Yaratish</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <SearchableSelect label="Qaysi filialdan *" options={branches} value={watch('fromBranchId') || ''}
              onChange={v => setValue('fromBranchId', v, { shouldValidate: true })}
              placeholder="Filial tanlang..." error={errors.fromBranchId?.message} />
            <input type="hidden" {...register('fromBranchId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label="Qaysi filialga *" options={branches} value={watch('toBranchId') || ''}
              onChange={v => setValue('toBranchId', v, { shouldValidate: true })}
              placeholder="Filial tanlang..." error={errors.toBranchId?.message} />
            <input type="hidden" {...register('toBranchId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label="Ehtiyot qism *" options={spareParts} value={watch('sparePartId') || ''}
              onChange={v => setValue('sparePartId', v, { shouldValidate: true })}
              placeholder="Kod yoki nom bilan qidiring..." error={errors.sparePartId?.message} />
            <input type="hidden" {...register('sparePartId', { required: 'Talab qilinadi' })} />
          </div>
          <Input label="Miqdor *" type="number" error={errors.quantity?.message}
            {...register('quantity', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
          <div>
            <label className="text-sm font-medium text-gray-700">Izohlar</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
