import { AlertTriangle } from 'lucide-react'
import { Card, CardHeader, f } from '../../ui'

export interface TopDebtorRow {
  id: string; name: string; district: string | null; mahalla: string | null
  debtMonths: number; debtAmount: number
}

/**
 * Eng katta qarzdorlar.
 *
 * So what: qarzning katta qismi odatda bir necha yirik tashkilotga to'g'ri
 * keladi — ular bilan alohida ishlash yuzta kichik qarzdorni ta'qib qilishdan
 * samaraliroq. Nomga bosilsa akt sverka ochiladi (muzokara uchun tayyor hujjat).
 */
export default function TopDebtors({
  rows, onOpenEntity,
}: {
  rows: TopDebtorRow[]
  onOpenEntity: (entity: { id: string; name: string }) => void
}) {
  if (rows.length === 0) return null
  const total = rows.reduce((s, t) => s + t.debtAmount, 0)

  return (
    <Card flush>
      <CardHeader
        title="Eng katta qarzdorlar"
        hint={`${rows.length} ta tashkilot — jami ${f.money(total)}`}
        icon={<AlertTriangle className="w-4 h-4" />}
      />
      <div className="divide-y divide-eko-line">
        {rows.map((t, i) => (
          <div key={t.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 hover:bg-eko-surface-2">
            <span className="w-5 text-xs text-eko-subtle eko-num shrink-0">{i + 1}</span>
            <div className="min-w-0 flex-1">
              <button
                onClick={() => onOpenEntity({ id: t.id, name: t.name })}
                title="Akt sverkani ochish"
                className="text-sm font-medium text-eko-text truncate text-left hover:text-eko-accent-text hover:underline underline-offset-2 block max-w-full"
              >
                {t.name}
              </button>
              <p className="text-xs text-eko-muted truncate">
                {[t.district, t.mahalla].filter(Boolean).join(' / ') || '—'} · {t.debtMonths} oy
              </p>
            </div>
            <span className="text-sm font-semibold text-eko-danger eko-num shrink-0">
              {f.num(t.debtAmount)}
            </span>
          </div>
        ))}
      </div>
    </Card>
  )
}
