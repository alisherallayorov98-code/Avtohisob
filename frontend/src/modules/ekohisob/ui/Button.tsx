import { forwardRef, ButtonHTMLAttributes, AnchorHTMLAttributes, ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { Loader2 } from 'lucide-react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-eko-accent eko-on-accent hover:bg-eko-accent-hover ' +
    'disabled:bg-eko-surface-3 disabled:text-eko-muted',
  secondary:
    'bg-eko-surface text-eko-text border border-eko-line hover:bg-eko-surface-2 ' +
    'disabled:text-eko-muted disabled:bg-eko-surface-2',
  ghost:
    'text-eko-text-2 hover:bg-eko-surface-2 hover:text-eko-text disabled:text-eko-muted',
  danger:
    'bg-eko-danger eko-on-danger hover:brightness-95 disabled:bg-eko-surface-3 disabled:text-eko-muted',
}

// Mobilda barmoq uchun: md = 44px, sm >= 40px. Desktopda sm 32 / md 40 / lg 48.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-10 md:h-8 px-3 md:px-2.5 eko-text-sm gap-1.5',
  md: 'h-11 md:h-10 px-4 md:px-3.5 eko-text-base gap-2',
  lg: 'h-12 px-5 eko-text-md gap-2',
}

/** Tugma klasslari — Button va LinkButton umumiy. */
export function buttonClasses(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', block?: boolean) {
  return cx(
    'inline-flex items-center justify-center rounded-eko font-medium',
    'transition-colors duration-150 select-none no-underline',
    'disabled:cursor-not-allowed aria-disabled:pointer-events-none',
    VARIANTS[variant],
    SIZES[size],
    block && 'w-full',
  )
}

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Yuklanmoqda — tugma bloklanadi, spinner ko'rsatiladi */
  loading?: boolean
  /** Chapdagi belgi (lucide ikonasi) */
  icon?: ReactNode
  /** Butun kenglik (mobil pastki panellar) */
  block?: boolean
  children?: ReactNode
}

/**
 * Yagona tugma. QOIDA: sahifada bitta `primary` (asosiy amal), qolganlari
 * `secondary`/`ghost`. Havola kerak bo'lsa `LinkButton` (ichma-ich interaktiv
 * element yaratmang: `<a><Button/></a>` YOMON).
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, block, className, disabled, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cx(buttonClasses(variant, size, block), className)}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden /> : icon}
      {children}
    </button>
  )
})

export interface LinkButtonProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'children'> {
  /** Ichki yo'nalish (react-router Link). `href` bilan birga berilmaydi. */
  to?: string
  variant?: ButtonVariant
  size?: ButtonSize
  icon?: ReactNode
  block?: boolean
  disabled?: boolean
  children?: ReactNode
}

/** Tugma ko'rinishidagi havola: `to` (ichki) yoki `href` (tashqi/fayl). */
export const LinkButton = forwardRef<HTMLAnchorElement, LinkButtonProps>(function LinkButton(
  { to, href, variant = 'secondary', size = 'md', icon, block, disabled, className, children, ...rest },
  ref,
) {
  const cls = cx(buttonClasses(variant, size, block), className)
  const common = { className: cls, 'aria-disabled': disabled || undefined, ref }
  if (to) return <Link to={to} {...common} {...(rest as object)}>{icon}{children}</Link>
  return <a href={href} {...common} {...rest}>{icon}{children}</a>
})

/**
 * Faqat ikonali tugma. `label` MAJBURIY (ekran o'qigich + tooltip).
 * Bosiladigan maydon mobilda 44px.
 */
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(
  function IconButton({ label, size = 'md', className, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        aria-label={label}
        title={label}
        size={size}
        className={cx(
          '!px-0 shrink-0',
          size === 'sm' ? 'w-10 md:w-8' : size === 'lg' ? 'w-12' : 'w-11 md:w-10',
          className,
        )}
        {...rest}
      />
    )
  },
)
