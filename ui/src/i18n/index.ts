import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import { es } from './locales/es'

export const copy = es

const STORAGE_KEY = 'winecore-locale'

export function fill(template: string, vars: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => vars[key] ?? '')
}

if (!i18n.isInitialized) {
  void i18n.use(initReactI18next).init({
    resources: { es: { translation: es } },
    lng: 'es',
    fallbackLng: 'es',
    supportedLngs: ['es'],
    interpolation: { escapeValue: false },
  })
  if (typeof document !== 'undefined') document.documentElement.lang = 'es'
  try {
    localStorage.setItem(STORAGE_KEY, 'es')
  } catch {
    /* Private mode. The language is still Spanish. */
  }
}

export { i18n }
