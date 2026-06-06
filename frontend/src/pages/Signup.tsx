import { useState } from 'react'
import { Navigate, Link } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Truck, Eye, EyeOff, Loader2, ArrowLeft, ShieldCheck, Building2, User, Phone, Lock } from 'lucide-react'
import { useAuthStore } from '../stores/authStore'
import api from '../lib/api'

export default function Signup() {
  const { isAuthenticated } = useAuthStore()
  const [step, setStep] = useState<1 | 2>(1)
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [devCode, setDevCode] = useState<string | null>(null)

  const [form, setForm] = useState({ fullName: '', orgName: '', phone: '', password: '' })
  const [code, setCode] = useState('')

  if (isAuthenticated) return <Navigate to="/" replace />

  function set<K extends keyof typeof form>(k: K, v: string) {
    setForm(p => ({ ...p, [k]: v }))
  }

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    if (!form.fullName.trim() || !form.orgName.trim() || !form.phone.trim() || form.password.length < 8) {
      toast.error('Barcha maydonlarni to\'ldiring (parol kamida 8 ta belgi)')
      return
    }
    setLoading(true)
    try {
      const res = await api.post('/auth/signup/send-code', { phone: form.phone })
      const d = res.data.data
      if (d?.devCode) setDevCode(d.devCode)  // dev rejim — kod ko'rsatiladi
      toast.success(res.data.message || 'Kod yuborildi')
      setStep(2)
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Xatolik yuz berdi')
    } finally { setLoading(false) }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (code.length < 4) { toast.error('Kodni kiriting'); return }
    setLoading(true)
    try {
      const res = await api.post('/auth/signup/verify', {
        phone: form.phone, code,
        fullName: form.fullName, orgName: form.orgName, password: form.password,
      })
      const { user, accessToken, refreshToken } = res.data.data
      localStorage.setItem('accessToken', accessToken)
      localStorage.setItem('refreshToken', refreshToken)
      useAuthStore.setState({ user, accessToken, isAuthenticated: true })
      toast.success('Xush kelibsiz! 14 kunlik bepul sinov boshlandi 🎉', { duration: 5000 })
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Kod noto\'g\'ri')
    } finally { setLoading(false) }
  }

  async function resend() {
    setLoading(true)
    try {
      const res = await api.post('/auth/signup/send-code', { phone: form.phone })
      if (res.data.data?.devCode) setDevCode(res.data.data.devCode)
      toast.success('Kod qayta yuborildi')
    } catch (err: any) {
      toast.error(err.response?.data?.error || 'Xatolik')
    } finally { setLoading(false) }
  }

  const inputCls = "w-full pl-10 pr-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition-shadow"

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 via-white to-indigo-50 p-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-6">
          <div className="inline-flex items-center justify-center w-14 h-14 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-2xl shadow-lg shadow-blue-500/30 mb-3">
            <Truck className="w-7 h-7 text-white" />
          </div>
          <h1 className="text-2xl font-bold text-gray-900">AvtoHisob</h1>
          <p className="text-sm text-gray-500 mt-1">14 kun bepul — karta talab qilinmaydi</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl border border-gray-100 p-6">
          {step === 1 ? (
            <form onSubmit={sendCode} className="space-y-4">
              <h2 className="text-lg font-semibold text-gray-900 text-center">Ro'yxatdan o'tish</h2>

              <div className="relative">
                <User className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={form.fullName} onChange={e => set('fullName', e.target.value)}
                  placeholder="Ism Familiya" className={inputCls} />
              </div>
              <div className="relative">
                <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={form.orgName} onChange={e => set('orgName', e.target.value)}
                  placeholder="Tashkilot / korxona nomi" className={inputCls} />
              </div>
              <div className="relative">
                <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={form.phone} onChange={e => set('phone', e.target.value)}
                  placeholder="90 123 45 67" type="tel" className={inputCls} />
              </div>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                <input value={form.password} onChange={e => set('password', e.target.value)}
                  placeholder="Parol (kamida 8 ta belgi)" type={showPassword ? 'text' : 'password'}
                  className={inputCls + ' pr-10'} />
                <button type="button" onClick={() => setShowPassword(v => !v)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>

              <button type="submit" disabled={loading}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold text-sm hover:shadow-lg hover:shadow-blue-500/30 transition-all disabled:opacity-60">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                SMS kod olish
              </button>

              <p className="text-xs text-center text-gray-400">
                Hisobingiz bormi? <Link to="/login" className="text-blue-600 font-medium hover:underline">Kirish</Link>
              </p>
            </form>
          ) : (
            <form onSubmit={verify} className="space-y-4">
              <button type="button" onClick={() => { setStep(1); setCode(''); setDevCode(null) }}
                className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700">
                <ArrowLeft className="w-3.5 h-3.5" /> Orqaga
              </button>

              <div className="text-center">
                <div className="inline-flex items-center justify-center w-12 h-12 bg-green-100 rounded-full mb-2">
                  <ShieldCheck className="w-6 h-6 text-green-600" />
                </div>
                <h2 className="text-lg font-semibold text-gray-900">Tasdiqlash kodi</h2>
                <p className="text-sm text-gray-500 mt-1">
                  <b>{form.phone}</b> raqamiga yuborilgan 6 xonali kodni kiriting
                </p>
              </div>

              {devCode && (
                <div className="bg-amber-50 border border-amber-200 rounded-lg p-2.5 text-center">
                  <p className="text-xs text-amber-600">SMS sozlanmagan (dev rejim). Kod:</p>
                  <p className="text-lg font-bold font-mono text-amber-700 tracking-widest">{devCode}</p>
                </div>
              )}

              <input value={code} onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="• • • • • •" inputMode="numeric"
                className="w-full text-center text-2xl font-bold font-mono tracking-[0.5em] py-3 border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500" />

              <button type="submit" disabled={loading || code.length < 4}
                className="w-full flex items-center justify-center gap-2 py-2.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold text-sm hover:shadow-lg transition-all disabled:opacity-60">
                {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
                Tasdiqlash va boshlash
              </button>

              <button type="button" onClick={resend} disabled={loading}
                className="w-full text-xs text-gray-500 hover:text-blue-600">
                Kod kelmadimi? Qayta yuborish
              </button>
            </form>
          )}
        </div>

        <p className="text-center text-xs text-gray-400 mt-4">
          Ro'yxatdan o'tish orqali <Link to="/oferta" className="underline">ommaviy oferta</Link> va{' '}
          <Link to="/privacy-policy" className="underline">maxfiylik siyosati</Link>ga rozilik bildirasiz
        </p>
      </div>
    </div>
  )
}
