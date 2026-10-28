import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { cors } from "hono/cors";

import { auth } from "./auth";
import { loadRootEnv } from "./load-env";

loadRootEnv();

const port = Number(process.env.AUTH_PORT || 3001);
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:8000";

const app = new Hono();
app.use(
  "/api/auth/*",
  cors({
    origin: (origin) => origin || baseURL,
    credentials: true,
    allowHeaders: ["Content-Type", "Authorization", "Cookie"],
    allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  }),
);
app.on(["POST", "GET", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"], "/api/auth/*", (c) => auth.handler(c.req.raw));

serve({ fetch: app.fetch, port, hostname: "127.0.0.1" }, (info) => {
  console.log(`[auth] Better Auth on http://127.0.0.1:${info.port}`);
});
