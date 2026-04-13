import { useState } from 'react'
import { FileDown, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { apiBaseUrl } from '../../lib/api'

interface Props {
  endpoint: string          // e.g. '/exports/spare-parts'
  filename?: string         // fallback filename
  label?: string
  params?: Record<string, string | undefined>
  className?: string
  size?: 'sm' | 'md'
}

export default function ExcelExportButton({
  endpoint,
  filename = 'export.xlsx',
  label = 'Excel',
  params,
  className = '',
  size = 'md',
}: Props) {
  const [loading, setLoading] = useState(false)
  // Always read from localStorage — axios interceptor updates localStorage on
  // token refresh but does NOT update the Zustand store, so useAuthStore()
  // would return a stale expired token after a silent refresh.
  const getToken = () => localStorage.getItem('accessToken')

  async function handleExport() {
    setLoading(true)
    try {
      const url = new URL(`${apiBaseUrl}/api${endpoint}`)
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          if (v) url.searchParams.set(k, v)
        })
      }

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${getToken()}` },
      })

      if (!res.ok) {
        let msg = 'Yuklab olishda xatolik'
        try {
          const body = await res.json()
          if (body?.error) msg = body.error
        } catch {}
        toast.error(msg, { duration: 6000 })
        return
      }

      // Extract filename from Content-Disposition header if present
      // Prefer RFC 5987 filename* (supports UTF-8) over plain filename
      const disposition = res.headers.get('Content-Disposition')
      const rfc5987 = disposition?.match(/filename\*=UTF-8''([^\s;]+)/i)
      const plain   = disposition?.match(/filename="([^"]+)"/)
      const dlName  = rfc5987 ? decodeURIComponent(rfc5987[1]) : plain?.[1] || filename

      const blob = await res.blob()
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = blobUrl
      a.download = dlName
      document.body.appendChild(a)
      a.click()
      a.remove()
      URL.revokeObjectURL(blobUrl)
      toast.success('Excel yuklab olindi')
    } catch {
      toast.error('Tarmoq xatosi')
    } finally {
      setLoading(false)
    }
  }

  const sizeClass = size === 'sm'
    ? 'px-2.5 py-1.5 text-xs gap-1'
    : 'px-3.5 py-2 text-sm gap-1.5'

  return (
    <button
      onClick={handleExport}
      disabled={loading}
      className={`inline-flex items-center rounded-lg font-medium transition-all
        bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800
        text-white shadow-sm disabled:opacity-60 disabled:cursor-not-allowed
        ${sizeClass} ${className}`}
    >
      {loading
        ? <Loader2 className={size === 'sm' ? 'w-3.5 h-3.5 animate-spin' : 'w-4 h-4 animate-spin'} />
        : <FileDown className={size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'} />
      }
      {label}
    </button>
  )
}
