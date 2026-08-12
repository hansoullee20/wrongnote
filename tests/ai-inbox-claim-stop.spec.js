import { test, expect } from "@playwright/test";
import { freshApp } from "./helpers.js";

const COMPANION = "http://127.0.0.1:43119/v1";

test("permanent claim rejection stops polling instead of renewing a pinned session", async ({ page }) => {
  let acquireCalls = 0;
  let claimCalls = 0;
  let renewCalls = 0;

  await page.route(`${COMPANION}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
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
    if (url.pathname.endsWith("/session/acquire")) {
      acquireCalls += 1;
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ ok: true, status: "acquired", fence: 1, expiresAt: Date.now() + 60_000 }),
      });
      return;
    }
    if (url.pathname.endsWith("/claim")) {
      claimCalls += 1;
      await route.fulfill({
        status: 400,
        headers,
        body: JSON.stringify({
          ok: false,
          error: { code: "invalid_claim_request", message: "mock permanent claim rejection" },
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/session/renew")) {
      renewCalls += 1;
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ ok: true, status: "renewed", expiresAt: Date.now() + 60_000 }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({ ok: true, status: "ok" }),
    });
  });

  await freshApp(page);
  await page.getByTestId("ai-companion-enable").click();

  await expect(page.getByTestId("ai-inbox-notice")).toContainText("자동 재시도를 멈췄다", {
    timeout: 10_000,
  });
  expect(acquireCalls).toBe(1);
  expect(claimCalls).toBe(1);

  const renewAtStop = renewCalls;
  await page.waitForTimeout(4_500);
  expect(acquireCalls).toBe(1);
  expect(claimCalls).toBe(1);
  expect(renewCalls).toBe(renewAtStop);
});
