import { cx } from './cx'

/** Ism → 1–2 harfli initsial. "Ali Valiyev" → "AV" */
export function initials(name: string | null | undefined): string {
  const parts = String(name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  const a = parts[0][0] ?? ''
  const b = parts.length > 1 ? parts[parts.length - 1][0] ?? '' : ''
  return (a + b).toUpperCase()
}

/** Ismdan barqaror (har safar bir xil) och ton soni 0..5 */
function hue(name: string): number {
  let h = 0
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0
  return h % 6
}

// Och neytral-iliq tonlar (to'yingan rang yo'q — chrome'da rang YO'Q qoidasi).
// Tokenlardan emas, soddalik uchun HSL — qorong'i rejimda alpha bilan moslashadi.
const TONES = [
  '210 16% 90%', '30 14% 89%', '150 12% 88%', '270 10% 90%', '190 14% 88%', '350 12% 90%',
]

export function Avatar({
  name, size = 32, className,
}: { name: string | null | undefined; size?: 24 | 28 | 32 | 40; className?: string }) {
  const n = String(name ?? '')
  return (
    <span
      aria-hidden
      className={cx(
        'inline-flex items-center justify-center rounded-full shrink-0 font-medium select-none',
        'text-eko-text-2 border border-eko-line',
        className,
      )}
      style={{
        width: size,
        height: size,
        fontSize: size <= 28 ? 12 : 13,
        backgroundColor: `hsl(${TONES[hue(n)]})`,
        color: 'hsl(215 20% 30%)',
      }}
    >
      {initials(n)}
    </span>
  )
}
