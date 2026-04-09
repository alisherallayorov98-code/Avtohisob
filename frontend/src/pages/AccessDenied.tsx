import { ShieldOff, ArrowLeft } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../stores/authStore'

const ROLE_LABELS: Record<string, string> = {
  super_admin: 'Super Admin',
  admin: 'Admin',
  manager: 'Menejer',
  branch_manager: 'Filial Menejer',
  operator: 'Operator',
}

export default function AccessDenied() {
  const navigate = useNavigate()
  const user = useAuthStore(s => s.user)

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-8">
      <div className="text-center max-w-md">
        <div className="w-20 h-20 bg-red-100 dark:bg-red-900/20 rounded-3xl flex items-center justify-center mx-auto mb-5">
          <ShieldOff className="w-10 h-10 text-red-500" />
        </div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white mb-2">
          Kirish taqiqlangan
        </h1>
        <p className="text-gray-500 dark:text-gray-400 text-sm mb-2">
          Bu bo'limga kirishga ruxsatingiz yo'q.
        </p>
        {user && (
          <p className="text-xs text-gray-400 dark:text-gray-500 mb-6">
            Sizning rolingiz:{' '}
            <span className="font-semibold text-gray-600 dark:text-gray-300">
              {ROLE_LABELS[user.role] ?? user.role}
            </span>
          </p>
        )}
        <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 mb-6 text-left">
          <p className="text-xs text-amber-700 dark:text-amber-400">
            Agar bu bo'limga kirishingiz kerak bo'lsa, tizim administratori bilan bog'laning va rolingizni o'zgartirishini so'rang.
          </p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Orqaga qaytish
        </button>
      </div>
    </div>
  )
}
