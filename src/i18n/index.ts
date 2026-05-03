import type { Locale } from "../types";
import { enUS, zhCN } from "./locales";

export const DEFAULT_LOCALE: Locale = "zh-CN";
export const LOCALE_STORAGE_KEY = "skilldeck:locale";

export type TranslationKey = keyof typeof zhCN;
export type TFunction = (
  key: TranslationKey,
  params?: Record<string, string | number>,
) => string;

const dictionaries = {
  "zh-CN": zhCN,
  "en-US": enUS,
} satisfies Record<Locale, Record<TranslationKey, string>>;

export function isLocale(value: string | null): value is Locale {
  return value === "zh-CN" || value === "en-US";
}

export function getInitialLocale(): Locale {
  const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  return isLocale(stored) ? stored : DEFAULT_LOCALE;
}

export function persistLocale(locale: Locale) {
  window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
}

export function createTranslator(locale: Locale): TFunction {
  const dictionary = dictionaries[locale] ?? dictionaries[DEFAULT_LOCALE];

  return (key, params) => {
    let value = dictionary[key] ?? dictionaries[DEFAULT_LOCALE][key] ?? key;

    if (params) {
      for (const [paramKey, paramValue] of Object.entries(params)) {
        value = value.replaceAll(`{${paramKey}}`, String(paramValue));
      }
    }

    return value;
  };
}
