import { useCallback, useEffect, useState } from 'react'
import {
  Phone, MapPin, Pencil, Wallet, MessageSquare, FileText, CalendarDays, ShieldCheck,
  AlertCircle, Scale, User, Hash, Receipt, CheckCircle2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import {
  Modal, Button, Badge, DebtBadge, BillingBadge, Banner, Field, Input, Select,
  SkeletonList, MonthInput, f,
} from '../ui'

interface Missing { key: string; label: string }
interface Card {
  entity: {
    id: string; name: string; code?: string | null; stir?: string | null; address?: string | null
    phone?: string | null; contactName?: string | null; contractNumber?: string | null
    contractStartMonth?: string | null; lat?: number | null; lon?: number | null
    status: 'active' | 'blacklisted' | 'inactive' | 'draft'
    billingMode: 'monthly_fixed' | 'variable' | 'talon'
    monthlyFee: number; cubicPrice: number; debtLevel: string
    districtId: string; mahallId?: string | null
    district?: { id: string; name: string }; mahalla?: { id: string; name: string } | null
    blacklist?: { status: string; reason: string } | null
    createdAt: string
  }
  completeness: { percent: number; missingRequired: Missing[]; missingOptional: Missing[]; isReady: boolean }
  debt: { totalDebt: number; debtMonths: number; unpaidMonths: string[]; level: string }
  payments: Array<{ id: string; month: string; amount: number; paidAt: string; receiver?: { fullName: string }; receipt?: { id: string; receiptNumber: string } | null }>
  talons: Array<{ id: string; date: string; volume: number; amount: number; paid: boolean }>
  smsLogs: Array<{ id: string; status: string; createdAt: string }>
}

interface Option { id: string; name: string }

export interface EntityCardActions {
  onPay: (e: Card['entity']) => void
  onLedger: (e: Card['entity']) => void
  onTalons: (e: Card['entity']) => void
  onProof: (e: Card['entity']) => void
  onSms: (e: Card['entity']) => void
  onBlacklist: (e: Card['entity']) => void
  onPickLocation: (e: Card['entity']) => void
  onAkt: (id: string) => void
}

const STATUS: Record<string, { tone: 'success' | 'danger' | 'neutral' | 'warn'; label: string }> = {
  active: { tone: 'success', label: 'Faol' },
  blacklisted: { tone: 'danger', label: "Qora ro'yxat" },
  inactive: { tone: 'neutral', label: 'Nofaol' },
  draft: { tone: 'warn', label: "Chala (to'ldirilmagan)" },
}

/**
 * Tashkilot kartochkasi — bitta oynada: ma'lumot, qarz, tarix, tezkor amallar va tahrirlash.
 * Chala (draft) tashkilot to'g'ridan-to'g'ri tahrirlash rejimida ochiladi va
 * nima yetishmayotgani ko'rsatiladi.
 */
export default function EntityCardModal({
  entityId, readOnly, actions, startEditing, onClose, onChanged,
}: {
  entityId: string
  readOnly: boolean
  actions: EntityCardActions
  startEditing?: boolean
  onClose: () => void
  /** Ma'lumot o'zgargach (ro'yxatni yangilash uchun) */
  onChanged: () => void
}) {
  const [card, setCard] = useState<Card | null>(null)
  const [error, setError] = useState('')
  const [editing, setEditing] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await ekoApi.get(`/entities/${entityId}/card`)
      const data: Card = res.data.data
      setCard(data)
      setError('')
      return data
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Kartochkani yuklab bo\'lmadi')
      return null
    }
  }, [entityId])

  useEffect(() => {
    load().then(d => { if (d && startEditing && !readOnly) setEditing(true) })
  }, [load, startEditing, readOnly])

  const e = card?.entity
  const st = e ? STATUS[e.status] : null

  return (
    <Modal
      onClose={onClose}
      size="lg"
      disableBackdropClose={editing}
      title={e?.name ?? 'Tashkilot'}
      hint={e ? [e.district?.name, e.mahalla?.name].filter(Boolean).join(' · ') || undefined : undefined}
    >
      <div className="p-5 space-y-4">
        {error && <Banner tone="danger">{error}</Banner>}
        {!card && !error && <SkeletonList rows={5} />}

        {card && e && !editing && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {st && <Badge tone={st.tone}>{st.label}</Badge>}
              <BillingBadge mode={e.billingMode} />
              {e.status === 'active' && <DebtBadge level={card.debt.level} />}
              {e.code && <span className="text-xs text-eko-muted font-mono">№ {e.code}</span>}
            </div>

            {card.completeness.missingRequired.length > 0 && (
              <Banner
                tone="warn"
                action={!readOnly && (
                  <Button size="sm" variant="primary" onClick={() => setEditing(true)}>To'ldirish</Button>
                )}
              >
                <b>Ma'lumot to'liq emas ({card.completeness.percent}%).</b>{' '}
                Majburiy: {card.completeness.missingRequired.map(m => m.label).join(', ')}.
              </Banner>
            )}
            {card.completeness.missingRequired.length === 0 && card.completeness.missingOptional.length > 0 && (
              <p className="text-xs text-eko-muted">
                To'liqlik {card.completeness.percent}% · yo'q: {card.completeness.missingOptional.map(m => m.label).join(', ')}
              </p>
            )}
            {e.blacklist?.status === 'active' && (
              <Banner tone="danger">Qora ro'yxatda: {e.blacklist.reason}</Banner>
            )}

            {/* Qarz */}
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-eko-lg border border-eko-line p-3">
                <p className="text-xs text-eko-muted">
                  {e.billingMode === 'variable' ? "Shu oy to'lovi" : 'Jami qarz'}
                </p>
                <p className="text-lg font-semibold text-eko-text mt-0.5">
                  {e.billingMode === 'variable'
                    ? (card.debt.debtMonths > 0 ? "To'lanmagan" : "To'langan")
                    : f.money(card.debt.totalDebt)}
                </p>
                {card.debt.debtMonths > 0 && e.billingMode !== 'variable' && (
                  <p className="text-xs text-eko-muted mt-0.5">{card.debt.debtMonths} oy</p>
                )}
              </div>
              <div className="rounded-eko-lg border border-eko-line p-3">
                <p className="text-xs text-eko-muted">{e.billingMode === 'talon' ? 'Bir kub narxi' : 'Oylik to\'lov'}</p>
                <p className="text-lg font-semibold text-eko-text mt-0.5">
                  {f.money(e.billingMode === 'talon' ? e.cubicPrice : e.monthlyFee)}
                </p>
              </div>
            </div>

            {/* Tezkor amallar */}
            <div className="flex flex-wrap gap-2">
              {!readOnly && e.status !== 'draft' && (
                <Button size="sm" variant="primary" icon={<Wallet className="w-4 h-4" />} onClick={() => actions.onPay(e)}>
                  To'lov
                </Button>
              )}
              {e.phone && (
                <a href={`tel:+${e.phone.replace(/\D/g, '')}`}>
                  <Button size="sm" icon={<Phone className="w-4 h-4" />}>Qo'ng'iroq</Button>
                </a>
              )}
              {e.lat != null && e.lon != null && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}`} target="_blank" rel="noreferrer">
                  <Button size="sm" icon={<MapPin className="w-4 h-4" />}>Yo'nalish</Button>
                </a>
              )}
              <Button size="sm" icon={e.billingMode === 'talon' ? <FileText className="w-4 h-4" /> : <CalendarDays className="w-4 h-4" />}
                onClick={() => e.billingMode === 'talon' ? actions.onTalons(e) : actions.onLedger(e)}>
                {e.billingMode === 'talon' ? 'Talonlar' : "To'lovlar tasmasi"}
              </Button>
              <Button size="sm" icon={<Scale className="w-4 h-4" />} onClick={() => actions.onAkt(e.id)}>Akt sverka</Button>
              <Button size="sm" icon={<ShieldCheck className="w-4 h-4" />} onClick={() => actions.onProof(e)}>GPS isbot</Button>
              {!readOnly && e.status === 'active' && e.phone && (
                <Button size="sm" icon={<MessageSquare className="w-4 h-4" />} onClick={() => actions.onSms(e)}>SMS</Button>
              )}
              {!readOnly && (
                <Button size="sm" icon={<Pencil className="w-4 h-4" />} onClick={() => setEditing(true)}>Tahrirlash</Button>
              )}
              {!readOnly && e.status === 'active' && (
                <Button size="sm" variant="danger" icon={<AlertCircle className="w-4 h-4" />} onClick={() => actions.onBlacklist(e)}>
                  Qora ro'yxat
                </Button>
              )}
            </div>

            {/* Ma'lumotlar */}
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm">
              <Info icon={<MapPin className="w-3.5 h-3.5" />} label="Manzil" value={e.address} />
              <Info icon={<Phone className="w-3.5 h-3.5" />} label="Telefon" value={e.phone ? f.phone(e.phone) : null} />
              <Info icon={<User className="w-3.5 h-3.5" />} label="Mas'ul shaxs" value={e.contactName} />
              <Info icon={<Hash className="w-3.5 h-3.5" />} label="STIR" value={e.stir} />
              <Info icon={<Receipt className="w-3.5 h-3.5" />} label="Shartnoma" value={e.contractNumber} />
              <Info icon={<MapPin className="w-3.5 h-3.5" />} label="Joylashuv"
                value={e.lat != null && e.lon != null ? `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}` : null} />
            </dl>

            {/* Oxirgi to'lovlar */}
            <section>
              <h4 className="text-xs font-semibold text-eko-text-2 uppercase tracking-wide mb-2">Oxirgi to'lovlar</h4>
              {card.payments.length === 0 ? (
                <p className="text-sm text-eko-muted">Hali to'lov yo'q</p>
              ) : (
                <ul className="divide-y divide-eko-line border border-eko-line rounded-eko-lg">
                  {card.payments.map(p => (
                    <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                      <div className="min-w-0">
                        <p className="font-medium text-eko-text">{f.money(p.amount)}</p>
                        <p className="text-xs text-eko-muted truncate">
                          {f.monthLabel(p.month)} · {f.date(p.paidAt)}{p.receiver ? ` · ${p.receiver.fullName}` : ''}
                        </p>
                      </div>
                      {p.receipt && <span className="text-[11px] text-eko-muted font-mono shrink-0">{p.receipt.receiptNumber}</span>}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {card.smsLogs.length > 0 && (
              <p className="text-xs text-eko-muted flex items-center gap-1.5">
                <MessageSquare className="w-3.5 h-3.5" />
                Oxirgi SMS: {f.dateTime(card.smsLogs[0].createdAt)}
                {card.smsLogs[0].status === 'failed' ? ' (yuborilmagan)' : ''}
              </p>
            )}
          </>
        )}

        {card && e && editing && (
          <EditForm
            card={card}
            actions={actions}
            onCancel={() => setEditing(false)}
            onSaved={async () => { await load(); onChanged(); setEditing(false) }}
          />
        )}
      </div>
    </Modal>
  )
}

function Info({ icon, label, value }: { icon: React.ReactNode; label: string; value?: string | null }) {
  return (
    <div className="flex items-start gap-2 min-w-0">
      <span className="text-eko-subtle mt-0.5">{icon}</span>
      <div className="min-w-0">
        <dt className="text-[11px] text-eko-muted">{label}</dt>
        <dd className={value ? 'text-eko-text break-words' : 'text-eko-subtle'}>{value || '—'}</dd>
      </div>
    </div>
  )
}

// ─── Tahrirlash formasi ──────────────────────────────────────────────────────
function EditForm({
  card, actions, onCancel, onSaved,
}: {
  card: Card
  actions: EntityCardActions
  onCancel: () => void
  onSaved: () => void
}) {
  const e = card.entity
  const isDraft = e.status === 'draft'
  const [form, setForm] = useState({
    name: e.name ?? '',
    code: e.code ?? '',
    stir: e.stir ?? '',
    address: e.address ?? '',
    phone: e.phone ?? '',
    contactName: e.contactName ?? '',
    contractNumber: e.contractNumber ?? '',
    contractStartMonth: e.contractStartMonth ?? '',
    districtId: e.districtId,
    mahallId: e.mahallId ?? '',
    billingMode: e.billingMode,
    monthlyFee: e.monthlyFee ? String(e.monthlyFee) : '',
    cubicPrice: e.cubicPrice ? String(e.cubicPrice) : '',
    status: e.status === 'inactive' ? 'inactive' : 'active',
  })
  const [districts, setDistricts] = useState<Option[]>([])
  const [mahallas, setMahallas] = useState<Option[]>([])
  const [saving, setSaving] = useState(false)
  const set = (k: string, v: string) => setForm(p => ({ ...p, [k]: v }))
  const isTalon = form.billingMode === 'talon'

  useEffect(() => {
    ekoApi.get('/districts').then(r => setDistricts(r.data.data ?? [])).catch(() => {})
  }, [])
  useEffect(() => {
    if (!form.districtId) { setMahallas([]); return }
    ekoApi.get(`/mahallas?districtId=${form.districtId}`).then(r => setMahallas(r.data.data ?? [])).catch(() => {})
  }, [form.districtId])

  // Hozirgi forma bo'yicha yetishmayotgan majburiy maydonlar (jonli)
  const missing: string[] = []
  if (!form.name.trim()) missing.push('Nomi')
  if (!form.address.trim()) missing.push('Manzil')
  if (!form.districtId) missing.push('Tuman')
  if (isTalon ? !(parseInt(form.cubicPrice, 10) > 0) : !(parseInt(form.monthlyFee, 10) > 0)) {
    missing.push(isTalon ? 'Bir kub narxi' : "Oylik to'lov")
  }

  async function save(activate: boolean) {
    if (!form.name.trim()) { toast.error('Nom kiritilishi shart'); return }
    if (activate && missing.length) { toast.error(`To'ldiring: ${missing.join(', ')}`); return }
    setSaving(true)
    try {
      await ekoApi.put(`/entities/${e.id}`, {
        name: form.name.trim(),
        code: form.code,
        stir: form.stir,
        address: form.address,
        phone: form.phone,
        contactName: form.contactName,
        contractNumber: form.contractNumber,
        contractStartMonth: form.contractStartMonth || null,
        districtId: form.districtId,
        mahallId: form.mahallId || null,
        billingMode: form.billingMode,
        monthlyFee: isTalon ? 0 : parseInt(form.monthlyFee, 10) || 0,
        cubicPrice: isTalon ? parseInt(form.cubicPrice, 10) || 0 : 0,
        // Chala tashkilot faqat "faollashtirish" tugmasi bilan faol bo'ladi;
        // qora ro'yxatdagi tashkilot holati bu yerda o'zgarmaydi.
        ...(isDraft ? (activate ? { status: 'active' } : {}) : (e.status === 'blacklisted' ? {} : { status: form.status })),
      })
      toast.success(activate ? 'Tashkilot faollashtirildi' : 'Saqlandi')
      onSaved()
    } catch (err: any) {
      toast.error(err?.response?.data?.error || 'Saqlashda xato')
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

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="Nomi" required className="sm:col-span-2">
          {id => <Input id={id} value={form.name} onChange={ev => set('name', ev.target.value)} />}
        </Field>
        <Field label="Manzil" required className="sm:col-span-2">
          {id => <Input id={id} value={form.address} onChange={ev => set('address', ev.target.value)} placeholder="Ko'cha, uy" />}
        </Field>
        <Field label="Tuman" required>
          {id => (
            <Select id={id} value={form.districtId} onChange={ev => setForm(p => ({ ...p, districtId: ev.target.value, mahallId: '' }))}>
              {districts.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          )}
        </Field>
        <Field label="Mahalla">
          {id => (
            <Select id={id} value={form.mahallId} onChange={ev => set('mahallId', ev.target.value)} disabled={!mahallas.length}>
              <option value="">Tanlanmagan</option>
              {mahallas.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
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
            {id => <Input id={id} type="number" min={0} value={form.cubicPrice} onChange={ev => set('cubicPrice', ev.target.value)} />}
          </Field>
        ) : (
          <Field label="Oylik to'lov (so'm)" required>
            {id => <Input id={id} type="number" min={0} value={form.monthlyFee} onChange={ev => set('monthlyFee', ev.target.value)} />}
          </Field>
        )}
        <Field label="Telefon">
          {id => <Input id={id} type="tel" value={form.phone} onChange={ev => set('phone', ev.target.value)} placeholder="998901234567" />}
        </Field>
        <Field label="Mas'ul shaxs">
          {id => <Input id={id} value={form.contactName} onChange={ev => set('contactName', ev.target.value)} />}
        </Field>
        <Field label="STIR">
          {id => <Input id={id} value={form.stir} onChange={ev => set('stir', ev.target.value)} />}
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
                <button type="button" className="text-xs text-eko-muted underline" onClick={() => set('contractStartMonth', '')}>
                  tozalash
                </button>
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

      <div className="flex items-center justify-between rounded-eko-lg border border-eko-line px-3 py-2.5">
        <div className="text-sm">
          <p className="font-medium text-eko-text">Joylashuv</p>
          <p className="text-xs text-eko-muted">
            {e.lat != null && e.lon != null ? `${e.lat.toFixed(5)}, ${e.lon.toFixed(5)}` : 'Belgilanmagan'}
          </p>
        </div>
        <Button size="sm" icon={<MapPin className="w-4 h-4" />} onClick={() => actions.onPickLocation(e)}>
          Xaritadan belgilash
        </Button>
      </div>

      <div className="flex flex-wrap gap-2 justify-end pt-1">
        <Button onClick={onCancel} disabled={saving}>Bekor qilish</Button>
        <Button variant={isDraft ? 'secondary' : 'primary'} loading={saving} onClick={() => save(false)}>
          Saqlash
        </Button>
        {isDraft && (
          <Button variant="primary" loading={saving} disabled={missing.length > 0}
            icon={<CheckCircle2 className="w-4 h-4" />} onClick={() => save(true)}>
            Saqlash va faollashtirish
          </Button>
        )}
      </div>
    </div>
  )
}
