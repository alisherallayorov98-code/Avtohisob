import { ReactNode } from 'react'
import { cx } from './cx'
import { num } from './format'

/**
 * Raqam: tabular-nums, null → "—" (kulrang), 0 → "0".
 * Jadval kataklari va matn ichida ishlating.
 */
export function Num({ value, className }: { value: number | null | undefined; className?: string }) {
  if (value == null || !Number.isFinite(Number(value))) {
    return <span className={cx('text-eko-muted', className)}>—</span>
  }
  return <span className={cx('eko-num', className)}>{num(value)}</span>
}

/**
 * Pul: "1 200 000" + kulrang "so'm" suffiksi. `compact` suffiksni yashiradi
 * (ustun sarlavhasida "so'm" bo'lganda). Manfiy → "−" va danger emas (rangni
 * sahifa o'zi `className` bilan beradi — qarz/avans ma'nosi kontekstga bog'liq).
 */
export function MoneyText({
  value, compact, className, suffix = "so'm",
}: {
  value: number | null | undefined
  compact?: boolean
  className?: string
  suffix?: ReactNode
}) {
  if (value == null || !Number.isFinite(Number(value))) {
    return <span className={cx('text-eko-muted', className)}>—</span>
  }
  const n = Number(value)
  return (
    <span className={cx('eko-num whitespace-nowrap', className)}>
      {n < 0 ? '−' : ''}{num(Math.abs(n))}
      {!compact && <span className="text-eko-muted font-normal"> {suffix}</span>}
    </span>
  )
}
