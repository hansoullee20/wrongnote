import { test, expect } from "@playwright/test";
import { freshApp, openRecord, readNotes } from "./helpers.js";

const COMPANION = "http://127.0.0.1:43119/v1";

const payload = {
  version: 1,
  locale: "ko",
  subject: "수학",
  question: {
    problem: "AI-PROTOCOL-BLOCK",
    plainText: "함수의 최댓값을 구하여라.",
    latex: "",
    correctAnswer: "11",
  },
  analysis: {
    topicMain: "수II·미분",
    topicSub: "최대최소",
    concepts: [],
    cause: "개념 부족",
    tags: [],
    failurePoint: "후보 누락",
    mySolution: "후보 하나만 확인",
    optimalSolution: "모든 후보 비교",
    memo: "",
  },
};

async function installPermanentAcceptFailure(page) {
  let settleCalls = 0;
  let claimCalls = 0;

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
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ ok: true, status: "acquired", fence: 1, expiresAt: Date.now() + 60_000 }),
      });
      return;
    }
    if (url.pathname.endsWith("/session/renew")) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ ok: true, status: "renewed", expiresAt: Date.now() + 60_000 }),
      });
      return;
    }
    if (url.pathname.endsWith("/claim")) {
      claimCalls += 1;
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({
          ok: true,
          status: "delivered",
          repeated: claimCalls > 1,
          eventId: "evt-protocol-block",
          itemId: "item-protocol-block",
          receipt: "receipt-protocol-block",
          payload,
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/settle")) {
      settleCalls += 1;
      await route.fulfill({
        status: 400,
        headers,
        body: JSON.stringify({
          ok: false,
          error: {
            code: "invalid_settlement_request",
            message: "mock permanent protocol rejection",
          },
        }),
      });
      return;
    }
    if (url.pathname.endsWith("/session/release")) {
      await route.fulfill({
        status: 200,
        headers,
        body: JSON.stringify({ ok: true, status: "session_released" }),
      });
      return;
    }

    await route.fulfill({
      status: 200,
      headers,
      body: JSON.stringify({ ok: true, status: "ok" }),
    });
  });

  return {
    settleCalls: () => settleCalls,
    claimCalls: () => claimCalls,
  };
}

test("permanent protocol stop survives opening and closing another Wrongnote form", async ({ page }) => {
  const mock = await installPermanentAcceptFailure(page);
  await freshApp(page);
  await page.getByTestId("ai-companion-enable").click();
  await expect(page.getByTestId("ai-inbox-badge")).toContainText("AI-PROTOCOL-BLOCK", {
    timeout: 10_000,
  });

  await page.getByTestId("ai-inbox-badge").getByRole("button").click();
  await page.getByRole("button", { name: "저장 (기록하기)" }).click();
  await expect.poll(async () => {
    const notes = await readNotes(page);
    return notes?.some((note) => note.aiEventId === "evt-protocol-block") || false;
  }).toBe(true);
  await expect(page.getByTestId("ai-inbox-notice")).toContainText("자동 재시도를 멈췄다");
  expect(mock.settleCalls()).toBe(1);

  // `enabled` also becomes false while an unrelated form is open. That must not
  // be mistaken for an explicit AI opt-out and clear the protocol stop-gate.
  await openRecord(page);
  await page.locator(".sheet .sheet-close").click();
  await expect(page.locator(".sheet")).toHaveCount(0);

  const claimsAtBlock = mock.claimCalls();
  await page.waitForTimeout(4_500);
  expect(mock.settleCalls()).toBe(1);
  expect(mock.claimCalls()).toBe(claimsAtBlock);
});
