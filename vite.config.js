import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

/* GitHub Pages는 /wrongnote/ 하위에 서비스되지만 dev 서버와 Playwright는
   루트 기준으로 돌기 때문에, base는 build 일 때만 붙인다. */
const GITHUB_PAGES_BASE = "/wrongnote/";

export default defineConfig(({ command, isPreview }) => ({
  base: command === "build" || isPreview ? GITHUB_PAGES_BASE : "/",
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg", "apple-touch-icon.png"],
      manifest: {
        name: "수능 오답노트",
        short_name: "오답노트",
        description: "수능 오답을 기록하고 다시 풀어보는 개인 오답노트",
        lang: "ko",
        start_url: ".",
        scope: ".",
        display: "standalone",
        background_color: "#e7ddcb",
        theme_color: "#fbf7ef",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
        // Pretendard Variable 하나가 2MB에 육박해서 기본 한도(2MiB)를 넘긴다.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  server: {
    host: true,
  },
}));
