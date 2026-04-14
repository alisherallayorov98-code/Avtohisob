import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import { useForm } from 'react-hook-form'
import toast from 'react-hot-toast'
import { Truck, Eye, EyeOff, Shield } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import api from '../lib/api'
import Button from '../components/ui/Button'
import Input from '../components/ui/Input'

interface LoginForm { email: string; password: string }

export default function Login() {
  const { login, isAuthenticated, isLoading } = useAuthStore()
  const [showPassword, setShowPassword] = useState(false)
  const [twoFactorRequired, setTwoFactorRequired] = useState(false)
  const [totpCode, setTotpCode] = useState('')
  const [totpLoading, setTotpLoading] = useState(false)
  const [pendingCredentials, setPendingCredentials] = useState<{ email: string; password: string } | null>(null)

  const { register, handleSubmit, formState: { errors } } = useForm<LoginForm>()
  const user = useAuthStore(s => s.user)

  if (isAuthenticated) return <Navigate to={user?.role === 'super_admin' ? '/admin' : '/'} replace />

  const onSubmit = async (data: LoginForm) => {
    try {
      // First attempt — check if 2FA is needed
      const res = await api.post('/auth/login', { email: data.email, password: data.password })
      if (res.data.requiresTwoFactor) {
        setPendingCredentials(data)
        setTwoFactorRequired(true)
        return
      }
      // Normal login via store (updates state)
      await login(data.email, data.password)
      toast.success('Tizimga muvaffaqiyatli kirildingiz!')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Email yoki parol noto\'g\'ri')
    }
  }

  const onSubmit2FA = async () => {
    if (!pendingCredentials || !totpCode) return
    setTotpLoading(true)
    try {
      const res = await api.post('/auth/login', {
        email: pendingCredentials.email,
        password: pendingCredentials.password,
        totpCode,
      })
      const { user, accessToken, refreshToken } = res.data.data
      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refreshToken)
      useAuthStore.setState({ user, accessToken, isAuthenticated: true })
      toast.success('Tizimga muvaffaqiyatli kirildingiz!')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'TOTP kod noto\'g\'ri')
    } finally {
      setTotpLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-900 via-blue-900 to-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl p-8">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg">
              <Truck className="w-9 h-9 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              {twoFactorRequired ? 'Ikki bosqichli tasdiqlash' : 'AvtoHisob Pro'}
            </h1>
            <p className="text-gray-500 dark:text-gray-400 text-sm mt-1">
              {twoFactorRequired
                ? 'Autentifikator ilovangizdan 6 raqamli kodni kiriting'
                : 'Avtomashina parki boshqaruv tizimi'}
            </p>
          </div>

          {twoFactorRequired ? (
            <div className="space-y-5">
              <div className="flex items-center justify-center">
                <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-2xl">
                  <Shield className="w-10 h-10 text-blue-600 dark:text-blue-400" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
                  TOTP Kodi
                </label>
                <input
                  type="text"
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  value={totpCode}
                  onChange={e => setTotpCode(e.target.value.replace(/\D/g, ''))}
                  placeholder="123456"
                  className="w-full px-4 py-3 text-center text-2xl font-mono tracking-[0.5em] border border-gray-300 dark:border-gray-600 rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                  autoFocus
                />
              </div>

              <Button
                type="button"
                className="w-full"
                size="lg"
                loading={totpLoading}
                onClick={onSubmit2FA}
                disabled={totpCode.length !== 6}
              >
                Tasdiqlash
              </Button>

              <button
                type="button"
                onClick={() => { setTwoFactorRequired(false); setTotpCode('') }}
                className="w-full text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 text-center mt-2"
              >
                Orqaga qaytish
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
              <Input
                label="Email yoki telefon"
                placeholder="+998901234567 yoki email@..."
                error={errors.email?.message}
                {...register('email', {
                  required: 'Login talab qilinadi',
                })}
              />

              <div className="flex flex-col gap-1">
                <label className="text-sm font-medium text-gray-700 dark:text-gray-300">Parol</label>
                <div className="relative">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    placeholder="••••••••"
                    className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white pr-10 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    {...register('password', { required: 'Parol talab qilinadi', minLength: { value: 8, message: 'Parol kamida 8 ta belgi' } })}
                  />
                  <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {errors.password && <span className="text-xs text-red-500">{errors.password.message}</span>}
              </div>

              <div className="flex justify-end">
                <Link to="/forgot-password" className="text-xs text-blue-600 hover:underline dark:text-blue-400">
                  Parolni unutdingizmi?
                </Link>
              </div>

              <Button type="submit" className="w-full" size="lg" loading={isLoading}>
                Kirish
              </Button>
            </form>
          )}

          <p className="mt-6 text-center text-xs text-gray-400">
            AvtoHisob Pro v1.0 &bull; Barcha huquqlar himoyalangan
          </p>
        </div>
      </div>
    </div>
  )
}
