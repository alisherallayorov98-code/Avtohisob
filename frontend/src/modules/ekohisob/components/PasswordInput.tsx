import { forwardRef, InputHTMLAttributes, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input, cx } from '../ui'

/**
 * Parol maydoni + "ko'rsatish" tugmasi (44px bosiladigan maydon).
 * Tugma Tab ketma-ketligida (parol kiritgach ham yetib borish mumkin).
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function PasswordInput({ className, ...rest }, ref) {
    const [show, setShow] = useState(false)
    return (
      <div className="relative">
        <Input
          ref={ref}
          type={show ? 'text' : 'password'}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          className={cx('h-12 pr-12', className)}
          {...rest}
        />
        <button
          type="button"
          onClick={() => setShow(v => !v)}
          aria-label={show ? 'Parolni yashirish' : "Parolni ko'rsatish"}
          aria-pressed={show}
          className="absolute right-0 top-0 h-12 w-12 inline-flex items-center justify-center text-eko-muted hover:text-eko-text rounded-eko"
        >
          {show ? <EyeOff className="w-5 h-5" aria-hidden /> : <Eye className="w-5 h-5" aria-hidden />}
        </button>
      </div>
    )
  },
)
