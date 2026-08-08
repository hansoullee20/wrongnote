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
    test(`옛 "${saved}" 저장값은 고정 선택으로 계속 동작한다`, async ({
      page,
    }) => {
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
      await page.click(
        `.palette-card:has-text("${id === "navy" ? "남색" : "흑연"}")`,
      );
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

/**
 * 페인트 전 스크립트 (index.html).
 *
 * 이 스크립트의 계약 전체가 React 마운트 **이전**에 끝난다. 그래서 앱이 뜬
 * 뒤에 보는 어떤 단언도 이걸 검증하지 못한다 — App의 테마 이펙트가 같은
 * 속성을 다시 찍어서 스크립트가 통째로 빠져 있어도 초록으로 지나간다.
 * 여기서는 /src/main.jsx를 막아 React를 아예 실행시키지 않고, 페인트 전
 * 상태 그대로를 본다. localStorage는 페이지 스크립트보다 먼저 도는
 * addInitScript로 갈아끼운다.
 */
test.describe("첫 페인트 — React 없이", () => {
  /** 페이지 스크립트보다 먼저 getItem을 갈아끼운다. throws는 던질 키 목록. */
  const stubStorage = (page, { values = {}, throws = [] }) =>
    page.addInitScript(
      ([v, t]) => {
        const real = Storage.prototype.getItem;
        Storage.prototype.getItem = function (key) {
          if (t.includes(key))
            throw new DOMException("blocked", "SecurityError");
          if (key in v) return v[key];
          return real.call(this, key);
        };
      },
      [values, throws],
    );

  /** React를 막고 페인트 전 상태에서 멈춘다. */
  const prePaint = async (page) => {
    await page.route("**/src/main.jsx*", (r) => r.abort());
    await page.goto("/");
    // React가 정말 안 돌았는지 먼저 확인한다 — 이게 깨지면 나머지는 무의미하다
    await expect(page.locator("#root")).toBeEmpty();
  };

  const attrs = (page) =>
    page.evaluate(() => ({
      theme: document.documentElement.getAttribute("data-theme"),
      palette: document.documentElement.getAttribute("data-palette"),
    }));

  test("팔레트 읽기가 던져도 주야는 이미 찍혀 있다 — 커밋 B의 계약", async ({
    page,
  }) => {
    await stubStorage(page, {
      values: { wr_theme: "dark" },
      throws: ["wr_palette"],
    });
    await prePaint(page);

    /* 커밋 B가 팔레트 읽기를 따로 감쌌기 때문에 던진 예외가 안에서 먹히고
       기본 팔레트까지 정상으로 찍힌다. 안쪽 try가 없으면 예외가 바깥
       catch로 올라가 data-palette이 통째로 안 찍힌다(null) — 그 차이가
       이 단언의 전부다. */
    expect(await attrs(page)).toEqual({ theme: "dark", palette: "warm" });
  });

  test("주야 읽기가 막히면 기기 설정으로 물러난다", async ({ page }) => {
    await setSystem(page, "dark");
    await stubStorage(page, { throws: ["wr_theme"] });
    await prePaint(page);

    expect(await attrs(page)).toEqual({ theme: "dark", palette: "warm" });
  });

  test("저장값이 망가져 있으면 그대로 쓰지 않고 기기 설정으로 해석한다", async ({
    page,
  }) => {
    await setSystem(page, "dark");
    await stubStorage(page, { values: { wr_theme: "banana" } });
    await prePaint(page);

    // "banana"를 data-theme에 그대로 찍으면 themes.css가 아무것도 못 받는다
    expect(await attrs(page)).toEqual({ theme: "dark", palette: "warm" });
  });

  test("system 저장값은 기기 설정으로 해석한다", async ({ page }) => {
    await setSystem(page, "dark");
    await stubStorage(page, { values: { wr_theme: "system" } });
    await prePaint(page);

    expect(await attrs(page)).toEqual({ theme: "dark", palette: "warm" });
  });

  test("기기 설정 API가 던져도 기본 주야·팔레트를 찍는다", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window, "matchMedia", {
        value: () => {
          throw new DOMException("blocked", "SecurityError");
        },
      });
    });
    await prePaint(page);

    expect(await attrs(page)).toEqual({ theme: "light", palette: "warm" });
  });

  test("모르는 팔레트 id가 와도 주야는 정확하다", async ({ page }) => {
    await setSystem(page, "dark");
    await stubStorage(page, {
      values: { wr_theme: "dark", wr_palette: "no-such-palette" },
    });
    await prePaint(page);

    /* 모르는 id는 일부러 그대로 통과시킨다 — 번들 전이라 유효 id 목록을
       모른다. themes.css의 :root[data-theme="dark"] 기본값이 받아준다.
       중요한 건 그래도 data-theme이 야간이라는 것. */
    const { theme } = await attrs(page);
    expect(theme).toBe("dark");
  });

  test("localStorage가 통째로 막혀도 기기 설정대로 뜬다", async ({ page }) => {
    await setSystem(page, "dark");
    await stubStorage(page, { throws: ["wr_theme", "wr_palette"] });
    await prePaint(page);

    // 두 읽기 모두 각자 감싸여 있으니 둘 다 기본값까지 도달한다
    expect(await attrs(page)).toEqual({ theme: "dark", palette: "warm" });
  });
});
