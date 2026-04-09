import { useState } from 'react'
import { Search, ChevronDown, ChevronUp, BookOpen, Wrench, Fuel, BarChart3, Package, Settings, MessageSquare, ExternalLink } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Button from '../components/ui/Button'

const FAQ_CATEGORIES = [
  {
    id: 'getting-started',
    label: 'Boshlash',
    icon: <BookOpen className="w-5 h-5" />,
    color: 'blue',
    items: [
      { q: 'Avtomobil qanday qo\'shiladi?', a: 'Avtomobillar sahifasiga o\'ting → "Yangi avtomobil" tugmasini bosing → Ro\'yxatdan raqam, model, yil va boshqa ma\'lumotlarni kiriting → Saqlang.' },
      { q: 'Foydalanuvchi qanday qo\'shiladi?', a: 'Sozlamalar → Foydalanuvchilar → "Qo\'shish" tugmasini bosing → Email va rol tanlang → Tasdiqlovchi xat yuboriladi.' },
      { q: 'Filial qanday yaratiladi?', a: 'Filiallar sahifasiga o\'ting → "Yangi filial" tugmasini bosing → Nom, joylashuv va menejer ma\'lumotlarini kiriting.' },
      { q: 'Boshlang\'ich parolni qanday o\'zgartiriladi?', a: 'Profilga kiring → "Parolni o\'zgartirish" bo\'limini toping → Eski va yangi parolni kiriting → Saqlang.' },
    ]
  },
  {
    id: 'fuel',
    label: 'Yoqilg\'i',
    icon: <Fuel className="w-5 h-5" />,
    color: 'green',
    items: [
      { q: 'Yoqilg\'i qanday qayd qilinadi?', a: 'Yoqilg\'i sahifasiga o\'ting → "Kirim" tugmasini bosing → Avtomobil, miqdor, narx va odometr ko\'rsatkichini kiriting → Saqlang.' },
      { q: 'AI Hisoblagich qanday ishlaydi?', a: 'AI Hisoblagich sahifasiga o\'ting → Rasm yuklang → AI yoqilg\'i miqdorini rasmdan o\'qib oladi → Natijani tasdiqlang.' },
      { q: 'Yoqilg\'i anomaliyasi nima?', a: 'O\'rtacha sarfdan 20% dan ortiq og\'ish anomaliya hisoblanadi. Anomaliyalar sahifasida batafsil ko\'rishingiz mumkin.' },
      { q: 'Yoqilg\'i hisobotini qanday eksport qilish mumkin?', a: 'Hisobotlar → Yoqilg\'i → Excel tugmasini bosing — fayl yuklab olinadi.' },
    ]
  },
  {
    id: 'maintenance',
    label: 'Ta\'mirlash',
    icon: <Wrench className="w-5 h-5" />,
    color: 'yellow',
    items: [
      { q: 'Ta\'mirlash yozuvi qanday qo\'shiladi?', a: 'Texnik xizmat sahifasiga o\'ting → "Yangi yozuv" tugmasini bosing → Avtomobil, ehtiyot qism, usta va narxni kiriting.' },
      { q: 'Ehtiyot qism artikul kodi qanday yaratiladi?', a: 'Ehtiyot qismlar sahifasiga o\'ting → "Yangi qism" tugmasini bosing → Saqlanganda artikul kodi avtomatik yaratiladi. Qo\'lda yozishga hojat yo\'q.' },
      { q: 'Bashoratlar qanday ishlaydi?', a: 'AI so\'nggi texnik xizmat tarixiga qarab keyingi xizmat sanasini bashorat qiladi. Bashoratlar sahifasida ko\'rishingiz mumkin.' },
      { q: 'Avtoshina holatini qanday yangilash mumkin?', a: 'Avtoshinalar sahifasida shinani toping → "Yangilash" tugmasini bosing → Joriy protektor qalinligini kiriting.' },
    ]
  },
  {
    id: 'reports',
    label: 'Hisobotlar',
    icon: <BarChart3 className="w-5 h-5" />,
    color: 'purple',
    items: [
      { q: 'Hisobot qanday yaratiladi?', a: 'Hisobotlar sahifasiga o\'ting → Kerakli bo\'limni tanlang → Sana oralig\'ini kiriting → Ma\'lumotlar avtomatik ko\'rinadi.' },
      { q: 'Mashina bo\'yicha hisobot nima?', a: '"Mashina bo\'yicha" tabiga o\'ting → Avtomobilni tanlang → Barcha ehtiyot qismlar, xizmatlar, yoqilg\'i va xarajatlar ko\'rinadi.' },
      { q: 'Excel eksport qanday ishlaydi?', a: '"Excel yuklab olish" tugmasini bosing — 4 varaqli fayl (Umumiy, Ehtiyot qismlar, Ustalar, Yoqilg\'i) yuklab olinadi.' },
      { q: 'Hisobotni saqlash mumkinmi?', a: 'Ha, "Saqlash" tugmasini bosing → Nom bering → Saqlangan hisobotlar tabida topishingiz mumkin.' },
    ]
  },
  {
    id: 'inventory',
    label: 'Ombor',
    icon: <Package className="w-5 h-5" />,
    color: 'orange',
    items: [
      { q: 'Omborga mahsulot qanday kiritiladi?', a: 'Ombor sahifasiga o\'ting → "Kirim" tugmasini bosing → Ehtiyot qismni qidiring → Miqdor va minimal daraja kiriting.' },
      { q: 'Kam qolgan mahsulotlar haqida qanday xabardor bo\'laman?', a: 'Ombor sahifasida qizil ogohlantirishlar ko\'rinadi. Dashboard da ham "Kam qolgan" ko\'rsatkich bor.' },
      { q: 'O\'tkazma qanday amalga oshiriladi?', a: 'O\'tkazmalar sahifasiga o\'ting → "Yangi o\'tkazma" tugmasini bosing → Filiallar va mahsulotni tanlang → Menejer tasdiqlaydi.' },
    ]
  },
  {
    id: 'account',
    label: 'Hisob',
    icon: <Settings className="w-5 h-5" />,
    color: 'gray',
    items: [
      { q: 'Obunani qanday o\'zgartirish mumkin?', a: 'Obuna va To\'lov sahifasiga o\'ting → Kerakli rejani tanlang → Tasdiqlang.' },
      { q: '2FA (ikki bosqichli himoya) qanday yoqiladi?', a: 'Sozlamalar → Xavfsizlik tabiga o\'ting → "2FA sozlamalari" → QR kodni skanerlang → Tasdiqlash kodini kiriting.' },
      { q: 'Email tasdiqlash qanday amalga oshiriladi?', a: 'Sozlamalar → Xavfsizlik → "Email tasdiqlash" tugmasini bosing → Emailingizga yuborilgan havolani bosing.' },
      { q: 'Parolni unutdim, nima qilishim kerak?', a: 'Login sahifasida "Parolni unutdingizmi?" havolasini bosing → Emailingizni kiriting → Yangilash havolasi yuboriladi.' },
    ]
  },
]

