import { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ChevronLeft, RefreshCw } from 'lucide-react'
import { cx } from './cx'
import { Skeleton, ErrorState } from './States'
import { relative } from './format'

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** O'ngdagi amallar (bitta primary!) */
  actions?: ReactNode
  /** Orqaga havola: yuqorida "‹ Tashkilotlar" ko'rinishida */
  back?: { to: string; label: string }
  /** "Yangilandi 2 daqiqa oldin" + yangilash tugmasi */
  meta?: { updatedAt?: string | Date | number | null; onRefresh?: () => void; refreshing?: boolean }
  /** Qamrov belgisi (masalan "Chilonzor tumani") — sarlavha yonida kulrang matn */
  scope?: ReactNode
  /** Yuklanayotganda sarlavha o'rniga skeleton */
  loading?: boolean
  /** Xato bo'lsa — sarlavha ostida ErrorState emas, qisqa xato qatori */
  error?: string | null
  onRetry?: () => void
  /** @deprecated Ikonka ko'rsatilmaydi. */
  icon?: ReactNode
  className?: string
}

/**
 * Sahifa sarlavhasi — h1 24px, hamma ekranda bir xil joyda.
 * `loading`/`error` — sahifa sarlavha o'zi holatni ko'rsata oladi.
 */
export function PageHeader({
  title, subtitle, actions, back, meta, scope, loading, error, onRetry, className,
}: PageHeaderProps) {
  return (
    <div className={cx('space-y-1', className)}>
      {back && (
        <Link to={back.to} className="inline-flex items-center gap-0.5 eko-text-sm text-eko-muted hover:text-eko-text min-h-[44px] md:min-h-0 -ml-1">
          <ChevronLeft className="w-4 h-4" aria-hidden />
          {back.label}
        </Link>
      )}
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          {loading ? (
            <>
              <Skeleton className="h-7 w-48" />
              <Skeleton className="h-3.5 w-64 mt-2" />
            </>
          ) : (
            <>
              <h1 className="eko-text-h1 font-semibold text-eko-text">
                {title}
                {scope && <span className="ml-2 eko-text-base font-normal text-eko-muted align-middle">{scope}</span>}
              </h1>
              {(subtitle || meta) && (
                <p className="eko-text-sm text-eko-muted mt-1 flex items-center gap-2 flex-wrap">
                  {subtitle}
                  {meta && (
                    <span className="inline-flex items-center gap-1.5">
                      {meta.updatedAt && <span>Yangilandi {relative(meta.updatedAt as string | Date)}</span>}
                      {meta.onRefresh && (
                        <button
                          type="button"
                          onClick={meta.onRefresh}
                          disabled={meta.refreshing}
                          aria-label="Yangilash"
                          title="Yangilash"
                          className="inline-flex items-center justify-center w-6 h-6 -m-1 rounded-eko text-eko-muted hover:text-eko-text hover:bg-eko-surface-2 disabled:opacity-60 relative before:absolute before:-inset-2.5 before:content-['']"
                        >
                          <RefreshCw className={cx('w-3.5 h-3.5', meta.refreshing && 'animate-spin')} />
                        </button>
                      )}
                    </span>
                  )}
                </p>
              )}
            </>
          )}
        </div>
        {actions && !loading && <div className="flex items-center gap-2 flex-wrap">{actions}</div>}
      </div>
      {error && !loading && (
        <div className="pt-2"><ErrorState title={error} onRetry={onRetry} compact /></div>
      )}
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

/** Filtr/qidiruv qatori — soyasiz, 1px chiziqli. */
export function Toolbar({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'flex flex-wrap items-center gap-2 p-2.5',
        'bg-eko-surface border border-eko-line rounded-eko-lg',
        className,
      )}
    >
      {children}
    </div>
  )
}

/**
 * Ikki-uch holatli tanlagich. Soyasiz: faol variant `surface` + 1px chiziq.
 * Mobilda 44px balandlik. `role=radiogroup` + strelka tugmalari.
 */
export function SegmentedControl<T extends string>({
  value, onChange, options, className, ariaLabel,
}: {
  value: T
  onChange: (v: T) => void
  options: { value: T; label: ReactNode; count?: number }[]
  className?: string
  ariaLabel?: string
}) {
  function onKey(e: React.KeyboardEvent, i: number) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    e.preventDefault()
    const n = (i + (e.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length
    onChange(options[n].value)
    ;(e.currentTarget.parentElement?.children[n] as HTMLElement | undefined)?.focus()
  }
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cx('inline-flex p-0.5 bg-eko-surface-2 rounded-eko', className)}>
      {options.map((o, i) => {
        const active = o.value === value
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            tabIndex={active ? 0 : -1}
            onClick={() => onChange(o.value)}
            onKeyDown={(e) => onKey(e, i)}
            className={cx(
              'px-3 h-11 md:h-8 rounded-[6px] eko-text-sm font-medium transition-colors whitespace-nowrap',
              'inline-flex items-center gap-1.5 border',
              active
                ? 'bg-eko-surface text-eko-text border-eko-line'
                : 'text-eko-muted hover:text-eko-text border-transparent',
            )}
          >
            {o.label}
            {o.count != null && (
              <span className="eko-text-xs eko-num text-eko-muted">{o.count}</span>
            )}
          </button>
        )
      })}
    </div>
  )
}
