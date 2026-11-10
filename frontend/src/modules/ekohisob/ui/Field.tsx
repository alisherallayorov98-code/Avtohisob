import {
  ReactNode, InputHTMLAttributes, SelectHTMLAttributes, TextareaHTMLAttributes,
  forwardRef, useId, createContext, useContext,
} from 'react'
import { cx } from './cx'

// Barcha kiritish elementlari uchun yagona asos. `eko-control`: mobilda 16px
// shrift (iOS zoom yo'q) va 44px, desktopda 14px / 40px.
const BASE =
  'eko-control w-full rounded-eko border bg-eko-surface text-eko-text ' +
  'placeholder:text-eko-muted transition-colors ' +
  'border-eko-line hover:border-eko-line-strong focus:border-eko-accent ' +
  'disabled:bg-eko-surface-2 disabled:text-eko-muted disabled:cursor-not-allowed'

interface FieldCtx {
  id: string
  describedBy?: string
  invalid: boolean
  required: boolean
}
const FieldContext = createContext<FieldCtx | null>(null)

/** Field ichidagi kiritish elementi uchun aria atributlari (avtomatik). */
function useFieldAria(id?: string) {
  const ctx = useContext(FieldContext)
  // Faqat shu Field'ning o'z maydoni (id mos yoki berilmagan) ulanadi.
  const mine = ctx && (!id || id === ctx.id)
  return {
    id: id ?? ctx?.id,
    'aria-invalid': mine && ctx!.invalid ? true : undefined,
    'aria-describedby': mine ? ctx!.describedBy : undefined,
    required: mine && ctx!.required ? true : undefined,
  } as const
}

export interface FieldProps {
  label?: ReactNode
  /** Maydon ostidagi tushuntirish */
  hint?: ReactNode
  /** Xato matni — hint o'rniga qizil ko'rinadi, input `aria-invalid` bo'ladi */
  error?: string | null
  required?: boolean
  className?: string
  /** `id` ni qabul qiladi (eski uslub). aria atributlari Input/Select/Textarea ga AVTOMATIK ulanadi. */
  children: ReactNode | ((id: string) => ReactNode)
}

/** Yorliq (14px/500) + maydon + izoh/xato. */
export function Field({ label, hint, error, required, className, children }: FieldProps) {
  const id = useId()
  const msgId = error || hint ? `${id}-msg` : undefined
  return (
    <FieldContext.Provider value={{ id, describedBy: msgId, invalid: !!error, required: !!required }}>
      <div className={className}>
        {label && (
          <label htmlFor={id} className="block eko-text-base font-medium text-eko-text mb-2">
            {label}
            {required && <span className="text-eko-danger ml-0.5" aria-hidden>*</span>}
          </label>
        )}
        {typeof children === 'function' ? children(id) : children}
        {(error || hint) && (
          <p
            id={msgId}
            role={error ? 'alert' : undefined}
            className={cx('eko-text-xs mt-2', error ? 'text-eko-danger' : 'text-eko-muted')}
          >
            {error || hint}
          </p>
        )}
      </div>
    </FieldContext.Provider>
  )
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean }>(
  function Input({ className, invalid, id, ...rest }, ref) {
    const a = useFieldAria(id)
    return (
      <input
        ref={ref}
        {...a}
        aria-invalid={invalid || a['aria-invalid']}
        className={cx(BASE, 'px-3', (invalid || a['aria-invalid']) && '!border-eko-danger', className)}
        {...rest}
      />
    )
  },
)

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & { invalid?: boolean }>(
  function Select({ className, children, invalid, id, ...rest }, ref) {
    const a = useFieldAria(id)
    return (
      <select
        ref={ref}
        {...a}
        aria-invalid={invalid || a['aria-invalid']}
        className={cx(BASE, 'px-3 pr-8 cursor-pointer', (invalid || a['aria-invalid']) && '!border-eko-danger', className)}
        {...rest}
      >
        {children}
      </select>
    )
  },
)

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean }>(
  function Textarea({ className, invalid, id, ...rest }, ref) {
    const a = useFieldAria(id)
    return (
      <textarea
        ref={ref}
        {...a}
        aria-invalid={invalid || a['aria-invalid']}
        className={cx(BASE, 'px-3 py-2 resize-y', (invalid || a['aria-invalid']) && '!border-eko-danger', className)}
        {...rest}
      />
    )
  },
)

/** Belgili kiritish maydoni (qidiruv, telefon). */
export const InputWithIcon = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & { icon: ReactNode }>(
  function InputWithIcon({ icon, className, id, ...rest }, ref) {
    const a = useFieldAria(id)
    return (
      <div className="relative">
        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-eko-subtle pointer-events-none" aria-hidden>
          {icon}
        </span>
        <input ref={ref} {...a} className={cx(BASE, 'pl-9 pr-3', className)} {...rest} />
      </div>
    )
  },
)

/**
 * Almashtirgich. Butun qator BITTA `<button role="switch">` — label+button
 * ikki marta bosilish xatosi yo'q; mobilda 44px bosiladigan maydon.
 */
export function Toggle({
  checked, onChange, label, hint, disabled,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: ReactNode
  hint?: ReactNode
  disabled?: boolean
}) {
  const id = useId()
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-l`}
      aria-describedby={hint ? `${id}-h` : undefined}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cx(
        'flex items-start gap-3 text-left w-full min-h-[44px] md:min-h-0 py-1',
        disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer',
      )}
    >
      <span
        aria-hidden
        className={cx(
          'relative w-9 h-5 rounded-full transition-colors shrink-0 mt-0.5',
          checked ? 'bg-eko-accent' : 'bg-eko-surface-3',
        )}
      >
        <span
          className={cx(
            'absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform',
            checked && 'translate-x-4',
          )}
        />
      </span>
      <span className="min-w-0">
        <span id={`${id}-l`} className="block eko-text-base text-eko-text">{label}</span>
        {hint && <span id={`${id}-h`} className="block eko-text-xs text-eko-muted mt-0.5">{hint}</span>}
      </span>
    </button>
  )
}
