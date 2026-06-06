import { Link } from 'react-router-dom'
import { useState } from 'react'
import {
  Truck, Wrench, Fuel, Package, BarChart3, MapPin, Leaf, Recycle, Cpu,
  ArrowRight, Check, Menu, X, Star, AlertTriangle, Camera, Clock,
  TrendingDown, Eye, Smartphone, ShieldCheck, ChevronDown,
} from 'lucide-react'

// ── Og'riqlar — nega kerak ────────────────────────────────────────────────────
const PAINS = [
  {
    icon: Fuel, color: 'text-rose-600 bg-rose-50',
    title: 'Yoqilg\'i jimgina yo\'qolyapti',
    text: 'Haydovchi "50 litr quydim" deydi — lekin bak 35 litr. 100 km yurib 60 litr sarflaydi. Bu farq oyiga millionlab so\'m.',
    fix: 'GPS masofa bilan har litrni solishtiramiz. Mantiqsiz sarf — darrov anomaliya.',
  },
  {
    icon: Wrench, color: 'text-amber-600 bg-amber-50',
    title: 'Ta\'mirlash soxtalashtirilyapti',
    text: '"Ehtiyot qism almashtirildi" deyiladi — lekin eski qism qayerda? Bir mashinaga bir xil qism oyiga 2-3 marta yoziladi.',
    fix: 'Foto/video dalil majburiy. Takroriy qism avtomatik aniqlanadi. Eski qism qaytmasa — usta zimmasiga qarz.',
  },
  {
    icon: MapPin, color: 'text-blue-600 bg-blue-50',
    title: 'Mashina qayerdaligini bilmaysiz',
    text: 'Texnika ish joyidami yoki haydovchi o\'z ishini qilyaptimi? Telefon qilib so\'rashga to\'g\'ri keladi.',
    fix: 'Jonli xaritada har texnika qayerda — real vaqtda. Marshrut, tezlik, to\'xtashlar — hammasi ko\'rinadi.',
  },
  {
    icon: BarChart3, color: 'text-purple-600 bg-purple-50',
    title: 'Pul qayerga ketishini bilmaysiz',
    text: 'Daftarlar, Excel fayllar, cheklар — yo\'qoladi, chalkashadi. Qaysi mashina ko\'p yeydi — noma\'lum.',
    fix: 'Har xarajat bir tizimda. Mashina bo\'yicha, oy bo\'yicha — grafik va Excel hisobot bir bosishda.',
  },
]

