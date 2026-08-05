import { test, expect } from "@playwright/test";
import { freshApp } from "./helpers.js";

/* 작은 화면에서도 탭·그리드·분류기가 쓰러지지 않아야 한다 (§25) */
for (const vp of [
  { width: 320, height: 568 },
  { width: 375, height: 667 },
]) {
  test.describe(`모바일 ${vp.width}×${vp.height}`, () => {
    test.use({ viewport: vp });

    test("탭 4개 표시, 가로 스크롤 없음, 그룹 그리드 렌더", async ({
      page,
    }) => {
      const errors = [];
      page.on("console", (m) => {
        if (m.type() === "error") errors.push(m.text());
      });

      await freshApp(page);

      await expect(page.locator(".tab")).toHaveCount(4);
      // 본문이 뷰포트를 넘치면 안 된다
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth
      );
      expect(overflow).toBeLessThanOrEqual(0);

      // 그룹 헤더와 카드가 보인다 (시드 데이터)
      await expect(page.locator(".review-group .group-label").first()).toBeVisible();
      await expect(page.locator(".prob-card").first()).toBeVisible();

      expect(errors).toEqual([]);
    });

    test("fail 분류기: 게이트까지 열어도 저장 버튼에 닿는다", async ({
      page,
    }) => {
      await freshApp(page);

      // 첫 카드 본문 탭 → 풀기, 자기 채점 또는 채점 경로로 fail 진입
      await page.locator(".prob-card-main").first().click();
      await page.locator(".solve-head").waitFor();
      await page.click(".reveal-give-up");

      await page.locator(".fail-classifier").waitFor();
      // 실행 실수 → 게이트 4개 + 저장 버튼이 화면에서 조작 가능해야 한다
      await page.click('.fail-classifier .chip-row .chip:has-text("실행 실수")');
      const boxes = page.locator(
        '.fail-classifier .gate-item input[type="checkbox"]'
      );
      await expect(boxes).toHaveCount(4);
      for (let i = 0; i < 4; i++) await boxes.nth(i).check();
      const save = page.locator(".fail-save");
      await save.scrollIntoViewIfNeeded();
      await expect(save).toBeEnabled();
      await save.click();
      await expect(page.locator(".verdict-stamp")).toBeVisible();
    });
  });
}
