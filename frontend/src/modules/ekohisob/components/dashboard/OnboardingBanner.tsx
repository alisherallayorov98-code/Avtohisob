import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { CheckCircle2, Circle, ChevronDown, ChevronUp } from 'lucide-react'
import ekoApi from '../../lib/ekoApi'
import { ekoKeys } from '../../lib/queries'
import { Banner, Button, Card, cx } from '../../ui'

interface Onboarding { districts: number; mahallas: number; inspectors: number; entities: number }
interface UserLite { botLink?: { linkedAt?: string | null } | null }

const HIDE_KEY = 'eko_onboarding_hidden'

function readHidden(): boolean {
  try { return localStorage.getItem(HIDE_KEY) === '1' } catch { return false }
}

/**
 * Sozlash ro'yxati (admin). Bo'sh bazada ochiq, aks holda ixcham bir qatorli banner.
 * Telegram, aloqa raqami alohida so'rovlardan; "birinchi to'lov" — bu oyda to'lov bor-yo'qligidan.
 */
export default function OnboardingBanner({ paidAny }: { paidAny: boolean }) {
  const navigate = useNavigate()
  const [hidden, setHidden] = useState(readHidden)
  const [open, setOpen] = useState<boolean | null>(null)

  const onb = useQuery<Onboarding>({
    queryKey: [...ekoKeys.dashboard, 'onboarding'],
    queryFn: async () => (await ekoApi.get('/dashboard/onboarding')).data.data,
    staleTime: 60_000,
  })
  const users = useQuery<UserLite[]>({
    queryKey: [...ekoKeys.users, 'bot-linked'],
    queryFn: async () => (await ekoApi.get('/users')).data.data ?? [],
    staleTime: 60_000,
  })
  const settings = useQuery<{ contactPhone: string | null }>({
    queryKey: [...ekoKeys.settings, 'contact'],
    queryFn: async () => (await ekoApi.get('/settings')).data.data,
    staleTime: 60_000,
  })

  if (hidden || !onb.data) return null
  const d = onb.data
  const botDone = (users.data ?? []).some(u => !!u.botLink?.linkedAt)
  const steps = [
    { label: "Tuman qo'shing", done: d.districts > 0, to: '/ekohisob/admin/districts' },
    { label: "Mahalla qo'shing", done: d.mahallas > 0, to: '/ekohisob/admin/districts' },
    { label: "Inspektor qo'shing", done: d.inspectors > 0, to: '/ekohisob/admin/users' },
    { label: 'Telegram botni ulang', done: botDone, to: '/ekohisob/admin/users' },
    { label: 'Tashkilotlarni kiriting yoki Excel import qiling', done: d.entities > 0, to: '/ekohisob/entities/import' },
    { label: 'SMS uchun aloqa raqamini kiriting', done: !!settings.data?.contactPhone, to: '/ekohisob/settings' },
    { label: "Birinchi to'lovni yozing", done: paidAny, to: '/ekohisob/entities' },
  ]
  const doneCount = steps.filter(s => s.done).length
  if (doneCount === steps.length) return null

  const isOpen = open ?? d.entities === 0
  function hide() {
    try { localStorage.setItem(HIDE_KEY, '1') } catch { /* private rejim */ }
    setHidden(true)
  }

  return (
    <div>
      <Banner
        tone="info"
        action={
          <div className="flex items-center gap-1">
            <Button
              variant="ghost" size="sm"
              icon={isOpen ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              onClick={() => setOpen(!isOpen)}
            >
              {isOpen ? "Yig'ish" : 'Qadamlar'}
            </Button>
            <Button variant="ghost" size="sm" onClick={hide}>Yashirish</Button>
          </div>
        }
      >
        Sozlash: {steps.length} qadamdan {doneCount} tasi bajarilgan.
      </Banner>
      {isOpen && (
        <Card flush className="mt-2">
          <ul>
            {steps.map(s => (
              <li key={s.label} className="flex items-center gap-3 px-4 py-2.5 border-b border-eko-line last:border-b-0">
                {s.done
                  ? <CheckCircle2 className="w-4 h-4 text-eko-success shrink-0" aria-label="Bajarilgan" />
                  : <Circle className="w-4 h-4 text-eko-subtle shrink-0" aria-label="Bajarilmagan" />}
                <span className={cx('flex-1 eko-text-base', s.done ? 'text-eko-muted line-through' : 'text-eko-text')}>{s.label}</span>
                {!s.done && <Button variant="ghost" size="sm" onClick={() => navigate(s.to)}>Ochish</Button>}
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  )
}
