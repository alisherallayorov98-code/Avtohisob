import { Link } from 'react-router-dom'
import {
  Truck, Wrench, Fuel, Package, BarChart3, MapPin, Leaf, Recycle,
  ShieldCheck, Cpu, ArrowRight, CheckCircle2, Menu, X,
} from 'lucide-react'
import { useState } from 'react'

const FEATURES = [
  { icon: Truck,     title: 'Avtopark boshqaruvi', desc: 'Barcha texnikangiz bir joyda — holati, hujjatlari, tarixi.' },
  { icon: Wrench,    title: "Ta'mirlash nazorati", desc: 'Ehtiyot qism, usta haqi, foto-dalil, tasdiqlash jarayoni.' },
  { icon: Fuel,      title: "Yoqilg'i monitoringi", desc: "Sarf, anomaliya, GPS solishtirish — isrofni aniqlash." },
  { icon: Package,   title: 'Ombor va inventarizatsiya', desc: 'Qoldiq, kirim-chiqim, inventarizatsiya akti, kamomad.' },
  { icon: BarChart3, title: 'Kuchli hisobotlar', desc: 'Xarajat, yoqilg\'i, ta\'mirlash — grafik va Excel eksport.' },
  { icon: Cpu,       title: 'AI tahlil', desc: 'Anomaliya, prognoz, tavsiyalar — sun\'iy intellekt yordamida.' },
  { icon: MapPin,    title: 'Jonli GPS xarita', desc: 'Texnika qayerda — real vaqtda, marshrut va qamrov.' },
  { icon: Leaf,      title: 'Toza-Hudud moduli', desc: 'Chiqindi yig\'ish marshruti, MFY qamrovi, haydovchi reytingi.' },
  { icon: Recycle,   title: 'EkoHisob moduli', desc: 'Ekologik to\'lovlar, qarzdorlik, xarita, kvitansiya.' },
]

