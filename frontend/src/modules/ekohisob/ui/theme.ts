/**
 * Portal (Modal, Menu, Tooltip) `document.body` ostida turadi, ya'ni `.eko-app`
 * dan tashqarida. Qorong'i rejim ularda ham ishlashi uchun joriy rejimni
 * `.eko-app` dan o'qib, portal ildiziga ko'chiramiz.
 */
export function currentTheme(): 'dark' | 'light' {
  if (typeof document === 'undefined') return 'light'
  const root = document.querySelector('.eko-app')
  if (!root) return 'light'
  return root.getAttribute('data-theme') === 'dark' || root.classList.contains('eko-dark') ? 'dark' : 'light'
}

/** `<div className="eko-scope" {...portalProps()}>` */
export function portalProps(): { 'data-theme': 'dark' | 'light' } {
  return { 'data-theme': currentTheme() }
}
