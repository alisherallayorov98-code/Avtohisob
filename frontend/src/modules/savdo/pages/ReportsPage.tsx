import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Loader2, Download } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import DateRangeFilter from '../ui/DateRangeFilter'
import { downloadFile, fmtMoney } from '../lib/docs'
import { useSavdoPerms } from '../lib/useSavdoAdmin'
import { formatDate } from '../../../lib/utils'

type Tab = 'cash' | 'transfer' | 'credit' | 'balances'

interface Totals {
  count: number; total: number; vat: number; net: number; paid: number; outstanding: number; overdue: number
  cost?: number; grossProfit?: number
}
interface Row {
  id: string; documentNumber: string; createdAt: string; customerName: string | null
  totalAmount: number; vatAmount: number; paid: number; balance: number; overpaid: number
  status: 'paid' | 'partial' | 'unpaid'; daysPast: number; dueDate: string | null
}
interface Report {
  rows: Row[]; totals: Totals
  aging: { key: string; label: string; amount: number; count: number }[]
  summary: Record<'cash' | 'transfer' | 'credit', Totals>
  receipts: Record<'cash' | 'bank' | 'card', { amount: number; count: number }>
}
interface Balances { rows: { id: string; name: string; phone: string | null; debt: number; advance: number }[]; totalDebt: number; totalAdvance: number }

const TABS: { key: Tab; label: string; hint: string }[] = [
  { key: 'cash', label: 'Naqd', hint: 'Kassaga darhol tushgan sotuvlar' },
  { key: 'transfer', label: 'Perechisleniya', hint: "Bank o'tkazmasi bilan to'lanadigan sotuvlar — qaysilari hali tushmagan" },
  { key: 'credit', label: 'Qarz', hint: "Muddatga qarzga berilgan sotuvlar — muddati o'tganlar" },
  { key: 'balances', label: "Mijozlar qoldig'i", hint: "Har mijoz bo'yicha qarz va avans (yagona hisob)" },
]
const STATUS = {
  paid: { label: "To'langan", cls: 'bg-green-50 text-green-700' },
  partial: { label: 'Qisman', cls: 'bg-amber-50 text-amber-700' },
  unpaid: { label: "To'lanmagan", cls: 'bg-red-50 text-red-700' },
}

function Card({ label, value, tone }: { label: string; value: string; tone?: 'red' | 'green' }) {
  return (
    <div className="bg-white border border-gray-200 rounded-xl p-3">
      <p className="text-xs text-gray-400">{label}</p>
      <p className={`text-base font-semibold savdo-num ${tone === 'red' ? 'text-red-600' : tone === 'green' ? 'text-green-700' : 'text-gray-800'}`}>{value}</p>
    </div>
  )
}

