import { useState, useEffect, useMemo } from 'react'
import { Calculator, Loader2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import { fmtMoney, fmtQty } from '../lib/docs'

interface Item {
  id: string; name: string; sku: string; unit: string; qty: number
  avgCost: number | null; lastCost: number | null; wholesalePrice: number; retailPrice: number
}

// Tavsiya narx = tannarx × (1 + xarajat%) × (1 + ustama%) — backend lib/costingCalc.ts bilan bir xil formula
const rec = (cost: number, oh: number, mk: number) => Math.round(cost * (1 + oh / 100) * (1 + mk / 100) * 100) / 100
const inp = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'

export default function CostingPage() {
  const [items, setItems] = useState<Item[]>([])
  const [loading, setLoading] = useState(true)
  const [suggested, setSuggested] = useState(0)
  const [meta, setMeta] = useState({ expensesTotal: 0, cogsTotal: 0 })
  const [basis, setBasis] = useState<'avg' | 'last'>('avg')
  const [overhead, setOverhead] = useState('0')
  const [wholesaleMk, setWholesaleMk] = useState('15')
  const [retailMk, setRetailMk] = useState('30')
  const [search, setSearch] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [applying, setApplying] = useState(false)

  function load() {
    setLoading(true)
    savdoApi.get('/costing').then(res => {
      const d = res.data.data
      setItems(d.items); setSuggested(d.suggestedOverheadPct)
      setMeta({ expensesTotal: d.expensesTotal, cogsTotal: d.cogsTotal })
      setOverhead(String(d.suggestedOverheadPct))
    }).catch(() => toast.error('Yuklab bo\'lmadi')).finally(() => setLoading(false))
  }
  useEffect(load, [])

  const oh = Number(overhead) || 0
  const rows = useMemo(() => items
    .filter(i => !search || (i.name + i.sku).toLowerCase().includes(search.toLowerCase()))
    .map(i => {
      const cost = basis === 'avg' ? i.avgCost ?? i.lastCost : i.lastCost ?? i.avgCost
      return {
        ...i, cost,
        fullCost: cost != null ? rec(cost, oh, 0) : null,
        recWholesale: cost != null ? rec(cost, oh, Number(wholesaleMk) || 0) : null,
        recRetail: cost != null ? rec(cost, oh, Number(retailMk) || 0) : null,
      }
    }), [items, search, basis, oh, wholesaleMk, retailMk])

  function toggle(id: string) {
    setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }

  async function apply() {
    const sel = rows.filter(r => picked.has(r.id) && r.recWholesale != null)
    if (sel.length === 0) { toast.error('Mahsulotlarni belgilang'); return }
    if (!window.confirm(`${sel.length} ta mahsulotning optom va chakana narxi yangilanadi. Davom etamizmi?`)) return
    setApplying(true)
    try {
      await savdoApi.post('/costing/apply', { items: sel.map(r => ({ productId: r.id, wholesalePrice: r.recWholesale, retailPrice: r.recRetail })) })
      toast.success('Narxlar yangilandi'); setPicked(new Set()); load()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
    finally { setApplying(false) }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="mb-5">
        <h1 className="text-lg font-semibold text-gray-800">Tannarx va narx kalkulyatori</h1>
        <p className="text-sm text-gray-500">Sotishdan oldin: kirim tannarxi + umumiy xarajat ulushi + ustama = tavsiya narx</p>
      </div>

      <div className="bg-white border border-gray-200 rounded-xl p-4 mb-5 grid grid-cols-2 md:grid-cols-5 gap-3 items-end">
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Tannarx asosi</label>
          <select className={`${inp} w-full`} value={basis} onChange={e => setBasis(e.target.value as any)}>
            <option value="avg">Ombordagi o'rtacha</option><option value="last">Oxirgi kirim</option>
          </select></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Xarajat ulushi, %</label>
          <input type="number" min="0" step="any" className={`${inp} w-full`} value={overhead} onChange={e => setOverhead(e.target.value)} /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Optom ustama, %</label>
          <input type="number" min="0" step="any" className={`${inp} w-full`} value={wholesaleMk} onChange={e => setWholesaleMk(e.target.value)} /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Chakana ustama, %</label>
          <input type="number" min="0" step="any" className={`${inp} w-full`} value={retailMk} onChange={e => setRetailMk(e.target.value)} /></div>
        <p className="text-xs text-gray-500 col-span-2 md:col-span-1">
          Taklif: <b>{suggested}%</b> — oxirgi 90 kun xarajati ({fmtMoney(meta.expensesTotal)}) / sotilgan tannarx ({fmtMoney(meta.cogsTotal)})
        </p>
      </div>

      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Qidirish..." className={`${inp} pl-8 w-56`} />
        </div>
        <button onClick={apply} disabled={applying || picked.size === 0}
          className="px-4 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-50 text-white text-sm font-medium">
          {applying ? <Loader2 className="w-4 h-4 animate-spin" /> : `Belgilangan ${picked.size} ta narxni qo'llash`}
        </button>
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : rows.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400"><Calculator className="w-8 h-8 mx-auto mb-2 text-gray-300" />Mahsulot yo'q</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="px-3 py-2.5"><input type="checkbox" className="accent-amber-700"
                  checked={rows.length > 0 && rows.every(r => picked.has(r.id))}
                  onChange={e => setPicked(e.target.checked ? new Set(rows.filter(r => r.cost != null).map(r => r.id)) : new Set())} /></th>
                <th className="text-left px-3 py-2.5 font-medium">Mahsulot</th>
                <th className="text-right px-3 py-2.5 font-medium">Qoldiq</th>
                <th className="text-right px-3 py-2.5 font-medium">Tannarx</th>
                <th className="text-right px-3 py-2.5 font-medium">Xarajat bilan</th>
                <th className="text-right px-3 py-2.5 font-medium">Joriy optom</th>
                <th className="text-right px-3 py-2.5 font-medium">Tavsiya optom</th>
                <th className="text-right px-3 py-2.5 font-medium">Joriy chakana</th>
                <th className="text-right px-3 py-2.5 font-medium">Tavsiya chakana</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const below = r.fullCost != null && r.retailPrice > 0 && r.retailPrice < r.fullCost
                return (
                  <tr key={r.id}>
                    <td className="px-3 py-2"><input type="checkbox" disabled={r.cost == null} checked={picked.has(r.id)} onChange={() => toggle(r.id)} className="accent-amber-700" /></td>
                    <td className="px-3 py-2 font-medium text-gray-800">{r.name} <span className="text-xs text-gray-400">{r.sku}</span></td>
                    <td className="px-3 py-2 text-right savdo-num text-gray-500">{fmtQty(r.qty)} {r.unit}</td>
                    <td className="px-3 py-2 text-right savdo-num">{r.cost != null ? fmtMoney(r.cost) : '—'}</td>
                    <td className="px-3 py-2 text-right savdo-num">{r.fullCost != null ? fmtMoney(r.fullCost) : '—'}</td>
                    <td className="px-3 py-2 text-right savdo-num text-gray-500">{fmtMoney(r.wholesalePrice)}</td>
                    <td className="px-3 py-2 text-right savdo-num font-medium text-amber-800">{r.recWholesale != null ? fmtMoney(r.recWholesale) : '—'}</td>
                    <td className={`px-3 py-2 text-right savdo-num ${below ? 'text-red-600 font-medium' : 'text-gray-500'}`} title={below ? 'Joriy narx xarajat bilan tannarxdan past!' : ''}>{fmtMoney(r.retailPrice)}</td>
                    <td className="px-3 py-2 text-right savdo-num font-medium text-amber-800">{r.recRetail != null ? fmtMoney(r.recRetail) : '—'}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
