import { forwardRef, ButtonHTMLAttributes, ReactNode } from 'react'
import { Loader2 } from 'lucide-react'
import { cx } from './cx'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  variant?: ButtonVariant
  size?: ButtonSize
  /** Yuklanmoqda — tugma bloklanadi va spinner ko'rsatiladi */
  loading?: boolean
  /** Chapdagi belgi (lucide ikonasi) */
  icon?: ReactNode
  /** Butun kenglikni egallaydi (mobil pastki panellar uchun) */
  block?: boolean
  children?: ReactNode
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary:
    'bg-eko-accent text-white hover:bg-eko-accent-hover ' +
    'disabled:bg-eko-accent/50',
  secondary:
    'bg-eko-surface text-eko-text border border-eko-line ' +
    'hover:bg-eko-surface-2 disabled:text-eko-subtle',
  ghost:
    'text-eko-text-2 hover:bg-eko-surface-2 hover:text-eko-text ' +
    'disabled:text-eko-subtle',
  danger:
    'bg-eko-danger text-white hover:brightness-95 disabled:bg-eko-danger/50',
}

// Balandliklar barmoq uchun: mobilda asosiy amal 44px dan kichik bo'lmasligi kerak.
// `sm` faqat ikkilamchi/desktop amallari uchun.
const SIZES: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[13px] gap-1.5',
  md: 'h-10 px-3.5 text-sm gap-2',
  lg: 'h-12 px-5 text-[15px] gap-2',
}

/**
 * Yagona tugma komponenti.
 *
 * Ilgari har sahifada tugma qo'lda yozilardi — natijada balandlik, radius va
 * yashil soyasi har joyda boshqacha edi. Endi variant + o'lcham tanlanadi.
 */
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'secondary', size = 'md', loading, icon, block, className, disabled, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-eko font-medium',
        'transition-colors duration-150 select-none',
        'disabled:cursor-not-allowed',
        VARIANTS[variant],
        SIZES[size],
        block && 'w-full',
        className,
      )}
      {...rest}
    >
      {loading ? <Loader2 className="w-4 h-4 animate-spin shrink-0" /> : icon}
      {children}
    </button>
  )
})

/** Faqat ikonali tugma — kichik amallar uchun (o'chirish, yopish). */
export const IconButton = forwardRef<HTMLButtonElement, ButtonProps & { label: string }>(
  function IconButton({ label, size = 'md', className, ...rest }, ref) {
    return (
      <Button
        ref={ref}
        aria-label={label}
        title={label}
        size={size}
        className={cx(
          'px-0 shrink-0',
          size === 'sm' ? 'w-8' : size === 'lg' ? 'w-12' : 'w-10',
          className,
        )}
        {...rest}
      />
    )
  },
)
