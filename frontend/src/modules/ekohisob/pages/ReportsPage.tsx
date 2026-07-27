import { useEffect, useState, useCallback } from 'react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts'
import {
  Building2, TrendingUp, Wallet, Target, Download, Trophy, Coins, MapPin,
} from 'lucide-react'
import ekoApi from '../lib/ekoApi'
import {
  Page, PageHeader, Card, CardHeader, CardBody, Button, Badge,
  StatRow, StatTile, EmptyState, ErrorState, Skeleton, cx, f,
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
    name: string; total: number; obliged: number; paid: number; unpaid: number
    collected: number; debt: number; payRate: number | null
  }[]
  byInspector: { name: string; collected: number; payments: number }[]
  inspectorSelf: { collected: number; payments: number; teamAverage: number; inspectorCount: number } | null
  debtByAge: { bucket: string; label: string; count: number; amount: number }[]
  currentMonth: string
  prevMonth: string | null
}

// Qarz yoshi ranglari — tizimdagi qarz darajasi shkalasi bilan bir xil.
// Bu ranglar bezak emas: yashil→qizil qarzning eskirishini bildiradi.
const AGE_COLOR: Record<string, string> = {
  month1: '#facc15',
  month2: '#f97316',
  month3plus: '#dc2626',
}

export default function ReportsPage() {
  const [data, setData] = useState<Overview | null>(null)
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(() => {
    setLoading(true)
    setFailed(false)
    ekoApi.get('/reports/overview')
      .then(res => setData(res.data.data ?? res.data))
      .catch(() => { setData(null); setFailed(true) })
      .finally(() => setLoading(false))
  }, [])

  useEffect(load, [load])

  function exportExcel() {
    if (!data) return
    const rows: string[][] = [['HISOBOT', data.currentMonth]]
    rows.push([], ["Oylik yig'im dinamikasi"], ['Oy', "Yig'ilgan"])
    data.monthlyTrend.forEach(m => rows.push([m.label, String(m.collected)]))
    rows.push([], ['Qarz yoshi bo\'yicha'], ['Muddat', 'Tashkilot', 'Summa'])
    data.debtByAge.forEach(d => rows.push([d.label, String(d.count), String(d.amount)]))
    rows.push([], ["Tuman bo'yicha"], ['Tuman', 'Jami', "To'lashi kerak", "To'lagan", 'Qarzdor', "Yig'ilgan", 'Qarz', 'Foiz%'])
    data.byDistrict.forEach(d => rows.push([
      d.name, String(d.total), String(d.obliged), String(d.paid), String(d.unpaid),
      String(d.collected), String(d.debt), d.payRate == null ? '—' : String(d.payRate),
    ]))
    if (data.byInspector.length > 0) {
      rows.push([], ['Inspektor samaradorligi'], ['Inspektor', "Yig'ilgan (6 oy)", "To'lovlar soni"])
      data.byInspector.forEach(i => rows.push([i.name, String(i.collected), String(i.payments)]))
    }
    const csv = rows.map(r => r.join('\t')).join('\n')
    const blob = new Blob(['﻿' + csv], { type: 'text/tab-separated-values;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url; a.download = `ekohisob-hisobot-${data.currentMonth}.xls`; a.click()
    URL.revokeObjectURL(url)
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
  const maxDistrictCollected = Math.max(1, ...data.byDistrict.map(d => d.collected))
  const maxInspector = Math.max(1, ...data.byInspector.map(i => i.collected))
  const totalAgeAmount = data.debtByAge.reduce((s, d) => s + d.amount, 0)

  return (
    <Page>
      <PageHeader
        title="Hisobot va analitika"
        subtitle={`Oxirgi 6 oy · joriy oy ${f.monthLabel(data.currentMonth)}`}
        actions={
          <Button variant="secondary" size="sm" icon={<Download className="w-4 h-4" />} onClick={exportExcel}>
            Excel
          </Button>
        }
      />

      {/* KPI — qarz endi ko'rinadi (ilgari backend hisoblardi, UI ko'rsatmasdi) */}
      <StatRow>
        <StatTile
          label="Bu oy yig'ilgan"
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
          hint={`6 oyda ${f.moneyShort(k.totalCollected6m)} so'm`}
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
        {/* Tuman bo'yicha */}
        <Card flush>
          <CardHeader title="Tuman bo'yicha" hint="Joriy oy" icon={<MapPin className="w-4 h-4" />} />
          <CardBody>
            {data.byDistrict.length === 0 ? (
              <EmptyState title="Ma'lumot yo'q" hint="Tumanlar hali qo'shilmagan." />
            ) : (
              <div className="space-y-3.5">
                {data.byDistrict.map(d => (
                  <div key={d.name}>
                    <div className="flex items-center justify-between text-sm mb-1 gap-2">
                      <span className="font-medium text-eko-text truncate">{d.name}</span>
                      <span className="text-eko-muted shrink-0 eko-num">
                        {f.moneyShort(d.collected)}
                        {d.payRate != null && (
                          <span className={cx('ml-2 font-semibold',
                            d.payRate >= 80 ? 'text-eko-success' : d.payRate >= 50 ? 'text-eko-warn' : 'text-eko-danger')}>
                            {d.payRate}%
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="w-full bg-eko-surface-2 rounded-full h-2">
                      <div className="bg-eko-accent h-2 rounded-full"
                           style={{ width: `${Math.round(d.collected * 100 / maxDistrictCollected)}%` }} />
                    </div>
                    <p className="text-[11px] text-eko-muted mt-1">
                      {d.paid}/{d.obliged} to'lagan
                      {d.debt > 0 && <> · qarz <b className="text-eko-danger eko-num">{f.moneyShort(d.debt)}</b></>}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        {/* Inspektor samaradorligi */}
        <Card flush>
          <CardHeader title="Inspektor samaradorligi" hint="Oxirgi 6 oy" icon={<Trophy className="w-4 h-4" />} />
          <CardBody>
            {/* Inspektorga ochiq shaxsiy reyting ko'rsatilmaydi — xodimlar
                o'rtasida ziddiyat keltiradi. U faqat o'zini va o'rtachani ko'radi. */}
            {data.inspectorSelf ? (
              <div className="space-y-3">
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="font-medium text-eko-text">Sizning natijangiz</span>
                    <span className="font-semibold text-eko-text eko-num">{f.money(data.inspectorSelf.collected)}</span>
                  </div>
                  <div className="w-full bg-eko-surface-2 rounded-full h-2">
                    <div className="bg-eko-accent h-2 rounded-full"
                         style={{ width: `${Math.min(100, Math.round(
                           data.inspectorSelf.collected * 100 / Math.max(1, data.inspectorSelf.teamAverage * 2)))}%` }} />
                  </div>
                  <p className="text-[11px] text-eko-muted mt-1">
                    {data.inspectorSelf.payments} ta to'lov qabul qilgansiz
                  </p>
                </div>
                <div>
                  <div className="flex items-center justify-between text-sm mb-1">
                    <span className="text-eko-muted">
                      Jamoa o'rtachasi ({data.inspectorSelf.inspectorCount} inspektor)
                    </span>
                    <span className="text-eko-muted eko-num">{f.money(data.inspectorSelf.teamAverage)}</span>
                  </div>
                  <div className="w-full bg-eko-surface-2 rounded-full h-2">
                    <div className="bg-eko-surface-3 h-2 rounded-full" style={{ width: '50%' }} />
                  </div>
                </div>
              </div>
            ) : data.byInspector.length === 0 ? (
              <EmptyState title="Ma'lumot yo'q" hint="Bu davrda to'lov qabul qilinmagan." />
            ) : (
              <div className="space-y-3.5">
                {data.byInspector.map(i => (
                  <div key={i.name}>
                    <div className="flex items-center justify-between text-sm mb-1 gap-2">
                      <span className="font-medium text-eko-text truncate">{i.name}</span>
                      <span className="text-eko-muted shrink-0 eko-num">{f.moneyShort(i.collected)}</span>
                    </div>
                    <div className="w-full bg-eko-surface-2 rounded-full h-2">
                      <div className="bg-eko-accent h-2 rounded-full"
                           style={{ width: `${Math.round(i.collected * 100 / maxInspector)}%` }} />
                    </div>
                    <p className="text-[11px] text-eko-muted mt-1">{i.payments} ta to'lov qabul qilgan</p>
                  </div>
                ))}
              </div>
            )}
          </CardBody>
        </Card>
      </div>
    </Page>
  )
}
