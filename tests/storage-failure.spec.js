import { test, expect } from "@playwright/test";
import { freshApp, readNotes } from "./helpers.js";

/**
 * 저장소 실패 계약.
 *
 * 실패는 두 종류이고 앱이 이 둘을 다르게 다뤄야 한다:
 *
 * - 파싱 실패 — 원본을 못 읽었다. 메모리의 notes/cards는 빈 배열이다.
 *   이때 내보내기를 열어두면 "정상 백업"처럼 보이는 **빈 파일**을 쥐여준다.
 *   원본은 localStorage에 멀쩡히 있는데도. 그래서 내보내기까지 막는다.
 *
 * - 쓰기 실패(용량 초과) — 읽기는 성공했다. 메모리는 온전하고 디스크가 뒤처진다.
 *   내보내기가 유일한 구조 수단이라 반드시 열어둔다. 대신 절대 던지면 안 된다 —
 *   부팅 경로에서 던지면 useState(loadAll) 안이라 영구 백지가 되고,
 *   저장 이펙트에서 던지면 React가 트리를 언마운트한다.
 */

/**
 * setItem을 감싸 특정 키에서만 QuotaExceededError를 던진다.
 * 원본 setItem은 보존한다 — 시드 단계는 정상 저장으로 남겨야
 * "쓰기가 막힌 상태에서 기존 데이터가 그대로인가"를 단언할 수 있다.
 * 플래그가 sessionStorage에 있는 이유: reload를 넘어 살아남아야 한다.
 */
const installQuotaTrap = (page) =>
  page.addInitScript(() => {
    const BLOCKED = ["wr_notes", "wr_cards", "wr_schema_version"];
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && sessionStorage.getItem("__quota") === "on") {
        if (BLOCKED.includes(key)) {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
      }
      return original.call(this, key, value);
    };
  });

const armQuota = (page) =>
  page.evaluate(() => sessionStorage.setItem("__quota", "on"));

const readRaw = (page, key) =>
  page.evaluate((k) => localStorage.getItem(k), key);

const openSettings = async (page) => {
  await page.click(".settings-open");
};

test.describe("파싱 실패 — 내보내기까지 막는다", () => {
  test("빈 백업을 만들 수 없다: 내보내기·가져오기 둘 다 비활성, 원본 보존", async ({
    page,
  }) => {
    await freshApp(page);
    const before = await readNotes(page);
    expect(before.length).toBeGreaterThan(0); // 시드가 실제로 있다

    await page.evaluate(() =>
      localStorage.setItem("wr_notes", "{corrupted!!")
    );
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    await expect(page.locator(".audit-warn").first()).toBeVisible();

    await openSettings(page);
    // 메모리가 빈 상태이므로 내보내기를 허용하면 빈 파일이 나간다 → 막혀 있어야 한다
    await expect(page.locator('.btn:has-text("내보내기 (JSON)")')).toBeDisabled();
    await expect(
      page.locator('.btn:has-text("가져오기 (전체 교체)")')
    ).toBeDisabled();

    // 원본은 한 글자도 안 바뀐다
    expect(await readRaw(page, "wr_notes")).toBe("{corrupted!!");
  });
});

test.describe("쓰기 실패 — 죽지 않고, 구조 수단은 열어둔다", () => {
  test("부팅 중 quota: 앱이 렌더되고 배너가 뜨며 디스크 원문이 유지된다", async ({
    page,
  }) => {
    await freshApp(page); // 정상 데이터 시드 (이 시점엔 트랩 없음)
    const seeded = await readRaw(page, "wr_notes");
    const seededVersion = await readRaw(page, "wr_schema_version");

    await installQuotaTrap(page);
    await page.goto("/");
    await armQuota(page);
    await page.reload();

    // 백지가 아니다 — 이게 이 테스트의 핵심이다
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await expect(page.locator(".audit-warn").first()).toBeVisible();

    // 쓰기가 전부 막혔으므로 디스크는 시드 그대로
    expect(await readRaw(page, "wr_notes")).toBe(seeded);
    expect(await readRaw(page, "wr_schema_version")).toBe(seededVersion);
  });

  test("쓰기 실패 상태에서 내보내기는 살아 있고 가져오기는 막힌다", async ({
    page,
  }) => {
    await freshApp(page);
    await installQuotaTrap(page);
    await page.goto("/");
    await armQuota(page);
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    await openSettings(page);
    // 메모리 데이터는 온전하다 → 내보내기가 유일한 구조 수단이므로 열려 있어야 한다
    await expect(page.locator('.btn:has-text("내보내기 (JSON)")')).toBeEnabled();
    await expect(
      page.locator('.btn:has-text("가져오기 (전체 교체)")')
    ).toBeDisabled();

    // 실제로 내용이 있는 파일이 나온다 (빈 백업이 아니다)
    const downloadPromise = page.waitForEvent("download");
    await page.click('.btn:has-text("내보내기 (JSON)")');
    const download = await downloadPromise;
    const chunks = [];
    for await (const c of (await download.createReadStream())) chunks.push(c);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    expect(parsed.notes.length).toBeGreaterThan(0);
  });

  test("테마·팔레트 저장이 막혀도 앱이 죽지 않고 화면에는 적용된다", async ({
    page,
  }) => {
    await freshApp(page);
    // 설정 키까지 막는다 — 토글 한 번에 트리가 죽는지 보는 게 목적
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key.startsWith("wr_")) {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
        return original.call(this, key, value);
      };
    });
    await page.goto("/");
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    const before = await page.getAttribute("html", "data-theme");
    await page.click(".theme-toggle");

    // 앱이 살아 있고 화면에는 반영됐다
    await expect(page.getByRole("button", { name: /^문제/ })).toBeVisible();
    expect(await page.getAttribute("html", "data-theme")).not.toBe(before);
  });
});
