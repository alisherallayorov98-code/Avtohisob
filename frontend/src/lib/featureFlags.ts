/**
 * Yashirin bo'lishi mumkin bo'lgan modullar/funksiyalar ro'yxati.
 *
 * "key" — DB ga saqlanadigan unique ID (org_settings.hiddenFeatures massivi)
 * "path" — sidebar'dagi route path
 * "label" — foydalanuvchiga ko'rsatish uchun nom
 * "category" — guruh
 * "hiddenByDefault" — yangi tashkilot ochilganda default yashirin
 * "polishStatus" — kelajakda mukammallashtirish darajasi (eslab qolish uchun)
 *
 * MUHIM: bu yerda faqat YASHIRISH mumkin bo'lgan modullar.
 * Asosiy oqim (Mashina, Ta'mir, Yoqilg'i, Xarajat, Hisobot) yashirilmaydi.
 */

export interface FeatureFlag {
  key: string
  path: string
  label: string
  category: 'analytics' | 'auxiliary' | 'specialized' | 'admin'
  description: string
  hiddenByDefault: boolean
  polishStatus: 'mvp' | 'usable' | 'needs-polish' | 'experimental'
}

export const FEATURE_FLAGS: FeatureFlag[] = [
  // ─── AI Tahlil — kam ishlatiladigan, kelajakda mukammallashtiriladi ─────
  {
    key: 'vehicleHealth',
    path: '/vehicle-health',
    label: 'Texnika holati (Health Score)',
    category: 'analytics',
    description: 'Mashinaning umumiy "salomatlik" balli (AI hisoblaydi)',
    hiddenByDefault: true,
    polishStatus: 'experimental',
  },
  {
    key: 'predictions',
    path: '/predictions',
    label: 'Bashoratlar',
    category: 'analytics',
    description: 'Keyingi texnik xizmat sanasini tarixga qarab bashorat qiladi',
    hiddenByDefault: true,
    polishStatus: 'usable',
  },
  {
    key: 'recommendations',
    path: '/recommendations',
    label: 'Tavsiyalar',
    category: 'analytics',
    description: 'AI har mashina uchun amaliy tavsiyalar beradi',
    hiddenByDefault: true,
    polishStatus: 'usable',
  },
  {
    key: 'anomalies',
    path: '/anomalies',
    label: 'Anomaliyalar',
    category: 'analytics',
    description: 'Yoqilg\'i va xarajatlardagi g\'ayrioddiy o\'zgarishlar',
    hiddenByDefault: true,
    polishStatus: 'usable',
  },
  {
    key: 'fleetRisk',
    path: '/fleet-risk',
    label: 'Fleet Risk',
    category: 'analytics',
    description: 'Avtopark xavf-xatari tahlili',
    hiddenByDefault: true,
    polishStatus: 'experimental',
  },
  {
    key: 'fuelAnalytics',
    path: '/fuel-analytics',
    label: "Yoqilg'i tahlili",
    category: 'analytics',
    description: "Chuqur yoqilg'i tahlili va grafiklar",
    hiddenByDefault: true,
    polishStatus: 'usable',
  },
  {
    key: 'fuelMeter',
    path: '/fuel-meter',
    label: "Yoqilg'i hisoblagich (AI)",
    category: 'analytics',
    description: "Yoqilg'i o'lchagich rasmidan AI bilan miqdorni o'qiydi",
    hiddenByDefault: true,
    polishStatus: 'experimental',
  },

  // ─── Yordamchi modullar — niche use ────────────────────────────────────
  {
    key: 'tireTracking',
    path: '/tire-tracking',
    label: 'Shina nazorati',
    category: 'auxiliary',
    description: 'Shinalar bo\'yicha alohida nazorat (Shinalar bilan o\'xshash)',
    hiddenByDefault: true,
    polishStatus: 'needs-polish',
  },
  {
    key: 'serviceIntervals',
    path: '/oil-change',
    label: "Yog' almashish (Profilaktika)",
    category: 'auxiliary',
    description: 'Yog\' almashish va texnik xizmat intervallari',
    hiddenByDefault: true,
    polishStatus: 'usable',
  },
  {
    key: 'warranties',
    path: '/warranties',
    label: 'Kafolatlar',
    category: 'auxiliary',
    description: 'Ehtiyot qism kafolatlari',
    hiddenByDefault: true,
    polishStatus: 'needs-polish',
  },
  {
    key: 'drivers',
    path: '/drivers',
    label: 'Haydovchilar tahlili',
    category: 'auxiliary',
    description: 'Haydovchi statistikasi va KPI',
    hiddenByDefault: true,
    polishStatus: 'experimental',
  },
  {
    key: 'budget',
    path: '/budget',
    label: 'Byudjet',
    category: 'auxiliary',
    description: 'Yillik byudjet rejalashtirish',
    hiddenByDefault: true,
    polishStatus: 'mvp',
  },
  {
    key: 'techInspections',
    path: '/inspections',
    label: 'Oylik texosmotr',
    category: 'auxiliary',
    description: 'Mashinalarning oylik texnik tekshiruvi',
    hiddenByDefault: true,
    polishStatus: 'usable',
  },

  // ─── Maxsus modullar ──────────────────────────────────────────────────
  {
    key: 'tozaHudud',
    path: '/toza-hudud',
    label: 'Toza-Hudud (chiqindi yig\'ish)',
    category: 'specialized',
    description: 'Chiqindi yig\'ish kompaniyalari uchun maxsus modul (MFY, GPS, konteynerlar)',
    hiddenByDefault: false, // Asosiy ishlatiladigan modul (default ko'rinadi)
    polishStatus: 'usable',
  },
  {
    key: 'gps',
    path: '/gps',
    label: 'GPS sozlamalari',
    category: 'specialized',
    description: 'GPS ulanish sozlamalari (SmartGPS/Wialon)',
    hiddenByDefault: true,
    polishStatus: 'usable',
  },

  {
    key: 'engineMonitor',
    path: '/engine-monitor',
    label: 'Dvigatel nazorati',
    category: 'auxiliary',
    description: "Yog' sarfi trendi va ta'mirlash tarixi asosida dvigatel holati tahlili",
    hiddenByDefault: true,
    polishStatus: 'usable',
  },

  // ─── Admin niche ──────────────────────────────────────────────────────
  {
    key: 'import',
    path: '/import',
    label: 'Import (Excel yuklash)',
    category: 'admin',
    description: 'Mavjud ma\'lumotlarni Excel orqali ommaviy yuklash',
    hiddenByDefault: true,
    polishStatus: 'usable',
  },
]

export const FEATURE_FLAGS_BY_KEY: Record<string, FeatureFlag> = Object.fromEntries(
  FEATURE_FLAGS.map(f => [f.key, f])
)

/** Path → key mapping (sidebar filter uchun) */
export const PATH_TO_FEATURE_KEY: Record<string, string> = Object.fromEntries(
  FEATURE_FLAGS.map(f => [f.path, f.key])
)

/** Default yashirin keylar ro'yxati */
export const DEFAULT_HIDDEN_KEYS = FEATURE_FLAGS.filter(f => f.hiddenByDefault).map(f => f.key)
