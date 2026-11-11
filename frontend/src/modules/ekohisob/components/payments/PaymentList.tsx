import { Undo2 } from 'lucide-react'
import { Badge, Button, MoneyText, f } from '../../ui'

export interface PaymentListItem {
  id: string
  month: string
  amount: number
  paidAt: string
  receiverName?: string | null
  receiptNumber?: string | null
  method?: string | null
  /** Kvitansiya bekor qilingan (storno) */
  voided?: boolean
}

const METHOD_LABEL: Record<string, string> = {
  cash: 'Naqd', card: 'Karta', transfer: "O'tkazma", online: 'Onlayn',
}

/**
 * To'lovlar ro'yxati (kartochka va to'lovlar tasmasi uchun umumiy).
 * "Bekor qilish" faqat `onCancel` berilganda (admin) ko'rinadi.
 */
export default function PaymentList({
  items, onCancel, busyId,
}: {
  items: PaymentListItem[]
  onCancel?: (p: PaymentListItem) => void
  busyId?: string | null
}) {
  return (
    <ul className="divide-y divide-eko-line border border-eko-line rounded-eko-lg">
      {items.map(p => (
        <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2.5">
          <div className="min-w-0">
            <p className="eko-text-base font-medium text-eko-text flex items-center gap-2 flex-wrap">
              <MoneyText value={p.amount} />
              {p.voided && <Badge tone="inactive">Bekor qilingan</Badge>}
            </p>
            <p className="eko-text-xs text-eko-muted truncate">
              {f.monthLabel(p.month)} · {f.date(p.paidAt)}
              {p.method ? ` · ${METHOD_LABEL[p.method] ?? p.method}` : ''}
              {p.receiverName ? ` · ${p.receiverName}` : ''}
            </p>
            {p.receiptNumber && (
              <p className="eko-text-xs text-eko-muted font-mono">{p.receiptNumber}</p>
            )}
          </div>
          {onCancel && !p.voided && (
            <Button
              variant="ghost"
              icon={<Undo2 className="w-4 h-4" aria-hidden />}
              loading={busyId === p.id}
              onClick={() => onCancel(p)}
            >
              Bekor qilish
            </Button>
          )}
        </li>
      ))}
    </ul>
  )
}
