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

export function isDefaultScript(text: string): boolean {
  return text === zh.script.sample || text === en.script.sample;
}

const DOOR_LOCK_RE =
  /^(?:门锁|door[\s-]*lock)\s*(\d+)?\s*(中文|英文|英语|chinese|english|japanese|korean|日语|日文|韩语|韩文)?$/i;

const LANG_TOKEN_TO_ID: Record<string, string> = {
  中文: "Chinese",
  英文: "English",
  英语: "English",
  chinese: "Chinese",
  english: "English",
  japanese: "Japanese",
  korean: "Korean",
  日语: "Japanese",
  日文: "Japanese",
  韩语: "Korean",
  韩文: "Korean",
};

function langIdFromToken(token?: string): string {
  if (!token) return "";
  return LANG_TOKEN_TO_ID[token] || LANG_TOKEN_TO_ID[token.toLowerCase()] || "";
}

export function displayScriptName(name?: string): string {
  const raw = (name || "").trim();
  if (!raw) return "";
  if (raw === zh.script.fallbackName || raw === en.script.fallbackName) {
    return t("script.fallbackName");
  }
  const match = raw.match(DOOR_LOCK_RE);
  if (!match) return raw;
  const n = match[1];
  const langId = langIdFromToken(match[2]);
  const langText = langId ? languageLabel(langId) : "";
  if (n && langText) return t("lists.doorLockLang", { n, lang: langText });
  if (n) return t("lists.doorLockN", { n });
  if (langText) return t("lists.doorLockLangOnly", { lang: langText });
  return t("lists.doorLock");
}

export function displayJobTitle(job: {
  title?: string;
  script_name?: string | null;
  id?: string;
}): string {
  const stored = (job.script_name || "").trim();
  const title = (job.title || job.id || "").trim();
  if (stored && title.startsWith(stored)) {
    return displayScriptName(stored) + title.slice(stored.length);
  }
  if (!title) return displayScriptName(stored);
  const sep = " · ";
  const index = title.indexOf(sep);
  if (index === -1) return displayScriptName(title);
  return displayScriptName(title.slice(0, index)) + title.slice(index);
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
