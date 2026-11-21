import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { Banner, Button, Field, Modal, Select, Textarea, Toggle, SegmentedControl } from '../../ui'
import { EvidenceTable } from './FindingCard'
import type { Finding } from './types'
import { CONFIDENCE_META } from './types'

type Verdict = 'confirmed' | 'wrong' | 'normal'

const VERDICT_HINT: Record<Verdict, string> = {
  confirmed: "Muammo haqiqatan bor. Savol ro'yxatda \"tasdiqlangan\" belgisi bilan qoladi.",
  wrong: "Robot xato qildi. Savol yashiriladi va bu turdagi savollarning aniqligi pasayadi.",
  normal: 'Dalil to\'g\'ri, lekin bu normal holat. Savol yashiriladi.',
}

/** Hukm: to'g'ri / noto'g'ri / normal. Taxmin savolni tasdiqlash uchun manbani ko'rish majburiy. */
export function VerdictModal({ finding: x, onClose, onDone }: { finding: Finding; onClose: () => void; onDone: () => void }) {
  const [verdict, setVerdict] = useState<Verdict>('confirmed')
  const [reason, setReason] = useState('')
  const [resolution, setResolution] = useState('')
  const [checked, setChecked] = useState(false)
  const [busy, setBusy] = useState(false)
  const notFact = (x.confidence ?? 'fact') !== 'fact'
  const minLen = verdict === 'confirmed' && notFact ? 10 : 3
  const needCheck = verdict === 'confirmed' && notFact
  const canSubmit = reason.trim().length >= minLen && (!needCheck || checked)

  async function submit() {
    setBusy(true)
    try {
      await ekoApi.post('/insights/verdict', { fingerprint: x.fingerprint, verdict, reason, resolution: resolution || undefined, sourceChecked: checked })
      toast.success('Hukm saqlandi')
      onDone()
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      onClose={onClose}
      title="Savol bo'yicha hukm"
      hint={x.title}
      size="lg"
      disableBackdropClose
      footer={<>
        <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
        <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={submit}>Saqlash</Button>
      </>}
    >
      <div className="space-y-4">
        <Banner tone={notFact ? 'warn' : 'info'}>
          <b>{CONFIDENCE_META[x.confidence ?? 'fact'].label}.</b> {x.basis || CONFIDENCE_META[x.confidence ?? 'fact'].hint}
        </Banner>
        {x.evidence && x.evidence.rows.length > 0 && <EvidenceTable ev={x.evidence} />}
        <SegmentedControl<Verdict>
          ariaLabel="Hukm"
          value={verdict}
          onChange={setVerdict}
          options={[
            { value: 'confirmed', label: "To'g'ri" },
            { value: 'wrong', label: "Noto'g'ri" },
            { value: 'normal', label: 'Normal' },
          ]}
        />
        <p className="eko-text-sm text-eko-muted">{VERDICT_HINT[verdict]}</p>
        <Field label="Asos" required hint={`Kamida ${minLen} ta harf. Nimani tekshirdingiz?`}>
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={500} />
        </Field>
        {verdict === 'confirmed' && (
          <Field label="Yechim (ixtiyoriy)" hint="Masalan: pul qaytarildi, xodimdan tushuntirish olindi, kvitansiya qayta chiqarildi">
            <Textarea rows={2} value={resolution} onChange={e => setResolution(e.target.value)} maxLength={500} />
          </Field>
        )}
        {needCheck && (
          <Toggle
            checked={checked}
            onChange={setChecked}
            label="Manbani ko'rib chiqdim"
            hint="Bu savol fakt emas. Xodim taxmin bo'yicha javobgar bo'lib qolmasligi uchun avval manbani tekshiring va tushuntirish so'rang."
          />
        )}
      </div>
    </Modal>
  )
}

const DISMISS_TITLE = {
  one30: '30 kunga yashirish',
  one: 'Doimiy yashirish',
  rule: "Bu turdagi barcha savollarni o'chirish",
} as const

export function DismissModal({ finding: x, mode, onClose, onDone }: {
  finding: Finding; mode: keyof typeof DISMISS_TITLE; onClose: () => void; onDone: () => void
}) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit() {
    setBusy(true)
    try {
      await ekoApi.post('/insights/dismiss', {
        fingerprint: x.fingerprint, scope: mode === 'rule' ? 'rule' : 'one', days: mode === 'one30' ? 30 : null, reason,
      })
      toast.success('Yashirildi. "Yashirilgan" bo\'limidan qaytarish mumkin.')
      onDone()
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setBusy(false) }
  }
  return (
    <Modal
      onClose={onClose}
      title={DISMISS_TITLE[mode]}
      hint={x.title}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
        <Button variant={mode === 'rule' ? 'danger' : 'primary'} loading={busy} disabled={reason.trim().length < 3} onClick={submit}>Yashirish</Button>
      </>}
    >
      <div className="space-y-4">
        {mode === 'rule' && (
          <Banner tone="warn">Bu turdagi savollar korxonangiz uchun boshqa ko'rsatilmaydi (yangilari ham). Keyin "Yashirilgan" bo'limidan qaytarish mumkin.</Banner>
        )}
        <Field label="Sabab" required hint="Masalan: ta'tilda, shartnoma bo'yicha chegirma, eski yozuv">
          <Textarea rows={3} value={reason} onChange={e => setReason(e.target.value)} maxLength={300} />
        </Field>
      </div>
    </Modal>
  )
}

