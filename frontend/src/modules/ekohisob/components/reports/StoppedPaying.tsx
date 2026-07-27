import { useState, useEffect } from 'react'
import { TrendingDown, Phone } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import { Card, CardHeader, CardBody, Badge, EmptyState, SkeletonList, cx, f } from '../../ui'

interface StoppedRow {
  entityId: string
  name: string
  phone: string | null
  district: string | null
  mahalla: string | null
  lastPaidMonth: string | null
  gapMonths: number
  paidBeforeGap: number
  regularity: number
  avgPayment: number
  estimatedLoss: number
  currentDebt: number
}

/**
 * To'lashni to'xtatgan mijozlar.
 *
 * Doimiy qarzdordan farqli: bu mijozlar oldin MUNTAZAM to'lagan, keyin
 * to'xtagan. Demak aniq sabab bor (biznes yopildi, xizmatdan norozi,
 * boshqa firmaga o'tdi) va uni qaytarish ancha oson. Oddiy qarzdorlar
 * ro'yxatida ular boshqalar orasida yo'qoladi.
 */
export default function StoppedPaying({
  onOpenEntity,
}: {
  onOpenEntity: (entity: { id: string; name: string }) => void
}) {
  const [rows, setRows] = useState<StoppedRow[] | null>(null)
  const [totalFound, setTotalFound] = useState(0)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    ekoApi.get('/monitoring/stopped-paying')
      .then(res => {
        setRows(res.data.data?.rows ?? [])
        setTotalFound(res.data.data?.totalFound ?? 0)
      })
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [])

  const totalLoss = (rows ?? []).reduce((s, r) => s + r.estimatedLoss, 0)

  return (
    <Card flush>
      <CardHeader
        title="To'lashni to'xtatganlar"
        hint={
          loading ? 'Tekshirilmoqda...'
            : totalFound > 0
              ? `${totalFound} ta mijoz · taxminan ${f.money(totalLoss)} yo'qotilgan`
              : "Oldin muntazam to'lagan, keyin to'xtagan mijozlar"
        }
        icon={<TrendingDown className="w-4 h-4" />}
      />
      {loading ? (
        <SkeletonList rows={3} />
      ) : !rows || rows.length === 0 ? (
        <CardBody>
          <EmptyState
            tone="success"
            title="To'lashni to'xtatgan mijoz yo'q"
            hint="Muntazam to'lovchilar to'lashda davom etmoqda."
          />
        </CardBody>
      ) : (
        <>
          <div className="divide-y divide-eko-line">
            {rows.slice(0, 10).map(r => (
              <div key={r.entityId} className="px-4 sm:px-5 py-3 hover:bg-eko-surface-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <button
                        onClick={() => onOpenEntity({ id: r.entityId, name: r.name })}
                        title="Akt sverkani ochish"
                        className="text-sm font-medium text-eko-text truncate text-left hover:text-eko-accent-text hover:underline underline-offset-2"
                      >
                        {r.name}
                      </button>
                      <Badge tone={r.gapMonths >= 4 ? 'danger' : 'warn'}>
                        {r.gapMonths} oy to'lamagan
                      </Badge>
                    </div>
                    <p className="text-xs text-eko-muted truncate mt-0.5">
                      {[r.district, r.mahalla].filter(Boolean).join(' / ') || '—'}
                      {r.lastPaidMonth && <> · oxirgi to'lov {f.monthLabel(r.lastPaidMonth)}</>}
                    </p>
                    <p className="text-[11px] text-eko-subtle mt-0.5">
                      Ilgari {r.paidBeforeGap} oy to'lagan · o'rtacha{' '}
                      <span className="eko-num">{f.money(r.avgPayment)}</span>
                      {r.phone && (
                        <span className="inline-flex items-center gap-1 ml-2">
                          <Phone className="w-3 h-3" /> {f.phone(r.phone)}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className={cx('text-sm font-semibold eko-num',
                      r.currentDebt > 0 ? 'text-eko-danger' : 'text-eko-muted')}>
                      {f.num(r.currentDebt)}
                    </p>
                    <p className="text-[11px] text-eko-subtle">joriy qarz</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          {totalFound > rows.slice(0, 10).length && (
            <p className="px-4 sm:px-5 py-2 text-[11px] text-eko-muted border-t border-eko-line">
              Eng katta yo'qotishli 10 tasi ko'rsatilmoqda (jami {totalFound} ta).
            </p>
          )}
        </>
      )}
    </Card>
  )
}
