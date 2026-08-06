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

test.describe("설정 — 저장소 상태를 정직하게 보여준다", () => {
  const openSettings = (page) => page.click(".settings-open");

  test("영구가 아니면 축출 위험을 말하고 재요청 버튼을 준다", async ({ page }) => {
    await installStorageStub(page);
    await freshApp(page);
    await setStub(page, {
      __persisted: false,
      __persistResult: false,
      __estimate: JSON.stringify({ usage: 1310720, quota: 10485760 }),
    });
    await page.reload();
    await openSettings(page);

    const box = page.locator(".storage-health");
    await expect(box.locator(".storage-value.warn")).toHaveText("아니오");
    await expect(box.locator(".storage-row").nth(1)).toContainText("1.3MB");
    await expect(box.locator(".storage-row").nth(1)).toContainText("10.0MB");
    // 영구가 아닌데 "안전"이라고 말하면 안 된다
    await expect(box.locator(".storage-warn")).toContainText("통째로 지울 수 있다");

    // 재요청 → 이번엔 승인
    await setStub(page, { __persistResult: true });
    await box.locator('.btn:has-text("영구 보관 요청")').click();
    await expect(box.locator(".storage-value.ok")).toHaveText("예");
  });

  test("영구여도 직접 삭제 위험은 그대로 알린다", async ({ page }) => {
    await installStorageStub(page);
    await freshApp(page);
    await setStub(page, { __persisted: true, __estimate: JSON.stringify({}) });
    await page.reload();
    await openSettings(page);

    const box = page.locator(".storage-health");
    await expect(box.locator(".storage-value.ok")).toHaveText("예");
    await expect(box).toContainText("직접 사이트 데이터를 삭제하면");
    // estimate가 비면 0으로 꾸미지 않는다
    await expect(box.locator(".storage-row").nth(1)).toContainText("알 수 없음");
  });

  test("API가 없으면 안내만 하고 재요청 버튼은 없다", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "storage", {
        configurable: true,
        get: () => undefined,
      });
    });
    await freshApp(page);
    await openSettings(page);

    await expect(page.locator(".storage-health")).toContainText(
      "저장소 상태를 알려주지 않는다"
    );
    await expect(page.locator('.btn:has-text("영구 보관 요청")')).toHaveCount(0);
  });
});

test.describe("내보내기 신선도 — 시도가 아니라 확인 기준", () => {
  const openSettings = (page) => page.click(".settings-open");
  const DAY = 24 * 60 * 60 * 1000;
  const seedUserData = (page) =>
    page.evaluate(() => localStorage.setItem("wr_meta_has_user_data", "1"));
  const setConfirmed = (page, ms) =>
    page.evaluate(
      (v) => localStorage.setItem("wr_meta_last_export_confirmed", String(v)),
      ms
    );

  test("내보내기만으로는 경고가 꺼지지 않는다 — 받았다고 확인해야 꺼진다", async ({
    page,
  }) => {
    await freshApp(page);
    await seedUserData(page);
    await page.reload();
    await openSettings(page);
    await expect(page.locator(".backup-stale")).toContainText("확인된 백업이 아직 없다");

    const dl = page.waitForEvent("download");
    await page.click('.btn:has-text("내보내기 (JSON)")');
    await dl;

    /* 다운로드가 차단·취소돼도 여기까지는 온다. 그래서 아직 경고는 살아 있고
       확인을 요구한다 — 이게 조용한 백업 실패를 막는 유일한 장치다. */
    await expect(page.locator(".backup-stale")).toBeVisible();
    await expect(page.locator(".export-confirm")).toContainText("실제로 받았나");

    await page.click('.export-confirm .btn:has-text("받았다")');
    await expect(page.locator(".backup-stale")).toHaveCount(0);
    await expect(page.locator(".export-confirm")).toHaveCount(0);
  });

  test("확인된 백업이 일주일 넘으면 다시 알린다", async ({ page }) => {
    await freshApp(page);
    await seedUserData(page);
    await setConfirmed(page, Date.now() - 8 * DAY);
    await page.reload();
    await openSettings(page);
    await expect(page.locator(".backup-stale")).toContainText("일주일이 넘었다");

    await setConfirmed(page, Date.now() - 2 * DAY);
    await page.reload();
    await openSettings(page);
    await expect(page.locator(".backup-stale")).toHaveCount(0);
    await expect(page.locator(".last-export")).toContainText("마지막 확인된 백업");
  });

  test("시드 데이터만 있는 새 설치에는 경고하지 않는다", async ({ page }) => {
    await freshApp(page); // 시드 노트는 있지만 사용자가 만든 건 없다
    await openSettings(page);
    await expect(page.locator(".backup-stale")).toHaveCount(0);
  });

  test("노트를 하나 만들면 그때부터 경고한다", async ({ page }) => {
    await freshApp(page);
    await saveNote(page, "BACKUP-GATE");
    await openSettings(page);
    await expect(page.locator(".backup-stale")).toContainText("확인된 백업이 아직 없다");
  });

  test("알림은 설정 안에만 있다 — 탭 화면에 배너를 띄우지 않는다", async ({
    page,
  }) => {
    await freshApp(page);
    await seedUserData(page);
    await page.reload();
    for (const tab of ["문제", "풀기", "카드", "통계"]) {
      await page.getByRole("button", { name: new RegExp(`^${tab}`) }).first().click();
      await expect(page.locator(".backup-stale")).toHaveCount(0);
      await expect(page.locator(".audit-warn")).toHaveCount(0);
    }
    await openSettings(page);
    await expect(page.locator(".backup-stale")).toContainText("확인된 백업이 아직 없다");
  });
});
