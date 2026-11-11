import { useEffect, useMemo, useRef, useState } from 'react'
import { CheckCircle2, WifiOff, RefreshCw } from 'lucide-react'
import { tgApi, tgErrorMessage, isNetworkError } from './tgApi'
import { parseEkoError, newIdempotencyKey } from '../lib/ekoErrors'
import { Banner, Button, Field, Input, SegmentedControl, f } from '../ui'
import { useMainButton, useOnline } from './tgTelegram'
import { currentMonthUz } from './tgUtil'
import type { CardData, PayResult } from './tgTypes'

type Method = 'cash' | 'card' | 'transfer'

interface Snapshot { month: string; amount: number; method: Method; note: string }
interface ChargeStatus { remaining: number; openDebts: Array<{ month: string; debt: number }> }

function digits(s: string): string { return s.replace(/\D/g, '') }
function group(s: string): string { return s ? f.num(Number(s)) : '' }

/**
 * To'lov formasi — 3 bosish: (summa tayyor) -> usul -> "Yozish".
 * Idempotency kaliti forma ochilganda BIR marta yaratiladi: tarmoq uzilib qayta
 * yuborilsa o'sha kalit -> backend replay qaytaradi, dublikat bo'lmaydi.
 */
export function TgPayForm({ card, onBack, onSuccess }: {
  card: CardData
  onBack: () => void
  onSuccess: (r: PayResult) => void
}) {
  const e = card.entity
  const cur = currentMonthUz()
  const unpaid = useMemo(() => [...card.debt.unpaidMonths].sort(), [card.debt.unpaidMonths])
  const canonical = card.debt.totalDebt > 0 ? card.debt.totalDebt : (e.billingMode === 'talon' ? 0 : e.monthlyFee)

  const [month, setMonth] = useState(unpaid[0] ?? cur)
  const [amount, setAmount] = useState(canonical ? String(Math.round(canonical)) : '')
  const [edited, setEdited] = useState(false)
  const [method, setMethod] = useState<Method>('cash')
  const [note, setNote] = useState('')
  const [status, setStatus] = useState<ChargeStatus | null>(null)

  const keyRef = useRef(newIdempotencyKey())
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicate, setDuplicate] = useState(false)
  // Tarmoq uzilgan: yuborilgan-yuborilmagani noma'lum. Shu snapshot + shu kalit bilan qayta yuboriladi.
  const [uncertain, setUncertain] = useState<Snapshot | null>(null)
  const online = useOnline()

  // Tanlangan oy bo'yicha taqsimot ko'rinishi uchun kanonik holat
  useEffect(() => {
    let off = false
    tgApi.get('/payments/charge-status', { params: { entityId: e.id, month } })
      .then(r => {
        if (off) return
        const d = r.data.data
        setStatus({ remaining: d.remaining ?? 0, openDebts: d.openDebts ?? [] })
      })
      .catch(() => { if (!off) setStatus(null) }) // taqsimot izohi ixtiyoriy; xato to'lovga to'sqinlik qilmaydi
    return () => { off = true }
  }, [e.id, month])

  // Foydalanuvchi summani qo'lda o'zgartirmagan bo'lsa — tanlangan oy qarzi
  useEffect(() => {
    if (edited || unpaid.length < 2) return
    if (month === unpaid[0]) setAmount(canonical ? String(Math.round(canonical)) : '')
    else if (status && status.remaining > 0) setAmount(String(Math.round(status.remaining)))
  }, [status, month, edited, unpaid, canonical])

  const n = parseInt(amount || '0', 10)

  const split = useMemo(() => {
    if (!status || n <= 0) return null
    const parts = [{ month, debt: status.remaining }, ...status.openDebts]
    let left = n
    let months = 0
    for (const p of parts) {
      if (left <= 0) break
      if (p.debt <= 0) continue
      months++
      left -= Math.min(left, p.debt)
    }
    return { months, advance: Math.max(0, left) }
  }, [status, n, month])

  async function send(snap: Snapshot, force: boolean) {
    if (!navigator.onLine) {
      setError("Internet yo'q. To'lov yuborilmadi. Aloqa tiklangach qayta bosing (navbat yo'q — to'lov faqat tasdiqlangandan keyin yoziladi).")
      return
    }
    setBusy(true); setError(''); setDuplicate(false)
    try {
      const res = await tgApi.post('/payments', {
        entityId: e.id, month: snap.month, amount: snap.amount, method: snap.method,
        note: snap.note.trim() || undefined, idempotencyKey: keyRef.current, force,
      })
      const d = res.data.data
      onSuccess({ amount: snap.amount, remaining: Number(d?.remaining ?? 0), receipt: d?.receiptNumber, replay: Boolean(d?.idempotentReplay) })
    } catch (err) {
      if (isNetworkError(err)) {
        setUncertain(snap)
      } else {
        const code = parseEkoError(err).code
        if (code === 'DUPLICATE_PAYMENT') setDuplicate(true)
        else {
          setError(tgErrorMessage(err, "To'lov yozilmadi"))
          // Server rad etdi (yozilmagan) — tahrirdan keyin yangi urinish yangi kalit bilan
          keyRef.current = newIdempotencyKey()
        }
      }
    } finally { setBusy(false) }
  }

  function submit(force = false) {
    if (uncertain) { send(uncertain, force); return }
    if (!n || n <= 0) { setError('Summani kiriting'); return }
    send({ month, amount: n, method, note }, force)
  }

  const canSubmit = (uncertain != null || n > 0) && !busy
  const label = uncertain
    ? `Qayta yuborish · ${f.money(uncertain.amount)}`
    : n > 0 ? `Yozish · ${f.money(n)}` : 'Yozish'
  const native = useMainButton({ text: label, onClick: () => submit(false), visible: !duplicate, loading: busy, disabled: !canSubmit })

  const locked = uncertain != null || busy

  return (
    <div className="p-5 space-y-4">
      {!online && (
        <Banner tone="warn" icon={<WifiOff className="w-4 h-4" />}>
          Internet yo'q. To'lov faqat aloqa bor paytda yoziladi.
        </Banner>
      )}

      <Field label="Summa (so'm)" required>
        {id => (
          <Input
            id={id} inputMode="numeric" autoComplete="off" disabled={locked}
            className="!h-14 eko-text-h1 eko-num font-semibold"
            value={group(amount)}
            onChange={ev => { setEdited(true); setAmount(digits(ev.target.value).slice(0, 12)) }}
          />
        )}
      </Field>

      <div className="grid grid-cols-2 gap-2">
        <Button size="lg" disabled={locked || !canonical} onClick={() => { setEdited(true); setAmount(String(Math.round(canonical))) }}>
          To'liq
        </Button>
        <Button size="lg" disabled={locked || !canonical} onClick={() => { setEdited(true); setAmount(String(Math.round(canonical / 2))) }}>
          Yarmi
        </Button>
      </div>

      {unpaid.length > 1 && (
        <div>
          <p className="eko-text-base font-medium text-eko-text mb-2">Qaysi oydan boshlab</p>
          <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Oy">
            {unpaid.map(m => (
              <button
                key={m} type="button" role="radio" aria-checked={m === month} disabled={locked}
                onClick={() => setMonth(m)}
                className={`h-11 px-4 rounded-eko border eko-text-base font-medium ${
                  m === month ? 'bg-eko-text text-eko-surface border-eko-text' : 'bg-eko-surface text-eko-text border-eko-line-strong'
                }`}
              >
                {f.monthLabel(m)}
              </button>
            ))}
          </div>
        </div>
      )}

      {split && (split.months > 1 || split.advance > 0) && (
        <p className="eko-text-base text-eko-text-2">
          {split.months > 1 ? `${split.months} oyga taqsimlanadi` : ''}
          {split.months > 1 && split.advance > 0 ? ' · ' : ''}
          {split.advance > 0 ? `Avans: ${f.money(split.advance)}` : ''}
        </p>
      )}

      <div>
        <p className="eko-text-base font-medium text-eko-text mb-2">Usul</p>
        <SegmentedControl<Method>
          ariaLabel="To'lov usuli" className="w-full [&>button]:flex-1 [&>button]:justify-center"
          value={method} onChange={v => !locked && setMethod(v)}
          options={[{ value: 'cash', label: 'Naqd' }, { value: 'card', label: 'Karta' }, { value: 'transfer', label: "O'tkazma" }]}
        />
      </div>

      <Field label="Izoh (ixtiyoriy)">
        {id => <Input id={id} value={note} disabled={locked} onChange={ev => setNote(ev.target.value)} />}
      </Field>

      {error && <Banner tone="danger">{error}</Banner>}

      {duplicate && (
        <Banner tone="warn" action={<Button size="sm" variant="danger" onClick={() => submit(true)}>Baribir yozish</Button>}>
          Aynan shunday to'lov bir necha daqiqa oldin yozilgan. Takror emasmi?
        </Banner>
      )}

      {uncertain && (
        <Banner tone="warn" icon={<WifiOff className="w-4 h-4" />}>
          <p className="font-medium">Yuborilganmi-yo'qmi noaniq.</p>
          <p className="mt-1">Aloqa uzildi. Qayta yuborsangiz dublikat bo'lmaydi — tizim bir xil so'rovni tanib oladi.</p>
        </Banner>
      )}

      {/* Telegram MainButton bo'lmasa (brauzer) — sahifa ichidagi tugma */}
      <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-4 bg-eko-surface border-t border-eko-line flex gap-2">
        <Button size="lg" onClick={onBack} disabled={busy}>Orqaga</Button>
        {!native && (
          <Button
            variant="primary" size="lg" block loading={busy} disabled={!canSubmit}
            icon={uncertain ? <RefreshCw className="w-5 h-5" /> : undefined}
            onClick={() => submit(false)}
          >
            {uncertain ? "Qayta yuborish — dublikat bo'lmaydi" : label}
          </Button>
        )}
      </div>
    </div>
  )
}

