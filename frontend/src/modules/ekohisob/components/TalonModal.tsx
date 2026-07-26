import { useState, useEffect } from 'react'
import { X, Loader2, Plus, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'

// Talon rejimidagi tashkilotning bajarilgan ishlari (kub x narx).
// EntitiesPage.tsx dan ajratildi — u fayl 1200+ qatorga yetgan edi.
export interface TalonEntity {
  id: string
  name: string
  cubicPrice?: number
}

// ─── Talon ro'yxati va qo'shish (talon asosida — kub × narx) ─────────────────
interface Talon { id: string; volume: number; amount: number; date: string; note?: string; paid: boolean }

export default function TalonModal({ entity, onClose, readOnly = false }: { entity: TalonEntity; onClose: () => void; readOnly?: boolean }) {
  const [talons, setTalons] = useState<Talon[]>([])
  const [total, setTotal] = useState(0)
  const [totalUnpaid, setTotalUnpaid] = useState(0)
  const [totalVolume, setTotalVolume] = useState(0)
  const [cubicPrice, setCubicPrice] = useState(entity.cubicPrice || 0)
  const [loading, setLoading] = useState(false)
  // Davr filtri (oy) — '' = barchasi
  const [filterMonth, setFilterMonth] = useState('')
  // Yangi talon formasi
  const [volume, setVolume] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().split('T')[0])
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)

  const fmt = (n: number) => n.toLocaleString('uz-UZ')

  function load() {
    setLoading(true)
    let url = `/talons?entityId=${entity.id}`
    if (filterMonth) {
      url += `&from=${filterMonth}-01&to=${filterMonth}-31`
    }
    ekoApi.get(url).then(res => {
      const d = res.data.data ?? res.data
      setTalons(d.talons || [])
      setTotal(d.total || 0)
      setTotalUnpaid(d.totalUnpaid || 0)
      setTotalVolume(d.totalVolume || 0)
    }).catch(() => {}).finally(() => setLoading(false))
    ekoApi.get(`/entities/${entity.id}`).then(res => {
      const d = res.data.data ?? res.data
      setCubicPrice(d.cubicPrice || 0)
    }).catch(() => {})
  }
  useEffect(load, [entity.id, filterMonth])

  const previewAmount = volume && cubicPrice ? Math.round(parseFloat(volume) * cubicPrice) : 0

  async function addTalon() {
    const v = parseFloat(volume)
    if (!v || v <= 0) { toast.error('Kub (hajm) kiriting'); return }
    if (cubicPrice <= 0) { toast.error('Avval tashkilotga bir kub narxini belgilang'); return }
    setSaving(true)
    try {
      await ekoApi.post('/talons', { entityId: entity.id, volume: v, date, note: note.trim() || undefined })
      toast.success('Talon qo\'shildi')
      setVolume(''); setNote('')
      load()
    } catch (e: any) {
      toast.error(e.response?.data?.error || 'Xato')
    } finally { setSaving(false) }
  }

  // "To'landi" belgilash endi RASMIY to'lov + kvitansiya yaratadi (oldin shunchaki
  // bayroq edi va talon puli hisobotlarda umuman ko'rinmasdi). Shuning uchun tasdiq so'raladi.
  async function togglePaid(t: Talon) {
    const msg = t.paid
      ? `To'lov bekor qilinsinmi? ${fmt(t.amount)} so'mlik to'lov va kvitansiyasi o'chiriladi, talon qarzga qaytadi.`
      : `${fmt(t.amount)} so'm to'lov qabul qilinsinmi? Kvitansiya chiqariladi va summa kunlik yig'imga qo'shiladi.`
    if (!window.confirm(msg)) return
    try {
      const res = await ekoApi.patch(`/talons/${t.id}`, { paid: !t.paid })
      const receiptNumber = res.data?.data?.receiptNumber
      toast.success(
        t.paid
          ? 'To\'lov bekor qilindi'
          : receiptNumber ? `To'lov qabul qilindi · ${receiptNumber}` : 'To\'lov qabul qilindi',
      )
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Xato') }
  }

  async function removeTalon(t: Talon) {
    const msg = t.paid
      ? `Talon o'chirilsinmi? U to'langan — ${fmt(t.amount)} so'mlik to'lov ham bekor qilinadi.`
      : 'Talon o\'chirilsinmi?'
    if (!window.confirm(msg)) return
    try {
      await ekoApi.delete(`/talons/${t.id}`)
      toast.success('O\'chirildi')
      load()
    } catch (e: any) { toast.error(e.response?.data?.error || 'Xato') }
  }

  return (
    <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-3 border-b border-gray-100 shrink-0">
          <div>
            <h3 className="font-semibold text-gray-900">📋 Talonlar — {entity.name}</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              Bir kub narxi: <b>{fmt(cubicPrice)} so'm</b>
              {cubicPrice <= 0 && <span className="text-red-500"> — belgilanmagan!</span>}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-lg text-gray-400"><X className="w-4 h-4" /></button>
        </div>

        {/* Davr filtri */}
        <div className="px-5 py-2 border-b border-gray-100 flex items-center gap-2">
          <span className="text-xs text-gray-500">Davr:</span>
          <input type="month" value={filterMonth} onChange={e => setFilterMonth(e.target.value)}
            className="px-2 py-1 text-sm border border-gray-200 rounded-lg" />
          {filterMonth && (
            <button onClick={() => setFilterMonth('')} className="text-xs text-blue-600 hover:underline">Barchasi</button>
          )}
        </div>

        {/* Hisob xulosa */}
        <div className="grid grid-cols-3 gap-2 px-5 py-3 border-b border-gray-100">
          <div className="bg-blue-50 rounded-lg p-2.5">
            <p className="text-xs text-blue-500">Jami hajm</p>
            <p className="text-base font-bold text-blue-700">{totalVolume.toFixed(1)} <span className="text-xs font-normal">m³</span></p>
          </div>
          <div className="bg-gray-50 rounded-lg p-2.5">
            <p className="text-xs text-gray-500">Jami summa</p>
            <p className="text-base font-bold text-gray-800">{fmt(total)}</p>
          </div>
          <div className="bg-red-50 rounded-lg p-2.5">
            <p className="text-xs text-red-500">To'lanmagan</p>
            <p className="text-base font-bold text-red-700">{fmt(totalUnpaid)}</p>
          </div>
        </div>

        {/* Yangi talon — faqat yozish huquqi borlar uchun */}
        {!readOnly && (
        <div className="px-5 py-3 border-b border-gray-100 bg-amber-50/40">
          <p className="text-xs font-semibold text-gray-600 mb-2">➕ Yangi talon (bajarilgan ish)</p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Sana</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Kub (m³)</label>
              <input type="number" step="0.1" value={volume} onChange={e => setVolume(e.target.value)}
                placeholder="3.5" className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
            </div>
            <div>
              <label className="text-[11px] text-gray-500 block mb-0.5">Summa</label>
              <div className="px-2 py-1.5 text-sm bg-gray-100 rounded-lg text-gray-700 font-medium">{fmt(previewAmount)}</div>
            </div>
          </div>
          <input value={note} onChange={e => setNote(e.target.value)} placeholder="Izoh (ixtiyoriy)"
            className="w-full mt-2 px-2 py-1.5 text-sm border border-gray-200 rounded-lg" />
          <button onClick={addTalon} disabled={saving || cubicPrice <= 0}
            className="w-full mt-2 flex items-center justify-center gap-1.5 px-3 py-2 bg-amber-500 hover:bg-amber-600 text-white rounded-lg text-sm font-medium disabled:opacity-50">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
            Talon qo'shish
          </button>
        </div>
        )}

        {/* Ro'yxat */}
        <div className="overflow-y-auto flex-1 p-3">
          {loading ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
          ) : talons.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-8">Hali talon yo'q</p>
          ) : (
            <div className="space-y-1.5">
              {talons.map(t => (
                <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-gray-50">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-800">{t.volume} m³ · {fmt(t.amount)} so'm</p>
                    <p className="text-xs text-gray-400">{new Date(t.date).toLocaleDateString('uz-UZ')}{t.note ? ` · ${t.note}` : ''}</p>
                  </div>
                  <button onClick={() => !readOnly && togglePaid(t)} disabled={readOnly}
                    className={`text-xs px-2 py-1 rounded-full font-medium ${t.paid ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'} ${readOnly ? 'cursor-default' : ''}`}>
                    {t.paid ? '✓ To\'langan' : 'To\'lanmagan'}
                  </button>
                  {!readOnly && (
                    <button onClick={() => removeTalon(t)} className="p-1 text-gray-300 hover:text-red-500">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
