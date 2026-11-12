import { useState, useEffect, useCallback } from 'react'
import { Plus, FileInput, Loader2, Printer, Download, Ban, Pencil, Trash2, X } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import SearchSelect from '../ui/SearchSelect'
import { useSavdoAdmin } from '../lib/useSavdoAdmin'
import { openPrint, downloadFile, fmtMoney } from '../lib/docs'
import { previewLanded } from '../lib/landed'
import { formatDate } from '../../../lib/utils'
import LevyPanel, { Levy } from '../ui/LevyPanel'

interface Option { id: string; name: string }
interface ProductOption extends Option { sku: string; unit: string; weightKg?: string | null; levyRateId?: string | null }
interface DocRow {
  id: string; createdAt: string; status: string; invoiceNumber: string | null; currency: string
  exchangeRate: number; warehouseName: string; supplierName: string; lineCount: number
  goodsForeign: number; extra: number; landed: number
}
interface FormLine { productId: string; quantity: string; price: string; unitWeightKg: string; levyRateId: string; levyPercent: string }
const EMPTY_LINE: FormLine = { productId: '', quantity: '', price: '', unitWeightKg: '', levyRateId: '', levyPercent: '' }
interface FormCost { label: string; amount: string; mode: 'total' | 'per_unit' }

const COST_PRESETS = ['Bojxona', 'Transport', 'Ekspeditor', 'Sertifikat', 'Bank komissiyasi', 'Sug\'urta']
const inp = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'

