import { Link } from 'react-router-dom'
import { useState } from 'react'
import {
  Truck, Wrench, Fuel, Package, BarChart3, MapPin, Leaf, Recycle, Cpu,
  ShieldCheck, ArrowRight, Check, Menu, X, Star, Clock, FileText, Camera,
} from 'lucide-react'

const FEATURES = [
  { icon: MapPin,    color: 'blue',   title: 'GPS jonli monitoring', desc: "Texnika qayerda — real vaqtda, marshrut, qamrov va tezlik nazorati." },
  { icon: Fuel,      color: 'cyan',   title: "Yoqilg'i nazorati", desc: "Sarf, anomaliya, GPS solishtirish — isrof va o'g'irlikni aniqlash." },
  { icon: Wrench,    color: 'green',  title: "Ta'mirlash tarixi", desc: 'Ehtiyot qism, usta haqi, foto/video dalil, tasdiqlash jarayoni.' },
  { icon: Package,   color: 'amber',  title: 'Ombor va inventarizatsiya', desc: 'Qoldiq, kirim-chiqim, inventarizatsiya akti, kamomad/ortiqcha.' },
  { icon: Cpu,       color: 'purple', title: 'AI tahlil', desc: "Anomaliya, prognoz, kalonka OCR — sun'iy intellekt yordamida." },
  { icon: BarChart3, color: 'rose',   title: 'Kuchli hisobotlar', desc: 'Xarajat, yoqilgi, ta\'mirlash — grafik va Excel eksport.' },
]

const WHY = [
  { icon: ShieldCheck, title: 'Ofisdan nazorat', desc: "Dalaga chiqmasdan butun avtoparkni real vaqtda kuzating." },
  { icon: Camera,      title: 'Foto/video dalil', desc: "Har ta'mirlash rasm yoki video bilan tasdiqlanadi — soxtalashtirib bo'lmaydi." },
  { icon: Clock,       title: 'Ish vaqti nazorati', desc: "Kim qachon ishni boshladi, qachon tugatdi — GPS asosida." },
  { icon: FileText,    title: 'Rasmiy hujjatlar', desc: "Dalolatnoma, to'lov varaqasi, inventarizatsiya akti — bir bosishda." },
]

const PLANS = [
  {
    name: "Boshlang'ich", price: '200 000', sub: 'Kichik avtoparklar uchun',
    features: ['10 tagacha mashina', '1 filial, 2 foydalanuvchi', 'GPS monitoring, ta\'mirlash', "Yoqilg'i analitikasi", 'AI kalonka tahlili (OCR)', 'Excel eksport'],
    highlight: false,
  },
  {
    name: 'Biznes', price: '450 000', sub: "Eng ko'p tanlanadigan", badge: 'TAVSIYA',
    features: ['50 tagacha mashina', '3 filial, 10 foydalanuvchi', 'Barcha Boshlang\'ich imkoniyatlari', 'AI anomaliya va prognoz', 'Telegram bot integratsiya', 'Ustuvor qo\'llab-quvvatlash'],
    highlight: true,
  },
  {
    name: 'Korxona', price: 'Individual', sub: 'Yirik avtopark va kommunal',
    features: ['Cheksiz mashina va filial', 'Toza-Hudud + EkoHisob modullari', 'Maxsus integratsiyalar', 'Shaxsiy menejer', 'O\'qitish va sozlash', 'SLA kafolat'],
    highlight: false,
  },
]

const FAQ = [
  { q: 'Sinov muddati qancha?', a: '14 kun to\'liq bepul. Karta yoki to\'lov talab qilinmaydi. Istalgan vaqtda tarifni tanlaysiz.' },
  { q: "Ma'lumotlarim qayerda saqlanadi?", a: "Barcha ma'lumotlar O'zbekiston hududidagi serverlarda saqlanadi — qonun talablariga to'liq mos." },
  { q: 'GPS qurilma kerakmi?', a: "Mavjud Wialon yoki SmartGPS qurilmalaringizni ulaymiz. Yangi qurilma ham o'rnatib beramiz." },
  { q: 'Necha kishi ishlatishi mumkin?', a: 'Tarifga qarab — Boshlang\'ichda 2, Bizneste 10, Korxonada cheksiz foydalanuvchi.' },
  { q: 'Telefondan ishlasa bo\'ladimi?', a: 'Ha — sayt mobil moslashgan, Telegram bot orqali ham dala xodimlari ma\'lumot kirita oladi.' },
]