// ── Modullar — har biri batafsil ──────────────────────────────────────────────
const MODULES = [
  {
    icon: Wrench, color: 'green',
    title: 'Ta\'mirlash nazorati',
    what: 'Har ta\'mirlash — qaysi qism, qancha turdi, kim qildi, qancha usta haqi.',
    detail: 'Foto va video dalil majburiy. Tizim bir mashinaga bir xil qism takror yozilsa ogohlantiradi. Eski qism qaytarilmasa — usta zimmasiga qarz yoziladi. Dalolatnoma va usta haqi varaqasini bir bosishda chiqarasiz.',
    result: 'Soxta ta\'mirlash va ehtiyot qism o\'g\'irligi to\'xtaydi.',
  },
  {
    icon: Fuel, color: 'cyan',
    title: 'Yoqilg\'i monitoringi',
    what: 'Har quyilgan yoqilg\'i GPS bosib o\'tilgan masofa bilan solishtiriladi.',
    detail: 'Mantiqsiz sarf (100 km yurib 60 litr) — avtomatik anomaliya. Kalonka chekini rasmga olsangiz, AI o\'qib kiritadi (OCR — qo\'lda yozish shart emas). Har mashinaning km/litr samaradorligi ko\'rinadi.',
    result: 'Yoqilg\'i o\'g\'irligi aniqlanadi — oyiga millionlab so\'m tejaladi.',
  },
  {
    icon: Package, color: 'amber',
    title: 'Ombor va inventarizatsiya',
    what: 'Ehtiyot qism qoldig\'i, kirim-chiqim, narx — real vaqtda.',
    detail: 'Inventarizatsiya rejimi: haqiqiy sanagan sonni kiritasiz, tizim kamomad/ortiqchani avtomatik hisoblaydi va akt chiqaradi. Kam qolgan qismlar ogohlantiriladi. Sklad bo\'yicha qoldiq qaydnomasi Excel\'da.',
    result: 'Kamomad va o\'g\'irlik aniqlanadi, qism tugab qolmaydi.',
  },
  {
    icon: Cpu, color: 'purple',
    title: 'AI tahlil',
    what: 'Sun\'iy intellekt ma\'lumotlaringizni tahlil qilib, shubhali holatlarni topadi.',
    detail: 'Anomaliya aniqlash (g\'ayrioddiy sarf, takroriy ta\'mirlash, bir usta bir mashinada ko\'p marta). Kelajakdagi ta\'mirlash prognozi. Kalonka cheki OCR. Tejash bo\'yicha avtomatik tavsiyalar.',
    result: 'Inson sezmaydigan firibgarlik va isrofni mashina topadi.',
  },
  {
    icon: MapPin, color: 'rose',
    title: 'Jonli GPS xarita',
    what: 'Butun texnikangiz xaritada — real vaqtda, bir ekranda.',
    detail: 'Wialon yoki SmartGPS qurilmalaringiz ulanadi. Marshrut tarixi, tezlik, to\'xtash joylari. Klaster xarita — 100 ta mashina ham tartibli ko\'rinadi. Geozona — belgilangan hududdan chiqsa xabar.',
    result: 'Ofisdan turib har texnika nima qilayotganini bilasiz.',
  },
  {
    icon: Clock, color: 'blue',
    title: 'Ish vaqti nazorati',
    what: 'Kim ishni qachon boshladi, qachon tugatdi — GPS asosida.',
    detail: 'Har mashina ertalab nechida harakatlandi, kechqurun nechida to\'xtadi — avtomatik yoziladi. Kim kech keldi, kim erta ketdi — hisobot. Belgilangan davr uchun yig\'ma jadval va Excel eksport.',
    result: 'Mehnat intizomi nazorat ostida — ish vaqti behuda ketmaydi.',
  },
]

const SPECIAL = [
  {
    icon: Leaf, color: 'from-emerald-500 to-green-600',
    title: 'Toza-Hudud moduli',
    text: 'Chiqindi yig\'ish korxonalari uchun. Mashina har MFY ni to\'liq aylandimi — GPS qamrovni tekshiradi. Haydovchi reytingi, chala qolgan ko\'chalar Telegram\'ga (navigator havolasi bilan), AI marshrut o\'rganish.',
  },
  {
    icon: Recycle, color: 'from-blue-500 to-cyan-600',
    title: 'EkoHisob moduli',
    text: 'Ekologik to\'lovlar uchun. Tashkilotlar bazasi, qarzdorlik xaritasi (pulsatsiyalovchi belgilar), qisman to\'lov, avtomatik kvitansiya, qora ro\'yxat, inspektor uchun "eng yaqin qarzdorlar" marshruti.',
  },
]

const WHY = [
  { icon: ShieldCheck, title: 'Ma\'lumotlar O\'zbekistonda', text: 'Barcha ma\'lumot mamlakat ichidagi serverda — qonun talabiga to\'liq mos.' },
  { icon: Smartphone,  title: 'Telegram bot', text: 'Dala xodimi telefondan, ofissiz ma\'lumot kiritadi — rasm, GPS, to\'lov.' },
  { icon: Eye,         title: 'Biz o\'zimiz ishlatamiz', text: '94 ta texnikani har kuni shu tizimda boshqaramiz — nazariy emas, sinalgan.' },
  { icon: TrendingDown,title: 'Tez natija', text: 'Birinchi oyda yoqilg\'i va ta\'mirlash isrofini ko\'rasiz — tizim o\'zini qoplaydi.' },
]

const STEPS = [
  { n: '1', title: 'Ro\'yxatdan o\'ting', text: 'Telefon raqami va SMS kod — 2 daqiqa. 14 kun bepul boshlanadi.' },
  { n: '2', title: 'Texnika va GPS qo\'shing', text: 'Mashinalaringizni kiriting, mavjud GPS qurilmalarni ulaymiz.' },
  { n: '3', title: 'Nazoratni boshlang', text: 'Yoqilg\'i, ta\'mirlash, joylashuv — hammasi bir ekranda jonli.' },
]

