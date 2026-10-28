export const AUTH_PAGES = ["/login", "/register", "/forgot-password", "/reset-password"] as const;

const REDIRECT_IF_SESSION = new Set<string>(["/login", "/register", "/forgot-password"]);

export function isAuthPage(pathname: string): boolean {
  return (AUTH_PAGES as readonly string[]).includes(pathname);
}

export function shouldRedirectIfSession(pathname: string): boolean {
  return REDIRECT_IF_SESSION.has(pathname);
}
