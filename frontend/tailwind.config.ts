import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      fontFamily: {
        sans: ["PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans SC", "sans-serif"],
      },
    },
  },
  plugins: [],
};

export default config;
