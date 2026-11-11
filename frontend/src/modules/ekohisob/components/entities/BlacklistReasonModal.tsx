import { useState } from 'react'
import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { invalidateEko } from '../../lib/queries'
import { Banner, Button, Field, Modal, Textarea } from '../../ui'

/** Qora ro'yxatga qo'shish: sabab majburiy. Backend faqat o'z tumanini ruxsat qiladi. */
export default function BlacklistReasonModal({
  entity, onClose, onDone,
}: { entity: { id: string; name: string }; onClose: () => void; onDone: () => void }) {
  const qc = useQueryClient()
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ok = reason.trim().length >= 3

  async function submit() {
    if (!ok || saving) return
    setSaving(true)
    setError(null)
    try {
      await ekoApi.post('/blacklist', { entityId: entity.id, reason: reason.trim() })
      toast.success("Qora ro'yxatga qo'shildi")
      invalidateEko(qc, 'entity')
      onDone()
    } catch (err) {
      setError(errMsg(err))
    } finally { setSaving(false) }
  }

  return (
    <Modal
      onClose={onClose}
      size="sm"
      title="Qora ro'yxatga qo'shish"
      footer={
        <>
          <Button className="flex-1" onClick={onClose}>Bekor qilish</Button>
          <Button variant="danger" className="flex-1" loading={saving} disabled={!ok} onClick={submit}>
            Qo'shish
          </Button>
        </>
      }
    >
      <div className="p-5 space-y-4">
        <p className="eko-text-base text-eko-text-2">
          <b className="text-eko-text">{entity.name}</b> qora ro'yxatga qo'shiladi. Bu tashkilotga to'lov yozilmaydi.
        </p>
        <Field label="Sabab" required hint="Kamida 3 belgi">
          {id => <Textarea id={id} rows={3} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Masalan: shartnomadan bosh tortdi" />}
        </Field>
        {error && <Banner tone="danger">{error}</Banner>}
      </div>
    </Modal>
  )
}
