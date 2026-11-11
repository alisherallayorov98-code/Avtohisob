import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy, Send, CheckCircle2, Clock } from 'lucide-react'
import toast from 'react-hot-toast'
import ekoApi from '../../lib/ekoApi'
import { errMsg } from '../../lib/ekoErrors'
import { ekoKeys } from '../../lib/queries'
import { Banner, Button, LinkButton, Modal, Skeleton, f } from '../../ui'
import type { EkoUserRow } from './userTypes'

interface LinkToken { token: string; expiresAt: string; userName: string; deepLink?: string | null; botUsername?: string | null }
interface LinkStatus {
  linked: boolean
  pendingToken: string | null
  hasPendingToken: boolean
  pendingExpiresAt: string | null
  tgUsername: string | null
  linkedAt: string | null
}

async function copy(text: string, ok: string) {
  try { await navigator.clipboard.writeText(text); toast.success(ok) }
  catch { toast.error("Nusxa olib bo'lmadi. Matnni qo'lda belgilab nusxalang.") }
}

/**
 * Telegram botni ulash. Token to'liq holda FAQAT yaratilgan javobda keladi —
 * bu oynada bir marta ko'rsatiladi; keyin faqat maskalangan holat. Oyna ochiq
 * paytida ulanish holati har 5 soniyada tekshiriladi.
 */
export default function BotLinkModal({ user, onClose }: { user: EkoUserRow; onClose: () => void }) {
  const qc = useQueryClient()
  const [token, setToken] = useState<LinkToken | null>(null)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const status = useQuery<LinkStatus>({
    queryKey: ['eko', 'bot-link-status', user.id],
    queryFn: async () => (await ekoApi.get(`/bot/link-status/${user.id}`)).data.data,
    refetchInterval: 5000,
  })
  const linked = !!status.data?.linked

  // Ulanish sodir bo'lsa jadvaldagi holat ham yangilansin
  useEffect(() => {
    if (linked) qc.invalidateQueries({ queryKey: ekoKeys.users })
  }, [linked, qc])

  async function create() {
    setCreating(true); setError(null)
    try {
      const res = await ekoApi.post('/bot/link-token', { userId: user.id })
      setToken(res.data.data ?? res.data)
      status.refetch()
    } catch (e) {
      setError(errMsg(e))
    } finally { setCreating(false) }
  }

  const s = status.data

  return (
    <Modal
      open
      onClose={onClose}
      size="sm"
      title="Telegram botni ulash"
      hint={user.fullName}
      footer={<Button variant="secondary" onClick={onClose}>Yopish</Button>}
    >
      <div className="p-5 space-y-4">
        {error && <Banner tone="danger">{error}</Banner>}

        {/* Joriy holat */}
        <div aria-live="polite">
          {status.isLoading ? (
            <Skeleton className="h-5 w-2/3" />
          ) : linked ? (
            <Banner tone="success" icon={<CheckCircle2 className="w-4 h-4" />}>
              Ulangan{s?.tgUsername ? ` — @${s.tgUsername}` : ''}{s?.linkedAt ? ` · ${f.date(s.linkedAt)}` : ''}
            </Banner>
          ) : s?.hasPendingToken ? (
            <Banner tone="info" icon={<Clock className="w-4 h-4" />}>
              Ulanish kutilmoqda{s.pendingToken ? ` (token ${s.pendingToken})` : ''}
              {s.pendingExpiresAt ? `, ${f.dateTime(s.pendingExpiresAt)} gacha` : ''}. Holat avtomatik yangilanadi.
            </Banner>
          ) : status.isError ? (
            <Banner tone="warn">Ulanish holatini olib bo'lmadi: {errMsg(status.error)}</Banner>
          ) : (
            <p className="eko-text-base text-eko-text-2">Telegram ulanmagan.</p>
          )}
        </div>

        {token ? (
          <div className="space-y-3">
            <Banner tone="warn">
              Token faqat <b>hozir</b> ko'rsatiladi — oynani yopsangiz qayta ko'rib bo'lmaydi (yangisini yaratish mumkin).
              Amal qilish muddati — 48 soat.
            </Banner>
            {token.deepLink ? (
              <>
                <p className="eko-text-base text-eko-text-2">
                  Havolani xodimga yuboring: u bosib <b>«Start»</b> tugmasini bossa, bot ulanadi.
                </p>
                <LinkButton href={token.deepLink} target="_blank" rel="noopener noreferrer" variant="primary" block icon={<Send className="w-4 h-4" aria-hidden />}>
                  Telegram'da ochish
                </LinkButton>
                <Button variant="secondary" block icon={<Copy className="w-4 h-4" aria-hidden />} onClick={() => copy(token.deepLink!, 'Havola nusxalandi')}>
                  Havolani nusxalash
                </Button>
              </>
            ) : (
              <>
                <p className="eko-text-base text-eko-text-2">Botga quyidagi buyruqni yuboring:</p>
                <p className="font-mono text-[18px] font-semibold tracking-widest text-center border border-eko-line rounded-eko py-3 select-all">
                  /start {token.token}
                </p>
                <Button variant="secondary" block icon={<Copy className="w-4 h-4" aria-hidden />} onClick={() => copy(`/start ${token.token}`, 'Buyruq nusxalandi')}>
                  Buyruqni nusxalash
                </Button>
              </>
            )}
            <p className="eko-text-xs text-eko-muted">Muddat: {f.dateTime(token.expiresAt)} · bir marta ishlatiladi</p>
          </div>
        ) : (
          !linked && (
            <Button variant="primary" block loading={creating} onClick={create}>
              {s?.hasPendingToken ? 'Yangi token yaratish' : 'Ulash tokenini yaratish'}
            </Button>
          )
        )}
      </div>
    </Modal>
  )
}
