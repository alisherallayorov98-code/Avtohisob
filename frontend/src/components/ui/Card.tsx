import { cn } from '../../lib/utils'
import { TrendingUp, TrendingDown } from 'lucide-react'

export function Card({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm', className)}>{children}</div>
}

export function CardHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-4 lg:p-5 border-b border-gray-100 dark:border-gray-700', className)}>{children}</div>
}

export function CardBody({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn('p-4 lg:p-5', className)}>{children}</div>
}

export function StatCard({
  label, value, sub, icon, color = 'blue', trend, trendUp,
}: {
  label: string; value: string | number; sub?: string; icon: React.ReactNode;
  color?: string; trend?: string; trendUp?: boolean;
}) {
  const colors: Record<string, string> = {
    blue:   'bg-blue-50   dark:bg-blue-900/30   text-blue-600',
    green:  'bg-green-50  dark:bg-green-900/30  text-green-600',
    yellow: 'bg-yellow-50 dark:bg-yellow-900/30 text-yellow-600',
    red:    'bg-red-50    dark:bg-red-900/30    text-red-600',
    purple: 'bg-purple-50 dark:bg-purple-900/30 text-purple-600',
  }
  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 shadow-sm hover:shadow-md transition-shadow">
      <div className="p-4 lg:p-5 flex items-start gap-4">
        <div className={cn('w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0', colors[color] || colors.blue)}>
          {icon}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-sm text-gray-500 dark:text-gray-400 truncate">{label}</p>
          <p className="text-2xl font-bold text-gray-900 dark:text-white truncate mt-0.5">{value}</p>
          <div className="flex items-center gap-2 mt-1">
            {sub && <p className="text-xs text-gray-400 dark:text-gray-500">{sub}</p>}
            {trend && (
              <span className={cn('text-xs font-semibold flex items-center gap-0.5', trendUp ? 'text-green-600' : 'text-red-500')}>
                {trendUp ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                {trend}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
