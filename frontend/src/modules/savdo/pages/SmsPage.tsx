import { useState, useEffect, useCallback } from 'react'
import { Loader2, MessageSquare, Send, Eye, AlertTriangle } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'

interface Debtor {
  id: string
  name: string
  phone: string | null
  debt: number
  phoneValid: boolean
  lastSmsAt: string | null
}

interface PreviewItem {
  customerId: string
  name: string
  phone: string | null
  debt: number
  phoneValid: boolean
  text: string
  segments: number
}

interface PreviewResult {
  items: PreviewItem[]
  recipients: number
  skipped: number
  totalSegments: number
  estimatedCost: number
}

interface SmsLog {
  id: string
  phone: string
  message: string
  status: string
  error: string | null
  createdAt: string
  customer: { id: string; name: string } | null
}

export default function SmsPage() {
  const [debtors, setDebtors] = useState<Debtor[]>([])
  const [loading, setLoading] = useState(false)
  const [minDebt, setMinDebt] = useState('')
  const [selected, setSelected] = useState<string[]>([])
  const [template, setTemplate] = useState('')
  const [smsEnabled, setSmsEnabled] = useState(false)
  const [smsConfigured, setSmsConfigured] = useState(false)
  const [preview, setPreview] = useState<PreviewResult | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [sending, setSending] = useState(false)

  const [logs, setLogs] = useState<SmsLog[]>([])
  const [logsLoading, setLogsLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })

  const fetchDebtors = useCallback(() => {
    setLoading(true)
    savdoApi.get('/sms/debtors', { params: { ...(minDebt && { minDebt }) } })
      .then(res => {
        const rows: Debtor[] = res.data.data ?? []
        setDebtors(rows)
        setSelected(prev => prev.filter(id => rows.some(r => r.id === id && r.phoneValid)))
        const m = res.data.meta || {}
        setSmsEnabled(Boolean(m.smsEnabled))
        setSmsConfigured(Boolean(m.smsConfigured))
        setTemplate(prev => prev || m.template || '')
      })
      .catch(() => toast.error('Qarzdorlarni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [minDebt])

  const fetchLogs = useCallback(() => {
    setLogsLoading(true)
    savdoApi.get('/sms/logs', { params: { page } })
      .then(res => {
        setLogs(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('SMS jurnalini yuklab bo\'lmadi'))
      .finally(() => setLogsLoading(false))
  }, [page])

  useEffect(() => { fetchDebtors() }, [fetchDebtors])
  useEffect(() => { fetchLogs() }, [fetchLogs])

  const sendable = debtors.filter(d => d.phoneValid)
  const allSelected = sendable.length > 0 && selected.length === sendable.length

  function toggleAll() {
    setPreview(null)
    setSelected(allSelected ? [] : sendable.map(d => d.id))
  }

  function toggleOne(id: string) {
    setPreview(null)
    setSelected(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id])
  }

  async function handlePreview() {
    if (selected.length === 0) { toast.error('Mijozlarni tanlang'); return }
    setPreviewing(true)
    try {
      const res = await savdoApi.post('/sms/preview', { template, customerIds: selected })
      setPreview(res.data.data)
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setPreviewing(false)
    }
  }

  async function handleSend() {
    if (selected.length === 0) { toast.error('Mijozlarni tanlang'); return }
    if (!window.confirm(`${selected.length} ta mijozga SMS yuborilsinmi? Bu amalni bekor qilib bo'lmaydi.`)) return
    setSending(true)
    try {
      const res = await savdoApi.post('/sms/send', { template, customerIds: selected })
      const d = res.data.data || {}
      const parts = [`${d.sent ?? 0} ta yuborildi`]
      if (d.failed) parts.push(`${d.failed} ta xato`)
      if (d.skipped?.length) parts.push(`${d.skipped.length} ta o'tkazib yuborildi`)
      toast.success(parts.join(', '))
      if (d.skipped?.length) {
        const reasons = d.skipped.slice(0, 3).map((s: any) => `${s.name}: ${s.reason}`).join('\n')
        toast(reasons, { duration: 6000 })
      }
      setSelected([])
      setPreview(null)
      fetchDebtors()
      setPage(1)
      fetchLogs()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">SMS eslatma</h1>
          <p className="text-sm text-gray-500">Qarzi bor mijozlarga to'lov haqida eslatma yuborish</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <input
            type="number"
            min="0"
            value={minDebt}
            onChange={e => setMinDebt(e.target.value)}
            placeholder="Eng kam qarz (so'm)"
            className="w-44 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
          />
          <button
            onClick={handlePreview}
            disabled={previewing || selected.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50 text-sm font-medium transition-colors disabled:opacity-60"
          >
            {previewing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Eye className="w-4 h-4" />} Oldindan ko'rish
          </button>
          <button
            onClick={handleSend}
            disabled={sending || selected.length === 0}
            className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium transition-colors disabled:opacity-60"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />} Yuborish ({selected.length})
          </button>
        </div>
      </div>

      {!smsEnabled && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-800">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>SMS eslatma sozlamalarda yoqilmagan — Sozlamalar bo'limidan yoqing.</span>
        </div>
      )}
      {smsEnabled && !smsConfigured && (
        <div className="mb-4 flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-sm text-red-700">
          <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
          <span>SMS xizmati sozlanmagan (Eskiz kaliti yo'q) — administrator bilan bog'laning.</span>
        </div>
      )}

      <div className="mb-5 p-4 bg-white border border-gray-200 rounded-xl">
        <label className="block text-xs font-medium text-gray-600 mb-1">SMS matni (shablon)</label>
        <textarea
          value={template}
          onChange={e => { setTemplate(e.target.value); setPreview(null) }}
          rows={3}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600"
        />
        <p className="mt-2 text-xs text-gray-500">
          O'rin egalari: <code className="px-1 bg-gray-100 rounded">{'{mijoz}'}</code>{' '}
          <code className="px-1 bg-gray-100 rounded">{'{qarz}'}</code>{' '}
          <code className="px-1 bg-gray-100 rounded">{'{korxona}'}</code>{' '}
          <code className="px-1 bg-gray-100 rounded">{'{telefon}'}</code>{' '}
          <code className="px-1 bg-gray-100 rounded">{'{sana}'}</code>
          {' '}— bu yerdagi o'zgarish faqat shu yuborishga taalluqli, doimiy saqlash Sozlamalarda.
        </p>
      </div>

      {preview && (
        <div className="mb-5 p-4 bg-white border border-gray-200 rounded-xl">
          <p className="text-sm font-medium text-gray-800 mb-2">
            {preview.recipients} ta SMS ≈ {preview.estimatedCost.toLocaleString()} so'm
            {preview.skipped > 0 && (
              <span className="ml-2 text-xs text-red-600">({preview.skipped} ta raqam noto'g'ri — yuborilmaydi)</span>
            )}
          </p>
          <div className="space-y-2">
            {preview.items.slice(0, 3).map(i => (
              <div key={i.customerId} className="p-3 bg-gray-50 border border-gray-200 rounded-lg">
                <p className="text-xs text-gray-500 mb-1">{i.name} — {i.phone || 'raqam yo\'q'} · {i.segments} ta SMS</p>
                <p className="text-sm text-gray-800">{i.text}</p>
              </div>
            ))}
          </div>
          {preview.items.length > 3 && (
            <p className="mt-2 text-xs text-gray-400">... va yana {preview.items.length - 3} ta mijoz</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : debtors.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400">
          <MessageSquare className="w-8 h-8 mx-auto mb-2 text-gray-300" />
          Qarzi bor mijoz yo'q
        </div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium w-10">
                  <input type="checkbox" checked={allSelected} onChange={toggleAll} className="w-4 h-4 accent-amber-700" />
                </th>
                <th className="text-left px-4 py-2.5 font-medium">Mijoz</th>
                <th className="text-left px-4 py-2.5 font-medium">Telefon</th>
                <th className="text-right px-4 py-2.5 font-medium">Qarz</th>
                <th className="text-left px-4 py-2.5 font-medium">Oxirgi SMS</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {debtors.map(d => (
                <tr key={d.id} className={d.phoneValid ? '' : 'opacity-60'}>
                  <td className="px-4 py-2.5">
                    <input
                      type="checkbox"
                      disabled={!d.phoneValid}
                      checked={selected.includes(d.id)}
                      onChange={() => toggleOne(d.id)}
                      className="w-4 h-4 accent-amber-700 disabled:opacity-40"
                    />
                  </td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{d.name}</td>
                  <td className="px-4 py-2.5 text-gray-500">
                    {d.phone || '—'}
                    {!d.phoneValid && (
                      <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">raqam noto'g'ri</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right savdo-num font-medium">{d.debt.toLocaleString()}</td>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">
                    {d.lastSmsAt ? new Date(d.lastSmsAt).toLocaleDateString('uz-UZ') : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-gray-800">SMS jurnali</h2>
      {logsLoading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-amber-700" /></div>
      ) : logs.length === 0 ? (
        <div className="text-center py-8 text-sm text-gray-400">Hali SMS yuborilmagan</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Mijoz</th>
                <th className="text-left px-4 py-2.5 font-medium">Telefon</th>
                <th className="text-left px-4 py-2.5 font-medium">Holat</th>
                <th className="text-left px-4 py-2.5 font-medium">Izoh</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map(l => (
                <tr key={l.id}>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{new Date(l.createdAt).toLocaleString('uz-UZ')}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{l.customer?.name || '—'}</td>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{l.phone}</td>
                  <td className="px-4 py-2.5">
                    {l.status === 'sent' ? (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 font-medium">Yuborildi</span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700 font-medium">Xato</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-gray-500">{l.error || ''}</td>
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
