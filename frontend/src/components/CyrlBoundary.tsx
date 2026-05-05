/**
 * CyrlBoundary — uz-cyrl tilida butun saytda hardcoded lotin matnlarini
 * avtomatik kirillga o'tkazadi.
 *
 * Mantiq: MutationObserver orqali DOM text node'larni kuzatadi.
 * Til uz-cyrl bo'lsa — har bir node matnini latToCyrl bilan o'tkazadi.
 * Tildan chiqilsa — barcha node'lar asl lotin matniga qaytariladi.
 *
 * QO'SHIMCHA: placeholder, title, aria-label, alt atributlari ham
 * transliteratsiya qilinadi (input ko'rinib turadigan matnlar).
 *
 * Skip qilinadigan joylar:
 *   - <code>, <pre>, <kbd>, <samp> — texnik blok
 *   - .no-translate sinfli element ichidagi har qanday matn (escape hatch)
 *   - <input value=...> — foydalanuvchi kiritgan ma'lumot tegilmaydi
 *     (text node'da emas, lekin atributlardan placeholder OK)
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

// Text node'lar uchun skip selektor (input value matni qutqarish)
const SKIP_SELECTOR = 'input, textarea, select, [contenteditable="true"], code, pre, kbd, samp, .no-translate'

// Atributlar uchun skip selektor —
// input/textarea'da placeholder atributini transliterate qilamiz, value emas.
// Lekin .no-translate ichidagi hech narsa tegmaydi.
const SKIP_ATTR_SELECTOR = 'code, pre, kbd, samp, .no-translate'

// Transliteratsiya qilinadigan atributlar
const TRANSLATE_ATTRS = ['placeholder', 'title', 'aria-label', 'alt'] as const

// Har bir transliteratsiya qilingan node uchun asl matn saqlanadi —
// til o'zgarganda qaytarish mumkin.
const PROCESSED = new WeakMap<Text, string>()

// Atribut'lar uchun: element → atrName → asl lotin qiymati
const PROCESSED_ATTRS = new WeakMap<Element, Record<string, string>>()

function shouldSkipText(node: Text): boolean {
  const parent = node.parentElement
  if (!parent) return true
  if (SKIP_TAGS.has(parent.tagName)) return true
  if (parent.closest(SKIP_SELECTOR)) return true
  return false
}

function shouldSkipAttrs(el: Element): boolean {
  if (el.closest(SKIP_ATTR_SELECTOR)) return true
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

function transliterateAttrs(el: Element) {
  if (shouldSkipAttrs(el)) return
  let stored = PROCESSED_ATTRS.get(el)
  for (const attr of TRANSLATE_ATTRS) {
    const val = el.getAttribute(attr)
    if (!val || !val.trim()) continue
    // Agar saqlangan asl qiymat bor bo'lsa va hozirgi qiymat o'zgarmagan — skip
    if (stored && stored[attr] !== undefined) continue
    const cyrl = latToCyrl(val)
    if (cyrl !== val) {
      if (!stored) { stored = {}; PROCESSED_ATTRS.set(el, stored) }
      stored[attr] = val // asl lotin qiymatni eslab qolamiz
      el.setAttribute(attr, cyrl)
    }
  }
}

function revertAttrs(el: Element) {
  const stored = PROCESSED_ATTRS.get(el)
  if (!stored) return
  for (const attr of Object.keys(stored)) {
    el.setAttribute(attr, stored[attr])
  }
  PROCESSED_ATTRS.delete(el)
}

function walkAndTransliterate(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    transliterateNode(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  // 1) Element'ning o'zining atributlarini ko'rib chiqamiz
  const rootEl = root as Element
  transliterateAttrs(rootEl)
  // 2) Ichidagi text node'lar
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let n: Node | null
  while ((n = textWalker.nextNode())) {
    transliterateNode(n as Text)
  }
  // 3) Ichidagi element'lar atributlari (querySelectorAll bilan tezkor)
  rootEl.querySelectorAll('[placeholder], [title], [aria-label], [alt]').forEach(transliterateAttrs)
}

function walkAndRevert(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) {
    revertNode(root as Text)
    return
  }
  if (root.nodeType !== Node.ELEMENT_NODE) return
  const rootEl = root as Element
  revertAttrs(rootEl)
  const textWalker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  let n: Node | null
  while ((n = textWalker.nextNode())) {
    revertNode(n as Text)
  }
  rootEl.querySelectorAll('[placeholder], [title], [aria-label], [alt]').forEach(revertAttrs)
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
          } else if (m.type === 'attributes' && m.target.nodeType === Node.ELEMENT_NODE) {
            // Atribut o'zgarganda — qaytadan transliterate qilamiz
            // (React state'idan yangilangan placeholder va h.k. uchun)
            const el = m.target as Element
            const attr = m.attributeName
            if (attr && (TRANSLATE_ATTRS as readonly string[]).includes(attr)) {
              // Avval asl saqlangan bo'lsa — yangi qiymat lat bo'lsa qaytadan transliterate
              const stored = PROCESSED_ATTRS.get(el)
              if (stored) {
                // Atributni "yangidan" hisoblash uchun storage'dan o'chiramiz
                delete stored[attr]
                if (Object.keys(stored).length === 0) PROCESSED_ATTRS.delete(el)
              }
              transliterateAttrs(el)
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
      attributes: true,
      attributeFilter: ['placeholder', 'title', 'aria-label', 'alt'],
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
