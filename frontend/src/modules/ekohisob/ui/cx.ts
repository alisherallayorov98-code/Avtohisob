/**
 * Klass nomlarini birlashtiradi. `false | null | undefined` tashlanadi.
 * Tashqi kutubxona (clsx) qo'shmaslik uchun — bir necha qator kod.
 */
export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ')
}
