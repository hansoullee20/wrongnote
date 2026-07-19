import { test, expect } from "@playwright/test";
import { freshApp , openRecord , goAnalysis } from "./helpers.js";

test.describe("실행 오류 하드 게이트", () => {
  test("실행 태그 선택 시 4항목 체크 전까지 저장 잠김", async ({ page }) => {
    await freshApp(page);
    await openRecord(page);

    await page.fill("#rec-problem", "게이트 테스트 Q1");
    await goAnalysis(page);
    await page.click('.chip:has-text("실행 실수")');

    const saveBtn = page.locator('.btn--primary:has-text("저장")');
    await expect(saveBtn).toBeDisabled();
    await expect(page.locator(".gate-warn")).toBeVisible();

    const boxes = page.locator('.gate-item input[type="checkbox"]');
    await expect(boxes).toHaveCount(4);
    for (let i = 0; i < 4; i++) await boxes.nth(i).check();

    await expect(saveBtn).toBeEnabled();
  });

  test("실행 태그 없으면 게이트 미노출, 즉시 저장 가능", async ({ page }) => {
    await freshApp(page);
    await openRecord(page);
    await page.fill("#rec-problem", "게이트 없음 Q1");
    await goAnalysis(page);
    await page.click('.chip:has-text("시간 부족")');
    await expect(page.locator(".gate")).toHaveCount(0);
    await expect(page.locator('.btn--primary:has-text("저장")')).toBeEnabled();
  });
});
