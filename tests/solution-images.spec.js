import { test, expect } from "@playwright/test";
import { freshApp, openNoteByProblem } from "./helpers.js";

/**
 * 풀이 사진(solutionImages) 수명주기.
 *
 * 이 필드는 마이그레이션에서 보존만 되고 아무도 읽지 않았다. 삭제·GC·내보내기가
 * 전부 n.images만 봤기 때문에, 채워지는 순간:
 *   - 삭제 시 blob이 남고 (누수)
 *   - 가져오기 시 GC가 살아 있는 사진을 지웠다 (손실 — 셋 중 유일하게 복구 불가)
 *
 * 세 경로 각각을 실제 앱 동선으로 잠근다. 핵심 케이스는
 * "solutionImages만 있고 images는 빈 노트" — 이때 옛 코드는 참조 목록이
 * 통째로 비어 GC가 전부 쓸어갔다.
 */

// 1×1 픽셀 PNG
const TINY_PNG_B64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const TINY_PNG_URL = `data:image/png;base64,${TINY_PNG_B64}`;

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

/** IDB에 blob 직접 심기 — 앱 UI를 거치지 않고 사진이 이미 있는 상태를 만든다 */
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

/** 노트 1건을 localStorage에 심는다 (사진 id는 이미 IDB에 있다고 가정) */
const seedNote = (page, { problem, images, solutionImages }) =>
  page.evaluate(
    ({ problem, images, solutionImages }) => {
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            id: "sol_n1",
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
            solutionImages,
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
    { problem, images, solutionImages }
  );

test.describe("풀이 사진 수명주기", () => {
  test.beforeEach(async ({ page }) => {
    await freshApp(page);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase("wrongnote");
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        })
    );
  });

  test("가져오기 GC가 풀이 사진을 지우지 않는다 (images가 비어도)", async ({
    page,
  }) => {
    // 가져올 백업: 문제 사진 없이 풀이 사진만 있는 노트.
    // 옛 코드는 n.images만 봐서 참조 목록이 빈 배열이 되고 GC가 전부 지웠다.
    const backup = {
      version: 5,
      notes: [
        {
          id: "imp_n1",
          subject: "수학",
          problem: "GC-SOLUTION",
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
          images: [],
          solutionImages: ["sol_keep"],
          attempts: [],
          ts: Date.now(),
          date: "2026-08-06",
          rechecked: false,
          recheckResult: null,
          recheckCount: 0,
          nextRecheckTs: null,
        },
      ],
      cards: [],
      images: { sol_keep: TINY_PNG_URL },
    };

    await page.click(".settings-open");
    page.once("dialog", (d) => d.accept()); // 교체 확인
    const dl = page.waitForEvent("download"); // 교체 직전 자동 백업
    await page
      .locator('input[type="file"][accept=".json,application/json"]')
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup), "utf8"),
      });
    await dl;

    await expect
      .poll(() => readImageIds(page), { timeout: 5000 })
      .toEqual(["sol_keep"]);
  });

  test("가져오기 GC는 고아 blob은 그대로 수거한다", async ({ page }) => {
    // 위 수정이 GC를 무력화한 게 아니라는 대조군
    await seedBlobs(page, ["orphan_x"]);
    expect(await readImageIds(page)).toEqual(["orphan_x"]);

    const backup = {
      version: 5,
      notes: [],
      cards: [],
      images: {},
    };
    await page.click(".settings-open");
    page.once("dialog", (d) => d.accept());
    const dl = page.waitForEvent("download");
    await page
      .locator('input[type="file"][accept=".json,application/json"]')
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup), "utf8"),
      });
    await dl;

    await expect.poll(() => readImageIds(page), { timeout: 5000 }).toEqual([]);
  });

  test("노트 삭제 시 문제 사진과 풀이 사진이 모두 정리된다", async ({
    page,
  }) => {
    await seedBlobs(page, ["prob_a", "sol_a"]);
    await seedNote(page, {
      problem: "DEL-BOTH",
      images: ["prob_a"],
      solutionImages: ["sol_a"],
    });
    await page.reload();
    expect(await readImageIds(page)).toEqual(["prob_a", "sol_a"]);

    await openNoteByProblem(page, "DEL-BOTH");
    page.once("dialog", (d) => d.accept());
    await page.click(".sheet-delete");

    await expect.poll(() => readImageIds(page), { timeout: 5000 }).toEqual([]);
  });

  test("내보내기에 풀이 사진 blob이 포함된다", async ({ page }) => {
    await seedBlobs(page, ["prob_b", "sol_b"]);
    await seedNote(page, {
      problem: "EXPORT-BOTH",
      images: ["prob_b"],
      solutionImages: ["sol_b"],
    });
    await page.reload();

    await page.click(".settings-open");
    const downloadPromise = page.waitForEvent("download");
    await page.click('.btn:has-text("내보내기 (JSON)")');
    const download = await downloadPromise;

    const chunks = [];
    for await (const c of await download.createReadStream()) chunks.push(c);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    // 풀이 사진이 빠지면 백업으로 복원했을 때 조용히 사라진다
    expect(Object.keys(parsed.images).sort()).toEqual(["prob_b", "sol_b"]);
  });
});
