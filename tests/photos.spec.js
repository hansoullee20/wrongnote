import { test, expect } from "@playwright/test";
import { freshApp, readNotes , pickCause , openRecord, openNoteByProblem , goAnalysis } from "./helpers.js";

// 1×1 픽셀 PNG (테스트용 최소 이미지)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** IDB 이미지 키 조회 헬퍼 */
const readImageIds = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) => {
        const req = indexedDB.open("wrongnote", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("images")) {
            req.result.createObjectStore("images");
          }
        };
        req.onsuccess = () => {
          const db = req.result;
          const r = db
            .transaction("images", "readonly")
            .objectStore("images")
            .getAllKeys();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      })
  );

test.describe("문제 사진 첨부", () => {
  test.beforeEach(async ({ page }) => {
    // 외부 요청 전부 차단 (OCR 언어 데이터 CDN 포함) → 글자 인식은 빠르게
    // 실패하고, 사진 첨부는 그대로 동작해야 함. 로컬 모듈은 통과.
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await freshApp(page);
    await openRecord(page);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase("wrongnote");
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        })
    );
  });

  test("사진 첨부 → 저장 → 노트에 사진 id, IDB에 blob", async ({ page }) => {
    await page.fill("#rec-problem", "사진 노트 1");
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({
        name: "problem.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });

    // 사진 썸네일이 폼에 떠야 함 (OCR 실패와 무관)
    await expect(page.locator(".photo-strip-item")).toHaveCount(1);

    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () =>
        (await readNotes(page)).find((n) => n.problem === "사진 노트 1")
          ?.images?.length
      )
      .toBe(1);

    const ids = await readImageIds(page);
    expect(ids.length).toBe(1);

    // 그리드 카드가 캡처 자체를 썸네일로 보여준다 — 목록에서 문제가 보여야 한다
    await expect(
      page.locator('.prob-card:has-text("사진 노트 1") img.prob-shot')
    ).toBeVisible();
  });

  test("노트 삭제 → IDB 사진도 정리", async ({ page }) => {
    await page.fill("#rec-problem", "사진 삭제 테스트");
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({
        name: "problem.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
    await expect(page.locator(".photo-strip-item")).toHaveCount(1);
    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');
    await expect.poll(async () => (await readImageIds(page)).length).toBe(1);

    page.on("dialog", (d) => d.accept());
    await openNoteByProblem(page, "사진 삭제 테스트");
    await page.click(".sheet-delete");

    await expect.poll(async () => (await readImageIds(page)).length).toBe(0);
  });

  test("폼에서 ✕로 제거하면 저장 시 사진 없음", async ({ page }) => {
    await page.fill("#rec-problem", "사진 제거 테스트");
    await page
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({
        name: "problem.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
    await expect(page.locator(".photo-strip-item")).toHaveCount(1);
    await page.click(".photo-remove");
    await expect(page.locator(".photo-strip-item")).toHaveCount(0);

    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');
    await expect
      .poll(async () =>
        (await readNotes(page)).find((n) => n.problem === "사진 제거 테스트")
          ?.images?.length
      )
      .toBe(0);
    expect((await readImageIds(page)).length).toBe(0);
  });
});
