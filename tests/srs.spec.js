import { test, expect } from "@playwright/test";
import { freshApp, readCards } from "./helpers.js";

test.describe("SRS 복습 + 카드 관리", () => {
  test("좋음 채점 → due 하루 뒤로, 큐/배지에서 빠짐", async ({ page }) => {
    await freshApp(page);

    const badgeBefore = Number(
      await page.locator('.tab:has-text("카드") .tab-badge').textContent()
    );
    expect(badgeBefore).toBeGreaterThan(0);

    await page.click('.tab:has-text("카드")');
    await page.click(".flashcard"); // 뒤집기
    await page.click('.grade-row .btn:has-text("좋음")');

    await expect
      .poll(async () =>
        (await readCards(page)).filter((c) => c.reps > 0).length
      )
      .toBe(1);

    const graded = (await readCards(page)).find((c) => c.reps > 0);
    expect(graded.state).toBe("review");
    expect(graded.interval).toBe(1);
    expect(graded.due).toBeGreaterThan(Date.now());

    const badgeAfter = Number(
      await page.locator('.tab:has-text("카드") .tab-badge').textContent()
    );
    expect(badgeAfter).toBe(badgeBefore - 1);
  });

  test("다시 채점 → ease 감소, ~10분 뒤 재시도, 큐에 남음", async ({
    page,
  }) => {
    await freshApp(page);
    await page.click('.tab:has-text("카드")');

    const before = await readCards(page);
    await page.click(".flashcard");
    await page.click('.grade-row .btn:has-text("다시")');

    await expect
      .poll(async () =>
        (await readCards(page)).filter((c) => c.reps > 0).length
      )
      .toBe(1);
    const graded = (await readCards(page)).find((c) => c.reps > 0);
    expect(graded.ease).toBeCloseTo(2.3, 5);
    expect(graded.state).toBe("learning");
    // 10분 뒤 due — 아직 미래
    expect(graded.due).toBeGreaterThan(Date.now());
    expect(graded.due).toBeLessThan(Date.now() + 11 * 60 * 1000);
    expect(before.length).toBe((await readCards(page)).length);
  });

  test("카드 관리: 수동 추가/수정/삭제", async ({ page }) => {
    await freshApp(page);
    await page.click('.tab:has-text("카드")');
    await page.click('.mode-row .btn:has-text("카드 관리")');

    const fg = page.locator(".cards-view .form-group");
    await fg.locator("textarea").nth(0).fill("수동 앞면");
    await fg.locator("textarea").nth(1).fill("수동 뒷면");
    await page.click('.btn:has-text("추가")');

    await expect
      .poll(async () =>
        (await readCards(page)).some(
          (c) => c.front === "수동 앞면" && c.noteId === null
        )
      )
      .toBe(true);

    await page
      .locator('.note:has-text("수동 앞면") .btn:has-text("수정")')
      .click();
    await fg.locator("textarea").nth(0).fill("수동 앞면 v2");
    await page.click('.btn:has-text("수정 저장")');
    await expect
      .poll(async () =>
        (await readCards(page)).some((c) => c.front === "수동 앞면 v2")
      )
      .toBe(true);

    page.on("dialog", (d) => d.accept());
    await page
      .locator('.note:has-text("수동 앞면 v2") .btn:has-text("삭제")')
      .click();
    await expect
      .poll(async () =>
        (await readCards(page)).some((c) => c.front.startsWith("수동 앞면"))
      )
      .toBe(false);
  });
});
