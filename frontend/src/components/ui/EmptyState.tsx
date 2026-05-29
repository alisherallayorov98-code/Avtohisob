import { ReactNode } from 'react'
import { LucideIcon } from 'lucide-react'

interface Props {
  icon: LucideIcon
  title: string
  description?: string
  action?: ReactNode
  className?: string
}

export default function EmptyState({ icon: Icon, title, description, action, className = '' }: Props) {
  return (
    <div className={`flex flex-col items-center justify-center py-16 px-6 text-center animate-fade-in-up ${className}`}>
      <div className="relative mb-6">
        <div className="absolute inset-0 bg-blue-200/50 dark:bg-blue-600/20 blur-2xl rounded-full pointer-events-none" />
        <div className="relative w-20 h-20 glass-card rounded-3xl flex items-center justify-center -rotate-6 hover:rotate-0 transition-transform duration-300 ease-out">
          <Icon className="w-10 h-10 text-blue-500 dark:text-blue-400" strokeWidth={1.5} />
        </div>
      </div>
      <h3 className="text-lg font-semibold text-gray-800 dark:text-gray-200 mb-2">{title}</h3>
      {description && (
        <p className="text-sm text-gray-500 dark:text-gray-400 max-w-sm leading-relaxed">{description}</p>
      )}
      {action && <div className="mt-6 animate-fade-in-up delay-75">{action}</div>}
    </div>
  )
}
