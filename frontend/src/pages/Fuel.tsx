import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Fuel as FuelIcon, Upload, Trash2, TrendingUp, Droplets, DollarSign } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api, { apiBaseUrl } from '../lib/api'
import { formatCurrency, formatDate, FUEL_TYPES } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import { useAuthStore } from '../stores/authStore'

interface FuelRecord {
  id: string
  vehicleId: string
  fuelType: string
  amountLiters: number
  cost: number
  odometerReading: number
  refuelDate: string
  receiptImageUrl?: string
  vehicle: { registrationNumber: string; brand: string; model: string }
  supplier?: { name: string }
  createdBy: { fullName: string }
}

interface FuelForm {
  vehicleId: string
  fuelType: string
  amountLiters: string
  cost: string
  odometerReading: string
  refuelDate: string
  supplierId: string
}

const fuelColors: Record<string, any> = { petrol: 'info', diesel: 'warning', gas: 'success', electric: 'default' }

export default function Fuel() {
  const qc = useQueryClient()
  const { hasRole } = useAuthStore()
  const [page, setPage] = useState(1)
  const [limit, setLimit] = useState(20)
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [fuelTypeFilter, setFuelTypeFilter] = useState('')
  const [fromDate, setFromDate] = useState('')
  const [toDate, setToDate] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)

  const params = {
    page, limit,
    vehicleId: vehicleFilter || undefined,
    fuelType: fuelTypeFilter || undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
  }

  const { data, isLoading } = useQuery({
    queryKey: ['fuel-records', page, limit, vehicleFilter, fuelTypeFilter, fromDate, toDate],
    queryFn: () => api.get('/fuel-records', { params }).then(r => r.data),
  })

  const { data: statsData } = useQuery({
    queryKey: ['fuel-stats', vehicleFilter, fuelTypeFilter, fromDate, toDate],
    queryFn: () => api.get('/fuel-records/stats', { params: { vehicleId: vehicleFilter || undefined, fuelType: fuelTypeFilter || undefined, from: fromDate || undefined, to: toDate || undefined } }).then(r => r.data.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<FuelForm>()

  const createMutation = useMutation({
    mutationFn: (body: FuelForm) => {
      const formData = new FormData()
      Object.entries(body).forEach(([k, v]) => v && formData.append(k, v))
      if (receiptFile) formData.append('receipt', receiptFile)
      return api.post('/fuel-records', formData, { headers: { 'Content-Type': 'multipart/form-data' } })
    },
    onSuccess: () => {
      toast.success("Yoqilg'i to'ldirish qayd etildi")
      qc.invalidateQueries({ queryKey: ['fuel-records'] })
      qc.invalidateQueries({ queryKey: ['fuel-stats'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setModalOpen(false); reset(); setReceiptFile(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-records/${id}`),
    onSuccess: () => {
      toast.success("O'chirildi")
      qc.invalidateQueries({ queryKey: ['fuel-records'] })
      qc.invalidateQueries({ queryKey: ['fuel-stats'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    { key: 'vehicle', title: 'Avtomashina', render: (r: FuelRecord) => (
      <div><p className="font-medium text-gray-900 dark:text-white">{r.vehicle?.registrationNumber}</p><p className="text-xs text-gray-400">{r.vehicle?.brand} {r.vehicle?.model}</p></div>
    )},
    { key: 'fuelType', title: 'Turi', render: (r: FuelRecord) => <Badge variant={fuelColors[r.fuelType]}>{FUEL_TYPES[r.fuelType]}</Badge> },
    { key: 'amountLiters', title: 'Litr', render: (r: FuelRecord) => `${Number(r.amountLiters).toFixed(1)} L` },
    { key: 'cost', title: 'Narxi', render: (r: FuelRecord) => formatCurrency(Number(r.cost)) },
    { key: 'costPerLiter', title: '1 litr', render: (r: FuelRecord) => {
      const cpp = Number(r.amountLiters) > 0 ? Math.round(Number(r.cost) / Number(r.amountLiters)) : 0
      return <span className="text-sm font-medium">{cpp.toLocaleString()} so'm</span>
    }},
    { key: 'odometerReading', title: 'Odometr', render: (r: FuelRecord) => `${Number(r.odometerReading).toLocaleString()} km` },
    { key: 'refuelDate', title: 'Sana', render: (r: FuelRecord) => formatDate(r.refuelDate) },
    { key: 'supplier', title: 'Yetkazuvchi', render: (r: FuelRecord) => <span className="text-sm text-gray-500 dark:text-gray-400">{r.supplier?.name || '—'}</span> },
    { key: 'receipt', title: 'Chek', render: (r: FuelRecord) => r.receiptImageUrl
      ? <a href={`${apiBaseUrl}${r.receiptImageUrl}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs">Ko'rish</a>
      : <span className="text-gray-400 text-xs">—</span>
    },
    {
      key: 'actions', title: '', render: (r: FuelRecord) => hasRole('admin', 'manager') ? (
        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />}
          onClick={() => { if (confirm("O'chirilsinmi?")) deleteMutation.mutate(r.id) }} />
      ) : null
    },
  ]

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}` }))
  const suppliers = [{ value: '', label: "Yetkazuvchi yo'q" }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]
  const fuelOptions = Object.entries(FUEL_TYPES).map(([k, v]) => ({ value: k, label: v }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Yoqilg'i</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Jami: {data?.meta?.total || 0} ta yozuv</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/fuel-records" label="Excel" />
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setReceiptFile(null); setModalOpen(true) }}>Qayd etish</Button>
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <Droplets className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jami litr</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{Number(statsData.totalLiters).toFixed(0)} L</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Jami xarajat</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(statsData.totalCost)}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <FuelIcon className="w-8 h-8 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">O'rt. narx (1L)</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{Number(statsData.avgCostPerLiter).toLocaleString()} so'm</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-purple-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Yozuvlar soni</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData.count}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <SearchableSelect
              options={[{ value: '', label: 'Barcha avtomashinalari' }, ...vehicles]}
              value={vehicleFilter}
              onChange={v => { setVehicleFilter(v); setPage(1) }}
              placeholder="Avtomashina bo'yicha filter..."
            />
          </div>
          <select value={fuelTypeFilter} onChange={e => { setFuelTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha turlar</option>
            {fuelOptions.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
          <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Dan" />
          <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Gacha" />
          {(fromDate || toDate) && (
            <button onClick={() => { setFromDate(''); setToDate(''); setPage(1) }}
              className="px-3 py-2 text-sm text-red-500 hover:text-red-700 rounded-lg border border-red-200 hover:border-red-300">
              Tozalash
            </button>
          )}
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yoqilg'i to'ldirish qayd etish" size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>Bekor qilish</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>Saqlash</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <SearchableSelect label="Avtomashina *" options={vehicles} value={watch('vehicleId') || ''}
              onChange={v => setValue('vehicleId', v, { shouldValidate: true })}
              placeholder="Avtomashina qidiring..." error={errors.vehicleId?.message} />
            <input type="hidden" {...register('vehicleId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label="Yoqilg'i turi *" options={fuelOptions} value={watch('fuelType') || ''}
              onChange={v => setValue('fuelType', v, { shouldValidate: true })}
              placeholder="Tur tanlang..." error={errors.fuelType?.message} />
            <input type="hidden" {...register('fuelType', { required: 'Talab qilinadi' })} />
          </div>
          <Input label="Miqdor (litr) *" type="number" step="0.01" error={errors.amountLiters?.message}
            {...register('amountLiters', { required: 'Talab qilinadi', min: { value: 0.1, message: 'Musbat' } })} />
          <Input label="Narxi (so'm) *" type="number" error={errors.cost?.message}
            {...register('cost', { required: 'Talab qilinadi', min: { value: 1, message: 'Musbat' } })} />
          <Input label="Odometr (km) *" type="number" error={errors.odometerReading?.message}
            {...register('odometerReading', { required: 'Talab qilinadi', min: { value: 0, message: 'Musbat' } })} />
          <Input label="Sana *" type="datetime-local" error={errors.refuelDate?.message}
            defaultValue={new Date().toISOString().slice(0, 16)}
            {...register('refuelDate', { required: 'Talab qilinadi' })} />
          <SearchableSelect label="Yetkazuvchi" options={suppliers} value={watch('supplierId') || ''}
            onChange={v => setValue('supplierId', v)} placeholder="Yetkazuvchi qidiring..." />
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Kvitansiya rasmi</label>
            <div className="mt-1 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => document.getElementById('receipt-upload')?.click()}>
              <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500 dark:text-gray-400">{receiptFile ? receiptFile.name : 'Rasm yuklash (ixtiyoriy)'}</p>
              <input id="receipt-upload" type="file" accept="image/*" className="hidden" onChange={e => setReceiptFile(e.target.files?.[0] || null)} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
