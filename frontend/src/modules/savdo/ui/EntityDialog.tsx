import { useState, useEffect } from 'react'
import { Pencil, X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import savdoApi from '../lib/savdoApi'
import { useSavdoPerms } from '../lib/useSavdoAdmin'

// Bitta umumiy yaratish/tahrirlash oynasi — mahsulot, mijoz, yetkazib beruvchi,
// xarajat va ombor uchun. Maydonlar ENTITY_FIELDS'da; sahifalar faqat
// <EditButton> yoki <EntityDialog> chaqiradi (har sahifada alohida forma yozilmaydi).

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'checkbox' | 'textarea'
export interface FieldDef {
  key: string
  label: string
  type?: FieldType
  options?: { value: string; label: string }[]
  full?: boolean
  required?: boolean
  showIf?: (v: Record<string, any>) => boolean
  /** Variantlar serverdan olinadi (bo'sh qiymat = "yo'q") */
  optionsFrom?: { url: string; pick: (data: any) => { value: string; label: string }[]; blank: string }
}

const CATEGORY_OPTIONS = [
  ['ijara', 'Ijara'], ['transport', 'Transport'], ['ish_haqi', 'Ish haqi'],
  ['kommunal', 'Kommunal'], ['soliq', 'Soliq'], ['boshqa', 'Boshqa'],
].map(([value, label]) => ({ value, label }))

const legal = (v: Record<string, any>) => Boolean(v.isLegal)

export const ENTITY_FIELDS: Record<string, { title: string; endpoint: string; manageCap: string; fields: FieldDef[] }> = {
  product: {
    title: 'Mahsulot', endpoint: '/products', manageCap: 'products.manage',
    fields: [
      { key: 'name', label: 'Nomi', required: true },
      { key: 'category', label: 'Kategoriya' },
      { key: 'unit', label: 'Birlik (dona, kg, m ...)' },
      { key: 'wholesalePrice', label: 'Optom narx', type: 'number' },
      { key: 'retailPrice', label: 'Chakana narx', type: 'number' },
      { key: 'weightKg', label: "Bir birlik og'irligi, kg (kg bo'yicha yig'im uchun)", type: 'number' },
      {
        key: 'levyRateId', label: "Standart yig'im turi (utilizatsiya va h.k.)", type: 'select',
        optionsFrom: { url: '/levies', blank: "— yo'q —", pick: d => (d.rates ?? []).filter((r: any) => r.isActive).map((r: any) => ({ value: r.id, label: r.name })) },
      },
    ],
  },
  customer: {
    title: 'Mijoz', endpoint: '/customers', manageCap: 'customers.manage',
    fields: [
      { key: 'name', label: 'Nomi', required: true },
      { key: 'phone', label: 'Telefon' },
      { key: 'address', label: 'Manzil' },
      { key: 'priceTier', label: 'Narx toifasi', type: 'select', options: [{ value: 'retail', label: 'Chakana' }, { value: 'wholesale', label: 'Optom' }] },
      { key: 'isLegal', label: 'Yuridik shaxs (spetsifikatsiya uchun rekvizitlar)', type: 'checkbox', full: true },
      { key: 'stir', label: 'STIR (INN)', showIf: legal },
      { key: 'director', label: 'Direktor', showIf: legal },
      { key: 'bankName', label: 'Bank', showIf: legal },
      { key: 'bankAccount', label: 'Hisob raqami (h/r)', showIf: legal },
      { key: 'mfo', label: 'MFO', showIf: legal },
      { key: 'contractNumber', label: 'Shartnoma №', showIf: legal },
      { key: 'contractDate', label: 'Shartnoma sanasi', type: 'date', showIf: legal },
    ],
  },
  supplier: {
    title: 'Yetkazib beruvchi', endpoint: '/suppliers', manageCap: 'suppliers.manage',
    fields: [
      { key: 'name', label: 'Nomi', required: true },
      { key: 'contactPerson', label: 'Kontakt shaxs' },
      { key: 'phone', label: 'Telefon' },
      { key: 'address', label: 'Manzil' },
    ],
  },
  expense: {
    title: 'Xarajat', endpoint: '/expenses', manageCap: 'expenses.manage',
    fields: [
      { key: 'category', label: 'Kategoriya', type: 'select', options: CATEGORY_OPTIONS, required: true },
      { key: 'amount', label: 'Summa', type: 'number', required: true },
      { key: 'spentAt', label: 'Sana', type: 'date' },
      { key: 'note', label: 'Izoh', type: 'textarea', full: true },
    ],
  },
  purchase: {
    title: 'Kirim', endpoint: '/purchases', manageCap: 'purchases.cancel',
    fields: [
      { key: 'quantity', label: "Miqdor (faqat sotilmagan kirimda o'zgaradi)", type: 'number' },
      { key: 'unitCost', label: "Birlik tannarx (so'm)", type: 'number' },
      { key: 'invoiceNumber', label: 'Faktura raqami' },
      { key: 'notes', label: 'Izoh', type: 'textarea', full: true },
      { key: 'isOfficial', label: 'Rasmiy (fakturali)', type: 'checkbox', full: true },
    ],
  },
  warehouse: {
    title: 'Ombor', endpoint: '/warehouses', manageCap: 'warehouses.manage',
    fields: [
      { key: 'name', label: 'Nomi', required: true },
      { key: 'location', label: 'Manzil' },
    ],
  },
}

function initialValues(fields: FieldDef[], row: Record<string, any> | null): Record<string, any> {
  const v: Record<string, any> = {}
  for (const f of fields) {
    const raw = row?.[f.key]
    if (f.type === 'checkbox') v[f.key] = Boolean(raw)
    else if (f.type === 'date') v[f.key] = raw ? String(raw).slice(0, 10) : ''
    else if (f.type === 'select') v[f.key] = raw ?? f.options?.[0]?.value ?? ''
    else v[f.key] = raw ?? ''
  }
  return v
}

const inputCls = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600'

interface DialogProps {
  entity: keyof typeof ENTITY_FIELDS
  row: Record<string, any> | null   // null — yangi yozuv
  onClose: () => void
  onSaved: () => void
  extraPayload?: Record<string, any>
}

export function EntityDialog({ entity, row, onClose, onSaved, extraPayload }: DialogProps) {
  const cfg = ENTITY_FIELDS[entity]
  const [values, setValues] = useState(() => initialValues(cfg.fields, row))
  const [saving, setSaving] = useState(false)
  const [dyn, setDyn] = useState<Record<string, { value: string; label: string }[]>>({})
  const isNew = !row

  useEffect(() => {
    cfg.fields.filter(f => f.optionsFrom).forEach(f => {
      savdoApi.get(f.optionsFrom!.url).then(r => setDyn(d => ({ ...d, [f.key]: f.optionsFrom!.pick(r.data.data) }))).catch(() => {})
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    for (const f of cfg.fields) {
      if (f.required && (values[f.key] === '' || values[f.key] == null)) { toast.error(`"${f.label}" to'ldirilishi shart`); return }
    }
    const payload: Record<string, any> = { ...extraPayload }
    for (const f of cfg.fields) {
      const v = values[f.key]
      if (f.type === 'number') { if (v !== '') payload[f.key] = Number(v) }
      else if (f.type === 'checkbox') payload[f.key] = Boolean(v)
      else if (f.optionsFrom && v === '') payload[f.key] = null
      else payload[f.key] = typeof v === 'string' ? v.trim() : v
    }
    setSaving(true)
    try {
      if (isNew) await savdoApi.post(cfg.endpoint, payload)
      else await savdoApi.put(`${cfg.endpoint}/${row!.id}`, payload)
      toast.success(isNew ? 'Qo\'shildi' : 'Saqlandi')
      onSaved(); onClose()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Xato yuz berdi')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()}
        className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-gray-800">{cfg.title}: {isNew ? 'yangi' : 'tahrirlash'}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {cfg.fields.filter(f => !f.showIf || f.showIf(values)).map(f => (
            <div key={f.key} className={f.full || f.type === 'textarea' ? 'sm:col-span-2' : ''}>
              {f.type === 'checkbox' ? (
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={Boolean(values[f.key])} className="w-4 h-4 accent-amber-700"
                    onChange={e => setValues(v => ({ ...v, [f.key]: e.target.checked }))} />
                  {f.label}
                </label>
              ) : (
                <>
                  <label className="block text-xs font-medium text-gray-600 mb-1">{f.label}</label>
                  {f.type === 'select' ? (
                    <select className={inputCls} value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))}>
                      {(f.optionsFrom ? [{ value: '', label: f.optionsFrom.blank }, ...(dyn[f.key] ?? [])] : f.options!).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </select>
                  ) : f.type === 'textarea' ? (
                    <textarea rows={2} className={inputCls} value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
                  ) : (
                    <input className={inputCls} type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'}
                      step={f.type === 'number' ? 'any' : undefined} min={f.type === 'number' ? 0 : undefined}
                      value={values[f.key]} onChange={e => setValues(v => ({ ...v, [f.key]: e.target.value }))} />
                  )}
                </>
              )}
            </div>
          ))}
        </div>
        <div className="flex justify-end gap-2 mt-5">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Bekor</button>
          <button type="submit" disabled={saving} className="px-4 py-2 text-sm rounded-lg bg-amber-700 hover:bg-amber-800 disabled:opacity-60 text-white font-medium">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Saqlash'}
          </button>
        </div>
      </form>
    </div>
  )
}

/** Jadval qatoridagi "Tahrirlash" tugmasi — ruxsati yo'q rolga ko'rinmaydi. */
export function EditButton({ entity, row, onSaved }: { entity: keyof typeof ENTITY_FIELDS; row: Record<string, any>; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const can = useSavdoPerms()(ENTITY_FIELDS[entity].manageCap)
  if (!can) return null
  return (
    <>
      <button onClick={() => setOpen(true)} className="inline-flex items-center gap-1 text-amber-700 hover:text-amber-800 text-xs font-medium">
        <Pencil className="w-3.5 h-3.5" /> Tahrirlash
      </button>
      {open && <EntityDialog entity={entity} row={row} onClose={() => setOpen(false)} onSaved={onSaved} />}
    </>
  )
}
