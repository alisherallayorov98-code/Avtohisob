import { cx } from './cx'

const UZ_MONTHS = [
  'Yanvar', 'Fevral', 'Mart', 'Aprel', 'May', 'Iyun',
  'Iyul', 'Avgust', 'Sentabr', 'Oktabr', 'Noyabr', 'Dekabr',
]

/**
 * Oy tanlagich — ikkita ro'yxat (oy + yil), qiymati "YYYY-MM".
 *
 * Nega native `<input type="month">` emas:
 *  - Firefox va Safari uni qo'llab-quvvatlamaydi va oddiy matn maydoni
 *    sifatida ko'rsatadi — foydalanuvchi xom "2026-07" ni ko'radi;
 *  - Chrome ko'rsatadi, lekin brauzer tiliga qarab ("July 2026" / "07.2026"),
 *    ya'ni ko'rinish foydalanuvchidan foydalanuvchiga farq qiladi.
 * Bu yerda esa hamma joyda bir xil: "Iyul" + "2026".
 */
export function MonthInput({
  value, onChange, className, disabled, yearsBack = 5, yearsForward = 1,
}: {
  /** "YYYY-MM" */
  value: string
  onChange: (v: string) => void
  className?: string
  disabled?: boolean
  yearsBack?: number
  yearsForward?: number
}) {
  const now = new Date()
  const [yRaw, mRaw] = (value || '').split('-')
  const year = parseInt(yRaw, 10) || now.getFullYear()
  const month = parseInt(mRaw, 10) || now.getMonth() + 1

  const thisYear = now.getFullYear()
  const years: number[] = []
  for (let y = thisYear + yearsForward; y >= thisYear - yearsBack; y--) years.push(y)
  // Tanlangan yil oraliqdan tashqarida bo'lsa (eski yozuv) — ro'yxatga qo'shamiz
  if (!years.includes(year)) years.push(year)

  const emit = (y: number, m: number) => onChange(`${y}-${String(m).padStart(2, '0')}`)

  const sel = 'h-10 px-2 rounded-eko border border-eko-line bg-eko-surface text-sm ' +
    'text-eko-text hover:border-eko-line-strong focus:border-eko-accent ' +
    'disabled:bg-eko-surface-2 disabled:text-eko-muted cursor-pointer'

  return (
    <div className={cx('flex items-center gap-1.5', className)}>
      <select
        aria-label="Oy"
        value={month}
        disabled={disabled}
        onChange={e => emit(year, parseInt(e.target.value, 10))}
        className={cx(sel, 'min-w-[104px]')}
      >
        {UZ_MONTHS.map((label, i) => (
          <option key={label} value={i + 1}>{label}</option>
        ))}
      </select>
      <select
        aria-label="Yil"
        value={year}
        disabled={disabled}
        onChange={e => emit(parseInt(e.target.value, 10), month)}
        className={cx(sel, 'min-w-[80px]')}
      >
        {years.sort((a, b) => b - a).map(y => (
          <option key={y} value={y}>{y}</option>
        ))}
      </select>
    </div>
  )
}
