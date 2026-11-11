import { useCallback, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Download, Printer, FileSpreadsheet, Info } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import { ekoKeys } from '../lib/queries'
import { errMsg } from '../lib/ekoErrors'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import DistrictBreakdown, { DistrictRow } from '../components/reports/DistrictBreakdown'
import InspectorPerformance, { InspectorRow, InspectorSelf } from '../components/reports/InspectorPerformance'
import TopDebtors, { TopDebtorRow } from '../components/reports/TopDebtors'
import InspectorReportModal from '../components/reports/InspectorReportModal'
import StoppedPaying from '../components/reports/StoppedPaying'
import MonthlyBreakdown from '../components/reports/MonthlyBreakdown'
import MonthlyDynamics, { TrendRow } from '../components/reports/MonthlyDynamics'
import DebtAge, { DebtAgeRow } from '../components/reports/DebtAge'
import DataHealthPanel from '../components/reports/DataHealthPanel'
import DuplicatesPanel from '../components/reports/DuplicatesPanel'
import BlacklistSuggestions from '../components/reports/BlacklistSuggestions'
import {
  Page, PageHeader, Button, Menu, SegmentedControl, Tabs, StatRow, StatTile, Toggle, Tooltip, Card,
  ErrorState, Skeleton, MonthInput, f,
} from '../ui'

interface Overview {
  kpi: {
    activeEntities: number
    collectedForMonth: number
    collectedCash: number
    collectedForMonthPrev: number
    collectedCashPrev: number
    collectedDelta: number | null
    collectedCashDelta: number | null
    expectedMonthly: number
    applied: number
    remainingMonth: number
    advance: number
    totalDebt: number
    activeDebt: number
    blacklistedDebt: number
    blacklistedDebtors: number
    totalDebtors: number
    collectRateExact: number | null
    obliged?: number
    obligedCount: number
    paidCount: number
    partialCount: number
    payRate: number | null
  }
  pace: {
    day: number; daysInMonth: number; current: number; previous: number
    diff: number; deltaPercent: number | null; projected: number | null; ahead: boolean
  } | null
  monthlyTrend: TrendRow[]
  byDistrict: DistrictRow[]
  byInspector: InspectorRow[]
  inspectorSelf: InspectorSelf | null
  debtByAge: DebtAgeRow[]
  topDebtors: TopDebtorRow[]
  currentMonth: string
  prevMonth: string | null
  period: { from: string; to: string; months: number }
  definitions?: Record<string, string>
}

type PeriodKey = 'month' | 'q' | 'half' | 'year' | 'custom'
type TabKey = 'debtors' | 'regions' | 'monthly' | 'quality'

function ym(d: Date): string { return d.toISOString().slice(0, 7) }

function resolvePeriod(key: PeriodKey): { from: string; to: string } {
  const now = new Date(Date.now() + 5 * 3600e3) // UZT
  const to = ym(now)
  const back = (n: number) => { const d = new Date(now); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - n); return ym(d) }
  if (key === 'month') return { from: to, to }
  if (key === 'q') return { from: back(2), to }
  if (key === 'year') return { from: `${to.slice(0, 4)}-01`, to }
  return { from: back(5), to }
}

const DEF_LABELS: Record<string, string> = {
  collectedCash: 'Kassaga tushdi',
  collectedForMonth: 'Shu oyga tegishli',
  payRate: "To'liq yopgan",
  collectRate: "Yig'im foizi",
  totalDebt: 'Jami qarz',
}

async function saveBlob(res: { data: BlobPart }, name: string) {
  const url = URL.createObjectURL(new Blob([res.data]))
  const a = document.createElement('a')
  a.href = url; a.download = name; a.click()
  URL.revokeObjectURL(url)
}

