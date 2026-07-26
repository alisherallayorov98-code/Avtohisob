import { ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes, forwardRef, useId } from 'react'
import { cx } from './cx'

// Barcha kiritish elementlari uchun yagona asos. Balandlik 40px (h-10) —
// mobilda barmoq uchun qulay va desktopda ham ortiqcha katta emas.
const BASE =
  'w-full rounded-eko border bg-eko-surface text-sm text-eko-text ' +
  'placeholder:text-eko-subtle transition-colors ' +
  'border-eko-line hover:border-eko-line-strong focus:border-eko-accent ' +
  'disabled:bg-eko-surface-2 disabled:text-eko-muted disabled:cursor-not-allowed'

export interface FieldProps {
  label?: ReactNode
  /** Maydon ostidagi tushuntirish */
  hint?: ReactNode
  /** Xato matni — hint o'rniga qizil ko'rinadi */
  error?: string | null
  required?: boolean
  className?: string
  children: (id: string) => ReactNode
}

/** Yorliq + maydon + izoh/xato. Yorliq va maydon `id` orqali bog'lanadi. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  return (
    <div className={className}>
      {label && (
        <label htmlFor={id} className="block text-xs font-medium text-eko-text-2 mb-1.5">
          {label}
          {required && <span className="text-eko-danger ml-0.5">*</span>}
        </label>
      )}
      {children(id)}
      {(error || hint) && (
        <p className={cx('text-xs mt-1.5', error ? 'text-eko-danger' : 'text-eko-muted')}>
          {error || hint}
        </p>
      )}
    </div>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, ...rest }, ref) {
    return (
      <input
        ref={ref}
        className={cx(BASE, 'h-10 px-3', invalid && 'border-eko-danger', className)}
        {...rest}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className, children, ...rest }, ref) {
    return (
      <select ref={ref} className={cx(BASE, 'h-10 px-3 pr-8 cursor-pointer', className)} {...rest}>
        {children}
      </select>
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cx(BASE, 'px-3 py-2 resize-y', className)} {...rest} />
  },
)

/** Belgili kiritish maydoni (qidiruv, telefon). */
export function InputWithIcon({
  icon, className, ...rest
}: InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode }) {
  return (
    <div className="relative">
      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-eko-subtle pointer-events-none">
        {icon}
      </span>
      <input className={cx(BASE, 'h-10 pl-9 pr-3', className)} {...rest} />
    </div>
  )
}

/** Almashtirgich (checkbox o'rniga sozlamalar uchun) */
export function Toggle({
  checked, onChange, label, hint, disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  return (
    <label className={cx('flex items-start gap-3', disabled ? 'opacity-50' : 'cursor-pointer')}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange(!checked)}
        className={cx(
          'relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5',
          checked ? 'bg-eko-accent' : 'bg-eko-surface-3',
          disabled && 'cursor-not-allowed',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white shadow-sm transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="block text-sm text-eko-text leading-snug">{label}</span>
        {hint && <span className="block text-xs text-eko-muted mt-0.5">{hint}</span>}
      </span>
    </label>
  )
}
