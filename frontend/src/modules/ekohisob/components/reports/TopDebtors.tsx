import { Card, CardHeader, DataTable, Button, f } from '../../ui'

export interface TopDebtorRow {
  id: string; name: string; district: string | null; mahalla: string | null
  debtMonths: number; debtAmount: number
}

/**
 * Eng katta qarzdorlar. Qarzning katta qismi odatda bir necha yirik tashkilotga to'g'ri
 * keladi. Nomga bosilsa akt sverka ochiladi.
 */
export default function TopDebtors({
  rows, onOpenEntity,
}: {
  rows: TopDebtorRow[]
  onOpenEntity: (entity: { id: string; name: string }) => void
}) {
  const total = rows.reduce((s, t) => s + t.debtAmount, 0)
  return (
    <Card flush>
      <CardHeader
        title="Eng katta qarzdorlar"
        hint={rows.length ? `${rows.length} ta tashkilot, jami ${f.money(total)}` : undefined}
      />
      <DataTable
        aria-label="Eng katta qarzdorlar"
        rows={rows}
        rowKey={(r) => r.id}
        empty={{ title: "Qarzdor yo'q", hint: 'Tanlangan hududda qarz topilmadi.' }}
        columns={[
          {
            key: 'name', title: 'Tashkilot',
            render: (r) => (
              <div className="min-w-0">
                <Button
                  variant="ghost" onClick={() => onOpenEntity({ id: r.id, name: r.name })}
                  className="!h-auto !min-h-0 !px-0 !py-0 justify-start text-left font-medium hover:!bg-transparent hover:underline"
                >
                  {r.name}
                </Button>
                <p className="eko-text-xs text-eko-muted">{[r.district, r.mahalla].filter(Boolean).join(' / ') || '—'}</p>
              </div>
            ),
          },
          { key: 'debtMonths', title: 'Oy', align: 'right', width: 80, render: (r) => r.debtMonths },
          { key: 'debtAmount', title: "Qarz, so'm", align: 'right', width: 160, render: (r) => f.num(r.debtAmount) },
        ]}
      />
    </Card>
  )
}
