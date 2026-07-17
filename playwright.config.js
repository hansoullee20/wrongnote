import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: "http://localhost:5199",
    viewport: { width: 820, height: 1180 }, // 태블릿 세로
  },
  webServer: {
    command: "npm run dev -- --port 5199 --strictPort",
    port: 5199,
    reuseExistingServer: true,
    timeout: 30_000,
  },
});
