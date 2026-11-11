import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { parseEkoError } from '../../lib/ekoErrors'
import { invalidateEko, useDistricts, useMahallas } from '../../lib/queries'
import { Banner, Button, Field, Input, Modal, Select } from '../../ui'
import SoliqLookup from '../SoliqLookup'
import SimilarEntities from '../SimilarEntities'
import type { BillingMode } from './types'

interface Form {
  entityType: 'legal' | 'ip' | 'person'
  code: string
  name: string
  address: string
  stir: string
  districtId: string
  mahallId: string
  billingMode: BillingMode
  monthlyFee: string
  cubicPrice: string
}

const EMPTY: Form = {
  entityType: 'legal', code: '', name: '', address: '', stir: '', districtId: '', mahallId: '',
  billingMode: 'variable', monthlyFee: '', cubicPrice: '',
}

const MODE_HINT: Record<BillingMode, string> = {
  talon: "Talon: oylik to'lov yo'q. Har bajarilgan ish (kub × bir kub narxi) qarzga qo'shiladi.",
  monthly_fixed: "Belgilangan oylik: har oy avtomatik hisob yoziladi va qarz hisoblanadi.",
  variable: "O'zgaruvchan: faqat to'lov qilinganda yoziladi, qarz to'planmaydi.",
}