export default function ReportsPage() {
  const showCost = useSavdoPerms()('cost.view')
  const [tab, setTab] = useState<Tab>('transfer')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [onlyOpen, setOnlyOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<Report | null>(null)
  const [balances, setBalances] = useState<Balances | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    const params = { ...(from && { from }), ...(to && { to }) }
    const req = tab === 'balances'
      ? savdoApi.get('/reports/customer-balances').then(r => setBalances(r.data.data))
      : savdoApi.get('/reports/payment-types', { params: { type: tab, ...params, ...(onlyOpen && { onlyOpen: 1 }) } }).then(r => setReport(r.data.data))
    req.catch(err => toast.error(err?.response?.status === 403 ? 'Bu hisobot uchun ruxsat yo\'q' : 'Hisobotni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [tab, from, to, onlyOpen])

  useEffect(load, [load])

  const t = report?.totals
  const current = TABS.find(x => x.key === tab)!

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Hisobotlar</h1>
          <p className="text-sm text-gray-500">{current.hint}</p>
        </div>
        {tab !== 'balances' && (
          <div className="flex items-center gap-2 flex-wrap">
            <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
            {tab !== 'cash' && (
              <label className="flex items-center gap-2 text-sm text-gray-600">
                <input type="checkbox" checked={onlyOpen} onChange={e => setOnlyOpen(e.target.checked)} className="w-4 h-4 accent-amber-700" /> Faqat to'lanmagan
              </label>
            )}
            <button onClick={() => downloadFile('/reports/payment-types/export.xlsx', `hisobot-${tab}.xlsx`, { type: tab, ...(from && { from }), ...(to && { to }), ...(onlyOpen && { onlyOpen: 1 }) })}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium">
              <Download className="w-4 h-4" /> Excel
            </button>
          </div>
        )}
      </div>

      <div className="flex gap-2 mb-4 flex-wrap">
        {TABS.map(x => (
          <button key={x.key} onClick={() => setTab(x.key)}
            className={`px-4 py-2 rounded-lg text-sm font-medium border ${tab === x.key ? 'bg-amber-700 border-amber-700 text-white' : 'border-gray-300 text-gray-600 hover:bg-gray-50'}`}>
            {x.label}
            {report && x.key !== 'balances' && <span className="ml-2 opacity-80 savdo-num">{fmtMoney(report.summary[x.key].total)}</span>}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : tab === 'balances' ? (
        balances && (
          <>
            <div className="grid grid-cols-2 gap-3 mb-4 max-w-md">
              <Card label="Jami qarz (mijozlardan)" value={`${fmtMoney(balances.totalDebt)} so'm`} tone="red" />
              <Card label="Jami avans (mijozlar oldidagi qarzimiz)" value={`${fmtMoney(balances.totalAdvance)} so'm`} tone="green" />
            </div>
            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                  <tr><th className="text-left px-4 py-2.5 font-medium">Mijoz</th><th className="text-left px-4 py-2.5 font-medium">Telefon</th>
                    <th className="text-right px-4 py-2.5 font-medium">Qarz</th><th className="text-right px-4 py-2.5 font-medium">Avans</th></tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {balances.rows.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400">Qarz ham, avans ham yo'q</td></tr>}
                  {balances.rows.map(r => (
                    <tr key={r.id}>
                      <td className="px-4 py-2.5 font-medium text-gray-800">{r.name}</td>
                      <td className="px-4 py-2.5 text-gray-500">{r.phone || '—'}</td>
                      <td className="px-4 py-2.5 text-right savdo-num text-red-600">{r.debt ? fmtMoney(r.debt) : '—'}</td>
                      <td className="px-4 py-2.5 text-right savdo-num text-green-700">{r.advance ? fmtMoney(r.advance) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )
      ) : report && t && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3 mb-4">
            <Card label={`Sotuvlar (${t.count})`} value={fmtMoney(t.total)} />
            <Card label="shundan QQS" value={fmtMoney(t.vat)} />
            <Card label="To'langan" value={fmtMoney(t.paid)} tone="green" />
            {tab !== 'cash' && <Card label="Qoldiq (tushishi kerak)" value={fmtMoney(t.outstanding)} tone={t.outstanding > 0 ? 'red' : undefined} />}
            {tab !== 'cash' && <Card label="Muddati o'tgan" value={fmtMoney(t.overdue)} tone={t.overdue > 0 ? 'red' : undefined} />}
            {showCost && t.grossProfit !== undefined && <Card label="Yalpi foyda (QQSsiz)" value={fmtMoney(t.grossProfit)} />}
          </div>

          <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4 text-sm text-gray-600 flex gap-x-6 gap-y-1 flex-wrap">
            <span className="text-gray-400">Davrda haqiqatda tushgan pul:</span>
            <span>Naqd <b className="savdo-num text-gray-800">{fmtMoney(report.receipts.cash.amount)}</b></span>
            <span>Perechisleniya <b className="savdo-num text-gray-800">{fmtMoney(report.receipts.bank.amount)}</b></span>
            <span>Karta <b className="savdo-num text-gray-800">{fmtMoney(report.receipts.card.amount)}</b></span>
          </div>

          {tab !== 'cash' && report.aging.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
              {report.aging.map(a => (
                <Card key={a.key} label={`${a.label} (${a.count})`} value={fmtMoney(a.amount)} tone={a.key !== 'notDue' && a.amount > 0 ? 'red' : undefined} />
              ))}
            </div>
          )}

          <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-4 py-2.5 font-medium">Faktura</th>
                  <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                  <th className="text-left px-4 py-2.5 font-medium">Mijoz</th>
                  <th className="text-right px-4 py-2.5 font-medium">Jami</th>
                  <th className="text-right px-4 py-2.5 font-medium">To'langan</th>
                  {tab !== 'cash' && <th className="text-right px-4 py-2.5 font-medium">Qoldiq</th>}
                  {tab !== 'cash' && <th className="text-left px-4 py-2.5 font-medium">Muddat</th>}
                  <th className="text-left px-4 py-2.5 font-medium">Holat</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {report.rows.length === 0 && <tr><td colSpan={8} className="px-4 py-8 text-center text-gray-400">Bu davrda sotuv yo'q</td></tr>}
                {report.rows.map(r => (
                  <tr key={r.id} className="hover:bg-gray-50">
                    <td className="px-4 py-2.5 font-medium"><Link to={`/savdo/sales/${r.id}`} className="text-amber-700 hover:underline">{r.documentNumber}</Link></td>
                    <td className="px-4 py-2.5 text-gray-500 savdo-num">{formatDate(r.createdAt)}</td>
                    <td className="px-4 py-2.5 text-gray-600">{r.customerName || "Ko'chadan mijoz"}</td>
                    <td className="px-4 py-2.5 text-right savdo-num">{fmtMoney(r.totalAmount)}</td>
                    <td className="px-4 py-2.5 text-right savdo-num text-green-700">{fmtMoney(Math.min(r.paid, r.totalAmount))}</td>
                    {tab !== 'cash' && <td className="px-4 py-2.5 text-right savdo-num font-medium">{r.balance ? fmtMoney(r.balance) : '—'}</td>}
                    {tab !== 'cash' && (
                      <td className={`px-4 py-2.5 text-xs savdo-num ${r.daysPast > 0 ? 'text-red-600 font-medium' : 'text-gray-500'}`}>
                        {r.dueDate ? formatDate(r.dueDate) : '—'}{r.daysPast > 0 && r.dueDate ? ` · ${r.daysPast} kun` : ''}
                      </td>
                    )}
                    <td className="px-4 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${STATUS[r.status].cls}`}>{STATUS[r.status].label}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
