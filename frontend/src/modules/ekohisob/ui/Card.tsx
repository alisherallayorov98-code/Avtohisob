import { ReactNode, HTMLAttributes } from 'react'
import { cx } from './cx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Ichki bo'shliqni o'chiradi (jadval/ro'yxat chegaraga tegadi) */
  flush?: boolean
  children?: ReactNode
}

/**
 * Karta — kontent blokining yagona idishi. TEKIS: soya yo'q, 1px chiziq.
 * Ajratish chiziq yoki ton farqi bilan; soya faqat modal/dropdown'da.
 */
export function Card({ flush, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'bg-eko-surface border border-eko-line rounded-eko-lg',
        !flush && 'p-4 sm:p-5',
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  )
}

export interface CardHeaderProps {
  title: ReactNode
  /** Sarlavha ostidagi izoh */
  hint?: ReactNode
  /** @deprecated Ikonka ko'rsatilmaydi (sarlavha matn bilan yetarli). */
  icon?: ReactNode
  /** O'ngdagi amallar */
  actions?: ReactNode
  className?: string
}

/** Karta sarlavhasi — `flush` kartalar ichida ajratuvchi chiziq bilan. */
export function CardHeader({ title, hint, actions, className }: CardHeaderProps) {
  return (
    <div className={cx('flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-eko-line', className)}>
      <div className="min-w-0">
        <h2 className="eko-text-md font-semibold text-eko-text truncate">{title}</h2>
        {hint && <p className="eko-text-xs text-eko-muted mt-0.5">{hint}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** Karta tanasi — `flush` kartalar ichida bo'shliq berish uchun. */
export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-4 sm:px-5 py-4', className)}>{children}</div>
}
