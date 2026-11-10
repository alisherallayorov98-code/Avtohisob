import { InputHTMLAttributes, forwardRef } from 'react'
import { cx } from './cx'
import { Input } from './Field'

/** "2026-11-10" → "10.11.2026" (qo'lda, vaqt zonasi siljishisiz). Noto'g'ri qiymat → ''. */
export function isoToDisplay(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso ?? '')
  return m ? `${m[3]}.${m[2]}.${m[1]}` : ''
}

export interface DateInputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'onChange'> {
  /** ISO 'YYYY-MM-DD' ('' = bo'sh) */
  value: string
  onChange: (iso: string) => void
  /** Yoniga o'qiladigan DD.MM.YYYY chiqarish (default: ha) */
  showFormatted?: boolean
  invalid?: boolean
}

/**
 * Sana kiritish. Ichida native `input[type=date]` (kalendar, klaviatura,
 * mobil tanlagich bepul). Brauzer tili AA/DD ko'rsatsa ham foydalanuvchi
 * yoniga chiqqan DD.MM.YYYY ni ko'radi. Qiymat har doim ISO.
 */
export const DateInput = forwardRef<HTMLInputElement, DateInputProps>(function DateInput(
  { value, onChange, showFormatted = true, className, invalid, ...rest }, ref,
) {
  const shown = isoToDisplay(value)
  return (
    <div className="flex items-center gap-2">
      <Input
        ref={ref}
        type="date"
        value={value}
        invalid={invalid}
        onChange={(e) => onChange(e.target.value)}
        className={cx('flex-1 min-w-[140px]', className)}
        {...rest}
      />
      {showFormatted && shown && (
        <span className="eko-text-sm text-eko-muted eko-num whitespace-nowrap" aria-hidden>{shown}</span>
      )}
    </div>
  )
})

export interface DateRangeProps {
  from: string
  to: string
  onChange: (range: { from: string; to: string }) => void
  fromLabel?: string
  toLabel?: string
  disabled?: boolean
  className?: string
}

/**
 * Sana oralig'i: ikki DateInput (to >= from cheklovi bilan) va ostida
 * "10.11.2026 – 20.11.2026" ko'rinishi.
 */
export function DateRange({
  from, to, onChange, fromLabel = 'Boshlanish sanasi', toLabel = 'Tugash sanasi', disabled, className,
}: DateRangeProps) {
  const text = from || to ? `${isoToDisplay(from) || '…'} – ${isoToDisplay(to) || '…'}` : ''
  return (
    <div className={className}>
      <div className="flex flex-wrap items-center gap-2">
        <DateInput
          aria-label={fromLabel}
          value={from}
          max={to || undefined}
          disabled={disabled}
          showFormatted={false}
          onChange={(v) => onChange({ from: v, to })}
        />
        <span className="text-eko-muted" aria-hidden>–</span>
        <DateInput
          aria-label={toLabel}
          value={to}
          min={from || undefined}
          disabled={disabled}
          showFormatted={false}
          onChange={(v) => onChange({ from, to: v })}
        />
      </div>
      {text && <p className="eko-text-xs text-eko-muted eko-num mt-1.5">{text}</p>}
    </div>
  )
}
