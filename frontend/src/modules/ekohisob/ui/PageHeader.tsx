import { ReactNode } from 'react'
import { cx } from './cx'

/**
 * Sahifa sarlavhasi — barcha ekranlarda bir xil joyda va o'lchamda.
 *
 * Ilgari har sahifa o'z sarlavhasini turlicha yozardi (text-lg/text-xl,
 * turli bo'shliqlar) — natijada sahifalar orasida "sakrash" sezilardi.
 */
export function PageHeader({
  title, subtitle, actions, icon, className,
}: {
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  icon?: ReactNode
  className?: string
}) {
  return (
    <div className={cx('flex items-start justify-between gap-3 flex-wrap', className)}>
      <div className="flex items-start gap-2.5 min-w-0">
        {icon && <span className="text-eko-muted mt-1 shrink-0">{icon}</span>}
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-eko-text leading-tight tracking-tight">{title}</h1>
          {subtitle && <p className="text-xs text-eko-muted mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
    </div>
  )
}

/**
 * Sahifa qobig'i — yagona bo'shliq va maksimal kenglik.
 * Mobilda 16px, kengroq ekranda 24px chetki bo'shliq.
 */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex-1 overflow-y-auto', className)}>
      <div className="p-4 sm:p-6 space-y-4 max-w-[1400px] mx-auto">{children}</div>
    </div>
  )
}

/** Filtr/qidiruv qatori — kartaga o'ralgan, mobilda o'raladi. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-2 p-2.5',
        'bg-eko-surface border border-eko-line rounded-eko-lg shadow-eko',
        className,
      )}
    >
      {children}
    </div>
  )
}

/** Ikki-uch holatli tanlagich (tab o'rniga — kompakt va aniq). */
export function SegmentedControl<T extends string>({
  value, onChange, options, className,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; count?: number }[]
  className?: string
}) {
  return (
    <div className={cx('inline-flex p-0.5 bg-eko-surface-2 rounded-eko', className)}>
      {options.map((o) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cx(
              'px-3 h-8 rounded-[6px] text-[13px] font-medium transition-colors whitespace-nowrap',
              'inline-flex items-center gap-1.5',
              active
                ? 'bg-eko-surface text-eko-text shadow-eko'
                : 'text-eko-muted hover:text-eko-text',
            )}
          >
            {o.label}
            {o.count != null && (
              <span className={cx('text-[11px] eko-num', active ? 'text-eko-muted' : 'text-eko-subtle')}>
                {o.count}
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}
