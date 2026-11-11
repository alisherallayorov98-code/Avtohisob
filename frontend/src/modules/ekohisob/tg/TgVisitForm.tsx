import { useState } from 'react'
import { tgApi, tgErrorMessage } from './tgApi'
import { Banner, Button, DateInput, Field, Input, f } from '../ui'
import { useMainButton } from './tgTelegram'
import { addDaysIso, getLastFix, todayUzIso } from './tgUtil'
import type { VisitMark } from './tgTypes'

const REASONS = ["Pul yo'q", "Egasi yo'q", 'Rad etdi', "Keyin to'laydi", 'Boshqa'] as const
type Reason = typeof REASONS[number]

type Promise_ = 'none' | 'd3' | 'w1' | 'w2' | 'pick'

const PROMISES: Array<{ key: Promise_; label: string; days?: number }> = [
  { key: 'none', label: "Va'dasiz" },
  { key: 'd3', label: '3 kun', days: 3 },
  { key: 'w1', label: '1 hafta', days: 7 },
  { key: 'w2', label: '2 hafta', days: 14 },
  { key: 'pick', label: 'Sana tanlash' },
]

function chipClass(active: boolean): string {
  return `h-11 px-4 rounded-eko border eko-text-base font-medium ${
    active ? 'bg-eko-text text-eko-surface border-eko-text' : 'bg-eko-surface text-eko-text border-eko-line-strong'
  }`
}

/** "To'lamadi / Va'da" — sabab + ixtiyoriy va'da sanasi -> POST /visits. */
export function TgVisitForm({ entityId, onBack, onDone }: {
  entityId: string
  onBack: () => void
  onDone: (mark: VisitMark) => void
}) {
  const today = todayUzIso()
  const [reason, setReason] = useState<Reason | null>(null)
  const [other, setOther] = useState('')
  const [promise, setPromise] = useState<Promise_>('none')
  const [picked, setPicked] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const promisedDate =
    promise === 'none' ? null
    : promise === 'pick' ? (picked || null)
    : addDaysIso(today, PROMISES.find(p => p.key === promise)?.days ?? 0)

  const reasonText = reason === 'Boshqa' ? other.trim() : (reason ?? '')
  const valid = reasonText.length >= 2 && (promise !== 'pick' || Boolean(picked))

  async function submit() {
    if (!valid) return
    setBusy(true); setError('')
    const fix = getLastFix()
    const kind: VisitMark['kind'] = promisedDate ? 'promised' : 'not_paid'
    try {
      await tgApi.post('/visits', {
        entityId, kind, reason: reasonText,
        ...(promisedDate ? { promisedDate } : {}),
        ...(fix ? { lat: fix.lat, lon: fix.lon } : {}),
      })
      onDone({ kind, promisedDate })
    } catch (err) {
      setError(tgErrorMessage(err, "Qayd etilmadi"))
    } finally { setBusy(false) }
  }

  const label = promisedDate ? `Qayd etish · va'da ${f.date(promisedDate)}` : 'Qayd etish'
  const native = useMainButton({ text: label, onClick: submit, visible: true, loading: busy, disabled: !valid || busy })

  return (
    <div className="p-5 space-y-5">
      <div>
        <p className="eko-text-base font-medium text-eko-text mb-2">Sabab</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Sabab">
          {REASONS.map(r => (
            <button key={r} type="button" role="radio" aria-checked={reason === r} className={chipClass(reason === r)} onClick={() => setReason(r)}>
              {r}
            </button>
          ))}
        </div>
        {reason === 'Boshqa' && (
          <Field className="mt-3" label="Sababni yozing" required>
            {id => <Input id={id} value={other} maxLength={200} onChange={ev => setOther(ev.target.value)} />}
          </Field>
        )}
      </div>

      <div>
        <p className="eko-text-base font-medium text-eko-text mb-2">Va'da sanasi</p>
        <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Va'da sanasi">
          {PROMISES.map(p => (
            <button key={p.key} type="button" role="radio" aria-checked={promise === p.key} className={chipClass(promise === p.key)} onClick={() => setPromise(p.key)}>
              {p.label}
            </button>
          ))}
        </div>
        {promise === 'pick' && (
          <div className="mt-3">
            <DateInput value={picked} onChange={setPicked} min={today} max={addDaysIso(today, 90)} aria-label="Va'da sanasi" />
          </div>
        )}
        {promisedDate && promise !== 'pick' && (
          <p className="eko-text-base text-eko-text-2 mt-2">Va'da: <b className="eko-num">{f.date(promisedDate)}</b></p>
        )}
        {reason === "Keyin to'laydi" && !promisedDate && (
          <p className="eko-text-base text-eko-warn mt-2">"Keyin to'laydi" bo'lsa, va'da sanasini ham tanlang.</p>
        )}
      </div>

      {error && <Banner tone="danger">{error}</Banner>}

      <div className="sticky bottom-0 -mx-5 px-5 pt-3 pb-4 bg-eko-surface border-t border-eko-line flex gap-2">
        <Button size="lg" onClick={onBack} disabled={busy}>Orqaga</Button>
        {!native && (
          <Button variant="primary" size="lg" block loading={busy} disabled={!valid} onClick={submit}>{label}</Button>
        )}
      </div>
    </div>
  )
}
