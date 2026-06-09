import { useState, useEffect, useRef } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, X, Sparkles, Check } from 'lucide-react'
import api from '../lib/api'
import { useAuthStore } from '../stores/authStore'

/**
 * Yangi foydalanuvchi uchun qadam-qadam yo'riqnoma.
 * Saytga birinchi marta kirgan foydalanuvchiga ko'rsatiladi.
 * Tugatilgach onboardingCompletedAt saqlanadi va boshqa ko'rinmaydi.
 *
 * Yordam → "Yo'riqnomani qaytadan ko'rsatish" tugmasi orqali qaytarish mumkin.
 */

interface Step {
  /** Sarlavha */
  title: string
  /** Tushuntirish matni */
  description: string
  /** Sidebar item'iga bog'lash uchun data-tour qiymati. Bo'lmasa — markaziy modal */
  targetTour?: string
  /** Markazda yoki yon tomonda */
  placement?: 'center' | 'right' | 'right-top'
  /** Ikon (optional emoji) */
  emoji?: string
}

const STEPS: Step[] = [
  {
    title: '👋 Xush kelibsiz!',
    description:
      "AvtoHisob — sizning avtoparkingizni boshqarish tizimi. Sizga eng muhim joylarni 1-2 daqiqada ko'rsataman. " +
      "Istalgan vaqt 'O'tkazib yuborish' bossangiz, Yordam bo'limidan qaytadan ko'rishingiz mumkin.",
    placement: 'center',
    emoji: '🚀',
  },
  {
    title: '1️⃣ Avtomashinalar',
    description:
      "Birinchi qadam — mashinalaringizni saytga kiritish. Chap menyudan 'Avtomashinalar' bo'limini oching, " +
      "'+ Qo'shish' tugmasi orqali har birini qo'shing: davlat raqami, brand, model, yili, yoqilg'i turi va h.k.",
    targetTour: 'vehicles',
    placement: 'right',
    emoji: '🚗',
  },
  {
    title: '2️⃣ Skladlar va Ehtiyot qismlar',
    description:
      "Sklad katalogini sozlang: 'Skladlar' (omborlar) va 'Ehtiyot qismlar' (qism turlari). " +
      "Keyin 'Ombor' bo'limidan har skladdagi miqdorni kiriting. " +
      "Eslatma: kirim turi 🟢 Rasmiy yoki 🟠 Norasmiy bo'lishi mumkin (buxgalteriya uchun ajratiladi).",
    targetTour: 'spare-parts',
    placement: 'right',
    emoji: '📦',
  },
  {
    title: '3️⃣ Texnik xizmat',
    description:
      "Har ta'mir/xizmat yozuvini shu yerda qayd qiling. Mashina, sklad, qaysi qism, qancha narxda — " +
      "hammasini tanlang. Tizim avtomatik omborni kamaytiradi va xarajat yaratadi.",
    targetTour: 'maintenance',
    placement: 'right',
    emoji: '🔧',
  },
  {
    title: "4️⃣ Yoqilg'i",
    description:
      "Quyish vaqtida: mashina, kim quyganligi, miqdori (litr), narxi va odometr ko'rsatkichi. " +
      "Tizim avtomatik xarajat hisoblaydi va tahlil uchun saqlaydi.",
    targetTour: 'fuel',
    placement: 'right',
    emoji: '⛽',
  },
  {
    title: '5️⃣ Xarajatlar',
    description:
      "Boshqa har qanday xarajatlar (ish haqi, xizmatlar, soliq va h.k.) — bu yerga. " +
      "Mashinaga bog'langan yoki umumiy bo'lishi mumkin. Excel orqali eksport qilish mumkin.",
    targetTour: 'expenses',
    placement: 'right',
    emoji: '💰',
  },
  {
    title: '6️⃣ Hisobotlar',
    description:
      "Bu yerda barcha ma'lumotlar grafik va jadvallarda ko'rinadi. " +
      "Davriy (kunlik/oylik), mashina bo'yicha, yetkazuvchi bo'yicha. Excel formatda yuklab olish mumkin.",
    targetTour: 'reports',
    placement: 'right',
    emoji: '📊',
  },
  {
    title: '7️⃣ Sozlamalar',
    description:
      "Foydalanuvchilar (xodimlar uchun login), GPS ulanish, Telegram bot, " +
      "kategoriyalar — bularning hammasi shu yerda. Birinchi navbatda 'Filiallar' va 'Foydalanuvchilar'ni sozlang.",
    targetTour: 'settings',
    placement: 'right',
    emoji: '⚙️',
  },
  {
    title: '✅ Tayyor!',
    description:
      "Endi siz asosiy joylarni bilasiz. Boshqa savollar bo'lsa: pastdagi 'Yordam' bo'limiga qarang yoki " +
      "Telegram orqali aloqada bo'ling: t.me/avtohisob_uz",
    placement: 'center',
    emoji: '🎉',
  },
]

