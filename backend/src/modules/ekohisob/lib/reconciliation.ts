// EkoHisob akt sverka (solishtirma dalolatnoma) — sof mantiq, DB'siz, testlanadi.
//
// Akt sverka — ikki tomon o'rtasidagi hisob-kitobni tasdiqlovchi rasmiy hujjat:
// davr boshidagi qoldiq, davr ichidagi barcha hisoblar va to'lovlar xronologik
// tartibda, har qatordan keyingi yugurib boruvchi saldo, davr oxiridagi qoldiq.
//
// Mavjud `EntityLedgerModal` oylar tasmasini beradi, lekin unda saldo yo'q va
// ixtiyoriy davr tanlab bo'lmaydi — mijoz bilan hisob-kitobni solishtirishda
// aynan shu ikkisi kerak.

export type DocKind = 'charge' | 'payment' | 'talon'

export interface ReconRow {
  /** "YYYY-MM-DD" */
  date: string
  kind: DocKind
  /** Hujjat raqami — kvitansiya nomeri yoki hisob oyi */
  doc: string | null
  description: string
  /** Hisoblandi (tashkilot bizga qarzdor bo'ldi) */
  debit: number
  /** To'landi */
  credit: number
  /** Shu qatordan keyingi saldo (musbat = tashkilot qarzdor) */
  balance: number
}

export interface ChargeDoc { month: string; expectedAmount: number | string }
export interface PaymentDoc {
  paidAt: Date | string
  amount: number | string
  month?: string | null
  receiptNumber?: string | null
  note?: string | null
}
export interface TalonDoc {
  date: Date | string
  amount: number | string
  volume?: number | string | null
  note?: string | null
}

export interface ReconInput {
  /** "YYYY-MM-DD". null/bo'sh = eng birinchi hujjatdan */
  from?: string | null
  /** "YYYY-MM-DD". null/bo'sh = bugungacha */
  to?: string | null
  billingMode?: string
  charges?: ChargeDoc[]
  payments?: PaymentDoc[]
  talons?: TalonDoc[]
}

export interface ReconResult {
  /**
   * 'full' — hisoblangan summa bor (monthly_fixed, talon): saldo ma'noga ega.
   * 'payments_only' — o'zgaruvchan rejim: oldindan hisoblanadigan summa yo'q,
   * faqat qabul qilingan to'lovlar keltiriladi va saldo ko'rsatilmaydi.
   */
  mode: 'full' | 'payments_only'
  openingBalance: number
  rows: ReconRow[]
  totals: { debit: number; credit: number }
  closingBalance: number
  /** Haqiqiy davr chegaralari (hujjatlar bo'yicha aniqlangan) */
  periodFrom: string | null
  periodTo: string | null
}

const n = (v: number | string | null | undefined): number => Math.round(Number(v) || 0)

