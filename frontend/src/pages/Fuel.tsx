import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Fuel as FuelIcon, Upload } from 'lucide-react'
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
  const [page, setPage] = useState(1)
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [fuelTypeFilter, setFuelTypeFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)
  const [receiptFile, setReceiptFile] = useState<File | null>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['fuel-records', page, vehicleFilter, fuelTypeFilter],
    queryFn: () => api.get('/fuel-records', { params: { page, limit: 20, vehicleId: vehicleFilter || undefined, fuelType: fuelTypeFilter || undefined } }).then(r => r.data),
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
      toast.success("Yonilg'i to'ldirish qayd etildi")
      qc.invalidateQueries({ queryKey: ['fuel-records'] })
      setModalOpen(false); reset(); setReceiptFile(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    { key: 'vehicle', title: 'Avtomashina', render: (r: FuelRecord) => (
      <div><p className="font-medium">{r.vehicle?.registrationNumber}</p><p className="text-xs text-gray-400">{r.vehicle?.brand} {r.vehicle?.model}</p></div>
    )},
    { key: 'fuelType', title: 'Turi', render: (r: FuelRecord) => <Badge variant={fuelColors[r.fuelType]}>{FUEL_TYPES[r.fuelType]}</Badge> },
    { key: 'amountLiters', title: 'Miqdor', render: (r: FuelRecord) => `${Number(r.amountLiters).toFixed(1)} L` },
    { key: 'cost', title: 'Narxi', render: (r: FuelRecord) => formatCurrency(Number(r.cost)) },
    { key: 'odometerReading', title: 'Odometr', render: (r: FuelRecord) => `${Number(r.odometerReading).toLocaleString()} km` },
    { key: 'refuelDate', title: 'Sana', render: (r: FuelRecord) => formatDate(r.refuelDate) },
    { key: 'supplier', title: "Ta'minotchi", render: (r: FuelRecord) => r.supplier?.name || '-' },
    { key: 'receipt', title: 'Rasm', render: (r: FuelRecord) => r.receiptImageUrl
      ? <a href={`${apiBaseUrl}${r.receiptImageUrl}`} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs">Ko'rish</a>
      : <span className="text-gray-400 text-xs">Yo'q</span>
    },
  ]

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}` }))
  const suppliers = [{ value: '', label: "Ta'minotchi yo'q" }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]
  const fuelOptions = Object.entries(FUEL_TYPES).map(([k, v]) => ({ value: k, label: v }))

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Yonilg'i</h1>
          <p className="text-gray-500 text-sm">Jami: {data?.meta?.total || 0} ta yozuv</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/fuel-records" label="Excel" />
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setReceiptFile(null); setModalOpen(true) }}>Qayd etish</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <SearchableSelect
              options={[{ value: '', label: 'Barcha avtomashinalari' }, ...vehicles]}
              value={vehicleFilter}
              onChange={v => { setVehicleFilter(v); setPage(1) }}
              placeholder="Avtomashina bo'yicha filter..."
            />
          </div>
          <select value={fuelTypeFilter} onChange={e => { setFuelTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">Barcha turlar</option>
            {fuelOptions.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
          </select>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={20} onPageChange={setPage} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Yonilg'i to'ldirish" size="lg"
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
            <SearchableSelect label="Yonilg'i turi *" options={fuelOptions} value={watch('fuelType') || ''}
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
          <SearchableSelect label="Ta'minotchi" options={suppliers} value={watch('supplierId') || ''}
            onChange={v => setValue('supplierId', v)} placeholder="Ta'minotchi qidiring..." />
          <div>
            <label className="text-sm font-medium text-gray-700">Kvitansiya rasmi</label>
            <div className="mt-1 border-2 border-dashed border-gray-300 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => document.getElementById('receipt-upload')?.click()}>
              <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500">{receiptFile ? receiptFile.name : 'Rasm yuklash (ixtiyoriy)'}</p>
              <input id="receipt-upload" type="file" accept="image/*" className="hidden" onChange={e => setReceiptFile(e.target.files?.[0] || null)} />
            </div>
          </div>
        </div>
      </Modal>
    </div>
  )
}