export default function PurchaseDocsPage() {
  const isAdmin = useSavdoAdmin()
  const [docs, setDocs] = useState<DocRow[]>([])
  const [loading, setLoading] = useState(false)
  const [page, setPage] = useState(1)
  const [meta, setMeta] = useState({ total: 0, totalPages: 1 })
  const [products, setProducts] = useState<ProductOption[]>([])
  const [warehouses, setWarehouses] = useState<Option[]>([])
  const [suppliers, setSuppliers] = useState<Option[]>([])

  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [warehouseId, setWarehouseId] = useState('')
  const [supplierId, setSupplierId] = useState('')
  const [invoiceNumber, setInvoiceNumber] = useState('')
  const [currency, setCurrency] = useState('USD')
  const [rate, setRate] = useState('')
  const [allocBy, setAllocBy] = useState<'value' | 'quantity'>('value')
  const [isOfficial, setIsOfficial] = useState(true)
  const [notes, setNotes] = useState('')
  const [lines, setLines] = useState<FormLine[]>([{ ...EMPTY_LINE }])
  const [costs, setCosts] = useState<FormCost[]>([])
  const [saving, setSaving] = useState(false)
  const [levies, setLevies] = useState<Levy[]>([])
  const [minWage, setMinWage] = useState('')
  const [wageSaved, setWageSaved] = useState<number | null>(null)

  const fetchDocs = useCallback(() => {
    setLoading(true)
    savdoApi.get('/purchase-docs', { params: { page } })
      .then(res => {
        setDocs(res.data.data ?? [])
        setMeta({ total: res.data.meta?.total ?? 0, totalPages: res.data.meta?.totalPages ?? 1 })
      })
      .catch(() => toast.error('Kirim hujjatlarini yuklab bo\'lmadi'))
      .finally(() => setLoading(false))
  }, [page])

  useEffect(() => { fetchDocs() }, [fetchDocs])

  const fetchLevies = useCallback(() => {
    savdoApi.get('/levies').then(r => {
      setLevies(r.data.data.rates ?? [])
      setWageSaved(r.data.data.minimumWage ?? null)
      setMinWage(m => m || (r.data.data.minimumWage != null ? String(r.data.data.minimumWage) : ''))
    }).catch(() => {})
  }, [])
  useEffect(() => { fetchLevies() }, [fetchLevies])
  useEffect(() => {
    savdoApi.get('/products/options').then(r => setProducts(r.data.data ?? [])).catch(() => {})
    savdoApi.get('/warehouses/options').then(r => {
      const list = r.data.data ?? []
      setWarehouses(list)
      if (list.length === 1) setWarehouseId(list[0].id)
    }).catch(() => {})
    savdoApi.get('/suppliers/options').then(r => setSuppliers(r.data.data ?? [])).catch(() => {})
  }, [])

  function resetForm() {
    setEditingId(null); setSupplierId(''); setInvoiceNumber(''); setCurrency('USD'); setRate('')
    setAllocBy('value'); setIsOfficial(true); setNotes(''); setCosts([])
    setLines([{ ...EMPTY_LINE }])
    if (warehouses.length === 1) setWarehouseId(warehouses[0].id); else setWarehouseId('')
  }

  async function startEdit(id: string) {
    try {
      const d = (await savdoApi.get(`/purchase-docs/${id}`)).data.data
      setEditingId(id); setWarehouseId(d.warehouseId); setSupplierId(d.supplierId ?? '')
      setInvoiceNumber(d.invoiceNumber ?? ''); setCurrency(d.currency)
      setRate(d.currency === 'UZS' ? '' : String(Number(d.exchangeRate)))
      setAllocBy(d.allocBy); setIsOfficial(d.isOfficial); setNotes(d.notes ?? '')
      setCosts(d.costs.map((c: any) => ({ label: c.label, amount: String(Number(c.amount)), mode: c.mode === 'per_unit' ? 'per_unit' : 'total' })))
      setLines(d.purchases.map((p: any) => ({
        productId: p.productId, quantity: String(p.quantity), price: String(Number(p.foreignPrice ?? p.unitCost)),
        unitWeightKg: p.unitWeightKg != null ? String(Number(p.unitWeightKg)) : '',
        levyRateId: p.levyRateId ?? '', levyPercent: p.levyPercent != null ? String(Number(p.levyPercent)) : '',
      })))
      if (d.minWage != null) setMinWage(String(Number(d.minWage)))
      setShowForm(true)
      window.scrollTo({ top: 0, behavior: 'smooth' })
    } catch { toast.error('Hujjatni yuklab bo\'lmadi') }
  }

  const isUzs = currency.toUpperCase() === 'UZS'
  const rateNum = isUzs ? 1 : Number(rate)
  // Yig'im (utilizatsiya va h.k.) qator bo'yicha — backend lib/levyCalc.ts bilan bir xil formula
  function levyOf(l: FormLine) {
    const r = levies.find(x => x.id === l.levyRateId)
    if (!r) return null
    const mw = Number(minWage) || 0
    const pct = l.levyPercent !== '' ? Number(l.levyPercent) : r.percent
    const q = Number(l.quantity) || 0
    const w = Number(l.unitWeightKg) || 0
    const basisQty = r.basis === 'per_kg' ? Math.round(q * w * 1000) / 1000 : q
    const rate = (mw * pct) / 100
    return { r, pct, basisQty, rate, amount: Math.round(basisQty * rate * 100) / 100, missing: r.basis === 'per_kg' && !(w > 0) ? 'og\'irlik' : !(mw > 0) ? 'eng kam oylik' : '' }
  }

  function pickProduct(i: number, id: string) {
    const p = products.find(x => x.id === id)
    setLines(ls => ls.map((x, idx) => idx === i ? {
      ...x, productId: id,
      unitWeightKg: p?.weightKg ? String(Number(p.weightKg)) : x.unitWeightKg,
      levyRateId: p?.levyRateId && levies.some(v => v.id === p.levyRateId && v.isActive) ? p.levyRateId : x.levyRateId,
      levyPercent: '',
    } : x))
  }

  const numLines = lines.map(l => ({ quantity: Number(l.quantity) || 0, price: Number(l.price) || 0, fixedExtra: levyOf(l)?.amount ?? 0 }))
  const levyTotal = lines.reduce((s, l) => s + (levyOf(l)?.amount ?? 0), 0)
  const extraTotal = costs.filter(c => c.mode === 'total').reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const perUnitRate = costs.filter(c => c.mode === 'per_unit').reduce((s, c) => s + (Number(c.amount) || 0), 0)
  const preview = previewLanded(numLines, rateNum, extraTotal, allocBy, perUnitRate)
  const extraAll = preview.reduce((s, p) => s + p.extraCost, 0)
  const goodsLocal = numLines.reduce((s, l) => s + l.quantity * l.price * (rateNum || 0), 0)
  const landedTotal = preview.reduce((s, p) => s + p.lineTotal, 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!warehouseId) { toast.error('Omborni tanlang'); return }
    if (!isUzs && !(rateNum > 0)) { toast.error(`Kursni kiriting (1 ${currency} = necha so'm)`); return }
    const valid = lines.filter(l => l.productId && Number(l.quantity) > 0)
    if (valid.length === 0) { toast.error('Kamida bitta qator to\'ldiring'); return }
    for (const l of valid) {
      const lv = levyOf(l)
      if (lv?.missing) { toast.error(`"${lv.r.name}" uchun ${lv.missing} kiritilmagan`); return }
    }
    setSaving(true)
    try {
      const body = {
        warehouseId, supplierId: supplierId || null, invoiceNumber: invoiceNumber.trim() || null,
        currency: currency.toUpperCase(), exchangeRate: rateNum, allocBy, minWage: Number(minWage) > 0 ? Number(minWage) : null, isOfficial, notes: notes.trim() || null,
        costs: costs.filter(c => c.label.trim() && Number(c.amount) > 0).map(c => ({ label: c.label.trim(), amount: Number(c.amount), mode: c.mode })),
        lines: valid.map(l => ({
          productId: l.productId, quantity: Number(l.quantity), price: Number(l.price) || 0,
          unitWeightKg: l.unitWeightKg !== '' ? Number(l.unitWeightKg) : null,
          levyRateId: l.levyRateId || null, levyPercent: l.levyPercent !== '' ? Number(l.levyPercent) : null,
        })),
      }
      if (editingId) await savdoApi.put(`/purchase-docs/${editingId}`, body)
      else await savdoApi.post('/purchase-docs', body)
      toast.success(editingId ? 'Hujjat yangilandi' : 'Kirim hujjati saqlandi')
      resetForm(); setShowForm(false); fetchDocs()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally { setSaving(false) }
  }

  async function cancelDoc(id: string) {
    if (!window.confirm('Butun kirim hujjatini bekor qilasizmi? Faqat undan hali hech narsa sotilmagan bo\'lsa bajariladi.')) return
    try {
      await savdoApi.post(`/purchase-docs/${id}/cancel`)
      toast.success('Hujjat bekor qilindi'); fetchDocs()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
  }

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Import kirim (hujjat)</h1>
          <p className="text-sm text-gray-500">Ko'p qatorli kirim: valyuta + kurs + bojxona/transport xarajatlari → to'liq tannarx</p>
        </div>
        <button onClick={() => { if (showForm) { setShowForm(false); resetForm() } else setShowForm(true) }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium">
          {showForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {showForm ? 'Yopish' : 'Yangi kirim hujjati'}
        </button>
      </div>

      <LevyPanel rates={levies} minimumWage={wageSaved} isAdmin={isAdmin} onChanged={fetchLevies} />

      {showForm && (
        <form onSubmit={submit} className="mb-6 p-4 bg-white border border-gray-200 rounded-xl space-y-4">
          {editingId && <p className="text-sm font-medium text-amber-800 bg-amber-50 rounded-lg px-3 py-2">Hujjatni tahrirlash (admin) — eski qatorlar teskari qaytarilib, yangilari ochiladi. Sotilgan tovar bo'lsa saqlanmaydi.</p>}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {warehouses.length !== 1 && (
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Ombor</label>
                <select className={`${inp} w-full`} value={warehouseId} onChange={e => setWarehouseId(e.target.value)}>
                  <option value="">Tanlang...</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select></div>
            )}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Yetkazib beruvchi</label>
              <select className={`${inp} w-full`} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
                <option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Invoys / faktura №</label>
              <input className={`${inp} w-full`} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Valyuta</label>
              <input className={`${inp} w-full uppercase`} maxLength={8} value={currency} onChange={e => setCurrency(e.target.value)} placeholder="USD yoki UZS" /></div>
            {!isUzs && (
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Kurs (1 {currency.toUpperCase() || '—'} = ? so'm)</label>
                <input type="number" min="0" step="any" className={`${inp} w-full`} value={rate} onChange={e => setRate(e.target.value)} placeholder="12 800" /></div>
            )}
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Xarajatni taqsimlash</label>
              <select className={`${inp} w-full`} value={allocBy} onChange={e => setAllocBy(e.target.value as any)}>
                <option value="value">Qiymat bo'yicha</option><option value="quantity">Miqdor bo'yicha</option>
              </select></div>
            <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
              <input type="checkbox" checked={isOfficial} onChange={e => setIsOfficial(e.target.checked)} className="w-4 h-4 accent-amber-700" /> Rasmiy (fakturali)
            </label>
          </div>

          {lines.some(l => l.levyRateId) && (
            <div className="flex items-end gap-3 flex-wrap bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Eng kam oylik ish haqi (so'm) — shu hujjat uchun</label>
                <input type="number" min="0" step="any" className={`${inp} w-48`} value={minWage} onChange={e => setMinWage(e.target.value)} />
              </div>
              {wageSaved != null && Number(minWage) !== wageSaved && (
                <button type="button" className="text-xs text-amber-700 underline" onClick={() => setMinWage(String(wageSaved))}>sozlamadagi: {fmtMoney(wageSaved)}</button>
              )}
              <p className="text-xs text-gray-500">Hujjatda saqlanadi — keyin oylik o'zgarsa ham bu hujjat o'zgarmaydi.</p>
            </div>
          )}

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Mahsulotlar {isUzs ? '' : `(narx ${currency.toUpperCase()}da)`}</label>
            {lines.map((l, i) => (
              <div key={i} className="space-y-1"><div className="flex gap-2 items-center">
                <SearchSelect className="flex-1" options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
                  value={l.productId} onChange={id => pickProduct(i, id)} placeholder="Mahsulot..." />
                <input type="number" min="0.001" step="any" placeholder="Miqdor" className={`${inp} w-28`} value={l.quantity}
                  onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} />
                <input type="number" min="0" step="any" placeholder="Birlik narxi" className={`${inp} w-32`} value={l.price}
                  onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, price: e.target.value } : x))} />
                <div className="w-44 text-right text-xs text-gray-500 savdo-num">
                  tannarx: <b className="text-gray-800">{fmtMoney(preview[i]?.unitCost)}</b>
                  {preview[i]?.extraCost > 0 && <div>xarajat: {fmtMoney(preview[i].extraCost)}</div>}
                </div>
                {lines.length > 1 && <button type="button" onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>}
              </div>
                {levies.length > 0 && (() => {
                  const lv = levyOf(l)
                  return (
                    <div className="flex gap-2 items-center flex-wrap pl-1 text-xs">
                      <span className="text-gray-400">Yig'im:</span>
                      <select className={`${inp} py-1 text-xs`} value={l.levyRateId}
                        onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, levyRateId: e.target.value, levyPercent: '' } : x))}>
                        <option value="">— yo'q —</option>
                        {levies.filter(v => v.isActive || v.id === l.levyRateId).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                      </select>
                      {lv && (
                        <>
                          {lv.r.basis === 'per_kg' && (
                            <input type="number" min="0" step="any" placeholder="kg / birlik" className={`${inp} py-1 text-xs w-28`} value={l.unitWeightKg}
                              onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, unitWeightKg: e.target.value } : x))} />
                          )}
                          <input type="number" min="0" step="any" className={`${inp} py-1 text-xs w-20`} value={l.levyPercent} placeholder={String(lv.r.percent)}
                            title="Eng kam oylikdan foiz (bo'sh = standart)" onChange={e => setLines(ls => ls.map((x, idx) => idx === i ? { ...x, levyPercent: e.target.value } : x))} />
                          <span className="text-gray-400">%</span>
                          <span className={lv.missing ? 'text-red-600' : 'text-gray-600 savdo-num'}>
                            {lv.missing
                              ? `${lv.missing} kiriting`
                              : `${lv.basisQty.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} ${lv.r.basis === 'per_kg' ? 'kg' : 'dona'} × ${fmtMoney(lv.rate)} = `}
                            {!lv.missing && <b className="text-gray-800">{fmtMoney(lv.amount)} so'm</b>}
                          </span>
                        </>
                      )}
                    </div>
                  )
                })()}
              </div>
            ))}
            <button type="button" onClick={() => setLines(ls => [...ls, { ...EMPTY_LINE }])} className="text-sm text-amber-700 font-medium">+ Qator qo'shish</button>
          </div>

          <div className="space-y-2">
            <label className="block text-xs font-medium text-gray-600">Qo'shimcha xarajatlar (so'mda, qo'lda) — har biri yoki butun partiyaga umumiy, yoki har bir birlikka</label>
            {costs.map((c, i) => (
              <div key={i} className="flex gap-2 items-center">
                <input list="cost-presets" className={`${inp} flex-1`} placeholder="Nomi (bojxona, transport ...)" value={c.label}
                  onChange={e => setCosts(cs => cs.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} />
                <select className={`${inp} w-44`} value={c.mode} onChange={e => setCosts(cs => cs.map((x, idx) => idx === i ? { ...x, mode: e.target.value as any } : x))}>
                  <option value="total">Butun partiyaga</option>
                  <option value="per_unit">Har bir birlikka</option>
                </select>
                <input type="number" min="0" step="any" className={`${inp} w-40`} placeholder={c.mode === 'per_unit' ? "so'm / birlik" : "Jami, so'm"} value={c.amount}
                  onChange={e => setCosts(cs => cs.map((x, idx) => idx === i ? { ...x, amount: e.target.value } : x))} />
                <button type="button" onClick={() => setCosts(cs => cs.filter((_, idx) => idx !== i))} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <datalist id="cost-presets">{COST_PRESETS.map(p => <option key={p} value={p} />)}</datalist>
            <button type="button" onClick={() => setCosts(cs => [...cs, { label: '', amount: '', mode: 'total' }])} className="text-sm text-amber-700 font-medium">+ Xarajat qo'shish</button>
          </div>

          <div className="grid sm:grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-gray-600 mb-1">Izoh</label>
              <input className={`${inp} w-full`} value={notes} onChange={e => setNotes(e.target.value)} /></div>
            <div className="bg-amber-50 rounded-lg p-3 text-sm grid grid-cols-3 gap-2 text-center">
              <div><div className="text-xs text-gray-500">Tovar (so'm)</div><b className="savdo-num">{fmtMoney(goodsLocal)}</b></div>
              <div><div className="text-xs text-gray-500">Xarajat{levyTotal > 0 ? ` (yig'im ${fmtMoney(levyTotal)})` : ''}</div><b className="savdo-num">{fmtMoney(extraAll)}</b></div>
              <div><div className="text-xs text-gray-500">To'liq tannarx</div><b className="savdo-num text-amber-800">{fmtMoney(landedTotal)}</b></div>
            </div>
          </div>
          <button type="submit" disabled={saving} className="px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : editingId ? 'Yangilash' : 'Saqlash va omborga kirim qilish'}
          </button>
        </form>
      )}

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-amber-700" /></div>
      ) : docs.length === 0 ? (
        <div className="text-center py-10 text-sm text-gray-400"><FileInput className="w-8 h-8 mx-auto mb-2 text-gray-300" />Hali kirim hujjati yo'q</div>
      ) : (
        <div className="bg-white border border-gray-200 rounded-xl overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 text-gray-500 text-xs uppercase">
              <tr>
                <th className="text-left px-4 py-2.5 font-medium">Sana</th>
                <th className="text-left px-4 py-2.5 font-medium">Invoys</th>
                <th className="text-left px-4 py-2.5 font-medium">Yetkazib beruvchi</th>
                <th className="text-right px-4 py-2.5 font-medium">Qator</th>
                <th className="text-right px-4 py-2.5 font-medium">Tovar</th>
                <th className="text-right px-4 py-2.5 font-medium">Xarajat</th>
                <th className="text-right px-4 py-2.5 font-medium">Tannarx (so'm)</th>
                <th className="text-right px-4 py-2.5 font-medium">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {docs.map(d => (
                <tr key={d.id} className={d.status === 'cancelled' ? 'opacity-50' : ''}>
                  <td className="px-4 py-2.5 text-gray-500 savdo-num">{formatDate(d.createdAt)}</td>
                  <td className="px-4 py-2.5 font-medium text-gray-800">{d.invoiceNumber || '—'}
                    {d.status === 'cancelled' && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">Bekor</span>}</td>
                  <td className="px-4 py-2.5 text-gray-500">{d.supplierName || '—'}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{d.lineCount}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{fmtMoney(d.goodsForeign)} {d.currency}</td>
                  <td className="px-4 py-2.5 text-right savdo-num">{fmtMoney(d.extra)}</td>
                  <td className="px-4 py-2.5 text-right savdo-num font-medium">{fmtMoney(d.landed)}</td>
                  <td className="px-4 py-2.5 text-right">
                    <div className="inline-flex items-center gap-3">
                      <button title="Chop etish" onClick={() => openPrint(`/purchase-docs/${d.id}/print`)} className="text-gray-500 hover:text-gray-700"><Printer className="w-4 h-4" /></button>
                      <button title="Excel" onClick={() => downloadFile(`/purchase-docs/${d.id}/export.xlsx`, 'kirim-hujjati.xlsx')} className="text-gray-500 hover:text-gray-700"><Download className="w-4 h-4" /></button>
                      {isAdmin && d.status !== 'cancelled' && (
                        <>
                          <button title="Tahrirlash" onClick={() => startEdit(d.id)} className="text-amber-700 hover:text-amber-800"><Pencil className="w-4 h-4" /></button>
                          <button title="Bekor qilish" onClick={() => cancelDoc(d.id)} className="text-red-600 hover:text-red-700"><Ban className="w-4 h-4" /></button>
                        </>
                      )}
                    </div>
                  </td>
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
