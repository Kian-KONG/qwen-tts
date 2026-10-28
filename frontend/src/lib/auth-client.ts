import { createAuthClient } from "better-auth/react";

function authBaseURL(): string {
  const configured = String(import.meta.env.VITE_API_BASE || "").replace(/\/$/, "");
  if (configured) return configured;
  if (typeof window === "undefined") return "http://localhost:8000";
  return window.location.origin;
}

export const authClient = createAuthClient({
  baseURL: authBaseURL(),
});
