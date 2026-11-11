import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, DataTable, Modal, f } from '../../ui'
import type { Column } from '../../ui'

export interface DistrictRow {
  id: string; name: string; total: number; obliged: number; paid: number
  partial?: number; unpaid: number; collected: number; collectedCash?: number; collectedForMonth?: number
  expected?: number; applied?: number; advance?: number; debtors?: number; blacklistedDebt?: number
  debt: number; payRate: number | null; collectRate?: number | null
}

interface MahallaData { district: string; month: string; mahallas: DistrictRow[] }

const pct = (v: number | null | undefined) => (v == null ? '—' : `${v}%`)

function columns(): Column<DistrictRow>[] {
  return [
    { key: 'name', title: 'Nomi', render: (r) => <span className="font-medium">{r.name}</span> },
    { key: 'cash', title: 'Kassaga tushdi', align: 'right', render: (r) => f.num(r.collectedCash ?? r.collected) },
    { key: 'rate', title: "Yig'im", align: 'right', render: (r) => pct(r.collectRate ?? r.payRate) },
    {
      key: 'paid', title: "To'liq yopgan", align: 'right',
      render: (r) => `${f.num(r.paid)} / ${f.num(r.obliged)}`,
    },
    { key: 'debt', title: 'Qarz', align: 'right', render: (r) => (r.debt > 0 ? f.num(r.debt) : null) },
  ]
}

/** Tuman kesimi; qatorga bosilsa mahallalar kesimi (talab bo'yicha yuklanadi). */
export default function DistrictBreakdown({
  districts, query, monthLabel,
}: {
  districts: DistrictRow[]
  query: string
  monthLabel: string
}) {
  const [open, setOpen] = useState<DistrictRow | null>(null)
  const mq = useQuery<MahallaData>({
    queryKey: [...ekoKeys.reports, 'mahallas', open?.id, query],
    queryFn: async () => (await ekoApi.get(`/reports/district/${open!.id}/mahallas?${query}`)).data.data,
    enabled: !!open,
    staleTime: 60_000,
  })

  return (
    <>
      <Card flush>
        <CardHeader title="Tuman bo'yicha" hint={`${monthLabel} · qatorni bossangiz mahallalar ochiladi`} />
        <DataTable
          aria-label="Tuman bo'yicha"
          columns={columns()}
          rows={districts}
          rowKey={(r) => r.id}
          onRowClick={setOpen}
          empty={{ title: "Ma'lumot yo'q", hint: "Tumanlar hali qo'shilmagan." }}
        />
      </Card>
      {open && (
        <Modal open onClose={() => setOpen(null)} size="lg" title={open.name} hint={`Mahallalar · ${monthLabel}`}>
          <DataTable
            aria-label="Mahallalar"
            columns={columns()}
            rows={mq.data?.mahallas ?? []}
            rowKey={(r) => r.id}
            loading={mq.isLoading}
            error={mq.isError ? errMsg(mq.error) : null}
            onRetry={() => mq.refetch()}
            empty={{ title: "Mahalla ma'lumoti yo'q" }}
          />
        </Modal>
      )}
    </>
  )
}
