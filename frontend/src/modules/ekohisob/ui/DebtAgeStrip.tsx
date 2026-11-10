import { cx } from './cx'
import { monthLabel } from './format'

export type DebtMonthState = 'paid' | 'open' | 'partial' | 'none'

export interface DebtAgeMonth {
  /** "YYYY-MM" */
  month: string
  state: DebtMonthState
  /** To'lanmagan/qisman oy uchun daraja: 1 = 1 oy, 2 = 2 oy, 3 = 3+ oy */
  level?: 1 | 2 | 3
}

const STATE_TEXT: Record<DebtMonthState, string> = {
  paid: "to'langan",
  open: "to'lanmagan",
  partial: 'qisman to\'langan',
  none: "hisob yo'q",
}

function fill(m: DebtAgeMonth): string {
  if (m.state === 'paid') return 'bg-eko-surface-3'
  if (m.state === 'none') return 'bg-transparent border border-eko-line'
  const lv = m.level ?? 1
  return lv === 3 ? 'bg-eko-level-3' : lv === 2 ? 'bg-eko-level-2' : 'bg-eko-level-1'
}

/**
 * Qarz yoshi chizig'i: oxirgi 12 oy, har oy 8px katak. To'langan oylar neytral,
 * to'lanmagan — qarz darajasi rangida (MA'NO tashiydi). Qisman to'langan katak
 * yarim to'ldirilgan. Qator ichiga sig'adi; aria-label to'liq matn beradi.
 *
 * `months` eskidan yangiga tartiblangan bo'lishi kerak (oxirgi 12 tasi olinadi).
 */
export function DebtAgeStrip({ months, className }: { months: DebtAgeMonth[]; className?: string }) {
  const list = months.slice(-12)
  const unpaid = list.filter(m => m.state === 'open' || m.state === 'partial').length
  const label = unpaid === 0
    ? "Oxirgi 12 oy: qarz yo'q"
    : `Oxirgi 12 oy: ${unpaid} oy to'lanmagan`
  return (
    <span role="img" aria-label={label} className={cx('inline-flex items-center gap-[3px] align-middle', className)}>
      {list.map(m => (
        <span
          key={m.month}
          title={`${monthLabel(m.month)} — ${STATE_TEXT[m.state]}`}
          className={cx('relative block w-2 h-2 eko-rounded-sm overflow-hidden', fill(m))}
        >
          {m.state === 'partial' && (
            <span className="absolute inset-y-0 left-0 w-1/2 bg-eko-surface-3" aria-hidden />
          )}
        </span>
      ))}
    </span>
  )
}
