import { useState, useEffect, useCallback } from 'react'
import { Upload, FileSpreadsheet, Loader2, Check, X, Trash2, ArrowLeft, AlertTriangle, CheckCircle2 } from 'lucide-react'
import toast from 'react-hot-toast'
import api, { apiErrorMessage } from '../lib/api'

const UZ_MONTHS = ['Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun', 'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr']

interface ImportListItem {
  id: string
  title: string
  month: number
  year: number
  status: string
  totalRows: number
  createdAt: string
  _count?: { rows: number }
}

interface Vehicle { id: string; registrationNumber: string; brand?: string; model?: string }

interface ImportRow {
  id: string
  rowNumber: number
  refuelDate: string | null
  licensePlate: string
  vehicleId: string | null
  quantityM3: number
  odometerReading: number
  matchStatus: string
  vehicle?: Vehicle | null
}

interface ImportDetail {
  id: string
  title: string
  month: number
  year: number
  status: string
  totalRows: number
  rows: ImportRow[]
  allVehicles: Vehicle[]
}

const STATUS_STYLE: Record<string, { label: string; cls: string }> = {
  matched: { label: 'Topildi', cls: 'bg-green-100 text-green-700' },
  ambiguous: { label: 'Tanlang', cls: 'bg-amber-100 text-amber-700' },
  manual: { label: "Qo'lda", cls: 'bg-blue-100 text-blue-700' },
  unmatched: { label: 'Topilmadi', cls: 'bg-red-100 text-red-700' },
}

