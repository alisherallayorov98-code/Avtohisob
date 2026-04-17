import { AlertTriangle, Loader2 } from 'lucide-react'
import { useEffect } from 'react'

interface Props {
  open: boolean
  title?: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  danger?: boolean
  loading?: boolean
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  open,
  title = 'Tasdiqlash',
  message,
  confirmLabel = 'Ha, davom etish',
  cancelLabel = 'Bekor qilish',
  danger = true,
  loading = false,
  onConfirm,
  onCancel,
}: Props) {
  // ESC → bekor qilish; tasodifiy backdrop bosish esa dialogni yopmaydi
  // (destruktiv ta'sir bo'lgani uchun — foydalanuvchi aniq "Bekor qilish"ni bosishi kerak)
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !loading) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, loading, onCancel])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="confirm-dialog-title">
      {/* Backdrop — bosilganda yopilmaydi (tasodifiy o'chirishdan himoya) */}
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />

      {/* Dialog */}
      <div className="relative bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-sm p-6 border border-gray-200 dark:border-gray-700">
        <div className="flex items-start gap-4">
          <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 ${
            danger ? 'bg-red-100 dark:bg-red-900/30' : 'bg-amber-100 dark:bg-amber-900/30'
          }`}>
            <AlertTriangle className={`w-5 h-5 ${danger ? 'text-red-500' : 'text-amber-500'}`} />
          </div>
          <div className="flex-1 min-w-0">
            <h3 id="confirm-dialog-title" className="text-base font-semibold text-gray-900 dark:text-white mb-1">{title}</h3>
            <p className="text-sm text-gray-500 dark:text-gray-400">{message}</p>
          </div>
        </div>

        <div className="flex gap-3 mt-6 justify-end">
          <button
            onClick={onCancel}
            disabled={loading}
            className="px-4 py-2 text-sm font-medium text-gray-700 dark:text-gray-300 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={loading}
            className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors disabled:opacity-50 ${
              danger
                ? 'bg-red-600 hover:bg-red-700 active:bg-red-800'
                : 'bg-amber-600 hover:bg-amber-700 active:bg-amber-800'
            }`}
          >
            {loading && <Loader2 className="w-4 h-4 animate-spin" />}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
