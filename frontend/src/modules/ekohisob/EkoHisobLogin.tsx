import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useEkoAuthStore } from './stores/ekoAuthStore'
import { errMsg, parseEkoError } from './lib/ekoErrors'
import { Banner, Button, Card, Field, Input } from './ui'
import { BrandMark } from './components/BrandMark'
import { PasswordInput } from './components/PasswordInput'
import ForcePasswordChange from './components/ForcePasswordChange'

function loginErrorText(err: unknown): string {
  const info = parseEkoError(err)
  if (info.network) return info.message
  if (info.status === 423 || info.code === 'ACCOUNT_LOCKED') return errMsg(err)
  if (info.status === 429) return "Juda ko'p urinish. 15 daqiqadan keyin qayta urinib ko'ring."
  if (info.status === 401) return "Login yoki parol noto'g'ri."
  return info.message
}

export default function EkoHisobLogin() {
  const navigate = useNavigate()
  const { login, isAuthenticated, isLoading, user } = useEkoAuthStore()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)

  // Parol almashtirish talab qilinsa — avval bloklovchi oyna (ForcePasswordChange), keyin dashboard.
  useEffect(() => {
    if (isAuthenticated && !user?.mustChangePassword) {
      navigate('/ekohisob/dashboard', { replace: true })
    }
  }, [isAuthenticated, user?.mustChangePassword, navigate])

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!email.trim() || !password) {
      setError('Login va parolni kiriting')
      return
    }
    setError(null)
    try {
      await login(email.trim(), password)
    } catch (err: unknown) {
      setError(loginErrorText(err))
    }
  }

  return (
    <div className="eko-app min-h-dvh flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="flex items-center gap-2.5 mb-6">
          <BrandMark className="w-8 h-8" />
          <div>
            <p className="eko-text-lg font-semibold text-eko-text leading-tight">EkoHisob</p>
            <p className="eko-text-sm text-eko-muted">Chiqindi to'lovlari hisobi</p>
          </div>
        </div>

        <Card>
          <h1 className="eko-text-lg font-semibold text-eko-text mb-4">Tizimga kirish</h1>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {error && <Banner tone="danger">{error}</Banner>}

            <Field label="Email yoki telefon">
              <Input
                type="email"
                inputMode="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="email@misol.uz yoki 901234567"
                className="h-12"
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
              />
            </Field>

            <Field label="Parol">
              <PasswordInput
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
              />
            </Field>

            <Button type="submit" variant="primary" size="lg" block loading={isLoading}>
              {isLoading ? 'Kirish...' : 'Kirish'}
            </Button>
          </form>
        </Card>

        <p className="text-center eko-text-xs text-eko-muted mt-6">
          © {new Date().getFullYear()} EkoHisob — Avtohisob platformasi
        </p>
      </div>
      <ForcePasswordChange />
    </div>
  )
}
