import { ReactNode } from 'react'
import { cx } from './cx'
import { useIsMobile } from './hooks'
import { Modal } from './Modal'

export interface SplitPaneProps {
  /** Chap ro'yxat */
  list: ReactNode
  /** O'ng kontent (tanlangan element tafsiloti) */
  detail: ReactNode
  /** Tanlov bormi? Mobilda true bo'lsa detail pastki varaqda ochiladi */
  detailOpen?: boolean
  /** Mobil varaq yopilganda (tanlovni bekor qiling) */
  onDetailClose?: () => void
  /** Mobil varaq sarlavhasi */
  detailTitle?: ReactNode
  /** Tanlov yo'q bo'lganda desktopda o'ngda ko'rsatiladigan bo'sh holat */
  placeholder?: ReactNode
  /** Chap ustun kengligi (px), default 360 */
  listWidth?: number
  className?: string
}

/**
 * Chap ro'yxat + o'ng kontent. Desktopda ikki ustun (1px chiziq bilan);
 * mobilda faqat ro'yxat, tanlanganda tafsilot bottom-sheet bo'lib ochiladi.
 */
export function SplitPane({
  list, detail, detailOpen = true, onDetailClose, detailTitle, placeholder, listWidth = 360, className,
}: SplitPaneProps) {
  const mobile = useIsMobile()
  if (mobile) {
    return (
      <div className={className}>
        {list}
        <Modal open={!!detailOpen} onClose={onDetailClose ?? (() => {})} title={detailTitle ?? 'Tafsilot'} size="lg">
          {detail}
        </Modal>
      </div>
    )
  }
  return (
    <div
      className={cx('grid min-h-0 border border-eko-line rounded-eko-lg bg-eko-surface overflow-hidden', className)}
      style={{ gridTemplateColumns: `${listWidth}px minmax(0, 1fr)` }}
    >
      <div className="min-h-0 overflow-y-auto border-r border-eko-line">{list}</div>
      <div className="min-h-0 overflow-y-auto">
        {detailOpen ? detail : placeholder}
      </div>
    </div>
  )
}
