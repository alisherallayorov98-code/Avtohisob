import { cn } from '../../lib/utils'
import { forwardRef } from 'react'

interface Props extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string
  error?: string
  hint?: string
}

const Input = forwardRef<HTMLInputElement, Props>(({ label, error, hint, className, ...props }, ref) => (
  <div className="flex flex-col gap-1">
    {label && <label className="text-sm font-medium text-gray-700">{label}</label>}
    <input
      ref={ref}
      className={cn(
        'w-full px-3 py-2 text-sm border rounded-lg bg-white transition-colors',
        'focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent',
        'placeholder:text-gray-400',
        error ? 'border-red-400 focus:ring-red-500' : 'border-gray-300',
        className
      )}
      {...props}
    />
    {error && <span className="text-xs text-red-500">{error}</span>}
    {hint && !error && <span className="text-xs text-gray-500">{hint}</span>}
  </div>
))
Input.displayName = 'Input'
export default Input
