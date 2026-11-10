import { ReactNode, createContext, useContext, Children } from 'react'
import { cx } from './cx'

export type StatTone = 'neutral' | 'accent' | 'warn' | 'danger'

const VALUE_TONE: Record<StatTone, string> = {
  neutral: 'text-eko-text',
  accent: 'text-eko-accent-text',
  warn: 'text-eko-warn',
  danger: 'text-eko-danger',
}

const InRow = createContext(false)

export interface StatTileProps {
  label: string
  value: ReactNode
  /** Qiymatdan keyingi kulrang qo'shimcha: "so'm", "ta" */
  unit?: string
  /**
   * O'tgan davrga nisbatan o'zgarish foizi. Musbat = o'sish.
   * `undefined` — ko'rsatilmaydi; `null` yoki ~0 — kulrang tire "—".
   */
  delta?: number | null
  /** O'sish yaxshimi? Yig'im uchun ha (default), qarz uchun yo'q. */
  deltaGoodWhenUp?: boolean
  /** Taqqoslash oynasi: "o'tgan oyga nisbatan" */
  deltaLabel?: string
  hint?: string
  tone?: StatTone
  /** @deprecated Ikonka KPI'da ko'rsatilmaydi (achromatic-ledger). Propni olib tashlang. */
  icon?: ReactNode
  /** Bosilsa — filtr sifatida ishlaydi */
  onClick?: () => void
  active?: boolean
  loading?: boolean
  /** Asosiy KPI: 32px qiymat */
  lead?: boolean
  className?: string
}

/**
 * KPI = tipografiya. Yorliq (13px, kulrang, sentence-case) ustida, qiymat
 * (26px; `lead` 32px) ostida. Soya, ikonka-doira, sparkline, uppercase YO'Q.
 * `StatRow` ichida konteynersiz (ajratish — 1px chiziq); yakka holda 1px chegarali.
 */
export function StatTile({
  label, value, unit, delta, deltaGoodWhenUp = true, deltaLabel, hint,
  tone = 'neutral', onClick, active, loading, lead, className,
}: StatTileProps) {
  const inRow = useContext(InRow)
  const Tag = onClick ? 'button' : 'div'
  const shell = cx(
    'p-4 text-left w-full min-w-0',
    !inRow && 'bg-eko-surface border rounded-eko-lg',
    !inRow && (active ? 'border-eko-accent' : 'border-eko-line'),
    inRow && active && 'bg-eko-surface-2',
    onClick && 'transition-colors cursor-pointer min-h-[44px] ' + (inRow ? 'hover:bg-eko-surface-2' : 'hover:border-eko-line-strong'),
    className,
  )

  if (loading) {
    return (
      <div className={shell}>
        <div className="eko-shimmer h-3.5 w-20 rounded" />
        <div className="eko-shimmer h-7 w-28 rounded mt-2.5" />
      </div>
    )
  }

  const flat = delta == null || Math.abs(delta) < 0.5

  return (
    <Tag onClick={onClick} aria-pressed={onClick && active !== undefined ? active : undefined} className={shell}>
      <p className="eko-text-sm text-eko-muted truncate">{label}</p>
      <div className="flex items-baseline gap-1.5 mt-1">
        <span className={cx(lead ? 'eko-text-lead' : 'eko-text-stat', 'font-semibold eko-num', VALUE_TONE[tone])}>
          {value}
        </span>
        {unit && <span className="eko-text-sm text-eko-muted">{unit}</span>}
      </div>
      {(delta !== undefined || hint) && (
        <p className="eko-text-xs mt-1.5 flex items-center gap-1.5 flex-wrap">
          {delta !== undefined && (
            <span
              className={cx(
                'font-medium eko-num',
                flat ? 'text-eko-muted' : (delta! > 0) === deltaGoodWhenUp ? 'text-eko-success' : 'text-eko-danger',
              )}
            >
              {flat ? '—' : `${delta! > 0 ? '+' : '−'}${Math.abs(Math.round(delta!))}%`}
              {deltaLabel && !flat && <span className="font-normal text-eko-muted"> {deltaLabel}</span>}
            </span>
          )}
          {hint && <span className="text-eko-muted">{hint}</span>}
        </p>
      )}
    </Tag>
  )
}

/**
 * KPI qatori — BITTA konteyner, 1px bo'luvchi. Ustun soni elementlar soniga
 * moslanadi (`cols` bilan o'zgartirish mumkin); mobilda 2-up. Tavsiya: 2–5 ta.
 */
export function StatRow({ children, cols, className }: { children: ReactNode; cols?: 2 | 3 | 4 | 5 | 6; className?: string }) {
  const n = cols ?? Math.min(6, Math.max(1, Children.toArray(children).length))
  return (
    <InRow.Provider value>
      <div className={cx('eko-statrow', className)} style={{ ['--eko-cols' as string]: n }}>
        {children}
      </div>
    </InRow.Provider>
  )
}
