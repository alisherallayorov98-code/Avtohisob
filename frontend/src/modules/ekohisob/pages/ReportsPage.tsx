import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import {
  Building2, TrendingUp, Wallet, Target, Download, Coins, Printer,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../lib/ekoApi'
import DistrictBreakdown from '../components/reports/DistrictBreakdown'
import InspectorPerformance from '../components/reports/InspectorPerformance'
import TopDebtors from '../components/reports/TopDebtors'
import InspectorReportModal from '../components/reports/InspectorReportModal'
import StoppedPaying from '../components/reports/StoppedPaying'
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, Badge, SegmentedControl,
  StatRow, StatTile, EmptyState, ErrorState, Skeleton, f,
} from '../ui'

interface Overview {
  kpi: {
    activeEntities: number
    collectedThisMonth: number
    collectedPrevMonth: number
    /** O'tgan oyga nisbatan o'zgarish foizi. null — solishtirib bo'lmaydi. */
    collectedDelta: number | null
    expectedMonthly: number
    expectedFixed: number
    expectedTalon: number
    totalDebt: number
    collectRate: number
    /** Shu oyda to'lash majburiyati bo'lgan tashkilotlar */
    obligedCount: number
    paidCount: number
    /** To'lagan / majburiyati bo'lgan. null — majburiyatli tashkilot yo'q. */
    payRate: number | null
    totalCollected6m: number
  }
  monthlyTrend: { month: string; label: string; collected: number }[]
  byDistrict: {
    id: string; name: string; total: number; obliged: number; paid: number; unpaid: number
    collected: number; debt: number; payRate: number | null
  }[]
  byInspector: { id?: string; name: string; collected: number; payments: number }[]
  inspectorSelf: { collected: number; payments: number; teamAverage: number; inspectorCount: number } | null
  debtByAge: { bucket: string; label: string; count: number; amount: number }[]
  topDebtors: {
    id: string; name: string; district: string | null; mahalla: string | null
    debtMonths: number; debtAmount: number
  }[]
  currentMonth: string
  prevMonth: string | null
  period: { from: string; to: string; months: number }
}

type PeriodKey = 'month' | 'q' | 'half' | 'year' | 'custom'

