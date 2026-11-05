/**
 * Ball chizig'i: minimal chegaragacha qizil/sariq, undan keyin yashil.
 * `max` — sxemadagi chegara (standart 120): shkala 0..max.
 */
export function ScoreBar({ score, minScore, max = 120 }: { score: number; minScore: number; max?: number }) {
  const pct = Math.min(100, (score / max) * 100)
  const color = score >= 100 ? 'bg-eko-success' : score >= minScore ? 'bg-eko-accent' : 'bg-eko-warn'
  return (
    <div className="flex items-center gap-2 min-w-[110px]">
      <div className="relative flex-1 h-2 bg-eko-surface-3 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${pct}%` }} />
        {/* Bonus chegarasi */}
        <span className="absolute top-0 bottom-0 w-px bg-eko-text/40" style={{ left: `${(minScore / max) * 100}%` }} />
      </div>
      <span className="text-sm font-semibold text-eko-text tabular-nums w-12 text-right">{score}</span>
    </div>
  )
}
