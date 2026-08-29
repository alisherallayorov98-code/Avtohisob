import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { ClipboardList, Loader2, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import DateRangeFilter from '../ui/DateRangeFilter'

interface Option { id: string; name: string }

interface SmenaRow {
  id: string
  status: string
  openedAt: string
  closedAt: string | null
  openingBalance: string | number
  closingBalance: string | number | null
  expectedBalance: number | null
  discrepancy: number | null
  salesCount: number
  salesTotal: number
  warehouse: { id: string; name: string } | null
}

const num = (v: string | number | null | undefined): number => Number(v ?? 0)

/** Farq rangi: kamomad — qizil, ortiqcha — amber, teng — yashil. */
function diffClass(d: number | null): string {
  if (d === null) return 'text-gray-400'
  if (d < 0) return 'text-red-600'
  if (d > 0) return 'text-amber-700'
  return 'text-green-600'
}

export default function SmenaHistoryPage() {
  const [smenas, setSmenas] = useState<SmenaRow[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [loading, setLoading] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [status, setStatus] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })

  useEffect(() => {
    savdoApi.get('/warehouses/options').then(res => setWarehouses(res.data.data ?? [])).catch(() => {})
  }, [])

  const params = { ...(warehouseId && { warehouseId }), ...(status && { status }), ...(from && { from }), ...(to && { to }) }

  const fetchSmenas = useCallback(() => {
    setLoading(true)
    savdoApi.get('/kassa-smena', { params: { page, ...(warehouseId && { warehouseId }), ...(status && { status }), ...(from && { from }), ...(to && { to }) } })
      .then(res => {
        setSmenas(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Smenalarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page, warehouseId, status, from, to])

  useEffect(() => { fetchSmenas() }, [fetchSmenas])
  useEffect(() => { setPage(1) }, [warehouseId, status, from, to])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await savdoApi.get('/kassa-smena/export.xlsx', { params, responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'kassa-smenalar.xlsx'
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
          <h1 className="text-lg font-semibold text-gray-800">Smena tarixi</h1>
          <p className="text-sm text-gray-500">Kassa smenalari va kamomad/ortiqcha hisoboti</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <select
            value={warehouseId}
            onChange={e => setWarehouseId(e.target.value)}
            className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
          >
            <option value="">Barcha omborlar</option>
            {warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select>
          <select
            value={status}
            onChange={e => setStatus(e.target.value)}
            className="px-2.5 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
          >
            <option value="">Barcha holat</option>
            <option value="open">Ochiq</option>
            <option value="closed">Yopilgan</option>
          </select>
          <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
          <button
            onClick={handleExport}
            disabled={exporting}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />} Excel
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : smenas.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <ClipboardList className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Smena topilmadi
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Ombor</th>
                <th className="text-right px-4 py-2.5 font-medium">Ochilish</th>
                <th className="text-right px-4 py-2.5 font-medium">Sotuv</th>
                <th className="text-right px-4 py-2.5 font-medium">Kutilgan</th>
                <th className="text-right px-4 py-2.5 font-medium">Haqiqiy</th>
                <th className="text-right px-4 py-2.5 font-medium">Farq</th>
                <th className="text-left px-4 py-2.5 font-medium">Holat</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {smenas.map(s => (
                <tr key={s.id} className="hover:bg-amber-50/40 transition-colors">
                  <td className="px-4 py-2.5">
                    <Link to={`/savdo/kassa-tarix/${s.id}`} className="text-amber-700 hover:underline">
                      {new Date(s.openedAt).toLocaleString('uz-UZ')}
                    </Link>
                    {s.closedAt && (
                      <span className="block text-xs text-gray-400">
                        yopildi: {new Date(s.closedAt).toLocaleString('uz-UZ')}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{s.warehouse?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-right savdo-num text-gray-500">{num(s.openingBalance).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right savdo-num text-gray-800">
                    {num(s.salesTotal).toLocaleString()}
                    <span className="block text-xs text-gray-400">{s.salesCount} ta</span>
                  </td>
                  <td className="px-4 py-2.5 text-right savdo-num text-gray-500">{num(s.expectedBalance).toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-right savdo-num text-gray-800">
                    {s.closingBalance === null || s.closingBalance === undefined ? '—' : num(s.closingBalance).toLocaleString()}
                  </td>
                  <td className={`px-4 py-2.5 text-right savdo-num font-medium ${diffClass(s.discrepancy)}`}>
                    {s.discrepancy === null || s.discrepancy === undefined
                      ? '—'
                      : (s.discrepancy > 0 ? `+${s.discrepancy.toLocaleString()}` : s.discrepancy.toLocaleString())}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${s.status === 'open' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.status === 'open' ? 'Ochiq' : 'Yopilgan'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </div>
  )
}
