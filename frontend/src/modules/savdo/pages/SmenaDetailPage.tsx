import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { ArrowLeft, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import { formatDateTime } from '../../../lib/utils'

interface SmenaSale {
  id: string
  documentNumber: string
  totalAmount: number
  saleType: string
  status: string
  createdAt: string
  customerName: string | null
}

interface SmenaSummary {
  salesCount: number
  salesTotal: number
  cancelledCount: number
  cancelledTotal: number
  openingBalance: number
  expectedBalance: number
  closingBalance: number | null
  discrepancy: number | null
}

interface SmenaDetail {
  id: string
  status: string
  openedAt: string
  closedAt: string | null
  warehouse: { id: string; name: string } | null
  sales: SmenaSale[]
  summary: SmenaSummary
}

const fmt = (v: number | null): string => (v === null || v === undefined ? '—' : v.toLocaleString())

export default function SmenaDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [smena, setSmena] = useState<SmenaDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!id) return
    savdoApi.get(`/kassa-smena/${id}`)
      .then(res => setSmena(res.data.data))
      .catch(() => toast.error('Yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
  }
  if (!smena) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Topilmadi</div>
  }

  const s = smena.summary
  // Farq rangi: kamomad — qizil, ortiqcha — amber, teng — yashil.
  const diffColor = s.discrepancy === null || s.discrepancy === undefined
    ? 'text-gray-400'
    : s.discrepancy < 0 ? 'text-red-600' : s.discrepancy > 0 ? 'text-amber-700' : 'text-green-600'

  const cards: { label: string; value: string; cls?: string }[] = [
    { label: 'Ochilish', value: fmt(s.openingBalance) },
    { label: 'Sotuv summasi', value: fmt(s.salesTotal) },
    { label: 'Kutilgan', value: fmt(s.expectedBalance) },
    { label: 'Haqiqiy', value: fmt(s.closingBalance) },
    {
      label: 'Farq',
      value: s.discrepancy !== null && s.discrepancy !== undefined && s.discrepancy > 0
        ? `+${s.discrepancy.toLocaleString()}`
        : fmt(s.discrepancy),
      cls: diffColor,
    },
    { label: 'Bekor qilingan', value: `${s.cancelledCount} ta / ${fmt(s.cancelledTotal)}` },
  ]

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <Link to="/savdo/kassa-tarix" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 mb-4">
        <ArrowLeft className="w-4 h-4" /> Smena tarixiga qaytish
      </Link>

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-lg font-semibold text-gray-800">{smena.warehouse?.name || 'Smena'}</h1>
          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${smena.status === 'open' ? 'bg-green-50 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
            {smena.status === 'open' ? 'Ochiq' : 'Yopilgan'}
          </span>
        </div>
        <p className="text-sm text-gray-500">
          Ochilgan: {formatDateTime(smena.openedAt)}
          {smena.closedAt && ` · Yopilgan: ${formatDateTime(smena.closedAt)}`}
        </p>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-5">
        {cards.map(c => (
          <div key={c.label} className="bg-white border border-gray-200 rounded-xl p-4">
            <p className="text-xs text-gray-400">{c.label}</p>
            <p className={`text-lg font-semibold savdo-num ${c.cls || 'text-gray-800'}`}>{c.value}</p>
          </div>
        ))}
      </div>

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Hujjat</th>
              <th className="text-left px-4 py-2.5 font-medium">Sana</th>
              <th className="text-left px-4 py-2.5 font-medium">Mijoz</th>
              <th className="text-left px-4 py-2.5 font-medium">Turi</th>
              <th className="text-right px-4 py-2.5 font-medium">Summa</th>
              <th className="text-left px-4 py-2.5 font-medium">Holat</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {smena.sales.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-sm text-gray-400">Bu smenada sotuv yo'q</td></tr>
            ) : smena.sales.map(sale => (
              <tr key={sale.id} className={sale.status === 'cancelled' ? 'bg-red-50/40' : ''}>
                <td className="px-4 py-2.5">
                  <Link to={`/savdo/sales/${sale.id}`} className="text-amber-700 hover:underline">{sale.documentNumber}</Link>
                </td>
                <td className="px-4 py-2.5 text-gray-500">{formatDateTime(sale.createdAt)}</td>
                <td className="px-4 py-2.5 text-gray-600">{sale.customerName || '—'}</td>
                <td className="px-4 py-2.5 text-gray-500">{sale.saleType === 'pos' ? 'Kassa' : 'Hisob-faktura'}</td>
                <td className="px-4 py-2.5 text-right savdo-num font-medium text-gray-800">{Number(sale.totalAmount).toLocaleString()}</td>
                <td className="px-4 py-2.5">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${sale.status === 'cancelled' ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-700'}`}>
                    {sale.status === 'cancelled' ? 'Bekor qilingan' : 'Yakunlangan'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