function ym(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

/** Tez davr tanlovlari → {from, to} ("YYYY-MM"). */
function resolvePeriod(key: PeriodKey): { from: string; to: string } {
  const now = new Date()
  const to = ym(now)
  if (key === 'month') return { from: to, to }
  if (key === 'q') { const d = new Date(now); d.setMonth(d.getMonth() - 2); return { from: ym(d), to } }
  if (key === 'year') return { from: `${now.getFullYear()}-01`, to }
  // half — standart 6 oy
  const d = new Date(now); d.setMonth(d.getMonth() - 5)
  return { from: ym(d), to }
}

// Qarz yoshi ranglari — tizimdagi qarz darajasi shkalasi bilan bir xil.
// Bu ranglar bezak emas: yashil→qizil qarzning eskirishini bildiradi.
const AGE_COLOR: Record<string, string> = {
  month1: '#facc15',
  month2: '#f97316',
  month3plus: '#dc2626',
}

export default function ReportsPage() {
  const navigate = useNavigate()
  // Tashkilot nomiga bosilganda akt sverka sahifasi ochiladi
  const openAkt = useCallback(
    (e: { id: string; name: string }) => navigate(`/ekohisob/akt/${e.id}`),
    [navigate],
  )
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [periodKey, setPeriodKey] = useState<PeriodKey>('half')
  const [range, setRange] = useState(() => resolvePeriod('half'))
  const [busy, setBusy] = useState<'xlsx' | 'print' | null>(null)
  // Inspektor qatoriga bosilganda uning batafsil hisoboti ochiladi
  const [inspector, setInspector] = useState<{ id: string; name: string } | null>(null)
  const query = useCallback(() => {
    const p = new URLSearchParams()
    if (range.from) p.set('from', range.from)
    if (range.to) p.set('to', range.to)
    return p.toString()
  }, [range])

  const load = useCallback(() => {
    setLoading(true)
    setFailed(false)
    ekoApi.get(`/reports/overview?${query()}`)
      .then(res => setData(res.data.data ?? res.data))
      .catch(() => { setData(null); setFailed(true) })
      .finally(() => setLoading(false))
  }, [query])

  useEffect(load, [load])

  function selectPeriod(key: PeriodKey) {
    setPeriodKey(key)
    if (key !== 'custom') setRange(resolvePeriod(key))
  }

  /** Excel — endi backend `exceljs` bilan haqiqiy .xlsx yasaydi */
  async function exportExcel() {
    setBusy('xlsx')
    try {
      const res = await ekoApi.get(`/reports/export.xlsx?${query()}`, { responseType: 'blob' })
      const url = URL.createObjectURL(new Blob([res.data]))
      const a = document.createElement('a')
      a.href = url
      a.download = `ekohisob_hisobot_${range.from}_${range.to}.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Excel yuklab olishda xato')
    } finally { setBusy(null) }
  }

  /** Chop etish sahifasi autentifikatsiya talab qiladi — blob orqali ochamiz */
  async function openPrint() {
    setBusy('print')
    try {
      const res = await ekoApi.get(`/reports/print?${query()}`, { responseType: 'text' })
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
        <Skeleton className="h-8 w-48" />
        <StatRow>
          {[0, 1, 2, 3].map(i => <StatTile key={i} loading label="" value="" />)}
        </StatRow>
        <Card><Skeleton className="h-64 w-full" /></Card>
      </Page>
    )
  }
  if (failed || !data) {
    return <Page><Card flush><ErrorState onRetry={load} /></Card></Page>
  }

  const k = data.kpi
  const totalAgeAmount = data.debtByAge.reduce((s, d) => s + d.amount, 0)

  return (
    <Page>
      <PageHeader
        title="Hisobot va analitika"
        subtitle={
          data.period.from === data.period.to
            ? f.monthLabel(data.period.to)
            : `${f.monthLabel(data.period.from)} — ${f.monthLabel(data.period.to)} (${data.period.months} oy)`
        }
        actions={
          <>
            <Button
              variant="secondary" size="sm" loading={busy === 'print'}
              icon={<Printer className="w-4 h-4" />} onClick={openPrint}
            >
              Chop etish
            </Button>
            <Button
              variant="secondary" size="sm" loading={busy === 'xlsx'}
              icon={<Download className="w-4 h-4" />} onClick={exportExcel}
            >
              Excel
            </Button>
          </>
        }
      />

      {/* Davr tanlash. "Oylik" ko'rsatkichlar davrning OXIRGI oyiga tegishli —
          standart davrda bu joriy oy, ya'ni odatiy holatda hech narsa o'zgarmaydi. */}
      <div className="flex flex-wrap items-center gap-2">
        <SegmentedControl
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
        {periodKey === 'custom' && (
          <div className="flex items-center gap-1.5">
            <input
              type="month" value={range.from}
              onChange={e => setRange(r => ({ ...r, from: e.target.value }))}
              className="h-8 px-2 rounded-eko border border-eko-line bg-eko-surface text-[13px] text-eko-text"
            />
            <span className="text-eko-subtle text-xs">—</span>
            <input
              type="month" value={range.to}
              onChange={e => setRange(r => ({ ...r, to: e.target.value }))}
              className="h-8 px-2 rounded-eko border border-eko-line bg-eko-surface text-[13px] text-eko-text"
            />
          </div>
        )}
      </div>

      {/* KPI — qarz endi ko'rinadi (ilgari backend hisoblardi, UI ko'rsatmasdi) */}
      <StatRow>
        <StatTile
          label={`${f.monthLabel(data.currentMonth)} yig'ilgan`}
          value={f.moneyShort(k.collectedThisMonth)}
          unit="so'm"
          tone="accent"
          icon={<Wallet className="w-4 h-4" />}
          delta={k.collectedDelta}
          deltaGoodWhenUp
          hint={data.prevMonth ? `${f.monthLabel(data.prevMonth)}: ${f.moneyShort(k.collectedPrevMonth)}` : undefined}
        />
        <StatTile
          label="Jami qarz"
          value={f.moneyShort(k.totalDebt)}
          unit="so'm"
          tone="danger"
          icon={<Coins className="w-4 h-4" />}
          hint={f.num(k.totalDebt)}
        />
        <StatTile
          label="To'lov foizi"
          value={k.payRate == null ? '—' : `${k.payRate}%`}
          tone={k.payRate == null ? 'neutral' : k.payRate >= 80 ? 'accent' : k.payRate >= 50 ? 'warn' : 'danger'}
          icon={<Target className="w-4 h-4" />}
          hint={k.payRate == null
            ? 'Bu oyda to\'laydigan tashkilot yo\'q'
            : `${f.num(k.paidCount)} / ${f.num(k.obligedCount)} tashkilot`}
        />
        <StatTile
          label="Faol tashkilotlar"
          value={f.num(k.activeEntities)}
          unit="ta"
          icon={<Building2 className="w-4 h-4" />}
          hint={`Davrda ${f.moneyShort(k.totalCollected6m)} so'm yig'ilgan`}
        />
      </StatRow>

      {/* Kutilgan summa tarkibi — daromad qaysi rejimdan kelayotgani */}
      {k.expectedMonthly > 0 && (
        <Card>
          <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
            <h2 className="text-[15px] font-semibold text-eko-text">Bu oy kutilgan summa</h2>
            <span className="text-sm font-semibold text-eko-text eko-num">{f.money(k.expectedMonthly)}</span>
          </div>
          <div className="flex h-2 rounded-full overflow-hidden bg-eko-surface-2">
            <div className="bg-eko-accent" style={{ width: `${Math.round(k.expectedFixed * 100 / k.expectedMonthly)}%` }} />
            <div className="bg-eko-info" style={{ width: `${Math.round(k.expectedTalon * 100 / k.expectedMonthly)}%` }} />
          </div>
          <div className="flex flex-wrap gap-x-5 gap-y-1 mt-2 text-xs text-eko-muted">
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-eko-accent" />
              Belgilangan oylik: <b className="text-eko-text-2 eko-num">{f.money(k.expectedFixed)}</b>
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-eko-info" />
              Talon (bajarilgan ish): <b className="text-eko-text-2 eko-num">{f.money(k.expectedTalon)}</b>
            </span>
          </div>
        </Card>
      )}

      {/* Qarz yoshi — "142 mln" raqamini harakatga aylantiradigan bo'lim */}
      <Card flush>
        <CardHeader
          title="Qarz muddati bo'yicha"
          hint="Eski qarz qaytarilishi qiyinroq — birinchi navbat shunga"
          icon={<Coins className="w-4 h-4" />}
        />
        <CardBody>
          {totalAgeAmount === 0 ? (
            <EmptyState tone="success" title="Qarzdor tashkilot yo'q" hint="Barcha hisob-kitob yopilgan." />
          ) : (
            <div className="space-y-3">
              {data.debtByAge.map(d => (
                <div key={d.bucket}>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full" style={{ background: AGE_COLOR[d.bucket] }} />
                      <span className="font-medium text-eko-text">{d.label}</span>
                      <Badge tone="neutral">{d.count} ta</Badge>
                    </span>
                    <span className="font-semibold text-eko-text eko-num">{f.money(d.amount)}</span>
                  </div>
                  <div className="w-full bg-eko-surface-2 rounded-full h-2">
                    <div
                      className="h-2 rounded-full"
                      style={{
                        width: `${Math.round(d.amount * 100 / totalAgeAmount)}%`,
                        background: AGE_COLOR[d.bucket],
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardBody>
      </Card>

      <TopDebtors rows={data.topDebtors} onOpenEntity={openAkt} />

      <StoppedPaying onOpenEntity={openAkt} />

      {/* Oylik dinamika */}
      <Card flush>
        <CardHeader title="Oylik yig'im dinamikasi" icon={<TrendingUp className="w-4 h-4" />} />
        <CardBody>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={data.monthlyTrend} margin={{ top: 4, right: 4, left: -12, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 12, fill: '#64748b' }} axisLine={false} tickLine={false} />
              <YAxis
                tick={{ fontSize: 11, fill: '#94a3b8' }}
                axisLine={false} tickLine={false}
                tickFormatter={(v) => v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(0)}k` : String(v)}
              />
              <Tooltip
                cursor={{ fill: '#f1f5f9' }}
                formatter={(v: any) => [f.money(Number(v)), "Yig'ilgan"]}
                contentStyle={{ borderRadius: 8, border: '1px solid #e2e8f0', fontSize: 13 }}
              />
              <Bar dataKey="collected" radius={[6, 6, 0, 0]}>
                {/* Joriy oy ajratib ko'rsatiladi — u hali tugamagan, to'liq emas */}
                {data.monthlyTrend.map(m => (
                  <Cell key={m.month} fill={m.month === data.currentMonth ? '#86efac' : '#16a34a'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <p className="text-[11px] text-eko-muted mt-1">
            Och rang — joriy oy, hali tugamagan.
          </p>
        </CardBody>
      </Card>

      <div className="grid lg:grid-cols-2 gap-4">
        <DistrictBreakdown
          districts={data.byDistrict}
          query={query()}
          monthLabel={f.monthLabel(data.currentMonth)}
        />
        <InspectorPerformance
          rows={data.byInspector}
          self={data.inspectorSelf}
          periodMonths={data.period.months}
          onOpen={setInspector}
        />
      </div>

      {inspector && (
        <InspectorReportModal
          inspectorId={inspector.id}
          inspectorName={inspector.name}
          query={query()}
          onClose={() => setInspector(null)}
        />
      )}

    </Page>
  )
}
