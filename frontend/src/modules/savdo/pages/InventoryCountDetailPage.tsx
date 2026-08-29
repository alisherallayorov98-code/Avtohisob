import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

interface CountLine {
  id: string
  systemQty: number
  countedQty: number
  diffQty: number
  unitCost: string
  diffValue: string
  product: { name: string; sku: string; unit: string }
}
interface CountDetail {
  id: string
  countedAt: string
  notes: string | null
  warehouse: { name: string }
  lines: CountLine[]
}

export default function InventoryCountDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [count, setCount] = useState<CountDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    savdoApi.get(`/inventory/counts/${id}`)
      .then(res => setCount(res.data.data))
      .catch(() => toast.error('Yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
  }
  if (!count) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Topilmadi</div>
  }

  const changed = count.lines.filter(l => l.diffQty !== 0)
  const totalDiff = changed.reduce((s, l) => s + Number(l.diffValue), 0)

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Link to="/savdo/inventarizatsiya" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Inventarizatsiyaga qaytish
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <h1 className="text-lg font-semibold text-gray-800">{count.warehouse.name}</h1>
        <p className="text-sm text-gray-500">{new Date(count.countedAt).toLocaleString('uz-UZ')}</p>
        {count.notes && <p className="text-sm text-gray-600 mt-2">{count.notes}</p>}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Mahsulot</th>
              <th className="text-right px-4 py-2.5 font-medium">Tizim</th>
              <th className="text-right px-4 py-2.5 font-medium">Sanalgan</th>
              <th className="text-right px-4 py-2.5 font-medium">Farq</th>
              <th className="text-right px-4 py-2.5 font-medium">Qiymat farqi</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {count.lines.map(l => (
              <tr key={l.id} className={l.diffQty !== 0 ? 'bg-amber-50/40' : ''}>
                <td className="px-4 py-2.5 font-medium text-gray-800">{l.product.name} <span className="text-gray-400 text-xs">({l.product.sku})</span></td>
                <td className="px-4 py-2.5 text-right savdo-num text-gray-500">{l.systemQty} {l.product.unit}</td>
                <td className="px-4 py-2.5 text-right savdo-num">{l.countedQty} {l.product.unit}</td>
                <td className={`px-4 py-2.5 text-right savdo-num font-medium ${l.diffQty > 0 ? 'text-green-600' : l.diffQty < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {l.diffQty > 0 ? `+${l.diffQty}` : l.diffQty}
                </td>
                <td className={`px-4 py-2.5 text-right savdo-num ${l.diffQty > 0 ? 'text-green-600' : l.diffQty < 0 ? 'text-red-600' : 'text-gray-400'}`}>
                  {Number(l.diffValue).toLocaleString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 inline-block">
        <p className="text-xs text-gray-400">Jami qiymat farqi</p>
        <p className={`text-lg font-semibold savdo-num ${totalDiff >= 0 ? 'text-green-700' : 'text-red-600'}`}>{totalDiff.toLocaleString()}</p>
      </div>
    </div>
  )
}
