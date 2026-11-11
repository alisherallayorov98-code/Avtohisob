import { cx } from '../../ui'

/**
 * Ball chizig'i, ikki holat: bonus chegarasigacha ogohlantirish (warn), undan keyin neutral.
 * `max` — sxemadagi chegara (standart 120): shkala 0..max. Vertikal chiziq — bonus chegarasi.
 */
export function ScoreBar({ score, minScore, max = 120 }: { score: number; minScore: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100)
  const below = score < minScore
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div
        className="relative flex-1 h-1.5 bg-eko-surface-2 rounded-full overflow-hidden"
        role="img"
        aria-label={`Ball ${score}, bonus chegarasi ${minScore}`}
      >
        <div className={cx('h-full rounded-full', below ? 'bg-eko-warn' : 'bg-eko-text-2')} style={{ width: `${pct}%` }} />
        <span className="absolute top-0 bottom-0 w-px bg-eko-text/40" style={{ left: `${(minScore / max) * 100}%` }} />
      </div>
      <span className="eko-text-sm font-semibold text-eko-text eko-num w-12 text-right">{score}</span>
    </div>
  )
}
