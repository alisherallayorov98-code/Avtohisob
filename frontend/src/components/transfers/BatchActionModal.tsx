import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, Loader2, Package, Send } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../../lib/api'
import { formatCurrency } from '../../lib/utils'
import Modal from '../ui/Modal'

interface Item { id: string; quantity: number; sparePart: { name: string; partCode: string; unitPrice: number } }
interface Detail {
  id: string; documentNumber: string; status: string
  fromWarehouse: { name: string }; toWarehouse: { name: string }
  transfers: Item[]
}

/** Yuborish yoki qabul qilish tasdig'i: qismlar ro'yxati ko'rinadi; qabul qilishda haqiqiy kelgan miqdor kiritiladi. */
export default function BatchActionModal({ batchId, mode, onClose, onDone }: {
  batchId: string | null
  mode: 'ship' | 'receive'
  onClose: () => void
  onDone: () => void
}) {
  const qc = useQueryClient()
  const [received, setReceived] = useState<Record<string, string>>({})
  const [notes, setNotes] = useState('')

  const { data, isLoading } = useQuery({
    queryKey: ['batch-action', batchId],
    queryFn: () => api.get(`/batches/${batchId}`).then(r => r.data.data as Detail),
    enabled: !!batchId,
  })

  useEffect(() => {
    if (!data) return
    setReceived(Object.fromEntries(data.transfers.map(t => [t.id, String(t.quantity)])))
    setNotes('')
  }, [data?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => (data?.transfers || []).map(t => {
    const raw = received[t.id] ?? String(t.quantity)
    const n = Number(raw)
    const valid = raw !== '' && Number.isInteger(n) && n >= 0 && n <= t.quantity
    return { t, raw, n: valid ? n : t.quantity, valid, short: valid ? t.quantity - n : 0 }
  }), [data, received])

  const shortage = rows.reduce((s, r) => s + r.short, 0)
  const anyInvalid = rows.some(r => !r.valid)
  const total = (data?.transfers || []).reduce((s, t) => s + t.quantity * Number(t.sparePart.unitPrice), 0)

  const run = useMutation({
    mutationFn: () => mode === 'ship'
      ? api.put(`/batches/${batchId}/ship`)
      : api.put(`/batches/${batchId}/receive`, {
          items: rows.map(r => ({ transferId: r.t.id, receivedQuantity: r.n })),
          notes: notes.trim() || undefined,
        }),
    onSuccess: (res) => {
      toast.success(res.data?.message || (mode === 'ship' ? "Jo'natma yuborildi" : "Jo'natma qabul qilindi"))
      qc.invalidateQueries({ queryKey: ['batches'] })
      qc.invalidateQueries({ queryKey: ['inventory'] })
      qc.invalidateQueries({ queryKey: ['batch-action'] })
      onDone()
    },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const isShip = mode === 'ship'
  const needNote = !isShip && shortage > 0 && !notes.trim()

  return (
    <Modal open={!!batchId} onClose={onClose} size="lg"
      title={data ? `${data.documentNumber} — ${isShip ? 'yuborishni tasdiqlang' : 'qabul qilish'}` : "Jo'natma"}
      footer={
        <div className="flex gap-2 w-full justify-end">
          <button onClick={onClose} className="h-10 px-4 text-sm rounded-lg border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300">Bekor qilish</button>
          <button onClick={() => run.mutate()} disabled={run.isPending || isLoading || (!isShip && (anyInvalid || needNote))}
            className={`h-10 px-5 text-sm font-medium rounded-lg text-white disabled:opacity-50 flex items-center gap-1.5 ${isShip ? 'bg-blue-600 hover:bg-blue-700' : 'bg-emerald-600 hover:bg-emerald-700'}`}>
            {run.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : isShip ? <Send className="w-4 h-4" /> : <Package className="w-4 h-4" />}
            {isShip ? 'Yuborish' : shortage > 0 ? 'Kamomad bilan qabul qilish' : 'Qabul qilish'}
          </button>
        </div>
      }>
      {isLoading || !data ? (
        <p className="py-10 text-center text-sm text-gray-400">Yuklanmoqda…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-sm text-gray-600 dark:text-gray-300">
            <b>{data.fromWarehouse.name}</b> → <b>{data.toWarehouse.name}</b>
          </p>
          <p className={`text-sm rounded-lg px-3 py-2 ${isShip ? 'bg-blue-50 text-blue-800 dark:bg-blue-900/20 dark:text-blue-200' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-900/20 dark:text-emerald-200'}`}>
            {isShip
              ? `Yuborilganda quyidagi qismlar «${data.fromWarehouse.name}» ombordan chiqariladi. Qabul qiluvchi tasdiqlagach «${data.toWarehouse.name}» omborga qo'shiladi.`
              : "Haqiqatda kelgan miqdorni kiriting. Odatda hammasi to'liq keladi — o'zgartirish shart emas."}
          </p>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-gray-700">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 dark:bg-gray-700/50 text-gray-500 dark:text-gray-300 text-xs">
                <tr>
                  <th className="text-left px-3 py-2 font-medium">Qism</th>
                  <th className="text-right px-3 py-2 font-medium">Yuborilgan</th>
                  {!isShip && <th className="text-right px-3 py-2 font-medium w-32">Kelgan</th>}
                  <th className="text-right px-3 py-2 font-medium">Summa</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {rows.map(r => (
                  <tr key={r.t.id} className={r.short > 0 ? 'bg-amber-50/60 dark:bg-amber-900/10' : ''}>
                    <td className="px-3 py-2">
                      <p className="font-medium text-gray-900 dark:text-white">{r.t.sparePart.name}</p>
                      <p className="text-[11px] font-mono text-gray-400">{r.t.sparePart.partCode}</p>
                    </td>
                    <td className="px-3 py-2 text-right font-bold tabular-nums">{r.t.quantity} ta</td>
                    {!isShip && (
                      <td className="px-3 py-2 text-right">
                        <input type="number" min={0} max={r.t.quantity} value={r.raw}
                          onChange={e => setReceived(p => ({ ...p, [r.t.id]: e.target.value }))}
                          className={`w-24 h-9 px-2 text-right text-sm rounded-lg border dark:bg-gray-700 dark:text-white focus:outline-none focus:ring-2 ${r.valid ? 'border-gray-300 dark:border-gray-600 focus:ring-blue-500' : 'border-red-400 focus:ring-red-400'}`} />
                        {r.short > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">{r.short} ta kam</p>}
                      </td>
                    )}
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600 dark:text-gray-300">{formatCurrency(r.t.quantity * Number(r.t.sparePart.unitPrice))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-gray-700/50">
                <tr>
                  <td colSpan={isShip ? 2 : 3} className="px-3 py-2 text-sm font-semibold text-gray-700 dark:text-gray-300">Jami</td>
                  <td className="px-3 py-2 text-right font-bold tabular-nums text-gray-900 dark:text-white">{formatCurrency(total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {!isShip && shortage > 0 && (
            <div className="rounded-lg border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-3 space-y-2">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-800 dark:text-amber-200">
                <AlertTriangle className="w-4 h-4" /> Jami {shortage} ta qism kam kelgan
              </p>
              <p className="text-xs text-amber-800/80 dark:text-amber-200/80">Omborga faqat haqiqatda kelgani qo'shiladi. Kamomad hujjatda qayd etiladi va adminga xabar boradi.</p>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Sababi (majburiy): masalan, yo'lda shikastlangan, kam keltirilgan…"
                className="w-full text-sm rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-gray-800 px-3 py-2 text-gray-800 dark:text-gray-100 resize-none focus:outline-none focus:ring-2 focus:ring-amber-400" />
            </div>
          )}
        </div>
      )}
    </Modal>
  )
}