const COLOR_MAP: Record<string, string> = {
  blue: 'bg-blue-50 text-blue-600 group-hover:bg-blue-600',
  cyan: 'bg-cyan-50 text-cyan-600 group-hover:bg-cyan-600',
  green: 'bg-green-50 text-green-600 group-hover:bg-green-600',
  amber: 'bg-amber-50 text-amber-600 group-hover:bg-amber-600',
  purple: 'bg-purple-50 text-purple-600 group-hover:bg-purple-600',
  rose: 'bg-rose-50 text-rose-600 group-hover:bg-rose-600',
}

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {/* NAV */}
      <header className="fixed top-0 inset-x-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-blue-600 to-cyan-500 rounded-xl flex items-center justify-center">
              <Truck className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold text-lg">AvtoHisob</span>
          </div>
          <nav className="hidden md:flex items-center gap-7 text-sm text-gray-600 font-medium">
            <a href="#features" className="hover:text-gray-900">Imkoniyatlar</a>
            <a href="#why" className="hover:text-gray-900">Nega biz</a>
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
            {['features:Imkoniyatlar', 'why:Nega biz', 'pricing:Tariflar', 'faq:FAQ'].map(x => {
              const [id, label] = x.split(':')
              return <a key={id} href={`#${id}`} onClick={() => setMenuOpen(false)} className="block py-2 text-sm text-gray-700">{label}</a>
            })}
            <Link to="/login" className="block py-2 text-sm text-gray-700">Kirish</Link>
            <Link to="/signup" className="block py-2.5 mt-1 bg-gradient-to-r from-blue-600 to-cyan-500 text-white rounded-xl font-semibold text-center">14 kun bepul boshlash</Link>
          </div>
        )}
      </header>

      {/* HERO — dark */}
      <section className="relative pt-28 pb-20 lg:pt-32 lg:pb-28 overflow-hidden" style={{ background: 'linear-gradient(135deg, #0f172a 0%, #1e293b 60%, #0c4a6e 100%)' }}>
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/15 rounded-full blur-3xl animate-pulse" />
          <div className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-cyan-500/15 rounded-full blur-3xl animate-pulse" style={{ animationDelay: '2s' }} />
        </div>
        <div className="max-w-7xl mx-auto px-4 sm:px-6 relative z-10">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Text */}
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1.5 bg-blue-600/20 border border-blue-500/30 rounded-full text-blue-300 text-xs font-medium mb-6">
                <span className="w-1.5 h-1.5 bg-blue-400 rounded-full animate-pulse" />
                GPS bilan real vaqt monitoring
              </div>
              <h1 className="text-4xl sm:text-5xl lg:text-6xl font-black leading-tight mb-6 text-white">
                Avtoparkingizni<br />
                <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-cyan-400">aqlli boshqaring</span>
              </h1>
              <p className="text-gray-300 text-lg leading-relaxed mb-8 max-w-lg">
                GPS monitoring, yoqilg'i nazorati, ta'mirlash tarixi va AI tahlil — barcha
                texnikangizni bitta tizimda, real vaqtda kuzating.
              </p>
              <div className="flex flex-wrap gap-4">
                <Link to="/signup" className="flex items-center gap-2 px-6 py-3.5 bg-gradient-to-r from-blue-600 to-cyan-500 text-white font-semibold rounded-2xl hover:scale-105 hover:shadow-xl hover:shadow-blue-600/30 transition-all">
                  14 kun bepul boshlash <ArrowRight className="w-4 h-4" />
                </Link>
                <Link to="/login" className="px-6 py-3.5 bg-white/5 hover:bg-white/10 border border-white/10 text-white font-semibold rounded-2xl transition-all">
                  Tizimga kirish
                </Link>
              </div>
              <div className="flex flex-wrap gap-8 mt-12 pt-8 border-t border-white/10">
                {[['14 kun', 'Bepul sinov'], ['GPS', 'Real vaqt'], ['24/7', 'Monitoring']].map(([a, b]) => (
                  <div key={a}>
                    <div className="text-2xl font-black text-white">{a}</div>
                    <div className="text-xs text-gray-500 mt-0.5">{b}</div>
                  </div>
                ))}
              </div>
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
                    {[['Jami mashina', '94', 'text-white'], ['GPS faol', '88', 'text-green-400'], ['Ta\'mirda', '6', 'text-yellow-400']].map(([l, v, c]) => (
                      <div key={l} className="bg-white/5 rounded-xl p-3 border border-white/5">
                        <div className="text-xs text-gray-500 mb-1">{l}</div>
                        <div className={`text-xl font-bold ${c}`}>{v}</div>
                      </div>
                    ))}
                  </div>
                  {[['01A123BC', 'Isuzu', 'Faol', 'bg-green-400'], ['30C456DE', 'Damas', 'Faol', 'bg-green-400'], ['85F789GH', 'Labo', "Ta'mirda", 'bg-yellow-400']].map(([n, m, s, dot]) => (
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

      {/* FEATURES */}
      <section id="features" className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Hamma narsa <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">bitta tizimda</span></h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Qog'oz va Excel'dan voz keching — avtoparkni to'liq raqamlashtiring</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
            {FEATURES.map(f => (
              <div key={f.title} className="group p-7 rounded-3xl border border-gray-100 hover:border-transparent hover:shadow-xl hover:shadow-gray-200/60 transition-all">
                <div className={`w-12 h-12 rounded-2xl flex items-center justify-center mb-5 transition-colors ${COLOR_MAP[f.color]}`}>
                  <f.icon className="w-6 h-6 group-hover:text-white transition-colors" />
                </div>
                <h3 className="font-bold text-lg text-gray-900">{f.title}</h3>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHY US */}
      <section id="why" className="py-24" style={{ background: 'linear-gradient(180deg, #eff6ff 0%, #ffffff 100%)' }}>
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Nega aynan <span className="text-transparent bg-clip-text bg-gradient-to-r from-blue-600 to-cyan-500">AvtoHisob</span>?</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Boshqa tizimlardan farqli — O'zbekiston biznesiga moslashtirilgan</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {WHY.map(w => (
              <div key={w.title} className="bg-white rounded-3xl p-6 border border-gray-100 shadow-sm">
                <div className="w-11 h-11 bg-blue-600 rounded-2xl flex items-center justify-center mb-4">
                  <w.icon className="w-5 h-5 text-white" />
                </div>
                <h3 className="font-bold text-gray-900">{w.title}</h3>
                <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{w.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MODULES */}
      <section className="py-24 bg-white">
        <div className="max-w-7xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-14">
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Maxsus modullar</h2>
            <p className="text-gray-600 text-lg max-w-2xl mx-auto">Kommunal va ekologik xizmatlar uchun tayyor yechimlar</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {[
              { icon: Leaf, label: 'Toza-Hudud', desc: 'Chiqindi yig\'ish marshruti, MFY qamrovi, haydovchi reytingi', color: 'from-emerald-500 to-green-600' },
              { icon: Recycle, label: 'EkoHisob', desc: 'Ekologik to\'lovlar, qarzdorlik xaritasi, kvitansiya', color: 'from-blue-500 to-cyan-600' },
              { icon: Cpu, label: 'AI tahlil', desc: 'Anomaliya, prognoz, kalonka OCR avtomatik', color: 'from-purple-500 to-indigo-600' },
              { icon: MapPin, label: 'Jonli GPS', desc: 'Real vaqt joylashuv, marshrut, klaster xarita', color: 'from-rose-500 to-pink-600' },
            ].map(m => (
              <div key={m.label} className="rounded-3xl p-6 border border-gray-100 hover:shadow-lg transition-all">
                <div className={`w-12 h-12 bg-gradient-to-br ${m.color} rounded-2xl flex items-center justify-center mb-4`}>
                  <m.icon className="w-6 h-6 text-white" />
                </div>
                <p className="font-bold text-gray-900">{m.label}</p>
                <p className="text-sm text-gray-500 mt-1.5 leading-relaxed">{m.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING */}
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
            <h2 className="text-3xl sm:text-4xl font-black mb-4">Savol-javob</h2>
          </div>
          <div className="space-y-3">
            {FAQ.map((item, i) => (
              <div key={i} className="border border-gray-100 rounded-2xl overflow-hidden">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-gray-50 transition-colors">
                  <span className="font-semibold text-gray-900">{item.q}</span>
                  <ArrowRight className={`w-4 h-4 text-gray-400 transition-transform shrink-0 ${openFaq === i ? 'rotate-90' : ''}`} />
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
          <h2 className="text-3xl sm:text-4xl font-black text-white mb-4">Bugun bepul boshlang</h2>
          <p className="text-blue-100 text-lg mb-8">14 kunlik to'liq sinov. Karta yoki to'lov talab qilinmaydi.</p>
          <Link to="/signup" className="inline-flex items-center gap-2 px-8 py-4 bg-white text-blue-700 rounded-2xl font-bold hover:scale-105 transition-transform">
            Ro'yxatdan o'tish <ArrowRight className="w-5 h-5" />
          </Link>
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
