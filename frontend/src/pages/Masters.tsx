import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Edit2, Search, Trash2, Phone, Wrench, Wallet, HardHat, DownloadCloud, Calendar, X } from 'lucide-react'
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

interface Master {
  id: string
  name: string
  phone?: string
  isActive: boolean
  totalWork: number
  workCount: number
  totalPaid: number
  balance: number
}

interface MasterForm { name: string; phone: string; notes: string }
interface PaymentForm { amount: string; paymentDate: string; method: string; note: string }

const today = () => new Date().toISOString().slice(0, 10)

export default function Masters() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [modalOpen, setModalOpen] = useState(false)
  const [selected, setSelected] = useState<Master | null>(null)
  const [detailId, setDetailId] = useState<string | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['masters', page, limit, debouncedSearch],
    queryFn: () => api.get('/masters', {
      params: { page, limit, search: debouncedSearch || undefined },
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])

  // ── Detail ──
  const { data: detail, isLoading: detailLoading } = useQuery({
    queryKey: ['master-detail', detailId],
    queryFn: () => api.get(`/masters/${detailId}/detail`).then(r => r.data.data),
    enabled: !!detailId,
  })

  const { register, handleSubmit, reset, setValue, formState: { errors } } = useForm<MasterForm>()

  const saveMutation = useMutation({
    mutationFn: (body: MasterForm) => selected
      ? api.put(`/masters/${selected.id}`, body)
      : api.post('/masters', body),
    onSuccess: () => {
      toast.success(selected ? 'Usta yangilandi' : "Usta qo'shildi")
      qc.invalidateQueries({ queryKey: ['masters'] })
      qc.invalidateQueries({ queryKey: ['maintenance-workers'] })
      setModalOpen(false); reset(); setSelected(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/masters/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['masters'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const syncMutation = useMutation({
    mutationFn: () => api.post('/masters/sync', {}),
    onSuccess: (r) => {
      toast.success(r.data?.message || 'Import qilindi')
      qc.invalidateQueries({ queryKey: ['masters'] })
      qc.invalidateQueries({ queryKey: ['maintenance-workers'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const openEdit = (m: Master) => {
    setSelected(m)
    setValue('name', m.name)
    setValue('phone', m.phone || '')
    setValue('notes', '')
    setModalOpen(true)
  }

  // ── Payment form (detail modal) ──
  const payForm = useForm<PaymentForm>({ defaultValues: { amount: '', paymentDate: today(), method: 'cash', note: '' } })
  const addPayMutation = useMutation({
    mutationFn: (body: PaymentForm) => api.post(`/masters/${detailId}/payments`, body),
    onSuccess: () => {
      toast.success("To'lov qo'shildi")
      qc.invalidateQueries({ queryKey: ['master-detail', detailId] })
      qc.invalidateQueries({ queryKey: ['masters'] })
      payForm.reset({ amount: '', paymentDate: today(), method: 'cash', note: '' })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })
  const delPayMutation = useMutation({
    mutationFn: (paymentId: string) => api.delete(`/masters/${detailId}/payments/${paymentId}`),
    onSuccess: () => {
      toast.success("To'lov o'chirildi")
      qc.invalidateQueries({ queryKey: ['master-detail', detailId] })
      qc.invalidateQueries({ queryKey: ['masters'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const masters: Master[] = data?.data || []
  const totalDebt = masters.reduce((s, m) => s + Math.max(0, m.balance), 0)
  const totalWorkSum = masters.reduce((s, m) => s + m.totalWork, 0)

  const balanceCell = (b: number) => {
    if (b > 0) return <span className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(b)}</span>
    if (b < 0) return <span className="font-semibold text-green-600 dark:text-green-400">+{formatCurrency(-b)}</span>
    return <span className="text-gray-400">0</span>
  }

  const columns = [
    { key: 'name', title: 'Usta', render: (m: Master) => (
      <button onClick={() => setDetailId(m.id)} className="text-left">
        <p className="font-medium text-gray-900 dark:text-white hover:text-blue-600 dark:hover:text-blue-400">{m.name}</p>
        {m.phone && (
          <p className="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1 mt-0.5">
            <Phone className="w-3 h-3" />{m.phone}
          </p>
        )}
      </button>
    )},
    { key: 'workCount', title: 'Ishlar', render: (m: Master) => (
      <span className="text-sm text-gray-600 dark:text-gray-300 flex items-center gap-1">
        <Wrench className="w-3.5 h-3.5 text-purple-500" />{m.workCount} ta
      </span>
    )},
    { key: 'totalWork', title: 'Bajargan ish', render: (m: Master) => (
      <span className="text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(m.totalWork)}</span>
    )},
    { key: 'totalPaid', title: "To'langan", render: (m: Master) => (
      <span className="text-sm text-gray-600 dark:text-gray-300">{formatCurrency(m.totalPaid)}</span>
    )},
    { key: 'balance', title: 'Qarz', render: (m: Master) => balanceCell(m.balance) },
    { key: 'isActive', title: 'Holat', render: (m: Master) => (
      <Badge variant={m.isActive ? 'success' : 'danger'}>{m.isActive ? 'Faol' : 'Nofaol'}</Badge>
    )},
    {
      key: 'actions', title: '', render: (m: Master) => (
        <div className="flex items-center gap-1">
          <Button size="sm" variant="ghost" icon={<Wallet className="w-4 h-4 text-green-600" />} title="Hisob / to'lov" onClick={() => setDetailId(m.id)} />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button size="sm" variant="ghost" icon={<Edit2 className="w-4 h-4" />} onClick={() => openEdit(m)} />
          )}
          {hasRole('admin', 'manager') && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />}
              onClick={() => { if (window.confirm(`"${m.name}" ustani o'chirasizmi? To'lovlar ham o'chadi.`)) deleteMutation.mutate(m.id) }} />
          )}
        </div>
      )
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center gap-2">
            <HardHat className="w-6 h-6 text-amber-500" /> Ustalar hisobi
          </h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Qaysi usta qancha ish qildi, qancha to'landi, qancha qarz</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <ExcelExportButton endpoint="/exports/masters" label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button variant="outline" icon={<DownloadCloud className="w-4 h-4" />} loading={syncMutation.isPending}
              onClick={() => syncMutation.mutate()} title="Ta'mirlash yozuvlaridagi usta nomlaridan ro'yxat tuzadi">
              Ta'mirlashdan import
            </Button>
          )}
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset({ name: '', phone: '', notes: '' }); setSelected(null); setModalOpen(true) }}>
              Usta qo'shish
            </Button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <HardHat className="w-8 h-8 text-amber-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Ustalar</p>
            <p className="text-2xl font-bold text-gray-900 dark:text-white">{data?.meta?.total || 0}</p>
          </div>
        </div>
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl border border-blue-200 dark:border-blue-700 p-4 flex items-center gap-3">
          <Wrench className="w-8 h-8 text-blue-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-blue-600 dark:text-blue-400">Bajargan ish (bu sahifa)</p>
            <p className="text-lg font-bold text-blue-900 dark:text-blue-100">{formatCurrency(totalWorkSum)}</p>
          </div>
        </div>
        <div className="bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-200 dark:border-red-700 p-4 flex items-center gap-3">
          <Wallet className="w-8 h-8 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-xs text-red-600 dark:text-red-400">Jami qarz (bu sahifa)</p>
            <p className="text-lg font-bold text-red-900 dark:text-red-100">{formatCurrency(totalDebt)}</p>
          </div>
        </div>
      </div>

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Usta nomi yoki telefon bo'yicha qidirish..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
        </div>
        <Table columns={columns} data={masters} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Detail modal: oylik kesim + ishlar + to'lovlar */}
      <Modal
        open={!!detailId}
        onClose={() => setDetailId(null)}
        title={detail?.name || 'Usta hisobi'}
        size="lg"
        footer={<Button variant="outline" onClick={() => setDetailId(null)}>Yopish</Button>}
      >
        {detailLoading || !detail ? (
          <div className="py-8 text-center text-gray-500">Yuklanmoqda...</div>
        ) : (
          <div className="space-y-5">
            {/* Balans kartalari */}
            <div className="grid grid-cols-3 gap-3">
              <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl px-4 py-3">
                <p className="text-xs text-blue-600 dark:text-blue-400">Bajargan ish</p>
                <p className="text-lg font-bold text-blue-700 dark:text-blue-300">{formatCurrency(detail.totalWork)}</p>
              </div>
              <div className="bg-green-50 dark:bg-green-900/20 rounded-xl px-4 py-3">
                <p className="text-xs text-green-600 dark:text-green-400">To'langan</p>
                <p className="text-lg font-bold text-green-700 dark:text-green-300">{formatCurrency(detail.totalPaid)}</p>
              </div>
              <div className={`rounded-xl px-4 py-3 ${detail.balance > 0 ? 'bg-red-50 dark:bg-red-900/20' : 'bg-gray-50 dark:bg-gray-700/40'}`}>
                <p className={`text-xs ${detail.balance > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500'}`}>Qarz</p>
                <p className={`text-lg font-bold ${detail.balance > 0 ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-200'}`}>{formatCurrency(detail.balance)}</p>
              </div>
            </div>

            {/* Oylik kesim */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-1.5">
                <Calendar className="w-4 h-4 text-gray-400" /> Oylik bajarilgan ish
              </h4>
              {detail.monthly?.length ? (
                <div className="flex flex-wrap gap-2">
                  {detail.monthly.map((m: any) => (
                    <div key={m.month} className="border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-1.5 text-xs">
                      <span className="text-gray-500 dark:text-gray-400">{m.label}</span>
                      <span className="mx-1 text-gray-300">·</span>
                      <span className="font-semibold text-gray-900 dark:text-white">{formatCurrency(m.work)}</span>
                      <span className="text-gray-400"> ({m.count})</span>
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">Ish topilmadi</p>}
            </div>

            {/* To'lov qo'shish */}
            {hasRole('admin', 'manager', 'branch_manager') && (
              <div className="bg-gray-50 dark:bg-gray-700/40 rounded-xl p-3">
                <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2">To'lov qo'shish</h4>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
                  <Input label="Summa *" type="number" placeholder="0" error={payForm.formState.errors.amount?.message}
                    {...payForm.register('amount', { required: 'Kerak', min: { value: 1, message: '>0' } })} />
                  <Input label="Sana" type="date" {...payForm.register('paymentDate')} />
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Usul</label>
                    <select className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg"
                      {...payForm.register('method')}>
                      <option value="cash">Naqd</option>
                      <option value="card">Karta</option>
                      <option value="transfer">O'tkazma</option>
                    </select>
                  </div>
                  <Button loading={addPayMutation.isPending} onClick={payForm.handleSubmit(d => addPayMutation.mutate(d))}>Qo'shish</Button>
                </div>
                <div className="mt-2">
                  <Input label="Izoh" placeholder="ixtiyoriy" {...payForm.register('note')} />
                </div>
              </div>
            )}

            {/* To'lovlar ro'yxati */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-1.5">
                <Wallet className="w-4 h-4 text-green-500" /> To'lovlar tarixi
              </h4>
              {detail.payments?.length ? (
                <div className="space-y-1.5 max-h-44 overflow-y-auto">
                  {detail.payments.map((p: any) => (
                    <div key={p.id} className="flex items-center justify-between text-sm border-b border-gray-100 dark:border-gray-700/50 py-1.5">
                      <div>
                        <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(Number(p.amount))}</span>
                        <span className="text-xs text-gray-400 ml-2">{new Date(p.paymentDate).toLocaleDateString('uz-UZ')}</span>
                        <span className="text-xs text-gray-400 ml-2">{p.method === 'card' ? 'Karta' : p.method === 'transfer' ? "O'tkazma" : 'Naqd'}</span>
                        {p.note && <span className="text-xs text-gray-500 ml-2">— {p.note}</span>}
                      </div>
                      {hasRole('admin', 'manager') && (
                        <button onClick={() => { if (window.confirm("To'lovni o'chirasizmi?")) delPayMutation.mutate(p.id) }}
                          className="p-1 text-gray-300 hover:text-red-500"><X className="w-4 h-4" /></button>
                      )}
                    </div>
                  ))}
                </div>
              ) : <p className="text-sm text-gray-400">To'lov yo'q</p>}
            </div>

            {/* Bajarilgan ishlar ro'yxati */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 dark:text-gray-200 mb-2 flex items-center gap-1.5">
                <Wrench className="w-4 h-4 text-purple-500" /> Bajarilgan ishlar
              </h4>
              {detail.works?.length ? (
                <div className="overflow-x-auto max-h-60 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-gray-900">
                      <tr className="text-gray-500 text-xs">
                        <th className="text-left px-3 py-2 font-medium">Sana</th>
                        <th className="text-left px-3 py-2 font-medium">Mashina</th>
                        <th className="text-left px-3 py-2 font-medium">Ish</th>
                        <th className="text-right px-3 py-2 font-medium">Usta haqi</th>
                      </tr>
                    </thead>
                    <tbody>
                      {detail.works.map((w: any) => (
                        <tr key={w.id} className="border-b border-gray-50 dark:border-gray-700/50">
                          <td className="px-3 py-2 text-gray-600 dark:text-gray-300 whitespace-nowrap">{new Date(w.date).toLocaleDateString('uz-UZ')}</td>
                          <td className="px-3 py-2 text-gray-700 dark:text-gray-200">{w.vehicle}</td>
                          <td className="px-3 py-2 text-gray-500 dark:text-gray-400 max-w-[200px] truncate">{w.notes || '—'}</td>
                          <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-white">{formatCurrency(w.laborCost)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : <p className="text-sm text-gray-400">Ish topilmadi</p>}
            </div>
          </div>
        )}
      </Modal>

      {/* Add/edit master */}
      <Modal open={modalOpen} onClose={() => { setModalOpen(false); setSelected(null); reset() }}
        title={selected ? 'Usta tahrirlash' : "Usta qo'shish"} size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-4">
          <Input label="Usta ismi *" placeholder="Alisher aka" error={errors.name?.message}
            {...register('name', { required: 'Talab qilinadi' })} />
          <Input label="Telefon" placeholder="+998901234567" {...register('phone')} />
          <Input label="Izoh" placeholder="ixtiyoriy" {...register('notes')} />
          <p className="text-xs text-gray-400">
            Usta bajargan ish summasi ta'mirlash yozuvlaridagi "Usta haqi" (usta ismi shu ism bilan kiritilgan)
            bo'yicha avtomatik hisoblanadi.
          </p>
        </div>
      </Modal>
    </div>
  )
}
