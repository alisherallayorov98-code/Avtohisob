import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { CheckCircle, XCircle, Loader2, Mail } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

export default function VerifyEmail() {
  const [searchParams] = useSearchParams()
  const token = searchParams.get('token')
  const { accessToken: authToken } = useAuthStore()

  const [status, setStatus] = useState<'loading' | 'success' | 'error' | 'resend'>('loading')
  const [error, setError] = useState('')
  const [resendLoading, setResendLoading] = useState(false)
  const [resendSent, setResendSent] = useState(false)

  useEffect(() => {
    if (!token) { setStatus('resend'); return }
    api.post('/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch(err => {
        setError(err.response?.data?.error || 'Token noto\'g\'ri yoki muddati o\'tgan')
        setStatus('error')
      })
  }, [token])

  async function handleResend() {
    setResendLoading(true)
    try {
      await api.post('/auth/send-verification')
      setResendSent(true)
    } catch (err: any) {
      setError(err.response?.data?.error || 'Xatolik yuz berdi')
    } finally {
      setResendLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white text-2xl font-bold mb-4 shadow-lg">A</div>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 text-center">
          {status === 'loading' && (
            <>
              <Loader2 className="w-12 h-12 text-blue-500 mx-auto mb-4 animate-spin" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Tasdiqlanmoqda...</h2>
              <p className="text-sm text-gray-500">Email manzil tasdiqlanmoqda, iltimos kuting.</p>
            </>
          )}

          {status === 'success' && (
            <>
              <CheckCircle className="w-12 h-12 text-green-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Email tasdiqlandi! 🎉</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Email manzilingiz muvaffaqiyatli tasdiqlandi. Endi barcha imkoniyatlardan to'liq foydalana olasiz.
              </p>
              <Link
                to="/"
                className="inline-block bg-blue-600 hover:bg-blue-700 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
              >
                Bosh sahifaga o'tish
              </Link>
            </>
          )}

          {status === 'error' && (
            <>
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Tasdiqlash muvaffaqiyatsiz</h2>
              <p className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 px-3 py-2 rounded-lg mb-6">{error}</p>
              {resendSent ? (
                <p className="text-sm text-green-600">Yangi tasdiqlash xati yuborildi!</p>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resendLoading}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  {resendLoading ? 'Yuborilmoqda...' : 'Yangi havola yuborish'}
                </button>
              )}
            </>
          )}

          {status === 'resend' && (
            <>
              <Mail className="w-12 h-12 text-blue-500 mx-auto mb-4" />
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">Email tasdiqlash</h2>
              <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
                Tizimdan to'liq foydalanish uchun email manzilingizni tasdiqlashingiz kerak.
                Tasdiqlash xatini qayta yuborish uchun tugmani bosing.
              </p>
              {resendSent ? (
                <div className="flex items-center gap-2 justify-center text-green-600 text-sm">
                  <CheckCircle className="w-4 h-4" />
                  Xat yuborildi! Emailingizni tekshiring.
                </div>
              ) : (
                <button
                  onClick={handleResend}
                  disabled={resendLoading}
                  className="inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 disabled:opacity-60 text-white font-semibold px-6 py-2.5 rounded-xl text-sm transition-colors"
                >
                  <Mail className="w-4 h-4" />
                  {resendLoading ? 'Yuborilmoqda...' : 'Tasdiqlash xatini yuborish'}
                </button>
              )}
            </>
          )}
        </div>

        <div className="mt-6 text-center">
          <Link to="/" className="text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            Bosh sahifaga qaytish
          </Link>
        </div>
      </div>
    </div>
  )
}
