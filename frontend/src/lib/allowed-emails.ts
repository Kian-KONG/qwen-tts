export function isAllowedEmail(email: string, allowlist: string): boolean {
  const allowed = allowlist
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  if (!allowed.length) return false;
  return allowed.includes(email.trim().toLowerCase());
}
