import { useState } from 'react'
import { ChevronDown, ChevronRight, Loader2, Pencil, Plus, Check, X } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import { fmtMoney } from '../lib/docs'

export interface Levy { id: string; name: string; basis: 'per_kg' | 'per_unit'; percent: number; isActive: boolean }

const BASIS_LABEL = { per_kg: 'har bir kg uchun', per_unit: 'har bir dona uchun' }
const inp = 'px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'

interface Props {
  rates: Levy[]
  minimumWage: number | null
  isAdmin: boolean
  onChanged: () => void
}

// Yig'imlar (utilizatsiya va shunga o'xshash) sozlamasi. Stavka = eng kam oylik ish haqining
// foizi, har bir kg yoki dona uchun. Tovar turiga qotirilmagan: xohlagancha tur qo'shiladi.
export default function LevyPanel({ rates, minimumWage, isAdmin, onChanged }: Props) {
  const [open, setOpen] = useState(false)
  const [wage, setWage] = useState(minimumWage != null ? String(minimumWage) : '')
  const [savingWage, setSavingWage] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [basis, setBasis] = useState<'per_kg' | 'per_unit'>('per_kg')
  const [percent, setPercent] = useState('')
  const [saving, setSaving] = useState(false)

  function startEdit(r: Levy | null) {
    setEditId(r?.id ?? 'new'); setName(r?.name ?? ''); setBasis(r?.basis ?? 'per_kg'); setPercent(r ? String(r.percent) : '')
  }

  async function saveWage() {
    setSavingWage(true)
    try {
      await savdoApi.put('/levies/min-wage', { minimumWage: wage === '' ? null : Number(wage) })
      toast.success('Eng kam oylik ish haqi saqlandi'); onChanged()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
    finally { setSavingWage(false) }
  }

  async function saveRate() {
    if (!name.trim()) { toast.error('Nomini kiriting'); return }
    if (percent === '' || Number(percent) < 0) { toast.error('Foizni kiriting'); return }
    setSaving(true)
    try {
      const body = { name: name.trim(), basis, percent: Number(percent) }
      if (editId === 'new') await savdoApi.post('/levies', body)
      else await savdoApi.put(`/levies/${editId}`, body)
      toast.success('Saqlandi'); setEditId(null); onChanged()
    } catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
    finally { setSaving(false) }
  }

  async function toggle(r: Levy) {
    try { await savdoApi.put(`/levies/${r.id}`, { isActive: !r.isActive }); onChanged() }
    catch (err: any) { toast.error(err?.response?.data?.error || 'Xato yuz berdi') }
  }

  const mw = minimumWage ?? 0

  return (
    <div className="bg-white border border-gray-200 rounded-xl mb-5">
      <button type="button" onClick={() => setOpen(v => !v)} className="w-full flex items-center gap-2 px-4 py-3 text-left">
        {open ? <ChevronDown className="w-4 h-4 text-gray-400" /> : <ChevronRight className="w-4 h-4 text-gray-400" />}
        <span className="text-sm font-medium text-gray-800">Yig'imlar (utilizatsiya va shunga o'xshash)</span>
        <span className="text-xs text-gray-400 ml-auto">
          {minimumWage ? `eng kam oylik: ${fmtMoney(minimumWage)} so'm` : 'eng kam oylik kiritilmagan'} · {rates.length} ta tur
        </span>
      </button>

      {open && (
        <div className="px-4 pb-4 space-y-4 border-t border-gray-100 pt-3">
          <p className="text-xs text-gray-500">
            Stavka = eng kam oylik ish haqining belgilangan <b>foizi</b>, har bir <b>kilogramm</b> yoki <b>dona</b> uchun. Kirim hujjatida har qatorga
            kerakli tur tanlanadi va summa avtomatik tannarxga qo'shiladi. Foizni o'zgartirsangiz, avvalgi hujjatlar o'zgarmaydi.
          </p>

          <div className="flex items-end gap-2 flex-wrap">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Eng kam oylik ish haqi (so'm)</label>
              <input type="number" min="0" step="any" disabled={!isAdmin} className={`${inp} w-48`} value={wage} onChange={e => setWage(e.target.value)} />
            </div>
            {isAdmin && (
              <button type="button" onClick={saveWage} disabled={savingWage} className="px-3 py-2 rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white text-sm font-medium">
                {savingWage ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
              </button>
            )}
            {!isAdmin && <span className="text-xs text-gray-400">o'zgartirish — faqat admin</span>}
          </div>

          <table className="w-full text-sm">
            <thead className="text-xs text-gray-500 uppercase">
              <tr><th className="text-left py-1 font-medium">Tur</th><th className="text-left py-1 font-medium">Asos</th>
                <th className="text-right py-1 font-medium">Foiz</th><th className="text-right py-1 font-medium">Stavka</th><th /></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rates.map(r => (
                <tr key={r.id} className={r.isActive ? '' : 'opacity-50'}>
                  <td className="py-2 font-medium text-gray-800">{r.name}</td>
                  <td className="py-2 text-gray-500">{BASIS_LABEL[r.basis]}</td>
                  <td className="py-2 text-right savdo-num">{r.percent}%</td>
                  <td className="py-2 text-right savdo-num text-gray-600">{mw ? `${fmtMoney((mw * r.percent) / 100)} so'm/${r.basis === 'per_kg' ? 'kg' : 'dona'}` : '—'}</td>
                  <td className="py-2 text-right">
                    {isAdmin && (
                      <span className="inline-flex gap-3">
                        <button type="button" onClick={() => startEdit(r)} className="text-amber-700"><Pencil className="w-3.5 h-3.5" /></button>
                        <button type="button" onClick={() => toggle(r)} className="text-xs text-gray-500 hover:text-gray-700">{r.isActive ? "O'chirish" : 'Yoqish'}</button>
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {rates.length === 0 && <tr><td colSpan={5} className="py-4 text-center text-gray-400">Hali yig'im turi yo'q</td></tr>}
            </tbody>
          </table>

          {isAdmin && (editId ? (
            <div className="flex items-end gap-2 flex-wrap bg-amber-50/50 border border-amber-200 rounded-lg p-3">
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Nomi</label>
                <input className={`${inp} w-56`} value={name} onChange={e => setName(e.target.value)} placeholder="Masalan: Utilizatsiya yig'imi" /></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Asos</label>
                <select className={inp} value={basis} onChange={e => setBasis(e.target.value as any)}>
                  <option value="per_kg">Har bir kg uchun</option><option value="per_unit">Har bir dona uchun</option>
                </select></div>
              <div><label className="block text-xs font-medium text-gray-600 mb-1">Eng kam oylikdan, %</label>
                <input type="number" min="0" step="any" className={`${inp} w-32`} value={percent} onChange={e => setPercent(e.target.value)} /></div>
              <button type="button" onClick={saveRate} disabled={saving} className="p-2 rounded-lg bg-amber-700 text-white disabled:opacity-60">
                {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              </button>
              <button type="button" onClick={() => setEditId(null)} className="p-2 rounded-lg border border-gray-300 text-gray-500"><X className="w-4 h-4" /></button>
            </div>
          ) : (
            <button type="button" onClick={() => startEdit(null)} className="inline-flex items-center gap-1.5 text-sm text-amber-700 font-medium">
              <Plus className="w-4 h-4" /> Yig'im turi qo'shish
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
