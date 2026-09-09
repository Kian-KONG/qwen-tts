import { createContext, createElement, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { en } from "./en";
import { zh, type Messages } from "./zh";

export type Locale = "zh" | "en";

export const LOCALES: Locale[] = ["zh", "en"];
export const LOCALE_STORAGE_KEY = "qwen-tts-locale";

const catalogs: Record<Locale, Messages> = { zh, en };

type Vars = Record<string, string | number>;

function getByPath(messages: Messages, path: string): unknown {
  return path.split(".").reduce<unknown>((node, key) => {
    if (node && typeof node === "object" && key in node) {
      return (node as Record<string, unknown>)[key];
    }
    return undefined;
  }, messages);
}

function interpolate(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, key: string) =>
    vars[key] === undefined ? `{${key}}` : String(vars[key]),
  );
}

export function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem(LOCALE_STORAGE_KEY);
    if (stored === "zh" || stored === "en") return stored;
  } catch {
    /* ignore */
  }
  const lang = typeof navigator !== "undefined" ? navigator.language : "zh";
  return lang.toLowerCase().startsWith("zh") ? "zh" : "en";
}

export function localeHtmlLang(locale: Locale): string {
  return locale === "zh" ? "zh-CN" : "en";
}

let currentLocale: Locale = detectLocale();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return currentLocale;
}

export function t(path: string, vars?: Vars, fallback?: string): string {
  const raw = getByPath(catalogs[currentLocale], path);
  if (typeof raw === "string") return interpolate(raw, vars);
  const zhRaw = getByPath(zh, path);
  if (typeof zhRaw === "string") return interpolate(zhRaw, vars);
  return fallback ?? path;
}

export function tx(path: string, fallback: string, vars?: Vars): string {
  const translated = t(path, vars);
  return translated === path ? fallback : translated;
}

export function languageLabel(id?: string, fallback?: string): string {
  if (!id) return fallback || "";
  return tx(`lang.${id}`, fallback || id);
}

export function voiceNative(native?: string): string {
  if (!native) return "";
  return tx(`lang.${native}`, native);
}

export function voiceDescription(kind: "speakers" | "kokoro", id: string, fallback?: string): string {
  return tx(`${kind}.${id}`, fallback || "");
}

function applyDocumentLocale(locale: Locale): void {
  if (typeof document === "undefined") return;
  document.documentElement.lang = localeHtmlLang(locale);
  document.title = t("app.title");
}

export function setLocale(next: Locale): void {
  if (currentLocale === next) return;
  currentLocale = next;
  try {
    localStorage.setItem(LOCALE_STORAGE_KEY, next);
  } catch {
    /* ignore */
  }
  applyDocumentLocale(next);
  listeners.forEach((listener) => listener());
}

export function isDefaultClonePrompt(text: string): boolean {
  return text === zh.msg.clonePrompt || text === en.msg.clonePrompt || !text.trim();
}

type I18nValue = {
  locale: Locale;
  t: typeof t;
  setLocale: typeof setLocale;
};

const I18nContext = createContext<I18nValue>({
  locale: currentLocale,
  t,
  setLocale,
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(currentLocale);

  useEffect(() => {
    applyDocumentLocale(currentLocale);
    const unsub = subscribeLocale(() => setLocaleState(getLocale()));
    const onStorage = (event: StorageEvent) => {
      if (event.key !== LOCALE_STORAGE_KEY) return;
      if (event.newValue === "zh" || event.newValue === "en") setLocale(event.newValue);
    };
    window.addEventListener("storage", onStorage);
    return () => {
      unsub();
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const value = useMemo<I18nValue>(() => ({ locale, t, setLocale }), [locale]);
  return createElement(I18nContext.Provider, { value }, children);
}

export function useI18n(): I18nValue {
  return useContext(I18nContext);
}

export function subscribeLocale(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
