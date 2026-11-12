import { useState, useEffect, useCallback } from 'react'
import { Plus, FileInput, Loader2, Printer, Download, Ban, Pencil, Trash2, X, PlayCircle, Wrench } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import Pager from '../ui/Pager'
import LevyPanel, { Levy } from '../ui/LevyPanel'
import PurchaseDocForm, { FormMode } from '../ui/PurchaseDocForm'
import RowMenu from '../ui/RowMenu'
import ReasonDialog from '../ui/ReasonDialog'
import { useSavdoAdmin } from '../lib/useSavdoAdmin'
import { openPrint, downloadFile, fmtMoney } from '../lib/docs'
import { FormState, emptyForm, fromDoc, fromPayload } from '../lib/purchaseDocForm'
import { formatDate } from '../../../lib/utils'

interface Option { id: string; name: string }
interface ProductOption extends Option { sku: string; unit: string; weightKg?: string | null; levyRateId?: string | null }
interface DocRow {
  id: string; number: string | null; createdAt: string; updatedAt: string; status: string
  invoiceNumber: string | null; currency: string; exchangeRate: number; supplierName: string; lineCount: number
  goodsForeign: number; goodsLocal: number; customs: number; other: number; levy: number
  extra: number; extraPct: number; landed: number
}
interface FormSession { mode: FormMode; docId: string | null; initial: FormState; key: number }

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
  const [levies, setLevies] = useState<Levy[]>([])
  const [wageSaved, setWageSaved] = useState<number | null>(null)
  const [session, setSession] = useState<FormSession | null>(null)
  const [metaDoc, setMetaDoc] = useState<DocRow | null>(null)
  const [cancelTarget, setCancelTarget] = useState<DocRow | null>(null)

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
    }).catch(() => {})
  }, [])
  useEffect(() => { fetchLevies() }, [fetchLevies])

  useEffect(() => {
    savdoApi.get('/products/options').then(r => setProducts(r.data.data ?? [])).catch(() => {})
    savdoApi.get('/warehouses/options').then(r => setWarehouses(r.data.data ?? [])).catch(() => {})
    savdoApi.get('/suppliers/options').then(r => setSuppliers(r.data.data ?? [])).catch(() => {})
  }, [])

  const wageStr = wageSaved != null ? String(wageSaved) : ''
  const open = (mode: FormMode, docId: string | null, initial: FormState) => {
    setSession({ mode, docId, initial, key: Date.now() })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function continueDraft(id: string) {
    try {
      const d = (await savdoApi.get(`/purchase-docs/${id}`)).data.data
      open('draft', id, fromPayload(d.draftPayload, wageStr))
    } catch { toast.error('Qoralamani yuklab bo\'lmadi') }
  }

  async function startEdit(id: string) {
    try {
      const d = (await savdoApi.get(`/purchase-docs/${id}`)).data.data
      open('edit', id, fromDoc(d))
    } catch { toast.error('Hujjatni yuklab bo\'lmadi') }
  }

  async function doCancel(reason: string) {
    if (!cancelTarget) return
    try {
      await savdoApi.post(`/purchase-docs/${cancelTarget.id}/cancel`, { reason })
      toast.success('Hujjat bekor qilindi'); setCancelTarget(null); fetchDocs()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi', { duration: 6000 }) }
  }

  async function removeDraft(id: string) {
    if (!window.confirm("Qoralamani o'chirasizmi?")) return
    try { await savdoApi.delete(`/purchase-docs/${id}/draft`); toast.success("Qoralama o'chirildi"); fetchDocs() }
    catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
  }

  const drafts = docs.filter(d => d.status === 'draft')

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="flex items-center justify-between mb-5 gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-gray-800">Import kirim (hujjat)</h1>
          <p className="text-sm text-gray-500">Valyuta + kurs, bojxona va qo'shimcha xarajatlar, yig'im → to'liq tannarx</p>
        </div>
        <button onClick={() => { if (session) setSession(null); else open('new', null, emptyForm(warehouses.length === 1 ? warehouses[0].id : '', wageStr)) }}
          className="flex items-center gap-2 px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 text-white text-sm font-medium">
          {session ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />} {session ? 'Yopish' : 'Yangi kirim hujjati'}
        </button>
      </div>

      <LevyPanel rates={levies} minimumWage={wageSaved} isAdmin={isAdmin} onChanged={fetchLevies} />

      {session && (
        <PurchaseDocForm
          key={session.key} mode={session.mode} docId={session.docId} initial={session.initial}
          warehouses={warehouses} suppliers={suppliers} products={products} levies={levies} wageSaved={wageSaved}
          onDone={() => { setSession(null); fetchDocs() }} onCancel={() => setSession(null)}
        />
      )}

      {!session && drafts.length > 0 && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 text-sm text-amber-900 flex items-center gap-2">
          <PlayCircle className="w-4 h-4" /> Tugallanmagan <b>{drafts.length}</b> ta kirim qoralamasi bor — pastda «Davom ettirish» ni bosing.
        </div>
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
                <th className="text-left px-4 py-2.5 font-medium">Hujjat</th>
                <th className="text-left px-4 py-2.5 font-medium">Yetkazib beruvchi</th>
                <th className="text-right px-4 py-2.5 font-medium">Tovar</th>
                <th className="text-right px-4 py-2.5 font-medium">Bojxona</th>
                <th className="text-right px-4 py-2.5 font-medium">Qo'shimcha</th>
                <th className="text-right px-4 py-2.5 font-medium">Yig'im</th>
                <th className="text-right px-4 py-2.5 font-medium">Jami xarajat</th>
                <th className="text-right px-4 py-2.5 font-medium">Tannarx (so'm)</th>
                <th className="text-right px-4 py-2.5 font-medium">Amal</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {docs.map(d => {
                const isDraft = d.status === 'draft'
                return (
                  <tr key={d.id} className={d.status === 'cancelled' ? 'opacity-50' : isDraft ? 'bg-amber-50/40' : ''}>
                    <td className="px-4 py-2.5">
                      <div className="font-medium text-gray-800">{isDraft ? 'Qoralama' : d.number || '—'}
                        {isDraft && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-amber-100 text-amber-800">tugallanmagan</span>}
                        {d.status === 'cancelled' && <span className="ml-2 text-xs px-2 py-0.5 rounded-full bg-red-50 text-red-700">Bekor</span>}
                      </div>
                      <div className="text-xs text-gray-400 savdo-num">{formatDate(isDraft ? d.updatedAt : d.createdAt)}{d.invoiceNumber ? ` · invoys ${d.invoiceNumber}` : ''} · {d.lineCount} qator</div>
                    </td>
                    <td className="px-4 py-2.5 text-gray-500">{d.supplierName || '—'}</td>
                    {isDraft ? (
                      <td colSpan={6} className="px-4 py-2.5 text-xs text-gray-400">Hisob-kitob kirim qilinganda chiqadi</td>
                    ) : (
                      <>
                        <td className="px-4 py-2.5 text-right savdo-num">{fmtMoney(d.goodsLocal)}</td>
                        <td className="px-4 py-2.5 text-right savdo-num text-blue-700">{d.customs ? fmtMoney(d.customs) : '—'}</td>
                        <td className="px-4 py-2.5 text-right savdo-num">{d.other ? fmtMoney(d.other) : '—'}</td>
                        <td className="px-4 py-2.5 text-right savdo-num">{d.levy ? fmtMoney(d.levy) : '—'}</td>
                        <td className="px-4 py-2.5 text-right savdo-num">
                          <b>{fmtMoney(d.extra)}</b><div className="text-[11px] text-gray-400">{d.extraPct}%</div>
                        </td>
                        <td className="px-4 py-2.5 text-right savdo-num font-semibold text-gray-900">{fmtMoney(d.landed)}</td>
                      </>
                    )}
                    <td className="px-4 py-2.5 text-right">
                      <div className="inline-flex items-center gap-3">
                        {isDraft ? (
                          <>
                            <button title="Davom ettirish" onClick={() => continueDraft(d.id)} className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 text-xs font-medium"><PlayCircle className="w-4 h-4" /> Davom ettirish</button>
                            <RowMenu items={[{ label: "Qoralamani o'chirish", icon: <Trash2 className="w-4 h-4" />, danger: true, onClick: () => removeDraft(d.id) }]} />
                          </>
                        ) : (
                          <>
                            <button title="Chop etish" onClick={() => openPrint(`/purchase-docs/${d.id}/print`)} className="text-gray-500 hover:text-gray-700"><Printer className="w-4 h-4" /></button>
                            <button title="Excel" onClick={() => downloadFile(`/purchase-docs/${d.id}/export.xlsx`, 'kirim-hujjati.xlsx')} className="text-gray-500 hover:text-gray-700"><Download className="w-4 h-4" /></button>
                            {isAdmin && d.status === 'completed' && (
                              <RowMenu items={[
                                { label: 'Tahrirlash (qator, narx, xarajat)', icon: <Pencil className="w-4 h-4" />, onClick: () => startEdit(d.id) },
                                { label: "Ma'lumotni tuzatish (invoys, izoh)", icon: <Wrench className="w-4 h-4" />, onClick: () => setMetaDoc(d) },
                                { label: 'Bekor qilish', icon: <Ban className="w-4 h-4" />, danger: true, onClick: () => setCancelTarget(d) },
                              ]} />
                            )}
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      <Pager page={page} totalPages={meta.totalPages} total={meta.total} onChange={setPage} />

      {cancelTarget && (
        <ReasonDialog
          title={`Import kirimni bekor qilish — ${cancelTarget.number || ''}`}
          description="Tovar ombor qoldig'idan ayriladi va tannarx qatlami yopiladi. Faqat hech narsa sotilmagan bo'lsa bajariladi. Hujjat o'chmaydi, 'Bekor' holatida qoladi."
          confirmLabel="Bekor qilish" danger onConfirm={doCancel} onClose={() => setCancelTarget(null)}
        />
      )}
      {metaDoc && <MetaDialog doc={metaDoc} suppliers={suppliers} onClose={() => setMetaDoc(null)} onSaved={() => { setMetaDoc(null); fetchDocs() }} />}
    </div>
  )
}

// Kirim qilingan hujjat ma'lumotini tuzatish: ombor/tannarxga tegmaydi, shuning uchun tovar sotilgan bo'lsa ham mumkin
function MetaDialog({ doc, suppliers, onClose, onSaved }: { doc: DocRow; suppliers: Option[]; onClose: () => void; onSaved: () => void }) {
  const [invoiceNumber, setInvoiceNumber] = useState(doc.invoiceNumber ?? '')
  const [supplierId, setSupplierId] = useState('')
  const [notes, setNotes] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    savdoApi.get(`/purchase-docs/${doc.id}`).then(r => { setSupplierId(r.data.data.supplierId ?? ''); setNotes(r.data.data.notes ?? '') }).catch(() => {})
  }, [doc.id])

  async function save() {
    if (reason.trim().length < 5) { toast.error('Sababni yozing (kamida 5 belgi)'); return }
    setSaving(true)
    try {
      await savdoApi.put(`/purchase-docs/${doc.id}/meta`, { invoiceNumber: invoiceNumber.trim() || null, supplierId: supplierId || null, notes: notes.trim() || null, reason: reason.trim() })
      toast.success("Ma'lumot tuzatildi"); onSaved()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">Ma'lumotni tuzatish — {doc.number}</h2>
        <p className="text-xs text-gray-500">Ombor, miqdor va tannarxga tegmaydi. Qatorlar/narx/xarajatni o'zgartirish uchun «Tahrirlash» (tovar sotilmagan bo'lsa).</p>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Invoys / faktura №</label>
          <input className={`${inp} w-full`} value={invoiceNumber} onChange={e => setInvoiceNumber(e.target.value)} /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Yetkazib beruvchi</label>
          <select className={`${inp} w-full`} value={supplierId} onChange={e => setSupplierId(e.target.value)}>
            <option value="">—</option>{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Izoh</label>
          <input className={`${inp} w-full`} value={notes} onChange={e => setNotes(e.target.value)} /></div>
        <div><label className="block text-xs font-medium text-gray-600 mb-1">Tuzatish sababi (majburiy — audit jurnaliga yoziladi)</label>
          <textarea rows={2} className={`${inp} w-full`} value={reason} onChange={e => setReason(e.target.value)} /></div>
        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Bekor</button>
          <button onClick={save} disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white font-medium">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
          </button>
        </div>
      </div>
    </div>
  )
}
