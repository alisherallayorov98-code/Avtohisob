import { ReactNode, HTMLAttributes } from 'react'
import { cx } from './cx'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** Ichki bo'shliqni o'chiradi (jadval yoki ro'yxat to'g'ridan chegaraga tegsa) */
  flush?: boolean
  children?: ReactNode
}

/**
 * Karta — barcha kontent bloklarining yagona idishi.
 *
 * Ilgari `bg-white rounded-xl shadow-sm border border-gray-100` 8 xil
 * ko'rinishda 34 marta yozilgan edi. Endi bitta manba.
 */
export function Card({ flush, className, children, ...rest }: CardProps) {
  return (
    <div
      className={cx(
        'bg-eko-surface border border-eko-line rounded-eko-lg shadow-eko',
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
  /** Chapdagi belgi */
  icon?: ReactNode
  /** O'ngdagi amallar */
  actions?: ReactNode
  className?: string
}

/** Karta sarlavhasi — `flush` kartalar ichida ajratuvchi chiziq bilan. */
export function CardHeader({ title, hint, icon, actions, className }: CardHeaderProps) {
  return (
    <div className={cx('flex items-start justify-between gap-3 px-4 sm:px-5 py-3.5 border-b border-eko-line', className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="text-eko-muted mt-0.5 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-eko-text leading-tight truncate">{title}</h2>
          {hint && <p className="text-xs text-eko-muted mt-0.5">{hint}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  )
}

/** Karta tanasi — `flush` kartalar ichida bo'shliq berish uchun. */
export function CardBody({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cx('px-4 sm:px-5 py-4', className)}>{children}</div>
}
