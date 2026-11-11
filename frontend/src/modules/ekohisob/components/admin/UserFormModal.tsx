import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { ekoKeys } from '../../lib/queries'
import { Banner, Button, Field, Input, Modal, Select } from '../../ui'
import { PasswordInput } from '../PasswordInput'
import { EkoRole, EkoUserRow } from './userTypes'

const MIN_PASSWORD = 8

/** Yangi foydalanuvchi yaratish yoki mavjudining ismi/loginini tahrirlash. */
export default function UserFormModal({
  user, districts, onClose,
}: { user: EkoUserRow | null; districts: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient()
  const editing = !!user
  const [fullName, setFullName] = useState(user?.fullName ?? '')
  const [login, setLogin] = useState(user?.email ?? '')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<EkoRole>('inspector')
  const [districtIds, setDistrictIds] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const pwErr = !editing && password.length > 0 && password.length < MIN_PASSWORD ? `Kamida ${MIN_PASSWORD} ta belgi` : null
  const valid = fullName.trim() && login.trim() && (editing || password.length >= MIN_PASSWORD)

  async function save(e?: React.FormEvent) {
    e?.preventDefault()
    if (!valid) { setError("Majburiy maydonlarni to'ldiring"); return }
    setSaving(true); setError(null)
    try {
      if (editing) {
        await ekoApi.put(`/users/${user!.id}`, { fullName: fullName.trim(), email: login.trim() })
        toast.success('Yangilandi')
      } else {
        const res = await ekoApi.post('/users', { fullName: fullName.trim(), email: login.trim(), password, role })
        const created = res.data.data ?? res.data
        if (created?.id && districtIds.length > 0) {
          await ekoApi.put(`/users/${created.id}/districts`, { districtIds })
        }
        toast.success("Foydalanuvchi qo'shildi")
      }
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
      size="md"
      title={editing ? 'Foydalanuvchini tahrirlash' : "Yangi foydalanuvchi"}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button variant="primary" className="flex-1" loading={saving} disabled={!valid} onClick={() => save()}>Saqlash</Button>
        </>
      }
    >
      <form onSubmit={save} className="p-5 space-y-4" noValidate>
        {error && <Banner tone="danger">{error}</Banner>}
        <Field label="F.I.O." required>
          <Input value={fullName} onChange={e => setFullName(e.target.value)} placeholder="Ism Familiya" data-autofocus />
        </Field>
        <Field label="Login (email yoki telefon)" hint="Xodim shu login bilan tizimga kiradi" required>
          <Input
            value={login} onChange={e => setLogin(e.target.value)}
            placeholder="email@misol.uz yoki 901234567"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
          />
        </Field>
        {!editing && (
          <>
            <Field label="Vaqtincha parol" hint={`Kamida ${MIN_PASSWORD} ta belgi. Xodim birinchi kirishda uni almashtiradi.`} error={pwErr} required>
              <PasswordInput value={password} onChange={e => setPassword(e.target.value)} autoComplete="new-password" />
            </Field>
            <Field
              label="Rol"
              hint={role === 'supervisor'
                ? "Boshliq o'z tumanidagi inspektorlar faoliyatini kuzatadi, to'lov yoza olmaydi. Tuman biriktiring."
                : undefined}
            >
              <Select value={role} onChange={e => setRole(e.target.value as EkoRole)}>
                <option value="inspector">Inspektor — to'lov yig'adi</option>
                <option value="supervisor">Boshliq (nazoratchi) — faqat kuzatadi</option>
                <option value="admin">Admin — to'liq nazorat</option>
              </Select>
            </Field>
            {role !== 'admin' && districts.length > 0 && (
              <fieldset>
                <legend className="eko-text-base font-medium text-eko-text mb-1">Tumanlar</legend>
                <p className="eko-text-xs text-eko-muted mb-2">Tuman biriktirilmasa, inspektor hech narsani ko'rmaydi.</p>
                <DistrictChecks districts={districts} value={districtIds} onChange={setDistrictIds} />
              </fieldset>
            )}
          </>
        )}
        {editing && <p className="eko-text-xs text-eko-muted">Parolni jadvaldagi «Parolni yangilash» orqali o'zgartiring.</p>}
        <button type="submit" className="hidden" tabIndex={-1} aria-hidden />
      </form>
    </Modal>
  )
}

/** 44px qatorli checkbox ro'yxati. */
export function DistrictChecks({
  districts, value, onChange,
}: { districts: { id: string; name: string }[]; value: string[]; onChange: (v: string[]) => void }) {
  return (
    <div className="border border-eko-line rounded-eko divide-y divide-eko-line max-h-64 overflow-y-auto">
      {districts.map(d => (
        <label key={d.id} className="flex items-center gap-3 px-3 min-h-[44px] cursor-pointer hover:bg-eko-surface-2">
          <input
            type="checkbox"
            checked={value.includes(d.id)}
            onChange={() => onChange(value.includes(d.id) ? value.filter(x => x !== d.id) : [...value, d.id])}
            className="w-5 h-5 accent-[rgb(var(--eko-accent))]"
          />
          <span className="eko-text-base text-eko-text">{d.name}</span>
        </label>
      ))}
    </div>
  )
}
