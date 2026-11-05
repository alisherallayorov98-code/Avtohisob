import { useCallback, useEffect, useState } from 'react'
import { Phone, Navigation, Wallet, CheckCircle2, LocateFixed } from 'lucide-react'
import { tgApi, tgErrorMessage } from './tgApi'
import {
  Modal, Button, Badge, DebtBadge, BillingBadge, Banner, Field, Input, Select, SkeletonList, f,
} from '../ui'

interface CardData {
  entity: {
    id: string; name: string; address?: string | null; phone?: string | null
    contactName?: string | null; lat?: number | null; lon?: number | null
    status: string; billingMode: 'monthly_fixed' | 'variable' | 'talon'
    monthlyFee: number; cubicPrice: number
    district?: { name: string }; mahalla?: { name: string } | null
  }
  completeness: { percent: number; missingRequired: Array<{ label: string }> }
  debt: { totalDebt: number; debtMonths: number; unpaidMonths: string[]; level: string }
  payments: Array<{ id: string; month: string; amount: number; paidAt: string }>
}

function currentMonth(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Tashkilot varag'i (mini ilova): qarz, qo'ng'iroq, yo'nalish, to'lov yozish,
 * joylashuvni yangilash. To'lov `POST /payments` orqali yoziladi — u veb va bot bilan
 * bir xil yadroni (`recordEkoPayment`) chaqiradi: taqsimot, kvitansiya, takroriy qorovul.
 */
export default function TgEntitySheet({
  entityId, canWrite, onClose, onChanged,
}: {
  entityId: string
  canWrite: boolean
  onClose: () => void
  onChanged: () => void
}) {
  const [data, setData] = useState<CardData | null>(null)
  const [error, setError] = useState('')
  const [paying, setPaying] = useState(false)

  const load = useCallback(async () => {
    try {
      const res = await tgApi.get(`/entities/${entityId}/card`)
      setData(res.data.data)
      setError('')
    } catch (e) { setError(tgErrorMessage(e, "Ma'lumotni yuklab bo'lmadi")) }
  }, [entityId])

  useEffect(() => { load() }, [load])

  const e = data?.entity
  const isDraft = e?.status === 'draft'

  return (
    <Modal
      onClose={onClose}
      title={e?.name ?? 'Tashkilot'}
      hint={e ? [e.district?.name, e.mahalla?.name].filter(Boolean).join(' · ') || undefined : undefined}
    >
      <div className="p-5 space-y-4">
        {error && <Banner tone="danger" action={<Button size="sm" onClick={load}>Qayta</Button>}>{error}</Banner>}
        {!data && !error && <SkeletonList rows={4} />}

        {data && e && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              {isDraft ? <Badge tone="warn">Chala</Badge> : <DebtBadge level={data.debt.level} />}
              <BillingBadge mode={e.billingMode} />
            </div>

            {isDraft && (
              <Banner tone="warn">
                Ma'lumot to'liq emas: {data.completeness.missingRequired.map(m => m.label).join(', ')}.
                Saytda to'ldiring.
              </Banner>
            )}

            {e.address && <p className="text-sm text-eko-text-2">{e.address}</p>}

            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-eko-lg border border-eko-line p-3">
                <p className="text-xs text-eko-muted">
                  {e.billingMode === 'variable' ? 'Shu oy' : 'Qarz'}
                </p>
                <p className="text-lg font-semibold text-eko-text mt-0.5">
                  {e.billingMode === 'variable'
                    ? (data.debt.debtMonths > 0 ? "To'lanmagan" : "To'langan")
                    : f.money(data.debt.totalDebt)}
                </p>
                {e.billingMode !== 'variable' && data.debt.debtMonths > 0 && (
                  <p className="text-xs text-eko-muted">{data.debt.debtMonths} oy</p>
                )}
              </div>
              <div className="rounded-eko-lg border border-eko-line p-3">
                <p className="text-xs text-eko-muted">{e.billingMode === 'talon' ? 'Kub narxi' : 'Oylik'}</p>
                <p className="text-lg font-semibold text-eko-text mt-0.5">
                  {f.money(e.billingMode === 'talon' ? e.cubicPrice : e.monthlyFee)}
                </p>
                {data.payments[0] && (
                  <p className="text-xs text-eko-muted">Oxirgi: {f.date(data.payments[0].paidAt)}</p>
                )}
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {e.phone && (
                <a href={`tel:+${e.phone.replace(/\D/g, '')}`}>
                  <Button icon={<Phone className="w-4 h-4" />}>Qo'ng'iroq</Button>
                </a>
              )}
              {e.lat != null && e.lon != null && (
                <a href={`https://www.google.com/maps/dir/?api=1&destination=${e.lat},${e.lon}`} target="_blank" rel="noreferrer">
                  <Button icon={<Navigation className="w-4 h-4" />}>Yo'nalish</Button>
                </a>
              )}
              {canWrite && <LocationButton entityId={e.id} hasLocation={e.lat != null} onDone={() => { load(); onChanged() }} />}
            </div>

            {canWrite && !isDraft && e.status === 'active' && (
              paying ? (
                <PayForm
                  card={data}
                  onCancel={() => setPaying(false)}
                  onPaid={() => { setPaying(false); load(); onChanged() }}
                />
              ) : (
                <Button variant="primary" size="lg" block icon={<Wallet className="w-5 h-5" />} onClick={() => setPaying(true)}>
                  To'lov yozish
                </Button>
              )
            )}
          </>
        )}
      </div>
    </Modal>
  )
}

