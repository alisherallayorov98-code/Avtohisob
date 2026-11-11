import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { ekoKeys } from '../../lib/queries'
import { Banner, Button, Modal } from '../../ui'
import { DistrictChecks } from './UserFormModal'
import type { EkoUserRow } from './userTypes'

export default function UserDistrictsModal({
  user, districts, onClose,
}: { user: EkoUserRow; districts: { id: string; name: string }[]; onClose: () => void }) {
  const qc = useQueryClient()
  const [ids, setIds] = useState<string[]>(user.districtIds)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setSaving(true); setError(null)
    try {
      await ekoApi.put(`/users/${user.id}/districts`, { districtIds: ids })
      toast.success('Tumanlar yangilandi')
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
      size="sm"
      title="Tumanlarni belgilash"
      hint={user.fullName}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Bekor qilish</Button>
          <Button variant="primary" className="flex-1" loading={saving} onClick={save}>Saqlash</Button>
        </>
      }
    >
      <div className="p-5 space-y-3">
        {error && <Banner tone="danger">{error}</Banner>}
        {ids.length === 0 && user.role !== 'admin' && (
          <Banner tone="warn">Tuman biriktirilmasa, xodim hech qanday tashkilotni ko'rmaydi.</Banner>
        )}
        <DistrictChecks districts={districts} value={ids} onChange={setIds} />
      </div>
    </Modal>
  )
}
