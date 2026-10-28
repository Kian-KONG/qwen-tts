import type { DatabaseSync } from "node:sqlite";

const STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS "user" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "email" TEXT NOT NULL UNIQUE,
    "email_verified" INTEGER NOT NULL DEFAULT 0,
    "image" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS "session" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "expires_at" TEXT NOT NULL,
    "token" TEXT NOT NULL UNIQUE,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "user_id" TEXT NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "ix_session_user_id" ON "session" ("user_id")`,
  `CREATE TABLE IF NOT EXISTS "account" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "account_id" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "id_token" TEXT,
    "access_token_expires_at" TEXT,
    "refresh_token_expires_at" TEXT,
    "scope" TEXT,
    "password" TEXT,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL,
    FOREIGN KEY ("user_id") REFERENCES "user" ("id") ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS "ix_account_user_id" ON "account" ("user_id")`,
  `CREATE TABLE IF NOT EXISTS "verification" (
    "id" TEXT PRIMARY KEY NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expires_at" TEXT NOT NULL,
    "created_at" TEXT NOT NULL,
    "updated_at" TEXT NOT NULL
  )`,
];

export function ensureAuthSchema(database: DatabaseSync): void {
  database.exec("PRAGMA journal_mode = WAL");
  database.exec("PRAGMA foreign_keys = ON");
  for (const statement of STATEMENTS) {
    database.exec(statement);
  }
}
