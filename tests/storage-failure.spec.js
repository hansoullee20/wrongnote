import { test, expect } from "@playwright/test";
import { freshApp, readNotes, openNoteByProblem } from "./helpers.js";

// 1×1 픽셀 PNG (solution-images.spec.js와 같은 방식)
const TINY_PNG_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

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
          const r = req.result
            .transaction("images", "readonly")
            .objectStore("images")
            .getAllKeys();
          r.onsuccess = () => resolve(r.result.sort());
          r.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      })
  );

const seedBlobs = (page, ids) =>
  page.evaluate(
    ({ ids, url }) =>
      new Promise((resolve) => {
        const req = indexedDB.open("wrongnote", 1);
        req.onupgradeneeded = () => {
          if (!req.result.objectStoreNames.contains("images")) {
            req.result.createObjectStore("images");
          }
        };
        req.onsuccess = async () => {
          const blob = await (await fetch(url)).blob();
          const tx = req.result.transaction("images", "readwrite");
          const store = tx.objectStore("images");
          ids.forEach((id) => store.put(blob, id));
          tx.oncomplete = () => resolve();
          tx.onerror = () => resolve();
        };
        req.onerror = () => resolve();
      }),
    { ids, url: TINY_PNG_URL }
  );

const seedNoteWithImages = (page, { problem, images }) =>
  page.evaluate(
    ({ problem, images }) => {
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            id: "lock_n1",
            subject: "수학",
            problem,
            topicMain: "",
            topicSub: "",
            question: "",
            mySol: "",
            optSol: "",
            cause: "개념 부족",
            correctAnswer: "",
            myAnswer: "",
            examTime: "",
            derived: null,
            tags: [],
            memo: "",
            images,
            solutionImages: [],
            attempts: [],
            ts: Date.now(),
            date: "2026-08-06",
            rechecked: false,
            recheckResult: null,
            recheckCount: 0,
            nextRecheckTs: null,
          },
        ])
      );
      localStorage.setItem("wr_cards", "[]");
    },
    { problem, images }
  );

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

  test("기록 시트 안에서도 배너가 보인다 — 경고가 가장 필요한 순간이다", async ({
    page,
  }) => {
    await freshApp(page);
    await installQuotaTrap(page);
    await page.goto("/");
    await armQuota(page);
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    // 기록 시트는 .paper-sheet 밖의 전체화면 오버레이다. 여기서 만든 노트는
    // 저장되지 않고 사라지므로, 바로 이 화면에서 경고가 보여야 한다.
    await page.click(".fab"); // 문제 탭의 기록 버튼
    await expect(page.locator('.sheet-title:has-text("오답 기록")')).toBeVisible();
    await expect(page.locator(".sheet .audit-warn")).toBeVisible();
  });

  /* 잠긴 상태에서는 되돌릴 수 없는 IDB 파괴를 하지 않는다.
     IDB는 localStorage와 다른 저장소라 storageLocked가 자동으로 안 막는다.
     그대로 두면 노트 삭제는 디스크에 안 남고(=되살아남) 사진만 영구 소실된다.
     ⚠️ 최소 완화책이라 '첫 실패가 감지되기 전' 창은 남는다 — 근본 수정은 별도 Tier 2. */
  test("잠긴 상태의 노트 삭제는 사진을 지우지 않는다", async ({ page }) => {
    await freshApp(page);
    await seedBlobs(page, ["lock_img"]);
    await seedNoteWithImages(page, { problem: "LOCK-DEL", images: ["lock_img"] });

    await installQuotaTrap(page);
    await page.goto("/");
    await armQuota(page);
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    expect(await readImageIds(page)).toEqual(["lock_img"]);

    await openNoteByProblem(page, "LOCK-DEL");
    page.once("dialog", (d) => d.accept());
    await page.click(".sheet-delete");
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    // 노트는 디스크에 그대로 남아 새로고침하면 되살아난다.
    // 따라서 사진도 살아 있어야 한다 — 아니면 사진 없는 노트가 부활한다.
    expect(await readImageIds(page)).toEqual(["lock_img"]);
    const raw = await readRaw(page, "wr_notes");
    expect(raw).toContain("lock_img");
  });

  test("배경 배너와 시트 배너가 동시에 DOM에 남지 않는다", async ({ page }) => {
    await freshApp(page);
    await installQuotaTrap(page);
    await page.goto("/");
    await armQuota(page);
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    await expect(page.locator(".audit-warn")).toHaveCount(1);
    await page.click(".fab");
    await expect(page.locator('.sheet-title:has-text("오답 기록")')).toBeVisible();
    // 시트가 열려도 경고는 한 벌만 — 접근성 트리에 중복이 남으면 안 된다
    await expect(page.locator(".audit-warn")).toHaveCount(1);
    await expect(page.locator(".sheet .audit-warn")).toBeVisible();
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
