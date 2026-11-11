import toast from 'react-hot-toast'
import { useQueryClient } from '@tanstack/react-query'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { invalidateEko } from '../../lib/queries'
import { useConfirm, f } from '../../ui'

export interface CancelablePayment {
  id: string
  month: string
  amount: number
  receiptNumber?: string | null
}

/**
 * To'lovni bekor qilish (faqat admin). Sabab MAJBURIY (>= 5 belgi) — backend
 * butun guruhni bekor qiladi, kvitansiya o'chirilmaydi (storno).
 * Qaytaradi: bekor qilindimi (`true`) yoki yo'q.
 */
export function useCancelPayment(onDone?: () => void) {
  const confirm = useConfirm()
  const qc = useQueryClient()

  return async (p: CancelablePayment): Promise<boolean> => {
    const r = await confirm.ask({
      title: "To'lovni bekor qilish",
      message: (
        <>
          <b>{f.money(p.amount)}</b> ({f.monthLabel(p.month)}) to'lovi bekor qilinadi.
          {p.receiptNumber ? <> Kvitansiya: <b>{p.receiptNumber}</b>.</> : null}
        </>
      ),
      danger: true,
      consequences: [
        "Qarz qaytadi: shu summa yana to'lanmagan bo'ladi",
        "Kvitansiya yaroqsiz bo'ladi (o'chirilmaydi, \"bekor qilingan\" deb qoladi)",
        "Bir necha oyga taqsimlangan bo'lsa, butun to'lov bekor qilinadi",
        'Amal jurnalga yoziladi',
      ],
      confirmLabel: "To'lovni bekor qilish",
      cancelLabel: 'Ortga',
      reasonRequired: true,
      reasonMinLength: 5,
      reasonLabel: 'Bekor qilish sababi',
      reasonPlaceholder: "Masalan: noto'g'ri tashkilotga yozilgan",
    })
    if (!r.confirmed) return false
    try {
      await ekoApi.delete(`/payments/${p.id}`, { data: { reason: r.reason } })
      toast.success("To'lov bekor qilindi")
      invalidateEko(qc, 'payment')
      onDone?.()
      return true
    } catch (err) {
      toast.error(errMsg(err))
      return false
    }
  }
}
