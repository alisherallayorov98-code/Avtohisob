// Tashkilot ma'lumotlari to'liqligi — pure hisob.
//
// Nega: bot orqali "chala" (draft) kiritilgan tashkilotni saytda to'ldirish kerak.
// Kartochkada qaysi maydonlar yetishmayotgani va tashkilotni faollashtirish uchun
// nima majburiy ekani shu yerdan olinadi (backend ham, frontend ham — bitta manba).

export interface CompletenessInput {
  name?: string | null
  address?: string | null
  districtId?: string | null
  mahallId?: string | null
  stir?: string | null
  phone?: string | null
  contactName?: string | null
  contractNumber?: string | null
  lat?: number | null
  lon?: number | null
  billingMode?: string | null
  monthlyFee?: number | null
  cubicPrice?: number | null
}

export interface MissingField {
  key: string
  label: string
}

export interface Completeness {
  /** 0..100 */
  percent: number
  /** Faollashtirish uchun majburiy, lekin yo'q maydonlar */
  missingRequired: MissingField[]
  /** Tavsiya etiladigan, lekin yo'q maydonlar */
  missingOptional: MissingField[]
  /** Majburiylar to'liq — tashkilotni 'active' qilish mumkin */
  isReady: boolean
}

const filled = (v: unknown): boolean => typeof v === 'string' ? v.trim().length > 0 : v != null
const positive = (v: unknown): boolean => typeof v === 'number' && v > 0

export function computeCompleteness(e: CompletenessInput): Completeness {
  const isTalon = e.billingMode === 'talon'

  const required: Array<MissingField & { ok: boolean }> = [
    { key: 'name', label: 'Nomi', ok: filled(e.name) },
    { key: 'address', label: 'Manzil', ok: filled(e.address) },
    { key: 'districtId', label: 'Tuman', ok: filled(e.districtId) },
    isTalon
      ? { key: 'cubicPrice', label: 'Bir kub narxi', ok: positive(e.cubicPrice) }
      : { key: 'monthlyFee', label: "Oylik to'lov", ok: positive(e.monthlyFee) },
  ]
  const optional: Array<MissingField & { ok: boolean }> = [
    { key: 'location', label: 'Xarita joylashuvi', ok: e.lat != null && e.lon != null },
    { key: 'mahallId', label: 'Mahalla', ok: filled(e.mahallId) },
    { key: 'stir', label: 'STIR', ok: filled(e.stir) },
    { key: 'phone', label: 'Telefon', ok: filled(e.phone) },
    { key: 'contactName', label: "Mas'ul shaxs", ok: filled(e.contactName) },
    { key: 'contractNumber', label: 'Shartnoma raqami', ok: filled(e.contractNumber) },
  ]

  const all = [...required, ...optional]
  const okCount = all.filter(f => f.ok).length
  const missingRequired = required.filter(f => !f.ok).map(({ key, label }) => ({ key, label }))
  const missingOptional = optional.filter(f => !f.ok).map(({ key, label }) => ({ key, label }))

  return {
    percent: Math.round((okCount / all.length) * 100),
    missingRequired,
    missingOptional,
    isReady: missingRequired.length === 0,
  }
}
