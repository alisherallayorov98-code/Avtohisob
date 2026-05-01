import { Link } from 'react-router-dom'
import { Shield, ArrowLeft } from 'lucide-react'

export default function PrivacyPolicy() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm text-blue-600 dark:text-blue-400 hover:underline mb-4">
          <ArrowLeft className="w-4 h-4" /> Asosiy sahifaga
        </Link>

        <div className="bg-white dark:bg-gray-800 rounded-2xl border border-gray-200 dark:border-gray-700 p-8 space-y-6">
          <div className="flex items-center gap-3 pb-4 border-b border-gray-200 dark:border-gray-700">
            <Shield className="w-7 h-7 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Maxfiylik siyosati</h1>
              <p className="text-sm text-gray-500 dark:text-gray-400">avtohisob.uz</p>
            </div>
          </div>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">1. Umumiy qoidalar</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              Ushbu Maxfiylik siyosati "AvtoHisob" MChJ (STIR: 307367795) tomonidan boshqariladigan
              <b> avtohisob.uz</b> saytidan foydalanuvchilarning shaxsiy ma'lumotlarini qayta ishlash
              tartibini belgilaydi. Saytdan foydalanish orqali siz ushbu siyosatga rozilik bildirasiz.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">2. To'planadigan ma'lumotlar</h2>
            <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>Shaxsiy ma'lumotlar: ism-familiya, email, telefon raqami</li>
              <li>Tashkilot ma'lumotlari: nomi, manzili, INN, bank rekvizitlari</li>
              <li>Ish ma'lumotlari: avtomashinalar, ehtiyot qismlar, xarajatlar, GPS treklari</li>
              <li>Texnik ma'lumotlar: IP-manzil, brauzer turi, kirish vaqtlari</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">3. Ma'lumotlardan foydalanish</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">
              Sizning ma'lumotlaringiz quyidagi maqsadlarda ishlatiladi:
            </p>
            <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>Saytda xizmat ko'rsatish va hisobingizni boshqarish</li>
              <li>Hisobotlar, dalolatnomalar va boshqa hujjatlarni tayyorlash</li>
              <li>To'lovlar va obuna tizimini boshqarish</li>
              <li>Texnik qo'llab-quvvatlash va aloqa</li>
              <li>Tizimni yaxshilash va statistika</li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">4. Ma'lumotlarni saqlash joyi</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              O'zbekiston Respublikasi qonunchiligiga muvofiq, foydalanuvchilarning shaxsiy ma'lumotlari
              <b> faqat O'zbekiston hududidagi serverlarda</b> saqlanadi va qayta ishlanadi. Hech qanday
              tashqi (xorijiy) bulutli xizmatlardan foydalanilmaydi.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">5. Ma'lumotlarni uchinchi shaxslarga berish</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              Sizning ma'lumotlaringiz uchinchi shaxslarga sotilmaydi va berilmaydi, qonunda nazarda
              tutilgan hollar bundan mustasno (sud qarori, soliq nazorati va h.k.).
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">6. Cookies (kuki fayllari)</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              Sayt foydalanuvchini aniqlash va xizmat sifatini oshirish uchun cookie fayllaridan
              foydalanadi. Brauzer sozlamalarida cookie'larni o'chirish mumkin, lekin bunda saytning
              ayrim funksiyalari ishlamasligi mumkin.
            </p>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">7. Foydalanuvchining huquqlari</h2>
            <ul className="text-sm text-gray-700 dark:text-gray-300 space-y-1.5 list-disc list-inside leading-relaxed">
              <li>Shaxsiy ma'lumotlaringizni ko'rish va o'zgartirish</li>
              <li>Hisobingizni o'chirish va ma'lumotlarni butunlay yo'qotish</li>
              <li>Hisobot olish — sizning ma'lumotlaringiz qanday ishlatilganligi haqida</li>
              <li>Aloqa: <a href="mailto:info@avtohisob.uz" className="text-blue-600 dark:text-blue-400 hover:underline">info@avtohisob.uz</a></li>
            </ul>
          </section>

          <section>
            <h2 className="text-lg font-bold text-gray-900 dark:text-white mb-2">8. O'zgarishlar</h2>
            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
              Ushbu siyosat vaqti-vaqti bilan yangilanishi mumkin. Muhim o'zgarishlar haqida
              foydalanuvchilarga email yoki sayt orqali xabar beriladi.
            </p>
          </section>

          <div className="border-t border-gray-200 dark:border-gray-700 pt-4 text-xs text-gray-500 dark:text-gray-400">
            <p>Oxirgi yangilangan: 2026-yil, may oyi</p>
            <p className="mt-1">"AvtoHisob" MChJ — STIR: 307367795</p>
          </div>
        </div>
      </div>
    </div>
  )
}
