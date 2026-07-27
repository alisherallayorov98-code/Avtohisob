import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { FileSpreadsheet, Printer, Download, Scale, Maximize2, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import {
  Modal, Button, Banner, EmptyState, SkeletonList, SegmentedControl, Badge, cx, f,
} from '../ui'

type DocKind = 'charge' | 'payment' | 'talon'

interface ReconRow {
  date: string
  kind: DocKind
  doc: string | null
  description: string
  debit: number
  credit: number
  balance: number
}

interface ReconData {
  mode: 'full' | 'payments_only'
  entity: {
    name: string; stir: string | null; address: string | null
    contractNumber: string | null; district: string | null; mahalla: string | null
    billingMode: string
    /** Ma'lumotni kim va qachon kiritgan */
    creatorName: string | null; createdAt: string | null
  }
  providerConfigured: boolean
  openingBalance: number
  rows: ReconRow[]
  totals: { debit: number; credit: number }
  closingBalance: number
  periodFrom: string | null
  periodTo: string | null
}

const DOC_LABEL: Record<DocKind, string> = {
  charge: 'Hisob',
  talon: 'Talon',
  payment: "To'lov",
}

type PeriodKey = 'all' | 'year' | '12m' | 'custom'

function ymd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

/** Tez davr tanlovlari → {from, to}. `all` — chegarasiz (butun tarix). */
function resolvePeriod(key: PeriodKey): { from: string; to: string } {
  const now = new Date()
  if (key === 'year') {
    return { from: `${now.getFullYear()}-01-01`, to: ymd(now) }
  }
  if (key === '12m') {
    const back = new Date(now)
    back.setFullYear(back.getFullYear() - 1)
    back.setDate(back.getDate() + 1)
    return { from: ymd(back), to: ymd(now) }
  }
  return { from: '', to: '' }
}

export default function ReconciliationModal({
  entityId, entityName, onClose,
}: {
  entityId: string
  entityName: string
  onClose: () => void
}) {
  const [data, setData] = useState<ReconData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [periodKey, setPeriodKey] = useState<PeriodKey>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<'print' | 'xlsx' | 'csv' | null>(null)
  const navigate = useNavigate()

  const query = useCallback(() => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    return p.toString()
  }, [from, to])

  useEffect(() => {
    setLoading(true)
    setFailed(false)
    ekoApi.get(`/entities/${entityId}/reconciliation?${query()}`)
      .then(res => setData(res.data.data))
      .catch(() => { setData(null); setFailed(true) })
      .finally(() => setLoading(false))
  }, [entityId, query])

  function selectPeriod(key: PeriodKey) {
    setPeriodKey(key)
    if (key !== 'custom') {
      const p = resolvePeriod(key)
      setFrom(p.from); setTo(p.to)
    }
  }

  /** Chop etish sahifasi autentifikatsiya talab qiladi — token bilan olib blob'da ochamiz. */
  async function openPrint() {
    setBusy('print')
    try {
      const res = await ekoApi.get(`/entities/${entityId}/reconciliation/print?${query()}`, { responseType: 'text' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html;charset=utf-8' }))
      const w = window.open(url, '_blank')
      if (!w) toast.error('Brauzer yangi oynani bloklab qo\'ydi — ruxsat bering')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('Hujjatni ochishda xato')
    } finally { setBusy(null) }
  }

  async function downloadFile(kind: 'csv' | 'xlsx') {
    setBusy(kind)
    try {
      const res = await ekoApi.get(`/entities/${entityId}/reconciliation.${kind}?${query()}`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `akt_sverka_${entityName.slice(0, 30)}.${kind}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Yuklab olishda xato')
    } finally { setBusy(null) }
  }

  const showBalance = data?.mode === 'full'
  const closing = data?.closingBalance ?? 0

  return (
    <Modal
      onClose={onClose}
      size="lg"
      icon={<Scale className="w-5 h-5" />}
      title="Akt sverka"
      hint={entityName}
      footer={
        <>
          <Button
            variant="secondary" loading={busy === 'csv'}
            icon={<FileText className="w-4 h-4" />}
            onClick={() => downloadFile('csv')} disabled={!data}
          >
            CSV
          </Button>
          <Button
            variant="secondary" loading={busy === 'xlsx'}
            icon={<FileSpreadsheet className="w-4 h-4" />}
            onClick={() => downloadFile('xlsx')} disabled={!data}
          >
            Excel
          </Button>
          <Button
            variant="primary" className="flex-1"
            loading={busy === 'print'}
            icon={<Printer className="w-4 h-4" />}
            onClick={openPrint} disabled={!data}
          >
            Chop etish
          </Button>
        </>
      }
    >
      <div className="px-5 py-4 space-y-4">
        {/* Davr tanlash */}
        <div className="flex flex-wrap items-center gap-2">
          <SegmentedControl
            value={periodKey}
            onChange={selectPeriod}
            options={[
              { value: 'all' as const, label: 'Butun davr' },
              { value: 'year' as const, label: 'Joriy yil' },
              { value: '12m' as const, label: '12 oy' },
              { value: 'custom' as const, label: 'Qo\'lda' },
            ]}
          />
          {periodKey === 'custom' && (
            <div className="flex items-center gap-1.5">
              <input
                type="date" value={from} onChange={e => setFrom(e.target.value)}
                className="h-8 px-2 rounded-eko border border-eko-line bg-eko-surface text-[13px] text-eko-text"
              />
              <span className="text-eko-subtle text-xs">—</span>
              <input
                type="date" value={to} onChange={e => setTo(e.target.value)}
                className="h-8 px-2 rounded-eko border border-eko-line bg-eko-surface text-[13px] text-eko-text"
              />
            </div>
          )}
        </div>

        {loading ? (
          <SkeletonList rows={5} />
        ) : failed || !data ? (
          <EmptyState
            title="Ma'lumotni yuklab bo'lmadi"
            hint="Internet aloqasini tekshiring va oynani qayta oching."
          />
        ) : (
          <>
            {/* Tashkilot pasporti — kim kiritgan, qayerda, qanday rejimda.
                "Bu yozuv kimniki?" savoliga shu yerda javob bo'ladi. */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-eko-muted">
              {[data.entity.district, data.entity.mahalla].filter(Boolean).length > 0 && (
                <span>{[data.entity.district, data.entity.mahalla].filter(Boolean).join(' / ')}</span>
              )}
              {data.entity.stir && <span>STIR {data.entity.stir}</span>}
              {data.entity.contractNumber && <span>Shartnoma {data.entity.contractNumber}</span>}
              {data.entity.creatorName && (
                <span className="text-eko-text-2">
                  Kiritgan: <b className="font-medium">{data.entity.creatorName}</b>
                  {data.entity.createdAt && ` · ${f.date(data.entity.createdAt)}`}
                </span>
              )}
            </div>

            {/* Modal tez ko'rish uchun; to'liq hujjatni o'qish alohida sahifada
                qulayroq — u yerda jadval keng va sarlavha yopishib turadi. */}
            <Button
              variant="secondary" size="sm" block
              icon={<Maximize2 className="w-4 h-4" />}
              onClick={() => { onClose(); navigate(`/ekohisob/akt/${entityId}`) }}
            >
              To'liq ekranda ochish
            </Button>

            {!data.providerConfigured && (
              <Banner tone="warn">
                Korxona rekvizitlari to'ldirilmagan — <b>Sozlamalar</b> bo'limida kiriting,
                aks holda chop etilgan hujjat rasmiy kuchga ega bo'lmaydi.
              </Banner>
            )}

            {/* Saldo xulosasi */}
            <div className={cx('grid gap-2', showBalance ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-2')}>
              {showBalance && (
                <Summary label="Boshiga qoldiq" value={data.openingBalance} />
              )}
              <Summary label="Hisoblandi" value={data.totals.debit} tone="warn" />
              <Summary label="To'landi" value={data.totals.credit} tone="accent" />
              {showBalance && (
                <Summary
                  label={closing < 0 ? 'Avans' : 'Qolgan qarz'}
                  value={Math.abs(closing)}
                  tone={closing > 0 ? 'danger' : 'accent'}
                  strong
                />
              )}
            </div>

            {data.mode === 'payments_only' && (
              <Banner tone="info">
                Bu tashkilot <b>o'zgaruvchan</b> rejimda — oldindan hisoblanadigan oylik
                summa yo'q. Quyida faqat qabul qilingan to'lovlar keltirilgan.
              </Banner>
            )}

            {/* Harakat jadvali */}
            {data.rows.length === 0 ? (
              <EmptyState
                title="Tanlangan davrda hujjat yo'q"
                hint="Boshqa davr tanlang yoki 'Butun davr' ni bosing."
              />
            ) : (
              <>
                {/* Kompyuter — jadval */}
                <div className="hidden sm:block overflow-x-auto -mx-1">
                  <table className="w-full text-[13px] min-w-[560px]">
                    <thead>
                      <tr className="text-[11px] uppercase tracking-wide text-eko-muted">
                        <th className="text-left font-medium py-2 px-1">Sana</th>
                        <th className="text-left font-medium py-2 px-1">Hujjat</th>
                        <th className="text-left font-medium py-2 px-1">Izoh</th>
                        <th className="text-right font-medium py-2 px-1">Hisoblandi</th>
                        <th className="text-right font-medium py-2 px-1">To'landi</th>
                        {showBalance && <th className="text-right font-medium py-2 px-1">Saldo</th>}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-eko-line">
                      {showBalance && (
                        <tr className="text-eko-text-2">
                          <td className="py-2 px-1 whitespace-nowrap">{f.date(data.periodFrom)}</td>
                          <td className="py-2 px-1" colSpan={2}>Davr boshiga qoldiq</td>
                          <td /><td />
                          <td className="py-2 px-1 text-right font-semibold eko-num">{f.num(data.openingBalance)}</td>
                        </tr>
                      )}
                      {data.rows.map((r, i) => (
                        <tr key={i} className="hover:bg-eko-surface-2">
                          <td className="py-2 px-1 whitespace-nowrap text-eko-text-2">{f.date(r.date)}</td>
                          <td className="py-2 px-1 whitespace-nowrap">
                            <Badge tone={r.kind === 'payment' ? 'success' : 'neutral'}>{DOC_LABEL[r.kind]}</Badge>
                            {r.doc && <span className="text-eko-subtle text-[11px] ml-1.5">{r.doc}</span>}
                          </td>
                          <td className="py-2 px-1 text-eko-text-2">{r.description}</td>
                          <td className="py-2 px-1 text-right eko-num text-eko-warn">
                            {r.debit ? f.num(r.debit) : ''}
                          </td>
                          <td className="py-2 px-1 text-right eko-num text-eko-success">
                            {r.credit ? f.num(r.credit) : ''}
                          </td>
                          {showBalance && (
                            <td className="py-2 px-1 text-right eko-num font-semibold">{f.num(r.balance)}</td>
                          )}
                        </tr>
                      ))}
                      <tr className="bg-eko-surface-2 font-semibold">
                        <td className="py-2.5 px-1" colSpan={3}>JAMI davr bo'yicha</td>
                        <td className="py-2.5 px-1 text-right eko-num">{f.num(data.totals.debit)}</td>
                        <td className="py-2.5 px-1 text-right eko-num">{f.num(data.totals.credit)}</td>
                        {showBalance && (
                          <td className={cx('py-2.5 px-1 text-right eko-num',
                            closing > 0 ? 'text-eko-danger' : 'text-eko-success')}>
                            {f.num(closing)}
                          </td>
                        )}
                      </tr>
                    </tbody>
                  </table>
                </div>

                {/* Telefon — kartalar (jadval yonga siljimasin) */}
                <div className="sm:hidden divide-y divide-eko-line border-t border-eko-line">
                  {data.rows.map((r, i) => (
                    <div key={i} className="py-2.5 flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <Badge tone={r.kind === 'payment' ? 'success' : 'neutral'}>{DOC_LABEL[r.kind]}</Badge>
                          <span className="text-xs text-eko-muted">{f.date(r.date)}</span>
                        </div>
                        <p className="text-[13px] text-eko-text-2 mt-1 leading-snug">{r.description}</p>
                        {r.doc && <p className="text-[11px] text-eko-subtle mt-0.5">{r.doc}</p>}
                      </div>
                      <div className="text-right shrink-0">
                        <p className={cx('text-sm font-semibold eko-num',
                          r.credit ? 'text-eko-success' : 'text-eko-warn')}>
                          {r.credit ? `−${f.num(r.credit)}` : `+${f.num(r.debit)}`}
                        </p>
                        {showBalance && (
                          <p className="text-[11px] text-eko-muted eko-num mt-0.5">
                            saldo {f.num(r.balance)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            )}

            {/* Xulosa jumlasi — hujjatdagi bilan bir xil */}
            {showBalance && (
              <div
                className={cx(
                  'rounded-eko-lg border px-4 py-3 text-sm',
                  closing > 0
                    ? 'bg-eko-danger-soft border-eko-danger-line text-eko-danger'
                    : 'bg-eko-success-soft border-eko-success-line text-eko-success',
                )}
              >
                {closing > 0
                  ? <><b>{f.money(closing)}</b> qarz mavjud.</>
                  : closing < 0
                    ? <><b>{f.money(-closing)}</b> ortiqcha to'lov (avans) mavjud.</>
                    : <>Hisob-kitob to'liq amalga oshirilgan, qarzdorlik yo'q.</>}
              </div>
            )}

            <p className="text-[11px] text-eko-subtle flex items-center gap-1.5">
              <Download className="w-3 h-3" />
              Chop etilgan hujjatda ikki tomon rekvizitlari va imzo joylari bo'ladi.
            </p>
          </>
        )}
      </div>
    </Modal>
  )
}

function Summary({
  label, value, tone = 'neutral', strong,
}: {
  label: string
  value: number
  tone?: 'neutral' | 'warn' | 'accent' | 'danger'
  strong?: boolean
}) {
  const color = {
    neutral: 'text-eko-text',
    warn: 'text-eko-warn',
    accent: 'text-eko-accent-text',
    danger: 'text-eko-danger',
  }[tone]
  return (
    <div className={cx(
      'rounded-eko border px-3 py-2',
      strong ? 'border-eko-line-strong bg-eko-surface-2' : 'border-eko-line',
    )}>
      <p className="text-[11px] uppercase tracking-wide text-eko-muted truncate">{label}</p>
      <p className={cx('text-base font-semibold eko-num mt-0.5', color)}>{f.num(value)}</p>
    </div>
  )
}
