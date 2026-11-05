// Telegram mini ilova manzillari — pure (testlanadi).

/**
 * Mini ilova manzili. Avval EKO_WEBAPP_URL, bo'lmasa FRONTEND_URL/tg/ekomap (asosiy bot ham
 * FRONTEND_URL dan foydalanadi). Telegram web_app tugmasi FAQAT https:// ni qabul qiladi —
 * boshqa manzil butun klaviaturani yuborishni buzadi, shuning uchun null qaytariladi.
 */
export function ekoWebAppUrl(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.EKO_WEBAPP_URL?.trim()
  const front = env.FRONTEND_URL?.trim().replace(/\/+$/, '')
  const url = explicit || (front ? `${front}/tg/ekomap` : '')
  return /^https:\/\//i.test(url) ? url : null
}

/** Mini ilova manziliga ochiladigan tab (`?tab=`) qo'shadi; mavjud query'ni saqlaydi. */
export function webAppTabUrl(base: string, tab: 'map' | 'debtors'): string {
  try {
    const u = new URL(base)
    u.searchParams.set('tab', tab)
    return u.toString()
  } catch {
    return base
  }
}
