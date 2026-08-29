import { useState, useEffect, useCallback } from 'react'
import { Boxes, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'

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

  const fetchStock = useCallback(() => {
    setLoading(true)
    savdoApi.get('/stock')
      .then(res => setStock(res.data.data ?? []))
      .catch(() => toast.error('Qoldiqni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { fetchStock() }, [fetchStock])

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-800">Qoldiq</h1>
        <p className="text-sm text-gray-500">Ombor bo'yicha joriy mahsulot qoldig'i</p>
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
    </div>
  )
}
