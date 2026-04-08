import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { TrendingUp, Fuel, Wrench, Package, Building2, BarChart3, Calendar, Download, Save, BookOpen, Trash2, FileSpreadsheet, Car, User, ChevronDown } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell } from 'recharts'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatCurrency } from '../lib/utils'
import { Card, CardHeader, CardBody } from '../components/ui/Card'
import Table from '../components/ui/Table'
import Button from '../components/ui/Button'
import Modal from '../components/ui/Modal'
import Input from '../components/ui/Input'
import { useAuthStore } from '../stores/authStore'

type ReportType = 'vehicles' | 'expenses' | 'fuel' | 'maintenance' | 'inventory' | 'branch'
type MainTab = 'live' | 'saved' | 'vehicle-detail'

const COLORS = ['#3B82F6', '#10B981', '#F59E0B', '#EF4444', '#8B5CF6', '#EC4899']

const tabs: { key: ReportType; label: string; icon: React.ReactNode }[] = [
  { key: 'vehicles', label: 'Avtomashinalari', icon: <TrendingUp className="w-4 h-4" /> },
  { key: 'expenses', label: 'Xarajatlar', icon: <BarChart3 className="w-4 h-4" /> },
  { key: 'fuel', label: "Yonilg'i", icon: <Fuel className="w-4 h-4" /> },
  { key: 'maintenance', label: "Ta'mir", icon: <Wrench className="w-4 h-4" /> },
  { key: 'inventory', label: 'Ombor', icon: <Package className="w-4 h-4" /> },
  { key: 'branch', label: 'Filiallar', icon: <Building2 className="w-4 h-4" /> },
]

const EXPORT_ENDPOINT: Record<ReportType, string> = {
  vehicles: 'vehicles',
  expenses: 'expenses',
  fuel: 'fuel-records',
  maintenance: 'maintenance',
  inventory: 'inventory',
  branch: 'branches',
}