/** Muvaffaqiyat ekrani — varaqni to'ldiradi, o'zi yopilmaydi. */
export function TgPaySuccess({ result, hasNext, onNext, onClose }: {
  result: PayResult
  hasNext: boolean
  onNext: () => void
  onClose: () => void
}) {
  const native = useMainButton({
    text: hasNext ? 'Keyingi qarzdor' : 'Yopish',
    onClick: hasNext ? onNext : onClose,
    visible: true,
  })
  return (
    <div className="p-6 min-h-[60dvh] flex flex-col items-center justify-center text-center gap-3">
      <CheckCircle2 className="w-14 h-14 text-eko-success" aria-hidden />
      <p className="eko-text-md text-eko-text-2">{result.replay ? "To'lov avval yozilgan edi" : "To'lov yozildi"}</p>
      <p className="eko-text-lead font-semibold text-eko-text eko-num">{f.money(result.amount)}</p>
      {result.receipt && (
        <p className="text-eko-text">
          <span className="block eko-text-sm text-eko-muted">Kvitansiya</span>
          <span className="font-mono text-[20px] leading-7 tracking-wide">{result.receipt}</span>
        </p>
      )}
      <p className="eko-text-md text-eko-text-2">
        {result.remaining > 0 ? <>Qolgan qarz: <b className="eko-num text-eko-text">{f.money(result.remaining)}</b></> : 'Qarz yopildi'}
      </p>
      <div className="w-full mt-4 space-y-2">
        {!native && hasNext && <Button variant="primary" size="lg" block onClick={onNext}>Keyingi qarzdor</Button>}
        {!native && !hasNext && <Button variant="primary" size="lg" block onClick={onClose}>Yopish</Button>}
        {(native || hasNext) && <Button size="lg" block onClick={onClose}>Yopish</Button>}
      </div>
    </div>
  )
}
