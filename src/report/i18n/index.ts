/**
 * i18n system: build-time locale loading.
 * Supported: 'en' (default), 'zh-CN'. Unknown locales fall back to 'en'.
 */

export type { Translations } from './types.js'
import type { Translations } from './types.js'
import { en } from './en.js'
import { zhCN } from './zh-CN.js'

const LOCALES: Record<string, Translations> = {
  'en': en,
  'zh-CN': zhCN,
}

export function loadLocale(locale: string): Translations {
  return LOCALES[locale] ?? en
}
