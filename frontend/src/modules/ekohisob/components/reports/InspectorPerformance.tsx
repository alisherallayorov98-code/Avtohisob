import { Card, CardHeader, EmptyState, Button, cx, f } from '../../ui'

export interface InspectorRow { id?: string; name: string; collected: number; collectedCash?: number; payments: number }
export interface InspectorSelf {
  collected: number; payments: number; teamAverage: number; inspectorCount: number
}

/**
 * Inspektor samaradorligi. OCHIQ SHAXSIY REYTING YO'Q: inspektor faqat o'z natijasini va
 * jamoa o'rtachasini ko'radi; to'liq ro'yxat admin/boshliq uchun va alifbo tartibida emas,
 * yig'im bo'yicha — faqat boshqaruv uchun. Yupqa kulrang chiziq, eng yuqorisi (ink) ajratiladi.
 */
export default function InspectorPerformance({
  rows, self, periodMonths, onOpen,
}: {
  rows: InspectorRow[]
  self: InspectorSelf | null
  periodMonths: number
  onOpen?: (inspector: { id: string; name: string }) => void
}) {
  const value = (r: InspectorRow) => r.collectedCash ?? r.collected
  const max = Math.max(1, ...rows.map(value))
  const top = rows.length ? rows.reduce((a, b) => (value(b) > value(a) ? b : a)) : null

  return (
    <Card flush>
      <CardHeader title="Inspektorlar" hint={`Kassaga tushgan pul, ${periodMonths} oy`} />
      <div className="px-4 sm:px-5 py-4">
        {self ? (
          <div className="space-y-4">
            <Bar label="Sizning natijangiz" amount={self.collected} pct={Math.min(100, Math.round(self.collected * 100 / Math.max(1, self.teamAverage * 2)))} ink
              hint={`${f.num(self.payments)} ta to'lov qabul qilgansiz`} />
            <Bar label={`Jamoa o'rtachasi (${self.inspectorCount} inspektor)`} amount={self.teamAverage} pct={50} />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState compact title="Ma'lumot yo'q" hint="Bu davrda to'lov qabul qilinmagan." />
        ) : (
          <ul className="space-y-4">
            {rows.map(r => (
              <li key={r.id ?? r.name}>
                <Bar
                  label={r.id && onOpen
                    ? <Button variant="ghost" onClick={() => onOpen({ id: r.id!, name: r.name })}
                        className="!h-auto !min-h-0 !px-0 !py-0 font-medium hover:!bg-transparent hover:underline">{r.name}</Button>
                    : r.name}
                  amount={value(r)}
                  pct={Math.round(value(r) * 100 / max)}
                  ink={top === r}
                  hint={r.payments > 0 ? `${f.num(r.payments)} ta to'lov` : "Bu davrda to'lov qabul qilmagan"}
                />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  )
}

function Bar({ label, amount, pct, ink, hint }: { label: React.ReactNode; amount: number; pct: number; ink?: boolean; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-2 eko-text-sm">
        <span className="text-eko-text min-w-0 truncate">{label}</span>
        <span className="eko-num font-semibold text-eko-text shrink-0">{f.num(amount)} <span className="font-normal text-eko-muted">so'm</span></span>
      </div>
      <div className="h-1 mt-1.5 rounded-full bg-eko-surface-2 overflow-hidden">
        <div className={cx('h-full rounded-full', ink ? 'bg-eko-text' : 'bg-eko-surface-3')} style={{ width: `${pct}%` }} />
      </div>
      {hint && <p className="eko-text-xs text-eko-muted mt-1">{hint}</p>}
    </div>
  )
}
