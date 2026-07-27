import { Trophy, ChevronRight } from 'lucide-react'
import { Card, CardHeader, CardBody, EmptyState, f } from '../../ui'

export interface InspectorRow { id?: string; name: string; collected: number; payments: number }
export interface InspectorSelf {
  collected: number; payments: number; teamAverage: number; inspectorCount: number
}

/**
 * Inspektor samaradorligi.
 *
 * MUHIM: inspektorga OCHIQ SHAXSIY REYTING ko'rsatilmaydi — xodimlar o'rtasida
 * ziddiyat keltiradi (loyihaning qat'iy qoidasi). Inspektor faqat o'z natijasini
 * va jamoa o'rtachasini ko'radi; to'liq ro'yxat admin/boshliq uchun.
 */
export default function InspectorPerformance({
  rows, self, periodMonths, onOpen,
}: {
  rows: InspectorRow[]
  self: InspectorSelf | null
  periodMonths: number
  /** Qatorga bosilganda shu inspektorning batafsil hisoboti ochiladi */
  onOpen?: (inspector: { id: string; name: string }) => void
}) {
  const max = Math.max(1, ...rows.map(i => i.collected))

  return (
    <Card flush>
      <CardHeader
        title="Inspektor samaradorligi"
        hint={`Davr: ${periodMonths} oy`}
        icon={<Trophy className="w-4 h-4" />}
      />
      <CardBody>
        {self ? (
          <div className="space-y-3">
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="font-medium text-eko-text">Sizning natijangiz</span>
                <span className="font-semibold text-eko-text eko-num">{f.money(self.collected)}</span>
              </div>
              <div className="w-full bg-eko-surface-2 rounded-full h-2">
                <div
                  className="bg-eko-accent h-2 rounded-full"
                  style={{ width: `${Math.min(100, Math.round(
                    self.collected * 100 / Math.max(1, self.teamAverage * 2)))}%` }}
                />
              </div>
              <p className="text-[11px] text-eko-muted mt-1">
                {self.payments} ta to'lov qabul qilgansiz
              </p>
            </div>
            <div>
              <div className="flex items-center justify-between text-sm mb-1">
                <span className="text-eko-muted">
                  Jamoa o'rtachasi ({self.inspectorCount} inspektor)
                </span>
                <span className="text-eko-muted eko-num">{f.money(self.teamAverage)}</span>
              </div>
              <div className="w-full bg-eko-surface-2 rounded-full h-2">
                <div className="bg-eko-surface-3 h-2 rounded-full" style={{ width: '50%' }} />
              </div>
            </div>
          </div>
        ) : rows.length === 0 ? (
          <EmptyState title="Ma'lumot yo'q" hint="Bu davrda to'lov qabul qilinmagan." />
        ) : (
          <div className="space-y-3.5">
            {rows.map(i => {
              const clickable = !!(onOpen && i.id)
              const Tag = clickable ? 'button' : 'div'
              return (
                <Tag
                  key={i.id ?? i.name}
                  onClick={clickable ? () => onOpen!({ id: i.id!, name: i.name }) : undefined}
                  className={clickable ? 'w-full text-left group' : undefined}
                  title={clickable ? 'Batafsil hisobotni ochish' : undefined}
                >
                  <div className="flex items-center justify-between text-sm mb-1 gap-2">
                    <span className={`font-medium truncate flex items-center gap-1 ${
                      clickable ? 'text-eko-text group-hover:text-eko-accent-text' : 'text-eko-text'}`}>
                      {i.name}
                      {clickable && <ChevronRight className="w-3.5 h-3.5 text-eko-subtle shrink-0" />}
                    </span>
                    <span className="text-eko-muted shrink-0 eko-num">{f.moneyShort(i.collected)}</span>
                  </div>
                  <div className="w-full bg-eko-surface-2 rounded-full h-2">
                    <div className="bg-eko-accent h-2 rounded-full"
                         style={{ width: `${Math.round(i.collected * 100 / max)}%` }} />
                  </div>
                  <p className="text-[11px] text-eko-muted mt-1">
                    {i.payments > 0
                      ? `${i.payments} ta to'lov qabul qilgan`
                      : 'Bu davrda to\'lov qabul qilmagan'}
                  </p>
                </Tag>
              )
            })}
          </div>
        )}
      </CardBody>
    </Card>
  )
}
