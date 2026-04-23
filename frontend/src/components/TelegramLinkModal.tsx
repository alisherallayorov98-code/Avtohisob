import { useState } from 'react'
import { useQuery, useMutation } from '@tanstack/react-query'
import { Send, Copy, CheckCircle, ExternalLink, Loader2, X, Smartphone } from 'lucide-react'
import toast from 'react-hot-toast'
import api from '../lib/api'
import Modal from './ui/Modal'
import Button from './ui/Button'

interface Props {
  open: boolean
  onClose: () => void
}

export default function TelegramLinkModal({ open, onClose }: Props) {
  const [token, setToken] = useState<{ deepLink: string; expiresAt: string } | null>(null)
  const [copied, setCopied] = useState(false)

  const { data: links, refetch } = useQuery({
    queryKey: ['my-telegram-links'],
    queryFn: () => api.get('/telegram/links').then(r => r.data.data),
    enabled: open,
  })

  const createMutation = useMutation({
    mutationFn: () => api.post('/telegram/link-token').then(r => r.data.data),
    onSuccess: (data) => setToken(data),
    onError: (e: any) => toast.error(e.response?.data?.error || 'Link yaratilmadi'),
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/telegram/links/${id}`),
    onSuccess: () => { toast.success('Ajratildi'); refetch() },
    onError: (e: any) => toast.error(e.response?.data?.error || 'Xato'),
  })

  const handleCopy = async (text: string) => {
    await navigator.clipboard.writeText(text)
    setCopied(true)
    toast.success('Nusxalandi')
    setTimeout(() => setCopied(false), 2000)
  }

  const linkedDevices: any[] = links || []
  const isLinked = linkedDevices.length > 0

  return (
    <Modal open={open} onClose={onClose} title="Telegram ulash" size="sm">
      <div className="space-y-4">
        <div className="flex items-start gap-3 p-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700">
          <Send className="w-5 h-5 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-700 dark:text-blue-300">
            Telegram ga ulasangiz, ta'mirlash tasdiqlanganda, rad etilganda yoki boshqa muhim hodisalarda
            darhol xabar olasiz.
          </p>
        </div>

        {/* Ulangan qurilmalar */}
        {linkedDevices.length > 0 && (
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
              Ulangan qurilmalar
            </p>
            <div className="space-y-2">
              {linkedDevices.map((d: any) => (
                <div key={d.id} className="flex items-center justify-between p-2.5 rounded-lg border border-green-200 dark:border-green-700 bg-green-50 dark:bg-green-900/10">
                  <div className="flex items-center gap-2">
                    <CheckCircle className="w-4 h-4 text-green-600 dark:text-green-400 shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-gray-800 dark:text-gray-200">
                        {d.deviceLabel || 'Telegram qurilma'}
                      </p>
                      <p className="text-xs text-gray-400">
                        {new Date(d.linkedAt).toLocaleDateString('uz-UZ')}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={() => deleteMutation.mutate(d.id)}
                    disabled={deleteMutation.isPending}
                    className="p-1 text-gray-400 hover:text-red-500 rounded transition-colors"
                    title="Ajratish"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Link yaratish */}
        {!token ? (
          <Button
            className="w-full gap-2"
            variant={isLinked ? 'outline' : 'primary'}
            onClick={() => createMutation.mutate()}
            disabled={createMutation.isPending}
          >
            {createMutation.isPending
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Yaratilmoqda...</>
              : <><Smartphone className="w-4 h-4" /> {isLinked ? 'Yangi qurilma ulash' : 'Telegram ulash'}</>
            }
          </Button>
        ) : (
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
              Ulash havolasi (10 daqiqa amal qiladi)
            </p>

            {/* Deep link */}
            <div className="flex gap-2">
              <a
                href={token.deepLink}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 flex items-center gap-2 px-3 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
              >
                <Send className="w-4 h-4 shrink-0" />
                <span className="truncate">Telegram da ochish</span>
                <ExternalLink className="w-3.5 h-3.5 shrink-0 ml-auto" />
              </a>
              <button
                onClick={() => handleCopy(token.deepLink)}
                className="px-3 py-2.5 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                title="Nusxalash"
              >
                {copied ? <CheckCircle className="w-4 h-4 text-green-500" /> : <Copy className="w-4 h-4 text-gray-500" />}
              </button>
            </div>

            <ol className="text-xs text-gray-500 dark:text-gray-400 space-y-1 pl-4 list-decimal">
              <li>Yuqoridagi tugmani bosib Telegram ga o'ting</li>
              <li>Telegram da <b className="text-gray-700 dark:text-gray-300">START</b> tugmasini bosing</li>
              <li>Bot "Ulanish muvaffaqiyatli!" desa tayyor</li>
            </ol>

            <button
              onClick={() => { setToken(null); refetch() }}
              className="w-full text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 py-1"
            >
              Ulash tugadimi? Yangilash
            </button>
          </div>
        )}
      </div>
    </Modal>
  )
}
