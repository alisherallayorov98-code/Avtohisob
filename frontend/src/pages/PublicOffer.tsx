import { Printer } from 'lucide-react'

export default function PublicOffer() {
  return (
    <div className="min-h-screen bg-gray-50 py-8 px-4">
      {/* Print tugmasi — chop etishda yashiriladi */}
      <div className="max-w-3xl mx-auto mb-4 flex justify-end print:hidden">
        <button
          onClick={() => window.print()}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition-colors"
        >
          <Printer className="w-4 h-4" />
          Chop etish / PDF saqlash
        </button>
      </div>

      {/* Hujjat */}
      <div
        id="oferta-doc"
        className="max-w-3xl mx-auto bg-white shadow-sm rounded-xl p-10 text-gray-900 text-sm leading-relaxed print:shadow-none print:rounded-none print:p-0"
      >
        {/* Sarlavha */}
        <div className="text-center mb-8 space-y-1">
          <p className="text-xs text-gray-500 uppercase tracking-widest">Ommaviy oferta</p>
          <h1 className="text-xl font-bold">AVTOHISOB.UZ XIZMATLARIDAN FOYDALANISH</h1>
          <h2 className="text-lg font-semibold">OMMAVIY OFERTA SHARTNOMASI</h2>
          <p className="text-sm text-gray-500 mt-2">
            Samarqand, 2024-yil
          </p>
        </div>

        {/* Tashkilot ma'lumotlari */}
        <div className="border border-gray-200 rounded-lg p-5 mb-6 bg-gray-50">
          <p className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">Taklif etuvchi tashkilot rekvizitlari</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm">
            <div>
              <span className="text-gray-500">Tashkilot nomi:</span>
              <p className="font-semibold">"JAMSHIDBEK NUR KURGAN" MCHJ</p>
            </div>
            <div>
              <span className="text-gray-500">STIR (INN):</span>
              <p className="font-mono font-semibold">307367795</p>
            </div>
            <div>
              <span className="text-gray-500">MFO:</span>
              <p className="font-mono font-semibold">01037</p>
            </div>
            <div>
              <span className="text-gray-500">Hisob raqami:</span>
              <p className="font-mono font-semibold">20208000505219713001</p>
            </div>
            <div className="col-span-2">
              <span className="text-gray-500">Manzil:</span>
              <p className="font-semibold">
                Samarqand viloyati, Kattaqo'rg'on tumani, Ingichka, Nurobod MFY,
                O'zbekiston ko'chasi, 17-uy, 7-xonadon
              </p>
            </div>
            <div>
              <span className="text-gray-500">Direktor:</span>
              <p className="font-semibold">ALLAYOROV ALISHER ISMOIL O'G'LI</p>
            </div>
            <div>
              <span className="text-gray-500">Bosh hisobchi:</span>
              <p className="font-semibold">ALLAYOROV ALISHER ISMOIL O'G'LI</p>
            </div>
            <div>
              <span className="text-gray-500">Elektron pochta:</span>
              <p className="font-semibold">info@avtohisob.uz</p>
            </div>
            <div>
              <span className="text-gray-500">Veb-sayt:</span>
              <p className="font-semibold">avtohisob.uz</p>
            </div>
          </div>
        </div>

        {/* Asosiy matn */}
        <div className="space-y-5 text-[13px] leading-7">
          <section>
            <h3 className="font-bold text-base mb-2">1. Umumiy qoidalar</h3>
            <p>
              1.1. Ushbu hujjat "JAMSHIDBEK NUR KURGAN" MCHJ (bundan buyon "Kompaniya" deb yuritiladi) tomonidan
              taqdim etilayotgan <strong>avtohisob.uz</strong> veb-platformasidan (bulutli avtoparkni boshqarish tizimi)
              foydalanish shartlariga oid Ommaviy oferta hisoblanadi.
            </p>
            <p>
              1.2. Ushbu oferta O'zbekiston Respublikasi Fuqarolik kodeksining 369-moddasiga muvofiq
              cheksiz doiradagi shaxslarga yo'naltirilgan va aksept (qabul qilish) amalga oshirilgan
              paytdan boshlab yuridik kuchga ega shartnoma sifatida e'tirof etiladi.
            </p>
            <p>
              1.3. Platformadan ro'yxatdan o'tish, foydalanish yoki to'lov amalga oshirish orqali
              foydalanuvchi ushbu oferta shartlarini to'liq va so'zsiz qabul qilganligini tasdiqlaydi.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-base mb-2">2. Xizmatlar predmeti</h3>
            <p>
              2.1. Kompaniya foydalanuvchiga <strong>avtohisob.uz</strong> platformasi orqali quyidagi
              xizmatlarni ko'rsatadi:
            </p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Transport parkini raqamli boshqarish (yo'l varaqlari, ta'mirlash, yonilg'i hisobi)</li>
              <li>Haydovchilar va texnikani ro'yxatga olish va nazorat qilish</li>
              <li>Xarajatlar va byudjetni tahlil qilish</li>
              <li>GPS monitoring va real-vaqt kuzatuv (tarif bo'yicha)</li>
              <li>Hisobot va eksport imkoniyatlari</li>
              <li>Texnik yordam va platforma yangilanishlari</li>
            </ul>
            <p>
              2.2. Xizmatlar hajmi va imkoniyatlari tanlangan tarif rejasiga (Free, Starter,
              Professional, Enterprise) bog'liq.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-base mb-2">3. To'lov shartlari</h3>
            <p>
              3.1. Xizmatlardan foydalanish narxi <strong>avtohisob.uz/billing</strong> sahifasida
              joriy narxlar bo'yicha belgilanadi.
            </p>
            <p>
              3.2. To'lov bank ko'chirma orqali amalga oshirilganda to'lov bayonotida quyidagi
              matn ko'rsatilishi shart:
            </p>
            <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2 font-mono text-xs my-2">
              Ommaviy ofertaga asosan avtohisob.uz saytidan foydalanish uchun to'lov
            </div>
            <p>
              3.3. To'lov amalga oshirilgandan so'ng obuna avtomatik faollashtiriladi.
              Texnik muammo yuz bersa Kompaniya 1 ish kuni ichida bartaraf etadi.
            </p>
            <p>
              3.4. Oylik obuna har oyning 1-kunida, yillik obuna yil boshida to'lanadi.
              Muddatidan oldin bekor qilingan obuna uchun qolgan davr to'lovi qaytarilmaydi.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-base mb-2">4. Tomonlarning huquq va majburiyatlari</h3>
            <p><strong>4.1. Kompaniya majburiyatlari:</strong></p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Platformani uzluksiz ishlash holatida saqlash (oyiga 99% uptime)</li>
              <li>Foydalanuvchi ma'lumotlarini O'zbekiston serverlarida saqlash</li>
              <li>Ma'lumotlarni uchinchi shaxslarga bermaslik</li>
              <li>Texnik yordam ko'rsatish (info@avtohisob.uz)</li>
            </ul>
            <p className="mt-2"><strong>4.2. Foydalanuvchi majburiyatlari:</strong></p>
            <ul className="list-disc pl-5 space-y-1">
              <li>Platformadan faqat qonuniy maqsadlarda foydalanish</li>
              <li>Login va parolni maxfiy saqlash</li>
              <li>To'lovlarni belgilangan muddatda amalga oshirish</li>
              <li>Kiritilgan ma'lumotlarning to'g'riligini ta'minlash</li>
            </ul>
          </section>

          <section>
            <h3 className="font-bold text-base mb-2">5. Ma'lumotlar va maxfiylik</h3>
            <p>
              5.1. Foydalanuvchi ma'lumotlari O'zbekiston Respublikasi hududidagi serverlarda saqlanadi.
            </p>
            <p>
              5.2. Kompaniya foydalanuvchi ma'lumotlarini uchinchi shaxslarga, davlat organlaridan
              rasmiy so'rovdan tashqari, bermaydi.
            </p>
            <p>
              5.3. Batafsil maxfiylik siyosati: <strong>avtohisob.uz/privacy-policy</strong>
            </p>
          </section>

          <section>
            <h3 className="font-bold text-base mb-2">6. Javobgarlikni cheklash</h3>
            <p>
              6.1. Kompaniya foydalanuvchi tomonidan noto'g'ri kiritilgan ma'lumotlar oqibatida
              kelib chiqqan zararlar uchun javobgar emas.
            </p>
            <p>
              6.2. Kompaniya force-majeure (tabiiy ofat, urush, energiya ta'minoti uzilishi va h.k.)
              holatlarda xizmat ko'rsata olmaslik uchun javobgar emas.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-base mb-2">7. Shartnomaning amal qilish muddati</h3>
            <p>
              7.1. Shartnoma aksept amalga oshirilgan kundan kuchga kiradi va obuna muddati tugaguncha
              yoki tomonlardan biri shartnomani bekor qilmaguncha amal qiladi.
            </p>
            <p>
              7.2. Kompaniya ushbu oferta shartlarini 30 kun oldindan xabardor qilish bilan
              o'zgartirish huquqini saqlaydi.
            </p>
          </section>

          <section>
            <h3 className="font-bold text-base mb-2">8. Nizolarni hal qilish</h3>
            <p>
              8.1. Nizolar avval muzokaralar orqali hal qilinadi. Kelishuv bo'lmasa,
              O'zbekiston Respublikasining amaldagi qonunchiligiga muvofiq sud tartibida ko'rib chiqiladi.
            </p>
          </section>
        </div>

        {/* Imzo qismi */}
        <div className="mt-10 border-t border-gray-200 pt-6">
          <div className="grid grid-cols-2 gap-8 text-sm">
            <div>
              <p className="font-bold mb-3">TAKLIF ETUVCHI:</p>
              <p>"JAMSHIDBEK NUR KURGAN" MCHJ</p>
              <p className="text-gray-500 text-xs mt-1">STIR: 307367795 | MFO: 01037</p>
              <p className="text-gray-500 text-xs">H/r: 20208000505219713001</p>
              <div className="mt-8 border-t border-gray-400 pt-1">
                <p className="text-xs text-gray-500">Direktor: ALLAYOROV A.I.</p>
              </div>
            </div>
            <div>
              <p className="font-bold mb-3">QABUL QILUVCHI:</p>
              <p className="text-gray-400 text-xs mt-2">
                Platforma ro'yxatidan o'tish yoki to'lov amalga oshirish orqali
                ushbu oferta qabul qilingan hisoblanadi.
              </p>
              <div className="mt-8 border-t border-gray-400 pt-1">
                <p className="text-xs text-gray-500">Tashkilot muhri / imzo</p>
              </div>
            </div>
          </div>
        </div>

        <p className="text-center text-xs text-gray-400 mt-8">
          avtohisob.uz · info@avtohisob.uz · © {new Date().getFullYear()} "JAMSHIDBEK NUR KURGAN" MCHJ
        </p>
      </div>

      {/* Print styles */}
      <style>{`
        @media print {
          body { background: white; }
          #oferta-doc { max-width: 100%; }
        }
      `}</style>
    </div>
  )
}
