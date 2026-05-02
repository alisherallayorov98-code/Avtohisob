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

export default i18n
