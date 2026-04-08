import { cn } from '../../lib/utils'

interface Props {
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info' | 'gray'
  children: React.ReactNode
  className?: string
}

const variants = {
  default: 'bg-blue-100 text-blue-700',
  success: 'bg-green-100 text-green-700',
  warning: 'bg-yellow-100 text-yellow-700',
  danger: 'bg-red-100 text-red-700',
  info: 'bg-purple-100 text-purple-700',
  gray: 'bg-gray-100 text-gray-700',
}

export default function Badge({ variant = 'default', children, className }: Props) {
  return (
    <span className={cn('inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium', variants[variant], className)}>
      {children}
    </span>
  )
}
