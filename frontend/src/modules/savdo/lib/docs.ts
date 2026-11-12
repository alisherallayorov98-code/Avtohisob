import toast from 'react-hot-toast'
import savdoApi from './savdoApi'

// Chop etish sahifalari va Excel fayllar token talab qiladi, shuning uchun to'g'ridan-to'g'ri
// havola emas, so'rov axios orqali yuboriladi va natija yangi oynada / fayl sifatida ochiladi.

/** Server qaytargan A4 HTML'ni yangi oynada ochadi (u yerda Ctrl+P / "PDF saqlash"). */
export async function openPrint(path: string, params?: Record<string, any>): Promise<void> {
  const win = window.open('', '_blank')
  try {
    const res = await savdoApi.get(path, { params, responseType: 'text', transformResponse: [d => d] })
    if (!win) { toast.error('Brauzer oynani blokladi — ruxsat bering'); return }
    win.document.open(); win.document.write(res.data); win.document.close()
  } catch (err: any) {
    win?.close()
    toast.error(err?.response?.status === 404 ? 'Hujjat topilmadi' : 'Chop etish sahifasini ochib bo\'lmadi')
  }
}

export async function downloadFile(path: string, filename: string, params?: Record<string, any>): Promise<void> {
  try {
    const res = await savdoApi.get(path, { params, responseType: 'blob' })
    const url = window.URL.createObjectURL(new Blob([res.data]))
    const a = document.createElement('a')
    a.href = url; a.download = filename; a.click()
    window.URL.revokeObjectURL(url)
  } catch {
    toast.error('Faylni yuklab bo\'lmadi')
  }
}

export const fmtMoney = (n: number | string | null | undefined): string =>
  Math.round(Number(n ?? 0)).toLocaleString('ru-RU')

export const fmtQty = (n: number | string | null | undefined): string =>
  Number(n ?? 0).toLocaleString('ru-RU', { maximumFractionDigits: 3 })
