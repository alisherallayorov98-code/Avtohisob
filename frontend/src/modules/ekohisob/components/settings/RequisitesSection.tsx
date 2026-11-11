import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, CardBody, Field, Input, Button, Banner } from '../../ui'
import type { RequisiteKey, SectionProps } from './types'

interface RequisiteField { key: RequisiteKey; label: string; placeholder: string; wide?: boolean }

const FIELDS: RequisiteField[] = [
  { key: 'orgOfficialName', label: 'Rasmiy nomi', placeholder: '"Toshkent Tozalik" MChJ', wide: true },
  { key: 'orgStir', label: 'STIR', placeholder: '123456789' },
  { key: 'orgPhone', label: 'Telefon', placeholder: '712001020' },
  { key: 'orgAddress', label: 'Manzil', placeholder: 'Toshkent sh., Chilonzor t., 1-uy', wide: true },
  { key: 'orgBankAccount', label: 'Hisob raqami', placeholder: '2020 8000 1234 5678 9001' },
  { key: 'orgBankName', label: 'Bank', placeholder: 'Ipoteka Bank, Chilonzor filiali' },
  { key: 'orgMfo', label: 'MFO', placeholder: '00401' },
  { key: 'orgDirector', label: 'Rahbar (imzo uchun)', placeholder: 'A. Aliyev' },
  { key: 'orgAccountant', label: 'Bosh hisobchi', placeholder: 'B. Karimov' },
]

/** Akt sverka va fakturada xizmat ko'rsatuvchi tomon sifatida chiqadigan rekvizitlar. */
export default function RequisitesSection({ data, onSaved }: SectionProps) {
  const initial = () => Object.fromEntries(FIELDS.map(fl => [fl.key, data[fl.key] ?? ''])) as Record<RequisiteKey, string>
  const [vals, setVals] = useState(initial)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setVals(initial()) /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [data])

  const dirty = FIELDS.some(fl => (vals[fl.key] ?? '') !== (data[fl.key] ?? ''))

  async function save() {
    setSaving(true)
    try {
      await ekoApi.put('/settings', Object.fromEntries(FIELDS.map(fl => [fl.key, vals[fl.key].trim() || null])))
      toast.success('Rekvizitlar saqlandi')
      onSaved()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  return (
    <Card flush>
      <CardHeader
        title="Korxona rekvizitlari"
        hint="Akt sverka va fakturada xizmat ko'rsatuvchi tomon sifatida chiqadi. To'ldirilmasa hujjat rasmiy kuchga ega bo'lmaydi."
        actions={<Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={save}>Saqlash</Button>}
      />
      <CardBody className="space-y-4">
        {!data.orgOfficialName && (
          <Banner tone="warn">Rekvizitlar kiritilmagan — hozir chop etilgan akt sverkada korxona nomi o'rniga «—» chiqadi.</Banner>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          {FIELDS.map(fl => (
            <Field key={fl.key} label={fl.label} className={fl.wide ? 'sm:col-span-2' : undefined}>
              <Input
                value={vals[fl.key] ?? ''}
                placeholder={fl.placeholder}
                onChange={(e) => setVals(v => ({ ...v, [fl.key]: e.target.value }))}
              />
            </Field>
          ))}
        </div>
      </CardBody>
    </Card>
  )
}
