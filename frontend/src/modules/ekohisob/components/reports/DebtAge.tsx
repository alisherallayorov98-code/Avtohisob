import { Card, CardHeader, EmptyState, f } from '../../ui'

export interface DebtAgeRow { bucket: string; label: string; count: number; amount: number }

// Qarz darajasi tokenlari (ma'no tashiydi: yosh qarz -> eski qarz)
const LEVEL_BG: Record<string, string> = {
  month1: 'bg-eko-level-1',
  month2: 'bg-eko-level-2',
  month3plus: 'bg-eko-level-3',
}

/** Qarz yoshi: har kategoriya uchun summa, soni va ulushi. */
export default function DebtAge({ rows, className }: { rows: DebtAgeRow[]; className?: string }) {
  const total = rows.reduce((s, d) => s + d.amount, 0)
  return (
    <Card flush className={className}>
      <CardHeader title="Qarz yoshi" hint="Eski qarzni qaytarish qiyinroq — birinchi navbat shunga" />
      <div className="px-4 sm:px-5 py-4">
        {total === 0 ? (
          <EmptyState tone="success" compact title="Qarz yo'q" hint="Hisob-kitoblar yopilgan." />
        ) : (
          <ul className="space-y-4">
            {rows.map(d => {
              const pct = Math.round(d.amount * 100 / total)
              return (
                <li key={d.bucket}>
                  <div className="flex items-baseline justify-between gap-2 eko-text-sm">
                    <span className="text-eko-text font-medium">{d.label}</span>
                    <span className="eko-num font-semibold text-eko-text">{f.num(d.amount)} <span className="font-normal text-eko-muted">so'm</span></span>
                  </div>
                  <div className="h-2 mt-1.5 rounded-full bg-eko-surface-2 overflow-hidden" role="img" aria-label={`${d.label}: ${pct}%`}>
                    <div className={`h-full rounded-full ${LEVEL_BG[d.bucket] ?? 'bg-eko-surface-3'}`} style={{ width: `${pct}%` }} />
                  </div>
                  <p className="eko-text-xs text-eko-muted mt-1 eko-num">{f.num(d.count)} ta tashkilot · {pct}%</p>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
