import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, CardBody, Field, Input, Button } from '../../ui'
import type { SectionProps } from './types'

/** To'lov sozlamalari: to'lov muddati kuni (1–28). */
export default function PaymentSection({ data, onSaved }: SectionProps) {
  const orig = data.paymentDueDay != null ? String(data.paymentDueDay) : ''
  const [day, setDay] = useState(orig)
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDay(orig) }, [orig])

  const n = Number(day)
  const ok = Number.isInteger(n) && n >= 1 && n <= 28

  async function save() {
    setSaving(true)
    try {
      await ekoApi.put('/settings', { paymentDueDay: n })
      toast.success("To'lov muddati saqlandi")
      onSaved()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  return (
    <Card flush>
      <CardHeader
        title="To'lov sozlamalari"
        actions={<Button variant="primary" size="sm" loading={saving} disabled={!ok || day === orig} onClick={save}>Saqlash</Button>}
      />
      <CardBody>
        <Field
          label="To'lov muddati kuni"
          hint="Har oyning shu kunigacha to'lanmagan hisob kechikkan hisoblanadi. 1–28: 29–31 tanlanmaydi, chunki fevralda bunday kun yo'q."
          error={day !== '' && !ok ? '1 dan 28 gacha butun son kiriting' : null}
        >
          <Input className="sm:max-w-[160px]" type="number" inputMode="numeric" min={1} max={28} value={day} onChange={(e) => setDay(e.target.value)} />
        </Field>
      </CardBody>
    </Card>
  )
}
