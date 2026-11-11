import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { ekoKeys } from '../lib/queries'
import { errMsg } from '../lib/ekoErrors'
import {
  Page, PageHeader, Card, Button, Badge, Banner, Menu, SegmentedControl, DateRange, DataTable,
  ErrorState, SkeletonList, f,
} from '../ui'

type DocKind = 'charge' | 'payment' | 'talon' | 'opening'

interface ReconRow {
  date: string | null
  kind: DocKind
  doc: string | null
  description: string
  debit: number | null
  credit: number | null
  balance: number | null
}

interface ReconData {
  mode: 'full' | 'payments_only'
  entity: {
    name: string; stir: string | null; address: string | null; phone: string | null
    contractNumber: string | null; district: string | null; mahalla: string | null
    billingMode: string; monthlyFee: number; cubicPrice: number
    creatorName: string | null; createdAt: string | null
  }
  providerConfigured: boolean
  openingBalance: number
  rows: ReconRow[]
  totals: { debit: number; credit: number }
  closingBalance: number
  closingDebt?: number
  closingAdvance?: number
  periodFrom: string | null
  periodTo: string | null
}

const DOC_LABEL: Record<string, string> = { charge: 'Hisob', talon: 'Talon', payment: "To'lov", opening: '' }

type PeriodKey = 'all' | 'year' | '12m' | 'custom'

function todayUzIso(): string { return new Date(Date.now() + 5 * 3600e3).toISOString().slice(0, 10) }

function resolvePeriod(key: PeriodKey): { from: string; to: string } {
  const today = todayUzIso()
  if (key === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today }
  if (key === '12m') {
    const d = new Date(`${today}T00:00:00Z`)
    d.setUTCFullYear(d.getUTCFullYear() - 1)
    d.setUTCDate(d.getUTCDate() + 1)
    return { from: d.toISOString().slice(0, 10), to: today }
  }
  return { from: '', to: '' }
}

/**
 * Akt sverka — hujjat sahifasi. Bitta savol: "Taraflar o'rtasida hisob-kitob qanday?"
 * Eng katta raqam — qolgan qarz (yoki avans); jadvalda faqat gorizontal chiziqlar.
 */