const QUICK_LINKS = [
  { label: 'Avtomobillar', path: '/vehicles', icon: '🚗' },
  { label: 'Yoqilg\'i', path: '/fuel', icon: '⛽' },
  { label: 'Texnik xizmat', path: '/maintenance', icon: '🔧' },
  { label: 'Hisobotlar', path: '/reports', icon: '📊' },
  { label: 'Ombor', path: '/inventory', icon: '📦' },
  { label: 'Avtoshinalar', path: '/tires', icon: '🔘' },
]

export default function HelpCenter() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')
  const [openItems, setOpenItems] = useState<Record<string, boolean>>({})
  const [activeCategory, setActiveCategory] = useState('getting-started')

  const toggleItem = (key: string) => setOpenItems(prev => ({ ...prev, [key]: !prev[key] }))

  const filteredFAQs = search.trim()
    ? FAQ_CATEGORIES.flatMap(cat =>
        cat.items
          .filter(item => item.q.toLowerCase().includes(search.toLowerCase()) || item.a.toLowerCase().includes(search.toLowerCase()))
          .map(item => ({ ...item, category: cat.label }))
      )
    : null

  const activeCategory_ = FAQ_CATEGORIES.find(c => c.id === activeCategory)

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Yordam Markazi</h1>
        <p className="text-gray-500 text-sm">Savollaringizga javob toping</p>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Savol yoki kalit so'z bilan qidiring..."
          className="w-full pl-12 pr-4 py-3 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-white rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500 shadow-sm" />
      </div>

      {/* Search results */}
      {search.trim() && filteredFAQs && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500">{filteredFAQs.length} ta natija topildi</p>
          {filteredFAQs.length === 0 ? (
            <div className="text-center py-10 text-gray-400">
              <BookOpen className="w-10 h-10 mx-auto mb-2 opacity-40" />
              <p>Hech narsa topilmadi</p>
              <p className="text-sm mt-1">Support ticket yarating — yordam beramiz</p>
            </div>
          ) : (
            filteredFAQs.map((item, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => toggleItem(`search-${i}`)} className="w-full flex items-center justify-between p-4 text-left">
                  <div>
                    <span className="text-xs text-blue-500 mb-1 block">{item.category}</span>
                    <span className="font-medium text-gray-900 dark:text-white">{item.q}</span>
                  </div>
                  {openItems[`search-${i}`] ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" /> : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                </button>
                {openItems[`search-${i}`] && (
                  <div className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-700 pt-3">{item.a}</div>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Normal view */}
      {!search.trim() && (
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-5">
          {/* Category sidebar */}
          <div className="space-y-1">
            {FAQ_CATEGORIES.map(cat => (
              <button key={cat.id} onClick={() => setActiveCategory(cat.id)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${activeCategory === cat.id ? 'bg-blue-600 text-white' : 'text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'}`}>
                {cat.icon}{cat.label}
              </button>
            ))}
            <div className="pt-3">
              <Button size="sm" variant="outline" icon={<MessageSquare className="w-4 h-4" />}
                onClick={() => navigate('/support')} className="w-full">
                Ticket yaratish
              </Button>
            </div>
          </div>

          {/* FAQ list */}
          <div className="lg:col-span-3 space-y-2">
            <h3 className="font-semibold text-gray-800 dark:text-white mb-3 flex items-center gap-2">
              {activeCategory_?.icon} {activeCategory_?.label}
            </h3>
            {activeCategory_?.items.map((item, i) => (
              <div key={i} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-xl overflow-hidden">
                <button onClick={() => toggleItem(`${activeCategory}-${i}`)}
                  className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
                  <span className="font-medium text-gray-900 dark:text-white pr-4">{item.q}</span>
                  {openItems[`${activeCategory}-${i}`]
                    ? <ChevronUp className="w-4 h-4 text-gray-400 flex-shrink-0" />
                    : <ChevronDown className="w-4 h-4 text-gray-400 flex-shrink-0" />}
                </button>
                {openItems[`${activeCategory}-${i}`] && (
                  <div className="px-4 pb-4 text-sm text-gray-600 dark:text-gray-300 border-t border-gray-100 dark:border-gray-700 pt-3 leading-relaxed">{item.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Quick links */}
      {!search.trim() && (
        <div className="bg-blue-50 dark:bg-blue-900/20 rounded-xl p-5">
          <h3 className="font-semibold text-gray-800 dark:text-white mb-3">Tez havolalar</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {QUICK_LINKS.map(link => (
              <button key={link.path} onClick={() => navigate(link.path)}
                className="flex items-center gap-2 px-3 py-2.5 bg-white dark:bg-gray-700 rounded-lg text-sm font-medium text-gray-700 dark:text-gray-200 hover:shadow-sm transition-shadow text-left">
                <span>{link.icon}</span>{link.label}
                <ExternalLink className="w-3 h-3 text-gray-400 ml-auto" />
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Contact */}
      <div className="bg-gray-50 dark:bg-gray-800 rounded-xl p-5 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div>
          <h3 className="font-semibold text-gray-800 dark:text-white">Savol topilmadimi?</h3>
          <p className="text-sm text-gray-500 mt-0.5">Support jamoamiz 24/7 yordam berishga tayyor</p>
        </div>
        <Button icon={<MessageSquare className="w-4 h-4" />} onClick={() => navigate('/support')}>
          Support bilan bog'lanish
        </Button>
      </div>
    </div>
  )
}
