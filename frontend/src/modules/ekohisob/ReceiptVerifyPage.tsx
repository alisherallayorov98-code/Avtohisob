import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import axios from 'axios'
import { CheckCircle2, XCircle, Loader2, Leaf } from 'lucide-react'

// Kvitansiya QR kodi shu sahifaga olib keladi. OCHIQ sahifa — kirish talab
// qilinmaydi, shuning uchun `ekoApi` (token qo'shuvchi) o'rniga toza axios.
// Server shaxsiy ma'lumot bermaydi: tashkilot nomi maskalangan holda keladi.
const baseURL = (import.meta.env.VITE_API_URL || 'http://localhost:3001/api')
  .replace(/\/api$/, '') + '/api/ekohisob'

interface VerifyResult {
  valid: boolean
  receiptNumber?: string
  amount?: number
  month?: string
  monthLabel?: string
  issuedAt?: string
  entityMasked?: string
}

const fmt = (n: number) => n.toLocaleString('uz-UZ')

export default function ReceiptVerifyPage() {
  const { number } = useParams<{ number: string }>()
  const [result, setResult] = useState<VerifyResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!number) return
    axios.get(`${baseURL}/receipts/verify/${encodeURIComponent(number)}`)
      .then(res => setResult(res.data.data))
      .catch(e => setError(e.response?.data?.error || 'Tekshirishda xato'))
      .finally(() => setLoading(false))
  }, [number])

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4" style={{ fontFamily: 'Inter, sans-serif' }}>
      <div className="w-full max-w-sm">
        <div className="flex items-center justify-center gap-2 mb-5">
          <div className="w-9 h-9 bg-green-600 rounded-xl flex items-center justify-center">
            <Leaf className="w-5 h-5 text-white" />
          </div>
          <div>
            <p className="font-bold text-gray-800 leading-tight">EkoHisob</p>
            <p className="text-xs text-gray-500">Kvitansiyani tekshirish</p>
          </div>
        </div>

        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-6">
          {loading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="w-7 h-7 text-green-600 animate-spin" />
            </div>
          ) : error ? (
            <div className="text-center py-4">
              <XCircle className="w-10 h-10 text-gray-300 mx-auto mb-3" />
              <p className="text-sm text-gray-600">{error}</p>
            </div>
          ) : result?.valid ? (
            <>
              <div className="text-center mb-5">
                <CheckCircle2 className="w-12 h-12 text-green-600 mx-auto mb-2" />
                <p className="font-bold text-gray-800">Kvitansiya haqiqiy</p>
                <p className="text-xs text-gray-500 mt-0.5">{result.receiptNumber}</p>
              </div>
              <div className="bg-green-50 rounded-xl p-4 text-center mb-4">
                <p className="text-2xl font-bold text-green-700">{fmt(result.amount ?? 0)} so'm</p>
                <p className="text-xs text-green-600 mt-0.5">{result.monthLabel} uchun</p>
              </div>
              <dl className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <dt className="text-gray-500">Tashkilot</dt>
                  <dd className="font-medium text-gray-800">{result.entityMasked}</dd>
                </div>
                <div className="flex justify-between">
                  <dt className="text-gray-500">Berilgan sana</dt>
                  <dd className="font-medium text-gray-800">
                    {result.issuedAt ? new Date(result.issuedAt).toLocaleDateString('uz-UZ') : '—'}
                  </dd>
                </div>
              </dl>
              <p className="text-[11px] text-gray-400 mt-4 text-center">
                Maxfiylik uchun tashkilot nomi qisqartirilgan holda ko'rsatiladi.
              </p>
            </>
          ) : (
            <div className="text-center py-4">
              <XCircle className="w-12 h-12 text-red-500 mx-auto mb-3" />
              <p className="font-bold text-gray-800">Bunday kvitansiya topilmadi</p>
              <p className="text-sm text-gray-500 mt-1">
                Raqamni tekshiring yoki xizmat ko'rsatuvchi tashkilotga murojaat qiling.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