interface Assignee { id: string; fullName: string; role: string; districtIds: string[]; botLinked: boolean }

export function AssignModal({ finding: x, onClose, onDone }: { finding: Finding; onClose: () => void; onDone: () => void }) {
  const [assigneeId, setAssigneeId] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const q = useQuery<Assignee[]>({
    queryKey: ['eko', 'insights', 'assignees'],
    queryFn: async () => (await ekoApi.get('/insights/assignees')).data.data,
    staleTime: 60_000,
  })
  const list = (q.data ?? []).filter(u => !x.districtId || u.districtIds.includes(x.districtId))

  async function submit() {
    setBusy(true)
    try {
      const r = await ekoApi.post('/insights/tasks', { fingerprint: x.fingerprint, assigneeId, note: note || undefined })
      toast.success(r.data.data.notified ? 'Topshirildi, Telegram orqali xabar berildi' : 'Topshirildi (xodim botga ulanmagan — xabar bormadi)')
      onDone()
    } catch (e) {
      toast.error(errMsg(e))
    } finally { setBusy(false) }
  }

  return (
    <Modal
      onClose={onClose}
      title="Xodimga topshirish"
      hint={x.title}
      footer={<>
        <Button variant="ghost" onClick={onClose}>Bekor qilish</Button>
        <Button variant="primary" loading={busy} disabled={!assigneeId} onClick={submit}>Topshirish</Button>
      </>}
    >
      <div className="space-y-4">
        <Field label="Kimga" required hint={x.districtName ? `${x.districtName} tumaniga biriktirilgan xodimlar` : undefined}
          error={q.isError ? errMsg(q.error) : !q.isLoading && list.length === 0 ? 'Bu tumanga biriktirilgan xodim yo\'q' : null}>
          <Select value={assigneeId} onChange={e => setAssigneeId(e.target.value)}>
            <option value="">— tanlang —</option>
            {list.map(u => (
              <option key={u.id} value={u.id}>
                {u.fullName} ({u.role === 'supervisor' ? 'boshliq' : 'inspektor'}){u.botLinked ? '' : ' — botga ulanmagan'}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Izoh (ixtiyoriy)">
          <Textarea rows={2} value={note} onChange={e => setNote(e.target.value)} maxLength={500} />
        </Field>
        <p className="eko-text-xs text-eko-muted">Javob muddati — 3 kun. Savol yo'qolsa (ma'lumot kiritilsa), robot natijani o'zi tekshiradi.</p>
      </div>
    </Modal>
  )
}
