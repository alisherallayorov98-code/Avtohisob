import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import axios from 'axios'
import { CheckCircle2, XCircle, Ban, HelpCircle, WifiOff, Copy, Printer, RotateCcw, Phone } from 'lucide-react'
import './ui/tokens.css'
import { Button, Card, Field, Input, LinkButton, Skeleton, cx, f } from './ui'
import { BrandMark } from './components/BrandMark'

// Kvitansiya QR kodi shu sahifaga olib keladi. OCHIQ sahifa — kirish talab
// qilinmaydi, shuning uchun `ekoApi` (token qo'shuvchi) o'rniga toza axios.
// Server shaxsiy ma'lumot bermaydi: tashkilot nomi maskalangan holda keladi.
// Xizmat ko'rsatuvchi tashkilot nomi/telefoni verify javobida YO'Q (VERIFY_SELECT
// faqat raqam, summa, oy, sana, tashkilot nomi) — backend kengaytirilsa shu yerda ko'rsatiladi.
const baseURL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  .replace(/\/api$/, '') + '/api/ekohisob'

interface VerifyResult {
  valid: boolean
  voided?: boolean
  ambiguous?: boolean
  voidedAt?: string
  receiptNumber?: string
  amount?: number
  month?: string
  monthLabel?: string
  issuedAt?: string
  entityMasked?: string
  issuerName?: string | null
  issuerPhone?: string | null
}

/** Xizmat ko'rsatuvchi korxona + qo'ng'iroq tugmasi (faqat javobda bo'lsa). */
function Issuer({ name, phone }: { name?: string | null; phone?: string | null }) {
  if (!name && !phone) return null
  const tel = phone ? phone.replace(/[^\d+]/g, '') : ''
  return (
    <div className="mt-5 pt-4 border-t border-eko-line space-y-3">
      {name && (
        <p className="eko-text-base text-eko-text-2">
          Xizmat ko'rsatuvchi: <b className="text-eko-text">{name}</b>
        </p>
      )}
      {tel && (
        <LinkButton href={`tel:${tel}`} variant="secondary" block className="!h-12" icon={<Phone className="w-4 h-4" aria-hidden />}>
          Qo'ng'iroq qilish{phone ? ` · ${f.phone(phone)}` : ''}
        </LinkButton>
      )}
    </div>
  )
}

type State =
  | { kind: 'loading' }
  | { kind: 'network' }
  | { kind: 'result'; data: VerifyResult }

/** Qurilma qorong'i rejimida bo'lsa `.eko-dark` klassi (tokenlar qayta aniqlanadi). */
function usePrefersDark() {
  const [dark, setDark] = useState(
    () => typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-color-scheme: dark)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)')
    if (!mq) return
    const on = () => setDark(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return dark
}

