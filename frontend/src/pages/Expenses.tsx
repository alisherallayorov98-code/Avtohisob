import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Search, Wallet, TrendingDown, Car, Tag, Calendar } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import { useNavigate } from 'react-router-dom'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import Table from '../components/ui/Table'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'
import { useDebounce } from '../hooks/useDebounce'

interface Expense {
  id: string
  amount: number
  description?: string
  expenseDate: string
  vehicle?: { id: string; registrationNumber: string; brand: string; model: string }
  category?: { id: string; name: string }
  createdBy?: { fullName: string }
}

interface ExpenseForm {
  vehicleId: string
  categoryId: string
  amount: string
  description: string
  expenseDate: string
}

export default function Expenses() {
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  useEffect(() => { setPage(1) }, [debouncedSearch])
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['expenses', page, limit, vehicleFilter, categoryFilter, from, to],
    queryFn: () => api.get('/expenses', {
      params: {
        page, limit,
        vehicleId: vehicleFilter || undefined,
        categoryId: categoryFilter || undefined,
        from: from || undefined,
        to: to || undefined,
      }
    }).then(r => r.data),
    placeholderData: keepPreviousData,
  })

  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])

  const { data: categoriesData } = useQuery({
    queryKey: ['expense-categories'],
    queryFn: () => api.get('/expenses/categories').then(r => r.data.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-list'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { register, handleSubmit, reset, formState: { errors } } = useForm<ExpenseForm>({
    defaultValues: { expenseDate: new Date().toISOString().slice(0, 10) }
  })

  const saveMutation = useMutation({
    mutationFn: (body: ExpenseForm) => api.post('/expenses', body),
    onSuccess: () => {
      toast.success("Xarajat qo'shildi")
      qc.invalidateQueries({ queryKey: ['expenses'] })
      setModalOpen(false)
      reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Summary stats
  const expenses: Expense[] = data?.data || []
  const totalAmount = expenses.reduce((s, e) => s + Number(e.amount), 0)

  const columns = [
    {
      key: 'date', title: 'Sana', render: (e: Expense) => (
        <div className="flex items-center gap-1.5 text-sm text-gray-600 dark:text-gray-300">
          <Calendar className="w-3.5 h-3.5 text-gray-400" />
          {new Date(e.expenseDate).toLocaleDateString('uz-UZ')}
        </div>
      )
    },
    {
      key: 'vehicle', title: 'Avtomashina', render: (e: Expense) => e.vehicle ? (
        <button
          onClick={() => navigate(`/vehicles/${e.vehicle!.id}`)}
          className="text-sm text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1"
        >
          <Car className="w-3.5 h-3.5" />
          {e.vehicle.registrationNumber} — {e.vehicle.brand} {e.vehicle.model}
        </button>
      ) : <span className="text-gray-400 text-sm">—</span>
    },
    {
      key: 'category', title: 'Kategoriya', render: (e: Expense) => e.category ? (
        <span className="inline-flex items-center gap-1 text-xs bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-2 py-0.5 rounded-full">
          <Tag className="w-3 h-3" />{e.category.name}
        </span>
      ) : <span className="text-gray-400 text-sm">—</span>
    },
    {
      key: 'description', title: 'Tavsif', render: (e: Expense) => (
        <span className="text-sm text-gray-600 dark:text-gray-300 line-clamp-1 max-w-xs">{e.description || '—'}</span>
      )
    },
    {
      key: 'amount', title: 'Summa', render: (e: Expense) => (
        <span className="font-semibold text-red-600 dark:text-red-400">{formatCurrency(Number(e.amount))}</span>
      )
    },
    {
      key: 'createdBy', title: 'Kiritdi', render: (e: Expense) => (
        <span className="text-xs text-gray-500 dark:text-gray-400">{e.createdBy?.fullName || '—'}</span>
      )
    },
  ]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Xarajatlar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta yozuv</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/expenses" label="Excel" />
          {hasRole('admin', 'manager', 'branch_manager') && (
            <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>
              Qo'shish
            </Button>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-red-100 dark:bg-red-900/30 rounded-lg flex items-center justify-center">
            <Wallet className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Sahifada jami</p>
            <p className="text-lg font-bold text-red-600 dark:text-red-400">{formatCurrency(totalAmount)}</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-lg flex items-center justify-center">
            <TrendingDown className="w-5 h-5 text-blue-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Jami yozuvlar</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{data?.meta?.total || 0} ta</p>
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
          <div className="w-10 h-10 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
            <Tag className="w-5 h-5 text-purple-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500 dark:text-gray-400">Kategoriyalar</p>
            <p className="text-lg font-bold text-gray-900 dark:text-white">{categoriesData?.length || 0} ta</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex flex-col sm:flex-row gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              placeholder="Qidirish..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          <select value={vehicleFilter} onChange={e => { setVehicleFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha mashinalar</option>
            {(vehiclesData || []).map((v: any) => (
              <option key={v.id} value={v.id}>{v.registrationNumber} — {v.brand} {v.model}</option>
            ))}
          </select>
          <select value={categoryFilter} onChange={e => { setCategoryFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha kategoriyalar</option>
            {(categoriesData || []).map((c: any) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {(vehicleFilter || categoryFilter || from || to) && (
            <Button size="sm" variant="outline" onClick={() => { setVehicleFilter(''); setCategoryFilter(''); setFrom(''); setTo(''); setPage(1) }}>
              Tozalash
            </Button>
          )}
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      {/* Add expense modal */}
      <Modal
        open={modalOpen}
        onClose={() => { setModalOpen(false); reset() }}
        title="Xarajat qo'shish"
        size="md"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={saveMutation.isPending} onClick={handleSubmit(d => saveMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Avtomashina</label>
            <select {...register('vehicleId')}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Mashinasiz —</option>
              {(vehiclesData || []).map((v: any) => (
                <option key={v.id} value={v.id}>{v.registrationNumber} — {v.brand} {v.model}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Kategoriya</label>
            <select {...register('categoryId')}
              className="w-full border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Tanlang —</option>
              {(categoriesData || []).map((c: any) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <Input
            label="Summa (so'm) *"
            type="number"
            min="0"
            error={errors.amount?.message}
            {...register('amount', { required: 'Talab qilinadi', min: { value: 0, message: 'Manfiy bo\'lmasligi kerak' } })}
          />
          <Input label="Tavsif" {...register('description')} />
          <Input
            label="Sana *"
            type="date"
            error={errors.expenseDate?.message}
            {...register('expenseDate', { required: 'Talab qilinadi' })}
          />
        </div>
      </Modal>
    </div>
  )
}
