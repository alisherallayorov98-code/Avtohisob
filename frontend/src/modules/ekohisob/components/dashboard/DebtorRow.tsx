import { MoreHorizontal, Scale, Building2 } from 'lucide-react'
import { Button, IconButton, Menu, BillingBadge, DebtDot, Badge, cx, f } from '../../ui'

export interface DashEntity {
  id: string
  name: string
  address: string
  monthlyFee: number
  cubicPrice?: number
  billingMode?: 'monthly_fixed' | 'variable' | 'talon'
  unpaidMonths: string[]
  debtAmount: number
  billedDebt?: number
  unbilledDebt?: number
  mahallName?: string
}

export interface PromiseInfo { promisedDate: string; daysOverdue: number }

export type Urgency = 'critical' | 'overdue' | 'warning'

export function urgencyOf(e: Pick<DashEntity, 'unpaidMonths'>): Urgency {
  const n = e.unpaidMonths?.length ?? 0
  if (n >= 3) return 'critical'
  if (n === 2) return 'overdue'
  return 'warning'
}

/**
 * Qarzdor qatori. Butun qator yuzasi to'lov varag'ini ochadi; nom tashkilot
 * kartochkasini, "⋯" menyusi akt sverkani ochadi (ichki tugmalar qatorga o'tmaydi).
 */
export default function DebtorRow({
  entity, level, showMahalla, readOnly, promise, onPay, onPreview, onAkt,
}: {
  entity: DashEntity
  level: string
  showMahalla?: boolean
  readOnly?: boolean
  promise?: PromiseInfo
  onPay: () => void
  onPreview: () => void
  onAkt: () => void
}) {
  const months = entity.unpaidMonths?.length ?? 0
  const meta = [
    entity.address,
    showMahalla ? entity.mahallName : null,
    months > 0 ? `${months} oy` : null,
  ].filter(Boolean).join(' · ')

  const fee = entity.billingMode === 'talon'
    ? `${f.num(entity.cubicPrice ?? 0)}/kub`
    : entity.billingMode === 'variable'
      ? "o'zgaruvchan"
      : `${f.num(entity.monthlyFee)}/oy`

  return (
    <div
      className={cx(
        'flex items-center gap-3 px-4 sm:px-5 py-2.5 min-h-[56px] border-b border-eko-line last:border-b-0 hover:bg-eko-surface-2',
        !readOnly && 'cursor-pointer',
      )}
      onClick={readOnly ? undefined : onPay}
    >
      <DebtDot level={level} className="shrink-0" />

      <div className="min-w-0 flex-1" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            variant="ghost"
            onClick={onPreview}
            className="!h-auto !min-h-0 !px-0 !py-0 justify-start text-left font-medium hover:!bg-transparent hover:underline underline-offset-2 max-w-full"
          >
            <span className="truncate">{entity.name}</span>
          </Button>
          <BillingBadge mode={entity.billingMode} />
          {promise && (
            <Badge tone={promise.daysOverdue > 0 ? 'danger' : 'warn'}>
              {promise.daysOverdue > 0
                ? `Va'da buzildi · ${f.date(promise.promisedDate)}`
                : "Va'da bugun"}
            </Badge>
          )}
        </div>
        <p className="eko-text-xs text-eko-muted truncate mt-0.5">{meta}</p>
      </div>

      <div className="text-right shrink-0">
        <p className="eko-text-base font-semibold text-eko-text eko-num leading-tight">{f.num(entity.debtAmount)}</p>
        <p className="eko-text-xs text-eko-muted eko-num">{fee}</p>
      </div>

      <div className="flex items-center gap-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        {!readOnly && <Button variant="ghost" size="sm" onClick={onPay}>To'lov</Button>}
        <Menu
          items={[
            { key: 'card', label: 'Kartochka', icon: <Building2 className="w-4 h-4" />, onSelect: onPreview },
            { key: 'akt', label: 'Akt sverka', icon: <Scale className="w-4 h-4" />, onSelect: onAkt },
          ]}
          trigger={(p) => (
            <IconButton {...p} variant="ghost" size="sm" label="Boshqa amallar" icon={<MoreHorizontal className="w-4 h-4" />} />
          )}
        />
      </div>
    </div>
  )
}
