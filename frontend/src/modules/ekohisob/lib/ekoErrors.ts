/**
 * EkoHisob — xato matnlari YAGONA manbasi.
 *
 * Ilgari har sahifada "Xato", "Xato yuz berdi", "districtId talab qilinadi" kabi
 * aralash matnlar ko'rsatilardi. Endi:
 *   1. backend kodi (`code`) bo'yicha aniq o'zbekcha ko'rsatma,
 *   2. aks holda backend yuborgan `error` matni,
 *   3. tarmoq xatosi ("Aloqa yo'q") va vaqt tugashi alohida,
 *   4. oxirida umumiy "Bajarilmadi. Qayta urinib ko'ring".
 * Toast va Banner'lar faqat shu funksiyadan foydalanadi.
 */

const CODE_MESSAGES: Record<string, string> = {
  // Kirish
  ACCOUNT_LOCKED: "Hisob vaqtincha qulflangan. 15 daqiqadan keyin urinib ko'ring.",
  MUST_CHANGE_PASSWORD: "Avval parolni almashtiring.",
  SESSION_REVOKED: "Sessiya tugagan. Qaytadan kiring.",
  // To'lov
  DUPLICATE_PAYMENT: "Xuddi shu summa yaqinda yozilgan. Takror bo'lsa tasdiqlang.",
  IDEMPOTENCY_CONFLICT: "Bu so'rov boshqa ma'lumot bilan yuborilgan. Sahifani yangilang.",
  AMOUNT_TOO_LARGE: "Summa juda katta.",
  FUTURE_MONTH: "Kelgusi oyga to'lov yozib bo'lmaydi.",
  ENTITY_INACTIVE: "Tashkilot faol emas.",
  TALON_ALREADY_PAID: "Bu talon allaqachon to'langan.",
  NO_LINKED_PAYMENT: "Talon bilan bog'langan to'lov topilmadi.",
  REASON_REQUIRED: "Sababni yozing (kamida 5 belgi).",
  FORBIDDEN: "Bu amal uchun ruxsat yo'q.",
  // Tashkilot
  DUPLICATE_STIR: "Bu STIR bilan tashkilot allaqachon bor.",
  MAHALLA_HAS_ENTITIES: "Mahallada tashkilotlar bor. Avval ularni boshqa mahallaga ko'chiring.",
  NEW_DISTRICTS_CONFIRM_REQUIRED: "Faylda yangi tumanlar bor. Ularni yaratishni tasdiqlang.",
  CONFIRM_REQUIRED: "Amalni tasdiqlash uchun kerakli matnni kiriting.",
  // KPI
  MISSING_VALUES: "Ba'zi ko'rsatkichlar kiritilmagan.",
  ADJUST_LIMIT: "Tuzatish chegarasidan oshdi.",
}

export interface EkoErrorInfo {
  message: string
  status?: number
  code?: string
  /** Server yuborgan qo'shimcha ma'lumot (masalan MISSING_VALUES ro'yxati) */
  data?: any
  network: boolean
}

export function parseEkoError(err: unknown): EkoErrorInfo {
  const e = err as any
  if (e?.code === 'ECONNABORTED') {
    return { message: "So'rov juda uzoq cho'zildi. Internetni tekshirib, qayta urinib ko'ring.", network: true }
  }
  if (e && e.isAxiosError && !e.response) {
    return { message: "Aloqa yo'q. Internetni tekshiring.", network: true }
  }
  const status: number | undefined = e?.response?.status
  const body = e?.response?.data
  const code: string | undefined = body?.code
  if (code && CODE_MESSAGES[code]) {
    return { message: CODE_MESSAGES[code], status, code, data: body?.data, network: false }
  }
  const serverMsg: unknown = body?.error ?? body?.message
  if (typeof serverMsg === 'string' && serverMsg.trim()) {
    return { message: serverMsg, status, code, data: body?.data, network: false }
  }
  if (status === 429) return { message: "Juda ko'p urinish. Birozdan keyin qayta urinib ko'ring.", status, network: false }
  if (status === 403) return { message: "Bu amal uchun ruxsat yo'q.", status, network: false }
  if (status === 404) return { message: "Topilmadi.", status, network: false }
  if (status && status >= 500) return { message: "Serverda xatolik. Birozdan keyin qayta urinib ko'ring.", status, network: false }
  return { message: "Bajarilmadi. Qayta urinib ko'ring.", status, code, network: false }
}

/** Toast/Banner uchun tayyor matn. */
export function errMsg(err: unknown): string {
  return parseEkoError(err).message
}

/**
 * Bir martalik kalit — to'lov so'rovi qayta yuborilsa/ikki marta bosilsa dublikat bo'lmasligi uchun.
 * Forma ochilganda BIR MARTA yaratiladi va aynan shu urinish uchun saqlanadi (qayta urinishda o'sha kalit).
 */
export function newIdempotencyKey(): string {
  const c: Crypto | undefined = (globalThis as any).crypto
  if (c?.randomUUID) return c.randomUUID()
  // eski brauzer zaxirasi
  return 'k' + Date.now().toString(36) + Math.random().toString(36).slice(2, 12) + Math.random().toString(36).slice(2, 12)
}
