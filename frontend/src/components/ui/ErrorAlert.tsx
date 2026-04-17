import { AlertCircle, RefreshCw } from 'lucide-react'
import { apiErrorMessage } from '../../lib/api'

interface Props {
  error: unknown
  onRetry?: () => void
  fallback?: string
  className?: string
}

/** React Query yoki boshqa async so'rovlardan kelgan xatoni ko'rsatadi + qaytadan urinish tugmasi */
export default function ErrorAlert({ error, onRetry, fallback = "Ma'lumotni yuklab bo'lmadi", className }: Props) {
  const message = apiErrorMessage(error, fallback)
  return (
    <div
      role="alert"
      className={`flex flex-col items-center gap-3 p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-xl text-center ${className ?? ''}`}
    >
      <div className="w-12 h-12 rounded-xl bg-red-100 dark:bg-red-900/40 flex items-center justify-center">
        <AlertCircle className="w-6 h-6 text-red-600 dark:text-red-400" />
      </div>
      <div>
        <p className="text-sm font-medium text-red-900 dark:text-red-200">Xato yuz berdi</p>
        <p className="text-xs text-red-700 dark:text-red-300 mt-1">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
        >
          <RefreshCw className="w-4 h-4" />
          Qaytadan urinish
        </button>
      )}
    </div>
  )
}
