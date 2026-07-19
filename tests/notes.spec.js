import { test, expect } from "@playwright/test";
import { freshApp, readNotes, readCards , pickCause } from "./helpers.js";

test.describe("노트 CRUD + 자동 카드", () => {
  test("재유도 노트 → 자동 카드 생성, 노트 삭제 시 카드 정리", async ({
    page,
  }) => {
    await freshApp(page);
    const baseCards = (await readCards(page)).length;

    await page.fill("#rec-problem", "DERIVED-1");
    await page
      .locator(".form-group")
      .nth(1)
      .locator("textarea")
      .nth(2)
      .fill("최적 풀이 내용"); // optSol
    await page.click('.chip:has-text("재유도함")');
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () => (await readCards(page)).length)
      .toBe(baseCards + 1);

    // 삭제 → 자동 카드도 정리
    page.on("dialog", (d) => d.accept());
    await page.click(".panel-head"); // 폼 접기
    await page.click('.note-prob:has-text("DERIVED-1")');
    await page.click(".del-btn");

    await expect
      .poll(async () => (await readCards(page)).length)
      .toBe(baseCards);
    expect(
      (await readNotes(page)).some((n) => n.problem === "DERIVED-1")
    ).toBe(false);
  });

  test("optSol 없으면 빈 뒷면 카드를 만들지 않는다", async ({ page }) => {
    await freshApp(page);
    const baseCards = (await readCards(page)).length;

    await page.fill("#rec-problem", "NOBACK-1");
    await page.click('.chip:has-text("재유도함")');
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () => (await readNotes(page)).some((n) => n.problem === "NOBACK-1"))
      .toBe(true);
    expect((await readCards(page)).length).toBe(baseCards);
  });

  test("노트 수정: 수정 모드 표시, 변경 반영, 자동 카드 중복 없음", async ({
    page,
  }) => {
    await freshApp(page);

    await page.fill("#rec-problem", "EDIT-ME");
    await page.click('.chip:has-text("시간 부족")');
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');
    await expect
      .poll(async () => (await readNotes(page)).some((n) => n.problem === "EDIT-ME"))
      .toBe(true);
    const cardsBefore = (await readCards(page)).length;

    await page.click(".panel-head");
    await page.click('.note-prob:has-text("EDIT-ME")');
    await page.click(".edit-btn");
    await expect(
      page.locator('.panel-head:has-text("오답 수정 중")')
    ).toBeVisible();

    await page.fill("#rec-problem", "EDITED");
    await page.click('.btn--primary:has-text("수정 저장")');

    await expect
      .poll(async () => (await readNotes(page)).some((n) => n.problem === "EDITED"))
      .toBe(true);
    expect((await readNotes(page)).some((n) => n.problem === "EDIT-ME")).toBe(
      false
    );
    expect((await readCards(page)).length).toBe(cardsBefore);
  });

  test("수정 취소: 반쯤 고친 draft가 새 노트로 새지 않는다", async ({
    page,
  }) => {
    await freshApp(page);
    const baseNotes = (await readNotes(page)).length;

    await page.click(".panel-head");
    await page.locator(".note-row").first().click();
    await page.click(".edit-btn");
    await page.fill("#rec-problem", "SHOULD-NOT-LEAK");
    await page.click('.btn:has-text("수정 취소")');

    await expect(
      page.locator('.panel-head:has-text("오답 기록")')
    ).toBeVisible();
    expect((await readNotes(page)).length).toBe(baseNotes);
    expect(
      (await readNotes(page)).some((n) => n.problem === "SHOULD-NOT-LEAK")
    ).toBe(false);
  });
});
