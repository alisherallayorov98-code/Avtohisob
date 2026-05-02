/**
 * CyrlBoundary — uz-cyrl tilida butun saytda hardcoded lotin matnlarini
 * avtomatik kirillga o'tkazadi.
 *
 * Mantiq: MutationObserver orqali DOM text node'larni kuzatadi.
 * Til uz-cyrl bo'lsa — har bir node matnini latToCyrl bilan o'tkazadi.
 * Tildan chiqilsa — barcha node'lar asl lotin matniga qaytariladi.
 *
 * Skip qilinadigan joylar:
 *   - <input>, <textarea>, <select> — foydalanuvchi kiritgan ma'lumot
 *   - <code>, <pre>, <kbd>, <samp> — texnik blok
 *   - .no-translate sinfli element ichidagi har qanday matn (escape hatch)
 *
 * Idempotentlik: latToCyrl kirillda no-op (kirill harflari mapga kirmaydi),
 * shuning uchun ikki marta bajarilsa zarar yo'q.
 */
import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { latToCyrl } from '../lib/latToCyrl'

const SKIP_TAGS = new Set([
  'INPUT', 'TEXTAREA', 'SELECT', 'OPTION',
  'SCRIPT', 'STYLE', 'NOSCRIPT',
  'CODE', 'PRE', 'KBD', 'SAMP',
])

const SKIP_SELECTOR = 'input, textarea, select, [contenteditable="true"], code, pre, kbd, samp, .no-translate'

// Har bir transliteratsiya qilingan node uchun asl matn saqlanadi —
// til o'zgarganda qaytarish mumkin.
const PROCESSED = new WeakMap<Text, string>()

function shouldSkipText(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return true
  if (SKIP_TAGS.has(parent.tagName)) return true
  if (parent.closest(SKIP_SELECTOR)) return true
  return false
}

function transliterateNode(node: Text) {
  if (shouldSkipText(node)) return
  const text = node.nodeValue
  if (!text || !text.trim()) return
  // Allaqachon transliterate qilingan va o'zgarmagan?
  const stored = PROCESSED.get(node)
  if (stored !== undefined && stored === text) return
  const cyrl = latToCyrl(text)
  if (cyrl !== text) {
    PROCESSED.set(node, text) // asl lotin matnini eslab qolamiz
    node.nodeValue = cyrl
  }
}

function revertNode(node: Text) {
  const original = PROCESSED.get(node)
  if (original !== undefined && node.nodeValue !== original) {
    node.nodeValue = original
  }
  PROCESSED.delete(node)
}

function walkAndTransliterate(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    transliterateNode(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let n: Node | null
  while ((n = walker.nextNode())) {
    transliterateNode(n as Text)
  }
}

function walkAndRevert(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    revertNode(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let n: Node | null
  while ((n = walker.nextNode())) {
    revertNode(n as Text)
  }
}

export default function CyrlBoundary({ children }: { children: React.ReactNode }) {
  const { i18n } = useTranslation()

  useEffect(() => {
    const isCyrl = i18n.language === 'uz-cyrl'
    if (!isCyrl) return // Boshqa tillar uchun hech narsa qilmaymiz

    // Birinchi marta — render tugagandan keyin butun document'ni o'tkazamiz
    const initialId = setTimeout(() => walkAndTransliterate(document.body), 0)

    // Yangi qo'shilgan content uchun MutationObserver
    let mutating = false
    const observer = new MutationObserver((mutations) => {
      if (mutating) return // O'z mutatsiyalarimiz tufayli rekursiv tushishni oldini olamiz
      mutating = true
      try {
        for (const m of mutations) {
          if (m.type === 'characterData') {
            const t = m.target as Text
            if (t.nodeType === Node.TEXT_NODE) transliterateNode(t)
          } else if (m.type === 'childList') {
            for (let i = 0; i < m.addedNodes.length; i++) {
              walkAndTransliterate(m.addedNodes[i])
            }
          }
        }
      } finally {
        // Microtask sungida flag'ni ochamiz — sinxron mutatsiyalarni jamlash
        Promise.resolve().then(() => { mutating = false })
      }
    })

    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    })

    return () => {
      clearTimeout(initialId)
      observer.disconnect()
      // Tildan chiqilsa — hammasini asl lotin matniga qaytaramiz
      walkAndRevert(document.body)
    }
  }, [i18n.language])

  return <>{children}</>
}
