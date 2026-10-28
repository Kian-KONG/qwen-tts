import { isAuthPage } from "./auth-routes";

const APP_HASH_ROUTES = new Set(["/", "/transcribe", "/asr", "/translate", "/live", "/captions"]);

export function stripBase(pathname: string): string {
  const base = String(import.meta.env.BASE_URL || "/").replace(/\/$/, "");
  if (base && (pathname === base || pathname.startsWith(`${base}/`))) {
    return pathname.slice(base.length) || "/";
  }
  return pathname || "/";
}

export function currentAppPath(): string {
  const hash = window.location.hash.replace(/^#/, "");
  const hashPath = (hash.split("?")[0] || "").replace(/\/+$/, "") || (hash.startsWith("/") ? "/" : "");
  if (hashPath && (isAuthPage(hashPath) || APP_HASH_ROUTES.has(hashPath))) {
    return hashPath;
  }
  const path = stripBase(window.location.pathname).replace(/\/+$/, "") || "/";
  return path;
}

export function currentSearch(): URLSearchParams {
  const hash = window.location.hash.replace(/^#/, "");
  const hashQuery = hash.includes("?") ? hash.slice(hash.indexOf("?") + 1) : "";
  const merged = new URLSearchParams(window.location.search);
  for (const [key, value] of new URLSearchParams(hashQuery)) {
    if (!merged.has(key)) merged.set(key, value);
  }
  return merged;
}

export function loginHref(next?: string): string {
  const target = next && next.startsWith("/") && !next.startsWith("//") ? next : "/";
  const query = target && target !== "/" ? `?next=${encodeURIComponent(target)}` : "";
  return `#/login${query}`;
}

export function appHref(path: string): string {
  if (isAuthPage(path)) return `#${path}`;
  if (path === "/" || path === "") return "#/";
  return `#${path.startsWith("/") ? path : `/${path}`}`;
}
