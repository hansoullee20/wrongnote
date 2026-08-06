import { test, expect } from "@playwright/test";
import { freshApp, readNotes, openRecord, goAnalysis, pickCause } from "./helpers.js";

/**
 * 영구 저장소 요청.
 *
 * 이 앱은 서버가 없고 기기 한 대에만 산다. origin 저장소가 기본은 best-effort라
 * 안드로이드가 공간이 부족하면 **조용히 통째로 지운다.** 쿼터 초과보다 이쪽이
 * 실제 데이터 손실 경로다 — 노트 2,000건이라야 2.4MB다.
 */

/* navigator.storage는 읽기 전용 getter라 대입으로는 안 바뀐다 —
   반드시 defineProperty로 갈아끼워야 한다. */
const installStorageStub = (page) =>
  page.addInitScript(() => {
    Object.defineProperty(navigator, "storage", {
      configurable: true,
      get: () => ({
        persisted: async () => sessionStorage.getItem("__persisted") === "true",
        persist: async () => {
          const n = Number(sessionStorage.getItem("__persistCalls") || 0) + 1;
          sessionStorage.setItem("__persistCalls", String(n));
          const ok = sessionStorage.getItem("__persistResult") === "true";
          if (ok) sessionStorage.setItem("__persisted", "true");
          return ok;
        },
        estimate: async () =>
          JSON.parse(sessionStorage.getItem("__estimate") || "{}"),
      }),
    });
  });

const setStub = (page, cfg) =>
  page.evaluate((c) => {
    for (const [k, v] of Object.entries(c)) sessionStorage.setItem(k, String(v));
  }, cfg);

const persistCalls = (page) =>
  page.evaluate(() => Number(sessionStorage.getItem("__persistCalls") || 0));

const persistMeta = (page) =>
  page.evaluate(() => {
    const raw = localStorage.getItem("wr_meta_persistence_v1");
    return raw === null ? null : JSON.parse(raw);
  });

const saveNote = async (page, problem) => {
  await openRecord(page);
  await page.fill("#rec-problem", problem);
  await goAnalysis(page);
  await pickCause(page);
  await page.click('.btn--primary:has-text("저장")');
  await expect
    .poll(async () => (await readNotes(page)).some((n) => n.problem === problem))
    .toBe(true);
};

test.describe("영구 저장소 요청", () => {
  test("부팅만으로는 요청하지 않고, 첫 노트가 저장된 뒤 한 번만 요청한다", async ({
    page,
  }) => {
    await installStorageStub(page);
    await freshApp(page);
    await setStub(page, { __persisted: false, __persistResult: true });

    // 시드/마이그레이션 쓰기로는 요청하지 않는다 — 아직 사용자가 만든 게 없다
    expect(await persistCalls(page)).toBe(0);

    await saveNote(page, "PERSIST-1");
    await expect.poll(() => persistCalls(page)).toBe(1);
    expect((await persistMeta(page)).outcome).toBe("granted");

    // 두 번째 노트로도, 재시작으로도 다시 묻지 않는다 — 잔소리 금지
    await saveNote(page, "PERSIST-2");
    expect(await persistCalls(page)).toBe(1);
    await page.reload();
    await saveNote(page, "PERSIST-3");
    expect(await persistCalls(page)).toBe(1);
  });

  test("거부되면 denied로 남고 재부팅해도 다시 묻지 않는다", async ({ page }) => {
    await installStorageStub(page);
    await freshApp(page);
    await setStub(page, { __persisted: false, __persistResult: false });

    await saveNote(page, "PERSIST-DENY");
    await expect.poll(() => persistCalls(page)).toBe(1);
    expect((await persistMeta(page)).outcome).toBe("denied");

    await page.reload();
    await saveNote(page, "PERSIST-DENY-2");
    expect(await persistCalls(page)).toBe(1); // 매번 묻지 않는다
  });

  test("이미 영구면 persist()를 아예 부르지 않는다", async ({ page }) => {
    await installStorageStub(page);
    await freshApp(page);
    await setStub(page, { __persisted: true, __persistResult: true });

    await saveNote(page, "PERSIST-ALREADY");
    await expect.poll(async () => (await persistMeta(page))?.outcome).toBe("granted");
    expect(await persistCalls(page)).toBe(0); // 불필요한 프롬프트를 만들지 않는다
  });

  test("navigator.storage가 없어도 앱이 죽지 않는다", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        get: () => undefined,
      });
    });
    const errors = [];
    await freshApp(page);
    page.on("pageerror", (e) => errors.push(e.message));

    await saveNote(page, "PERSIST-UNSUPPORTED");
    expect((await persistMeta(page)).outcome).toBe("unsupported");
    expect(errors).toEqual([]);
  });
});
