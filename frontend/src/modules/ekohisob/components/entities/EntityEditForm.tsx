import { useState } from 'react'
import { CheckCircle2, MapPin } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { useDistricts, useMahallas } from '../../lib/queries'
import { Banner, Button, Field, Input, MonthInput, Select } from '../../ui'
import SoliqLookup from '../SoliqLookup'
import SimilarEntities from '../SimilarEntities'
import type { Card, EntityCardActions } from './cardTypes'

/** Tashkilotni tahrirlash. Chala (draft) tashkilot faqat "Saqlash va faollashtirish" bilan faol bo'ladi. */
export default function EntityEditForm({
  card, actions, onCancel, onSaved,
}: { card: Card; actions: EntityCardActions; onCancel: () => void; onSaved: () => void }) {
  const e = card.entity
  const isDraft = e.status === 'draft'
  const [form, setForm] = useState({
    name: e.name ?? '', code: e.code ?? '', stir: e.stir ?? '', address: e.address ?? '',
    phone: e.phone ?? '', contactName: e.contactName ?? '', contractNumber: e.contractNumber ?? '',
    contractStartMonth: e.contractStartMonth ?? '', districtId: e.districtId, mahallId: e.mahallId ?? '',
    billingMode: e.billingMode, monthlyFee: e.monthlyFee ? String(e.monthlyFee) : '',
    cubicPrice: e.cubicPrice ? String(e.cubicPrice) : '',
    status: e.status === 'inactive' ? 'inactive' : 'active',
    entityType: e.entityType ?? 'legal',
  })
  const [soliqSynced, setSoliqSynced] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const districts = useDistricts()
  const mahallas = useMahallas(form.districtId)
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const isTalon = form.billingMode === 'talon'

  const missing: string[] = []
  if (!form.name.trim()) missing.push('Nomi')
  if (!form.address.trim()) missing.push('Manzil')
  if (!form.districtId) missing.push('Tuman')
  if (isTalon ? !(parseInt(form.cubicPrice, 10) > 0) : !(parseInt(form.monthlyFee, 10) > 0)) {
    missing.push(isTalon ? 'Bir kub narxi' : "Oylik to'lov")
  }

  async function save(activate: boolean) {
    if (!form.name.trim()) { setError('Nomni kiriting'); return }
    if (activate && missing.length) { setError(`To'ldiring: ${missing.join(', ')}`); return }
    setSaving(true)
    setError(null)
    try {
      await ekoApi.put(`/entities/${e.id}`, {
        name: form.name.trim(), code: form.code, stir: form.stir, address: form.address,
        phone: form.phone, contactName: form.contactName, contractNumber: form.contractNumber,
        contractStartMonth: form.contractStartMonth || null,
        districtId: form.districtId, mahallId: form.mahallId || null, entityType: form.entityType,
        ...(soliqSynced ? { soliqSynced: true } : {}),
        billingMode: form.billingMode,
        monthlyFee: isTalon ? 0 : parseInt(form.monthlyFee, 10) || 0,
        cubicPrice: isTalon ? parseInt(form.cubicPrice, 10) || 0 : 0,
        ...(isDraft ? (activate ? { status: 'active' } : {}) : (e.status === 'blacklisted' ? {} : { status: form.status })),
      })
      toast.success(activate ? 'Tashkilot faollashtirildi' : 'Saqlandi')
      onSaved()
    } catch (err) {
      setError(errMsg(err))
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      {isDraft && (
        <Banner tone={missing.length ? 'warn' : 'success'}>
          {missing.length
            ? <>Faollashtirish uchun yetishmayapti: <b>{missing.join(', ')}</b></>
            : <>Majburiy maydonlar to'liq — tashkilotni faollashtirishingiz mumkin.</>}
        </Banner>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nomi" required className="sm:col-span-2">
          {id => <Input id={id} value={form.name} onChange={ev => set('name', ev.target.value)} />}
        </Field>
        <Field label="Tashkilot turi" hint={form.entityType === 'person' ? "Jismoniy shaxsda STIR bo'lmaydi" : undefined}>
          {id => (
            <Select id={id} value={form.entityType} onChange={ev => set('entityType', ev.target.value)}>
              <option value="legal">Yuridik shaxs (MChJ, QK...)</option>
              <option value="ip">YaTT / tadbirkor</option>
              <option value="person">Jismoniy shaxs</option>
            </Select>
          )}
        </Field>
        {form.entityType !== 'person' && (
          <Field label="STIR">
            {id => <Input id={id} inputMode="numeric" value={form.stir}
              onChange={ev => set('stir', ev.target.value.replace(/\D/g, '').slice(0, 9))} />}
          </Field>
        )}
        {form.entityType !== 'person' && (
          <div className="sm:col-span-2">
            <SoliqLookup
              stir={form.stir}
              initialStir={e.stir ?? ''}
              excludeId={e.id}
              current={{ name: form.name, address: form.address, phone: form.phone, contactName: form.contactName }}
              onApply={patch => setForm(p => ({ ...p, ...patch }))}
              onSynced={() => setSoliqSynced(true)}
            />
          </div>
        )}
        <div className="sm:col-span-2 empty:hidden">
          <SimilarEntities name={form.name} phone={form.phone} lat={e.lat} lon={e.lon} districtId={form.districtId} excludeId={e.id} />
        </div>
        <Field label="Manzil" required className="sm:col-span-2">
          {id => <Input id={id} value={form.address} onChange={ev => set('address', ev.target.value)} placeholder="Ko'cha, uy" />}
        </Field>
        <Field label="Tuman" required>
          {id => (
            <Select id={id} value={form.districtId} onChange={ev => setForm(p => ({ ...p, districtId: ev.target.value, mahallId: '' }))}>
              {(districts.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Mahalla">
          {id => (
            <Select id={id} value={form.mahallId} onChange={ev => set('mahallId', ev.target.value)} disabled={!(mahallas.data?.length)}>
              <option value="">Tanlanmagan</option>
              {(mahallas.data ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="To'lov rejimi">
          {id => (
            <Select id={id} value={form.billingMode} onChange={ev => set('billingMode', ev.target.value)}>
              <option value="variable">O'zgaruvchan (har oy har xil)</option>
              <option value="monthly_fixed">Belgilangan oylik (avto-hisob)</option>
              <option value="talon">Talon (kub × narx)</option>
            </Select>
          )}
        </Field>
        {isTalon ? (
          <Field label="Bir kub narxi (so'm)" required>
            {id => <Input id={id} type="number" min={0} inputMode="numeric" value={form.cubicPrice} onChange={ev => set('cubicPrice', ev.target.value)} />}
          </Field>
        ) : (
          <Field label="Oylik to'lov (so'm)" required>
            {id => <Input id={id} type="number" min={0} inputMode="numeric" value={form.monthlyFee} onChange={ev => set('monthlyFee', ev.target.value)} />}
          </Field>
        )}
        <Field label="Telefon">
          {id => <Input id={id} type="tel" value={form.phone} onChange={ev => set('phone', ev.target.value)} placeholder="998901234567" />}
        </Field>
        <Field label="Mas'ul shaxs">
          {id => <Input id={id} value={form.contactName} onChange={ev => set('contactName', ev.target.value)} />}
        </Field>
        <Field label="Kod">
          {id => <Input id={id} value={form.code} onChange={ev => set('code', ev.target.value)} />}
        </Field>
        <Field label="Shartnoma raqami">
          {id => <Input id={id} value={form.contractNumber} onChange={ev => set('contractNumber', ev.target.value)} />}
        </Field>
        <Field label="Shartnoma boshlangan oy" hint="Hisoblar shu oydan boshlab yoziladi">
          {() => (
            <div className="flex items-center gap-2">
              <MonthInput value={form.contractStartMonth} onChange={v => set('contractStartMonth', v)} />
              {form.contractStartMonth && (
                <Button variant="ghost" onClick={() => set('contractStartMonth', '')}>Tozalash</Button>
              )}
            </div>
          )}
        </Field>
        {!isDraft && e.status !== 'blacklisted' && (
          <Field label="Holat">
            {id => (
              <Select id={id} value={form.status} onChange={ev => set('status', ev.target.value)}>
                <option value="active">Faol</option>
                <option value="inactive">Nofaol</option>
              </Select>
            )}
          </Field>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 rounded-eko-lg border border-eko-line px-3 py-2.5">
        <div>
          <p className="eko-text-base font-medium text-eko-text">Joylashuv</p>
          <p className="eko-text-xs text-eko-muted">
            {e.lat != null && e.lon != null ? `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}` : 'Belgilanmagan'}
          </p>
        </div>
        <Button icon={<MapPin className="w-4 h-4" aria-hidden />} onClick={() => actions.onPickLocation(e)}>
          Xaritadan belgilash
        </Button>
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="flex flex-wrap gap-2 justify-end">
        <Button onClick={onCancel} disabled={saving}>Bekor qilish</Button>
        <Button variant={isDraft ? 'secondary' : 'primary'} loading={saving} onClick={() => save(false)}>Saqlash</Button>
        {isDraft && (
          <Button variant="primary" loading={saving} disabled={missing.length > 0}
            icon={<CheckCircle2 className="w-4 h-4" aria-hidden />} onClick={() => save(true)}>
            Saqlash va faollashtirish
          </Button>
        )}
      </div>
    </div>
  )
}
