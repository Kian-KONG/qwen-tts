import path from "node:path";
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const pagesBase = process.env.GITHUB_PAGES_BASE || "/qwen-tts/";
const root = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(root, "src"),
    },
  },
  base: process.env.GITHUB_PAGES === "1" ? pagesBase : "/",
  server: {
    port: 5173,
    proxy: {
      "/api/auth": "http://127.0.0.1:3001",
      "/api": "http://127.0.0.1:8000",
      "/v1": "http://127.0.0.1:8000",
      "/health": "http://127.0.0.1:8000",
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
