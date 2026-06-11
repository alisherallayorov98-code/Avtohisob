import { useState, useEffect, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query'
import { Plus, Fuel as FuelIcon, Upload, Trash2, TrendingUp, Droplets, DollarSign, Tag, X } from 'lucide-react'
import { Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { useForm } from 'react-hook-form'
import api, { getFileUrl } from '../lib/api'
import { formatCurrency, formatDate, FUEL_TYPES, fuelUnit } from '../lib/utils'
import Button from '../components/ui/Button'
import ExcelExportButton from '../components/ui/ExcelExportButton'
import Input from '../components/ui/Input'
import Modal from '../components/ui/Modal'
import SearchableSelect from '../components/ui/SearchableSelect'
import Table from '../components/ui/Table'
import Badge from '../components/ui/Badge'
import Pagination from '../components/ui/Pagination'
import ConfirmDialog from '../components/ui/ConfirmDialog'
import { useAuthStore } from '../stores/authStore'
import { useTranslation } from 'react-i18next'

interface PriceEntry {
  id: string
  fuelType: string
  pricePerUnit: number
  effectiveFrom: string
  note?: string
}

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
  const { t } = useTranslation()
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
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [priceModalOpen, setPriceModalOpen] = useState(false)
  const [priceForm, setPriceForm] = useState({ fuelType: 'gas', pricePerUnit: '', effectiveFrom: new Date().toISOString().slice(0, 10), note: '' })
  const [currentPriceHint, setCurrentPriceHint] = useState<{ price: number; since: string; unit: string } | null>(null)

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
    placeholderData: keepPreviousData,
  })

  // Pagination edge-case: agar element o'chirilganda sahifa bo'sh qolsa, orqaga qayt
  useEffect(() => {
    if (data?.data?.length === 0 && page > 1) setPage(p => p - 1)
  }, [data, page])


  const { data: statsData } = useQuery({
    queryKey: ['fuel-stats', vehicleFilter, fuelTypeFilter, fromDate, toDate],
    queryFn: () => api.get('/fuel-records/stats', { params: { vehicleId: vehicleFilter || undefined, fuelType: fuelTypeFilter || undefined, from: fromDate || undefined, to: toDate || undefined } }).then(r => r.data.data),
  })

  const { data: vehiclesData } = useQuery({
    queryKey: ['vehicles-all'],
    queryFn: () => api.get('/vehicles', { params: { select: 'true' } }).then(r => r.data.data),
  })

  const { data: suppliersData } = useQuery({
    queryKey: ['suppliers-list'],
    queryFn: () => api.get('/suppliers').then(r => r.data.data),
  })

  const { data: priceHistoryData, refetch: refetchPrices } = useQuery({
    queryKey: ['fuel-prices'],
    queryFn: () => api.get('/fuel-prices').then(r => r.data.data as PriceEntry[]),
    enabled: priceModalOpen,
  })

  const addPriceMutation = useMutation({
    mutationFn: (body: typeof priceForm) => api.post('/fuel-prices', {
      fuelType: body.fuelType,
      pricePerUnit: parseFloat(body.pricePerUnit),
      effectiveFrom: body.effectiveFrom,
      note: body.note || undefined,
    }),
    onSuccess: () => {
      toast.success('Narx qo\'shildi')
      qc.invalidateQueries({ queryKey: ['fuel-prices'] })
      setPriceForm({ fuelType: 'gas', pricePerUnit: '', effectiveFrom: new Date().toISOString().slice(0, 10), note: '' })
      refetchPrices()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deletePriceMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-prices/${id}`),
    onSuccess: () => { toast.success('O\'chirildi'); qc.invalidateQueries({ queryKey: ['fuel-prices'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
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
      toast.success(t('fuel.toast.created'))
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
      toast.success(t('fuel.toast.deleted'))
      qc.invalidateQueries({ queryKey: ['fuel-records'] })
      qc.invalidateQueries({ queryKey: ['fuel-stats'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const columns = [
    { key: 'vehicle', title: t('fuel.colVehicle'), render: (r: FuelRecord) => (
      <div><p className="font-medium text-gray-900 dark:text-white">{r.vehicle?.registrationNumber}</p><p className="text-xs text-gray-400">{r.vehicle?.brand} {r.vehicle?.model}</p></div>
    )},
    { key: 'fuelType', title: t('fuel.colType'), render: (r: FuelRecord) => <Badge variant={fuelColors[r.fuelType]}>{FUEL_TYPES[r.fuelType]}</Badge> },
    { key: 'amountLiters', title: t('fuel.colLiters'), render: (r: FuelRecord) => `${Number(r.amountLiters).toFixed(1)} ${fuelUnit(r.fuelType)}` },
    { key: 'cost', title: t('fuel.colCost'), render: (r: FuelRecord) => formatCurrency(Number(r.cost)) },
    { key: 'costPerLiter', title: t('fuel.colPerLiter'), render: (r: FuelRecord) => {
      const cpp = Number(r.amountLiters) > 0 ? Math.round(Number(r.cost) / Number(r.amountLiters)) : 0
      return <span className="text-sm font-medium">{cpp.toLocaleString()} so'm/{fuelUnit(r.fuelType)}</span>
    }},
    { key: 'odometerReading', title: t('fuel.colOdometer'), render: (r: FuelRecord) => `${Number(r.odometerReading).toLocaleString()} km` },
    { key: 'refuelDate', title: t('fuel.colDate'), render: (r: FuelRecord) => formatDate(r.refuelDate) },
    { key: 'supplier', title: t('fuel.colSupplier'), render: (r: FuelRecord) => <span className="text-sm text-gray-500 dark:text-gray-400">{r.supplier?.name || '—'}</span> },
    { key: 'receipt', title: t('fuel.colReceipt'), render: (r: FuelRecord) => r.receiptImageUrl
      ? <a href={getFileUrl(r.receiptImageUrl)} target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline text-xs">{t('fuel.viewReceipt')}</a>
      : <span className="text-gray-400 text-xs">—</span>
    },
    {
      key: 'actions', title: '', render: (r: FuelRecord) => hasRole('admin', 'manager', 'branch_manager') ? (
        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />}
          onClick={() => setDeleteConfirmId(r.id)} />
      ) : null
    },
  ]

  const vehicles = (vehiclesData || []).map((v: any) => ({ value: v.id, label: `${v.registrationNumber} - ${v.brand} ${v.model}`, fuelType: v.fuelType }))
  const selectedVehicleId = watch('vehicleId')
  const selectedFuelType = watch('fuelType')
  const selectedAmount = watch('amountLiters')
  const selectedDate = watch('refuelDate')
  const unit = fuelUnit(selectedFuelType)
  const suppliers = [{ value: '', label: t('fuel.noSupplier') }, ...(suppliersData || []).map((s: any) => ({ value: s.id, label: s.name }))]
  const fuelOptions = Object.entries(FUEL_TYPES).map(([k, v]) => ({ value: k, label: v }))

  // Narx avtomatik hisoblash: fuelType tanlansa narx ko'rsatiladi, miqdor kiritilsa cost hisoblanadi
  const fetchAndApplyPrice = useCallback(async (ft: string, amount: string, date: string) => {
    if (!ft) { setCurrentPriceHint(null); return }
    try {
      const dateStr = date ? date.slice(0, 10) : new Date().toISOString().slice(0, 10)
      const res = await api.get('/fuel-prices/current', { params: { date: dateStr } })
      const priceMap = res.data.data as Record<string, { pricePerUnit: number; effectiveFrom: string }>
      const p = priceMap[ft]
      if (p && p.pricePerUnit > 0) {
        setCurrentPriceHint({ price: p.pricePerUnit, since: p.effectiveFrom, unit: fuelUnit(ft) })
        const amt = parseFloat(amount)
        if (!isNaN(amt) && amt > 0) {
          setValue('cost', String(Math.round(amt * p.pricePerUnit)))
        }
      } else {
        setCurrentPriceHint(null)
      }
    } catch { setCurrentPriceHint(null) }
  }, [setValue])

  useEffect(() => {
    if (modalOpen && selectedFuelType) {
      fetchAndApplyPrice(selectedFuelType, selectedAmount, selectedDate)
    }
  }, [selectedFuelType, selectedAmount, selectedDate, modalOpen, fetchAndApplyPrice])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{t('fuel.title')}</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">{t('fuel.totalRecords', { count: data?.meta?.total || 0 })}</p>
        </div>
        <div className="flex items-center gap-2">
          <Link to="/fuel-import" className="inline-flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-300">
            <Upload className="w-4 h-4" /> Excel import
          </Link>
          <ExcelExportButton endpoint="/exports/fuel-records" label="Excel" />
          {hasRole('admin', 'manager') && (
            <Button variant="outline" icon={<Tag className="w-4 h-4" />} onClick={() => setPriceModalOpen(true)}>Narxlar</Button>
          )}
          <Button icon={<Plus className="w-4 h-4" />} onClick={() => { reset(); setCurrentPriceHint(null); setReceiptFile(null); setModalOpen(true) }}>{t('fuel.recordBtn')}</Button>
        </div>
      </div>

      {/* Stats */}
      {statsData && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <Droplets className="w-8 h-8 text-blue-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('fuel.statLiters')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{Number(statsData.totalLiters).toFixed(0)} L/m³</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <DollarSign className="w-8 h-8 text-green-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('fuel.statCost')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(statsData.totalCost)}</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <FuelIcon className="w-8 h-8 text-yellow-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('fuel.statAvgPrice')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{Number(statsData.avgCostPerLiter).toLocaleString()} so'm/L·m³</p>
            </div>
          </div>
          <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 flex items-center gap-3">
            <TrendingUp className="w-8 h-8 text-purple-500 flex-shrink-0" />
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400">{t('fuel.statCount')}</p>
              <p className="text-xl font-bold text-gray-900 dark:text-white">{statsData.count}</p>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="p-4 border-b border-gray-100 dark:border-gray-700 flex gap-3 flex-wrap">
          <div className="flex-1 min-w-40">
            <SearchableSelect
              options={[{ value: '', label: t('fuel.allVehicles') }, ...vehicles]}
              value={vehicleFilter}
              onChange={v => { setVehicleFilter(v); setPage(1) }}
              placeholder="Avtomashina bo'yicha filter..."
            />
          </div>
          <select value={fuelTypeFilter} onChange={e => { setFuelTypeFilter(e.target.value); setPage(1) }}
            className="px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">{t('fuel.allTypes')}</option>
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
              {t('fuel.clearDates')}
            </button>
          )}
        </div>
        <Table columns={columns} data={data?.data || []} loading={isLoading} numbered page={page} limit={limit} />
        <Pagination page={page} totalPages={data?.meta?.totalPages || 1} total={data?.meta?.total || 0} limit={limit} onPageChange={setPage} onLimitChange={setLimit} />
      </div>

      <Modal open={modalOpen} onClose={() => { setModalOpen(false); reset(); setReceiptFile(null) }} title={t('fuel.modalTitle')} size="lg"
        footer={
          <>
            <Button variant="outline" onClick={() => setModalOpen(false)}>{t('common.cancel')}</Button>
            <Button loading={createMutation.isPending} onClick={handleSubmit(d => createMutation.mutate(d))}>{t('common.save')}</Button>
          </>
        }
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <SearchableSelect label={t('fuel.vehicleRequired')} options={vehicles} value={selectedVehicleId || ''}
              onChange={v => {
                setValue('vehicleId', v, { shouldValidate: true })
                const veh = vehicles.find((x: any) => x.value === v)
                if (veh?.fuelType) setValue('fuelType', veh.fuelType, { shouldValidate: true })
              }}
              placeholder="Avtomashina qidiring..." error={errors.vehicleId?.message} />
            <input type="hidden" {...register('vehicleId', { required: 'Talab qilinadi' })} />
          </div>
          <div>
            <SearchableSelect label={t('fuel.fuelTypeRequired')} options={fuelOptions} value={watch('fuelType') || ''}
              onChange={v => setValue('fuelType', v, { shouldValidate: true })}
              placeholder="Tur tanlang..." error={errors.fuelType?.message} />
            <input type="hidden" {...register('fuelType', { required: 'Talab qilinadi' })} />
          </div>
          <Input label={`Miqdor (${unit})`} type="number" step="0.01" min={0} error={errors.amountLiters?.message}
            {...register('amountLiters', { required: 'Talab qilinadi', min: { value: 0.1, message: 'Musbat' } })} />
          <div>
            <Input label="Narx (so'm)" type="number" min={0} error={errors.cost?.message}
              {...register('cost', { required: 'Talab qilinadi', min: { value: 1, message: 'Musbat' } })} />
            {currentPriceHint ? (
              parseFloat(selectedAmount || '0') > 0 ? (
                <p className="text-xs text-blue-500 dark:text-blue-400 mt-0.5">
                  ✓ Avtohisob: {currentPriceHint.price.toLocaleString()} × {selectedAmount} {currentPriceHint.unit} = {Math.round(parseFloat(selectedAmount) * currentPriceHint.price).toLocaleString()} so'm
                  <span className="text-gray-400 ml-1">({currentPriceHint.since} dan)</span>
                </p>
              ) : (
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Joriy narx: {currentPriceHint.price.toLocaleString()} so'm/{currentPriceHint.unit} — miqdor kiriting, narx o'zi hisoblanadi
                </p>
              )
            ) : selectedFuelType ? (
              <p className="text-xs text-amber-500 dark:text-amber-400 mt-0.5">
                Bu yoqilg'i turi uchun narx kiritilmagan — "Narxlar" tugmasidan qo'shing
              </p>
            ) : null}
          </div>
          <Input label={t('fuel.odometerLabel')} type="number" min={0} error={errors.odometerReading?.message}
            {...register('odometerReading', { required: 'Talab qilinadi', min: { value: 0, message: 'Musbat' } })} />
          <Input label={t('fuel.dateLabel')} type="datetime-local" error={errors.refuelDate?.message}
            defaultValue={new Date().toISOString().slice(0, 16)}
            {...register('refuelDate', { required: 'Talab qilinadi' })} />
          <SearchableSelect label={t('fuel.supplierLabel')} options={suppliers} value={watch('supplierId') || ''}
            onChange={v => setValue('supplierId', v)} placeholder="Yetkazuvchi qidiring..." />
          <div>
            <label className="text-sm font-medium text-gray-700 dark:text-gray-300">{t('fuel.receiptImage')}</label>
            <div className="mt-1 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg p-4 text-center cursor-pointer hover:border-blue-400 transition-colors"
              onClick={() => document.getElementById('receipt-upload')?.click()}>
              <Upload className="w-6 h-6 text-gray-400 mx-auto mb-1" />
              <p className="text-xs text-gray-500 dark:text-gray-400">{receiptFile ? receiptFile.name : t('fuel.uploadReceipt')}</p>
              <input id="receipt-upload" type="file" accept="image/*" className="hidden" onChange={e => { const f = e.target.files?.[0] || null; if (f && f.size > 5 * 1024 * 1024) { toast.error(t('fuel.imageMaxSize')); return } setReceiptFile(f) }} />
            </div>
          </div>
        </div>
      </Modal>

      {/* Narxlar tarixi modal */}
      <Modal open={priceModalOpen} onClose={() => setPriceModalOpen(false)} title="Yoqilg'i narxlari tarixi" size="lg">
        <div className="space-y-5">
          {/* Yangi narx qo'shish */}
          {hasRole('admin', 'manager') && (
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4 border border-blue-100 dark:border-blue-800">
              <h4 className="text-sm font-semibold text-blue-800 dark:text-blue-300 mb-3">Yangi narx qo'shish</h4>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Yoqilg'i turi</label>
                  <select value={priceForm.fuelType} onChange={e => setPriceForm(f => ({ ...f, fuelType: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                    {Object.entries(FUEL_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </select>
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Narx (so'm/{fuelUnit(priceForm.fuelType)})</label>
                  <input type="number" value={priceForm.pricePerUnit} onChange={e => setPriceForm(f => ({ ...f, pricePerUnit: e.target.value }))}
                    placeholder="5600" min={1}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div>
                  <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Amal qilish sanasi</label>
                  <input type="date" value={priceForm.effectiveFrom} onChange={e => setPriceForm(f => ({ ...f, effectiveFrom: e.target.value }))}
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex flex-col justify-end">
                  <Button loading={addPriceMutation.isPending}
                    disabled={!priceForm.pricePerUnit || parseFloat(priceForm.pricePerUnit) <= 0}
                    onClick={() => addPriceMutation.mutate(priceForm)}>Qo'shish</Button>
                </div>
              </div>
              <div className="mt-2">
                <label className="text-xs text-gray-500 dark:text-gray-400 mb-1 block">Izoh (ixtiyoriy)</label>
                <input type="text" value={priceForm.note} onChange={e => setPriceForm(f => ({ ...f, note: e.target.value }))}
                  placeholder="Masalan: 01.06.2026 dan narx oshdi" maxLength={200}
                  className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          )}
          {/* Tarix jadvali */}
          <div>
            <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">Narxlar tarixi</h4>
            {!priceHistoryData || priceHistoryData.length === 0 ? (
              <p className="text-sm text-gray-400 text-center py-6">Hech qanday narx kiritilmagan</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 text-gray-500">
                      <th className="text-left px-4 py-2 font-medium">Yoqilg'i turi</th>
                      <th className="text-right px-3 py-2 font-medium">Narx</th>
                      <th className="text-right px-3 py-2 font-medium">Amal qilgan sanadan</th>
                      <th className="text-left px-3 py-2 font-medium">Izoh</th>
                      {hasRole('admin') && <th className="px-3 py-2" />}
                    </tr>
                  </thead>
                  <tbody>
                    {priceHistoryData.map((p: PriceEntry) => (
                      <tr key={p.id} className="border-b border-gray-50 dark:border-gray-700/50">
                        <td className="px-4 py-2">
                          <Badge variant={fuelColors[p.fuelType]}>{FUEL_TYPES[p.fuelType] || p.fuelType}</Badge>
                        </td>
                        <td className="text-right px-3 py-2 font-semibold text-gray-800 dark:text-gray-200">
                          {Number(p.pricePerUnit).toLocaleString()} so'm/{fuelUnit(p.fuelType)}
                        </td>
                        <td className="text-right px-3 py-2 text-gray-500">
                          {p.effectiveFrom.slice(0, 10)}
                        </td>
                        <td className="px-3 py-2 text-gray-400 text-xs">{p.note || '—'}</td>
                        {hasRole('admin') && (
                          <td className="px-3 py-2">
                            <button onClick={() => deletePriceMutation.mutate(p.id)}
                              className="text-red-400 hover:text-red-600 p-1 rounded">
                              <X className="w-3.5 h-3.5" />
                            </button>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </Modal>

      <ConfirmDialog
        open={!!deleteConfirmId}
        title={t('fuel.deleteTitle')}
        message={t('fuel.deleteMessage')}
        confirmLabel={t('common.confirmDelete')}
        loading={deleteMutation.isPending}
        onConfirm={() => { deleteMutation.mutate(deleteConfirmId!); setDeleteConfirmId(null) }}
        onCancel={() => setDeleteConfirmId(null)}
      />
    </div>
  )
}
