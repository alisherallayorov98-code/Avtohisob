import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import ekoApi, { EKO_MUST_CHANGE_PASSWORD_EVENT } from '../lib/ekoApi'
import { errMsg } from '../lib/ekoErrors'
import { useEkoAuthStore } from '../stores/ekoAuthStore'
import { Banner, Button, Field, Modal } from '../ui'
import { PasswordInput } from './PasswordInput'

const MIN_LEN = 8

/**
 * Majburiy parol almashtirish. Bloklovchi Modal: yopib bo'lmaydi (fon bosish yo'q;
 * "Yopish" tugmasi ham almashtirmaguncha hech narsa qilmaydi). Ochiladi:
 *  - login javobida user.mustChangePassword === true bo'lsa,
 *  - ekoApi 403 MUST_CHANGE_PASSWORD hodisasi kelsa.
 */
export default function ForcePasswordChange() {
  const mustChange = useEkoAuthStore(s => !!s.user?.mustChangePassword)
  const isAuthenticated = useEkoAuthStore(s => s.isAuthenticated)
  const applyPasswordChanged = useEkoAuthStore(s => s.applyPasswordChanged)
  const [eventOpen, setEventOpen] = useState(false)

  const [oldPassword, setOld] = useState('')
  const [newPassword, setNew] = useState('')
  const [repeat, setRepeat] = useState('')
  const [saving, setSaving] = useState(false)
  const [serverError, setServerError] = useState<string | null>(null)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    const on = () => setEventOpen(true)
    window.addEventListener(EKO_MUST_CHANGE_PASSWORD_EVENT, on)
    return () => window.removeEventListener(EKO_MUST_CHANGE_PASSWORD_EVENT, on)
  }, [])

  const open = isAuthenticated && (mustChange || eventOpen)

  const newErr =
    newPassword.length > 0 && newPassword.length < MIN_LEN ? `Kamida ${MIN_LEN} ta belgi`
    : newPassword && newPassword === oldPassword ? 'Yangi parol eskisidan farq qilishi kerak'
    : null
  const repeatErr = repeat && repeat !== newPassword ? 'Parollar mos kelmadi' : null
  const valid = !!oldPassword && newPassword.length >= MIN_LEN && !newErr && repeat === newPassword

  async function submit(e?: React.FormEvent) {
    e?.preventDefault()
    setTouched(true)
    if (!valid || saving) return
    setSaving(true)
    setServerError(null)
    try {
      const res = await ekoApi.post('/auth/change-password', { oldPassword, newPassword })
      const token: string | undefined = res.data?.data?.token ?? res.data?.token
      if (token) applyPasswordChanged(token)
      setOld(''); setNew(''); setRepeat(''); setTouched(false); setEventOpen(false)
      toast.success('Parol almashtirildi')
    } catch (err) {
      setServerError(errMsg(err))
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  return (
    <Modal
      open
      onClose={() => { /* yopib bo'lmaydi */ }}
      disableBackdropClose
      size="sm"
      title="Parolni almashtiring"
      hint="Xavfsizlik uchun vaqtincha parolni o'zingiznikiga almashtirish shart."
      footer={
        <Button variant="primary" block loading={saving} disabled={!valid} onClick={() => submit()}>
          Parolni saqlash
        </Button>
      }
    >
      <form onSubmit={submit} className="p-5 space-y-4" noValidate>
        {serverError && <Banner tone="danger">{serverError}</Banner>}
        <Field label="Joriy (vaqtincha) parol" required>
          <PasswordInput
            value={oldPassword}
            onChange={e => setOld(e.target.value)}
            autoComplete="current-password"
            data-autofocus
          />
        </Field>
        <Field label="Yangi parol" hint={`Kamida ${MIN_LEN} ta belgi`} error={touched || newPassword ? newErr : null} required>
          <PasswordInput value={newPassword} onChange={e => setNew(e.target.value)} autoComplete="new-password" />
        </Field>
        <Field label="Yangi parolni takrorlang" error={touched || repeat ? repeatErr : null} required>
          <PasswordInput value={repeat} onChange={e => setRepeat(e.target.value)} autoComplete="new-password" />
        </Field>
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}