export default function ReceiptVerifyPage() {
  const { param, number } = useParams<{ param?: string; number?: string }>()
  const value = param ?? number
  const navigate = useNavigate()
  const dark = usePrefersDark()
  const [state, setState] = useState<State>({ kind: 'loading' })
  const [manual, setManual] = useState('')
  const [copied, setCopied] = useState(false)

  // Qidiruv tizimlariga ko'rsatilmasin (token havolasi shaxsiy)
  useEffect(() => {
    const meta = document.createElement('meta')
    meta.name = 'robots'
    meta.content = 'noindex'
    document.head.appendChild(meta)
    return () => { document.head.removeChild(meta) }
  }, [])

  const load = useCallback(() => {
    if (!value) { setState({ kind: 'result', data: { valid: false } }); return }
    setState({ kind: 'loading' })
    axios.get(`${baseURL}/receipts/verify/${encodeURIComponent(value)}`, { timeout: 15000 })
      .then(res => setState({ kind: 'result', data: res.data.data ?? { valid: false } }))
      .catch(e => {
        // Javob keldi (400 noto'g'ri format, 404) — "topilmadi"; javob yo'q yoki 5xx — tarmoq xatosi
        if (e?.response && e.response.status < 500 && e.response.status !== 429) {
          setState({ kind: 'result', data: { valid: false } })
        } else {
          setState({ kind: 'network' })
        }
      })
  }, [value])

  useEffect(() => { load() }, [load])

  function submitManual(e: React.FormEvent) {
    e.preventDefault()
    const v = manual.trim()
    if (v) navigate(`/ekohisob/kvitansiya/${encodeURIComponent(v)}`)
  }

  async function copyNumber(n: string) {
    try {
      await navigator.clipboard.writeText(n)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // clipboard yo'q (HTTP/eski brauzer) — raqam ekranda ko'rinib turibdi
    }
  }

  const data = state.kind === 'result' ? state.data : null

  return (
    <div className={cx('eko-app min-h-dvh flex justify-center px-4 py-6 sm:py-10', dark && 'eko-dark')}>
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-5">
          <BrandMark className="w-7 h-7" />
          <div>
            <p className="eko-text-md font-semibold text-eko-text leading-tight">EkoHisob</p>
            <p className="eko-text-xs text-eko-muted">Kvitansiyani tekshirish</p>
          </div>
        </div>

        <Card aria-live="polite">
          {state.kind === 'loading' && <VerifySkeleton />}

          {state.kind === 'network' && (
            <Status
              icon={<WifiOff className="w-7 h-7" />}
              title="Aloqa yo'q"
              text="Tekshirib bo'lmadi. Internetni tekshirib, qayta urinib ko'ring."
              action={<Button variant="secondary" size="lg" block icon={<RotateCcw className="w-4 h-4" />} onClick={load}>Qayta urinish</Button>}
            />
          )}

          {data?.valid && <Valid data={data} copied={copied} onCopy={copyNumber} />}

          {data && !data.valid && data.voided && (
            <>
            <Status
              icon={<Ban className="w-7 h-7" />}
              tone="warn"
              title={`Kvitansiya bekor qilingan${data.voidedAt ? ` (${f.date(data.voidedAt)})` : ''}`}
              text={`${data.receiptNumber ? `${data.receiptNumber} raqamli kvitansiya` : 'Bu kvitansiya'} haqiqiy emas. Aniqlik kiritish uchun xizmat ko'rsatuvchi tashkilotga murojaat qiling.`}
            />
            <Issuer name={data.issuerName} phone={data.issuerPhone} />
            </>
          )}

          {data && !data.valid && !data.voided && data.ambiguous && (
            <>
            <Status
              icon={<HelpCircle className="w-7 h-7" />}
              tone="warn"
              title="Raqam bir necha kvitansiyaga mos"
              text="To'liq havoladan foydalaning: kvitansiyadagi QR-kodni skanerlang."
            />
            <Issuer name={data.issuerName} phone={data.issuerPhone} />
            </>
          )}

          {data && !data.valid && !data.voided && !data.ambiguous && (
            <>
              <Status
                icon={<XCircle className="w-7 h-7" />}
                tone="danger"
                title="Kvitansiya topilmadi"
                text="Raqamni tekshiring yoki xizmat ko'rsatuvchi tashkilotga murojaat qiling."
              />
              <Issuer name={data.issuerName} phone={data.issuerPhone} />
              <form onSubmit={submitManual} className="mt-5 pt-5 border-t border-eko-line space-y-3">
                <Field label="Raqamni qo'lda kiriting">
                  <Input
                    value={manual}
                    onChange={e => setManual(e.target.value)}
                    placeholder="EKO-2026-00001"
                    className="h-12 font-mono"
                    autoCapitalize="characters"
                    autoCorrect="off"
                    spellCheck={false}
                  />
                </Field>
                <Button type="submit" variant="primary" size="lg" block disabled={!manual.trim()}>Tekshirish</Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  )
}

function VerifySkeleton() {
  return (
    <div aria-busy="true" aria-label="Tekshirilmoqda" className="space-y-4">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-10 w-1/2" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-4 w-5/6" />
    </div>
  )
}

function Status({ icon, title, text, tone = 'neutral', action }: {
  icon: React.ReactNode; title: string; text: string; tone?: 'neutral' | 'warn' | 'danger'; action?: React.ReactNode
}) {
  const color = tone === 'danger' ? 'text-eko-danger' : tone === 'warn' ? 'text-eko-warn' : 'text-eko-text-2'
  return (
    <div>
      <p className={cx('flex items-start gap-2.5 text-[22px] leading-7 font-semibold', color)}>
        <span className="shrink-0 mt-0.5" aria-hidden>{icon}</span>
        {title}
      </p>
      <p className="eko-text-base text-eko-text-2 mt-3 leading-relaxed">{text}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  )
}

function Valid({ data, copied, onCopy }: { data: VerifyResult; copied: boolean; onCopy: (n: string) => void }) {
  return (
    <div>
      <p className="flex items-center gap-2.5 text-[24px] leading-8 font-semibold text-eko-success">
        <CheckCircle2 className="w-7 h-7 shrink-0" aria-hidden />
        Kvitansiya haqiqiy
      </p>

      <div className="mt-5">
        <p className="text-[36px] leading-[44px] font-semibold text-eko-text eko-num">
          {f.num(data.amount ?? 0)} <span className="eko-text-lg font-medium text-eko-text-2">so'm</span>
        </p>
        {data.monthLabel && <p className="eko-text-base text-eko-muted mt-1">{data.monthLabel} uchun</p>}
      </div>

      <dl className="mt-5 divide-y divide-eko-line border-y border-eko-line eko-text-base">
        <Row label="Tashkilot" value={data.entityMasked || '—'} />
        <Row label="Berilgan" value={f.dateTime(data.issuedAt)} />
        <div className="flex items-center justify-between gap-3 py-2.5">
          <dt className="text-eko-muted">Raqam</dt>
          <dd className="flex items-center gap-1 min-w-0">
            <span className="font-mono text-eko-text truncate">{data.receiptNumber}</span>
            {data.receiptNumber && (
              <button
                type="button"
                onClick={() => onCopy(data.receiptNumber!)}
                aria-label="Raqamni nusxalash"
                className="shrink-0 w-11 h-11 -my-2 -mr-2 inline-flex items-center justify-center rounded-eko text-eko-muted hover:text-eko-text hover:bg-eko-surface-2"
              >
                {copied ? <CheckCircle2 className="w-4 h-4 text-eko-success" aria-hidden /> : <Copy className="w-4 h-4" aria-hidden />}
              </button>
            )}
          </dd>
        </div>
      </dl>
      {copied && <p className="eko-text-xs text-eko-muted mt-2" role="status">Nusxalandi</p>}

      <p className="eko-text-xs text-eko-muted mt-4">
        Maxfiylik uchun tashkilot nomi qisqartirilgan holda ko'rsatiladi.
      </p>

      <Issuer name={data.issuerName} phone={data.issuerPhone} />

      <Button variant="secondary" size="lg" block className="mt-5 print:hidden" icon={<Printer className="w-4 h-4" />} onClick={() => window.print()}>
        Chop etish
      </Button>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2.5">
      <dt className="text-eko-muted">{label}</dt>
      <dd className="font-medium text-eko-text text-right">{value}</dd>
    </div>
  )
}