/** Yangi tashkilot formasi (ui/Modal + Field). Tuman majburiy; bitta tuman bo'lsa avto-tanlanadi. */
export default function NewEntityModal({
  onClose, onCreated, onOpenExisting,
}: { onClose: () => void; onCreated: () => void; onOpenExisting: (id: string) => void }) {
  const qc = useQueryClient()
  const districts = useDistricts()
  const [form, setForm] = useState<Form>(EMPTY)
  const mahallas = useMahallas(form.districtId)
  const [soliqSynced, setSoliqSynced] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [existing, setExisting] = useState<{ id: string; name: string; restricted?: boolean } | null>(null)
  const [saving, setSaving] = useState(false)
  const set = (p: Partial<Form>) => setForm(f => ({ ...f, ...p }))
  const isTalon = form.billingMode === 'talon'

  // Bitta tuman bo'lsa — avto-tanlash
  useEffect(() => {
    const list = districts.data ?? []
    if (list.length === 1 && !form.districtId) set({ districtId: list[0].id })
  }, [districts.data, form.districtId])

  async function submit() {
    const e: typeof errors = {}
    if (!form.name.trim()) e.name = 'Nomni kiriting'
    if (!form.address.trim()) e.address = 'Manzilni kiriting'
    if (!form.districtId) e.districtId = 'Tumanni tanlang'
    if (isTalon ? !(parseInt(form.cubicPrice, 10) > 0) : !(parseInt(form.monthlyFee, 10) > 0)) {
      e[isTalon ? 'cubicPrice' : 'monthlyFee'] = 'Summani kiriting'
    }
    setErrors(e)
    setFormError(null)
    setExisting(null)
    if (Object.keys(e).length) return

    setSaving(true)
    try {
      await ekoApi.post('/entities', {
        code: form.code.trim() || undefined,
        name: form.name.trim(),
        address: form.address.trim(),
        monthlyFee: isTalon ? 0 : parseInt(form.monthlyFee, 10),
        cubicPrice: isTalon ? parseInt(form.cubicPrice, 10) : 0,
        districtId: form.districtId,
        mahallId: form.mahallId || undefined,
        stir: form.entityType === 'person' ? undefined : (form.stir.trim() || undefined),
        entityType: form.entityType,
        billingMode: form.billingMode,
        ...(soliqSynced ? { soliqSynced: true } : {}),
      })
      toast.success("Tashkilot qo'shildi")
      invalidateEko(qc, 'entity')
      onCreated()
    } catch (err) {
      const info = parseEkoError(err)
      const ex = (info.data as any)?.existing
      if (info.code === 'DUPLICATE_STIR' && ex) setExisting({ id: ex.id, name: ex.name, restricted: ex.restricted })
      setFormError(info.message)
    } finally { setSaving(false) }
  }

  return (
    <Modal
      onClose={onClose}
      size="lg"
      disableBackdropClose
      title="Yangi tashkilot"
      footer={<Button variant="primary" className="flex-1" loading={saving} onClick={submit}>Saqlash</Button>}
    >
      <div className="p-5 grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Turi">
          {id => (
            <Select id={id} value={form.entityType}
              onChange={e => set({ entityType: e.target.value as Form['entityType'], stir: e.target.value === 'person' ? '' : form.stir })}>
              <option value="legal">Yuridik shaxs</option>
              <option value="ip">YaTT / tadbirkor</option>
              <option value="person">Jismoniy shaxs</option>
            </Select>
          )}
        </Field>
        <Field label="Kod">
          {id => <Input id={id} value={form.code} onChange={e => set({ code: e.target.value })} placeholder="E001" />}
        </Field>

        {form.entityType !== 'person' && (
          <div className="sm:col-span-2 space-y-2">
            <Field label="STIR">
              {id => <Input id={id} inputMode="numeric" value={form.stir} placeholder="123456789"
                onChange={e => set({ stir: e.target.value.replace(/\D/g, '').slice(0, 9) })} />}
            </Field>
            <SoliqLookup
              stir={form.stir}
              current={{ name: form.name, address: form.address }}
              onApply={patch => set({
                ...(patch.name !== undefined ? { name: patch.name } : {}),
                ...(patch.address !== undefined ? { address: patch.address } : {}),
              })}
              onSynced={() => setSoliqSynced(true)}
              onOpenExisting={onOpenExisting}
            />
          </div>
        )}

        <div className="sm:col-span-2 space-y-2">
          <Field label="Nomi" required error={errors.name}>
            {id => <Input id={id} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="Tashkilot nomi" />}
          </Field>
          <SimilarEntities name={form.name} districtId={form.districtId} onOpen={onOpenExisting} />
        </div>

        <Field label="Manzil" required error={errors.address} className="sm:col-span-2">
          {id => <Input id={id} value={form.address} onChange={e => set({ address: e.target.value })} placeholder="Chilonzor t., ..." />}
        </Field>

        <Field label="Tuman" required error={errors.districtId}>
          {id => (
            <Select id={id} value={form.districtId} onChange={e => set({ districtId: e.target.value, mahallId: '' })}>
              <option value="">Tanlang</option>
              {(districts.data ?? []).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Mahalla">
          {id => (
            <Select id={id} value={form.mahallId} onChange={e => set({ mahallId: e.target.value })}
              disabled={!form.districtId || (mahallas.data?.length ?? 0) === 0}>
              <option value="">Tanlanmagan</option>
              {(mahallas.data ?? []).map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </Select>
          )}
        </Field>

        <Field label="To'lov rejimi" hint={MODE_HINT[form.billingMode]} className="sm:col-span-2">
          {id => (
            <Select id={id} value={form.billingMode} onChange={e => set({ billingMode: e.target.value as BillingMode })}>
              <option value="variable">O'zgaruvchan (har oy har xil)</option>
              <option value="monthly_fixed">Belgilangan oylik (avto-hisob)</option>
              <option value="talon">Talon (bajarilgan ish — kub)</option>
            </Select>
          )}
        </Field>

        {isTalon ? (
          <Field label="Bir kub narxi (so'm)" required error={errors.cubicPrice} className="sm:col-span-2">
            {id => <Input id={id} type="number" min={1} inputMode="numeric" value={form.cubicPrice}
              onChange={e => set({ cubicPrice: e.target.value })} placeholder="50000" />}
          </Field>
        ) : (
          <Field label="Oylik to'lov (so'm)" required error={errors.monthlyFee} className="sm:col-span-2">
            {id => <Input id={id} type="number" min={1} inputMode="numeric" value={form.monthlyFee}
              onChange={e => set({ monthlyFee: e.target.value })} placeholder="50000" />}
          </Field>
        )}

        {formError && (
          <div className="sm:col-span-2">
            <Banner
              tone="danger"
              action={existing && !existing.restricted && (
                <Button size="sm" onClick={() => onOpenExisting(existing.id)}>Ochish</Button>
              )}
            >
              {formError}
            </Banner>
          </div>
        )}
      </div>
    </Modal>
  )
}