const PLANS = [
  { name: 'Boshlang\'ich', price: '200 000', sub: 'Kichik avtoparklar uchun',
    features: ['10 tagacha mashina', '1 filial, 2 foydalanuvchi', 'GPS, ta\'mirlash, yoqilg\'i', 'AI kalonka OCR', 'Excel eksport'], highlight: false },
  { name: 'Biznes', price: '450 000', sub: 'Eng ko\'p tanlanadigan', badge: 'TAVSIYA',
    features: ['50 tagacha mashina', '3 filial, 10 foydalanuvchi', 'Barcha imkoniyatlar', 'AI anomaliya va prognoz', 'Telegram bot', 'Ustuvor yordam'], highlight: true },
  { name: 'Korxona', price: 'Individual', sub: 'Yirik avtopark va kommunal',
    features: ['Cheksiz mashina va filial', 'Toza-Hudud + EkoHisob', 'Maxsus integratsiya', 'Shaxsiy menejer', 'SLA kafolat'], highlight: false },
]

const FAQ = [
  { q: 'GPS qurilmam boshqa firmadan — ulanadimi?', a: 'Ha. Wialon va SmartGPS qurilmalari to\'g\'ridan-to\'g\'ri ulanadi. Boshqa turdagi qurilmalar uchun ham yechim topamiz, kerak bo\'lsa yangi o\'rnatib beramiz.' },
  { q: 'Sinov muddati qancha va to\'lov kerakmi?', a: '14 kun to\'liq bepul — karta yoki oldindan to\'lov talab qilinmaydi. Yoqsa, tarifni tanlaysiz. Yoqmasa — hech narsa to\'lamaysiz.' },
  { q: 'Ma\'lumotlarim xavfsizmi?', a: 'Barcha ma\'lumot O\'zbekiston hududidagi serverlarda shifrlangan holda saqlanadi. Har foydalanuvchiga alohida ruxsat darajasi beriladi.' },
  { q: 'Necha kishi bir vaqtda ishlatishi mumkin?', a: 'Tarifga qarab: Boshlang\'ichda 2, Bizneste 10, Korxonada cheksiz. Har xodimga roli (admin, menejer, operator) va filiali belgilanadi.' },
  { q: 'Telefondan ishlasa bo\'ladimi?', a: 'Ha — sayt mobil moslashgan. Bundan tashqari Telegram bot orqali dala xodimlari rasm, GPS va ma\'lumot yuborishi mumkin — kompyuter shart emas.' },
  { q: 'O\'rgatib berasizmi?', a: 'Albatta. Boshlang\'ich sozlash va o\'qitishda yordam beramiz. Korxona tarifida shaxsiy menejer biriktiriladi.' },
]

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600', cyan: 'bg-cyan-50 text-cyan-600',
  green: 'bg-green-50 text-green-600', amber: 'bg-amber-50 text-amber-600',
  purple: 'bg-purple-50 text-purple-600', rose: 'bg-rose-50 text-rose-600',
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* NAV */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/85 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">AvtoHisob</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-gray-600 font-medium">
            <a href="#problems" className="hover:text-gray-900">Muammolar</a>
            <a href="#modules" className="hover:text-gray-900">Modullar</a>
            <a href="#pricing" className="hover:text-gray-900">Tariflar</a>
            <a href="#faq" className="hover:text-gray-900">FAQ</a>
            <Link to="/login" className="hover:text-gray-900">Kirish</Link>
            <Link to="/signup" className="px-4 py-2 bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition-all">
              14 kun bepul
            </Link>
          </nav>
          <button onClick={() => setMenuOpen(v => !v)} className="md:hidden p-2">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-gray-100 px-4 py-3 space-y-1 bg-white">
            {['problems:Muammolar', 'modules:Modullar', 'pricing:Tariflar', 'faq:FAQ'].map(x => {
              const [id, label] = x.split(':')
              return <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)} className="block py-2 text-sm text-gray-700">{label}</a>
            })}
            <Link to="/login" className="block py-2 text-sm text-gray-700">Kirish</Link>
            <Link to="/signup" className="block py-2.5 mt-1 bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-xl font-semibold text-center">14 kun bepul boshlash</Link>
          </div>
        )}
      </header>

      {/* HERO — og'riqqa uradi */}
      <section className="relative pt-28 pb-20 lg:pt-32 lg:pb-24 overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 55%, #0c4a6e 100%)' }}>
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-rose-500/15 border border-rose-500/30 rounded-full text-rose-300 text-xs font-medium mb-6">
                <AlertTriangle className="w-3.5 h-3.5" />
                Yoqilg'i, ta'mirlash, ehtiyot qism — isrofni to'xtating
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-[3.4rem] font-black leading-[1.1] mb-6 text-white">
                Avtoparkingiz qancha pul<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">yutqazyapti — bilasizmi?</span>
              </h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8 max-w-lg">
                GPS monitoring, yoqilg'i nazorati, ta'mirlash tarixi va AI tahlil.
                Ofisdan turib butun texnikangizni real vaqtda kuzating —
                har litr, har qism, har so'm hisobda.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link to="/signup" className="flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-semibold rounded-2xl hover:scale-105 hover:shadow-xl hover:shadow-blue-600/30 transition-all">
                  14 kun bepul sinab ko'ring <ArrowRight className="w-4 h-4" />
                </Link>
                <a href="#problems" className="px-6 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold rounded-2xl transition-all">
                  Qanday ishlaydi?
                </a>
              </div>
              <p className="text-gray-500 text-sm mt-4">Karta talab qilinmaydi · 2 daqiqada ro'yxatdan o'tasiz</p>
            </div>

            {/* Mockup */}
            <div className="hidden lg:block relative">
              <div className="bg-gray-900/80 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl overflow-hidden" style={{ boxShadow: '0 0 60px rgba(59,130,246,0.25)' }}>
                <div className="bg-gray-800/50 px-4 py-3 flex items-center gap-2 border-b border-white/5">
                  <div className="w-3 h-3 rounded-full bg-red-500/70" />
                  <div className="w-3 h-3 rounded-full bg-yellow-500/70" />
                  <div className="w-3 h-3 rounded-full bg-green-500/70" />
                  <div className="flex-1 bg-gray-700/50 rounded-lg mx-4 h-5 flex items-center px-3">
                    <span className="text-gray-500 text-xs">app.avtohisob.uz</span>
                  </div>
                </div>
                <div className="p-4">
                  <div className="grid grid-cols-3 gap-3 mb-4">
                    {[['Jami mashina', '94', 'text-white'], ['GPS faol', '88', 'text-green-400'], ['Anomaliya', '3', 'text-rose-400']].map(([l, v, c]) => (
                      <div key={l} className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <div className="text-xs text-gray-500 mb-1">{l}</div>
                        <div className={`text-xl font-bold ${c}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                  <div className="bg-rose-500/10 border border-rose-500/20 rounded-xl px-3 py-2 mb-3 flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span className="text-xs text-rose-300">01A123BC — 100km, 62 litr (g'ayrioddiy sarf)</span>
                  </div>
                  {[['30C456DE', 'Damas', 'Normal', 'bg-green-400'], ['85F789GH', 'Labo', "Ta'mirda", 'bg-yellow-400']].map(([n, m, s, dot]) => (
                    <div key={n} className="flex items-center gap-3 py-2.5 border-b border-white/5">
                      <div className="w-8 h-8 bg-blue-500/20 rounded-lg flex items-center justify-center"><Truck className="w-4 h-4 text-blue-400" /></div>
                      <div className="flex-1">
                        <div className="text-sm font-medium text-white font-mono">{n}</div>
                        <div className="text-xs text-gray-500">{m}</div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${dot}`} />
                        <span className="text-xs text-gray-400">{s}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* OG'RIQ BO'LIMI */}
      <section id="problems" className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Tanish muammolar — endi <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">nazorat ostida</span></h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Avtopark egasi har kuni duch keladigan yo'qotishlar va AvtoHisob ularni qanday to'xtatadi</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {PAINS.map(p => (
              <div key={p.title} className="rounded-3xl border border-gray-100 p-7 hover:shadow-xl hover:shadow-gray-200/50 transition-all">
                <div className="flex items-start gap-4">
                  <div className={`w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 ${p.color}`}>
                    <p.icon className="w-6 h-6" />
                  </div>
                  <div>
                    <h3 className="font-bold text-lg text-gray-900">{p.title}</h3>
                    <p className="text-sm text-gray-500 mt-2 leading-relaxed">{p.text}</p>
                    <div className="mt-3 flex items-start gap-2 bg-green-50 rounded-xl px-3 py-2.5">
                      <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" strokeWidth={3} />
                      <p className="text-sm text-green-800 leading-relaxed">{p.fix}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MODULLAR — batafsil */}
      <section id="modules" className="py-24" style={{ background: 'linear-gradient(180deg, #f8fafc 0%, #ffffff 100%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Har bo'lim — aniq <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">foyda</span></h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Bu shunchaki "ma'lumot saqlash" emas — har modul aniq pul yoki vaqt tejaydi</p>
          </div>
          <div className="space-y-5">
            {MODULES.map((m, i) => (
              <div key={m.title} className="bg-white rounded-3xl border border-gray-100 p-6 sm:p-8 hover:shadow-lg transition-all">
                <div className="grid md:grid-cols-12 gap-5 items-start">
                  <div className="md:col-span-1">
                    <div className={`w-12 h-12 rounded-2xl flex items-center justify-center ${COLOR_MAP[m.color]}`}>
                      <m.icon className="w-6 h-6" />
                    </div>
                  </div>
                  <div className="md:col-span-7">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-gray-300">0{i + 1}</span>
                      <h3 className="font-bold text-lg text-gray-900">{m.title}</h3>
                    </div>
                    <p className="text-sm font-medium text-gray-700 mt-1.5">{m.what}</p>
                    <p className="text-sm text-gray-500 mt-2 leading-relaxed">{m.detail}</p>
                  </div>
                  <div className="md:col-span-4">
                    <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-2xl p-4 border border-green-100">
                      <p className="text-xs font-bold text-green-700 uppercase tracking-wide mb-1">Natija</p>
                      <p className="text-sm text-green-800 font-medium leading-relaxed">{m.result}</p>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MAXSUS MODULLAR */}
      <section className="py-24 bg-white">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Kommunal xizmatlar uchun maxsus modullar</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Chiqindi boshqaruv va ekologik to'lovlar — alohida tayyor yechimlar</p>
          </div>
          <div className="grid md:grid-cols-2 gap-6">
            {SPECIAL.map(s => (
              <div key={s.title} className="rounded-3xl border border-gray-100 p-8 hover:shadow-xl transition-all">
                <div className={`w-14 h-14 bg-gradient-to-br ${s.color} rounded-2xl flex items-center justify-center mb-5`}>
                  <s.icon className="w-7 h-7 text-white" />
                </div>
                <h3 className="font-bold text-xl text-gray-900">{s.title}</h3>
                <p className="text-sm text-gray-500 mt-2.5 leading-relaxed">{s.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* NEGA BIZ */}
      <section className="py-24" style={{ background: 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)' }}>
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Nega aynan <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">AvtoHisob</span>?</h2>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {WHY.map(w => (
              <div key={w.title} className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
                <div className="w-11 h-11 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
                  <w.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-gray-900">{w.title}</h3>
                <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{w.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QANDAY ISHLAYDI */}
      <section className="py-24 bg-white">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">3 qadamda boshlang</h2>
          </div>
          <div className="grid md:grid-cols-3 gap-6">
            {STEPS.map((s, i) => (
              <div key={s.n} className="relative">
                <div className="bg-gradient-to-br from-blue-50 to-cyan-50 rounded-3xl p-7 border border-blue-100 h-full">
                  <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-2xl flex items-center justify-center text-white text-xl font-black mb-4">
                    {s.n}
                  </div>
                  <h3 className="font-bold text-lg text-gray-900">{s.title}</h3>
                  <p className="text-sm text-gray-500 mt-2 leading-relaxed">{s.text}</p>
                </div>
                {i < STEPS.length - 1 && (
                  <ArrowRight className="hidden md:block absolute top-1/2 -right-4 w-6 h-6 text-blue-300 -translate-y-1/2" />
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TARIFLAR */}
      <section id="pricing" className="py-24" style={{ background: 'linear-gradient(180deg, #fffbeb 0%, #ffffff 100%)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Korxonangizga <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-500 to-orange-500">mos tarif</span></h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Barcha tariflarda GPS, ta'mirlash, hisobotlar. 14 kun bepul sinab ko'ring.</p>
          </div>
          <div className="grid md:grid-cols-3 gap-6 max-w-6xl mx-auto items-stretch">
            {PLANS.map(p => (
              <div key={p.name} className={`relative rounded-3xl p-8 flex flex-col transition-all ${p.highlight ? 'bg-gradient-to-b from-amber-50 to-white border-2 border-amber-400 shadow-2xl shadow-amber-200/50 md:scale-105' : 'bg-white border border-gray-200 shadow-sm hover:shadow-lg'}`}>
                {p.badge && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 bg-gradient-to-r from-amber-500 to-orange-500 text-white text-xs font-bold rounded-full flex items-center gap-1">
                    <Star className="w-3 h-3" /> {p.badge}
                  </div>
                )}
                <div className="mb-6">
                  <div className={`text-sm font-bold mb-2 uppercase tracking-wide ${p.highlight ? 'text-amber-600' : 'text-blue-600'}`}>{p.name}</div>
                  <div className="flex items-baseline gap-1.5">
                    <span className="text-4xl font-black text-gray-900">{p.price}</span>
                    {p.price !== 'Individual' && <span className="text-gray-500 text-sm">so'm/oy</span>}
                  </div>
                  <div className="text-xs text-gray-500 mt-1">{p.sub}</div>
                </div>
                <ul className="space-y-3 text-sm text-gray-700 mb-8 flex-1">
                  {p.features.map(f => (
                    <li key={f} className="flex items-start gap-2">
                      <Check className="w-4 h-4 text-green-600 mt-0.5 shrink-0" strokeWidth={3} />
                      <span>{f}</span>
                    </li>
                  ))}
                </ul>
                <Link to="/signup" className={`block text-center px-5 py-3 font-bold rounded-xl transition-all ${p.highlight ? 'bg-gradient-to-r from-amber-500 to-orange-500 text-white hover:shadow-lg' : 'bg-gray-100 hover:bg-gray-200 text-gray-800'}`}>
                  14 kun bepul boshlash
                </Link>
              </div>
            ))}
          </div>
          <p className="text-center text-sm text-gray-400 mt-8">Barcha tariflarda 14 kun bepul sinov — karta talab qilinmaydi</p>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="py-24 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Ko'p so'raladigan savollar</h2>
          </div>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <div key={i} className="border border-gray-100 rounded-2xl overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors">
                  <span className="font-semibold text-gray-900 pr-4">{item.q}</span>
                  <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${openFaq === i ? 'rotate-180' : ''}`} />
                </button>
                {openFaq === i && (
                  <div className="px-5 pb-4 text-sm text-gray-600 leading-relaxed">{item.a}</div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-20 relative overflow-hidden" style={{ background: 'linear-gradient(135deg, #1e3a8a 0%, #0e7490 100%)' }}>
        <div className="absolute -top-20 -right-20 w-72 h-72 bg-white/10 rounded-full blur-3xl" />
        <div className="max-w-3xl mx-auto px-4 text-center relative z-10">
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">Isrofni bugun to'xtating</h2>
          <p className="text-blue-100 text-lg mb-8">14 kun bepul sinab ko'ring — birinchi oyda tizim o'zini qoplaydi.</p>
          <Link to="/signup" className="inline-flex items-center gap-2 px-8 py-4 bg-white text-blue-700 rounded-2xl font-bold hover:scale-105 transition-transform">
            Bepul ro'yxatdan o'tish <ArrowRight className="w-5 h-5" />
          </Link>
          <p className="text-blue-200 text-sm mt-4">Karta kerak emas · 2 daqiqada boshlaysiz</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="border-t border-gray-100 py-10 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-lg flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-gray-700">AvtoHisob</span>
            <span className="text-gray-400">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-5">
            <Link to="/oferta" className="hover:text-gray-700">Oferta</Link>
            <Link to="/privacy-policy" className="hover:text-gray-700">Maxfiylik</Link>
            <Link to="/login" className="hover:text-gray-700">Kirish</Link>
            <Link to="/signup" className="text-blue-600 font-medium hover:underline">Ro'yxatdan o'tish</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
