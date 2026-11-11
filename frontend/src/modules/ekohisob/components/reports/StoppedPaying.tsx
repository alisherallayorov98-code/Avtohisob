import { useQuery } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, DataTable, Badge, Button, f } from '../../ui'

interface StoppedRow {
  entityId: string
  name: string
  phone: string | null
  district: string | null
  mahalla: string | null
  lastPaidMonth: string | null
  gapMonths: number
  paidBeforeGap: number
  avgPayment: number
  estimatedLoss: number
  currentDebt: number
}

interface StoppedData {
  evaluatedThrough?: string | null
  totalFound: number
  totalEstimatedLoss: number
  rows: StoppedRow[]
  topRecentlyStopped: StoppedRow[]
}

/**
 * To'lashni to'xtatgan mijozlar: oldin muntazam to'lagan, keyin to'xtagan.
 * Birinchi navbatda yaqinda to'xtaganlar (qaytarish eng oson), keyin umumiy ro'yxat.
 */
export default function StoppedPaying({
  onOpenEntity,
}: {
  onOpenEntity: (entity: { id: string; name: string }) => void
}) {
  const q = useQuery<StoppedData>({
    queryKey: [...ekoKeys.reports, 'stopped-paying'],
    queryFn: async () => (await ekoApi.get('/monitoring/stopped-paying')).data.data,
    staleTime: 60_000,
  })
  const d = q.data
  const recent = d?.topRecentlyStopped ?? []
  const recentIds = new Set(recent.map(r => r.entityId))
  const rest = (d?.rows ?? []).filter(r => !recentIds.has(r.entityId)).slice(0, 10)

  const columns = [
    {
      key: 'name', title: 'Mijoz',
      render: (r: StoppedRow) => (
        <div className="min-w-0">
          <Button
            variant="ghost" onClick={() => onOpenEntity({ id: r.entityId, name: r.name })}
            className="!h-auto !min-h-0 !px-0 !py-0 justify-start text-left font-medium hover:!bg-transparent hover:underline"
          >
            {r.name}
          </Button>
          <p className="eko-text-xs text-eko-muted">
            {[r.district, r.mahalla].filter(Boolean).join(' / ') || '—'}
            {r.lastPaidMonth && <> · oxirgi to'lov {f.monthLabel(r.lastPaidMonth)}</>}
          </p>
        </div>
      ),
    },
    {
      key: 'gap', title: "To'lamagan", mobile: 'secondary' as const,
      render: (r: StoppedRow) => <Badge tone={r.gapMonths >= 4 ? 'danger' : 'warn'}>{r.gapMonths} oy</Badge>,
    },
    { key: 'avg', title: "O'rtacha to'lov", align: 'right' as const, render: (r: StoppedRow) => f.num(r.avgPayment) },
    { key: 'loss', title: "Taxminiy yo'qotish", align: 'right' as const, render: (r: StoppedRow) => f.num(r.estimatedLoss) },
    { key: 'debt', title: 'Joriy qarz', align: 'right' as const, render: (r: StoppedRow) => f.num(r.currentDebt) },
  ]

  return (
    <div className="space-y-4">
      <Card flush>
        <CardHeader
          title="Yaqinda to'xtaganlar"
          hint={d ? `${f.num(d.totalFound)} ta mijoz · taxminan ${f.money(d.totalEstimatedLoss)} yo'qotilgan${d.evaluatedThrough ? ` · ${f.monthLabel(d.evaluatedThrough)} gacha` : ''}` : undefined}
        />
        <DataTable
          aria-label="Yaqinda to'xtaganlar"
          columns={columns}
          rows={recent}
          rowKey={(r) => r.entityId}
          loading={q.isLoading}
          error={q.isError ? errMsg(q.error) : null}
          onRetry={() => q.refetch()}
          empty={{ title: "Yaqinda to'xtagan mijoz yo'q", hint: "Muntazam to'lovchilar to'lashda davom etmoqda." }}
        />
      </Card>
      {rest.length > 0 && (
        <Card flush>
          <CardHeader title="Avvalroq to'xtaganlar" hint={`Eng katta yo'qotishli ${rest.length} tasi (jami ${f.num(d?.totalFound ?? 0)} ta)`} />
          <DataTable aria-label="Avvalroq to'xtaganlar" columns={columns} rows={rest} rowKey={(r) => r.entityId} />
        </Card>
      )}
    </div>
  )
}
