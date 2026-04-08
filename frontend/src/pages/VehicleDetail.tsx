import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { ArrowLeft, Truck, Fuel, Wrench, DollarSign, Calendar, MapPin, Gauge, Download } from 'lucide-react'
import api from '../lib/api'
import { formatCurrency, formatDate, FUEL_TYPES, VEHICLE_STATUS } from '../lib/utils'
import Badge from '../components/ui/Badge'
import ExcelExportButton from '../components/ui/ExcelExportButton'

const statusColors: Record<string, any> = { active: 'success', maintenance: 'warning', inactive: 'danger' }
const fuelColors: Record<string, any> = { petrol: 'info', diesel: 'warning', gas: 'success', electric: 'default' }

type Tab = 'maintenance' | 'fuel' | 'expenses'

export default function VehicleDetail() {
  const { id } = useParams<{ id: string }>()
  const [tab, setTab] = useState<Tab>('maintenance')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['vehicle-detail', id, from, to],
    queryFn: () => api.get(`/reports/vehicle/${id}`, { params: { from: from || undefined, to: to || undefined } }).then(r => r.data.data),
    enabled: !!id,
  })

  if (isLoading) return (
    <div className="flex items-center justify-center h-64">
      <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (!data) return (
    <div className="text-center py-20 text-gray-400">Avtomobil topilmadi</div>
  )

  const { vehicle, summary, maintenance, fuelRecords, expenses, byPart } = data

  const tabs = [
    { key: 'maintenance' as Tab, label: `Ta'mirlash (${maintenance?.length || 0})`, icon: <Wrench className="w-4 h-4" /> },
    { key: 'fuel' as Tab, label: `Yoqilg'i (${fuelRecords?.length || 0})`, icon: <Fuel className="w-4 h-4" /> },
    { key: 'expenses' as Tab, label: `Xarajatlar (${expenses?.length || 0})`, icon: <DollarSign className="w-4 h-4" /> },
  ]

  return (
    <div className="space-y-5">
      {/* Breadcrumb */}
      <div className="flex items-center gap-2">
        <Link to="/vehicles" className="flex items-center gap-1.5 text-sm text-gray-500 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors">
          <ArrowLeft className="w-4 h-4" />
          Avtomashinalari
        </Link>
        <span className="text-gray-300 dark:text-gray-600">/</span>
        <span className="text-sm font-medium text-gray-900 dark:text-white">{vehicle.registrationNumber}</span>
      </div>

      {/* Vehicle Header */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm p-5">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center flex-shrink-0">
              <Truck className="w-6 h-6 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl font-bold text-gray-900 dark:text-white font-mono">{vehicle.registrationNumber}</h1>
                <Badge variant={statusColors[vehicle.status]}>{VEHICLE_STATUS[vehicle.status]}</Badge>
                <Badge variant={fuelColors[vehicle.fuelType]}>{FUEL_TYPES[vehicle.fuelType]}</Badge>
              </div>
              <p className="text-gray-600 dark:text-gray-300 mt-0.5">{vehicle.brand} {vehicle.model} · {vehicle.year}</p>
              <div className="flex items-center gap-4 mt-2 text-sm text-gray-500 dark:text-gray-400 flex-wrap">
                <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{vehicle.branch?.name}</span>
                <span className="flex items-center gap-1"><Gauge className="w-3.5 h-3.5" />{Number(vehicle.mileage).toLocaleString()} km</span>
              </div>
            </div>
          </div>
          <ExcelExportButton
            endpoint={`/exports/vehicles/${id}`}
            filename={`${vehicle.registrationNumber}-hisobot.xlsx`}
            label="Excel"
            size="sm"
          />
        </div>
      </div>

      {/* Summary KPI cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Wrench className="w-4 h-4 text-blue-500" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Ta'mirlash</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(summary?.totalMaintenance || 0)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{summary?.maintenanceCount || 0} ta yozuv</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <Fuel className="w-4 h-4 text-yellow-500" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Yoqilg'i</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(summary?.totalFuel || 0)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{summary?.fuelCount || 0} ta to'ldirish</p>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="w-4 h-4 text-green-500" />
            <p className="text-xs text-gray-500 dark:text-gray-400">Boshqa xarajat</p>
          </div>
          <p className="text-lg font-bold text-gray-900 dark:text-white">{formatCurrency(summary?.totalExpenses || 0)}</p>
          <p className="text-xs text-gray-400 mt-0.5">{expenses?.length || 0} ta yozuv</p>
        </div>
        <div className="bg-gradient-to-br from-blue-600 to-blue-700 rounded-xl p-4">
          <p className="text-xs text-blue-200 mb-1">Jami xarajat</p>
          <p className="text-lg font-bold text-white">{formatCurrency(summary?.grandTotal || 0)}</p>
          <p className="text-xs text-blue-300 mt-0.5">Barcha vaqt</p>
        </div>
      </div>

      {/* Date filter */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <Calendar className="w-4 h-4 text-gray-400" />
          <span className="text-sm text-gray-600 dark:text-gray-400">Davr:</span>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          <span className="text-gray-400">—</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)}
            className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {(from || to) && (
            <button onClick={() => { setFrom(''); setTo('') }}
              className="text-xs text-red-500 hover:text-red-700 px-2 py-1 rounded">
              Tozalash
            </button>
          )}
        </div>
      </div>

      {/* Top used parts */}
      {byPart && byPart.length > 0 && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-900 dark:text-white text-sm">Ko'p ishlatiladigan ehtiyot qismlar</h3>
          </div>
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {byPart.slice(0, 5).map((p: any) => (
              <div key={p.name} className="px-5 py-2.5 flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900 dark:text-white">{p.name}</p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">{p.category} · {p.count} ta ishlatilgan</p>
                </div>
                <span className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(p.totalCost)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
        <div className="flex border-b border-gray-200 dark:border-gray-700 overflow-x-auto">
          {tabs.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)}
              className={`flex items-center gap-2 px-5 py-3.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                ${tab === t.key
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'}`}>
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Maintenance tab */}
        {tab === 'maintenance' && (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(maintenance || []).length === 0
              ? <p className="py-10 text-center text-gray-400 text-sm">Ta'mirlash yozuvlari yo'q</p>
              : (maintenance || []).map((m: any) => (
                <div key={m.id} className="px-5 py-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{m.sparePart?.name}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {m.sparePart?.category} · {m.quantityUsed} ta · {m.performedBy?.fullName}
                      {m.supplier && ` · ${m.supplier.name}`}
                    </p>
                    {m.notes && <p className="text-xs text-gray-400 italic mt-0.5">{m.notes}</p>}
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(Number(m.cost))}</p>
                    <p className="text-xs text-gray-400">{formatDate(m.installationDate)}</p>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* Fuel tab */}
        {tab === 'fuel' && (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(fuelRecords || []).length === 0
              ? <p className="py-10 text-center text-gray-400 text-sm">Yoqilg'i yozuvlari yo'q</p>
              : (fuelRecords || []).map((f: any) => (
                <div key={f.id} className="px-5 py-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">
                      {Number(f.amountLiters).toFixed(1)} litr · {FUEL_TYPES[f.fuelType] || f.fuelType}
                    </p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      Odometr: {Number(f.odometerReading).toLocaleString()} km
                      {f.supplier && ` · ${f.supplier.name}`}
                      {f.createdBy && ` · ${f.createdBy.fullName}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(Number(f.cost))}</p>
                    <p className="text-xs text-gray-400">{formatDate(f.refuelDate)}</p>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* Expenses tab */}
        {tab === 'expenses' && (
          <div className="divide-y divide-gray-50 dark:divide-gray-700">
            {(expenses || []).length === 0
              ? <p className="py-10 text-center text-gray-400 text-sm">Xarajat yozuvlari yo'q</p>
              : (expenses || []).map((e: any) => (
                <div key={e.id} className="px-5 py-3 flex items-start justify-between gap-2">
                  <div>
                    <p className="text-sm font-medium text-gray-900 dark:text-white">{e.description}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                      {e.category?.name}
                      {e.createdBy && ` · ${e.createdBy.fullName}`}
                    </p>
                  </div>
                  <div className="text-right flex-shrink-0">
                    <p className="text-sm font-bold text-gray-900 dark:text-white">{formatCurrency(Number(e.amount))}</p>
                    <p className="text-xs text-gray-400">{formatDate(e.expenseDate)}</p>
                  </div>
                </div>
              ))
            }
          </div>
        )}
      </div>
    </div>
  )
}