export default function OnboardingTour() {
  const { user } = useAuthStore()
  const qc = useQueryClient()
  const [currentStep, setCurrentStep] = useState(0)
  const [active, setActive] = useState(false)
  const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)
  const cardRef = useRef<HTMLDivElement>(null)

  // Yo'riqnoma faollikni boshlash:
  // - Login bo'lgan foydalanuvchi
  // - Maxfiylik qabul qilingan
  // - Onboarding hali tugatilmagan
  useEffect(() => {
    if (!user) { setActive(false); return }
    if (!user.termsAcceptedAt) return // avval terms qabul qilinsin
    if (user.onboardingCompletedAt) { setActive(false); return }
    // Foydalanuvchi forever-skip qilgan bo'lsa localStorage'da
    const skipped = localStorage.getItem('onboarding_skipped_' + user.id)
    if (skipped) return
    setActive(true)
  }, [user])

  // External event orqali qaytadan ochish (Yordam sahifasidan)
  useEffect(() => {
    const onReplay = () => {
      setCurrentStep(0)
      setActive(true)
    }
    window.addEventListener('onboarding:replay', onReplay)
    return () => window.removeEventListener('onboarding:replay', onReplay)
  }, [])

  // Highlight target sidebar item position
  useEffect(() => {
    if (!active) { setHighlightRect(null); return }
    const step = STEPS[currentStep]
    if (!step.targetTour) { setHighlightRect(null); return }
    const el = document.querySelector(`[data-tour="${step.targetTour}"]`) as HTMLElement | null
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' })
      setTimeout(() => setHighlightRect(el.getBoundingClientRect()), 300)
    } else {
      setHighlightRect(null)
    }
  }, [active, currentStep])

  const completeMutation = useMutation({
    mutationFn: () => api.post('/auth/complete-onboarding', { reset: false }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['me'] })
      const cur = useAuthStore.getState().user
      if (cur) useAuthStore.setState({ user: { ...cur, onboardingCompletedAt: new Date().toISOString() } as any })
      setActive(false)
    },
  })

  const skip = () => {
    if (user) localStorage.setItem('onboarding_skipped_' + user.id, '1')
    setActive(false)
  }

  const next = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(s => s + 1)
    else completeMutation.mutate()
  }
  const prev = () => { if (currentStep > 0) setCurrentStep(s => s - 1) }

  if (!active) return null

  const step = STEPS[currentStep]
  const isFirst = currentStep === 0
  const isLast = currentStep === STEPS.length - 1
  const placement = step.placement || (step.targetTour ? 'right' : 'center')

  // Card pozitsiyasi — sidebar item yonida yoki ekran o'rtasida.
  // MUHIM: card har doim ekran ichida qolishi kerak — aks holda "Keyingi/Orqaga"
  // tugmalari ekran pastiga sig'may, foydalanuvchi tiqilib qoladi.
  const cardStyle: React.CSSProperties = (() => {
    if (placement === 'center' || !highlightRect) {
      return {
        position: 'fixed',
        left: '50%',
        top: '50%',
        transform: 'translate(-50%, -50%)',
        maxWidth: '480px',
        width: 'calc(100vw - 32px)',
        maxHeight: 'calc(100vh - 32px)',
      }
    }
    // Right placement — sidebar item yonida, lekin tepa/past ekran ichida cheklanadi.
    // est. card balandligi ~440px; card pasti ekrandan chiqib ketmasligi uchun top'ni cheklaymiz.
    const EST_CARD_H = 440
    const maxTop = Math.max(16, window.innerHeight - EST_CARD_H - 16)
    return {
      position: 'fixed',
      left: `${highlightRect.right + 16}px`,
      top: `${Math.max(16, Math.min(highlightRect.top - 8, maxTop))}px`,
      maxWidth: '380px',
      width: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 32px)',
    }
  })()

  // Highlight (rectangular border) for target element
  const highlightStyle: React.CSSProperties | null = highlightRect ? {
    position: 'fixed',
    left: `${highlightRect.left - 4}px`,
    top: `${highlightRect.top - 4}px`,
    width: `${highlightRect.width + 8}px`,
    height: `${highlightRect.height + 8}px`,
    border: '3px solid #3b82f6',
    borderRadius: '10px',
    pointerEvents: 'none',
    boxShadow: '0 0 0 4px rgba(59, 130, 246, 0.25)',
    animation: 'pulse 2s infinite',
    zIndex: 9999,
  } : null

  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[9998] bg-black/50 backdrop-blur-[2px]" onClick={skip} />

      {/* Highlight rectangle */}
      {highlightStyle && <div style={highlightStyle} />}

      {/* Tour card */}
      <div
        ref={cardRef}
        style={cardStyle}
        className="z-[10000] bg-white dark:bg-gray-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-gray-700 overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-blue-50 to-indigo-50 dark:from-blue-900/20 dark:to-indigo-900/20 shrink-0">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span className="text-xs font-semibold text-blue-700 dark:text-blue-300 uppercase tracking-wide">
              Yo'riqnoma — {currentStep + 1} / {STEPS.length}
            </span>
          </div>
          <button onClick={skip} className="p-1 hover:bg-white/50 rounded-lg" title="Yopish">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>

        {/* Content — uzun bo'lsa scroll bo'ladi, tugmalar baribir ko'rinadi */}
        <div className="p-6 overflow-y-auto flex-1">
          {step.emoji && <div className="text-4xl mb-2 text-center">{step.emoji}</div>}
          <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
            {step.title}
          </h3>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed">
            {step.description}
          </p>
        </div>

        {/* Progress + buttons — har doim ko'rinadi (shrink-0) */}
        <div className="px-5 py-3 border-t border-gray-100 dark:border-gray-700 bg-gray-50 dark:bg-gray-900/30 shrink-0">
          {/* Progress */}
          <div className="flex gap-1 mb-3">
            {STEPS.map((_, i) => (
              <div
                key={i}
                className={`flex-1 h-1 rounded-full transition-colors ${
                  i <= currentStep ? 'bg-blue-600' : 'bg-gray-200 dark:bg-gray-700'
                }`}
              />
            ))}
          </div>

          {/* Buttons */}
          <div className="flex items-center justify-between gap-2">
            <button
              onClick={skip}
              className="text-xs text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            >
              O'tkazib yuborish
            </button>
            <div className="flex gap-2">
              {!isFirst && (
                <button
                  onClick={prev}
                  className="flex items-center gap-1 px-3 py-1.5 text-sm bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Orqaga
                </button>
              )}
              <button
                onClick={next}
                disabled={completeMutation.isPending}
                className="flex items-center gap-1 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isLast ? (
                  <><Check className="w-3.5 h-3.5" /> Tugatish</>
                ) : (
                  <>Keyingi <ChevronRight className="w-3.5 h-3.5" /></>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Animatsiya uchun CSS */}
      <style>{`
        @keyframes pulse {
          0%, 100% { box-shadow: 0 0 0 4px rgba(59, 130, 246, 0.25); }
          50% { box-shadow: 0 0 0 8px rgba(59, 130, 246, 0.15); }
        }
      `}</style>
    </>
  )
}

/** Yordam sahifasidan onboarding'ni qaytadan ochish uchun helper */
export function replayOnboarding() {
  window.dispatchEvent(new CustomEvent('onboarding:replay'))
}