/** Joriy GPS nuqtasini tashkilot joylashuvi qilib saqlaydi (tasdiqlash bilan). */
function LocationButton({ entityId, hasLocation, onDone }: { entityId: string; hasLocation: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  function run() {
    if (hasLocation && !window.confirm("Joylashuv allaqachon belgilangan. Hozirgi joyingizga o'zgartiraymi?")) return
    if (!navigator.geolocation) { setMsg('Qurilmada GPS yo\'q'); return }
    setBusy(true); setMsg('')
    navigator.geolocation.getCurrentPosition(
      async pos => {
        try {
          await tgApi.put(`/entities/${entityId}/location`, { lat: pos.coords.latitude, lon: pos.coords.longitude })
          setMsg('Joylashuv saqlandi')
          onDone()
        } catch (e) { setMsg(tgErrorMessage(e, 'Saqlanmadi')) }
        finally { setBusy(false) }
      },
      () => { setMsg('GPS ruxsati berilmadi'); setBusy(false) },
      { enableHighAccuracy: true, timeout: 15000 },
    )
  }

  return (
    <div className="flex items-center gap-2">
      <Button loading={busy} icon={<LocateFixed className="w-4 h-4" />} onClick={run}>
        {hasLocation ? "Joyni yangilash" : "Joyni belgilash"}
      </Button>
      {msg && <span className="text-xs text-eko-muted">{msg}</span>}
    </div>
  )
}

function PayForm({ card, onCancel, onPaid }: { card: CardData; onCancel: () => void; onPaid: () => void }) {
  const e = card.entity
  const cur = currentMonth()
  const months = card.debt.unpaidMonths.length > 0
    ? Array.from(new Set([...card.debt.unpaidMonths, cur])).sort()
    : [cur]
  const suggested = card.debt.totalDebt > 0 ? card.debt.totalDebt : (e.billingMode === 'talon' ? 0 : e.monthlyFee)

  const [month, setMonth] = useState(card.debt.unpaidMonths[0] ?? cur)
  const [amount, setAmount] = useState(suggested ? String(suggested) : '')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  const [done, setDone] = useState<{ receipt?: string } | null>(null)

  async function submit(force = false) {
    const n = parseInt(amount.replace(/\s/g, ''), 10)
    if (!n || n <= 0) { setError('Summani kiriting'); return }
    setBusy(true); setError(''); setDuplicate(false)
    try {
      const res = await tgApi.post('/payments', {
        entityId: e.id, month, amount: n, note: note.trim() || undefined, force,
      })
      setDone({ receipt: res.data.data?.receiptNumber })
    } catch (err: any) {
      if (err?.response?.data?.code === 'DUPLICATE_PAYMENT') setDuplicate(true)
      else setError(tgErrorMessage(err, "To'lov yozilmadi"))
    } finally { setBusy(false) }
  }

  if (done) {
    return (
      <div className="space-y-3">
        <Banner tone="success">
          <span className="flex items-center gap-1.5 font-medium"><CheckCircle2 className="w-4 h-4" /> To'lov yozildi</span>
          {done.receipt && <span className="block text-xs mt-0.5">Kvitansiya: {done.receipt}</span>}
        </Banner>
        <Button block onClick={onPaid}>Yopish</Button>
      </div>
    )
  }

  return (
    <div className="space-y-3 rounded-eko-lg border border-eko-line p-3">
      <Field label="Oy">
        {id => (
          <Select id={id} value={month} onChange={ev => setMonth(ev.target.value)}>
            {months.map(m => <option key={m} value={m}>{f.monthLabel(m)}</option>)}
          </Select>
        )}
      </Field>
      <Field label="Summa (so'm)" required>
        {id => (
          <Input id={id} inputMode="numeric" value={amount}
            onChange={ev => setAmount(ev.target.value.replace(/[^\d]/g, ''))} />
        )}
      </Field>
      <Field label="Izoh">
        {id => <Input id={id} value={note} onChange={ev => setNote(ev.target.value)} />}
      </Field>

      {error && <Banner tone="danger">{error}</Banner>}
      {duplicate && (
        <Banner tone="warn" action={<Button size="sm" variant="danger" onClick={() => submit(true)}>Baribir yozish</Button>}>
          Aynan shunday to'lov bir necha daqiqa oldin yozilgan. Takror emasmi?
        </Banner>
      )}

      <div className="flex gap-2">
        <Button onClick={onCancel} disabled={busy}>Bekor</Button>
        <Button variant="primary" block loading={busy} onClick={() => submit(false)}>Yozish</Button>
      </div>
    </div>
  )
}
