import { useState } from 'react'
import { Loader2 } from 'lucide-react'

export const MIN_REASON = 5

interface Props {
  title: string
  description?: string
  confirmLabel: string
  danger?: boolean
  onConfirm: (reason: string) => Promise<void> | void
  onClose: () => void
}

// Tahrirlash/bekor qilish SABABI majburiy (kamida 5 belgi): audit jurnaliga yoziladi va keyin o'qib bilish mumkin.
export default function ReasonDialog({ title, description, confirmLabel, danger, onConfirm, onClose }: Props) {
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const ok = reason.trim().length >= MIN_REASON

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ok) return
    setBusy(true)
    try { await onConfirm(reason.trim()) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={submit} onClick={e => e.stopPropagation()} className="bg-white rounded-xl shadow-xl w-full max-w-md p-5 space-y-3">
        <h2 className="font-semibold text-gray-800">{title}</h2>
        {description && <p className="text-sm text-gray-500">{description}</p>}
        <div>
          <label className="block text-xs font-medium text-gray-600 mb-1">Sabab (majburiy)</label>
          <textarea autoFocus rows={3} value={reason} onChange={e => setReason(e.target.value)}
            placeholder="Nima sababdan o'zgartirilyapti? Masalan: invoysdagi narx noto'g'ri kiritilgan edi"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-amber-600" />
          <p className={`text-[11px] mt-1 ${ok ? 'text-gray-400' : 'text-red-500'}`}>
            {ok ? 'Bu sabab audit jurnaliga yoziladi' : `Kamida ${MIN_REASON} belgi yozing`}
          </p>
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm rounded-lg border border-gray-300 text-gray-600 hover:bg-gray-50">Yopish</button>
          <button type="submit" disabled={!ok || busy}
            className={`px-4 py-2 text-sm rounded-lg text-white font-medium disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-700' : 'bg-amber-700 hover:bg-amber-800'}`}>
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : confirmLabel}
          </button>
        </div>
      </form>
    </div>
  )
}