export default function ReportsPage() {
  const navigate = useNavigate()
  const isAdmin = useEkoAuthStore(s => s.user?.role === 'admin')
  const openAkt = useCallback((e: { id: string; name: string }) => navigate(`/ekohisob/akt/${e.id}`), [navigate])

  const [periodKey, setPeriodKey] = useState<PeriodKey>('half')
  const [range, setRange] = useState(() => resolvePeriod('half'))
  const [includeBl, setIncludeBl] = useState(false)
  const [tab, setTab] = useState<TabKey>('debtors')
  const [busy, setBusy] = useState<string | null>(null)
  const [inspector, setInspector] = useState<{ id: string; name: string } | null>(null)

  const query = (() => {
    const p = new URLSearchParams()
    if (range.from) p.set('from', range.from)
    if (range.to) p.set('to', range.to)
    if (includeBl) p.set('includeBlacklisted', '1')
    return p.toString()
  })()

  const q = useQuery<Overview>({
    queryKey: [...ekoKeys.reports, 'overview', query],
    queryFn: async () => {
      const res = await ekoApi.get(`/reports/overview?${query}`)
      return res.data.data ?? res.data
    },
    staleTime: 60_000,
  })
  const data = q.data

  function selectPeriod(key: PeriodKey) {
    setPeriodKey(key)
    if (key !== 'custom') setRange(resolvePeriod(key))
  }

  async function run(kind: string, fn: () => Promise<void>) {
    setBusy(kind)
    try { await fn() } catch (e) { toast.error(errMsg(e)) } finally { setBusy(null) }
  }

  const exportExcel = () => run('xlsx', async () => {
    saveBlob(await ekoApi.get(`/reports/export.xlsx?${query}`, { responseType: 'blob' }), `ekohisob_hisobot_${range.from}_${range.to}.xlsx`)
  })
  const exportDebtors = (order: 'age' | 'debt') => run('debtors', async () => {
    saveBlob(
      await ekoApi.get(`/reports/export/debtors?order=${order}${includeBl ? '&includeBlacklisted=1' : ''}`, { responseType: 'blob' }),
      'qarzdorlar_reestri.xlsx',
    )
  })
  const openPrint = () => run('print', async () => {
    const res = await ekoApi.get(`/reports/print?${query}`, { responseType: 'text' })
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html;charset=utf-8' }))
    if (!window.open(url, '_blank')) toast.error("Brauzer yangi oynani bloklab qo'ydi — ruxsat bering")
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  })

  const k = data?.kpi
  const pace = data?.pace
  const subtitle = data
    ? (data.period.from === data.period.to
      ? f.monthLabel(data.period.to)
      : `${f.monthLabel(data.period.from)} — ${f.monthLabel(data.period.to)} (${data.period.months} oy)`)
    : undefined

  return (
    <Page>
      <PageHeader
        title="Hisobot"
        subtitle={subtitle}
        meta={{ updatedAt: q.dataUpdatedAt || null, onRefresh: () => q.refetch(), refreshing: q.isFetching }}
        actions={
          <>
            <Button size="sm" loading={busy === 'print'} icon={<Printer className="w-4 h-4" />} onClick={openPrint}>Chop etish</Button>
            <Button size="sm" loading={busy === 'xlsx'} icon={<FileSpreadsheet className="w-4 h-4" />} onClick={exportExcel}>Excel</Button>
            <Menu
              items={[
                { key: 'age', label: "Eng eski qarz birinchi", onSelect: () => exportDebtors('age') },
                { key: 'debt', label: 'Eng katta qarz birinchi', onSelect: () => exportDebtors('debt') },
              ]}
              trigger={(p) => (
                <Button {...p} size="sm" loading={busy === 'debtors'} icon={<Download className="w-4 h-4" />}>Qarzdorlar reestri</Button>
              )}
            />
          </>
        }
      />

      <div className="flex flex-wrap items-start gap-x-6 gap-y-3">
        <div>
          <SegmentedControl
            ariaLabel="Davr"
            value={periodKey}
            onChange={selectPeriod}
            options={[
              { value: 'month' as const, label: 'Joriy oy' },
              { value: 'q' as const, label: '3 oy' },
              { value: 'half' as const, label: '6 oy' },
              { value: 'year' as const, label: 'Joriy yil' },
              { value: 'custom' as const, label: "Qo'lda" },
            ]}
          />
        </div>
        {periodKey === 'custom' && (
          <div className="flex items-center gap-2">
            <MonthInput value={range.from} onChange={v => setRange(r => ({ ...r, from: v }))} />
            <span className="text-eko-muted" aria-hidden>–</span>
            <MonthInput value={range.to} onChange={v => setRange(r => ({ ...r, to: v }))} />
          </div>
        )}
        <div className="min-w-[240px]">
          <Toggle checked={includeBl} onChange={setIncludeBl} label="Qora ro'yxatni ham hisobga olish" />
        </div>
      </div>

      {q.isError && !data ? (
        <Card flush><ErrorState title={errMsg(q.error)} onRetry={() => q.refetch()} /></Card>
      ) : (
        <>
          <StatRow cols={4}>
            <StatTile
              lead loading={q.isLoading} label="Kassaga tushdi"
              value={f.num(k?.collectedCash ?? 0)} unit="so'm"
              delta={k?.collectedCashDelta} deltaLabel="o'tgan oyga nisbatan"
            />
            <StatTile
              loading={q.isLoading} label="Shu oyga tegishli"
              value={f.num(k?.collectedForMonth ?? 0)} unit="so'm"
              delta={k?.collectedDelta} deltaLabel="o'tgan oyga nisbatan"
            />
            <StatTile
              loading={q.isLoading} label="Jami qarz"
              value={f.num(k?.totalDebt ?? 0)} unit="so'm"
              hint={k && !includeBl && k.blacklistedDebt > 0 ? `qora ro'yxat: ${f.num(k.blacklistedDebt)}` : undefined}
            />
            <StatTile
              loading={q.isLoading} label="To'liq yopgan"
              value={k?.payRate == null ? '—' : `${k.payRate}%`}
              hint={k?.payRate == null ? "Bu oyda to'laydigan tashkilot yo'q" : `${f.num(k.paidCount)} / ${f.num(k.obligedCount)} tashkilot`}
            />
          </StatRow>

          {pace && (
            <p className="eko-text-base text-eko-text-2">
              {pace.day}-kunga qadar kassaga <b className="font-semibold eko-num text-eko-text">{f.num(pace.current)}</b> so'm tushdi
              {pace.deltaPercent == null
                ? " (o'tgan oy bilan solishtirib bo'lmaydi)"
                : <> — o'tgan oyning shu kuniga nisbatan <b className={`font-semibold eko-num ${pace.ahead ? 'text-eko-success' : 'text-eko-danger'}`}>
                    {pace.deltaPercent > 0 ? '+' : pace.deltaPercent < 0 ? '−' : ''}{Math.abs(Math.round(pace.deltaPercent))}%</b></>}
              {pace.projected != null && <>. Shu sur'atda oy oxirigacha taxminan <span className="eko-num">{f.num(pace.projected)}</span> so'm.</>}
            </p>
          )}

          {data?.definitions && (
            <p className="flex flex-wrap items-center gap-x-4 gap-y-1 eko-text-xs text-eko-muted">
              <span>Ta'riflar:</span>
              {Object.entries(data.definitions).filter(([key]) => DEF_LABELS[key]).map(([key, text]) => (
                <Tooltip key={key} content={text}>
                  <span className="inline-flex items-center gap-1 cursor-help">
                    {DEF_LABELS[key]} <Info className="w-3.5 h-3.5" aria-label="Izoh" />
                  </span>
                </Tooltip>
              ))}
            </p>
          )}

          {/* Yetakchi blok: oylik dinamika (2/3) + qarz yoshi (1/3) */}
          {q.isLoading ? (
            <Card><Skeleton className="h-72 w-full" /></Card>
          ) : data && (
            <div className="grid lg:grid-cols-3 gap-4">
              <MonthlyDynamics rows={data.monthlyTrend} className="lg:col-span-2" />
              <DebtAge rows={data.debtByAge} />
            </div>
          )}

          <Tabs
            ariaLabel="Hisobot bo'limlari"
            idPrefix="rep"
            value={tab}
            onChange={setTab}
            items={[
              { value: 'debtors', label: 'Qarzdorlar' },
              { value: 'regions', label: isAdmin || !data?.inspectorSelf ? 'Hudud va inspektorlar' : 'Hudud va natijam' },
              { value: 'monthly', label: 'Oyma-oy' },
              { value: 'quality', label: "Ma'lumot sifati" },
            ]}
          />

          <div role="tabpanel" aria-labelledby={`rep-${tab}`} className="space-y-4">
            {tab === 'debtors' && (
              <>
                {data && <TopDebtors rows={data.topDebtors} onOpenEntity={openAkt} />}
                <StoppedPaying onOpenEntity={openAkt} />
              </>
            )}
            {tab === 'regions' && data && (
              <div className="grid lg:grid-cols-2 gap-4 items-start">
                <DistrictBreakdown districts={data.byDistrict} query={query} monthLabel={f.monthLabel(data.currentMonth)} />
                <InspectorPerformance
                  rows={data.byInspector}
                  self={data.inspectorSelf}
                  periodMonths={data.period.months}
                  onOpen={setInspector}
                />
              </div>
            )}
            {tab === 'monthly' && <MonthlyBreakdown query={query} />}
            {tab === 'quality' && (
              <>
                <DataHealthPanel />
                <DuplicatesPanel />
                {isAdmin && <BlacklistSuggestions />}
              </>
            )}
          </div>
        </>
      )}

      {inspector && (
        <InspectorReportModal
          inspectorId={inspector.id}
          inspectorName={inspector.name}
          query={query}
          onClose={() => setInspector(null)}
        />
      )}
    </Page>
  )
}
