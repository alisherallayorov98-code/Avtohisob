/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      colors: {
        brand: {
          50: '#eff6ff', 100: '#dbeafe', 200: '#bfdbfe', 300: '#93c5fd',
          400: '#60a5fa', 500: '#3b82f6', 600: '#2563eb', 700: '#1d4ed8',
          800: '#1e40af', 900: '#1e3a8a',
        },
        accent: { 100: '#cffafe', 400: '#22d3ee', 500: '#06b6d4', 600: '#0891b2' },
        eco: { 500: '#10b981', 600: '#059669' },

        // ── EkoHisob dizayn tokenlari ────────────────────────────────────
        // Qiymatlar modules/ekohisob/ui/tokens.css dagi CSS o'zgaruvchilaridan
        // olinadi va faqat `.eko-app` ichida amal qiladi. Bu kalitlar QO'SHIMCHA:
        // AutoHisob (brand) va Toza Hudud klasslariga umuman ta'sir qilmaydi.
        eko: {
          canvas: 'rgb(var(--eko-canvas) / <alpha-value>)',
          surface: 'rgb(var(--eko-surface) / <alpha-value>)',
          'surface-2': 'rgb(var(--eko-surface-2) / <alpha-value>)',
          'surface-3': 'rgb(var(--eko-surface-3) / <alpha-value>)',
          line: 'rgb(var(--eko-line) / <alpha-value>)',
          'line-strong': 'rgb(var(--eko-line-strong) / <alpha-value>)',
          text: 'rgb(var(--eko-text) / <alpha-value>)',
          'text-2': 'rgb(var(--eko-text-2) / <alpha-value>)',
          muted: 'rgb(var(--eko-muted) / <alpha-value>)',
          subtle: 'rgb(var(--eko-subtle) / <alpha-value>)',
          accent: 'rgb(var(--eko-accent) / <alpha-value>)',
          'accent-hover': 'rgb(var(--eko-accent-hover) / <alpha-value>)',
          'accent-soft': 'rgb(var(--eko-accent-soft) / <alpha-value>)',
          'accent-line': 'rgb(var(--eko-accent-line) / <alpha-value>)',
          'accent-text': 'rgb(var(--eko-accent-text) / <alpha-value>)',
          success: 'rgb(var(--eko-success) / <alpha-value>)',
          'success-soft': 'rgb(var(--eko-success-soft) / <alpha-value>)',
          'success-line': 'rgb(var(--eko-success-line) / <alpha-value>)',
          warn: 'rgb(var(--eko-warn) / <alpha-value>)',
          'warn-soft': 'rgb(var(--eko-warn-soft) / <alpha-value>)',
          'warn-line': 'rgb(var(--eko-warn-line) / <alpha-value>)',
          danger: 'rgb(var(--eko-danger) / <alpha-value>)',
          'danger-soft': 'rgb(var(--eko-danger-soft) / <alpha-value>)',
          'danger-line': 'rgb(var(--eko-danger-line) / <alpha-value>)',
          info: 'rgb(var(--eko-info) / <alpha-value>)',
          'info-soft': 'rgb(var(--eko-info-soft) / <alpha-value>)',
          'info-line': 'rgb(var(--eko-info-line) / <alpha-value>)',
          'level-0': 'rgb(var(--eko-level-0) / <alpha-value>)',
          'level-1': 'rgb(var(--eko-level-1) / <alpha-value>)',
          'level-2': 'rgb(var(--eko-level-2) / <alpha-value>)',
          'level-3': 'rgb(var(--eko-level-3) / <alpha-value>)',
          'level-x': 'rgb(var(--eko-level-x) / <alpha-value>)',
        },
      },
      borderRadius: {
        eko: 'var(--eko-radius)',
        'eko-lg': 'var(--eko-radius-lg)',
      },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(31, 38, 135, 0.07)',
        'glass-hover': '0 12px 40px 0 rgba(37, 99, 235, 0.15)',
        // EkoHisob: ikkita daraja — yuza (karta) va suzuvchi (modal/dropdown)
        eko: 'var(--eko-shadow)',
        'eko-lg': 'var(--eko-shadow-lg)',
      },
      animation: {
        float: 'float 6s ease-in-out infinite',
        'float-delayed': 'float 6s ease-in-out 3s infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0)' },
          '50%': { transform: 'translateY(-20px)' },
        },
      },
    },
  },
  plugins: [],
}