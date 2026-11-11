import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, DataTable, f } from '../../ui'

export interface MonthlyRow {
  month: string
  expected: number
  expectedTalon: number
  collected: number
  collectedCash?: number
  applied?: number
  advance?: number
  debt: number
  collectRate: number | null
  settleRate?: number | null
  obliged?: number
  settled?: number
  payments: number
  payers: number
}

interface MonthlyData {
  rows: MonthlyRow[]
  totals: {
    expected: number; collected: number; collectedCash?: number; applied?: number
    debt: number; payments: number; collectRate: number | null
  }
}

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)

/**
 * Oyma-oy hisobot: har oy uchun kutilgan, yopilgan, kassaga tushgan va qolgan qarz.
 * Buxgalteriya va rahbar yig'ilishi aynan shu jadvalni so'raydi.
 */
export default function MonthlyBreakdown({ query }: { query: string }) {
  const q = useQuery<MonthlyData>({
    queryKey: [...ekoKeys.reports, 'monthly', query],
    queryFn: async () => {
      const res = await ekoApi.get(`/reports/monthly?${query}`)
      return res.data.data ?? res.data
    },
    staleTime: 60_000,
  })
  const d = q.data

  return (
    <Card flush>
      <CardHeader title="Oyma-oy hisobot" hint="Har oy uchun kutilgan, yopilgan va qolgan qarz" />
      <DataTable
        aria-label="Oyma-oy hisobot"
        rows={d?.rows ?? []}
        rowKey={(r) => r.month}
        loading={q.isLoading}
        error={q.isError ? errMsg(q.error) : null}
        onRetry={() => q.refetch()}
        empty={{ title: "Davr bo'sh", hint: "Tanlangan davrda ma'lumot yo'q." }}
        columns={[
          {
            key: 'month', title: 'Oy',
            render: (r) => (
              <>
                {f.monthLabel(r.month)}
                {r.expectedTalon > 0 && <span className="block eko-text-xs text-eko-muted">talon: {f.num(r.expectedTalon)}</span>}
              </>
            ),
          },
          { key: 'expected', title: 'Kutilgan', align: 'right', render: (r) => f.num(r.expected) },
          { key: 'applied', title: 'Yopilgan', align: 'right', render: (r) => f.num(r.applied ?? r.collected) },
          { key: 'cash', title: 'Kassaga tushdi', align: 'right', render: (r) => f.num(r.collectedCash ?? r.collected) },
          { key: 'rate', title: "Yig'im", align: 'right', render: (r) => pct(r.collectRate) },
          { key: 'debt', title: 'Qarz', align: 'right', render: (r) => (r.debt > 0 ? f.num(r.debt) : null) },
          {
            key: 'settled', title: "To'liq yopgan", align: 'right', mobile: 'secondary',
            render: (r) => (r.obliged != null ? `${f.num(r.settled ?? 0)} / ${f.num(r.obliged)}` : f.num(r.payers)),
          },
        ]}
        footer={d ? {
          month: 'Jami',
          expected: f.num(d.totals.expected),
          applied: f.num(d.totals.applied ?? d.totals.collected),
          cash: f.num(d.totals.collectedCash ?? d.totals.collected),
          rate: pct(d.totals.collectRate),
          debt: f.num(d.totals.debt),
        } : undefined}
      />
      <p className="px-4 sm:px-5 py-3 border-t border-eko-line eko-text-xs text-eko-muted">
        «Qarz» — o'sha oy hisoblaridan bugungacha yopilmagan qism. «Yopilgan» — shu oy majburiyatiga to'lov bilan qoplangan summa;
        «Kassaga tushdi» — to'lov sanasi shu oyda bo'lgan pul (u boshqa oyga yozilgan bo'lishi mumkin).
      </p>
    </Card>
  )
}
