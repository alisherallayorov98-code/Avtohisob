import { ReactNode } from 'react'
import { cx } from './cx'

export type BadgeTone = 'neutral' | 'accent' | 'success' | 'warn' | 'danger' | 'info'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-eko-surface-2 text-eko-text-2 border-eko-line',
  accent: 'bg-eko-accent-soft text-eko-accent-text border-eko-accent-line',
  success: 'bg-eko-success-soft text-eko-success border-eko-success-line',
  warn: 'bg-eko-warn-soft text-eko-warn border-eko-warn-line',
  danger: 'bg-eko-danger-soft text-eko-danger border-eko-danger-line',
  info: 'bg-eko-info-soft text-eko-info border-eko-info-line',
}

export function Badge({
  tone = 'neutral', children, className, icon,
}: {
  tone?: BadgeTone
  children: ReactNode
  className?: string
  icon?: ReactNode
}) {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 px-2 py-0.5 rounded-eko border',
        'text-[11px] font-medium leading-5 whitespace-nowrap',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}

// ── Qarz darajasi ────────────────────────────────────────────────────────────
// Bu ranglar bezak emas, MA'NO tashiydi: yashil → qizil qarzning o'sishini
// bildiradi. Shuning uchun alohida komponent — har sahifada qo'lda yozilmasin.

export type DebtLevel = 'current' | 'warning' | 'overdue' | 'critical' | 'blacklisted'

const DEBT_LEVELS: Record<DebtLevel, { dot: string; label: string; tone: BadgeTone }> = {
  current:     { dot: 'bg-eko-level-0', label: 'Joriy',          tone: 'success' },
  warning:     { dot: 'bg-eko-level-1', label: '1 oy',           tone: 'warn' },
  overdue:     { dot: 'bg-eko-level-2', label: '2 oy',           tone: 'warn' },
  critical:    { dot: 'bg-eko-level-3', label: '3+ oy',          tone: 'danger' },
  blacklisted: { dot: 'bg-eko-level-x', label: "Qora ro'yxat",   tone: 'neutral' },
}

/** Qarz darajasi belgisi — nuqta + matn. */
export function DebtBadge({ level, className }: { level?: string | null; className?: string }) {
  const cfg = DEBT_LEVELS[(level ?? 'current') as DebtLevel] ?? DEBT_LEVELS.current
  return (
    <Badge tone={cfg.tone} className={className} icon={<span className={cx('w-1.5 h-1.5 rounded-full', cfg.dot)} />}>
      {cfg.label}
    </Badge>
  )
}

/** Qarz darajasi nuqtasi — joy tor bo'lganda (jadval ustuni, xarita ro'yxati). */
export function DebtDot({ level, className }: { level?: string | null; className?: string }) {
  const cfg = DEBT_LEVELS[(level ?? 'current') as DebtLevel] ?? DEBT_LEVELS.current
  return (
    <span
      title={cfg.label}
      aria-label={cfg.label}
      className={cx('inline-block w-2 h-2 rounded-full shrink-0', cfg.dot, className)}
    />
  )
}

// ── To'lov rejimi ────────────────────────────────────────────────────────────

const BILLING_LABELS: Record<string, { label: string; tone: BadgeTone }> = {
  monthly_fixed: { label: 'Oylik',       tone: 'neutral' },
  variable:      { label: "O'zgaruvchan", tone: 'neutral' },
  talon:         { label: 'Talon',       tone: 'info' },
}

/**
 * To'lov rejimi belgisi. `talon` ajratib ko'rsatiladi, chunki uning hisob-kitobi
 * boshqacha (kub × narx) — foydalanuvchi buni darrov ko'rishi kerak.
 */
export function BillingBadge({ mode, className }: { mode?: string | null; className?: string }) {
  const cfg = BILLING_LABELS[mode ?? 'variable']
  if (!cfg || mode === 'variable') return null   // odatiy rejim — belgi shovqin qiladi
  return <Badge tone={cfg.tone} className={className}>{cfg.label}</Badge>
}
