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
      // 마스트헤드 제목이 글자 단위로 줄바꿈되면 안 된다 (한 줄 높이 이내)
      const titleBox = await page.locator(".masthead-title").boundingBox();
      expect(titleBox.height).toBeLessThan(45);
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

test.describe("야간 모드", () => {
  test("토글하면 테마가 바뀌고 새로고침 후에도 유지된다", async ({ page }) => {
    await freshApp(page);

    // 시스템 설정을 해석해 항상 명시적으로 붙는다 (브라우저 강제 반전 방지)
    const initial = await page.evaluate(() =>
      document.documentElement.getAttribute("data-theme")
    );
    expect(["light", "dark"]).toContain(initial);

    await page.click(".theme-toggle");
    const toggled = initial === "dark" ? "light" : "dark";
    await expect
      .poll(async () =>
        page.evaluate(() => document.documentElement.getAttribute("data-theme"))
      )
      .toBe(toggled);

    // 선택은 저장되어 새로고침을 넘긴다
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute("data-theme")
      )
    ).toBe(toggled);
  });

  test("야간 모드에서 배경과 글씨 대비가 유지된다", async ({ page }) => {
    await freshApp(page);
    await page.evaluate(() => localStorage.setItem("wr_theme", "dark"));
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    // 순흑/순백이 아니라 회색 계단이어야 한다
    const c = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        bg: s.getPropertyValue("--bg").trim(),
        text: s.getPropertyValue("--text").trim(),
      };
    });
    expect(c.bg).not.toBe("#000000");
    expect(c.text).not.toBe("#ffffff");

    // FAB가 배경에 묻히지 않는다 (야간엔 스탠드 불빛색)
    const fab = await page.evaluate(() => {
      const el = document.querySelector(".fab");
      return getComputedStyle(el).backgroundColor;
    });
    expect(fab).not.toBe("rgba(0, 0, 0, 0)");
  });
});

test.describe("화면 색 팔레트", () => {
  test("고르면 즉시 적용되고 새로고침 후에도 유지된다", async ({ page }) => {
    await freshApp(page);

    // 기본값은 항상 명시적으로 붙는다 (브라우저 강제 반전 방지)
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute("data-palette")
      )
    ).toBe("warm");

    await page.click('.tab:has-text("통계")');
    await page.click('.palette-card:has-text("세이지")');

    await expect
      .poll(async () =>
        page.evaluate(() =>
          document.documentElement.getAttribute("data-palette")
        )
      )
      .toBe("sage");

    // 실제로 색이 바뀌었는지 (토큰이 세이지 값인지)
    const bg = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--bg").trim()
    );
    expect(bg).toBe("#dde0d4");

    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    expect(
      await page.evaluate(() =>
        document.documentElement.getAttribute("data-palette")
      )
    ).toBe("sage");
  });

  test("팔레트와 낮·밤은 서로 독립이다", async ({ page }) => {
    await freshApp(page);
    await page.click('.tab:has-text("통계")');
    await page.click('.palette-card:has-text("흐린 하늘")');
    await page.click('.tab:has-text("문제")');

    const read = () =>
      page.evaluate(() => {
        const s = getComputedStyle(document.documentElement);
        return {
          palette: document.documentElement.getAttribute("data-palette"),
          theme: document.documentElement.getAttribute("data-theme"),
          bg: s.getPropertyValue("--bg").trim(),
        };
      });

    const before = await read();
    await page.click(".theme-toggle");
    await page.waitForTimeout(200);
    const after = await read();

    // 팔레트는 그대로, 모드만 바뀌고, 색은 달라져야 한다
    expect(after.palette).toBe(before.palette);
    expect(after.theme).not.toBe(before.theme);
    expect(after.bg).not.toBe(before.bg);
  });

  test("theme-color가 고른 팔레트의 지면색을 따라간다", async ({ page }) => {
    await freshApp(page);
    await page.click('.tab:has-text("통계")');
    await page.click('.palette-card:has-text("자두")');

    await expect
      .poll(async () =>
        page.evaluate(() =>
          document
            .querySelector('meta[name="theme-color"]')
            .getAttribute("content")
            .toLowerCase()
        )
      )
      .toBe("#faf5ec"); // 자두 주간 지면색
  });
});
