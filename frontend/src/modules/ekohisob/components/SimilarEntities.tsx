import { useEffect, useState } from 'react'
import ekoApi from '../lib/ekoApi'
import { Banner, Button } from '../ui'

interface Match {
  id: string
  name: string
  status?: string | null
  reasons: Array<'phone' | 'nearby' | 'name'>
  distanceM?: number
}

const REASON: Record<Match['reasons'][number], string> = {
  phone: 'telefon raqami bir xil',
  nearby: 'yaqin joyda, nomi o‘xshash',
  name: 'shu tumanda xuddi shunday nom',
}

/**
 * Takror bo'lishi mumkin bo'lgan mavjud tashkilotlarni ko'rsatadi (STIR'siz — jismoniy shaxslar uchun
 * asosiy himoya). Faqat ogohlantirish: bloklamaydi, chunki bir telefonda ikkita haqiqiy tashkilot bo'lishi mumkin.
 */
export default function SimilarEntities({
  name, phone, lat, lon, districtId, excludeId, onOpen,
}: {
  name: string
  phone?: string
  lat?: number | null
  lon?: number | null
  districtId?: string
  excludeId?: string
  onOpen?: (id: string) => void
}) {
  const [matches, setMatches] = useState<Match[]>([])

  useEffect(() => {
    const enough = name.trim().length >= 3 || (phone ?? '').replace(/\D/g, '').length >= 9
    if (!enough) { setMatches([]); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const res = await ekoApi.post('/entities/similar', { name, phone, lat, lon, districtId, excludeId })
        if (!cancelled) setMatches(res.data.data ?? [])
      } catch { if (!cancelled) setMatches([]) }
    }, 600)
    return () => { cancelled = true; clearTimeout(t) }
  }, [name, phone, lat, lon, districtId, excludeId])

  if (matches.length === 0) return null

  return (
    <Banner tone="warn">
      <p className="font-medium mb-1.5">Shunga o‘xshash tashkilot allaqachon bor — takror kiritmayapsizmi?</p>
      <ul className="space-y-1.5">
        {matches.map(m => (
          <li key={m.id} className="flex items-center justify-between gap-3">
            <span className="min-w-0 text-sm">
              <b className="break-words">{m.name}</b>
              <span className="block text-xs opacity-80">
                {m.reasons.map(r => REASON[r]).join(', ')}{m.distanceM != null ? ` (${m.distanceM} m)` : ''}
              </span>
            </span>
            {onOpen && <Button size="sm" onClick={() => onOpen(m.id)}>Ochish</Button>}
          </li>
        ))}
      </ul>
    </Banner>
  )
}
