// Savolga shu yerning o'zida javob berish — mavjud API'lar orqali saqlanadi
// (dvigatel pasporti, moy almashtirish, mashina maydonlari). Saqlangach savol yo'qoladi.
import { useState } from 'react'
import toast from 'react-hot-toast'
import { Check } from 'lucide-react'
import api from '../../lib/api'
import Button from '../ui/Button'
import type { Finding, QuickAction } from './parts'

const today = () => new Date(Date.now() + 5 * 3600 * 1000).toISOString().slice(0, 10)
const inputCls = 'w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-800 px-2.5 py-1.5 text-sm'
const errText = (e: any) => e?.response?.data?.error || e?.response?.data?.message || 'Saqlab bo\'lmadi'

const STATUS_LABEL: Record<string, string> = { active: 'Faol', maintenance: "Ta'mirda", inactive: 'Nofaol' }
const RECORD_TYPES: Array<[string, string]> = [['overhaul', "Kapital ta'mir"], ['major_repair', "Yirik ta'mir"], ['minor_repair', "Kichik ta'mir"], ['inspection', "Ko'rik"]]
const SERVICE_LABEL: Record<string, string> = { oil_change: 'Motor moyi', air_filter: 'Havo filtri', fuel_filter: "Yoqilg'i filtri" }

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="block text-xs text-gray-500 dark:text-gray-400 mb-0.5">{label}</span>
      {children}
    </label>
  )
}

export default function QuickForm({ finding, onDone, onCancel }: { finding: Finding; onDone: () => void; onCancel: () => void }) {
  const q = finding.quick as QuickAction
  const vid = finding.vehicleId!
  const [saving, setSaving] = useState(false)
  const [warning, setWarning] = useState<string | null>(null)

  // Har bir tur uchun maydonlar
  const [date, setDate] = useState<string>(q.kind === 'engine_record' ? q.prefill.date || today() : q.kind === 'oil_change' ? q.prefill.date || today() : '')
  const [km, setKm] = useState<string>(q.kind === 'engine_record' ? String(q.prefill.mileage ?? '') : q.kind === 'oil_change' ? String(q.prefill.km ?? '') : '')
  const [cost, setCost] = useState<string>(q.kind === 'engine_record' ? String(q.prefill.cost ?? '') : '')
  const [recordType, setRecordType] = useState<string>(q.kind === 'engine_record' ? q.prefill.recordType || 'major_repair' : '')
  const [description, setDescription] = useState<string>(q.kind === 'engine_record' ? q.prefill.description || '' : '')
  const [value, setValue] = useState<string>(q.kind === 'vehicle_number' ? String(q.prefill ?? '') : '')
  const [status, setStatus] = useState<string>(q.kind === 'vehicle_status' ? q.suggest : '')

  async function save(force = false) {
    setSaving(true)
    try {
      if (q.kind === 'engine_record') {
        if (!km || !date || !description.trim()) { toast.error("Sana, km va tavsif majburiy"); return }
        await api.post('/engine-records', { vehicleId: vid, recordType, mileage: km, date, description: description.trim(), cost: cost || '0' })
      } else if (q.kind === 'oil_change') {
        const res = await api.post('/oil-change/record', { vehicleId: vid, serviceType: q.serviceType, servicedAt: date, servicedAtKm: km || undefined, force }, { validateStatus: s => s < 300 || s === 409 })
        if (res.status === 409) { setWarning(res.data?.message || 'Ogohlantirish'); return }
      } else if (q.kind === 'vehicle_date') {
        if (!value) { toast.error('Sanani tanlang'); return }
        await api.put(`/vehicles/${vid}`, { [q.field]: value })
      } else if (q.kind === 'vehicle_number') {
        if (!value || Number(value) <= 0) { toast.error("Musbat son kiriting"); return }
        await api.put(`/vehicles/${vid}`, { [q.field]: value })
      } else if (q.kind === 'vehicle_status') {
        await api.put(`/vehicles/${vid}`, { status })
      }
      toast.success('Saqlandi — savol qayta tekshirilmoqda')
      onDone()
    } catch (e) {
      toast.error(errText(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="mt-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-900/20 p-3 space-y-2">
      {q.kind === 'engine_record' && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <Field label="Turi">
            <select className={inputCls} value={recordType} onChange={e => setRecordType(e.target.value)}>
              {RECORD_TYPES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Field>
          <Field label="Sana"><input type="date" className={inputCls} value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Probeg, km"><input type="number" className={inputCls} value={km} onChange={e => setKm(e.target.value)} /></Field>
          <Field label="Narx, so'm"><input type="number" className={inputCls} value={cost} onChange={e => setCost(e.target.value)} /></Field>
          <div className="col-span-2 sm:col-span-4">
            <Field label="Nima qilindi"><input className={inputCls} value={description} onChange={e => setDescription(e.target.value)} maxLength={300} /></Field>
          </div>
        </div>
      )}

      {q.kind === 'oil_change' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={`${SERVICE_LABEL[q.serviceType]} almashtirilgan sana`}><input type="date" className={inputCls} value={date} max={today()} onChange={e => setDate(e.target.value)} /></Field>
          <Field label="Probeg, km (bo'sh — joriy)"><input type="number" className={inputCls} value={km} onChange={e => setKm(e.target.value)} /></Field>
        </div>
      )}

      {q.kind === 'vehicle_date' && (
        <Field label={q.label}><input type="date" className={inputCls} value={value} onChange={e => setValue(e.target.value)} /></Field>
      )}

      {q.kind === 'vehicle_number' && (
        <Field label={`${q.label}, ${q.unit}`}><input type="number" step="0.1" className={inputCls} value={value} onChange={e => setValue(e.target.value)} /></Field>
      )}

      {q.kind === 'vehicle_status' && (
        <Field label="Mashina holati">
          <select className={inputCls} value={status} onChange={e => setStatus(e.target.value)}>
            {Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
          </select>
        </Field>
      )}

      {warning && (
        <div className="text-sm text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900/30 rounded-md p-2">
          {warning}
          <div className="mt-1.5"><Button size="sm" variant="outline" loading={saving} onClick={() => save(true)}>Baribir saqlash</Button></div>
        </div>
      )}

      <div className="flex gap-2 justify-end">
        <Button size="sm" variant="ghost" onClick={onCancel}>Bekor</Button>
        <Button size="sm" loading={saving} icon={<Check className="w-3.5 h-3.5" />} onClick={() => save(false)}>Saqlash</Button>
      </div>
    </div>
  )
}
