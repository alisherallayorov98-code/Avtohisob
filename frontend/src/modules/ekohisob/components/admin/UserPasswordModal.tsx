import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { ekoKeys } from '../../lib/queries'
import { Banner, Button, Field, Modal } from '../../ui'
import { PasswordInput } from '../PasswordInput'
import type { EkoUserRow } from './userTypes'

const MIN_PASSWORD = 8

/** Parolni yangilash (window.prompt o'rniga). Xodim birinchi kirishda uni almashtirishi shart bo'ladi. */
export default function UserPasswordModal({ user, onClose }: { user: EkoUserRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [password, setPassword] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tooShort = password.length > 0 && password.length < MIN_PASSWORD
  const valid = password.length >= MIN_PASSWORD

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    if (!valid) return
    setSaving(true); setError(null)
    try {
      await ekoApi.put(`/users/${user.id}/password`, { newPassword: password })
      toast.success('Parol yangilandi')
      qc.invalidateQueries({ queryKey: ekoKeys.users })
      onClose()
    } catch (err) {
      setError(errMsg(err))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      open
      onClose={onClose}
      disableBackdropClose
      size="sm"
      title="Parolni yangilash"
      hint={user.fullName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button variant="primary" className="flex-1" loading={saving} disabled={!valid} onClick={() => save()}>Saqlash</Button>
        </>
      }
    >
      <form onSubmit={save} className="p-5 space-y-4" noValidate>
        {error && <Banner tone="danger">{error}</Banner>}
        <Field
          label="Yangi vaqtincha parol"
          hint={`Kamida ${MIN_PASSWORD} ta belgi. Xodim kirgach uni o'zining paroliga almashtirishi shart bo'ladi va barcha eski sessiyalari tugaydi.`}
          error={tooShort ? `Kamida ${MIN_PASSWORD} ta belgi` : null}
          required
        >
          <PasswordInput value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" data-autofocus />
        </Field>
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}
