import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import { deepLatToCyrl } from './latToCyrl'

import uzMessages from '../i18n/locales/uz.json'
import ruMessages from '../i18n/locales/ru.json'

/**
 * i18n konfiguratsiyasi.
 *
 * Tarjima fayllari src/i18n/locales/ ichida JSON sifatida saqlanadi:
 *   - uz.json — O'zbek lotin (asosiy manba)
 *   - ru.json — rus
 *   - uz-cyrl avtomatik generate'iladi (deepLatToCyrl orqali)
 *
 * Yangi key qo'shish: avval uz.json'ga qo'shing, keyin ru.json'ga tarjima qiling.
 * Krill versiyasi avtomatik chiqadi — qo'shimcha ish kerak emas.
 */

const uz = { translation: uzMessages }
const ru = { translation: ruMessages }
// Krill: lotin manbasidan rekursiv transliteratsiya
const uzCyrl = { translation: deepLatToCyrl(uzMessages) }

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { uz, 'uz-cyrl': uzCyrl, ru },
    fallbackLng: 'uz',
    lng: localStorage.getItem('i18nextLng') || 'uz',
    interpolation: { escapeValue: false },
    detection: { order: ['localStorage', 'navigator'], caches: ['localStorage'] },
  })

// Til o'zgarganda backend'ga ham xabar beramiz, shunda Telegram, Excel
// eksport va serverda generatsiya qilinadigan kontent bir xil tilda chiqadi.
// Initial load'da emas — faqat user qo'lda o'zgartirganda yuboriladi.
let isInitialLoad = true
i18n.on('languageChanged', (lng: string) => {
  if (isInitialLoad) {
    isInitialLoad = false
    return  // Boshlanish (saqlanganni yuklash) — backend bilan boshqa hodisada sinx qilinadi
  }
  const token = localStorage.getItem('accessToken')
  if (!token) return  // Login qilinmagan
  // Fetch ishlatamiz axios o'rniga (circular import oldini olish)
  fetch('/api/auth/me/language', {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ language: lng }),
  }).catch(() => { /* tarmoq xatosi — keyingi galchi sinxronlashadi */ })
})

export default i18n
