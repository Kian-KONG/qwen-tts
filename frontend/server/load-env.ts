import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SERVER_DIR = dirname(fileURLToPath(import.meta.url));
export const FRONTEND_DIR = resolve(SERVER_DIR, "..");
export const ROOT_DIR = resolve(FRONTEND_DIR, "..");

function parseEnv(text: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const cut = line.indexOf("=");
    if (cut <= 0) continue;
    const key = line.slice(0, cut).trim();
    let value = line.slice(cut + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

export function loadRootEnv(): void {
  const envPath = resolve(ROOT_DIR, ".env");
  if (!existsSync(envPath)) return;
  const parsed = parseEnv(readFileSync(envPath, "utf8"));
  for (const [key, value] of Object.entries(parsed)) {
    if (process.env[key] == null || process.env[key] === "") {
      process.env[key] = value;
    }
  }
}

export function authDatabasePath(): string {
  const fromPath = (process.env.AUTH_DB_PATH || "").trim();
  if (fromPath) return resolve(ROOT_DIR, fromPath);
  const configured = (process.env.BETTER_AUTH_DATABASE_URL || "").trim();
  if (configured && !configured.startsWith("postgres") && !configured.startsWith("mysql")) {
    const file = configured.replace(/^sqlite:\/\//, "").replace(/^file:/, "");
    return resolve(ROOT_DIR, file);
  }
  return resolve(ROOT_DIR, "data", "auth.sqlite");
}
