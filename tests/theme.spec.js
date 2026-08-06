import { test, expect } from "@playwright/test";
import { freshApp } from "./helpers.js";
import { PALETTES } from "../src/palettes.js";

/**
 * 화면 색 · 낮/밤.
 *
 * 예전엔 첫 실행 때 시스템 값을 읽어 "light"/"dark"로 **굳혀** 저장했다.
 * 그래서 그 뒤로는 기기 설정을 바꿔도 앱이 따라가지 않았다.
 * 이제 선택(system|light|dark)과 해석 결과(light|dark)를 나눠 관리한다.
 */

const pref = (page) => page.evaluate(() => localStorage.getItem("wr_theme"));
const applied = (page) => page.getAttribute("html", "data-theme");
const themeColor = (page) =>
  page.getAttribute('meta[name="theme-color"]', "content");

/** 기기 설정을 흉내낸다. emulateMedia는 matchMedia와 change 이벤트를 모두 움직인다. */
const setSystem = (page, scheme) => page.emulateMedia({ colorScheme: scheme });

const openSettings = (page) => page.click(".settings-open");

test.describe("시스템 설정을 계속 따라간다", () => {
  test("저장값이 없고 기기가 야간이면 야간으로 뜬다", async ({ page }) => {
    await setSystem(page, "dark");
    await freshApp(page);

    expect(await applied(page)).toBe("dark");
    expect(await pref(page)).toBe("system"); // 해석 결과가 아니라 선택을 저장한다
  });

  test("system 상태에서 기기가 바뀌면 즉시 전환된다", async ({ page }) => {
    await setSystem(page, "light");
    await freshApp(page);
    expect(await applied(page)).toBe("light");

    // 앱을 켜둔 채로 기기 설정만 바꾼다 — 새로고침 없이 따라와야 한다
    await setSystem(page, "dark");
    await expect.poll(() => applied(page)).toBe("dark");

    await setSystem(page, "light");
    await expect.poll(() => applied(page)).toBe("light");

    expect(await pref(page)).toBe("system"); // 저장된 선택은 그대로다
  });

  test("주간으로 고정하면 기기 변경을 무시한다", async ({ page }) => {
    await setSystem(page, "light");
    await freshApp(page);
    await openSettings(page);
    await page.click('.mode-switch-btn:has-text("주간")');
    expect(await pref(page)).toBe("light");

    await setSystem(page, "dark");
    await page.waitForTimeout(200);
    expect(await applied(page)).toBe("light"); // 고정은 고정이다
  });

  test("야간으로 고정하면 기기 변경을 무시한다", async ({ page }) => {
    await setSystem(page, "dark");
    await freshApp(page);
    await openSettings(page);
    await page.click('.mode-switch-btn:has-text("야간")');
    expect(await pref(page)).toBe("dark");

    await setSystem(page, "light");
    await page.waitForTimeout(200);
    expect(await applied(page)).toBe("dark");
  });

  test("시스템 선택 시 현재 해석 결과를 보여준다", async ({ page }) => {
    await setSystem(page, "dark");
    await freshApp(page);
    await openSettings(page);

    await expect(page.locator(".resolved-theme")).toContainText("야간");
    await setSystem(page, "light");
    await expect(page.locator(".resolved-theme")).toContainText("주간");

    // 고정 모드에서는 이 안내가 뜻이 없으므로 감춘다
    await page.click('.mode-switch-btn:has-text("야간")');
    await expect(page.locator(".resolved-theme")).toHaveCount(0);
  });
});

test.describe("기존 저장값 호환", () => {
  for (const saved of ["light", "dark"]) {
    test(`옛 "${saved}" 저장값은 고정 선택으로 계속 동작한다`, async ({ page }) => {
      await setSystem(page, saved === "light" ? "dark" : "light"); // 기기는 반대로
      await freshApp(page);
      await page.evaluate((v) => localStorage.setItem("wr_theme", v), saved);
      await page.reload();
      await page.getByRole("button", { name: /^문제/ }).waitFor();

      expect(await applied(page)).toBe(saved); // 기기 설정을 이기고 유지된다
      expect(await pref(page)).toBe(saved); // system으로 덮어쓰지 않는다
    });
  }
});

test.describe("팔레트", () => {
  test("새 팔레트 2종을 고르면 새로고침 후에도 유지된다", async ({ page }) => {
    await freshApp(page);
    for (const id of ["graphite", "navy"]) {
      await openSettings(page);
      await page.click(`.palette-card:has-text("${id === "navy" ? "남색" : "흑연"}")`);
      await page.reload();
      await page.getByRole("button", { name: /^문제/ }).waitFor();
      expect(await page.getAttribute("html", "data-palette")).toBe(id);
    }
  });

  test("8종 전부 주간·야간에서 렌더되고 theme-color가 따라간다", async ({
    page,
  }) => {
    await freshApp(page);
    await openSettings(page);
    await expect(page.locator(".palette-card")).toHaveCount(PALETTES.length);
    expect(PALETTES.length).toBe(8);

    for (const p of PALETTES) {
      await page.evaluate((id) => localStorage.setItem("wr_palette", id), p.id);
      for (const mode of ["light", "dark"]) {
        await page.evaluate((m) => localStorage.setItem("wr_theme", m), mode);
        await page.reload();
        await page.getByRole("button", { name: /^문제/ }).waitFor();

        expect(await page.getAttribute("html", "data-palette")).toBe(p.id);
        expect(await applied(page)).toBe(mode);
        // 상태표시줄 색이 해석된 모드 + 현재 팔레트의 지면색과 맞아야 한다
        const expected = mode === "dark" ? p.night.paper : p.day.paper;
        expect((await themeColor(page)).toLowerCase()).toBe(expected);
      }
    }
  });

  test("선택 표시가 색에만 의존하지 않는다", async ({ page }) => {
    await freshApp(page);
    await openSettings(page);
    const selected = page.locator('.palette-card[aria-pressed="true"]');
    await expect(selected).toHaveCount(1);
    await expect(selected.locator(".palette-name")).toContainText("✓");
  });
});

test.describe("의미 토큰", () => {
  test("일반 primary는 실패색이 아니라 행동색이다", async ({ page }) => {
    await freshApp(page);
    for (const mode of ["light", "dark"]) {
      await page.evaluate((m) => localStorage.setItem("wr_theme", m), mode);
      await page.reload();
      await page.getByRole("button", { name: /^문제/ }).waitFor();

      const v = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        const get = (n) => cs.getPropertyValue(n).trim();
        return {
          primary: get("--primary"),
          action: get("--action"),
          error: get("--error"),
          redPen: get("--red-pen"),
        };
      });
      // 입력 포커스·선택 칩·통계 막대가 오답색으로 보이면 안 된다
      expect(v.primary).toBe(v.action);
      expect(v.primary).not.toBe(v.error);
      expect(v.error).toBe(v.redPen); // 실패는 계속 빨간펜이다
    }
  });
});