export default function ReconciliationPage() {
  const { entityId } = useParams<{ entityId: string }>()
  const [periodKey, setPeriodKey] = useState<PeriodKey>('all')
  const [range, setRange] = useState({ from: '', to: '' })
  const [draft, setDraft] = useState({ from: '', to: '' })
  const [busy, setBusy] = useState<'csv' | 'xlsx' | 'print' | null>(null)

  const query = (() => {
    const p = new URLSearchParams()
    if (range.from) p.set('from', range.from)
    if (range.to) p.set('to', range.to)
    return p.toString()
  })()

  const q = useQuery<ReconData>({
    queryKey: [...ekoKeys.entities, 'reconciliation', entityId, query],
    queryFn: async () => (await ekoApi.get(`/entities/${entityId}/reconciliation?${query}`)).data.data,
    enabled: !!entityId,
    staleTime: 30_000,
  })
  const data = q.data

  function selectPeriod(key: PeriodKey) {
    setPeriodKey(key)
    if (key !== 'custom') { const p = resolvePeriod(key); setRange(p); setDraft(p) }
  }

  async function download(kind: 'csv' | 'xlsx') {
    if (!entityId || !data) return
    setBusy(kind)
    try {
      const res = await ekoApi.get(`/entities/${entityId}/reconciliation.${kind}?${query}`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `akt_sverka_${data.entity.name.slice(0, 30)}.${kind}`
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setBusy(null) }
  }

  async function openPrint() {
    if (!entityId) return
    setBusy('print')
    try {
      const res = await ekoApi.get(`/entities/${entityId}/reconciliation/print?${query}`, { responseType: 'text' })
      const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html;charset=utf-8' }))
      if (!window.open(url, '_blank')) toast.error("Brauzer yangi oynani bloklab qo'ydi — ruxsat bering")
      setTimeout(() => URL.revokeObjectURL(url), 60000)
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setBusy(null) }
  }

  const back = { to: '/ekohisob/entities', label: 'Tashkilotlar' }

  if (q.isLoading) {
    return (
      <Page>
        <PageHeader loading back={back} title="Akt sverka" />
        <Card flush><SkeletonList rows={8} /></Card>
      </Page>
    )
  }
  if (q.isError || !data) {
    return (
      <Page>
        <PageHeader back={back} title="Akt sverka" />
        <Card flush><ErrorState title={errMsg(q.error)} onRetry={() => q.refetch()} /></Card>
      </Page>
    )
  }

  const showBalance = data.mode === 'full'
  const debt = data.closingDebt ?? Math.max(0, data.closingBalance)
  const advance = data.closingAdvance ?? Math.max(0, -data.closingBalance)
  const name = data.entity.name
  const verdict = debt > 0
    ? <><b>{name}</b> tashkilotining <b className="eko-num">{f.money(debt)}</b> qarzi mavjud.</>
    : advance > 0
      ? <><b>{name}</b> tashkilotida <b className="eko-num">{f.money(advance)}</b> ortiqcha to'lov (avans) mavjud.</>
      : <>Taraflar o'rtasida hisob-kitob to'liq amalga oshirilgan, qarzdorlik yo'q.</>

  const rows: ReconRow[] = [
    ...(showBalance ? [{
      date: data.periodFrom, kind: 'opening' as const, doc: null, description: 'Davr boshiga qoldiq',
      debit: null, credit: null, balance: data.openingBalance,
    }] : []),
    ...data.rows,
  ]

  const meta = [
    [data.entity.district, data.entity.mahalla].filter(Boolean).join(' / '),
    data.entity.stir && `STIR ${data.entity.stir}`,
    data.entity.contractNumber && `Shartnoma ${data.entity.contractNumber}`,
    data.entity.phone && f.phone(data.entity.phone),
    data.entity.creatorName && `Kiritgan: ${data.entity.creatorName}`,
  ].filter(Boolean).join(' · ')

  return (
    <Page>
      <PageHeader
        back={back}
        title={name}
        subtitle={showBalance ? verdict : <>Akt sverka{data.periodFrom && data.periodTo && <> · {f.date(data.periodFrom)} — {f.date(data.periodTo)}</>}</>}
        actions={
          <>
            <Menu
              items={[
                { key: 'xlsx', label: 'Excel (.xlsx)', onSelect: () => download('xlsx') },
                { key: 'csv', label: 'CSV (.csv)', onSelect: () => download('csv') },
              ]}
              trigger={(p) => (
                <Button {...p} loading={busy === 'csv' || busy === 'xlsx'} icon={<Download className="w-4 h-4" />}>Yuklab olish</Button>
              )}
            />
            <Button variant="primary" loading={busy === 'print'} icon={<Printer className="w-4 h-4" />} onClick={openPrint}>
              Chop etish
            </Button>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2 eko-text-sm text-eko-muted">
        {meta && <span>{meta}</span>}
        <Badge tone={data.entity.billingMode === 'talon' ? 'info' : 'neutral'}>
          {data.entity.billingMode === 'talon'
            ? `Talon · ${f.money(data.entity.cubicPrice)}/kub`
            : data.entity.billingMode === 'monthly_fixed'
              ? `Oylik · ${f.money(data.entity.monthlyFee)}`
              : "O'zgaruvchan"}
        </Badge>
      </div>

      {!data.providerConfigured && (
        <Banner tone="warn">
          Korxona rekvizitlari to'ldirilmagan — <b>Sozlamalar</b> bo'limida kiriting, aks holda chop etilgan hujjat rasmiy kuchga ega bo'lmaydi.
        </Banner>
      )}

      <div className="flex flex-wrap items-start gap-3">
        <SegmentedControl
          ariaLabel="Davr"
          value={periodKey}
          onChange={selectPeriod}
          options={[
            { value: 'all' as const, label: 'Butun davr' },
            { value: 'year' as const, label: 'Joriy yil' },
            { value: '12m' as const, label: '12 oy' },
            { value: 'custom' as const, label: "Qo'lda" },
          ]}
        />
        {periodKey === 'custom' && <DateRange
          from={draft.from} to={draft.to}
          onChange={(r) => { setDraft(r); if (r.from && r.to) setRange(r) }}
        />}
      </div>

      {/* Lead: qolgan qarz (yoki avans) + kichik qolgan summalar */}
      {showBalance && (
        <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-3">
          <div>
            <p className="eko-text-sm text-eko-muted">{debt === 0 && advance > 0 ? 'Ortiqcha to\'lov (avans)' : 'Qolgan qarz'}</p>
            <p className="mt-0.5 flex items-baseline gap-2">
              <span className="eko-text-lead font-semibold eko-num text-eko-text">{f.num(debt === 0 && advance > 0 ? advance : debt)}</span>
              <span className="eko-text-base text-eko-muted">so'm</span>
            </p>
          </div>
          <dl className="flex flex-wrap gap-x-8 gap-y-2 eko-text-sm">
            <Small label="Davr boshiga qoldiq" value={data.openingBalance} />
            <Small label="Hisoblandi" value={data.totals.debit} />
            <Small label="To'landi" value={data.totals.credit} />
            {debt > 0 && advance > 0 && <Small label="Avans" value={advance} />}
          </dl>
        </section>
      )}

      {data.mode === 'payments_only' && (
        <Banner tone="info">
          Bu tashkilot <b>o'zgaruvchan</b> rejimda — oldindan hisoblanadigan oylik summa yo'q. Quyida faqat qabul qilingan to'lovlar keltirilgan, saldo hisoblanmaydi.
        </Banner>
      )}

      <Card flush>
        <DataTable
          aria-label="Akt sverka"
          rows={data.rows.length === 0 ? [] : rows}
          rowKey={(r, i) => `${r.kind}-${i}`}
          maxHeight="65vh"
          empty={{
            title: 'Tanlangan davrda hujjat yo\'q',
            hint: "Boshqa davr tanlang yoki «Butun davr» ni bosing.",
            action: <Button onClick={() => selectPeriod('all')}>Butun davr</Button>,
          }}
          columns={[
            { key: 'date', title: 'Sana', width: 110, render: (r) => f.date(r.date) },
            {
              key: 'kind', title: 'Hujjat', width: 150, mobile: 'secondary',
              render: (r) => r.kind === 'opening' ? null : (
                <span className="inline-flex items-center gap-1.5 flex-wrap">
                  <span>{DOC_LABEL[r.kind]}</span>
                  {r.doc && <span className="eko-text-xs text-eko-muted">{r.doc}</span>}
                </span>
              ),
            },
            { key: 'description', title: 'Izoh', mobile: 'primary', render: (r) => <span className={r.kind === 'opening' ? 'font-medium' : ''}>{r.description}</span> },
            { key: 'debit', title: 'Hisoblandi', align: 'right', width: 130, render: (r) => (r.debit ? f.num(r.debit) : null) },
            { key: 'credit', title: "To'landi", align: 'right', width: 130, render: (r) => (r.credit ? f.num(r.credit) : null) },
            ...(showBalance ? [{
              key: 'balance', title: 'Saldo', align: 'right' as const, width: 130,
              render: (r: ReconRow) => (r.balance == null ? null : f.num(r.balance)),
            }] : []),
          ]}
          footer={data.rows.length === 0 ? undefined : {
            description: 'Jami davr bo\'yicha',
            debit: f.num(data.totals.debit),
            credit: f.num(data.totals.credit),
            ...(showBalance ? { balance: f.num(data.closingBalance) } : {}),
          }}
        />
        {data.rows.length > 0 && (
          <p className="px-4 sm:px-5 py-2 border-t border-eko-line eko-text-xs text-eko-muted">{f.num(data.rows.length)} ta hujjat</p>
        )}
      </Card>

    </Page>
  )
}

function Small({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <dt className="text-eko-muted">{label}</dt>
      <dd className="eko-num font-medium text-eko-text">{f.num(value)}</dd>
    </div>
  )
}
