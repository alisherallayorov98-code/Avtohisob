import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Leaf, Loader2, Eye, EyeOff } from 'lucide-react'
import toast from 'react-hot-toast'
import { useEkoAuthStore } from './stores/ekoAuthStore'

export default function EkoHisobLogin() {
  const navigate = useNavigate()
  const { login, isAuthenticated, isLoading } = useEkoAuthStore()

  const [orgId, setOrgId] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)

  useEffect(() => {
    if (isAuthenticated) {
      navigate('/ekohisob/dashboard', { replace: true })
    }
  }, [isAuthenticated, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!orgId.trim() || !email.trim() || !password) {
      toast.error('Barcha maydonlarni to\'ldiring')
      return
    }
    try {
      await login(email.trim(), password, orgId.trim())
      navigate('/ekohisob/dashboard', { replace: true })
    } catch (err: unknown) {
      const message =
        (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data?.error ||
        (err as { response?: { data?: { message?: string } } })?.response?.data?.message ||
        'Login yoki parol noto\'g\'ri'
      toast.error(message)
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-green-600 to-emerald-700 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8">
          <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-3 backdrop-blur-sm">
            <Leaf className="w-9 h-9 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-white tracking-tight">EkoHisob</h1>
          <p className="text-green-100 text-sm mt-1">Chiqindilarni yig'ish to'lovlari tizimi</p>
        </div>

        {/* Card */}
        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">Tizimga kirish</h2>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Org ID */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Tashkilot ID
              </label>
              <input
                type="text"
                value={orgId}
                onChange={(e) => setOrgId(e.target.value)}
                placeholder="org_xxxxxxxx"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                autoComplete="organization"
              />
              <p className="text-xs text-gray-400 mt-1">Administratoringizdan oling</p>
            </div>

            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@misol.uz"
                className="w-full px-4 py-2.5 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                autoComplete="email"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Parol
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 pr-11 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent text-sm"
                  autoComplete="current-password"
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((v) => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  tabIndex={-1}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={isLoading}
              className="w-full bg-green-600 hover:bg-green-700 disabled:opacity-60 disabled:cursor-not-allowed text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 mt-2"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Kirish...
                </>
              ) : (
                'Kirish'
              )}
            </button>
          </form>
        </div>

        <p className="text-center text-green-200 text-xs mt-6">
          © {new Date().getFullYear()} EkoHisob — Avtohisob platformasi
        </p>
      </div>
    </div>
  )
}
