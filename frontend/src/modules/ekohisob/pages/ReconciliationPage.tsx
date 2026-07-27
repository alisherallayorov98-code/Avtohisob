import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, Printer, FileSpreadsheet, FileText, Scale, Phone, Loader2,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import {
  Page, PageHeader, Card, Button, Badge, Banner, SegmentedControl,
  EmptyState, ErrorState, SkeletonList, cx, f,
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
    name: string; stir: string | null; address: string | null; phone: string | null
    contractNumber: string | null; district: string | null; mahalla: string | null
    billingMode: string; monthlyFee: number; cubicPrice: number
    creatorName: string | null; createdAt: string | null
  }
  provider: { name: string | null }
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

function resolvePeriod(key: PeriodKey): { from: string; to: string } {
  const now = new Date()
  if (key === 'year') return { from: `${now.getFullYear()}-01-01`, to: ymd(now) }
  if (key === '12m') {
    const back = new Date(now)
    back.setFullYear(back.getFullYear() - 1)
    back.setDate(back.getDate() + 1)
    return { from: ymd(back), to: ymd(now) }
  }
  return { from: '', to: '' }
}

/**
 * Akt sverka — to'liq sahifa ko'rinishi.
 *
 * Nega alohida sahifa: akt sverka hujjat, uni o'qish kerak. Modal oynada
 * jadval siqilib, ustunlar yonga siljiydi. Bu yerda sarlavha yopishib turadi
 * (uzun ro'yxatni skroll qilganda ustun nomlari ko'rinib qoladi), qatorlar
 * zebra, sonlar tik ustunda. Havolani nusxalab yuborish ham mumkin.
 */
