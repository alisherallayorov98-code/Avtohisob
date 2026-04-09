import { useState, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import {
  Upload, FileSpreadsheet, FileImage, FileText, Cpu,
  CheckCircle, AlertTriangle, ChevronLeft, ChevronRight,
  Pencil, Trash2, Check, X, History, Plus, Car,
} from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { formatDate } from '../lib/utils'
import Button from '../components/ui/Button'
import Badge from '../components/ui/Badge'
import SearchableSelect from '../components/ui/SearchableSelect'

// ─── Types ───────────────────────────────────────────────────────────────────

interface ImportRow {
  id: string
  rowNumber: number
  refuelDate: string | null
  licensePlate: string
  vehicleId: string | null
  vehicle?: { id: string; registrationNumber: string; brand: string; model: string } | null
  waybillNo: string
  quantityM3: number
  pricePerUnit: number
  totalAmount: number
  driverName: string
  driverId: string | null
  matchStatus: string
  fuelRecordId: string | null
}

interface ImportSession {
  id: string
  title: string
  month: number
  year: number
  status: string
  fileType: string
  totalRows: number
  confirmedAt: string | null
  createdAt: string
  rows: ImportRow[]
  page: number
  totalPages: number
  allVehicles: { id: string; registrationNumber: string; brand: string; model: string }[]
}

interface ImportSummary {
  id: string
  title: string
  month: number
  year: number
  status: string
  totalRows: number
  confirmedAt: string | null
  createdAt: string
}

const MONTHS = [
  'Yanvar','Fevral','Mart','Aprel','May','Iyun',
  'Iyul','Avgust','Sentabr','Oktabr','Noyabr','Dekabr',
]

function statusColor(s: string) {
  if (s === 'matched') return 'success'
  if (s === 'manual') return 'info'
  return 'warning'
}
function statusLabel(s: string) {
  if (s === 'matched') return 'Mos'
  if (s === 'manual') return "Qo'lda"
  return 'Topilmadi'
}

function FileTypeIcon({ type }: { type?: string }) {
  if (type === 'excel') return <FileSpreadsheet className="w-4 h-4 text-green-500" />
  if (type === 'pdf') return <FileText className="w-4 h-4 text-red-500" />
  return <FileImage className="w-4 h-4 text-blue-500" />
}

// ─── Editable row component ──────────────────────────────────────────────────

function EditableRow({
  row,
  importId,
  allVehicles,
  confirmed,
  onDeleted,
}: {
  row: ImportRow
  importId: string
  allVehicles: { id: string; registrationNumber: string; brand: string; model: string }[]
  confirmed: boolean
  onDeleted: () => void
}) {
  const qc = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({
    refuelDate: row.refuelDate ? row.refuelDate.slice(0, 10) : '',
    licensePlate: row.licensePlate,
    vehicleId: row.vehicleId || '',
    waybillNo: row.waybillNo,
    quantityM3: String(row.quantityM3),
    pricePerUnit: String(row.pricePerUnit),
    totalAmount: String(row.totalAmount),
    driverName: row.driverName,
  })

  const saveMutation = useMutation({
    mutationFn: () => api.patch(`/fuel-imports/${importId}/rows/${row.id}`, {
      ...form,
      vehicleId: form.vehicleId || null,
      quantityM3: parseFloat(form.quantityM3),
      pricePerUnit: parseFloat(form.pricePerUnit),
      totalAmount: parseFloat(form.totalAmount),
    }),
    onSuccess: () => {
      toast.success('Qator yangilandi')
      qc.invalidateQueries({ queryKey: ['fuel-import', importId] })
      setEditing(false)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/fuel-imports/${importId}/rows/${row.id}`),
    onSuccess: () => {
      toast.success("Qator o'chirildi")
      qc.invalidateQueries({ queryKey: ['fuel-import', importId] })
      onDeleted()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const vehicleOptions = allVehicles.map(v => ({
    value: v.id,
    label: `${v.registrationNumber} — ${v.brand} ${v.model}`,
  }))

  if (editing) {
    return (
      <tr className="bg-blue-50 dark:bg-blue-900/10">
        <td className="px-3 py-2 text-xs text-gray-400">{row.rowNumber}</td>
        <td className="px-3 py-2">
          <input type="date" value={form.refuelDate}
            onChange={e => setForm(f => ({ ...f, refuelDate: e.target.value }))}
            className="w-32 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </td>
        <td className="px-3 py-2" style={{ minWidth: 200 }}>
          <SearchableSelect
            options={vehicleOptions}
            value={form.vehicleId}
            onChange={v => setForm(f => ({ ...f, vehicleId: v }))}
            placeholder="Moshina tanlang..."
          />
        </td>
        <td className="px-3 py-2">
          <input value={form.waybillNo}
            onChange={e => setForm(f => ({ ...f, waybillNo: e.target.value }))}
            className="w-20 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </td>
        <td className="px-3 py-2">
          <input type="number" value={form.quantityM3}
            onChange={e => setForm(f => ({ ...f, quantityM3: e.target.value }))}
            className="w-20 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </td>
        <td className="px-3 py-2">
          <input type="number" value={form.pricePerUnit}
            onChange={e => setForm(f => ({ ...f, pricePerUnit: e.target.value }))}
            className="w-24 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </td>
        <td className="px-3 py-2">
          <input type="number" value={form.totalAmount}
            onChange={e => setForm(f => ({ ...f, totalAmount: e.target.value }))}
            className="w-28 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </td>
        <td className="px-3 py-2">
          <input value={form.driverName}
            onChange={e => setForm(f => ({ ...f, driverName: e.target.value }))}
            className="w-36 text-xs border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </td>
        <td className="px-3 py-2">
          <div className="flex gap-1">
            <button onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}
              className="p-1 rounded bg-green-100 hover:bg-green-200 text-green-700">
              <Check className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => setEditing(false)}
              className="p-1 rounded bg-gray-100 hover:bg-gray-200 text-gray-600">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </td>
      </tr>
    )
  }

  const displayVehicle = row.vehicle
    ? `${row.vehicle.registrationNumber}`
    : row.licensePlate || '—'

  return (
    <tr className="hover:bg-gray-50 dark:hover:bg-gray-700/30 transition-colors">
      <td className="px-3 py-2.5 text-xs text-gray-400">{row.rowNumber}</td>
      <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300">
        {row.refuelDate ? formatDate(row.refuelDate) : '—'}
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1.5">
          <Badge variant={statusColor(row.matchStatus) as any}>
            {statusLabel(row.matchStatus)}
          </Badge>
          <span className="text-xs font-medium text-gray-800 dark:text-gray-200">{displayVehicle}</span>
          {row.vehicle && (
            <span className="text-xs text-gray-400">{row.vehicle.brand} {row.vehicle.model}</span>
          )}
        </div>
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400">{row.waybillNo || '—'}</td>
      <td className="px-3 py-2.5 text-xs font-semibold text-gray-900 dark:text-white">{Number(row.quantityM3).toFixed(1)}</td>
      <td className="px-3 py-2.5 text-xs text-gray-600 dark:text-gray-400">{Number(row.pricePerUnit).toLocaleString()}</td>
      <td className="px-3 py-2.5 text-xs font-semibold text-blue-600 dark:text-blue-400">
        {Number(row.totalAmount).toLocaleString()}
      </td>
      <td className="px-3 py-2.5 text-xs text-gray-700 dark:text-gray-300">{row.driverName || '—'}</td>
      <td className="px-3 py-2.5">
        {!confirmed && (
          <div className="flex gap-1">
            <button onClick={() => setEditing(true)}
              className="p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/20 text-gray-400 hover:text-blue-500">
              <Pencil className="w-3.5 h-3.5" />
            </button>
            <button onClick={() => deleteMutation.mutate()} disabled={deleteMutation.isPending}
              className="p-1 rounded hover:bg-red-50 dark:hover:bg-red-900/20 text-gray-400 hover:text-red-500">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
        {confirmed && row.fuelRecordId && (
          <CheckCircle className="w-4 h-4 text-green-500" />
        )}
      </td>
    </tr>
  )
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function FuelMeter() {
  const qc = useQueryClient()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Upload form state
  const [file, setFile] = useState<File | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const [uploadMonth, setUploadMonth] = useState(String(new Date().getMonth() + 1))
  const [uploadYear, setUploadYear] = useState(String(new Date().getFullYear()))
  const [uploadTitle, setUploadTitle] = useState('')

  // Current view
  const [activeTab, setActiveTab] = useState<'upload' | 'history'>('upload')
  const [currentImportId, setCurrentImportId] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  // Import detail query
  const { data: importData, isLoading: importLoading } = useQuery<ImportSession>({
    queryKey: ['fuel-import', currentImportId, page],
    queryFn: () => api.get(`/fuel-imports/${currentImportId}?page=${page}`).then(r => r.data.data),
    enabled: !!currentImportId,
  })

  // History query
  const { data: history, isLoading: historyLoading } = useQuery<ImportSummary[]>({
    queryKey: ['fuel-imports-list'],
    queryFn: () => api.get('/fuel-imports').then(r => r.data.data),
  })

  // Parse mutation
  const parseMutation = useMutation({
    mutationFn: () => {
      if (!file) throw new Error('Fayl tanlanmadi')
      const fd = new FormData()
      fd.append('file', file)
      fd.append('month', uploadMonth)
      fd.append('year', uploadYear)
      fd.append('title', uploadTitle || `${uploadYear}-${uploadMonth.padStart(2, '0')} vedomost`)
      return api.post('/fuel-imports/parse', fd, { headers: { 'Content-Type': 'multipart/form-data' }, timeout: 120000 })
    },
    onSuccess: (res) => {
      const imp = res.data.data
      toast.success(`${imp.totalRows} ta qator topildi`)
      setCurrentImportId(imp.import.id)
      setPage(1)
      setFile(null)
      qc.invalidateQueries({ queryKey: ['fuel-imports-list'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'AI tahlilida xato'),
  })

  // Confirm mutation
  const confirmMutation = useMutation({
    mutationFn: () => api.post(`/fuel-imports/${currentImportId}/confirm`),
    onSuccess: (res) => {
      toast.success(res.data.message || 'Tasdiqlandi')
      qc.invalidateQueries({ queryKey: ['fuel-import', currentImportId, page] })
      qc.invalidateQueries({ queryKey: ['fuel-imports-list'] })
      qc.invalidateQueries({ queryKey: ['fuel-records'] })
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  // Delete import mutation
  const deleteImportMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/fuel-imports/${id}`),
    onSuccess: () => {
      toast.success("Import o'chirildi")
      qc.invalidateQueries({ queryKey: ['fuel-imports-list'] })
      if (currentImportId) setCurrentImportId(null)
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleFile = (f: File) => setFile(f)

  const fileIcon = () => {
    if (!file) return null
    const ext = file.name.split('.').pop()?.toLowerCase()
    if (ext === 'xlsx' || ext === 'xls') return <FileSpreadsheet className="w-5 h-5 text-green-500" />
    if (ext === 'pdf') return <FileText className="w-5 h-5 text-red-500" />
    return <FileImage className="w-5 h-5 text-blue-500" />
  }

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: 5 }, (_, i) => currentYear - i)

  // ─── Upload view ─────────────────────────────────────────────────────────

  const uploadView = (
    <div className="max-w-2xl mx-auto space-y-5">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-2xl p-10 text-center cursor-pointer transition-all ${
          dragOver
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
            : file
              ? 'border-green-400 bg-green-50/40 dark:bg-green-900/10'
              : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 hover:bg-blue-50/30 dark:hover:bg-blue-900/10'
        }`}
        onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files[0]; if (f) handleFile(f) }}
        onDragOver={e => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onClick={() => fileInputRef.current?.click()}
      >
        {file ? (
          <div className="space-y-2">
            <div className="flex items-center justify-center gap-2">
              {fileIcon()}
              <span className="font-semibold text-gray-800 dark:text-white">{file.name}</span>
            </div>
            <p className="text-sm text-gray-400">{(file.size / 1024 / 1024).toFixed(2)} MB</p>
            <p className="text-xs text-green-600 font-medium">Fayl tayyor — pastdagi tugmani bosing</p>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex justify-center gap-3">
              <FileImage className="w-8 h-8 text-blue-400" />
              <FileText className="w-8 h-8 text-red-400" />
              <FileSpreadsheet className="w-8 h-8 text-green-400" />
            </div>
            <div>
              <p className="font-semibold text-gray-700 dark:text-gray-300 text-lg">Vedomostni yuklang</p>
              <p className="text-sm text-gray-400 mt-1">Sudrab olib tashlang yoki bosing</p>
            </div>
            <div className="flex justify-center gap-2 flex-wrap">
              {['JPG', 'PNG', 'PDF', 'XLSX'].map(t => (
                <span key={t} className="text-xs bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 px-2 py-1 rounded-md">{t}</span>
              ))}
              <span className="text-xs text-gray-400">· max 20MB</span>
            </div>
            <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/20 px-3 py-1.5 rounded-lg inline-block">
              PDF scan bo'lsa → rasmga (JPG/PNG) o'girib yuklang — aniqroq natija
            </p>
          </div>
        )}
        <input ref={fileInputRef} type="file" accept=".jpg,.jpeg,.png,.webp,.pdf,.xlsx,.xls" className="hidden"
          onChange={e => { const f = e.target.files?.[0]; if (f) handleFile(f) }} />
      </div>

      {/* Month/year + title */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Oy</label>
          <select value={uploadMonth} onChange={e => setUploadMonth(e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {MONTHS.map((m, i) => <option key={i} value={String(i + 1)}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Yil</label>
          <select value={uploadYear} onChange={e => setUploadYear(e.target.value)}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {years.map(y => <option key={y} value={String(y)}>{y}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">Sarlavha (ixtiyoriy)</label>
          <input value={uploadTitle} onChange={e => setUploadTitle(e.target.value)}
            placeholder={`${uploadYear}-${uploadMonth.padStart(2, '0')} vedomost`}
            className="w-full text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <Button
          disabled={!file}
          loading={parseMutation.isPending}
          icon={<Cpu className="w-4 h-4" />}
          onClick={() => parseMutation.mutate()}
          size="lg"
          className="flex-1"
        >
          {parseMutation.isPending ? 'AI o\'qimoqda...' : 'AI orqali o\'qish'}
        </Button>
        {file && (
          <Button variant="outline" size="lg" onClick={() => setFile(null)}>
            Bekor
          </Button>
        )}
      </div>
    </div>
  )

  // ─── Import detail view ───────────────────────────────────────────────────

  const importDetail = importData ? (() => {
    const matched = importData.rows.filter(r => r.matchStatus !== 'unmatched').length +
      importData.rows.filter(r => r.matchStatus === 'unmatched' && r.vehicleId).length
    const unmatched = importData.rows.filter(r => !r.vehicleId).length
    const confirmed = importData.status === 'confirmed'
    const totalSum = importData.rows.reduce((acc, r) => acc + Number(r.totalAmount), 0)

    return (
      <div className="space-y-4">
        {/* Header bar */}
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <button onClick={() => setCurrentImportId(null)}
              className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 dark:hover:text-white transition-colors">
              <ChevronLeft className="w-4 h-4" />
              Orqaga
            </button>
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">{importData.title}</h2>
              <p className="text-xs text-gray-400">
                {MONTHS[importData.month - 1]} {importData.year} · {importData.totalRows} ta qator
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {confirmed ? (
              <Badge variant="success">Tasdiqlangan</Badge>
            ) : (
              <>
                <span className="text-sm text-gray-500">
                  {unmatched > 0 && <span className="text-amber-500 font-medium">{unmatched} ta mos kelmadi · </span>}
                  <span className="text-green-600 font-medium">{importData.totalRows - unmatched} ta tayyor</span>
                </span>
                <Button
                  size="sm"
                  icon={<CheckCircle className="w-4 h-4" />}
                  loading={confirmMutation.isPending}
                  onClick={() => confirmMutation.mutate()}
                  disabled={importData.totalRows - unmatched === 0}
                >
                  Tasdiqlash ({importData.totalRows - unmatched})
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Stats bar */}
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-green-50 dark:bg-green-900/20 rounded-xl px-4 py-3">
            <p className="text-xs text-green-600 dark:text-green-400 font-medium">Mos kelgan</p>
            <p className="text-2xl font-bold text-green-700 dark:text-green-300">{importData.totalRows - unmatched}</p>
          </div>
          <div className="bg-amber-50 dark:bg-amber-900/20 rounded-xl px-4 py-3">
            <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">Topilmadi</p>
            <p className="text-2xl font-bold text-amber-700 dark:text-amber-300">{unmatched}</p>
          </div>
          <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl px-4 py-3">
            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium">Jami summa (bu sahifa)</p>
            <p className="text-xl font-bold text-blue-700 dark:text-blue-300">{totalSum.toLocaleString()} so'm</p>
          </div>
        </div>

        {/* Unmatched tip */}
        {!confirmed && unmatched > 0 && (
          <div className="flex items-start gap-2 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl px-4 py-3">
            <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-amber-700 dark:text-amber-300">
              <strong>{unmatched} ta qator</strong> uchun moshina topilmadi.
              Tahrirlash tugmasini bosib qo'lda tanlang yoki o'chiring.
            </p>
          </div>
        )}

        {/* Table */}
        <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800 dark:bg-gray-900 text-white text-xs">
                  <th className="px-3 py-3 text-left font-medium">#</th>
                  <th className="px-3 py-3 text-left font-medium">Sana</th>
                  <th className="px-3 py-3 text-left font-medium">Moshina</th>
                  <th className="px-3 py-3 text-left font-medium">Yo'l var.</th>
                  <th className="px-3 py-3 text-left font-medium">m³</th>
                  <th className="px-3 py-3 text-left font-medium">Narxi</th>
                  <th className="px-3 py-3 text-left font-medium">Jami</th>
                  <th className="px-3 py-3 text-left font-medium">Haydovchi</th>
                  <th className="px-3 py-3 text-left font-medium w-16"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {importLoading ? (
                  <tr><td colSpan={9} className="px-3 py-12 text-center">
                    <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
                  </td></tr>
                ) : importData.rows.map(row => (
                  <EditableRow
                    key={row.id}
                    row={row}
                    importId={importData.id}
                    allVehicles={importData.allVehicles}
                    confirmed={confirmed}
                    onDeleted={() => qc.invalidateQueries({ queryKey: ['fuel-import', importData.id, page] })}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {importData.totalPages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100 dark:border-gray-700 flex items-center justify-between">
              <span className="text-xs text-gray-400">
                {page}-sahifa / {importData.totalPages} ta sahifa · Jami {importData.totalRows} ta qator
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                {Array.from({ length: Math.min(importData.totalPages, 7) }, (_, i) => {
                  let p = i + 1
                  if (importData.totalPages > 7) {
                    if (page <= 4) p = i + 1
                    else if (page >= importData.totalPages - 3) p = importData.totalPages - 6 + i
                    else p = page - 3 + i
                  }
                  return (
                    <button key={p} onClick={() => setPage(p)}
                      className={`w-8 h-8 text-xs rounded-lg transition-colors ${
                        p === page
                          ? 'bg-blue-600 text-white'
                          : 'border border-gray-200 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300'
                      }`}>
                      {p}
                    </button>
                  )
                })}
                <button
                  disabled={page === importData.totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="p-1.5 rounded-lg border border-gray-200 dark:border-gray-600 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    )
  })() : null

  // ─── History view ─────────────────────────────────────────────────────────

  const historyView = (
    <div className="space-y-3">
      {historyLoading ? (
        <div className="py-12 text-center">
          <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      ) : (history || []).length === 0 ? (
        <div className="py-16 text-center">
          <Car className="w-12 h-12 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-400">Hali import qilinmagan</p>
        </div>
      ) : (history || []).map(imp => (
        <div key={imp.id}
          className="flex items-center justify-between bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl px-4 py-3 hover:shadow-sm transition-shadow">
          <div className="flex items-center gap-3">
            <FileTypeIcon type={imp.status} />
            <div>
              <p className="font-medium text-gray-900 dark:text-white text-sm">{imp.title}</p>
              <p className="text-xs text-gray-400">
                {MONTHS[imp.month - 1]} {imp.year} · {imp.totalRows} ta qator · {formatDate(imp.createdAt)}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={imp.status === 'confirmed' ? 'success' : 'warning'}>
              {imp.status === 'confirmed' ? 'Tasdiqlangan' : 'Qoralama'}
            </Badge>
            <Button size="sm" variant="outline"
              onClick={() => { setCurrentImportId(imp.id); setPage(1); setActiveTab('upload') }}>
              Ko'rish
            </Button>
            {imp.status !== 'confirmed' && (
              <button onClick={() => deleteImportMutation.mutate(imp.id)} disabled={deleteImportMutation.isPending}
                className="p-1.5 rounded-lg text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  )

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Vedomost Importi</h1>
          <p className="text-gray-500 dark:text-gray-400 text-sm mt-0.5">
            Zapravkadan kelgan vedomostni AI orqali o'qib, yoqilg'i ma'lumotlarini avtomatik yuklang
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setActiveTab('upload'); setCurrentImportId(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'upload' && !currentImportId
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}>
            <Plus className="w-4 h-4" />
            Yangi import
          </button>
          <button
            onClick={() => { setActiveTab('history'); setCurrentImportId(null) }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300'
                : 'text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700'
            }`}>
            <History className="w-4 h-4" />
            Tarix ({(history || []).length})
          </button>
        </div>
      </div>

      {/* Content */}
      {currentImportId
        ? importDetail
        : activeTab === 'history'
          ? historyView
          : uploadView
      }
    </div>
  )
}
