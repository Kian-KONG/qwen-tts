import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { betterAuth } from "better-auth";
import { APIError } from "better-auth/api";

import { isAllowedEmail } from "../src/lib/allowed-emails";
import { assertProductionSecret } from "./auth-secret";
import { authDatabasePath, loadRootEnv } from "./load-env";
import { ensureAuthSchema } from "./schema";
import { sendResetPasswordEmail } from "./send-reset-email";

loadRootEnv();

function extraOrigins(): string[] {
  return (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function createAuth() {
  const secret = assertProductionSecret();
  const databasePath = authDatabasePath();
  mkdirSync(dirname(databasePath), { recursive: true });
  const database = new DatabaseSync(databasePath);
  ensureAuthSchema(database);

  const baseURL = process.env.BETTER_AUTH_URL || process.env.FRONTEND_URL || "http://localhost:8000";
  return betterAuth({
    secret,
    baseURL,
    database,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: false,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => {
        void sendResetPasswordEmail({ to: user.email, url }).catch((error) => {
          console.error("[auth] failed to send password reset email", error);
        });
      },
    },
    user: {
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    session: {
      fields: {
        expiresAt: "expires_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    account: {
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    verification: {
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
    },
    databaseHooks: {
      user: {
        create: {
          before: async (user) => {
            const allowlist = process.env.AUTH_ALLOWED_EMAILS || "";
            if (!isAllowedEmail(user.email, allowlist)) {
              throw new APIError("FORBIDDEN", { message: "该邮箱未在允许名单中" });
            }
            return { data: user };
          },
        },
      },
    },
    trustedOrigins: [
      baseURL,
      "http://localhost:5173",
      "http://127.0.0.1:5173",
      "http://localhost:8000",
      "http://127.0.0.1:8000",
      "https://kian-kong.github.io",
      ...extraOrigins(),
    ],
  });
}

type Auth = ReturnType<typeof createAuth>;

let authInstance: Auth | undefined;

function getAuth(): Auth {
  if (!authInstance) {
    authInstance = createAuth();
  }
  return authInstance;
}

export const auth: Auth = new Proxy({} as Auth, {
  get(_target, prop, receiver) {
    const instance = getAuth();
    const value = Reflect.get(instance, prop, receiver);
    return typeof value === "function" ? value.bind(instance) : value;
  },
  has(_target, prop) {
    return prop in getAuth();
  },
});