/** Date | "YYYY-MM-DD" → "YYYY-MM-DD" (UTC). Yaroqsiz bo'lsa null. */
function toDay(v: Date | string | null | undefined): string | null {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  if (Number.isNaN(d.getTime())) return null
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

// Bir kunda bir necha hujjat bo'lsa tartib: avval hisoblandi, keyin to'landi.
// Aks holda "to'lov hisobdan oldin" ko'rinib, saldo mantiqsiz sakraydi.
const KIND_ORDER: Record<DocKind, number> = { charge: 0, talon: 1, payment: 2 }

interface RawDoc {
  date: string
  kind: DocKind
  doc: string | null
  description: string
  debit: number
  credit: number
}

/** Barcha hujjatlarni bitta xronologik ro'yxatga yig'adi. */
function collectDocs(input: ReconInput): RawDoc[] {
  const docs: RawDoc[] = []

  for (const c of input.charges ?? []) {
    if (!/^\d{4}-\d{2}$/.test(String(c.month))) continue
    const amount = n(c.expectedAmount)
    if (amount === 0) continue
    docs.push({
      date: `${c.month}-01`,
      kind: 'charge',
      doc: c.month,
      description: 'Oylik xizmat haqi hisoblandi',
      debit: amount,
      credit: 0,
    })
  }

  for (const t of input.talons ?? []) {
    const day = toDay(t.date)
    if (!day) continue
    const amount = n(t.amount)
    if (amount === 0) continue
    const vol = t.volume != null ? Number(t.volume) : null
    docs.push({
      date: day,
      kind: 'talon',
      doc: null,
      description: vol
        ? `Chiqindi olib chiqildi — ${vol} m³${t.note ? ` (${t.note})` : ''}`
        : `Bajarilgan ish${t.note ? ` — ${t.note}` : ''}`,
      debit: amount,
      credit: 0,
    })
  }

  for (const p of input.payments ?? []) {
    const day = toDay(p.paidAt)
    if (!day) continue
    const amount = n(p.amount)
    if (amount === 0) continue
    docs.push({
      date: day,
      kind: 'payment',
      doc: p.receiptNumber ?? null,
      description: p.month
        ? `To'lov qabul qilindi (${p.month})`
        : "To'lov qabul qilindi",
      debit: 0,
      credit: amount,
    })
  }

  docs.sort((a, b) =>
    a.date === b.date
      ? KIND_ORDER[a.kind] - KIND_ORDER[b.kind]
      : a.date < b.date ? -1 : 1)

  return docs
}

/**
 * Akt sverkani quradi.
 *
 * Saldo qoidasi: musbat = tashkilot bizga qarzdor, manfiy = ortiqcha to'lagan (avans).
 * Ortiqcha to'lov ATAYLAB nolga qirqilmaydi — mijoz avansini ko'rishi kerak.
 */
export function buildReconciliation(input: ReconInput): ReconResult {
  const mode: ReconResult['mode'] = input.billingMode === 'variable' ? 'payments_only' : 'full'
  const docs = collectDocs(input)

  const from = input.from && /^\d{4}-\d{2}-\d{2}$/.test(input.from) ? input.from : null
  const to = input.to && /^\d{4}-\d{2}-\d{2}$/.test(input.to) ? input.to : null

  // Davr boshigacha bo'lgan hujjatlardan boshlang'ich qoldiq
  let openingBalance = 0
  for (const d of docs) {
    if (from && d.date < from) openingBalance += d.debit - d.credit
  }

  const inPeriod = docs.filter(d =>
    (!from || d.date >= from) && (!to || d.date <= to))

  let balance = openingBalance
  let debitTotal = 0
  let creditTotal = 0
  const rows: ReconRow[] = inPeriod.map(d => {
    balance += d.debit - d.credit
    debitTotal += d.debit
    creditTotal += d.credit
    return { ...d, balance }
  })

  return {
    mode,
    openingBalance,
    rows,
    totals: { debit: debitTotal, credit: creditTotal },
    closingBalance: balance,
    periodFrom: from ?? (inPeriod[0]?.date ?? null),
    periodTo: to ?? (inPeriod[inPeriod.length - 1]?.date ?? null),
  }
}

/**
 * Summani so'z bilan — rasmiy hujjatda talab qilinadi.
 * Faqat butun so'm (tiyin ishlatilmaydi).
 */
export function amountInWords(value: number): string {
  const ones = ['', 'bir', 'ikki', 'uch', "to'rt", 'besh', 'olti', 'yetti', 'sakkiz', "to'qqiz"]
  const tens = ['', "o'n", 'yigirma', "o'ttiz", 'qirq', 'ellik', 'oltmish', 'yetmish', 'sakson', "to'qson"]

  function under1000(x: number): string {
    const parts: string[] = []
    const h = Math.floor(x / 100)
    if (h > 0) parts.push(`${ones[h]} yuz`)
    const t = Math.floor((x % 100) / 10)
    if (t > 0) parts.push(tens[t])
    const o = x % 10
    if (o > 0) parts.push(ones[o])
    return parts.join(' ')
  }

  const negative = value < 0
  let v = Math.abs(Math.round(value))
  if (v === 0) return 'nol'

  const groups: [number, string][] = [
    [1_000_000_000, 'milliard'], [1_000_000, 'million'], [1000, 'ming'],
  ]
  const out: string[] = []
  for (const [base, label] of groups) {
    const q = Math.floor(v / base)
    if (q > 0) { out.push(`${under1000(q)} ${label}`); v %= base }
  }
  if (v > 0) out.push(under1000(v))

  const text = out.join(' ').replace(/\s+/g, ' ').trim()
  return negative ? `minus ${text}` : text
}
