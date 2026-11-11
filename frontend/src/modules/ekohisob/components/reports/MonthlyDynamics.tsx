import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Legend } from 'recharts'
import { Card, CardHeader, EmptyState, chart, f } from '../../ui'

export interface TrendRow {
  month: string
  label: string
  collectedForMonth?: number
  collectedCash?: number
  collected?: number
  expected?: number
  applied?: number
}

const axisTick = { fontSize: 12, fill: chart.axis }
const fmtAxis = (v: number) => v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)} mln` : v >= 1e3 ? `${Math.round(v / 1e3)} ming` : String(v)

/**
 * Oylik dinamika — hisobotning yetakchi bloki. Ikki qator aniq nomlangan:
 * "Kassaga tushdi" (to'lov sanasi bo'yicha) va "Shu oyga tegishli" (to'lov qaysi oyga yozilgan).
 */
export default function MonthlyDynamics({ rows, className }: { rows: TrendRow[]; className?: string }) {
  const data = rows.map(r => ({
    label: r.label || f.monthShort(r.month),
    month: r.month,
    cash: r.collectedCash ?? r.collected ?? 0,
    forMonth: r.collectedForMonth ?? r.collected ?? 0,
  }))
  return (
    <Card flush className={className}>
      <CardHeader
        title="Oylik dinamika"
        hint="Kassaga tushgan pul va shu oyga tegishli to'lovlar"
      />
      <div className="px-4 sm:px-5 py-4">
        {data.length === 0 ? (
          <EmptyState title="Ma'lumot yo'q" hint="Tanlangan davrda to'lov yo'q." />
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }} barGap={2}>
              <CartesianGrid stroke={chart.grid} vertical={false} />
              <XAxis dataKey="label" tick={axisTick} axisLine={false} tickLine={false} />
              <YAxis tick={axisTick} axisLine={false} tickLine={false} tickCount={5} tickFormatter={fmtAxis} width={64} />
              <Tooltip
                cursor={{ fill: 'rgb(var(--eko-surface-2))' }}
                formatter={(v: any, name: any) => [`${f.num(Number(v))} so'm`, name]}
                labelFormatter={(_l: any, p: any) => f.monthLabel(p?.[0]?.payload?.month)}
                contentStyle={{
                  background: 'rgb(var(--eko-surface))', border: '1px solid rgb(var(--eko-line))',
                  borderRadius: 8, fontSize: 13, color: 'rgb(var(--eko-text))',
                }}
              />
              <Legend iconType="square" wrapperStyle={{ fontSize: 13, color: chart.axis }} />
              <Bar dataKey="cash" name="Kassaga tushdi" fill={chart.main} radius={[4, 4, 0, 0]} />
              <Bar dataKey="forMonth" name="Shu oyga tegishli" fill={chart.light} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>
    </Card>
  )
}