export default function FuelImport() {
  const [imports, setImports] = useState<ImportListItem[]>([])
  const [active, setActive] = useState<ImportDetail | null>(null)
  const [loading, setLoading] = useState(false)
  const [showUpload, setShowUpload] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const now = new Date()
  const [month, setMonth] = useState(now.getMonth() + 1)
  const [year, setYear] = useState(now.getFullYear())
  const [file, setFile] = useState<File | null>(null)

  const fetchImports = useCallback(() => {
    setLoading(true)
    api.get('/fuel-imports')
      .then(r => setImports(r.data.data ?? r.data ?? []))
      .catch(() => setImports([]))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchImports() }, [fetchImports])

  async function openImport(id: string) {
    setLoading(true)
    try {
      const r = await api.get(`/fuel-imports/${id}`)
      setActive(r.data.data ?? r.data)
    } catch (e) { toast.error(apiErrorMessage(e)) }
    finally { setLoading(false) }
  }

  async function handleUpload() {
    if (!file) { toast.error('Fayl tanlang'); return }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('month', String(month))
      fd.append('year', String(year))
      fd.append('title', `${UZ_MONTHS[month - 1]} ${year} yoqilg'i`)
      const r = await api.post('/fuel-imports/parse', fd, { headers: { 'Content-Type': 'multipart/form-data' } })
      const created = r.data.data ?? r.data
      toast.success('Fayl o\'qildi — tekshiring va kirim qiling')
      setShowUpload(false)
      setFile(null)
      await openImport(created.id)
      fetchImports()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Faylni o\'qib bo\'lmadi'))
    } finally {
      setUploading(false)
    }
  }

  async function setRowVehicle(row: ImportRow, vehicleId: string) {
    if (!active) return
    try {
      await api.patch(`/fuel-imports/${active.id}/rows/${row.id}`, { vehicleId: vehicleId || null })
      // mahalliy yangilash
      setActive(a => a ? {
        ...a,
        rows: a.rows.map(r => r.id === row.id
          ? { ...r, vehicleId: vehicleId || null, matchStatus: vehicleId ? 'manual' : 'unmatched', vehicle: a.allVehicles.find(v => v.id === vehicleId) || null }
          : r),
      } : a)
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  async function deleteRow(row: ImportRow) {
    if (!active) return
    try {
      await api.delete(`/fuel-imports/${active.id}/rows/${row.id}`)
      setActive(a => a ? { ...a, rows: a.rows.filter(r => r.id !== row.id), totalRows: a.totalRows - 1 } : a)
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  async function handleConfirm() {
    if (!active) return
    const unresolved = active.rows.filter(r => !r.vehicleId).length
    if (unresolved > 0 && !window.confirm(`${unresolved} ta qatorda mashina aniqlanmagan — ular kirim qilinmaydi. Davom etamizmi?`)) return
    setConfirming(true)
    try {
      const r = await api.post(`/fuel-imports/${active.id}/confirm`, {})
      const created = (r.data.data ?? r.data)?.created ?? ''
      toast.success(`✅ Kirim qilindi${created ? ` (${created} ta yozuv)` : ''}`)
      setActive(null)
      fetchImports()
    } catch (e) {
      toast.error(apiErrorMessage(e, 'Kirim qilishda xato'))
    } finally {
      setConfirming(false)
    }
  }

  async function deleteImport(id: string) {
    if (!window.confirm('Bu importni o\'chirasizmi?')) return
    try {
      await api.delete(`/fuel-imports/${id}`)
      toast.success('O\'chirildi')
      if (active?.id === id) setActive(null)
      fetchImports()
    } catch (e) { toast.error(apiErrorMessage(e)) }
  }

  // ── Preview (active import) ──
  if (active) {
    const matched = active.rows.filter(r => r.vehicleId).length
    return (
      <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <button onClick={() => setActive(null)} className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900">
            <ArrowLeft className="w-4 h-4" /> Ro'yxatga qaytish
          </button>
          <div className="flex items-center gap-2">
            <span className="text-sm text-gray-500">{matched}/{active.totalRows} mashina aniqlandi</span>
            {active.status === 'draft' && (
              <button onClick={handleConfirm} disabled={confirming}
                className="flex items-center gap-1.5 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
                {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Kirim qilish
              </button>
            )}
          </div>
        </div>

        <div>
          <h1 className="text-lg font-bold text-gray-900">{active.title}</h1>
          <p className="text-xs text-gray-500">{UZ_MONTHS[active.month - 1]} {active.year} · {active.status === 'confirmed' ? 'Kirim qilingan' : 'Qoralama (chala saqlangan)'}</p>
        </div>

        <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs">
              <tr>
                <th className="px-3 py-2 text-left">#</th>
                <th className="px-3 py-2 text-left">Sana</th>
                <th className="px-3 py-2 text-left">Excel raqami</th>
                <th className="px-3 py-2 text-left">Mashina</th>
                <th className="px-3 py-2 text-right">Litr</th>
                <th className="px-3 py-2 text-left">Holat</th>
                <th className="px-3 py-2"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {active.rows.map(row => {
                const st = STATUS_STYLE[row.matchStatus] || STATUS_STYLE.unmatched
                const needsPick = !row.vehicleId
                return (
                  <tr key={row.id} className={needsPick ? 'bg-amber-50/40' : ''}>
                    <td className="px-3 py-2 text-gray-400">{row.rowNumber}</td>
                    <td className="px-3 py-2 text-gray-600 whitespace-nowrap">{row.refuelDate ? new Date(row.refuelDate).toLocaleDateString('uz-UZ') : '—'}</td>
                    <td className="px-3 py-2 font-mono text-gray-700">{row.licensePlate}</td>
                    <td className="px-3 py-2">
                      {row.vehicle && row.matchStatus === 'matched' ? (
                        <span className="font-medium text-gray-900">{row.vehicle.registrationNumber}</span>
                      ) : active.status === 'draft' ? (
                        <select
                          value={row.vehicleId || ''}
                          onChange={e => setRowVehicle(row, e.target.value)}
                          className={`px-2 py-1 text-sm border rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 ${needsPick ? 'border-amber-400' : 'border-gray-200'}`}
                        >
                          <option value="">— tanlang —</option>
                          {active.allVehicles.map(v => (
                            <option key={v.id} value={v.id}>{v.registrationNumber} {v.brand ? `(${v.brand})` : ''}</option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-gray-400">{row.vehicle?.registrationNumber || '—'}</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right font-medium">{Number(row.quantityM3).toLocaleString('uz-UZ')}</td>
                    <td className="px-3 py-2"><span className={`text-xs px-2 py-0.5 rounded-full font-medium ${st.cls}`}>{st.label}</span></td>
                    <td className="px-3 py-2 text-right">
                      {active.status === 'draft' && (
                        <button onClick={() => deleteRow(row)} className="p-1 text-gray-300 hover:text-red-500"><Trash2 className="w-3.5 h-3.5" /></button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {active.totalRows > active.rows.length && (
          <p className="text-xs text-gray-400 text-center">Ko'rsatilmoqda: {active.rows.length} / {active.totalRows} qator (sahifalash keyingi bosqichda)</p>
        )}
      </div>
    )
  }

  // ── Importlar ro'yxati ──
  return (
    <div className="flex-1 overflow-y-auto p-4 md:p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold text-gray-900 flex items-center gap-2">
            <FileSpreadsheet className="w-5 h-5 text-green-600" /> Yoqilg'i import (Excel)
          </h1>
          <p className="text-xs text-gray-500 mt-0.5">Mijoz Excel jadvalini yuklang — tizim o'qib, tekshirib kirim qiladi</p>
        </div>
        <button onClick={() => setShowUpload(true)} className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg text-sm font-medium">
          <Upload className="w-4 h-4" /> Yangi import
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-7 h-7 text-green-600 animate-spin" /></div>
      ) : imports.length === 0 ? (
        <div className="bg-white rounded-xl p-10 text-center shadow-sm border border-gray-100">
          <FileSpreadsheet className="w-12 h-12 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500">Hali import yo'q</p>
          <p className="text-gray-400 text-sm mt-1">"Yangi import" bilan Excel faylni yuklang</p>
        </div>
      ) : (
        <div className="space-y-2">
          {imports.map(imp => {
            const isDraft = imp.status === 'draft'
            return (
              <div key={imp.id} className="bg-white rounded-xl p-4 shadow-sm border border-gray-100 flex items-center justify-between gap-3">
                <button onClick={() => openImport(imp.id)} className="flex items-center gap-3 text-left flex-1 min-w-0">
                  {isDraft ? <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0" /> : <CheckCircle2 className="w-5 h-5 text-green-500 shrink-0" />}
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900 truncate">{imp.title}</p>
                    <p className="text-xs text-gray-500">{UZ_MONTHS[imp.month - 1]} {imp.year} · {imp.totalRows} qator · {isDraft ? 'Qoralama — davom eting' : 'Kirim qilingan'}</p>
                  </div>
                </button>
                <button onClick={() => deleteImport(imp.id)} className="p-1.5 text-gray-300 hover:text-red-500"><Trash2 className="w-4 h-4" /></button>
              </div>
            )
          })}
        </div>
      )}

      {/* Upload modal */}
      {showUpload && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => !uploading && setShowUpload(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-900">Yoqilg'i Excel yuklash</h3>
              <button onClick={() => setShowUpload(false)} className="p-1.5 hover:bg-gray-100 rounded-lg"><X className="w-4 h-4 text-gray-500" /></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Oy</label>
                <select value={month} onChange={e => setMonth(Number(e.target.value))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg">
                  {UZ_MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-600 block mb-1">Yil</label>
                <input type="number" value={year} onChange={e => setYear(Number(e.target.value))} className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg" />
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-gray-600 block mb-1">Excel fayl (.xlsx)</label>
              <input type="file" accept=".xlsx,.xls" onChange={e => setFile(e.target.files?.[0] ?? null)}
                className="w-full text-sm text-gray-600 file:mr-3 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-green-50 file:text-green-700 file:text-sm file:font-medium" />
              <p className="text-xs text-gray-400 mt-1">Mijoz formati: chap = kunlar, yuqori = mashina raqamlari, katak = litr</p>
            </div>
            <div className="flex gap-2 justify-end">
              <button onClick={() => setShowUpload(false)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Bekor</button>
              <button onClick={handleUpload} disabled={uploading || !file}
                className="px-4 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-1.5">
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                Yuklash va o'qish
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
