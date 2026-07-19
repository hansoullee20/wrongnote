import { test, expect } from "@playwright/test";
import { freshApp, readNotes, readCards , pickCause , openRecord, openNoteByProblem , goAnalysis } from "./helpers.js";

test.describe("노트 CRUD + 자동 카드", () => {
  test("재유도 노트 → 자동 카드 생성, 노트 삭제 시 카드 정리", async ({
    page,
  }) => {
    await freshApp(page);
    await openRecord(page);
    const baseCards = (await readCards(page)).length;

    await page.fill("#rec-problem", "DERIVED-1");
    await goAnalysis(page);
    await page.fill("#rec-optsol", "최적 풀이 내용");
    await page.click('.chip:has-text("재유도함")');
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () => (await readCards(page)).length)
      .toBe(baseCards + 1);

    // 삭제 → 자동 카드도 정리
    page.on("dialog", (d) => d.accept());
    await openNoteByProblem(page, "DERIVED-1");
    await page.click(".sheet-delete");

    await expect
      .poll(async () => (await readCards(page)).length)
      .toBe(baseCards);
    expect(
      (await readNotes(page)).some((n) => n.problem === "DERIVED-1")
    ).toBe(false);
  });

  test("optSol 없으면 빈 뒷면 카드를 만들지 않는다", async ({ page }) => {
    await freshApp(page);
    await openRecord(page);
    const baseCards = (await readCards(page)).length;

    await page.fill("#rec-problem", "NOBACK-1");
    await goAnalysis(page);
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
    await openRecord(page);

    await page.fill("#rec-problem", "EDIT-ME");
    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');
    await expect
      .poll(async () => (await readNotes(page)).some((n) => n.problem === "EDIT-ME"))
      .toBe(true);
    const cardsBefore = (await readCards(page)).length;

    await openNoteByProblem(page, "EDIT-ME");
    await expect(
      page.locator('.sheet-title:has-text("오답 수정")')
    ).toBeVisible();

    await page.fill("#rec-problem", "EDITED");
    await goAnalysis(page);
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

    await page.locator(".prob-card").first().click();
    await page.locator(".sheet .form").first().waitFor();
    await page.fill("#rec-problem", "SHOULD-NOT-LEAK");
    await goAnalysis(page);
    await page.click('.btn:has-text("수정 취소")');

    await expect(
      page.locator('.sheet-title:has-text("오답 기록")')
    ).toBeVisible();
    expect((await readNotes(page)).length).toBe(baseNotes);
    expect(
      (await readNotes(page)).some((n) => n.problem === "SHOULD-NOT-LEAK")
    ).toBe(false);
  });
});

test.describe("답 마킹 (v4)", () => {
  test("1페이지에서 찍은 정답·내 답이 저장되고, 다시 풀기가 그걸로 채점한다", async ({
    page,
  }) => {
    await freshApp(page);
    await openRecord(page);

    await page.fill("#rec-problem", "ANS-1");
    // 1페이지: 정답 ③, 내가 고른 답 ②
    const lines = page.locator(".ans-line");
    await lines.nth(0).locator('.ans-o:has-text("③")').click();
    await lines.nth(1).locator('.ans-o:has-text("②")').click();

    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () => (await readNotes(page)).find((n) => n.problem === "ANS-1"))
      .toBeTruthy();
    const note = (await readNotes(page)).find((n) => n.problem === "ANS-1");
    expect(note.correctAnswer).toBe("③");
    expect(note.myAnswer).toBe("②");
  });

  test("주관식 답도 저장된다", async ({ page }) => {
    await freshApp(page);
    await openRecord(page);

    await page.fill("#rec-problem", "ANS-2");
    const lines = page.locator(".ans-line");
    await lines.nth(0).locator(".ans-sub").fill("47");
    await lines.nth(1).locator(".ans-sub").fill("51");

    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () => (await readNotes(page)).find((n) => n.problem === "ANS-2"))
      .toBeTruthy();
    const note = (await readNotes(page)).find((n) => n.problem === "ANS-2");
    expect(note.correctAnswer).toBe("47");
    expect(note.myAnswer).toBe("51");
  });

  test("걸린 시간은 선택 — 안 고르면 빈 값", async ({ page }) => {
    await freshApp(page);
    await openRecord(page);
    await page.fill("#rec-problem", "TIME-1");
    await goAnalysis(page);
    await page.click('.chip:has-text("4~5분")');
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () => (await readNotes(page)).find((n) => n.problem === "TIME-1"))
      .toBeTruthy();
    expect(
      (await readNotes(page)).find((n) => n.problem === "TIME-1").examTime
    ).toBe("4~5분");
  });
});
