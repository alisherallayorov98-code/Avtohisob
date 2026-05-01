import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { Shield, Cookie } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

/**
 * Cookie + Maxfiylik siyosati banner.
 * Foydalanuvchi termsAcceptedAt = null bo'lsa pastki o'ngda ko'rinadi.
 * Qabul qilinsa — banner yashiriladi, user.termsAcceptedAt yangilanadi.
 */
export default function TermsBanner() {
  const qc = useQueryClient()
  const { user } = useAuthStore()
  const [hidden, setHidden] = useState(false)

  // Foydalanuvchi yo'q (login bo'lmagan) yoki allaqachon qabul qilgan — banner yo'q
  if (!user || (user as any).termsAcceptedAt || hidden) return null

  const acceptMutation = useMutation({
    mutationFn: () => api.post('/auth/accept-terms'),
    onSuccess: () => {
      toast.success('Rahmat!')
      qc.invalidateQueries({ queryKey: ['me'] })
      // Auth store'ni ham yangilash
      const cur = useAuthStore.getState().user
      if (cur) useAuthStore.setState({ user: { ...cur, termsAcceptedAt: new Date().toISOString() } as any })
      setHidden(true)
    },
    onError: () => toast.error("Saqlashda xato"),
  })

  return (
    <div className="fixed bottom-4 right-4 z-[100] max-w-md bg-white dark:bg-gray-800 border-2 border-blue-200 dark:border-blue-800 rounded-2xl shadow-2xl p-5 animate-in slide-in-from-bottom-4">
      <div className="flex items-start gap-3 mb-3">
        <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900/30 rounded-xl flex items-center justify-center shrink-0">
          <Cookie className="w-5 h-5 text-blue-600 dark:text-blue-400" />
        </div>
        <div className="flex-1">
          <p className="font-semibold text-gray-900 dark:text-white text-sm">Maxfiylik va cookies</p>
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-0.5">Saytdan foydalanish shartlari</p>
        </div>
      </div>

      <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-3">
        Sayt sifatli xizmat ko'rsatish uchun <b>cookie</b> fayllaridan foydalanadi.
        Davom etish orqali siz bizning{' '}
        <Link to="/privacy-policy" className="text-blue-600 dark:text-blue-400 font-medium hover:underline">
          Maxfiylik siyosatimizni
        </Link>
        {' '}qabul qilasiz.
      </p>

      <div className="bg-gray-50 dark:bg-gray-700/50 border border-gray-200 dark:border-gray-600 rounded-lg p-2.5 mb-3 flex items-start gap-2 text-xs text-gray-600 dark:text-gray-400">
        <Shield className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
        <span>
          Sizning ma'lumotlaringiz <b>O'zbekiston serverlarida</b> saqlanadi va uchinchi shaxslarga berilmaydi.
        </span>
      </div>

      <div className="flex gap-2">
        <Link
          to="/privacy-policy"
          className="flex-1 px-3 py-2 text-xs text-center text-gray-600 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 font-medium"
        >
          Batafsil
        </Link>
        <button
          onClick={() => acceptMutation.mutate()}
          disabled={acceptMutation.isPending}
          className="flex-1 px-3 py-2 text-xs text-white bg-blue-600 rounded-lg hover:bg-blue-700 font-medium disabled:opacity-50"
        >
          {acceptMutation.isPending ? 'Saqlanmoqda...' : 'Qabul qilaman'}
        </button>
      </div>
    </div>
  )
}
