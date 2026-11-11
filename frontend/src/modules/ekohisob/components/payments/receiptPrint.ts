import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'

/**
 * Kvitansiyani yangi oynada ochadi (A5, chop etishga tayyor). Sahifa
 * autentifikatsiya talab qiladi, shuning uchun HTML token bilan olinib
 * blob sifatida ochiladi.
 */
export async function openReceiptPrint(receiptId: string): Promise<void> {
  try {
    const res = await ekoApi.get(`/receipts/${receiptId}/print`, { responseType: 'text' })
    const url = URL.createObjectURL(new Blob([res.data], { type: 'text/html;charset=utf-8' }))
    const w = window.open(url, '_blank')
    if (!w) toast.error("Brauzer yangi oynani blokladi — ruxsat bering")
    setTimeout(() => URL.revokeObjectURL(url), 60000)
  } catch (err) {
    toast.error(errMsg(err))
  }
}
