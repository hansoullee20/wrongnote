import { test, expect } from "@playwright/test";
import { freshApp, readNotes } from "./helpers.js";

const COMPANION = "http://127.0.0.1:43119/v1";

const analysisPayload = (problem) => ({
  version: 1,
  locale: "ko",
  subject: "수학",
  question: {
    problem,
    plainText: "함수의 최댓값을 구하여라.",
    latex: "\\max f(x)",
    correctAnswer: "11",
  },
  analysis: {
    topicMain: "수II·미분",
    topicSub: "최대최소",
    concepts: ["도함수 부호"],
    cause: "개념 부족",
    tags: [],
    failurePoint: "후보를 하나 빠뜨렸다.",
    mySolution: "후보 하나만 확인했다.",
    optimalSolution: "모든 후보를 비교한다.",
    memo: "",
  },
});

async function installStatefulMock(
  page,
  {
    eventId = "evt-retry",
    problem = "AI-RETRY",
    loseFirstReleaseResponse = false,
    acceptedAlreadyOutcome = null,
    rejectedAlreadyOutcome = null,
  } = {}
) {
  let itemWaiting = true;
  let currentReceipt = null;
  let deliveryCount = 0;
  let releaseAttempts = 0;
  const settlements = [];

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

    const body = request.postData() ? JSON.parse(request.postData()) : null;
    let response;

    if (url.pathname.endsWith("/session/acquire")) {
      response = { ok: true, status: "acquired", fence: 1, expiresAt: Date.now() + 60_000 };
    } else if (url.pathname.endsWith("/session/renew")) {
      response = { ok: true, status: "renewed", expiresAt: Date.now() + 60_000 };
    } else if (url.pathname.endsWith("/claim")) {
      if (currentReceipt) {
        response = {
          ok: true,
          status: "delivered",
          repeated: true,
          eventId,
          itemId: "item-retry",
          receipt: currentReceipt,
          payload: analysisPayload(problem),
        };
      } else if (itemWaiting) {
        itemWaiting = false;
        deliveryCount += 1;
        currentReceipt = `receipt-retry-${deliveryCount}`;
        response = {
          ok: true,
          status: "delivered",
          repeated: false,
          eventId,
          itemId: "item-retry",
          receipt: currentReceipt,
          payload: analysisPayload(problem),
        };
      } else {
        response = { ok: true, status: "empty" };
      }
    } else if (url.pathname.endsWith("/settle")) {
      settlements.push(body);

      if (body.outcome === "released") {
        releaseAttempts += 1;
        if (loseFirstReleaseResponse && releaseAttempts === 1) {
          // Simulate: queue mutation committed, but browser never got the response.
          currentReceipt = null;
          itemWaiting = true;
          await route.abort("failed");
          return;
        }
        if (loseFirstReleaseResponse && releaseAttempts === 2) {
          response = { ok: true, status: "receipt_mismatch" };
        } else {
          currentReceipt = null;
          itemWaiting = true;
          response = { ok: true, status: "released", eventId, itemId: "item-retry" };
        }
      } else if (body.outcome === "accepted" && acceptedAlreadyOutcome) {
        currentReceipt = null;
        itemWaiting = false;
        response = {
          ok: true,
          status: "already_settled",
          outcome: acceptedAlreadyOutcome,
          eventId,
        };
      } else if (body.outcome === "rejected" && rejectedAlreadyOutcome) {
        currentReceipt = null;
        itemWaiting = false;
        response = {
          ok: true,
          status: "already_settled",
          outcome: rejectedAlreadyOutcome,
          eventId,
        };
      } else {
        currentReceipt = null;
        itemWaiting = false;
        response = { ok: true, status: body.outcome, eventId, itemId: "item-retry" };
      }
    } else if (url.pathname.endsWith("/session/release")) {
      currentReceipt = null;
      itemWaiting = true;
      response = { ok: true, status: "session_released", deliveryReturned: true };
    } else if (url.pathname.endsWith("/health")) {
      response = { ok: true, status: "ok" };
    } else {
      response = { ok: false, error: { code: "not_found", message: "mock route not found" } };
    }

    await route.fulfill({ status: response.ok ? 200 : 404, headers, body: JSON.stringify(response) });
  });

  return {
    settlements,
    releaseAttempts: () => releaseAttempts,
    deliveryCount: () => deliveryCount,
  };
}

