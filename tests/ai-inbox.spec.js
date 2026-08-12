import { test, expect } from "@playwright/test";
import { freshApp, readNotes } from "./helpers.js";

const COMPANION = "http://127.0.0.1:43119/v1";

function payload(problem = "AI-INBOX-1") {
  return {
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
      concepts: ["도함수 부호", "도함수 부호"],
      cause: "개념 부족",
      tags: ["조건 누락"],
      failurePoint: "내부도함수를 한 번 누락했다.",
      mySolution: "후보 하나만 확인했다.",
      optimalSolution: "모든 후보를 비교한다.",
      memo: "시험에서는 부호표를 먼저 고정한다.",
    },
  };
}

async function installCompanionMock(page, { eventId = "evt-ai-1", problem = "AI-INBOX-1" } = {}) {
  let delivered = false;
  const settlements = [];

  await page.route(`${COMPANION}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const headers = {
      "Access-Control-Allow-Origin": request.headers()["origin"] || "*",
      "Access-Control-Allow-Headers": "Content-Type, Access-Control-Request-Private-Network",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Private-Network": "true",
      "Content-Type": "application/json",
    };

    if (request.method() === "OPTIONS") {
      await route.fulfill({ status: 204, headers, body: "" });
      return;
    }

    let body;
    if (request.postData()) body = JSON.parse(request.postData());
    let response;

    if (url.pathname.endsWith("/session/acquire")) {
      response = { ok: true, status: "acquired", fence: 1, expiresAt: Date.now() + 60_000 };
    } else if (url.pathname.endsWith("/session/renew")) {
      response = { ok: true, status: "renewed", fence: 1, expiresAt: Date.now() + 60_000 };
    } else if (url.pathname.endsWith("/claim")) {
      if (delivered) {
        response = { ok: true, status: "empty" };
      } else {
        delivered = true;
        response = {
          ok: true,
          status: "delivered",
          eventId,
          itemId: "item-ai-1",
          receipt: "receipt-ai-1",
          payload: payload(problem),
        };
      }
    } else if (url.pathname.endsWith("/settle")) {
      settlements.push(body);
      response = { ok: true, status: body.outcome === "accepted" ? "accepted" : body.outcome };
    } else if (url.pathname.endsWith("/session/release")) {
      response = { ok: true, status: "released" };
    } else if (url.pathname.endsWith("/health")) {
      response = { ok: true, status: "ok" };
    } else {
      response = { ok: false, error: { code: "not_found", message: "mock route not found" } };
    }

    await route.fulfill({ status: response.ok ? 200 : 404, headers, body: JSON.stringify(response) });
  });

  return { settlements };
}

const installNotesQuotaTrap = (page) =>
  page.addInitScript(() => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (
        this === localStorage &&
        key === "wr_notes" &&
        sessionStorage.getItem("__aiNotesQuota") === "on"
      ) {
        const err = new Error("quota");
        err.name = "QuotaExceededError";
        throw err;
      }
      return original.call(this, key, value);
    };
  });

test("AI inbox stays reviewable and only settles accepted after the note is persisted", async ({ page }) => {
  const mock = await installCompanionMock(page);
  await freshApp(page);
  await page.getByTestId("ai-companion-enable").click();

  const badge = page.getByTestId("ai-inbox-badge");
  await expect(badge).toBeVisible({ timeout: 10_000 });
  await expect(badge).toContainText("AI-INBOX-1");

  await badge.getByRole("button").click();
  await expect(page.getByTestId("ai-review-sheet")).toBeVisible();
  await expect(page.locator("#ai-review-problem")).toHaveValue("AI-INBOX-1");
  await expect(page.locator("#ai-review-failure-point")).toHaveValue("내부도함수를 한 번 누락했다.");
  await expect(page.locator("#ai-review-optimal-solution")).toHaveValue("모든 후보를 비교한다.");

  await page.getByRole("button", { name: "저장 (기록하기)" }).click();

  await expect.poll(async () => {
    const notes = await readNotes(page);
    return notes?.find((note) => note.aiEventId === "evt-ai-1")?.problem || "";
  }).toBe("AI-INBOX-1");

  await expect.poll(() => mock.settlements.some((entry) => entry.outcome === "accepted")).toBe(true);
  await expect(page.getByTestId("ai-review-sheet")).toHaveCount(0);

  const saved = (await readNotes(page)).filter((note) => note.aiEventId === "evt-ai-1");
  expect(saved).toHaveLength(1);
  expect(saved[0].failurePoint).toBe("내부도함수를 한 번 누락했다.");
  expect(saved[0].optSol).toBe("모든 후보를 비교한다.");
});

test("failed note persistence cannot settle the AI event as accepted", async ({ page }) => {
  await installNotesQuotaTrap(page);
  const mock = await installCompanionMock(page, { eventId: "evt-quota", problem: "AI-QUOTA" });
  await freshApp(page);
  await page.getByTestId("ai-companion-enable").click();

  const badge = page.getByTestId("ai-inbox-badge");
  await expect(badge).toContainText("AI-QUOTA", { timeout: 10_000 });
  await badge.getByRole("button").click();

  const beforeRaw = await page.evaluate(() => localStorage.getItem("wr_notes"));
  await page.evaluate(() => sessionStorage.setItem("__aiNotesQuota", "on"));
  await page.getByRole("button", { name: "저장 (기록하기)" }).click();

  await expect(page.locator(".audit-warn").first()).toBeVisible();
  await expect(page.getByTestId("ai-review-sheet")).toBeVisible();
  await expect(page.getByRole("button", { name: "저장 (기록하기)" })).toBeDisabled();
  await page.waitForTimeout(500);
  expect(mock.settlements.some((entry) => entry.outcome === "accepted")).toBe(false);
  expect(await page.evaluate(() => localStorage.getItem("wr_notes"))).toBe(beforeRaw);
});

test("redelivery of an already-saved event is ACKed without creating a duplicate note", async ({ page }) => {
  const mock = await installCompanionMock(page, { eventId: "evt-redelivery", problem: "AI-REDO" });

  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem("wr_schema_version", "8");
    localStorage.setItem("wr_cards", "[]");
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([
        {
          id: "saved-ai-note",
          ts: 1700000000000,
          date: "2026-08-01",
          subject: "수학",
          problem: "AI-REDO",
          topicMain: "수II·미분",
          topicSub: "최대최소",
          question: "",
          mySol: "",
          optSol: "",
          cause: "개념 부족",
          tags: [],
          derived: null,
          memo: "",
          correctAnswer: "11",
          myAnswer: "",
          examTime: "",
          images: [],
          solutionImages: [],
          attempts: [],
          concepts: [],
          analysisLocale: "ko",
          failurePoint: "",
          aiEventId: "evt-redelivery",
          rechecked: false,
          recheckResult: null,
          recheckCount: 0,
          nextRecheckTs: null,
        },
      ])
    );
  });
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.getByTestId("ai-companion-enable").click();

  await expect.poll(() => mock.settlements.some((entry) => entry.outcome === "accepted")).toBe(true);
  await expect(page.getByTestId("ai-inbox-badge")).toHaveCount(0);

  const notes = await readNotes(page);
  expect(notes.filter((note) => note.aiEventId === "evt-redelivery")).toHaveLength(1);
});