export default function Reports() {
  const qc = useQueryClient()
  const { isAdmin, isManager } = useAuthStore()
  const [mainTab, setMainTab] = useState<MainTab>('live')
  const [activeTab, setActiveTab] = useState<ReportType>('vehicles')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [saveModal, setSaveModal] = useState(false)
  const [reportName, setReportName] = useState('')
  const [exportingFull, setExportingFull] = useState(false)
  const [exporting1C, setExporting1C] = useState(false)
  const [exportingSheet, setExportingSheet] = useState(false)

  // Vehicle detail tab state
  const [selectedVehicleId, setSelectedVehicleId] = useState('')
  const [vdFrom, setVdFrom] = useState('')
  const [vdTo, setVdTo] = useState('')
  const [exportingVehicle, setExportingVehicle] = useState(false)

  const { data, isLoading } = useQuery({
    queryKey: ['report', activeTab, from, to],
    queryFn: () => api.get(`/reports/${activeTab}`, { params: { from: from || undefined, to: to || undefined } }).then(r => r.data.data),
    enabled: mainTab === 'live',
  })

  const { data: savedReports, isLoading: savedLoading } = useQuery({
    queryKey: ['saved-reports'],
    queryFn: () => api.get('/saved-reports').then(r => r.data.data),
    enabled: mainTab === 'saved',
  })

  // Fetch all vehicles for dropdown
  const { data: allVehicles } = useQuery({
    queryKey: ['vehicles-list'],
    queryFn: () => api.get('/vehicles', { params: { limit: 200 } }).then(r => r.data.data),
    enabled: mainTab === 'vehicle-detail',
  })

  // Fetch vehicle detail report
  const { data: vehicleDetail, isLoading: vdLoading } = useQuery({
    queryKey: ['vehicle-detail-report', selectedVehicleId, vdFrom, vdTo],
    queryFn: () => api.get(`/reports/vehicle/${selectedVehicleId}`, {
      params: { from: vdFrom || undefined, to: vdTo || undefined }
    }).then(r => r.data.data),
    enabled: mainTab === 'vehicle-detail' && !!selectedVehicleId,
  })

  const saveReportMutation = useMutation({
    mutationFn: (name: string) => api.post('/saved-reports', {
      name,
      type: activeTab,
      filters: { from: from || null, to: to || null },
      data,
    }),
    onSuccess: () => {
      toast.success('Hisobot saqlandi')
      qc.invalidateQueries({ queryKey: ['saved-reports'] })
      setSaveModal(false); setReportName('')
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteReportMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/saved-reports/${id}`),
    onSuccess: () => { toast.success("O'chirildi"); qc.invalidateQueries({ queryKey: ['saved-reports'] }) },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleExportSheet = async () => {
    setExportingSheet(true)
    try {
      const endpoint = EXPORT_ENDPOINT[activeTab]
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const response = await api.get(`/exports/${endpoint}?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${activeTab}-hisobot-${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export xatosi')
    } finally {
      setExportingSheet(false)
    }
  }

  const handleFullExport = async () => {
    setExportingFull(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const response = await api.get(`/exports/full-report?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `full-report-${new Date().toISOString().split('T')[0]}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export xatosi')
    } finally {
      setExportingFull(false)
    }
  }

  const handle1CExport = async () => {
    setExporting1C(true)
    try {
      const params = new URLSearchParams()
      if (from) params.set('from', from)
      if (to) params.set('to', to)
      const response = await api.get(`/exports/1c-report?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `1C-export-${new Date().toISOString().split('T')[0]}.csv`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('1C export xatosi')
    } finally {
      setExporting1C(false)
    }
  }

  const handleVehicleExport = async () => {
    if (!selectedVehicleId) return
    setExportingVehicle(true)
    try {
      const params = new URLSearchParams()
      if (vdFrom) params.set('from', vdFrom)
      if (vdTo) params.set('to', vdTo)
      const response = await api.get(`/exports/vehicle-report/${selectedVehicleId}?${params}`, { responseType: 'blob' })
      const url = URL.createObjectURL(response.data)
      const a = document.createElement('a')
      a.href = url
      const veh = vehicleDetail?.vehicle
      a.download = veh ? `${veh.registrationNumber}-hisobot-${new Date().toISOString().split('T')[0]}.xlsx` : 'vehicle-report.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export xatosi')
    } finally {
      setExportingVehicle(false)
    }
  }

  const vehicleColumns = [
    { key: 'registrationNumber', title: 'Raqam', render: (r: any) => <span className="font-mono font-medium">{r.registrationNumber}</span> },
    { key: 'model', title: 'Model', render: (r: any) => `${r.brand} ${r.model}` },
    { key: 'branch', title: 'Filial' },
    { key: 'totalFuelCost', title: "Yonilg'i", render: (r: any) => formatCurrency(r.totalFuelCost) },
    { key: 'totalMaintenanceCost', title: "Ta'mir", render: (r: any) => formatCurrency(r.totalMaintenanceCost) },
    { key: 'total', title: 'Jami', render: (r: any) => <span className="font-bold text-blue-600">{formatCurrency(r.totalExpenses + r.totalFuelCost)}</span> },
    { key: 'mileage', title: 'Masofa', render: (r: any) => `${Number(r.mileage).toLocaleString()} km` },
  ]

  const branchColumns = [
    { key: 'name', title: 'Filial', render: (r: any) => <span className="font-medium">{r.name}</span> },
    { key: 'location', title: 'Joylashuv' },
    { key: 'vehicles', title: 'Avto', render: (r: any) => `${r.activeVehicles}/${r.totalVehicles}` },
    { key: 'inventoryValue', title: 'Ombor', render: (r: any) => formatCurrency(r.inventoryValue) },
    { key: 'totalExpenses', title: 'Xarajat', render: (r: any) => formatCurrency(r.totalExpenses) },
    { key: 'totalFuelCost', title: "Yonilg'i", render: (r: any) => formatCurrency(r.totalFuelCost) },
  ]

  const savedColumns = [
    { key: 'name', title: 'Nomi', render: (r: any) => <span className="font-medium">{r.name}</span> },
    { key: 'type', title: 'Tur', render: (r: any) => <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded">{r.type}</span> },
    { key: 'createdAt', title: 'Saqlangan', render: (r: any) => new Date(r.createdAt).toLocaleDateString('uz-UZ') },
    {
      key: 'actions', title: '', render: (r: any) => (
        <Button size="sm" variant="ghost" icon={<Trash2 className="w-4 h-4 text-red-500" />}
          onClick={() => deleteReportMutation.mutate(r.id)} />
      )
    },
  ]

  const renderPieChart = (obj: Record<string, any>, valueKey?: string) => {
    const entries = Object.entries(obj || {})
    if (!entries.length) return null
    const pieData = entries.map(([name, val]) => ({ name, value: valueKey ? val[valueKey] : Number(val) }))
    return (
      <div className="flex flex-wrap items-center gap-6">
        <div className="w-40 h-40 flex-shrink-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie data={pieData} dataKey="value" cx="50%" cy="50%" outerRadius={60}>
                {pieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-1.5">
          {pieData.map((item, i) => (
            <div key={item.name} className="flex items-center gap-2 text-sm">
              <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
              <span className="text-gray-600 dark:text-gray-400">{item.name}:</span>
              <span className="font-semibold">{formatCurrency(Number(item.value))}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const renderContent = () => {
    if (isLoading) return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
    if (!data) return null

    if (activeTab === 'vehicles') {
      const rows: any[] = Array.isArray(data) ? data : []
      const totalAll = rows.reduce((s, r) => s + r.totalExpenses + r.totalFuelCost, 0)
      const totalFuel = rows.reduce((s, r) => s + r.totalFuelCost, 0)
      const totalMaint = rows.reduce((s, r) => s + r.totalMaintenanceCost, 0)
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4"><p className="text-sm text-blue-600 dark:text-blue-400">Jami xarajat</p><p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(totalAll)}</p></div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4"><p className="text-sm text-green-600 dark:text-green-400">Yonilg'i</p><p className="text-2xl font-bold text-green-900 dark:text-green-100">{formatCurrency(totalFuel)}</p></div>
            <div className="bg-yellow-50 dark:bg-yellow-900/20 rounded-xl p-4"><p className="text-sm text-yellow-600 dark:text-yellow-400">Ta'mir</p><p className="text-2xl font-bold text-yellow-900 dark:text-yellow-100">{formatCurrency(totalMaint)}</p></div>
          </div>
          {rows.length > 0 && (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={rows.slice(0, 10)} margin={{ top: 5, right: 5, bottom: 25, left: 5 }}>
                  <XAxis dataKey="registrationNumber" tick={{ fontSize: 11 }} angle={-40} textAnchor="end" />
                  <YAxis tick={{ fontSize: 11 }} tickFormatter={v => `${(v / 1_000_000).toFixed(0)}M`} />
                  <Tooltip formatter={(v: any) => formatCurrency(Number(v))} />
                  <Bar dataKey="totalFuelCost" name="Yonilg'i" fill="#3B82F6" stackId="a" />
                  <Bar dataKey="totalMaintenanceCost" name="Ta'mir" fill="#10B981" stackId="a" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
          <Table columns={vehicleColumns} data={rows} />
        </div>
      )
    }

    if (activeTab === 'expenses') {
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4"><p className="text-sm text-blue-600 dark:text-blue-400">Jami</p><p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(data.total || 0)}</p></div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4"><p className="text-sm text-gray-500 dark:text-gray-400">Yozuvlar</p><p className="text-xl font-bold text-gray-900 dark:text-white">{data.count || 0}</p></div>
          </div>
          {data.byCategory && renderPieChart(data.byCategory)}
        </div>
      )
    }

    if (activeTab === 'fuel') {
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4"><p className="text-sm text-blue-600 dark:text-blue-400">Jami xarajat</p><p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(data.totalCost || 0)}</p></div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4"><p className="text-sm text-green-600 dark:text-green-400">Jami litrlar</p><p className="text-2xl font-bold text-green-900 dark:text-green-100">{Number(data.totalLiters || 0).toFixed(1)} L</p></div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4"><p className="text-sm text-gray-500 dark:text-gray-400">Yozuvlar</p><p className="text-xl font-bold text-gray-900 dark:text-white">{data.count || 0}</p></div>
          </div>
          {data.byFuelType && renderPieChart(data.byFuelType, 'cost')}
        </div>
      )
    }

    if (activeTab === 'maintenance') {
      return (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4"><p className="text-sm text-blue-600 dark:text-blue-400">Jami xarajat</p><p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(data.totalCost || 0)}</p></div>
            <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4"><p className="text-sm text-gray-500 dark:text-gray-400">Yozuvlar</p><p className="text-xl font-bold text-gray-900 dark:text-white">{data.count || 0}</p></div>
          </div>
          {data.byCategory && renderPieChart(data.byCategory)}
        </div>
      )
    }

    if (activeTab === 'inventory') {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4"><p className="text-sm text-blue-600 dark:text-blue-400">Jami qiymat</p><p className="text-2xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(data.totalValue || 0)}</p></div>
          <div className="bg-gray-50 dark:bg-gray-700 rounded-xl p-4"><p className="text-sm text-gray-500 dark:text-gray-400">Jami qismlar</p><p className="text-xl font-bold text-gray-900 dark:text-white">{data.totalItems || 0}</p></div>
          <div className="bg-red-50 dark:bg-red-900/20 rounded-xl p-4"><p className="text-sm text-red-600 dark:text-red-400">Kam qolganlar</p><p className="text-xl font-bold text-red-900 dark:text-red-100">{data.lowStockCount || 0}</p></div>
        </div>
      )
    }

    if (activeTab === 'branch') {
      return <Table columns={branchColumns} data={Array.isArray(data) ? data : []} />
    }

    return null
  }

  const renderVehicleDetail = () => {
    if (!selectedVehicleId) {
      return (
        <div className="text-center py-16 text-gray-400">
          <Car className="w-12 h-12 mx-auto mb-3 opacity-30" />
          <p className="font-medium text-gray-500">Avtomobil tanlang</p>
          <p className="text-sm mt-1">Yuqoridagi ro'yxatdan mashina tanlang</p>
        </div>
      )
    }
    if (vdLoading) return (
      <div className="flex justify-center py-16">
        <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    )
    if (!vehicleDetail) return null

    const { vehicle, summary, byWorker, byPart, maintenance, fuelRecords, expenses } = vehicleDetail

    const maintenanceCols = [
      { key: 'installationDate', title: 'Sana', render: (r: any) => new Date(r.installationDate).toLocaleDateString('uz-UZ') },
      { key: 'sparePart', title: 'Ehtiyot qism', render: (r: any) => r.sparePart?.name },
      { key: 'articleCode', title: 'Artikul', render: (r: any) => <span className="font-mono text-xs text-gray-500">{r.sparePart?.articleCode?.code || '—'}</span> },
      { key: 'category', title: 'Kategoriya', render: (r: any) => r.sparePart?.category },
      { key: 'quantityUsed', title: 'Miqdor' },
      { key: 'performedBy', title: 'Usta', render: (r: any) => r.performedBy?.fullName },
      { key: 'supplier', title: 'Yetkazuvchi', render: (r: any) => r.supplier?.name || '—' },
      { key: 'cost', title: 'Narx', render: (r: any) => <span className="font-semibold">{formatCurrency(Number(r.cost))}</span> },
    ]

    const fuelCols = [
      { key: 'refuelDate', title: 'Sana', render: (r: any) => new Date(r.refuelDate).toLocaleDateString('uz-UZ') },
      { key: 'fuelType', title: "Yoqilg'i turi" },
      { key: 'amountLiters', title: 'Litr', render: (r: any) => `${Number(r.amountLiters).toFixed(1)} L` },
      { key: 'pricePerLiter', title: 'Narx/litr', render: (r: any) => formatCurrency(Number(r.pricePerLiter)) },
      { key: 'cost', title: 'Jami', render: (r: any) => <span className="font-semibold">{formatCurrency(Number(r.cost))}</span> },
      { key: 'supplier', title: 'Yetkazuvchi', render: (r: any) => r.supplier?.name || '—' },
      { key: 'createdBy', title: 'Kim kiritdi', render: (r: any) => r.createdBy?.fullName },
    ]

    const expensesCols = [
      { key: 'expenseDate', title: 'Sana', render: (r: any) => new Date(r.expenseDate).toLocaleDateString('uz-UZ') },
      { key: 'category', title: 'Kategoriya', render: (r: any) => r.category?.name },
      { key: 'description', title: 'Izoh' },
      { key: 'amount', title: 'Summa', render: (r: any) => <span className="font-semibold">{formatCurrency(Number(r.amount))}</span> },
      { key: 'createdBy', title: 'Kim kiritdi', render: (r: any) => r.createdBy?.fullName },
    ]

    const workerCols = [
      { key: 'name', title: 'Usta nomi', render: (r: any) => <span className="font-medium flex items-center gap-2"><User className="w-4 h-4 text-blue-400" />{r.name}</span> },
      { key: 'count', title: 'Ishlar soni' },
      { key: 'totalCost', title: 'Jami to\'lov', render: (r: any) => <span className="font-bold text-green-600">{formatCurrency(r.totalCost)}</span> },
    ]

    const partCols = [
      { key: 'name', title: 'Ehtiyot qism' },
      { key: 'articleCode', title: 'Artikul', render: (r: any) => <span className="font-mono text-xs text-gray-500">{r.articleCode || '—'}</span> },
      { key: 'category', title: 'Kategoriya' },
      { key: 'count', title: 'Soni' },
      { key: 'totalCost', title: 'Jami', render: (r: any) => <span className="font-bold">{formatCurrency(r.totalCost)}</span> },
    ]

    return (
      <div className="space-y-6">
        {/* Vehicle info card */}
        <div className="bg-gradient-to-r from-blue-600 to-blue-700 rounded-xl p-5 text-white">
          <div className="flex items-start justify-between gap-4 flex-wrap">
            <div>
              <p className="text-blue-200 text-sm">Avtomobil</p>
              <h2 className="text-2xl font-bold">{vehicle.brand} {vehicle.model}</h2>
              <p className="font-mono text-lg mt-0.5">{vehicle.registrationNumber}</p>
              <p className="text-blue-200 text-sm mt-1">{vehicle.branch?.name} • {vehicle.year} yil • {Number(vehicle.mileage).toLocaleString()} km</p>
            </div>
            <span className={`px-3 py-1 rounded-full text-sm font-medium ${vehicle.status === 'active' ? 'bg-green-500' : 'bg-gray-400'}`}>
              {vehicle.status === 'active' ? 'Faol' : vehicle.status}
            </span>
          </div>
        </div>

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-4">
            <p className="text-sm text-blue-600 dark:text-blue-400">Ta'mirlash</p>
            <p className="text-xl font-bold text-blue-900 dark:text-blue-100">{formatCurrency(summary.totalMaintenance)}</p>
            <p className="text-xs text-blue-400">{summary.maintenanceCount} ta</p>
          </div>
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl p-4">
            <p className="text-sm text-green-600 dark:text-green-400">Yoqilg'i</p>
            <p className="text-xl font-bold text-green-900 dark:text-green-100">{formatCurrency(summary.totalFuel)}</p>
            <p className="text-xs text-green-400">{summary.fuelCount} ta</p>
          </div>
          <div className="bg-orange-50 dark:bg-orange-900/20 rounded-xl p-4">
            <p className="text-sm text-orange-600 dark:text-orange-400">Boshqa xarajat</p>
            <p className="text-xl font-bold text-orange-900 dark:text-orange-100">{formatCurrency(summary.totalExpenses)}</p>
          </div>
          <div className="bg-gray-100 dark:bg-gray-700 rounded-xl p-4">
            <p className="text-sm text-gray-500 dark:text-gray-400">Jami</p>
            <p className="text-xl font-bold text-gray-900 dark:text-white">{formatCurrency(summary.grandTotal)}</p>
          </div>
        </div>

        {/* Workers table */}
        {byWorker?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <User className="w-4 h-4 text-blue-500" /> Ustalar bo'yicha to'lovlar
            </h3>
            <Table columns={workerCols} data={byWorker} />
          </div>
        )}

        {/* Parts table */}
        {byPart?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <Package className="w-4 h-4 text-purple-500" /> Ehtiyot qismlar
            </h3>
            <Table columns={partCols} data={byPart} />
          </div>
        )}

        {/* Maintenance records */}
        {maintenance?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <Wrench className="w-4 h-4 text-yellow-500" /> Ta'mirlash yozuvlari
            </h3>
            <Table columns={maintenanceCols} data={maintenance} />
          </div>
        )}

        {/* Fuel records */}
        {fuelRecords?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <Fuel className="w-4 h-4 text-green-500" /> Yoqilg'i yozuvlari
            </h3>
            <Table columns={fuelCols} data={fuelRecords} />
          </div>
        )}

        {/* Other expenses */}
        {expenses?.length > 0 && (
          <div>
            <h3 className="text-base font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-orange-500" /> Boshqa xarajatlar
            </h3>
            <Table columns={expensesCols} data={expenses} />
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Hisobotlar</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm">Tahlil va statistika</p>
        </div>
        {(isAdmin() || isManager()) && mainTab === 'live' && (
          <div className="flex items-center gap-2">
            <Button variant="outline" icon={<FileSpreadsheet className="w-4 h-4 text-green-600" />}
              loading={exportingFull} onClick={handleFullExport}>
              To'liq Excel (6 varaq)
            </Button>
            <Button variant="outline" icon={<Download className="w-4 h-4 text-orange-500" />}
              loading={exporting1C} onClick={handle1CExport}>
              1C Export
            </Button>
          </div>
        )}
        {mainTab === 'vehicle-detail' && selectedVehicleId && (
          <Button variant="outline" icon={<FileSpreadsheet className="w-4 h-4 text-green-600" />}
            loading={exportingVehicle} onClick={handleVehicleExport}>
            Excel yuklab olish
          </Button>
        )}
      </div>

      {/* Main tabs: Live / Saved / Vehicle detail */}
      <div className="flex gap-2">
        {([
          { key: 'live' as MainTab, label: 'Jonli hisobot', icon: <BarChart3 className="w-4 h-4" /> },
          { key: 'saved' as MainTab, label: 'Saqlangan', icon: <BookOpen className="w-4 h-4" /> },
          { key: 'vehicle-detail' as MainTab, label: "Mashina bo'yicha", icon: <Car className="w-4 h-4" /> },
        ]).map(t => (
          <button key={t.key} onClick={() => setMainTab(t.key)}
            className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors whitespace-nowrap ${mainTab === t.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
            {t.icon}{t.label}
          </button>
        ))}
      </div>

      {/* Saved reports library */}
      {mainTab === 'saved' && (
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm">
          <div className="p-4 border-b border-gray-100 dark:border-gray-700">
            <h3 className="font-semibold text-gray-800 dark:text-white">Saqlangan hisobotlar</h3>
          </div>
          {savedLoading ? (
            <div className="flex justify-center py-12">
              <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : !savedReports?.length ? (
            <div className="text-center py-12 text-gray-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p className="font-medium">Hali saqlangan hisobotlar yo'q</p>
              <p className="text-sm mt-1">Jonli hisobotni ko'rib, "Saqlash" tugmasini bosing</p>
            </div>
          ) : (
            <Table columns={savedColumns} data={savedReports} loading={savedLoading} />
          )}
        </div>
      )}

      {/* Vehicle detail tab */}
      {mainTab === 'vehicle-detail' && (
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center gap-3">
              {/* Vehicle selector */}
              <div className="relative flex-1 min-w-[200px] max-w-xs">
                <select
                  value={selectedVehicleId}
                  onChange={e => setSelectedVehicleId(e.target.value)}
                  className="w-full appearance-none pl-3 pr-8 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">— Avtomobil tanlang —</option>
                  {(allVehicles || []).map((v: any) => (
                    <option key={v.id} value={v.id}>{v.registrationNumber} — {v.brand} {v.model}</option>
                  ))}
                </select>
                <ChevronDown className="absolute right-2 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
              </div>
              {/* Date range */}
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-gray-400" />
                <input type="date" value={vdFrom} onChange={e => setVdFrom(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                <span className="text-gray-400">—</span>
                <input type="date" value={vdTo} onChange={e => setVdTo(e.target.value)}
                  className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
            </div>
          </CardHeader>
          <CardBody>{renderVehicleDetail()}</CardBody>
        </Card>
      )}

      {/* Live report */}
      {mainTab === 'live' && (
        <>
          <div className="flex flex-wrap gap-2">
            {tabs.map(tab => (
              <button key={tab.key} onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${activeTab === tab.key ? 'bg-blue-600 text-white' : 'bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50'}`}>
                {tab.icon}{tab.label}
              </button>
            ))}
          </div>

          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Calendar className="w-4 h-4 text-gray-400" />
                  <input type="date" value={from} onChange={e => setFrom(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  <span className="text-gray-400">—</span>
                  <input type="date" value={to} onChange={e => setTo(e.target.value)}
                    className="px-3 py-1.5 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500" />
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" icon={<Download className="w-3.5 h-3.5" />} loading={exportingSheet} onClick={handleExportSheet}>
                    Excel
                  </Button>
                  {data && (
                    <Button size="sm" variant="outline" icon={<Save className="w-3.5 h-3.5" />}
                      onClick={() => setSaveModal(true)}>
                      Saqlash
                    </Button>
                  )}
                </div>
              </div>
            </CardHeader>
            <CardBody>{renderContent()}</CardBody>
          </Card>
        </>
      )}

      {/* Save Report Modal */}
      <Modal open={saveModal} onClose={() => setSaveModal(false)} title="Hisobotni saqlash" size="sm"
        footer={
          <>
            <Button variant="outline" onClick={() => setSaveModal(false)}>Bekor qilish</Button>
            <Button loading={saveReportMutation.isPending}
              onClick={() => reportName.trim() && saveReportMutation.mutate(reportName.trim())}>
              Saqlash
            </Button>
          </>
        }
      >
        <Input label="Hisobot nomi *" placeholder="Masalan: 2025-yil 1-chorak yoqilg'i"
          value={reportName} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setReportName(e.target.value)} />
      </Modal>
    </div>
  )
}
