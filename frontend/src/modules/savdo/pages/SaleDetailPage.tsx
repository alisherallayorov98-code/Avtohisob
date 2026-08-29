import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface SaleLine {
  id: string
  quantity: number
  unitPrice: string
  unitCost: string
  lineTotal: string
  lineCost: string
  product: { name: string; sku: string; unit: string }
}
interface SaleDetail {
  id: string
  documentNumber: string
  totalAmount: string
  totalCost: string
  createdAt: string
  notes: string | null
  customer: { name: string; phone: string | null } | null
  warehouse: { name: string }
  lines: SaleLine[]
}

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [sale, setSale] = useState<SaleDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    savdoApi.get(`/sales/${id}`)
      .then(res => setSale(res.data.data))
      .catch(() => toast.error('Sotuvni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
  }
  if (!sale) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Sotuv topilmadi</div>
  }

  const profit = Number(sale.totalAmount) - Number(sale.totalCost)

  async function handlePrint() {
    try {
      const res = await savdoApi.get(`/sales/${id}/print`, { responseType: 'text' })
      const win = window.open('', '_blank')
      if (win) {
        win.document.open()
        win.document.write(res.data)
        win.document.close()
      }
    } catch {
      toast.error('Hisob-fakturani ochib bo\'lmadi')
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Link to="/savdo/sales" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Sotuvlarga qaytish
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="flex items-start justify-between flex-wrap gap-3">
          <div>
            <h1 className="text-lg font-semibold text-gray-800">{sale.documentNumber}</h1>
            <p className="text-sm text-gray-500">
              {new Date(sale.createdAt).toLocaleString('uz-UZ')} · {sale.warehouse.name}
              {sale.customer && ` · ${sale.customer.name}`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
            >
              <Printer className="w-4 h-4" /> Chop etish
            </button>
            <div className="text-right">
              <p className="text-xs text-gray-400">Jami summa</p>
              <p className="text-xl font-semibold text-gray-800 savdo-num">{Number(sale.totalAmount).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Mahsulot</th>
              <th className="text-right px-4 py-2.5 font-medium">Miqdor</th>
              <th className="text-right px-4 py-2.5 font-medium">Narx</th>
              <th className="text-right px-4 py-2.5 font-medium">Tannarx</th>
              <th className="text-right px-4 py-2.5 font-medium">Summa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sale.lines.map(l => (
              <tr key={l.id}>
                <td className="px-4 py-2.5 font-medium text-gray-800">{l.product.name} <span className="text-gray-400 text-xs">({l.product.sku})</span></td>
                <td className="px-4 py-2.5 text-right savdo-num">{l.quantity} {l.product.unit}</td>
                <td className="px-4 py-2.5 text-right savdo-num">{Number(l.unitPrice).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right savdo-num text-gray-500">{Number(l.unitCost).toLocaleString()}</td>
                <td className="px-4 py-2.5 text-right savdo-num font-medium">{Number(l.lineTotal).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400">Jami summa</p>
          <p className="text-lg font-semibold text-gray-800 savdo-num">{Number(sale.totalAmount).toLocaleString()}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400">Tannarx</p>
          <p className="text-lg font-semibold text-gray-800 savdo-num">{Number(sale.totalCost).toLocaleString()}</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400">Foyda</p>
          <p className={`text-lg font-semibold savdo-num ${profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{profit.toLocaleString()}</p>
        </div>
      </div>
    </div>
  )
}
