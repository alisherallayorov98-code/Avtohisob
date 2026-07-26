import { ReactNode } from 'react'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'
import { cx } from './cx'

export type StatTone = 'neutral' | 'accent' | 'warn' | 'danger'

const VALUE_TONE: Record<StatTone, string> = {
  neutral: 'text-eko-text',
  accent: 'text-eko-accent-text',
  warn: 'text-eko-warn',
  danger: 'text-eko-danger',
}

export interface StatTileProps {
  label: string
  value: ReactNode
  /** Qiymatdan keyingi kichik birlik: "so'm", "ta" */
  unit?: string
  /** O'tgan davrga nisbatan o'zgarish foizi. Musbat = o'sish. */
  delta?: number | null
  /** O'sish yaxshimi? Yig'im uchun ha, qarz uchun yo'q. */
  deltaGoodWhenUp?: boolean
  hint?: string
  tone?: StatTone
  icon?: ReactNode
  /** Bosilsa — filtr sifatida ishlaydi */
  onClick?: () => void
  active?: boolean
  loading?: boolean
}

/**
 * KPI plitkasi.
 *
 * Dizayn qarori: raqam eng katta element, yorliq ustida KICHIK va sokin turadi.
 * Ilgari yorliq va qiymat deyarli bir xil o'lchamda edi — ko'z qayerga
 * qarashni bilmasdi.
 */
export function StatTile({
  label, value, unit, delta, deltaGoodWhenUp = true, hint,
  tone = 'neutral', icon, onClick, active, loading,
}: StatTileProps) {
  const Tag = onClick ? 'button' : 'div'

  if (loading) {
    return (
      <div className="bg-eko-surface border border-eko-line rounded-eko-lg shadow-eko p-4">
        <div className="eko-shimmer h-3 w-20 rounded" />
        <div className="eko-shimmer h-7 w-28 rounded mt-2.5" />
      </div>
    )
  }

  return (
    <Tag
      onClick={onClick}
      className={cx(
        'bg-eko-surface border rounded-eko-lg shadow-eko p-4 text-left w-full',
        'transition-colors duration-150',
        active ? 'border-eko-accent ring-1 ring-eko-accent' : 'border-eko-line',
        onClick && 'hover:border-eko-line-strong cursor-pointer',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-eko-muted uppercase tracking-wide truncate">{label}</p>
        {icon && <span className="text-eko-subtle shrink-0">{icon}</span>}
      </div>

      <div className="flex items-baseline gap-1.5 mt-1.5">
        <span className={cx('text-[26px] leading-8 font-semibold eko-num tracking-tight', VALUE_TONE[tone])}>
          {value}
        </span>
        {unit && <span className="text-xs text-eko-muted font-medium">{unit}</span>}
      </div>

      {(delta != null || hint) && (
        <div className="flex items-center gap-1.5 mt-1.5">
          {delta != null && <DeltaChip delta={delta} goodWhenUp={deltaGoodWhenUp} />}
          {hint && <span className="text-xs text-eko-muted truncate">{hint}</span>}
        </div>
      )}
    </Tag>
  )
}

/** Trend belgisi. Rang "yaxshi/yomon"ni bildiradi, strelka yo'nalishni. */
function DeltaChip({ delta, goodWhenUp }: { delta: number; goodWhenUp: boolean }) {
  const flat = Math.abs(delta) < 0.5
  const up = delta > 0
  const good = flat ? null : up === goodWhenUp
  const Icon = flat ? Minus : up ? TrendingUp : TrendingDown
  return (
    <span
      className={cx(
        'inline-flex items-center gap-0.5 text-xs font-medium',
        good === null ? 'text-eko-muted' : good ? 'text-eko-success' : 'text-eko-danger',
      )}
    >
      <Icon className="w-3.5 h-3.5" />
      {flat ? '—' : `${Math.abs(Math.round(delta))}%`}
    </span>
  )
}

/** KPI plitkalar qatori — mobilda 2 ustun, kengroq ekranda 4 gacha. */
export function StatRow({ children, cols = 4 }: { children: ReactNode; cols?: 2 | 3 | 4 }) {
  return (
    <div
      className={cx(
        'grid gap-3',
        cols === 2 ? 'grid-cols-2'
          : cols === 3 ? 'grid-cols-2 lg:grid-cols-3'
          : 'grid-cols-2 lg:grid-cols-4',
      )}
    >
      {children}
    </div>
  )
}
