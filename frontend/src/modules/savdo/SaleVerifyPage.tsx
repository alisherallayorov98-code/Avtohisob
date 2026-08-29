import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { CheckCircle2, XCircle, Loader2, ShoppingCart, AlertTriangle } from 'lucide-react'
import './ui/tokens.css'

// Hisob-fakturadagi QR kod shu sahifaga olib keladi. OCHIQ sahifa — kirish
// talab qilinmaydi, shuning uchun `savdoApi` (token qo'shuvchi) o'rniga toza
// axios. Server shaxsiy ma'lumot bermaydi: xaridor nomi maskalangan keladi.
const baseURL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  .replace(/\/api$/, '') + '/api/savdo'

interface VerifyResult {
  valid: boolean
  documentNumber?: string
  totalAmount?: number
  itemCount?: number
  issuedAt?: string
  cancelled?: boolean
  customerMasked?: string
}

const fmt = (n: number) => Math.round(n).toLocaleString('uz-UZ')

function fmtDate(iso?: string): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (isNaN(d.getTime())) return '—'
  return d.toLocaleDateString('uz-UZ', { year: 'numeric', month: '2-digit', day: '2-digit' })
}

export default function SaleVerifyPage() {
  const { number } = useParams<{ number: string }>()
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!number) return
    axios.get(`${baseURL}/sales/verify/${encodeURIComponent(number)}`)
      .then(res => setResult(res.data.data))
      .catch(e => setError(e.response?.data?.error || 'Tekshirishda xato'))
      .finally(() => setLoading(false))
  }, [number])

  return (
    <div className="savdo-app savdo-scope min-h-screen flex items-center justify-center p-4" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-5">
          <div className="w-9 h-9 bg-amber-600 rounded-xl flex items-center justify-center">
            <ShoppingCart className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-800 leading-tight">Savdo</p>
            <p className="text-xs text-gray-500">Hisob-fakturani tekshirish</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-7 h-7 text-amber-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <XCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600">{error}</p>
            </div>
          ) : result?.valid ? (
            <>
              {result.cancelled && (
                <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-center">
                  <AlertTriangle className="w-8 h-8 text-red-600 mx-auto mb-2" />
                  <p className="font-bold text-red-700">Bu hisob-faktura BEKOR QILINGAN</p>
                  <p className="text-xs text-red-600 mt-1">
                    Hujjat kuchini yo'qotgan — to'lov yoki tovar topshirish uchun asos bo'lmaydi.
                  </p>
                </div>
              )}

              <div className="text-center mb-5">
                {result.cancelled ? (
                  <XCircle className="w-12 h-12 text-red-500 mx-auto mb-2" />
                ) : (
                  <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
                )}
                <p className="font-bold text-gray-800">
                  {result.cancelled ? 'Hujjat mavjud, lekin bekor qilingan' : 'Hisob-faktura haqiqiy'}
                </p>
                <p className="text-xs text-gray-500 mt-0.5">{result.documentNumber}</p>
              </div>

              <div className={`rounded-xl p-4 text-center mb-4 ${result.cancelled ? 'bg-gray-50' : 'bg-amber-50'}`}>
                <p className={`text-2xl font-bold ${result.cancelled ? 'text-gray-500 line-through' : 'text-amber-700'}`}>
                  {fmt(result.totalAmount ?? 0)} so'm
                </p>
                <p className={`text-xs mt-0.5 ${result.cancelled ? 'text-gray-400' : 'text-amber-600'}`}>
                  {result.itemCount ?? 0} ta mahsulot qatori
                </p>
              </div>

              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Xaridor</dt>
                  <dd className="font-medium text-gray-800">{result.customerMasked}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Berilgan sana</dt>
                  <dd className="font-medium text-gray-800">{fmtDate(result.issuedAt)}</dd>
                </div>
              </dl>

              <p className="text-[11px] text-gray-400 mt-4 text-center">
                Maxfiylik uchun xaridor nomi qisqartirilgan holda ko'rsatiladi.
              </p>
            </>
          ) : (
            <div className="text-center py-4">
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
              <p className="font-bold text-gray-800">Bunday hisob-faktura topilmadi</p>
              <p className="text-sm text-gray-500 mt-1">
                Raqamni tekshiring yoki sotuvchi tashkilotga murojaat qiling.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