async function connectAndOpenReview(page) {
  await page.getByTestId("ai-companion-enable").click();
  const badge = page.getByTestId("ai-inbox-badge");
  await expect(badge).toBeVisible({ timeout: 10_000 });
  await badge.getByRole("button").click();
  await expect(page.getByTestId("ai-review-sheet")).toBeVisible();
}

test("lost response after release cannot pin the session on the stale receipt", async ({ page }) => {
  const mock = await installStatefulMock(page, {
    eventId: "evt-release-lost",
    problem: "AI-RELEASE-LOST",
    loseFirstReleaseResponse: true,
  });
  await freshApp(page);
  await connectAndOpenReview(page);

  await page.getByRole("button", { name: /나중에/ }).click();
  await expect.poll(mock.releaseAttempts).toBe(1);

  // First explicit tick retries the stale release and receives receipt_mismatch.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect.poll(mock.releaseAttempts).toBe(2);

  // A second tick must be free to claim again. Before the fix, pendingRelease
  // stayed forever and this badge could never reappear while the page remained open.
  await page.evaluate(() => document.dispatchEvent(new Event("visibilitychange")));
  await expect(page.getByTestId("ai-inbox-badge")).toContainText("AI-RELEASE-LOST", {
    timeout: 5_000,
  });
  expect(mock.deliveryCount()).toBeGreaterThanOrEqual(2);
});

test("accepted retry cannot call already-rejected state a successful acceptance", async ({ page }) => {
  const mock = await installStatefulMock(page, {
    eventId: "evt-accept-conflict",
    problem: "AI-ACCEPT-CONFLICT",
    acceptedAlreadyOutcome: "rejected",
  });
  await freshApp(page);
  await connectAndOpenReview(page);

  await page.getByRole("button", { name: "저장 (기록하기)" }).click();
  await expect.poll(async () => {
    const notes = await readNotes(page);
    return notes?.some((note) => note.aiEventId === "evt-accept-conflict") || false;
  }).toBe(true);

  await expect(page.getByTestId("ai-inbox-notice")).toContainText("AI 처리 상태 충돌");
  await expect(page.getByTestId("ai-inbox-notice")).toContainText("rejected");
  expect(mock.settlements.filter((entry) => entry.outcome === "accepted")).toHaveLength(1);
});

test("rejected retry cannot call already-accepted state a successful rejection", async ({ page }) => {
  const mock = await installStatefulMock(page, {
    eventId: "evt-reject-conflict",
    problem: "AI-REJECT-CONFLICT",
    rejectedAlreadyOutcome: "accepted",
  });
  await freshApp(page);
  await connectAndOpenReview(page);

  await page.getByRole("button", { name: "거절" }).click();
  await expect(page.getByTestId("ai-inbox-notice")).toContainText("AI 처리 상태 충돌");
  await expect(page.getByTestId("ai-inbox-notice")).toContainText("accepted");
  expect(mock.settlements.filter((entry) => entry.outcome === "rejected")).toHaveLength(1);
});

test("AI-disabled startup does not require randomUUID, and opt-in falls back to getRandomValues", async ({ page }) => {
  await page.addInitScript(() => {
    try {
      Object.defineProperty(window.crypto, "randomUUID", {
        value: undefined,
        configurable: true,
      });
    } catch {
      // Chromium may expose it on the prototype instead of as an own property.
      try {
        Object.defineProperty(Crypto.prototype, "randomUUID", {
          value: undefined,
          configurable: true,
        });
      } catch {}
    }
  });
  await installStatefulMock(page, {
    eventId: "evt-no-random-uuid",
    problem: "AI-NO-RANDOM-UUID",
  });

  await freshApp(page);
  await expect(page.getByRole("button", { name: /^문제/ })).toBeVisible();

  await page.getByTestId("ai-companion-enable").click();
  await expect(page.getByTestId("ai-inbox-badge")).toContainText("AI-NO-RANDOM-UUID", {
    timeout: 10_000,
  });
});
