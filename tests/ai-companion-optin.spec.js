import { test, expect } from "@playwright/test";
import { freshApp } from "./helpers.js";

const COMPANION = "http://127.0.0.1:43119/v1";

test("AI bridge is network-silent until opt-in and preference write failure cannot break the toggle", async ({ page }) => {
  await page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && key === "wr_ai_companion_enabled") {
        const err = new Error("preference storage unavailable");
        err.name = "QuotaExceededError";
        throw err;
      }
      return original.call(this, key, value);
    };
  });

  let companionRequests = 0;
  await page.route(`${COMPANION}/**`, async (route) => {
    companionRequests += 1;
    const request = route.request();
    const origin = request.headers()["origin"] || "*";
    const headers = {
      "Access-Control-Allow-Origin": origin,
      "Access-Control-Allow-Headers": "Content-Type, Access-Control-Request-Private-Network",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Private-Network": "true",
      "Content-Type": "application/json",
    };
    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers, body: "" });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({ ok: true, status: "busy", expiresAt: Date.now() + 60_000 }),
    });
  });

  await freshApp(page);
  await page.waitForTimeout(500);
  expect(companionRequests).toBe(0);

  const toggle = page.getByTestId("ai-companion-enable");
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  await toggle.click();

  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(toggle).toContainText("AI 연결됨");
  await expect.poll(() => companionRequests).toBeGreaterThan(0);
});