export default function ReconciliationPage() {
  const { entityId } = useParams<{ entityId: string }>()
  const navigate = useNavigate()

  const [data, setData] = useState<ReconData | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [periodKey, setPeriodKey] = useState<PeriodKey>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [busy, setBusy] = useState<'csv' | 'xlsx' | 'print' | null>(null)

  const query = useCallback(() => {
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    return p.toString()
  }, [from, to])

  const load = useCallback(() => {
    if (!entityId) return
    setLoading(true)
    setFailed(false)
    ekoApi.get(`/entities/${entityId}/reconciliation?${query()}`)
      .then(res => setData(res.data.data))
      .catch(() => { setData(null); setFailed(true) })
      .finally(() => setLoading(false))
  }, [entityId, query])

  useEffect(load, [load])

  function selectPeriod(key: PeriodKey) {
    setPeriodKey(key)
    if (key !== 'custom') {
      const p = resolvePeriod(key)
      setFrom(p.from); setTo(p.to)
    }
  }

  async function download(kind: 'csv' | 'xlsx') {
    if (!entityId || !data) return
    setBusy(kind)
    try {
      const res = await ekoApi.get(`/entities/${entityId}/reconciliation.${kind}?${query()}`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `akt_sverka_${data.entity.name.slice(0, 30)}.${kind}`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Yuklab olishda xato')
    } finally { setBusy(null) }
  }

  async function openPrint() {
    if (!entityId) return
    setBusy('print')
    try {
      const res = await ekoApi.get(`/entities/${entityId}/reconciliation/print?${query()}`, {
        responseType: 'text',
      })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html;charset=utf-8' }))
      const w = window.open(url, '_blank')
      if (!w) toast.error('Brauzer yangi oynani bloklab qo\'ydi — ruxsat bering')
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch {
      toast.error('Hujjatni ochishda xato')
    } finally { setBusy(null) }
  }

  if (loading) {
    return (
      <Page>
        <PageHeader title="Akt sverka" subtitle="Yuklanmoqda..." />
        <Card flush><SkeletonList rows={8} /></Card>
      </Page>
    )
  }
  if (failed || !data) {
    return (
      <Page>
        <PageHeader title="Akt sverka" />
        <Card flush><ErrorState onRetry={load} /></Card>
      </Page>
    )
  }

  const showBalance = data.mode === 'full'
  const closing = data.closingBalance
  const colCount = showBalance ? 6 : 5

  return (
    <Page>
      <PageHeader
        icon={<Scale className="w-5 h-5" />}
        title={data.entity.name}
        subtitle={
          <>
            Akt sverka
            {data.periodFrom && data.periodTo && (
              <> · {f.date(data.periodFrom)} — {f.date(data.periodTo)}</>
            )}
          </>
        }
        actions={
          <>
            <Button
              variant="ghost" size="sm" icon={<ArrowLeft className="w-4 h-4" />}
              onClick={() => navigate(-1)}
            >
              Orqaga
            </Button>
            <Button
              variant="secondary" size="sm" loading={busy === 'csv'}
              icon={<FileText className="w-4 h-4" />} onClick={() => download('csv')}
            >
              CSV
            </Button>
            <Button
              variant="secondary" size="sm" loading={busy === 'xlsx'}
              icon={<FileSpreadsheet className="w-4 h-4" />} onClick={() => download('xlsx')}
            >
              Excel
            </Button>
            <Button
              variant="primary" size="sm" loading={busy === 'print'}
              icon={<Printer className="w-4 h-4" />} onClick={openPrint}
            >
              Chop etish
            </Button>
          </>
        }
      />

      {/* Tashkilot pasporti */}
      <Card>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-xs text-eko-muted">
          {[data.entity.district, data.entity.mahalla].filter(Boolean).length > 0 && (
            <span>{[data.entity.district, data.entity.mahalla].filter(Boolean).join(' / ')}</span>
          )}
          {data.entity.stir && <span>STIR <b className="text-eko-text-2">{data.entity.stir}</b></span>}
          {data.entity.contractNumber && (
            <span>Shartnoma <b className="text-eko-text-2">{data.entity.contractNumber}</b></span>
          )}
          {data.entity.phone && (
            <span className="inline-flex items-center gap-1">
              <Phone className="w-3 h-3" />{f.phone(data.entity.phone)}
            </span>
          )}
          {data.entity.creatorName && (
            <span>Kiritgan <b className="text-eko-text-2">{data.entity.creatorName}</b></span>
          )}
          <Badge tone={data.entity.billingMode === 'talon' ? 'info' : 'neutral'}>
            {data.entity.billingMode === 'talon'
              ? `Talon · ${f.money(data.entity.cubicPrice)}/kub`
              : data.entity.billingMode === 'monthly_fixed'
                ? `Oylik · ${f.money(data.entity.monthlyFee)}`
                : "O'zgaruvchan"}
          </Badge>
        </div>
      </Card>

      {!data.providerConfigured && (
        <Banner tone="warn">
          Korxona rekvizitlari to'ldirilmagan — <b>Sozlamalar</b> bo'limida kiriting,
          aks holda chop etilgan hujjat rasmiy kuchga ega bo'lmaydi.
        </Banner>
      )}

      {/* Davr tanlash */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
          value={periodKey}
          onChange={selectPeriod}
          options={[
            { value: 'all' as const, label: 'Butun davr' },
            { value: 'year' as const, label: 'Joriy yil' },
            { value: '12m' as const, label: '12 oy' },
            { value: 'custom' as const, label: "Qo'lda" },
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

      {/* Saldo xulosasi */}
      <div className={cx('grid gap-3', showBalance ? 'grid-cols-2 lg:grid-cols-4' : 'grid-cols-2')}>
        {showBalance && <Summary label="Davr boshiga qoldiq" value={data.openingBalance} />}
        <Summary label="Hisoblandi" value={data.totals.debit} tone="warn" />
        <Summary label="To'landi" value={data.totals.credit} tone="accent" />
        {showBalance && (
          <Summary
            label={closing < 0 ? 'Ortiqcha to\'lov (avans)' : 'Qolgan qarz'}
            value={Math.abs(closing)}
            tone={closing > 0 ? 'danger' : 'accent'}
            strong
          />
        )}
      </div>

      {data.mode === 'payments_only' && (
        <Banner tone="info">
          Bu tashkilot <b>o'zgaruvchan</b> rejimda — oldindan hisoblanadigan oylik summa
          yo'q. Quyida faqat qabul qilingan to'lovlar keltirilgan, saldo hisoblanmaydi.
        </Banner>
      )}

      {/* ── Jadval ── */}
      {data.rows.length === 0 ? (
        <Card flush>
          <EmptyState
            title="Tanlangan davrda hujjat yo'q"
            hint="Boshqa davr tanlang yoki «Butun davr» ni bosing."
            action={<Button variant="secondary" onClick={() => selectPeriod('all')}>Butun davr</Button>}
          />
        </Card>
      ) : (
        <Card flush className="overflow-hidden">
          <div className="overflow-auto max-h-[65vh]">
            <table className="w-full text-[13px] border-collapse min-w-[720px]">
              {/* Sarlavha yopishib turadi — uzun ro'yxatni skroll qilganda
                  ustun nomlari ko'rinib qoladi */}
              <thead className="sticky top-0 z-10">
                <tr className="bg-eko-surface-2">
                  <Th className="w-[110px]">Sana</Th>
                  <Th className="w-[150px]">Hujjat</Th>
                  <Th>Izoh</Th>
                  <Th align="right" className="w-[130px]">Hisoblandi</Th>
                  <Th align="right" className="w-[130px]">To'landi</Th>
                  {showBalance && <Th align="right" className="w-[130px]">Saldo</Th>}
                </tr>
              </thead>
              <tbody>
                {showBalance && (
                  <tr className="bg-eko-surface-2/60">
                    <Td className="whitespace-nowrap text-eko-text-2">{f.date(data.periodFrom)}</Td>
                    <Td colSpan={3} className="font-medium text-eko-text-2">Davr boshiga qoldiq</Td>
                    <Td align="right" />
                    <Td align="right" className="font-semibold">{f.num(data.openingBalance)}</Td>
                  </tr>
                )}

                {data.rows.map((r, i) => (
                  <tr key={i} className={cx(i % 2 === 1 && 'bg-eko-surface-2/40', 'hover:bg-eko-accent-soft')}>
                    <Td className="whitespace-nowrap text-eko-text-2">{f.date(r.date)}</Td>
                    <Td className="whitespace-nowrap">
                      <Badge tone={r.kind === 'payment' ? 'success' : r.kind === 'talon' ? 'info' : 'neutral'}>
                        {DOC_LABEL[r.kind]}
                      </Badge>
                      {r.doc && <span className="text-eko-subtle text-[11px] ml-1.5">{r.doc}</span>}
                    </Td>
                    <Td className="text-eko-text-2">{r.description}</Td>
                    <Td align="right" className="text-eko-warn">{r.debit ? f.num(r.debit) : ''}</Td>
                    <Td align="right" className="text-eko-success">{r.credit ? f.num(r.credit) : ''}</Td>
                    {showBalance && (
                      <Td align="right" className="font-semibold">{f.num(r.balance)}</Td>
                    )}
                  </tr>
                ))}

                <tr className="bg-eko-surface-2 font-semibold">
                  <Td colSpan={3} className="uppercase tracking-wide text-[12px]">Jami davr bo'yicha</Td>
                  <Td align="right">{f.num(data.totals.debit)}</Td>
                  <Td align="right">{f.num(data.totals.credit)}</Td>
                  {showBalance && (
                    <Td align="right" className={closing > 0 ? 'text-eko-danger' : 'text-eko-success'}>
                      {f.num(closing)}
                    </Td>
                  )}
                </tr>
              </tbody>
            </table>
          </div>

          <div className="px-4 sm:px-5 py-2 border-t border-eko-line text-[11px] text-eko-muted">
            {data.rows.length} ta hujjat · {colCount} ustun
          </div>
        </Card>
      )}

      {/* Xulosa */}
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
            ? <><b>{data.entity.name}</b> tashkilotining <b>{f.money(closing)}</b> qarzi mavjud.</>
            : closing < 0
              ? <><b>{data.entity.name}</b> tashkilotida <b>{f.money(-closing)}</b> ortiqcha to'lov (avans) mavjud.</>
              : <>Taraflar o'rtasida hisob-kitob to'liq amalga oshirilgan, qarzdorlik yo'q.</>}
        </div>
      )}
    </Page>
  )
}

// ── Jadval yacheykalari ──────────────────────────────────────────────────────
// Chegara va bo'shliq bir joyda: jadval "elektron jadval" ko'rinishida bo'lishi
// uchun har yacheykaning chegarasi bir xil bo'lishi shart.

function Th({
  children, align = 'left', className,
}: {
  children?: React.ReactNode; align?: 'left' | 'right'; className?: string
}) {
  return (
    <th
      className={cx(
        'px-3 py-2 border border-eko-line text-[11px] font-semibold uppercase tracking-wide',
        'text-eko-muted bg-eko-surface-2',
        align === 'right' ? 'text-right' : 'text-left',
        className,
      )}
    >
      {children}
    </th>
  )
}

function Td({
  children, align = 'left', className, colSpan,
}: {
  children?: React.ReactNode; align?: 'left' | 'right'; className?: string; colSpan?: number
}) {
  return (
    <td
      colSpan={colSpan}
      className={cx(
        'px-3 py-1.5 border border-eko-line align-top',
        align === 'right' ? 'text-right eko-num' : 'text-left',
        className,
      )}
    >
      {children}
    </td>
  )
}

function Summary({
  label, value, tone = 'neutral', strong,
}: {
  label: string; value: number; tone?: 'neutral' | 'warn' | 'accent' | 'danger'; strong?: boolean
}) {
  const color = {
    neutral: 'text-eko-text',
    warn: 'text-eko-warn',
    accent: 'text-eko-accent-text',
    danger: 'text-eko-danger',
  }[tone]
  return (
    <div className={cx(
      'bg-eko-surface rounded-eko-lg border shadow-eko px-4 py-3',
      strong ? 'border-eko-line-strong' : 'border-eko-line',
    )}>
      <p className="text-[11px] uppercase tracking-wide text-eko-muted truncate">{label}</p>
      <p className={cx('text-xl font-semibold eko-num mt-0.5', color)}>{f.num(value)}</p>
    </div>
  )
}
