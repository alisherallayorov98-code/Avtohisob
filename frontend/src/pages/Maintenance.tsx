import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Plus, Search, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api from '../lib/api'
import { formatCurrency, formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Pagination from '../components/ui/Pagination'

interface MaintenanceRecord {
  id: string
  vehicleId: string
  installationDate: string
  quantityUsed: number
  cost: number
  notes?: string
  vehicle: { id: string; registrationNumber: string; brand: string; model: string }
  sparePart: { id: string; name: string; partCode: string; category: string }
  supplier?: { name: string }
  performedBy: { fullName: string }
}

interface MaintenanceForm {
  vehicleId: string
  sparePartId: string
  quantityUsed: string
  installationDate: string
  cost: string
  supplierId: string
  notes: string
}

export default function Maintenance() {
  const qc = useQueryClient()
  const [page, setPage] = useState(1)
  const [search, setSearch] = useState('')
  const [vehicleFilter, setVehicleFilter] = useState('')
  const [modalOpen, setModalOpen] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['maintenance', page, vehicleFilter],
    queryFn: () => api.get('/maintenance', { params: { page, limit: 20, vehicleId: vehicleFilter || undefined } }).then(r => r.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: sparePartsData } = useQuery({
    queryKey: ['spare-parts-all'],
    queryFn: () => api.get('/spare-parts', { params: { limit: 200 } }).then(r => r.data.data),
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { register, handleSubmit, reset, watch, setValue, formState: { errors } } = useForm<MaintenanceForm>()

  const createMutation = useMutation({
    mutationFn: (body: MaintenanceForm) => api.post('/maintenance', body),
    onSuccess: () => {
      toast.success("Ehtiyot qism o'rnatish qayd etildi")
      qc.invalidateQueries({ queryKey: ['maintenance'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      setModalOpen(false); reset()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    { key: 'vehicle', title: 'Avtomashina', render: (r: MaintenanceRecord) => (
      <div><p className="font-medium">{r.vehicle?.registrationNumber}</p><p className="text-xs text-gray-400">{r.vehicle?.brand} {r.vehicle?.model}</p></div>
    )},
    { key: 'sparePart', title: 'Ehtiyot qism', render: (r: MaintenanceRecord) => (
      <div><p className="font-medium">{r.sparePart?.name}</p><p className="text-xs font-mono text-gray-400">{r.sparePart?.partCode}</p></div>
    )},
    { key: 'quantityUsed', title: 'Miqdor', render: (r: MaintenanceRecord) => `${r.quantityUsed} ta` },
    { key: 'cost', title: 'Narxi', render: (r: MaintenanceRecord) => formatCurrency(Number(r.cost)) },
    { key: 'installationDate', title: 'Sana', render: (r: MaintenanceRecord) => formatDate(r.installationDate) },
    { key: 'supplier', title: "Ta'minotchi", render: (r: MaintenanceRecord) => r.supplier?.name || '-' },
    { key: 'performedBy', title: 'Bajardi', render: (r: MaintenanceRecord) => r.performedBy?.fullName },
  ]

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}` }))
  const spareParts = (sparePartsData || []).map((sp: any) => ({ value: sp.id, label: `${sp.partCode} - ${sp.name}` }))
  const suppliers = [{ value: '', label: "Ta'minotchi yo'q" }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Ehtiyot Qismlar O'rnatish</h1>
          <p className="text-gray-500 text-sm">Jami: {data?.meta?.total || 0} ta yozuv</p>
        </div>
        <div className="flex items-center gap-2">
          <ExcelExportButton endpoint="/exports/maintenance" label="Excel" />
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setModalOpen(true) }}>Qayd etish</Button>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 shadow-sm">
        <div className="p-4 border-b border-gray-100 flex gap-3">
          <div className="flex-1">
            <SearchableSelect
              options={[{ value: '', label: 'Barcha avtomashinalari' }, ...vehicles]}
              value={vehicleFilter}
              onChange={v => { setVehicleFilter(v); setPage(1) }}
              placeholder="Avtomashina bo'yicha filter..."
            />
          </div>
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={20} onPageChange={setPage} />
      </div>

      <Modal open={modalOpen} onClose={() => setModalOpen(false)} title="Ehtiyot qism o'rnatish" size="lg"
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
            <SearchableSelect label="Ehtiyot qism *" options={spareParts} value={watch('sparePartId') || ''}
              onChange={v => setValue('sparePartId', v, { shouldValidate: true })}
              placeholder="Kod yoki nom bilan qidiring..." error={errors.sparePartId?.message} />
            <input type="hidden" {...register('sparePartId', { required: 'Talab qilinadi' })} />
          </div>
          <Input label="Miqdor *" type="number" placeholder="1" error={errors.quantityUsed?.message}
            {...register('quantityUsed', { required: 'Talab qilinadi', min: { value: 1, message: 'Kamida 1' } })} />
          <Input label="Narxi (so'm) *" type="number" error={errors.cost?.message}
            {...register('cost', { required: 'Talab qilinadi', min: { value: 0, message: 'Manfiy emas' } })} />
          <Input label="O'rnatish sanasi *" type="datetime-local" error={errors.installationDate?.message}
            {...register('installationDate', { required: 'Talab qilinadi' })} />
          <SearchableSelect label="Ta'minotchi" options={suppliers} value={watch('supplierId') || ''}
            onChange={v => setValue('supplierId', v)} placeholder="Ta'minotchi qidiring..." />
          <div className="sm:col-span-2">
            <label className="text-sm font-medium text-gray-700">Izohlar</label>
            <textarea className="mt-1 w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" rows={2} {...register('notes')} />
          </div>
        </div>
      </Modal>
    </div>
  )
}