const BENEFITS = [
  '14 kun bepul — karta talab qilinmaydi',
  "Ma'lumotlaringiz O'zbekistonda saqlanadi",
  'Telegram bot orqali tezkor ishlash',
  "Bir necha filial va cheksiz foydalanuvchi",
]

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* Navbar */}
      <header className="sticky top-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-4 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">AvtoHisob</span>
          </div>
          <nav className="hidden md:flex items-center gap-6 text-sm text-gray-600">
            <a href="#features" className="hover:text-gray-900">Imkoniyatlar</a>
            <a href="#modules" className="hover:text-gray-900">Modullar</a>
            <Link to="/login" className="hover:text-gray-900">Kirish</Link>
            <Link to="/signup" className="px-4 py-2 bg-blue-600 text-white rounded-lg font-medium hover:bg-blue-700 transition-colors">
              Bepul boshlash
            </Link>
          </nav>
          <button onClick={() => setMenuOpen(v => !v)} className="md:hidden p-2">
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
        {menuOpen && (
          <div className="md:hidden border-t border-gray-100 px-4 py-3 space-y-2 bg-white">
            <a href="#features" onClick={() => setMenuOpen(false)} className="block py-1.5 text-sm text-gray-600">Imkoniyatlar</a>
            <a href="#modules" onClick={() => setMenuOpen(false)} className="block py-1.5 text-sm text-gray-600">Modullar</a>
            <Link to="/login" className="block py-1.5 text-sm text-gray-600">Kirish</Link>
            <Link to="/signup" className="block py-2 bg-blue-600 text-white rounded-lg font-medium text-center">Bepul boshlash</Link>
          </div>
        )}
      </header>

      {/* Hero */}
      <section className="relative overflow-hidden">
        <div className="absolute top-0 right-0 w-96 h-96 bg-blue-100 rounded-full blur-3xl opacity-50 -z-10" />
        <div className="absolute bottom-0 left-0 w-72 h-72 bg-indigo-100 rounded-full blur-3xl opacity-50 -z-10" />
        <div className="max-w-6xl mx-auto px-4 py-16 md:py-24 text-center">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-blue-50 text-blue-700 rounded-full text-xs font-medium mb-5">
            <ShieldCheck className="w-3.5 h-3.5" /> O'zbekistondagi avtopark boshqaruv tizimi
          </div>
          <h1 className="text-4xl md:text-6xl font-extrabold tracking-tight leading-tight">
            Avtoparkingizni <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-indigo-600">aqlli boshqaring</span>
          </h1>
          <p className="text-lg text-gray-600 mt-5 max-w-2xl mx-auto">
            Texnika, ta'mirlash, yoqilg'i, ombor, GPS va hisobotlar — barchasi bitta tizimda.
            AI tahlil bilan isrofni kamaytiring.
          </p>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-3 mt-8">
            <Link to="/signup" className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition-all">
              14 kun bepul boshlash <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/login" className="px-6 py-3 border border-gray-200 rounded-xl font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              Tizimga kirish
            </Link>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-2 mt-8 text-sm text-gray-500">
            {BENEFITS.map(b => (
              <span key={b} className="flex items-center gap-1.5">
                <CheckCircle2 className="w-4 h-4 text-green-500" /> {b}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="max-w-6xl mx-auto px-4 py-16">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold">Hamma narsa bitta tizimda</h2>
          <p className="text-gray-600 mt-3">Qog'oz va Excel'dan voz keching — avtoparkni raqamlashtiring</p>
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {FEATURES.map(f => (
            <div key={f.title} className="p-6 rounded-2xl border border-gray-100 hover:border-blue-200 hover:shadow-lg hover:shadow-blue-500/5 transition-all group">
              <div className="w-11 h-11 bg-blue-50 group-hover:bg-blue-600 rounded-xl flex items-center justify-center mb-4 transition-colors">
                <f.icon className="w-5 h-5 text-blue-600 group-hover:text-white transition-colors" />
              </div>
              <h3 className="font-semibold text-gray-900">{f.title}</h3>
              <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{f.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Modules highlight */}
      <section id="modules" className="bg-gradient-to-br from-blue-50 to-indigo-50 py-16">
        <div className="max-w-6xl mx-auto px-4">
          <div className="grid md:grid-cols-2 gap-8 items-center">
            <div>
              <h2 className="text-3xl font-bold">Maxsus modullar</h2>
              <p className="text-gray-600 mt-3 leading-relaxed">
                AvtoHisob faqat avtopark emas — chiqindi boshqaruv (Toza-Hudud) va ekologik
                to'lovlar (EkoHisob) modullari bilan kommunal xizmatlar uchun ham tayyor.
              </p>
              <ul className="mt-5 space-y-2.5">
                {['GPS asosida marshrut qamrovi va haydovchi nazorati',
                  'Ekologik to\'lovlar, qarzdorlik xaritasi, kvitansiya',
                  'Telegram dala-bot orqali tezkor ma\'lumot kiritish'].map(t => (
                  <li key={t} className="flex items-start gap-2 text-sm text-gray-700">
                    <CheckCircle2 className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" /> {t}
                  </li>
                ))}
              </ul>
            </div>
            <div className="grid grid-cols-2 gap-4">
              {[
                { icon: Leaf, label: 'Toza-Hudud', color: 'from-emerald-500 to-green-600' },
                { icon: Recycle, label: 'EkoHisob', color: 'from-blue-500 to-cyan-600' },
                { icon: Cpu, label: 'AI tahlil', color: 'from-purple-500 to-indigo-600' },
                { icon: MapPin, label: 'GPS xarita', color: 'from-rose-500 to-pink-600' },
              ].map(m => (
                <div key={m.label} className="bg-white rounded-2xl p-5 shadow-sm border border-gray-100">
                  <div className={`w-10 h-10 bg-gradient-to-br ${m.color} rounded-xl flex items-center justify-center mb-3`}>
                    <m.icon className="w-5 h-5 text-white" />
                  </div>
                  <p className="font-semibold text-sm">{m.label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="max-w-4xl mx-auto px-4 py-20 text-center">
        <h2 className="text-3xl md:text-4xl font-bold">Bugun bepul boshlang</h2>
        <p className="text-gray-600 mt-3">14 kunlik to'liq sinov. Karta yoki to'lov talab qilinmaydi.</p>
        <Link to="/signup" className="inline-flex items-center gap-2 mt-7 px-8 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-xl font-semibold hover:shadow-lg hover:shadow-blue-500/30 transition-all">
          Ro'yxatdan o'tish <ArrowRight className="w-4 h-4" />
        </Link>
      </section>

      {/* Footer */}
      <footer className="border-t border-gray-100 py-8">
        <div className="max-w-6xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3 text-sm text-gray-500">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-lg flex items-center justify-center">
              <Truck className="w-4 h-4 text-white" />
            </div>
            <span className="font-semibold text-gray-700">AvtoHisob</span>
            <span className="text-gray-400">© {new Date().getFullYear()}</span>
          </div>
          <div className="flex items-center gap-4">
            <Link to="/oferta" className="hover:text-gray-700">Oferta</Link>
            <Link to="/privacy-policy" className="hover:text-gray-700">Maxfiylik</Link>
            <Link to="/login" className="hover:text-gray-700">Kirish</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
