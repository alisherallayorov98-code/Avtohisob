import { useState, useEffect, useCallback, useRef } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Upload, CheckCircle2, ClipboardCheck, History, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'

interface Option { id: string; name: string }
interface ReportItem {
  productId: string
  productName: string
  sku: string
  unit: string
  quantityOnHand: number
  unitCost: number
  value: number
}
interface Row extends ReportItem {
  countedQty: number
}
interface HistoryEntry {
  id: string
  countedAt: string
  warehouse: { id: string; name: string }
  lines: { diffQty: number; diffValue: string }[]
}

export default function InventoryCountPage() {
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [warehouseId, setWarehouseId] = useState('')
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [notFoundSkus, setNotFoundSkus] = useState<string[]>([])
  const [history, setHistory] = useState<HistoryEntry[]>([])
  const [historyPage, setHistoryPage] = useState(1)
  const [historyMeta, setHistoryMeta] = useState({ total: 0, totalPages: 1 })
  const [exporting, setExporting] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    savdoApi.get('/warehouses/options').then(res => {
      const list = res.data.data ?? []
      setWarehouses(list)
      if (list.length > 0) setWarehouseId(list[0].id)
    }).catch(() => {})
  }, [])

  const fetchReport = useCallback(() => {
    if (!warehouseId) return
    setLoading(true)
    savdoApi.get('/inventory/report', { params: { warehouseId } })
      .then(res => {
        const items: ReportItem[] = res.data.data?.warehouses?.[0]?.items ?? []
        setRows(items.map(it => ({ ...it, countedQty: it.quantityOnHand })))
        setNotFoundSkus([])
      })
      .catch(() => toast.error('Hisobotni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [warehouseId])

  useEffect(() => { fetchReport() }, [fetchReport])

  const fetchHistory = useCallback(() => {
    savdoApi.get('/inventory/counts', { params: { page: historyPage } })
      .then(res => {
        setHistory(res.data.data ?? [])
        setHistoryMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => {})
  }, [historyPage])

  useEffect(() => { fetchHistory() }, [fetchHistory])

  function updateCountedQty(productId: string, value: string) {
    const n = Number(value)
    setRows(rs => rs.map(r => r.productId === productId ? { ...r, countedQty: Number.isFinite(n) ? n : 0 } : r))
  }

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file || !warehouseId) return
    const formData = new FormData()
    formData.append('file', file)
    formData.append('warehouseId', warehouseId)
    setLoading(true)
    try {
      const res = await savdoApi.post('/inventory/count/preview', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      const { preview, notFoundSkus: nf } = res.data.data
      setRows(rs => rs.map(r => {
        const match = preview.find((p: any) => p.productId === r.productId)
        return match ? { ...r, countedQty: match.countedQty } : r
      }))
      setNotFoundSkus(nf || [])
      toast.success(`${preview.length} ta qator solishtirildi`)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Faylni o\'qib bo\'lmadi')
    } finally {
      setLoading(false)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const changedRows = rows.filter(r => r.countedQty !== r.quantityOnHand)
  const totalDiffValue = changedRows.reduce((s, r) => s + (r.countedQty - r.quantityOnHand) * r.unitCost, 0)

  async function handleConfirm() {
    if (changedRows.length === 0) { toast.error('Hech qanday o\'zgarish yo\'q'); return }
    if (!window.confirm(`${changedRows.length} ta mahsulot qoldig'i tuzatiladi. Davom etamizmi?`)) return
    setConfirming(true)
    try {
      await savdoApi.post('/inventory/count/confirm', {
        warehouseId,
        lines: changedRows.map(r => ({ productId: r.productId, countedQty: r.countedQty })),
      })
      toast.success('Inventarizatsiya tasdiqlandi')
      fetchReport()
      fetchHistory()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setConfirming(false)
    }
  }

  async function handleExport() {
    setExporting(true)
    try {
      const res = await savdoApi.get('/inventory/report/export.xlsx', { params: { warehouseId }, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'inventarizatsiya.xlsx'
      a.click()
      window.URL.revokeObjectURL(url)
    } catch {
      toast.error('Excel yuklab bo\'lmadi')
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Inventarizatsiya</h1>
          <p className="text-sm text-gray-500">Joriy qoldiq — kerak bo'lsa Excel yuklab solishtiring yoki qo'lda tuzating</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600">
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Excel
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx" onChange={handleUpload} className="hidden" id="count-upload" />
          <label htmlFor="count-upload" className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 text-amber-700 hover:bg-amber-50 text-sm font-medium transition-colors cursor-pointer">
            <Upload className="w-4 h-4" /> Sanoqni yuklash
          </label>
        </div>
      </div>

      {notFoundSkus.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
          Topilmagan SKU'lar: {notFoundSkus.join(', ')}
        </div>
      )}

      {changedRows.length > 0 && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between flex-wrap gap-3">
          <span className="text-sm text-amber-800">
            {changedRows.length} ta mahsulotda farq bor — jami qiymat farqi: <b>{totalDiffValue.toLocaleString()}</b> so'm
          </span>
          <button
            onClick={handleConfirm}
            disabled={confirming}
            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium transition-colors"
          >
            {confirming ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />} Tasdiqlash
          </button>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <ClipboardCheck className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Bu omborda qoldiq yo'q
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto mb-8">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Mahsulot</th>
                <th className="text-right px-4 py-2.5 font-medium">Tizim qoldig'i</th>
                <th className="text-right px-4 py-2.5 font-medium">Sanalgan</th>
                <th className="text-right px-4 py-2.5 font-medium">Farq</th>
                <th className="text-right px-4 py-2.5 font-medium">Qiymat farqi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const diff = r.countedQty - r.quantityOnHand
                return (
                  <tr key={r.productId} className={diff !== 0 ? 'bg-amber-50/40' : ''}>
                    <td className="px-4 py-2.5 font-medium text-gray-800">{r.productName} <span className="text-gray-400 text-xs">({r.sku})</span></td>
                    <td className="px-4 py-2.5 text-right savdo-num text-gray-500">{r.quantityOnHand} {r.unit}</td>
                    <td className="px-4 py-2.5 text-right">
                      <input
                        type="number" min="0" value={r.countedQty}
                        onChange={e => updateCountedQty(r.productId, e.target.value)}
                        className="w-20 px-2 py-1 border border-gray-300 rounded text-right text-sm savdo-num"
                      />
                    </td>
                    <td className={`px-4 py-2.5 text-right savdo-num font-medium ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {diff > 0 ? `+${diff}` : diff}
                    </td>
                    <td className={`px-4 py-2.5 text-right savdo-num ${diff > 0 ? 'text-green-600' : diff < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                      {(diff * r.unitCost).toLocaleString()}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="flex items-center gap-2 mb-3">
        <History className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-800">Inventarizatsiya tarixi</h2>
      </div>
      {history.length === 0 ? (
        <p className="text-sm text-gray-400 py-4">Hali inventarizatsiya tasdiqlanmagan</p>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Ombor</th>
                <th className="text-right px-4 py-2.5 font-medium">O'zgargan qator</th>
                <th className="text-right px-4 py-2.5 font-medium">Qiymat farqi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {history.map(h => {
                const changed = h.lines.filter(l => l.diffQty !== 0)
                const total = changed.reduce((s, l) => s + Number(l.diffValue), 0)
                return (
                  <tr key={h.id}>
                    <td className="px-4 py-2.5 text-gray-500 savdo-num">
                      <Link to={`/savdo/inventarizatsiya/${h.id}`} className="text-amber-700 hover:underline">
                        {new Date(h.countedAt).toLocaleString('uz-UZ')}
                      </Link>
                    </td>
                    <td className="px-4 py-2.5 text-gray-600">{h.warehouse.name}</td>
                    <td className="px-4 py-2.5 text-right savdo-num">{changed.length}</td>
                    <td className={`px-4 py-2.5 text-right savdo-num font-medium ${total >= 0 ? 'text-green-600' : 'text-red-600'}`}>{total.toLocaleString()}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={historyPage} totalPages={historyMeta.totalPages} total={historyMeta.total} onChange={setHistoryPage} />
    </div>
  )
}
