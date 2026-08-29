import { useState, useEffect, useCallback } from 'react'
import { Boxes, Loader2, Search, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'

interface StockRow {
  id: string
  quantityOnHand: number
  reorderLevel: number
  product: { name: string; sku: string; unit: string }
  warehouse: { name: string }
}

export default function StockPage() {
  const [stock, setStock] = useState<StockRow[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [exporting, setExporting] = useState(false)

  const fetchStock = useCallback(() => {
    setLoading(true)
    savdoApi.get('/stock', { params: { page, ...(search && { search }) } })
      .then(res => {
        setStock(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Qoldiqni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page, search])

  useEffect(() => { fetchStock() }, [fetchStock])
  useEffect(() => { setPage(1) }, [search])

  async function handleExport() {
    setExporting(true)
    try {
      const res = await savdoApi.get('/stock/export.xlsx', { responseType: 'blob' })
      const url = window.URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = 'qoldiq.xlsx'
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
          <h1 className="text-lg font-semibold text-gray-800">Qoldiq</h1>
          <p className="text-sm text-gray-500">Ombor bo'yicha joriy mahsulot qoldig'i</p>
        </div>
        <div className="flex items-center gap-2">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Mahsulot yoki SKU..."
              className="pl-8 pr-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600 w-48"
            />
          </div>
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
      ) : stock.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <Boxes className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Hali qoldiq yo'q — avval kirim kiriting
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Mahsulot</th>
                <th className="text-left px-4 py-2.5 font-medium">Ombor</th>
                <th className="text-right px-4 py-2.5 font-medium">Qoldiq</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {stock.map(s => (
                <tr key={s.id}>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{s.product.name} <span className="text-gray-400 text-xs">({s.product.sku})</span></td>
                  <td className="px-4 py-2.5 text-gray-500">{s.warehouse.name}</td>
                  <td className={`px-4 py-2.5 text-right savdo-num font-medium ${s.quantityOnHand <= s.reorderLevel ? 'text-red-600' : 'text-gray-800'}`}>
                    {s.quantityOnHand} {s.product.unit}
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
