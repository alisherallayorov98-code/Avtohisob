import { useState, useEffect, useMemo } from 'react'
import { Loader2, Trash2, Plus, Save, CheckCircle2, RotateCcw } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import SearchSelect from './SearchSelect'
import CostSummary from './CostSummary'
import { Levy } from './LevyPanel'
import { fmtMoney } from '../lib/docs'
import {
  FormState, FormLine, FormCost, CostGroup, EMPTY_LINE, GROUP_META,
  fromPayload, toBody, toDraftBody, liveTotals,
} from '../lib/purchaseDocForm'

interface Option { id: string; name: string }
interface ProductOption extends Option { sku: string; unit: string; weightKg?: string | null; levyRateId?: string | null }

// 'new' — yangi; 'draft' — saqlangan qoralamani davom ettirish; 'edit' — kirim qilingan hujjatni (admin) tahrirlash
export type FormMode = 'new' | 'draft' | 'edit'

interface Props {
  mode: FormMode
  docId: string | null
  initial: FormState
  warehouses: Option[]
  suppliers: Option[]
  products: ProductOption[]
  levies: Levy[]
  wageSaved: number | null
  onDone: () => void
  onCancel: () => void
}

const inp = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'
const STORE_KEY = 'savdo_import_form_v2'

export default function PurchaseDocForm({ mode, docId, initial, warehouses, suppliers, products, levies, wageSaved, onDone, onCancel }: Props) {
  const [f, setF] = useState<FormState>(initial)
  const [draftId, setDraftId] = useState<string | null>(mode === 'draft' ? docId : null)
  const [busy, setBusy] = useState<'' | 'draft' | 'post' | 'delete'>('')
  const [restore, setRestore] = useState<FormState | null>(null)
  const [reason, setReason] = useState('')

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => setF(s => ({ ...s, [k]: v }))
  const updLine = (i: number, p: Partial<FormLine>) => setF(s => ({ ...s, lines: s.lines.map((l, idx) => idx === i ? { ...l, ...p } : l) }))
  const updCost = (i: number, p: Partial<FormCost>) => setF(s => ({ ...s, costs: s.costs.map((c, idx) => idx === i ? { ...c, ...p } : c) }))

  // Ombor bitta bo'lsa avtomatik
  useEffect(() => {
    if (warehouses.length === 1 && !f.warehouseId) set('warehouseId', warehouses[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses])

  // Brauzer yopilib/yangilanib ketsa yo'qolmasligi uchun: yangi formani mahalliy saqlab turamiz
  useEffect(() => {
    if (mode !== 'new') return
    try {
      const raw = localStorage.getItem(STORE_KEY)
      if (raw) {
        const parsed = fromPayload(JSON.parse(raw))
        if (parsed.lines.some(l => l.productId) || parsed.costs.length) setRestore(parsed)
      }
    } catch { /* ignore */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    if (mode !== 'new' || restore) return
    const t = setTimeout(() => {
      try {
        if (f.lines.some(l => l.productId) || f.costs.length) localStorage.setItem(STORE_KEY, JSON.stringify(f))
      } catch { /* ignore */ }
    }, 600)
    return () => clearTimeout(t)
  }, [f, mode, restore])
  const clearStore = () => { try { localStorage.removeItem(STORE_KEY) } catch { /* ignore */ } }

  // ── Yig'im (utilizatsiya va h.k.): backend lib/levyCalc.ts bilan bir xil formula ──
  function levyOf(l: FormLine) {
    const r = levies.find(x => x.id === l.levyRateId)
    if (!r) return null
    const mw = Number(f.minWage) || 0
    const pct = l.levyPercent !== '' ? Number(l.levyPercent) : r.percent
    const q = Number(l.quantity) || 0
    const w = Number(l.unitWeightKg) || 0
    const basisQty = r.basis === 'per_kg' ? Math.round(q * w * 1000) / 1000 : q
    const rate = (mw * pct) / 100
    return {
      r, pct, basisQty, rate, amount: Math.round(basisQty * rate * 100) / 100,
      missing: r.basis === 'per_kg' && !(w > 0) ? "og'irlik" : !(mw > 0) ? 'eng kam oylik' : '',
    }
  }

  function pickProduct(i: number, id: string) {
    const p = products.find(x => x.id === id)
    updLine(i, {
      productId: id,
      ...(p?.weightKg ? { unitWeightKg: String(Number(p.weightKg)) } : {}),
      ...(p?.levyRateId && levies.some(v => v.id === p.levyRateId && v.isActive) ? { levyRateId: p.levyRateId } : {}),
      levyPercent: '',
    })
  }

  const isUzs = f.currency.trim().toUpperCase() === 'UZS'
  const rateNum = isUzs ? 1 : Number(f.rate)

  const totals = useMemo(() => liveTotals(
    f.lines.map(l => ({ quantity: Number(l.quantity) || 0, price: Number(l.price) || 0, fixedExtra: levyOf(l)?.amount ?? 0 })),
    rateNum > 0 ? rateNum : 0,
    f.costs.map(c => ({ amount: Number(c.amount) || 0, mode: c.mode, group: c.group })),
    f.allocBy,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), [f, rateNum, levies])

  const groupSum = (g: CostGroup) => f.costs.filter(c => c.group === g).reduce((s, c) => s + (Number(c.amount) || 0), 0)

  function problems(): string | null {
    if (!f.warehouseId) return 'Omborni tanlang'
    if (!isUzs && !(rateNum > 0)) return `Kursni kiriting (1 ${f.currency.toUpperCase() || '—'} = necha so'm)`
    const valid = f.lines.filter(l => l.productId && Number(l.quantity) > 0)
    if (valid.length === 0) return "Kamida bitta qator to'ldiring"
    for (const l of valid) {
      const lv = levyOf(l)
      if (lv?.missing) return `"${lv.r.name}" uchun ${lv.missing} kiritilmagan`
    }
    return null
  }

  // ── Amallar ──────────────────────────────────────────────────────────────────
  async function saveDraft(): Promise<string | null> {
    const res = await savdoApi.post('/purchase-docs/draft', toDraftBody(f, draftId))
    const id = res.data.data.id as string
    setDraftId(id)
    clearStore()
    return id
  }

  async function onSaveDraft() {
    setBusy('draft')
    try { await saveDraft(); toast.success('Qoralama saqlandi — keyinroq davom ettirishingiz mumkin'); onDone() }
    catch (err: any) { toast.error(err?.response?.data?.error || 'Qoralamani saqlab bo\'lmadi') }
    finally { setBusy('') }
  }

  async function onPost() {
    const p = problems()
    if (p) { toast.error(p); return }
    if (mode === 'edit' && reason.trim().length < 5) { toast.error('Tahrirlash sababini yozing (kamida 5 belgi)'); return }
    setBusy('post')
    try {
      if (mode === 'edit') {
        await savdoApi.put(`/purchase-docs/${docId}`, { ...toBody(f), reason: reason.trim() })
        toast.success('Hujjat yangilandi')
      } else if (mode === 'draft' || draftId) {
        const id = await saveDraft()          // eng so'nggi holat avval saqlanadi
        await savdoApi.post(`/purchase-docs/${id}/post`)
        toast.success('Kirim qilindi')
      } else {
        await savdoApi.post('/purchase-docs', toBody(f))
        toast.success('Kirim hujjati saqlandi')
      }
      clearStore(); onDone()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi', { duration: 6000 })
    } finally { setBusy('') }
  }

  async function onDeleteDraft() {
    if (!draftId || !window.confirm("Qoralamani o'chirasizmi?")) return
    setBusy('delete')
    try { await savdoApi.delete(`/purchase-docs/${draftId}/draft`); toast.success("Qoralama o'chirildi"); onDone() }
    catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
    finally { setBusy('') }
  }

  const title = mode === 'edit' ? 'Hujjatni tahrirlash' : mode === 'draft' ? 'Qoralamani davom ettirish' : 'Yangi import kirim'

  return (
    <div className="mb-6 p-4 bg-white border border-gray-200 rounded-xl space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        {mode !== 'edit' && <span className="text-xs text-gray-400">Yarmida to'xtasangiz — «Qoralama saqlash» bosing, ombor o'zgarmaydi</span>}
      </div>

      {mode === 'edit' && (
        <p className="text-sm font-medium text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
          Eski qatorlar teskari qaytarilib, yangilari ochiladi (faqat admin). Agar bu kirimdan tovar sotilgan bo'lsa, miqdor/narx/xarajat o'zgarmaydi —
          unda «Ma'lumotni tuzatish» (invoys, yetkazib beruvchi, izoh) dan foydalaning.
        </p>
      )}

      {mode === 'edit' && (
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Tahrirlash sababi (majburiy — audit jurnaliga yoziladi)</label>
          <input className={`${inp} w-full`} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Masalan: invoysdagi narx noto'g'ri kiritilgan edi" />
        </div>
      )}

      {restore && (
        <div className="flex items-center gap-3 flex-wrap text-sm bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 text-blue-800">
          <RotateCcw className="w-4 h-4" /> Oxirgi tugallanmagan forma topildi.
          <button type="button" className="font-medium underline" onClick={() => { setF(restore); setRestore(null) }}>Tiklash</button>
          <button type="button" className="underline text-blue-600" onClick={() => { clearStore(); setRestore(null) }}>Tashlab yuborish</button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {warehouses.length !== 1 && (
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Ombor</label>
            <select className={`${inp} w-full`} value={f.warehouseId} onChange={e => set('warehouseId', e.target.value)}>
              <option value="">Tanlang...</option>{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></div>
        )}
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Yetkazib beruvchi</label>
          <select className={`${inp} w-full`} value={f.supplierId} onChange={e => set('supplierId', e.target.value)}>
            <option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Invoys / faktura №</label>
          <input className={`${inp} w-full`} value={f.invoiceNumber} onChange={e => set('invoiceNumber', e.target.value)} /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Valyuta</label>
          <input className={`${inp} w-full uppercase`} maxLength={8} value={f.currency} onChange={e => set('currency', e.target.value)} placeholder="USD yoki UZS" /></div>
        {!isUzs && (
          <div><label className="block text-xs font-medium text-gray-600 mb-1">Kurs (1 {f.currency.toUpperCase() || '—'} = ? so'm)</label>
            <input type="number" min="0" step="any" className={`${inp} w-full`} value={f.rate} onChange={e => set('rate', e.target.value)} placeholder="12 800" /></div>
        )}
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Umumiy xarajatni taqsimlash</label>
          <select className={`${inp} w-full`} value={f.allocBy} onChange={e => set('allocBy', e.target.value as any)}>
            <option value="value">Qiymat bo'yicha</option><option value="quantity">Miqdor bo'yicha</option>
          </select></div>
        <label className="flex items-center gap-2 text-sm text-gray-700 mt-5">
          <input type="checkbox" checked={f.isOfficial} onChange={e => set('isOfficial', e.target.checked)} className="w-4 h-4 accent-amber-700" /> Rasmiy (fakturali)
        </label>
      </div>

      {f.lines.some(l => l.levyRateId) && (
        <div className="flex items-end gap-3 flex-wrap bg-amber-50/60 border border-amber-200 rounded-lg px-3 py-2">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Eng kam oylik ish haqi (so'm) — shu hujjat uchun</label>
            <input type="number" min="0" step="any" className={`${inp} w-48`} value={f.minWage} onChange={e => set('minWage', e.target.value)} />
          </div>
          {wageSaved != null && Number(f.minWage) !== wageSaved && (
            <button type="button" className="text-xs text-amber-700 underline" onClick={() => set('minWage', String(wageSaved))}>sozlamadagi: {fmtMoney(wageSaved)}</button>
          )}
          <p className="text-xs text-gray-500">Hujjatda saqlanadi — keyin oylik o'zgarsa ham bu hujjat o'zgarmaydi.</p>
        </div>
      )}

      {/* ── Mahsulotlar ── */}
      <div className="space-y-2">
        <label className="block text-xs font-medium text-gray-600">Mahsulotlar {isUzs ? '' : `(narx ${f.currency.toUpperCase()}da)`}</label>
        {f.lines.map((l, i) => {
          const lv = levyOf(l)
          const pl = totals.perLine[i]
          return (
            <div key={i} className="space-y-1">
              <div className="flex gap-2 items-center">
                <SearchSelect className="flex-1" options={products.map(p => ({ id: p.id, label: p.name, sublabel: p.sku }))}
                  value={l.productId} onChange={id => pickProduct(i, id)} placeholder="Mahsulot..." />
                <input type="number" min="0.001" step="any" placeholder="Miqdor" className={`${inp} w-28`} value={l.quantity} onChange={e => updLine(i, { quantity: e.target.value })} />
                <input type="number" min="0" step="any" placeholder="Birlik narxi" className={`${inp} w-32`} value={l.price} onChange={e => updLine(i, { price: e.target.value })} />
                <div className="w-48 text-right text-xs text-gray-500 savdo-num">
                  tannarx: <b className="text-gray-800">{fmtMoney(pl?.unitCost)}</b>
                  {pl && pl.extraCost > 0 && <div>xarajat: {fmtMoney(pl.extraCost)}</div>}
                </div>
                {f.lines.length > 1 && (
                  <button type="button" onClick={() => setF(s => ({ ...s, lines: s.lines.filter((_, idx) => idx !== i) }))} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
                )}
              </div>
              {levies.length > 0 && (
                <div className="flex gap-2 items-center flex-wrap pl-1 text-xs">
                  <span className="text-gray-400">Yig'im:</span>
                  <select className={`${inp} py-1 text-xs`} value={l.levyRateId} onChange={e => updLine(i, { levyRateId: e.target.value, levyPercent: '' })}>
                    <option value="">— yo'q —</option>
                    {levies.filter(v => v.isActive || v.id === l.levyRateId).map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                  </select>
                  {lv && (
                    <>
                      {lv.r.basis === 'per_kg' && (
                        <input type="number" min="0" step="any" placeholder="kg / birlik" className={`${inp} py-1 text-xs w-28`} value={l.unitWeightKg} onChange={e => updLine(i, { unitWeightKg: e.target.value })} />
                      )}
                      <input type="number" min="0" step="any" className={`${inp} py-1 text-xs w-20`} value={l.levyPercent} placeholder={String(lv.r.percent)}
                        title="Eng kam oylikdan foiz (bo'sh = standart)" onChange={e => updLine(i, { levyPercent: e.target.value })} />
                      <span className="text-gray-400">%</span>
                      <span className={lv.missing ? 'text-red-600' : 'text-gray-600 savdo-num'}>
                        {lv.missing
                          ? `${lv.missing} kiriting`
                          : <>{lv.basisQty.toLocaleString('ru-RU', { maximumFractionDigits: 3 })} {lv.r.basis === 'per_kg' ? 'kg' : 'dona'} × {fmtMoney(lv.rate)} = <b className="text-gray-800">{fmtMoney(lv.amount)} so'm</b></>}
                      </span>
                    </>
                  )}
                </div>
              )}
            </div>
          )
        })}
        <button type="button" onClick={() => setF(s => ({ ...s, lines: [...s.lines, { ...EMPTY_LINE }] }))} className="text-sm text-amber-700 font-medium">+ Qator qo'shish</button>
      </div>

      {/* ── Xarajatlar: ikki guruh ── */}
      <div className="grid md:grid-cols-2 gap-4">
        {(['customs', 'other'] as CostGroup[]).map(g => (
          <div key={g} className={`rounded-xl border p-3 space-y-2 ${g === 'customs' ? 'border-blue-200 bg-blue-50/30' : 'border-gray-200 bg-gray-50/50'}`}>
            <div className="flex items-baseline justify-between gap-2">
              <div>
                <p className="text-sm font-semibold text-gray-800">{GROUP_META[g].title}</p>
                <p className="text-[11px] text-gray-400">{GROUP_META[g].hint}</p>
              </div>
              <p className="text-sm font-semibold savdo-num text-gray-800">{fmtMoney(g === 'customs' ? totals.customs : totals.other)}<span className="text-xs font-normal text-gray-400"> so'm</span></p>
            </div>
            <datalist id={`presets-${g}`}>{GROUP_META[g].presets.map(p => <option key={p} value={p} />)}</datalist>
            {f.costs.map((c, i) => c.group !== g ? null : (
              <div key={i} className="flex gap-2 items-center flex-wrap">
                <input list={`presets-${g}`} className={`${inp} flex-1 min-w-[8rem]`} placeholder="Nomi" value={c.label} onChange={e => updCost(i, { label: e.target.value })} />
                <select className={`${inp} w-36`} value={c.mode} onChange={e => updCost(i, { mode: e.target.value as any })}>
                  <option value="total">Butun partiyaga</option><option value="per_unit">Har bir birlikka</option>
                </select>
                <input type="number" min="0" step="any" className={`${inp} w-32`} value={c.amount}
                  placeholder={c.mode === 'per_unit' ? "so'm / birlik" : "Jami, so'm"} onChange={e => updCost(i, { amount: e.target.value })} />
                <button type="button" onClick={() => setF(s => ({ ...s, costs: s.costs.filter((_, idx) => idx !== i) }))} className="p-2 text-gray-400 hover:text-red-600"><Trash2 className="w-4 h-4" /></button>
              </div>
            ))}
            <button type="button" onClick={() => setF(s => ({ ...s, costs: [...s.costs, { label: '', amount: '', mode: 'total', group: g }] }))}
              className="inline-flex items-center gap-1 text-sm text-amber-700 font-medium"><Plus className="w-3.5 h-3.5" /> Qo'shish</button>
            {groupSum(g) > 0 && <p className="text-[11px] text-gray-400">kiritilgan summalar yig'indisi (birlikka xarajat hisobga olinmagan): {fmtMoney(groupSum(g))}</p>}
          </div>
        ))}
      </div>

      <div><label className="block text-xs font-medium text-gray-600 mb-1">Izoh</label>
        <input className={`${inp} w-full`} value={f.notes} onChange={e => set('notes', e.target.value)} /></div>

      <CostSummary t={totals} currencyNote={isUzs ? undefined : `${f.currency.toUpperCase()} × ${f.rate || '?'}`} />

      <div className="flex gap-2 flex-wrap items-center">
        <button type="button" onClick={onPost} disabled={busy !== ''} className="inline-flex items-center gap-2 px-4 py-2 bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium rounded-lg">
          {busy === 'post' ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {mode === 'edit' ? 'Yangilash' : 'Kirim qilish (omborga o\'tkazish)'}
        </button>
        {mode !== 'edit' && (
          <button type="button" onClick={onSaveDraft} disabled={busy !== ''} className="inline-flex items-center gap-2 px-4 py-2 border border-amber-300 text-amber-700 hover:bg-amber-50 disabled:opacity-60 text-sm font-medium rounded-lg">
            {busy === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Qoralama saqlash
          </button>
        )}
        {draftId && mode !== 'edit' && (
          <button type="button" onClick={onDeleteDraft} disabled={busy !== ''} className="text-sm text-red-600 hover:text-red-700 ml-2">Qoralamani o'chirish</button>
        )}
        <button type="button" onClick={onCancel} className="ml-auto px-3 py-2 text-sm text-gray-500 hover:text-gray-700">Yopish</button>
      </div>
    </div>
  )
}
