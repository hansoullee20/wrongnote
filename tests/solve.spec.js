import { test, expect } from "@playwright/test";
import { freshApp, readNotes } from "./helpers.js";

/** 정답이 있는 노트 하나만 남기고 나머지를 치운다 — 큐를 예측 가능하게 */
async function seedOneSolvable(page, { correctAnswer = "③" } = {}) {
  await page.goto("/");
  await page.evaluate((ans) => {
    localStorage.clear();
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([
        {
          subject: "수학",
          problem: "SOLVE-1",
          topicMain: "수II·미분",
          topicSub: "접선",
          question: "다시 풀 문제 원문",
          mySol: "처음에 이렇게 틀렸다",
          optSol: "이렇게 푸는 게 빠르다",
          cause: "실행 실수",
          correctAnswer: ans,
          myAnswer: "②",
          attempts: [],
          tags: ["부호 실수"],
          derived: null,
          memo: "",
          ts: Date.now() - 30 * 86400000, // 재검증 주기(14일) 지난 상태
          id: "solve_n1",
          date: "2026-06-19",
        },
      ])
    );
    localStorage.setItem("wr_cards", JSON.stringify([]));
  }, correctAnswer);
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300);
}

test.describe("다시 풀기 세션", () => {
  test("오답 → 자동 채점, 시도 기록, 다음 복습 당겨짐", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');

    // 풀기 전에는 최적 풀이가 가려져 있어야 한다
    await expect(page.locator(".veil")).toBeVisible();
    await expect(page.locator(".reveal")).toHaveCount(0);
    await expect(page.locator(".timer")).toBeVisible();

    // 정답 ③ 인데 ② 를 고른다
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".verdict-stamp")).toHaveText("또 틀림");
    await expect(page.locator(".reveal").first()).toBeVisible();

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(1);
    expect(note.attempts[0].answer).toBe("②");
    expect(note.attempts[0].correct).toBe(false);
    expect(note.attempts[0].seconds).toBeGreaterThan(0);
    expect(note.recheckResult).toBe("fail");
    // 틀리면 내일로 당겨진다
    expect(note.nextRecheckTs - Date.now()).toBeLessThan(2 * 86400000);
    // 틀렸다고 주원인을 멋대로 바꾸지 않는다
    expect(note.cause).toBe("실행 실수");
  });

  test("정답 → 통과 기록, 다음 복습 뒤로 밀림", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].correct).toBe(true);
    expect(note.recheckResult).toBe("pass");
    expect(note.nextRecheckTs - Date.now()).toBeGreaterThan(10 * 86400000);
  });

  test("같은 오답 반복 → 세션 요약이 몇 번째인지 짚어준다", async ({ page }) => {
    await seedOneSolvable(page);
    // 이미 ② 로 한 번 틀린 이력을 심는다
    await page.evaluate(() => {
      const ns = JSON.parse(localStorage.getItem("wr_notes"));
      ns[0].attempts = [
        { ts: Date.now() - 86400000, answer: "②", correct: false, seconds: 390 },
      ];
      localStorage.setItem("wr_notes", JSON.stringify(ns));
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');
    await page.click('.end-btn:has-text("결과 보기")');

    // "②를 2번째 골랐다" — 반복 오답 패턴이 요약에 드러나야 한다
    await expect(page.locator(".card-line.bad .cl-body b")).toContainText(
      "②를 2번째 골랐다"
    );
    // 실행 실수로 기록했는데 같은 오답 반복 → 주원인 재확인 제안
    await expect(page.locator(".callout")).toBeVisible();
  });

  test("정답 미기록 노트: 지금 입력하면 저장되어 자동 채점된다", async ({
    page,
  }) => {
    await seedOneSolvable(page, { correctAnswer: "" });

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');

    // 정답이 없으니 정답 입력줄이 뜬다
    await expect(page.locator(".ans-fix")).toBeVisible();

    await page.click('.ans-block .ans-row:not(.ans-fix) .ans-opt:has-text("③")');
    await page.click('.ans-fix .ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");
    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.correctAnswer).toBe("③");
  });

  test("문제 그리드의 '바로 시작' → 풀기 세션으로 직행", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click(".today-go");
    await expect(page.locator(".solve-head")).toBeVisible();
    await expect(page.locator(".solve-prog")).toContainText("1 / 1");
  });
});
