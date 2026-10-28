let token: string | null = null;

export function getSessionToken(): string | null {
  return token;
}

export function setSessionToken(next: string | null): void {
  token = next;
}

export function tokenFromAuthData(data: { session?: { token?: string } | null } | null | undefined): string | null {
  return data?.session?.token ?? null;
}
