import { useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { Card, CardHeader, CardBody, Toggle, Button, Banner, DataTable } from '../../ui'
import type { EscalationRule, SectionProps } from './types'

const LEVEL_LABEL: Record<string, string> = {
  warning: '1 oy kechikish',
  overdue: '2 oy kechikish',
  critical: '3+ oy (kritik)',
}

type RuleKey = 'smsEnabled' | 'notifyInspector' | 'notifyManager' | 'suggestBlacklist'
const COLS: { key: RuleKey; title: string }[] = [
  { key: 'smsEnabled', title: 'Tashkilotga SMS' },
  { key: 'notifyInspector', title: 'Inspektorga xabar' },
  { key: 'notifyManager', title: 'Rahbar xulosasi' },
  { key: 'suggestBlacklist', title: "Qora ro'yxat tavsiyasi" },
]

/** Qarz darajasi oshganda ko'riladigan choralar. Qora ro'yxatga avtomatik QO'SHILMAYDI. */
export default function EscalationSection({ data, onSaved }: SectionProps) {
  const [enabled, setEnabled] = useState(data.escalationEnabled)
  const [rules, setRules] = useState<EscalationRule[]>(data.escalationRules ?? [])
  const [saving, setSaving] = useState(false)
  useEffect(() => { setEnabled(data.escalationEnabled); setRules(data.escalationRules ?? []) }, [data])

  const dirty = enabled !== data.escalationEnabled || JSON.stringify(rules) !== JSON.stringify(data.escalationRules ?? [])

  function setRule(level: string, key: RuleKey, v: boolean) {
    setRules(rs => rs.map(r => (r.level === level ? { ...r, [key]: v } : r)))
  }

  async function save() {
    setSaving(true)
    try {
      await ekoApi.put('/settings', { escalationEnabled: enabled, escalationRules: rules })
      toast.success('Eskalatsiya saqlandi')
      onSaved()
    } catch (e) { toast.error(errMsg(e)) } finally { setSaving(false) }
  }

  const visible = rules.filter(r => LEVEL_LABEL[r.level])

  return (
    <Card flush>
      <CardHeader
        title="Qarz eskalatsiyasi"
        actions={<Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={save}>Saqlash</Button>}
      />
      <CardBody className="space-y-4">
        <Toggle checked={enabled} onChange={setEnabled} label="Qarz darajasi oshganda avtomatik chora ko'rilsin" />
      </CardBody>
      <DataTable
        aria-label="Eskalatsiya qoidalari"
        rows={visible}
        rowKey={(r) => r.level}
        columns={[
          { key: 'level', title: 'Daraja', render: (r) => <span className="font-medium">{LEVEL_LABEL[r.level]}</span> },
          ...COLS.map(c => ({
            key: c.key, title: c.title, align: 'center' as const,
            render: (r: EscalationRule) => (
              <div className="flex justify-center">
                <Toggle
                  checked={r[c.key]}
                  disabled={!enabled}
                  onChange={(v) => setRule(r.level, c.key, v)}
                  label={<span className="sr-only">{LEVEL_LABEL[r.level]}: {c.title}</span>}
                />
              </div>
            ),
          })),
        ]}
      />
      <div className="px-4 sm:px-5 py-4 border-t border-eko-line">
        <Banner tone="info">
          Chora faqat daraja <b>oshganda</b> va har daraja uchun <b>bir marta</b> ko'riladi. Tashkilot qarzini to'lasa hisob nolga qaytadi —
          keyin yana qarzdor bo'lsa eslatma qaytadan boradi. Qora ro'yxatga <b>avtomatik qo'shilmaydi</b>: tizim faqat tavsiya qiladi.
        </Banner>
      </div>
    </Card>
  )
}
