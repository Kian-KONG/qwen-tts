import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const pagesBase = process.env.GITHUB_PAGES_BASE || "/qwen-tts/";

export default defineConfig({
  plugins: [react()],
  base: process.env.GITHUB_PAGES === "1" ? pagesBase : "/",
  server: {
    port: 5173,
    proxy: {
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
