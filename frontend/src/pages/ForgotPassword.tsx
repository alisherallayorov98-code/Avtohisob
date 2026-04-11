import { Link } from 'react-router-dom'
import { ArrowLeft, ShieldCheck, Key, Users } from 'lucide-react'

export default function ForgotPassword() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-950 px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 text-white text-2xl font-bold mb-4 shadow-lg">A</div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Parolni tiklash</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Tizim administratori parolni tiklaydi
          </p>
        </div>

        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-200 dark:border-gray-700 p-8 space-y-5">
          <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-100 dark:border-blue-800 rounded-xl">
            <ShieldCheck className="w-5 h-5 text-blue-500 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-blue-700 dark:text-blue-300">
              AvtoHisob — korporativ tizim. Foydalanuvchilar admin tomonidan qo'shiladi va boshqariladi.
            </p>
          </div>

          <div className="space-y-3">
            <div className="flex items-start gap-3 p-4 border border-gray-100 dark:border-gray-700 rounded-xl">
              <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">1</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Tizim adminingizga murojaat qiling</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Kompaniyangizning AvtoHisob tizimiga mas'ul shaxsga xabar bering
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 border border-gray-100 dark:border-gray-700 rounded-xl">
              <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">2</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Admin parolni yangilaydi</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Admin: Sozlamalar → Foydalanuvchilar → Tahrirlash → Yangi parol
                </p>
              </div>
            </div>

            <div className="flex items-start gap-3 p-4 border border-gray-100 dark:border-gray-700 rounded-xl">
              <div className="w-7 h-7 rounded-full bg-gray-100 dark:bg-gray-700 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-xs font-bold text-gray-600 dark:text-gray-300">3</span>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900 dark:text-white">Yangi parol bilan kiring</p>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                  Admin sizga yangi parolni xabar qiladi, shundan so'ng kirishingiz mumkin
                </p>
              </div>
            </div>
          </div>

          <div className="pt-1 flex flex-col gap-2">
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <Key className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Tizimga kirish muammosi bo'lsa, IT bo'limingiz bilan bog'laning
              </span>
            </div>
            <div className="flex items-center gap-2 p-3 bg-gray-50 dark:bg-gray-700 rounded-lg">
              <Users className="w-4 h-4 text-gray-400 flex-shrink-0" />
              <span className="text-xs text-gray-500 dark:text-gray-400">
                Adminlar: Sozlamalar → Xavfsizlik bo'limida o'z parolini o'zgartira oladi
              </span>
            </div>
          </div>
        </div>

        <div className="mt-6 text-center">
          <Link to="/login" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200">
            <ArrowLeft className="w-4 h-4" />
            Kirish sahifasiga qaytish
          </Link>
        </div>
      </div>
    </div>
  )
}
