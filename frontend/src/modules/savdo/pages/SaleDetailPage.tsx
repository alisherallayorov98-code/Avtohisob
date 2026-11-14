import { useState, useEffect } from 'react'
import { useParams, Link, useSearchParams } from 'react-router-dom'
import { ArrowLeft, Loader2, Printer, Ban, Pencil } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import { useSavdoAdmin, useSavdoPerms } from '../lib/useSavdoAdmin'
import { formatDateTime, formatDate } from '../../../lib/utils'
import SaleEditPanel from '../ui/SaleEditPanel'
import RowMenu from '../ui/RowMenu'
import ReasonDialog from '../ui/ReasonDialog'

// Tannarx maydonlarini server ruxsati bo'lmagan rolga umuman YUBORMAYDI
// (backend stripCostFields) — shuning uchun ular ixtiyoriy.
interface SaleLine {
  id: string
  quantity: number
  unitPrice: string
  unitCost?: string
  lineTotal: string
  lineCost?: string
  product: { name: string; sku: string; unit: string }
}
interface SaleDetail {
  id: string
  documentNumber: string
  totalAmount: string
  totalCost?: string
  vatRate?: string | null
  vatAmount?: string
  saleType?: string
  paymentType?: string
  dueDate?: string | null
  createdAt: string
  notes: string | null
  status: string
  customer: { id?: string; name: string; phone: string | null } | null
  warehouse: { name: string }
  lines: SaleLine[]
}

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>()
  const [sale, setSale] = useState<SaleDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [searchParams] = useSearchParams()
  const [editing, setEditing] = useState(searchParams.get('edit') === '1')
  const isAdmin = useSavdoAdmin()
  const showCost = useSavdoPerms()('cost.view')

  useEffect(() => {
    if (!id) return
    savdoApi.get(`/sales/${id}`)
      .then(res => setSale(res.data.data))
      .catch(() => toast.error('Sotuvni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [id])

  async function doCancel(reason: string) {
    if (!id) return
    try {
      await savdoApi.post(`/sales/${id}/cancel`, { reason })
      toast.success('Sotuv bekor qilindi')
      setCancelOpen(false)
      const res = await savdoApi.get(`/sales/${id}`)
      setSale(res.data.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    }
  }

  if (loading) {
    return <div className="flex-1 flex justify-center items-center"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
  }
  if (!sale) {
    return <div className="flex-1 flex items-center justify-center text-sm text-gray-400">Sotuv topilmadi</div>
  }

  const vat = Number(sale.vatAmount ?? 0)
  const profit = Number(sale.totalAmount) - vat - Number(sale.totalCost ?? 0)

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
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-semibold text-gray-800">{sale.documentNumber}</h1>
              {sale.status === 'cancelled' && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Bekor qilingan</span>
              )}
            </div>
            <p className="text-sm text-gray-500">
              {formatDateTime(sale.createdAt)} · {sale.warehouse.name}
              {sale.customer && ` · ${sale.customer.name}`}
              {' · '}{sale.paymentType === 'cash' ? 'Naqd' : sale.paymentType === 'transfer' ? 'Perechisleniya' : 'Qarzga'}
              {sale.dueDate && sale.paymentType !== 'cash' && ` (muddat ${formatDate(sale.dueDate)})`}
            </p>
          </div>
          <div className="flex items-center gap-4">
            {sale.status !== 'cancelled' && (
              <button
                onClick={handlePrint}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors"
              >
                <Printer className="w-4 h-4" /> Chop etish
              </button>
            )}
            {isAdmin && sale.status !== 'cancelled' && sale.saleType !== 'pos' && (
              <button
                onClick={() => setEditing(v => !v)}
                className="flex items-center gap-2 px-3 py-2 rounded-lg border border-amber-300 text-amber-800 bg-amber-50 hover:bg-amber-100 text-sm font-medium transition-colors"
              >
                <Pencil className="w-4 h-4" /> Tahrirlash
              </button>
            )}
            {isAdmin && sale.status !== 'cancelled' && (
              <RowMenu items={[
                { label: 'Bekor qilish', icon: <Ban className="w-4 h-4" />, danger: true, onClick: () => setCancelOpen(true) },
              ]} />
            )}
            <div className="text-right">
              <p className="text-xs text-gray-400">Jami summa</p>
              <p className="text-xl font-semibold text-gray-800 savdo-num">{Number(sale.totalAmount).toLocaleString()}</p>
            </div>
          </div>
        </div>
      </div>

      {cancelOpen && (
        <ReasonDialog
          title={`Sotuvni bekor qilish — ${sale.documentNumber}`}
          description="Qoldiq va tannarx qatlami tiklanadi; bog'langan to'lovlar avansga o'tadi (naqd sotuvning avto-to'lovi bekor bo'ladi)."
          confirmLabel="Bekor qilish" danger onConfirm={doCancel} onClose={() => setCancelOpen(false)}
        />
      )}

      {editing && sale && (
        <SaleEditPanel
          sale={sale as any}
          onClose={() => setEditing(false)}
          onSaved={() => { setEditing(false); savdoApi.get(`/sales/${id}`).then(r => setSale(r.data.data)) }}
        />
      )}

      <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto mb-5">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
            <tr>
              <th className="text-left px-4 py-2.5 font-medium">Mahsulot</th>
              <th className="text-right px-4 py-2.5 font-medium">Miqdor</th>
              <th className="text-right px-4 py-2.5 font-medium">Narx</th>
              {showCost && <th className="text-right px-4 py-2.5 font-medium">Tannarx</th>}
              <th className="text-right px-4 py-2.5 font-medium">Summa</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sale.lines.map(l => (
              <tr key={l.id}>
                <td className="px-4 py-2.5 font-medium text-gray-800">{l.product.name} <span className="text-gray-400 text-xs">({l.product.sku})</span></td>
                <td className="px-4 py-2.5 text-right savdo-num">{l.quantity} {l.product.unit}</td>
                <td className="px-4 py-2.5 text-right savdo-num">{Number(l.unitPrice).toLocaleString()}</td>
                {showCost && <td className="px-4 py-2.5 text-right savdo-num text-gray-500">{Number(l.unitCost ?? 0).toLocaleString()}</td>}
                <td className="px-4 py-2.5 text-right savdo-num font-medium">{Number(l.lineTotal).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className={`grid gap-4 ${showCost ? 'grid-cols-3' : 'grid-cols-1'}`}>
        <div className="bg-white border border-gray-200 rounded-xl p-4">
          <p className="text-xs text-gray-400">Jami summa</p>
          <p className="text-lg font-semibold text-gray-800 savdo-num">{Number(sale.totalAmount).toLocaleString()}</p>
          {vat > 0 && <p className="text-xs text-gray-400">shundan QQS {Number(sale.vatRate)}%: {vat.toLocaleString()}</p>}
        </div>
        {showCost && (
          <>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400">Tannarx</p>
              <p className="text-lg font-semibold text-gray-800 savdo-num">{Number(sale.totalCost ?? 0).toLocaleString()}</p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl p-4">
              <p className="text-xs text-gray-400">Foyda</p>
              <p className={`text-lg font-semibold savdo-num ${profit >= 0 ? 'text-green-700' : 'text-red-600'}`}>{profit.toLocaleString()}</p>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
