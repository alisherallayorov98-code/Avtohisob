import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import './Landing.css'

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false)
  const [openFaq, setOpenFaq] = useState<number | null>(0)

  // Scroll-reveal + counter animatsiyalari (vanilla IntersectionObserver)
  useEffect(() => {
    const revealEls = document.querySelectorAll('.reveal')
    const revealObs = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach(e => {
          if (e.isIntersecting) {
            e.target.classList.add('active')
            obs.unobserve(e.target)
          }
        })
      },
      { threshold: 0.1, rootMargin: '0px 0px -50px 0px' },
    )
    revealEls.forEach(el => revealObs.observe(el))

    const counters = document.querySelectorAll<HTMLElement>('.stat-counter')
    const countObs = new IntersectionObserver(
      (entries, obs) => {
        entries.forEach(entry => {
          if (!entry.isIntersecting) return
          const el = entry.target as HTMLElement
          const target = Number(el.getAttribute('data-count')) || 0
          const step = target / (2000 / 16)
          let current = 0
          const tick = () => {
            current += step
            if (current < target) {
              el.innerText = String(Math.ceil(current))
              requestAnimationFrame(tick)
            } else {
              el.innerText = String(target)
            }
          }
          tick()
          obs.unobserve(el)
        })
      },
      { threshold: 0.5 },
    )
    counters.forEach(c => countObs.observe(c))

    return () => {
      revealObs.disconnect()
      countObs.disconnect()
    }
  }, [])

  const navLinks = [
    ['#muammolar', 'Muammolar'],
    ['#qanday-ishlaydi', 'Qanday ishlaydi'],
    ['#modullar', 'Modullar'],
    ['#tariflar', 'Tariflar'],
  ]

  const faqs = [
    ['Qanday texnikalarga o\'rnatish mumkin?', 'Biz deyarli barcha turdagi transportlarga xizmat ko\'rsatamiz: yengil avtomobillar (Damas, Cobalt), yuk mashinalari (Isuzu, MAN, Kamaz), maxsus texnikalar (ekskavator, traktor). Uskunalar har biriga alohida moslashtiriladi.'],
    ['Yoqilg\'i datchigi aniq ishlaydimi?', 'Ha, biz yuqori aniqlikdagi (99% gacha) datchiklardan foydalanamiz. Tizim bakdagi har qanday o\'zgarishni (to\'ldirish, to\'kib olish, noodatiy sarf) qayd etib, darhol sizga xabar beradi.'],
    ['O\'zbekistonda serverlar bormi? Ma\'lumot xavfsizmi?', 'Albatta. Qonunchilik talablariga muvofiq, barcha ma\'lumotlar bazasi O\'zbekiston hududidagi zamonaviy Data Markazlarda saqlanadi. Bu xavfsizlik va yuqori tezlikni kafolatlaydi.'],
    ['O\'rnatish jarayoni qancha vaqt oladi?', 'Bitta texnikaga GPS va datchik o\'rnatish o\'rtacha 2-3 soat vaqtni oladi. Bizning mutaxassislar sizning hududingizga borib o\'rnatib berishadi.'],
    ['Narx qanday hisoblanadi va to\'lov qanday amalga oshiriladi?', 'Har bir texnika uchun oylik tarif olinadi. To\'lov naqd yoki o\'tkazma yo\'li orqali amalga oshirilishi mumkin, hech qanday yashirin to\'lovlarsiz.'],
    ['Texnik yordam va qo\'llab-quvvatlash bormi?', 'Ha, ish kunlari telefon va Telegram orqali tezkor yordam ko\'rsatamiz. O\'rnatish va sozlanganidan so\'ng mutaxassisimiz bevosita chiqib yordam berishi mumkin.'],
  ]

  const check = (
    <svg className="w-5 h-5 text-brand-500 mr-3 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
    </svg>
  )

  return (
    <div className="landing-root text-slate-800 antialiased overflow-x-hidden relative">
      <div className="blob-1 pointer-events-none" />
      <div className="blob-2 pointer-events-none" />

      {/* NAV */}
      <nav className="fixed w-full z-50">
        <div className="absolute inset-0 bg-white/80 backdrop-blur-md border-b border-white/50 shadow-sm" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative">
          <div className="flex justify-between items-center h-20">
            <a href="#top" className="text-2xl font-extrabold tracking-tight text-slate-900">
              Avto<span className="text-brand-600">Hisob</span>
            </a>
            <div className="hidden md:flex space-x-8">
              {navLinks.map(([href, label]) => (
                <a key={href} href={href} className="text-slate-600 hover:text-brand-600 font-medium transition-colors">{label}</a>
              ))}
            </div>
            <div className="hidden md:flex items-center space-x-4">
              <Link to="/login" className="text-slate-600 hover:text-brand-600 font-medium transition-colors">Kirish</Link>
              <Link to="/signup" className="bg-gradient-brand text-white px-6 py-2.5 rounded-full font-medium hover:shadow-lg hover:-translate-y-0.5 transition-all duration-300">14 kun bepul</Link>
            </div>
            <button onClick={() => setMenuOpen(v => !v)} className="md:hidden p-2 text-slate-600">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              </svg>
            </button>
          </div>
        </div>
        {menuOpen && (
          <div className="md:hidden bg-white border-b border-slate-100 absolute w-full left-0 shadow-lg">
            <div className="px-4 pt-2 pb-6 space-y-1">
              {navLinks.map(([href, label]) => (
                <a key={href} href={href} onClick={() => setMenuOpen(false)} className="block px-3 py-3 rounded-md text-base font-medium text-slate-700 hover:text-brand-600 hover:bg-slate-50">{label}</a>
              ))}
              <div className="mt-4 pt-4 border-t border-slate-100 flex flex-col space-y-3 px-3">
                <Link to="/login" className="text-center font-medium text-slate-600 py-2">Kirish</Link>
                <Link to="/signup" className="text-center bg-gradient-brand text-white px-4 py-3 rounded-full font-medium">14 kun bepul boshlash</Link>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* HERO */}
      <section id="top" className="relative pt-32 pb-20 lg:pt-48 lg:pb-32 overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="lg:grid lg:grid-cols-12 lg:gap-16 items-center">
            <div className="lg:col-span-6 text-center lg:text-left mb-16 lg:mb-0 reveal">
              <div className="inline-flex items-center rounded-full px-4 py-1.5 text-sm font-semibold bg-brand-50 text-brand-600 mb-6 border border-brand-100">
                <span className="flex h-2 w-2 rounded-full bg-brand-600 mr-2 animate-pulse" />
                O'zbekistonda 94+ texnika ulandi
              </div>
              <h1 className="text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.1] mb-6">
                Avtoparkingiz har oy qancha pul yutqazyapti — <span className="text-gradient">aniq bilasizmi?</span>
              </h1>
              <p className="text-xl text-slate-600 mb-10 leading-relaxed max-w-2xl mx-auto lg:mx-0">
                Yoqilg'i o'g'irligi, nazoratsiz ta'mir, bekor turgan texnika — barchasini bitta ekranda boshqaring. Yo'qotishlarni to'xtating va daromadni oshiring.
              </p>
              <div className="flex flex-col sm:flex-row items-center justify-center lg:justify-start space-y-4 sm:space-y-0 sm:space-x-5">
                <Link to="/signup" className="w-full sm:w-auto text-center bg-gradient-brand text-white px-8 py-4 rounded-full text-lg font-semibold hover:shadow-[0_10px_25px_-5px_rgba(37,99,235,0.4)] hover:-translate-y-1 transition-all duration-300">
                  14 kun bepul sinab ko'rish
                </Link>
                <a href="#qanday-ishlaydi" className="w-full sm:w-auto text-center bg-white text-slate-700 border border-slate-200 px-8 py-4 rounded-full text-lg font-semibold hover:bg-slate-50 hover:shadow-md transition-all duration-300 flex items-center justify-center">
                  <svg className="w-5 h-5 mr-2" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                  Qanday ishlaydi?
                </a>
              </div>
              <div className="mt-8 flex items-center justify-center lg:justify-start space-x-4 text-sm text-slate-500 font-medium">
                <div className="flex items-center">{check}<span className="-ml-1">Karta talab etilmaydi</span></div>
                <div className="flex items-center">{check}<span className="-ml-1">2 daqiqada ro'yxatdan o'tish</span></div>
              </div>
            </div>

            {/* 3D hero rasm */}
            <div className="lg:col-span-6 relative reveal" style={{ transitionDelay: '200ms' }}>
              <div className="relative w-full aspect-square flex flex-col justify-center items-center">
                <div className="absolute inset-0 bg-gradient-to-tr from-brand-100/40 to-accent-100/40 rounded-[3rem] -rotate-6 scale-105 opacity-50 z-0" />
                <img src="/landing/hero-fleet.png" alt="AvtoHisob 3D avtopark" className="relative z-10 w-full h-full object-contain animate-float drop-shadow-2xl" />

                {/* Floating glass cards */}
                <div className="absolute top-10 -left-2 lg:-left-12 glass-card rounded-2xl p-4 shadow-glass animate-float-delayed z-20">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center text-brand-600 relative">
                      <div className="absolute inset-0 rounded-full border-2 border-brand-400 pulse-ring" />
                      <svg className="w-5 h-5 relative z-10" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">GPS Holati</p>
                      <p className="text-sm font-bold text-slate-800">Toshkent, Yo'lda</p>
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-20 -right-2 lg:-right-12 glass-card rounded-2xl p-4 shadow-glass animate-float z-20">
                  <div className="flex items-center space-x-3">
                    <div className="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center text-red-600">
                      <svg className="w-6 h-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 12a9 9 0 1 1 18 0" stroke="rgba(220,38,38,0.2)" />
                        <line x1="12" y1="12" x2="6" y2="12" className="fuel-needle text-red-600" />
                        <circle cx="12" cy="12" r="2" fill="currentColor" />
                      </svg>
                    </div>
                    <div>
                      <p className="text-xs text-slate-500 font-medium">Anomaliya</p>
                      <p className="text-sm font-bold text-red-600">-15L Yoqilg'i (Damas #12)</p>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* MUAMMOLAR */}
      <section id="muammolar" className="py-24 bg-white relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 reveal">
            <h2 className="text-brand-600 font-bold tracking-wide uppercase text-sm mb-3">Nega AvtoHisob?</h2>
            <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">An'anaviy boshqaruvdagi yashirin xarajatlar</h3>
            <p className="text-lg text-slate-600">Siz ko'rmayotgan muammolar biznesingizga har oy millionlab so'm zarar keltirmoqda.</p>
          </div>
          <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-8">
            {[
              ['bg-red-100 text-red-600', 'Yoqilg\'i o\'g\'irligi', 'Haydovchilar "nakrutka" qilishyaptimi yoki yoqilg\'i sotishmoqdami? Buni isbotsiz aniqlash qiyin.'],
              ['bg-orange-100 text-orange-600', 'Nazoratsiz ta\'mir', 'Qaysi qism qachon almashtirildi? Ehtiyot qismlar tarixi yo\'qligi ortiqcha xarajatlarga olib keladi.'],
              ['bg-indigo-100 text-indigo-600', 'Ko\'r-ko\'rona boshqaruv', 'Hozir mashinalar qayerda? Qaysi marshrutda? Real-time nazoratsiz mashinalar ko\'p bekor turadi.'],
              ['bg-slate-200 text-slate-700', 'Qog\'ozbozlik', 'Hisobotlar, "putyovka"lar va Excel jadvallar xodimlar vaqtini o\'g\'irlaydi va xatolarga to\'la.'],
            ].map(([chip, title, desc], i) => (
              <div key={title} className="glass-card bg-slate-50/50 p-8 rounded-3xl hover:shadow-glass-hover hover:-translate-y-2 transition-all duration-300 reveal border-slate-200" style={{ transitionDelay: `${(i + 1) * 100}ms` }}>
                <div className={`w-14 h-14 ${chip} rounded-2xl flex items-center justify-center mb-6`}>
                  <svg className="w-7 h-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <h4 className="text-xl font-bold text-slate-900 mb-3">{title}</h4>
                <p className="text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* QANDAY ISHLAYDI */}
      <section id="qanday-ishlaydi" className="py-24 bg-slate-50 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16 reveal">
            <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">Qanday ishlaydi?</h3>
            <p className="text-lg text-slate-600">Atigi 3 qadamda to'liq nazoratni qo'lga oling.</p>
          </div>
          <div className="relative max-w-5xl mx-auto">
            <div className="hidden md:block absolute top-1/2 left-0 w-full h-24 -translate-y-1/2 z-0 pointer-events-none">
              <svg width="100%" height="100%" viewBox="0 0 1000 100" preserveAspectRatio="none">
                <path d="M0,50 L1000,50" fill="none" stroke="rgba(37,99,235,0.2)" strokeWidth={4} strokeDasharray="12,12" className="dash-line" />
                <g style={{ animation: 'moveTruck 8s linear infinite' }}>
                  <rect x="-15" y="40" width="30" height="20" rx="3" fill="#2563EB" />
                  <rect x="10" y="42" width="8" height="16" rx="1" fill="#06B6D4" />
                  <circle cx="0" cy="50" r="4" fill="#10B981" className="pulse-ring" />
                </g>
              </svg>
            </div>
            <div className="grid md:grid-cols-3 gap-12 text-center relative z-10">
              {[
                ['border-brand-100 text-brand-600', '1', 'Ulang', 'GPS treker va datchiklarni mashinalarga o\'rnatamiz yoki mavjudlarini tizimga ulaymiz.'],
                ['border-accent-100 text-accent-500', '2', 'Kuzating', 'Kompyuter yoki smartfon orqali barcha jarayonlarni real vaqt rejimida kuzatib boring.'],
                ['border-emerald-100 text-eco-500', '3', 'Tejang', 'Anomaliyalarni aniqlab, isrofgarchilikni to\'xtating va daromadingizni oshiring.'],
              ].map(([border, num, title, desc], i) => (
                <div key={title} className="reveal" style={{ transitionDelay: `${i * 200}ms` }}>
                  <div className={`w-20 h-20 mx-auto bg-white rounded-full shadow-lg border-4 ${border} flex items-center justify-center text-2xl font-bold mb-6`}>{num}</div>
                  <h4 className="text-xl font-bold text-slate-900 mb-2">{title}</h4>
                  <p className="text-slate-600">{desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* MODULLAR */}
      <section id="modullar" className="py-24 relative overflow-hidden bg-white">
        <div className="absolute top-0 right-0 w-1/3 h-full bg-brand-50 rounded-l-[100px] z-0 translate-x-1/2" />
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-20 reveal">
            <h2 className="text-brand-600 font-bold tracking-wide uppercase text-sm mb-3">Bizning Yechimlar</h2>
            <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">Har bir soha uchun moslashtirilgan</h3>
            <p className="text-lg text-slate-600">Sizning biznesingiz ehtiyojlariga qarab kerakli modulni tanlang.</p>
          </div>
          <div className="space-y-24">
            {[
              {
                chip: 'bg-brand-100 text-brand-600', accent: 'text-brand-500', title: 'AvtoHisob (Core)', img: '/landing/module-gps.png', imgWrap: 'from-brand-50 to-slate-100', reverse: false,
                desc: 'Asosiy modul. Avtoparkni to\'liq raqamlashtirish. GPS monitoring, yoqilg\'i sarfini nazorat qilish va ehtiyot qismlar tarixini yuritish uchun yaratilgan mukammal tizim.',
                feats: [['GPS Monitoring:', ' Barcha texnikalarning aniq joylashuvi va marshrutlari tarixi.'], ['Yoqilg\'i nazorati:', ' Zapravka qilingan va o\'g\'irlangan yoqilg\'ini aniq grafiklar bilan ko\'rish.'], ['Ta\'mir & Qismlar:', ' Har bir mashinaning xizmat ko\'rsatish tarixi va bir km narxini hisoblash.']],
              },
              {
                chip: 'bg-emerald-100 text-eco-600', accent: 'text-eco-500', title: 'Toza-Hudud', img: '/landing/module-waste.png', imgWrap: 'from-emerald-50 to-slate-100', reverse: true,
                desc: 'Obodonlashtirish va chiqindi yig\'ish korxonalari uchun maxsus yechim. Qaysi ko\'chalar tozalanganini va chiqindi tashilganini isbotlab beruvchi modul.',
                feats: [['Marshrut qoplami:', ' Mashina tozalangan ko\'chalarni xaritada bo\'yab ko\'rsatadi.'], ['Bajarilgan ish isboti:', ' Nazoratchilar uchun to\'liq hisobotlar.']],
              },
              {
                chip: 'bg-indigo-100 text-indigo-600', accent: 'text-indigo-500', title: 'EkoHisob', img: '/landing/module-payment.png', imgWrap: 'from-indigo-50 to-slate-100', reverse: false,
                desc: 'Kommunal xizmatlar va ekologiya inspektorlari uchun to\'lovlarni yig\'ish tizimi. Abonentlarni boshqarish va qarzdorlikni qisqartirish.',
                feats: [['Telegram Bot:', ' Inspektorlar joyida turib qarzdorlikni tekshirishi va to\'lov qabul qilishi mumkin.'], ['SMS ogohlantirish:', ' Qarzdorlarga avtomatik SMS yuborish orqali tushumlarni oshirish.']],
              },
            ].map(m => (
              <div key={m.title} className="lg:grid lg:grid-cols-2 gap-16 items-center reveal">
                <div className={`mb-10 lg:mb-0 ${m.reverse ? 'lg:order-2' : 'order-2 lg:order-1'}`}>
                  <div className="flex items-center space-x-4 mb-6">
                    <div className={`w-12 h-12 ${m.chip} rounded-xl flex items-center justify-center`}>
                      <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                      </svg>
                    </div>
                    <h3 className="text-3xl font-bold text-slate-900">{m.title}</h3>
                  </div>
                  <p className="text-lg text-slate-600 mb-8">{m.desc}</p>
                  <ul className="space-y-4 mb-8">
                    {m.feats.map(([b, t]) => (
                      <li key={b} className="flex items-start">
                        <svg className={`w-6 h-6 ${m.accent} mr-3 shrink-0`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        <span className="text-slate-700"><strong className="text-slate-900">{b}</strong>{t}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className={`relative rounded-[2rem] bg-gradient-to-br ${m.imgWrap} p-8 shadow-inner border border-white ${m.reverse ? 'mb-10 lg:mb-0 lg:order-1' : 'order-1 lg:order-2'}`}>
                  <img src={m.img} alt={m.title} className="w-full h-auto drop-shadow-2xl hover:scale-105 transition-transform duration-700" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* IMKONIYATLAR */}
      <section className="py-24 bg-slate-50 relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16 reveal">
            <h2 className="text-brand-600 font-bold tracking-wide uppercase text-sm mb-3">Imkoniyatlar</h2>
            <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">Bitta tizimda — hamma narsa</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {[
              ['bg-brand-100 text-brand-600', 'GPS Monitoring', 'Real vaqtda joylashuv va to\'liq marshrut tarixi.'],
              ['bg-red-100 text-red-600', 'Yoqilg\'i nazorati', 'O\'g\'irlik va g\'ayrioddiy sarfni avtomatik aniqlash.'],
              ['bg-indigo-100 text-indigo-600', 'Ta\'mir & ehtiyot qism', 'Har bir texnika xizmat tarixi va xarajati.'],
              ['bg-accent-100 text-accent-600', 'AI tahlil', 'Anomaliyalarni aniqlash va xarajat bashorati.'],
              ['bg-emerald-100 text-emerald-600', 'Hisobot & Eksport', 'Excel/PDF hisobot bir bosishda.'],
              ['bg-blue-100 text-blue-600', 'Telegram bot', 'Dala xodimlari uchun mobil boshqaruv.'],
            ].map(([chip, title, desc], i) => (
              <div key={title} className="glass-card bg-white p-6 rounded-3xl hover:shadow-glass-hover hover:-translate-y-2 transition-all duration-300 reveal border-slate-200" style={{ transitionDelay: `${(i + 1) * 100}ms` }}>
                <div className={`w-12 h-12 ${chip} rounded-xl flex items-center justify-center mb-4`}>
                  <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h4 className="text-lg font-bold text-slate-900 mb-2">{title}</h4>
                <p className="text-sm text-slate-600">{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* STATS */}
      <section className="py-20 bg-slate-900 text-white relative overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-8 text-center divide-x divide-slate-800">
            <div className="reveal">
              <p className="text-4xl md:text-5xl font-extrabold mb-2"><span className="stat-counter" data-count="94">0</span><span className="text-brand-400">+</span></p>
              <p className="text-slate-400 font-medium">Uzluksiz ishlayotgan texnika</p>
            </div>
            <div className="reveal" style={{ transitionDelay: '100ms' }}>
              <p className="text-4xl md:text-5xl font-extrabold mb-2">~<span className="stat-counter" data-count="15">0</span><span className="text-brand-400">%</span></p>
              <p className="text-slate-400 font-medium">O'rtacha xarajat tejalishi</p>
            </div>
            <div className="reveal" style={{ transitionDelay: '200ms' }}>
              <p className="text-4xl md:text-5xl font-extrabold mb-2"><span className="stat-counter" data-count="24">0</span>/7</p>
              <p className="text-slate-400 font-medium">Real vaqt monitoring</p>
            </div>
            <div className="reveal" style={{ transitionDelay: '300ms' }}>
              <div className="flex justify-center mb-2">
                <svg className="w-12 h-12 text-brand-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
                </svg>
              </div>
              <p className="text-slate-400 font-medium">Ma'lumotlar O'zbekistonda saqlanadi</p>
            </div>
          </div>
        </div>
      </section>

      {/* MIJOZLAR FIKRI */}
      <section className="py-24 relative bg-white overflow-hidden">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10">
          <div className="text-center max-w-3xl mx-auto mb-16 reveal">
            <h2 className="text-brand-600 font-bold tracking-wide uppercase text-sm mb-3">Mijozlar fikri</h2>
            <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">Bizga ishonishadi</h3>
          </div>
          <div className="grid md:grid-cols-3 gap-8">
            {[
              ['from-brand-400 to-accent-500', 'AK', 'Akmal Karimov', 'Rahbar, "Toshkent Logistika"', 'Yoqilg\'i o\'g\'irligi bizga oyiga millionlab zarar berardi. AvtoHisob bilan birinchi oyda 18% tejadik. Tizim anomaliyalarni o\'zi topib beradi.'],
              ['from-indigo-400 to-purple-500', 'DR', 'Dilshod Rasulov', 'Avtopark boshlig\'i', '94 ta texnikamizni bitta ekranda ko\'rib turaman. Avval hamma narsa qog\'ozda edi, endi hech narsa nazoratdan chetda qolmaydi.'],
              ['from-emerald-400 to-eco-600', 'NY', 'Nodira Yusupova', 'MCHJ, "Obod Hudud"', 'Inspektorlar dala\'da turib qarzdorlikni yig\'ishyapti. Tushum sezilarli oshdi va qog\'ozbozlik yo\'qoldi.'],
            ].map(([grad, initials, name, role, quote], i) => (
              <div key={name} className="glass-card bg-slate-50/50 p-8 rounded-3xl hover:shadow-glass-hover hover:-translate-y-2 transition-all duration-300 reveal border-slate-200" style={{ transitionDelay: `${(i + 1) * 100}ms` }}>
                <p className="text-slate-600 mb-6 relative">
                  <span className="text-4xl text-brand-200 absolute -top-4 -left-2">“</span>
                  {quote}
                </p>
                <div className="flex items-center space-x-4">
                  <div className={`w-12 h-12 rounded-full bg-gradient-to-br ${grad} flex items-center justify-center text-white font-bold text-lg shadow-md shrink-0`}>{initials}</div>
                  <div>
                    <h5 className="text-slate-900 font-bold text-sm">{name}</h5>
                    <p className="text-slate-500 text-xs">{role}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* TARIFLAR */}
      <section id="tariflar" className="py-24 bg-slate-50 relative">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center max-w-3xl mx-auto mb-16 reveal">
            <h3 className="text-3xl md:text-4xl font-extrabold text-slate-900 mb-4">Sarmoyani tez oqlaydigan tariflar</h3>
            <p className="text-lg text-slate-600">Yashirin to'lovlarsiz. Har qanday biznes o'lchami uchun qulay. <strong className="text-slate-900">14 kun tekin sinab ko'ring.</strong></p>
          </div>
          <div className="grid md:grid-cols-3 gap-8 max-w-6xl mx-auto items-center">
            {/* Boshlang'ich */}
            <div className="glass-card bg-white p-8 rounded-3xl reveal border-slate-200">
              <h4 className="text-xl font-bold text-slate-900 mb-2">Boshlang'ich</h4>
              <p className="text-slate-500 mb-6 text-sm">Kichik avtoparklar uchun baza</p>
              <div className="mb-6"><span className="text-4xl font-extrabold text-slate-900">45k</span> <span className="text-slate-500">so'm/oy mashinaga</span></div>
              <ul className="space-y-4 mb-8">
                {['Real-time GPS kuzatuv', 'Marshrut tarixi (1 oy)', 'Tezlik nazorati'].map(f => (
                  <li key={f} className="flex items-start text-slate-600">{check}{f}</li>
                ))}
              </ul>
              <Link to="/signup" className="block w-full text-center bg-slate-100 text-slate-900 font-semibold py-3 rounded-xl hover:bg-slate-200 transition-colors">Boshlash</Link>
            </div>
            {/* Biznes */}
            <div className="relative bg-gradient-brand p-[2px] rounded-[2rem] reveal shadow-2xl md:-translate-y-4" style={{ transitionDelay: '100ms' }}>
              <div className="absolute top-0 right-0 bg-red-500 text-white text-xs font-bold px-3 py-1 rounded-bl-xl rounded-tr-xl translate-x-1 -translate-y-1">Eng ommabop</div>
              <div className="bg-white p-8 rounded-[calc(2rem-2px)] h-full">
                <h4 className="text-xl font-bold text-brand-600 mb-2">Biznes</h4>
                <p className="text-slate-500 mb-6 text-sm">To'liq yoqilg'i nazorati</p>
                <div className="mb-6"><span className="text-4xl font-extrabold text-slate-900">85k</span> <span className="text-slate-500">so'm/oy mashinaga</span></div>
                <ul className="space-y-4 mb-8">
                  {['Boshlang\'ich barcha funksiyalar', 'Yoqilg\'i datchigi integratsiyasi', 'O\'g\'irlik & anomaliya alertlari', 'Ta\'mirlash va qismlar hisobi'].map(f => (
                    <li key={f} className="flex items-start text-slate-600">{check}{f}</li>
                  ))}
                </ul>
                <Link to="/signup" className="block w-full text-center bg-brand-600 text-white font-semibold py-3 rounded-xl hover:bg-brand-700 shadow-[0_4px_14px_0_rgba(37,99,235,0.39)] transition-all">14 kun bepul</Link>
              </div>
            </div>
            {/* Korxona */}
            <div className="glass-card bg-white p-8 rounded-3xl reveal border-slate-200" style={{ transitionDelay: '200ms' }}>
              <h4 className="text-xl font-bold text-slate-900 mb-2">Korxona</h4>
              <p className="text-slate-500 mb-6 text-sm">Yirik kompaniyalar uchun</p>
              <div className="mb-6"><span className="text-3xl font-extrabold text-slate-900">Kelishilgan narx</span></div>
              <ul className="space-y-4 mb-8">
                {['Cheksiz tarix & AI tahlil', '1C va ERP integratsiyasi', 'Maxsus modul (Toza-Hudud / EkoHisob)', 'Shaxsiy menejer (VIP)'].map(f => (
                  <li key={f} className="flex items-start text-slate-600">{check}{f}</li>
                ))}
              </ul>
              <Link to="/signup" className="block w-full text-center bg-slate-100 text-slate-900 font-semibold py-3 rounded-xl hover:bg-slate-200 transition-colors">Bog'lanish</Link>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="py-24 bg-white">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="text-center mb-12 reveal">
            <h3 className="text-3xl font-extrabold text-slate-900 mb-4">Ko'p beriladigan savollar</h3>
          </div>
          <div className="space-y-4 reveal">
            {faqs.map(([q, a], i) => (
              <div key={q} className="border border-slate-200 rounded-2xl overflow-hidden bg-slate-50/50">
                <button onClick={() => setOpenFaq(openFaq === i ? null : i)} className="w-full px-6 py-4 text-left flex justify-between items-center text-slate-900 font-semibold">
                  {q}
                  <svg className={`w-5 h-5 text-slate-400 transition-transform ${openFaq === i ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                  </svg>
                </button>
                {openFaq === i && <div className="px-6 pb-4 text-slate-600">{a}</div>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-brand" />
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 relative z-10 text-center reveal">
          <h2 className="text-4xl md:text-5xl font-extrabold text-white mb-6">Bugun isrofni to'xtating</h2>
          <p className="text-xl text-brand-100 mb-10 max-w-2xl mx-auto">
            Raqobatchilaringiz allaqachon avtoparkni raqamlashtirib, millionlab mablag' tejamoqda. Siz qachongacha kutasiz?
          </p>
          <Link to="/signup" className="inline-block bg-white text-brand-600 px-8 py-4 rounded-full text-lg font-bold hover:shadow-2xl hover:scale-105 transition-all duration-300">14 kun bepul boshlash</Link>
          <p className="mt-4 text-sm text-brand-200">Hech qanday to'lov kartasi talab qilinmaydi.</p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="bg-slate-900 border-t border-slate-800 pt-16 pb-8">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-12 mb-12">
            <div>
              <a href="#top" className="text-2xl font-extrabold tracking-tight text-white mb-4 block">Avto<span className="text-brand-400">Hisob</span></a>
              <p className="text-slate-400 mb-4">Avtoparkingiz ustidan to'liq nazorat va isrofgarchilikka chek qo'yish tizimi.</p>
              <div className="flex items-center text-emerald-400 text-sm font-medium">
                <svg className="w-4 h-4 mr-2" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M2.166 4.999A11.954 11.954 0 0010 1.944 11.954 11.954 0 0017.834 5c.11.65.166 1.32.166 2.001 0 5.225-3.34 9.67-8 11.317C5.34 16.67 2 12.225 2 7c0-.682.057-1.35.166-2.001zm11.541 3.708a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
                </svg>
                Ma'lumotlaringiz O'zbekistonda saqlanadi
              </div>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Modullar</h4>
              <ul className="space-y-2">
                {['AvtoHisob (Core)', 'Toza-Hudud', 'EkoHisob'].map(x => (
                  <li key={x}><a href="#modullar" className="text-slate-400 hover:text-white transition-colors">{x}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Kompaniya</h4>
              <ul className="space-y-2">
                {['Biz haqimizda', 'Mijozlar', 'Blog'].map(x => (
                  <li key={x}><a href="#top" className="text-slate-400 hover:text-white transition-colors">{x}</a></li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-white font-semibold mb-4">Bog'lanish</h4>
              <ul className="space-y-2 text-slate-400">
                <li>+998 (90) 123-45-67</li>
                <li>info@avtohisob.uz</li>
                <li className="mt-4">Toshkent shahar, Yunusobod tumani</li>
              </ul>
            </div>
          </div>
          <div className="border-t border-slate-800 pt-8 flex flex-col md:flex-row justify-between items-center">
            <p className="text-slate-500 text-sm">© 2026 AvtoHisob. Barcha huquqlar himoyalangan.</p>
            <div className="flex space-x-4 mt-4 md:mt-0 text-sm text-slate-500">
              <a href="#top" className="hover:text-white transition-colors">Maxfiylik siyosati</a>
              <a href="#top" className="hover:text-white transition-colors">Foydalanish shartlari</a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}
