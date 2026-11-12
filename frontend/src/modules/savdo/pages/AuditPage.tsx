import { useState, useEffect, useCallback, Fragment } from 'react'
import { ShieldCheck, Loader2, ChevronDown, ChevronRight, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import DateRangeFilter from '../ui/DateRangeFilter'
import { diffSnapshots } from '../lib/auditDiff'
import { formatDateTime } from '../../../lib/utils'

interface Entry {
  id: string; entity: string; entityId: string; entityLabel: string | null; action: string
  reason: string; before: any; after: any; userName: string | null; createdAt: string
}

const ENTITY: Record<string, string> = { purchase_doc: 'Import kirim', purchase: 'Kirim', sale: 'Sotuv' }
const ACTION: Record<string, { label: string; cls: string }> = {
  edit: { label: 'Tahrirlandi', cls: 'bg-amber-50 text-amber-700' },
  meta: { label: "Ma'lumot tuzatildi", cls: 'bg-blue-50 text-blue-700' },
  cancel: { label: 'Bekor qilindi', cls: 'bg-red-50 text-red-700' },
}

// Saqlangan hujjatlardagi barcha tahrir va bekor qilishlar: kim, qachon, nima sababdan, nima o'zgargan.
// Yozuvlarni o'zgartirib yoki o'chirib bo'lmaydi. Faqat admin ko'radi.
export default function AuditPage() {
  const [rows, setRows] = useState<Entry[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [entity, setEntity] = useState('')
  const [action, setAction] = useState('')
  const [search, setSearch] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    savdoApi.get('/audit', { params: { page, ...(entity && { entity }), ...(action && { action }), ...(search && { search }), ...(from && { from }), ...(to && { to }) } })
      .then(res => {
        setRows(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Jurnalni yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page, entity, action, search, from, to])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [entity, action, search, from, to])

  const sel = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Audit jurnali</h1>
          <p className="text-sm text-gray-500">Saqlangan hujjatlardagi tahrir va bekor qilishlar — sabab va «avval → keyin» bilan</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="relative">
            <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Raqam, sabab, xodim..." className={`${sel} pl-8 w-52`} />
          </div>
          <select className={sel} value={entity} onChange={e => setEntity(e.target.value)}>
            <option value="">Barcha hujjatlar</option>
            {Object.entries(ENTITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
          <select className={sel} value={action} onChange={e => setAction(e.target.value)}>
            <option value="">Barcha amallar</option>
            {Object.entries(ACTION).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <DateRangeFilter from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400"><ShieldCheck className="w-8 h-8 mx-auto mb-2 text-gray-300" />Hali tahrir yoki bekor qilish yo'q</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="w-8" />
                <th className="text-left px-3 py-2.5 font-medium">Sana</th>
                <th className="text-left px-3 py-2.5 font-medium">Kim</th>
                <th className="text-left px-3 py-2.5 font-medium">Hujjat</th>
                <th className="text-left px-3 py-2.5 font-medium">Amal</th>
                <th className="text-left px-3 py-2.5 font-medium">Sabab</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const isOpen = open === r.id
                const changes = isOpen ? diffSnapshots(r.action, r.before, r.after) : []
                return (
                  <Fragment key={r.id}>
                    <tr className="hover:bg-gray-50 cursor-pointer" onClick={() => setOpen(isOpen ? null : r.id)}>
                      <td className="pl-3 text-gray-400">{isOpen ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}</td>
                      <td className="px-3 py-2.5 text-gray-500 savdo-num whitespace-nowrap">{formatDateTime(r.createdAt)}</td>
                      <td className="px-3 py-2.5 text-gray-700">{r.userName || '—'}</td>
                      <td className="px-3 py-2.5"><div className="font-medium text-gray-800">{r.entityLabel || '—'}</div><div className="text-xs text-gray-400">{ENTITY[r.entity] || r.entity}</div></td>
                      <td className="px-3 py-2.5"><span className={`text-xs px-2 py-0.5 rounded-full ${ACTION[r.action]?.cls}`}>{ACTION[r.action]?.label || r.action}</span></td>
                      <td className="px-3 py-2.5 text-gray-700 max-w-md">{r.reason}</td>
                    </tr>
                    {isOpen && (
                      <tr className="bg-gray-50/70">
                        <td />
                        <td colSpan={5} className="px-3 py-3">
                          <p className="text-xs font-medium text-gray-500 mb-1.5 uppercase">Nima o'zgargan</p>
                          {changes.length === 0
                            ? <p className="text-sm text-gray-400">Qiymatlar o'zgarmagan (faqat qayta saqlangan)</p>
                            : <ul className="text-sm text-gray-700 space-y-0.5 list-disc pl-5">{changes.map((c, i) => <li key={i}>{c}</li>)}</ul>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />
    </div>
  )
}
