import { test, expect } from "@playwright/test";
import {
  freshApp,
  readNotes,
  readCards,
  seedLegacyStore,
  writeState,
  openNoteByProblem,
  openRecord,
  goAnalysis,
  pickCause,
} from "./helpers.js";

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
  writeState(
    page,
    [
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
    ],
    []
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

/* 데이터 키 전부. `wr_state`가 여기 없으면 앱이 트랩이 안 막는 키로 써버려서
   **모든 쿼터 테스트가 아무것도 검증하지 않으면서 통과한다** — 실패가 아니라
   침묵이라 알아채기 어렵다. 저장 키를 추가하면 반드시 여기도 추가할 것.
   `wr_meta_*`는 제외한다: 설정 성격이고 savePref로 따로 다룬다. */
const DATA_KEYS = ["wr_state", "wr_notes", "wr_cards", "wr_schema_version"];

/**
 * setItem을 감싸 특정 키에서만 QuotaExceededError를 던진다.
 * 원본 setItem은 보존한다 — 시드 단계는 정상 저장으로 남겨야
 * "쓰기가 막힌 상태에서 기존 데이터가 그대로인가"를 단언할 수 있다.
 * 플래그가 sessionStorage에 있는 이유: reload를 넘어 살아남아야 한다.
 *
 * @param keys 막을 키 목록. 기본은 데이터 키 전부.
 *   일부만 넘기면 "notes는 실패하고 cards는 성공" 같은 **부분 실패**를 만들 수 있다 —
 *   원자적 저장이 그 조합을 도달 불가능하게 만들었는지 단언하는 데 쓴다.
 */
const installQuotaTrap = (page, keys = DATA_KEYS) =>
  page.addInitScript((blocked) => {
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key, value) {
      if (this === localStorage && sessionStorage.getItem("__quota") === "on") {
        if (blocked.includes(key)) {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
      }
      return original.call(this, key, value);
    };
  }, keys);

const armQuota = (page) =>
  page.evaluate(() => sessionStorage.setItem("__quota", "on"));

/**
 * IndexedDB 쓰기 실패 트랩. localStorage용 installQuotaTrap과 **다른 저장소**라
 * 재사용할 수 없다 — 이 구분이 이번 수정의 핵심이기도 하다.
 * `images` store의 N번째 put에서만 던진다. seedBlobs도 raw put을 쓰므로
 * 반드시 시드가 끝난 **뒤에** arm해야 한다.
 */
const installIdbPutTrap = (page) =>
  page.addInitScript(() => {
    const original = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      const failAt = Number(sessionStorage.getItem("__idbFailAt") || 0);
      if (failAt > 0 && this.name === "images") {
        const n = Number(sessionStorage.getItem("__idbPutCount") || 0) + 1;
        sessionStorage.setItem("__idbPutCount", String(n));
        if (n >= failAt) {
          const err = new Error("idb quota");
          err.name = "QuotaExceededError";
          throw err;
        }
      }
      return original.apply(this, args);
    };
  });

const armIdbFailAt = (page, n) =>
  page.evaluate((n) => {
    sessionStorage.setItem("__idbPutCount", "0");
    sessionStorage.setItem("__idbFailAt", String(n));
  }, n);

const disarmIdb = (page) =>
  page.evaluate(() => sessionStorage.removeItem("__idbFailAt"));

/** 파일 선택기로 사진 N장 첨부 */
const attachPhotos = async (page, count) => {
  const files = Array.from({ length: count }, (_, i) => ({
    name: `p${i}.png`,
    mimeType: "image/png",
    buffer: Buffer.from(TINY_PNG_URL.split(",")[1], "base64"),
  }));
  await page.setInputFiles('input[type="file"][accept="image/*"]', files);
  await expect(page.locator(".photo-strip-item")).toHaveCount(count);
};

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

    /* 권위 키를 망가뜨린다. 레거시 키를 망가뜨려도 이제 아무 일도 안 일어난다 —
       wr_state가 있으면 그것만 읽기 때문이다. 앱이 실제로 읽는 것을 망가뜨려야
       이 테스트가 의미를 가진다. */
    await page.evaluate(() =>
      localStorage.setItem("wr_state", "{corrupted!!")
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
    expect(await readRaw(page, "wr_state")).toBe("{corrupted!!");
  });
});

test.describe("쓰기 실패 — 죽지 않고, 구조 수단은 열어둔다", () => {
  test("부팅 중 quota: 앱이 렌더되고 배너가 뜨며 디스크 원문이 유지된다", async ({
    page,
  }) => {
    await freshApp(page); // 정상 데이터 시드 (이 시점엔 트랩 없음)
    /* 앱이 실제로 쓰는 키를 읽어야 한다. wr_notes는 전환 뒤 null이라
       "막힌 뒤에도 null" = 비교가 통과해버린다 — 침묵하는 가짜 통과다. */
    const seeded = await readRaw(page, "wr_state");
    const seededVersion = await readRaw(page, "wr_schema_version");

    await installQuotaTrap(page);
    await page.goto("/");
    await armQuota(page);
    await page.reload();

    // 백지가 아니다 — 이게 이 테스트의 핵심이다
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await expect(page.locator(".audit-warn").first()).toBeVisible();

    // 쓰기가 전부 막혔으므로 디스크는 시드 그대로
    expect(await readRaw(page, "wr_state")).toBe(seeded);
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
    const raw = await readRaw(page, "wr_state");
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

/**
 * IDB 쓰기 실패 (F). localStorage와 **다른 저장소**라 쿼터도 따로 찬다 —
 * localStorage가 멀쩡해도 여기는 찰 수 있다.
 *
 * 예전엔 submit()이 async인데 try/catch가 없어서 putImage가 reject하면
 * unhandled rejection이 나고 onAdd가 안 불렸다. 즉 **노트가 통째로 저장되지
 * 않는데 사용자에겐 아무 메시지도 없었다.**
 */
test.describe("IDB 저장 실패 — 조용히 삼키지 않는다", () => {
  test("두 번째 사진 저장 실패 → 기록 중단·문구 표시, 재시도 시 중복 저장 없음", async ({
    page,
  }) => {
    const pageErrors = [];
    await installIdbPutTrap(page);
    await freshApp(page);
    page.on("pageerror", (e) => pageErrors.push(e.message));

    await openRecord(page);
    await page.fill("#rec-problem", "IDB-FAIL");
    await attachPhotos(page, 2);
    await goAnalysis(page);
    await pickCause(page);

    // 두 번째 put에서 실패
    await armIdbFailAt(page, 2);
    await page.click('.btn--primary:has-text("저장")');

    // 실패는 저장 버튼이 있는 2페이지에서 보여야 한다
    await expect(page.locator(".io-error")).toContainText("사진 저장에 실패했다");
    expect((await readNotes(page)).some((n) => n.problem === "IDB-FAIL")).toBe(
      false
    );
    expect(pageErrors).toEqual([]); // unhandled rejection 없음
    expect((await readImageIds(page)).length).toBe(1); // 첫 장만 들어갔다

    // 재시도 — 첫 장은 체크포인트돼 있어 다시 저장하지 않는다
    await disarmIdb(page);
    await page.click('.btn--primary:has-text("저장")');
    await expect
      .poll(async () => (await readNotes(page)).some((n) => n.problem === "IDB-FAIL"))
      .toBe(true);

    const saved = (await readNotes(page)).find((n) => n.problem === "IDB-FAIL");
    expect(saved.images.length).toBe(2);
    // 총 blob이 2개 — 첫 장이 세 번째 blob으로 중복 저장되지 않았다
    expect((await readImageIds(page)).length).toBe(2);
  });
});

test.describe("IDB 복원 실패 — 가져오기를 중단한다", () => {
  test("두 번째 사진 복원 실패 → 교체 취소, 기존 데이터 보존", async ({
    page,
  }) => {
    await installIdbPutTrap(page);
    await freshApp(page);
    const before = await readRaw(page, "wr_state");

    const backup = {
      version: 5,
      notes: [
        {
          id: "imp_n1",
          subject: "수학",
          problem: "IMPORT-FAIL",
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
          images: ["imp_a", "imp_b"],
          solutionImages: [],
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
      images: { imp_a: TINY_PNG_URL, imp_b: TINY_PNG_URL },
    };

    await openSettings(page);
    await armIdbFailAt(page, 2); // 두 번째 사진 복원에서 실패
    page.once("dialog", (d) => d.accept());
    await page
      .locator('input[type="file"][accept=".json,application/json"]')
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup), "utf8"),
      });

    await expect(page.locator(".io-error")).toContainText("사진 복원에 실패했다");

    // 교체가 일어나지 않았다 — 기존 데이터 원문 그대로
    expect(await readRaw(page, "wr_state")).toBe(before);
    expect(
      (await readNotes(page)).some((n) => n.problem === "IMPORT-FAIL")
    ).toBe(false);

    // 첫 사진만 IDB에 남을 수 있다 — 즉시 삭제하지 않고 D-gc 회수 대상으로 둔다.
    // 교체가 진행되지 않았다는 증거이기도 하다.
    expect((await readImageIds(page)).length).toBeLessThanOrEqual(1);

    // 트랩 해제 후 재가져오기 → 노트와 사진 2장이 모두 복원된다
    await disarmIdb(page);
    page.once("dialog", (d) => d.accept());
    await page
      .locator('input[type="file"][accept=".json,application/json"]')
      .setInputFiles({
        name: "backup.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(backup), "utf8"),
      });

    await expect
      .poll(async () =>
        (await readNotes(page)).some((n) => n.problem === "IMPORT-FAIL")
      )
      .toBe(true);
    expect(await readImageIds(page)).toEqual(["imp_a", "imp_b"]);
  });
});

/**
 * 원자적 저장 (E-2). 불변식 하나다:
 * **노트와 카드는 한 번의 setItem으로 쓰인다. 하나만 앞서가는 중간 상태가 없다.**
 *
 * 이전에는 wr_notes와 wr_cards가 따로 쓰였고, addNote가 한 렌더에서 둘을 바꾸면
 * 두 저장 이펙트가 같은 flush에서 같은 stale storageLocked를 캡처했다.
 * 큰 notes가 실패하고 작은 cards가 성공하면 없는 노트를 가리키는 카드가 남았다.
 */
const noteFixture = (problem) => ({
  id: `fx_${problem}`,
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
  images: [],
  solutionImages: [],
  attempts: [],
  ts: Date.now(),
  date: "2026-08-06",
  rechecked: false,
  recheckResult: null,
  recheckCount: 0,
  nextRecheckTs: null,
});

test.describe("원자적 저장 — 노트와 카드가 함께 간다", () => {
  test("레거시 저장소는 wr_state로 옮겨지고, 레거시 원문은 건드리지 않는다", async ({
    page,
  }) => {
    await seedLegacyStore(page);

    const env = JSON.parse(await readRaw(page, "wr_state"));
    expect(Array.isArray(env.notes)).toBe(true);
    expect(Array.isArray(env.cards)).toBe(true);
    expect(env.notes.some((n) => n.problem === "LEGACY-1")).toBe(true);

    /* 레거시 키는 지우지도, 덮지도 않는다 — 지우는 것도 실패할 수 있는 쓰기다.
       마이그레이션 결과가 레거시 키에 덮였다면 recheckCount가 채워져 있을 것이다.
       비어 있어야 전환 직전 상태의 사본으로 남은 것이다. */
    const legacy = JSON.parse(await readRaw(page, "wr_notes"));
    expect(legacy[0].problem).toBe("LEGACY-1");
    expect(legacy[0].recheckCount).toBeUndefined();
  });

  test("노트 쓰기가 막히면 카드도 디스크에 남지 않는다 — 고아 카드가 생길 수 없다", async ({
    page,
  }) => {
    await freshApp(page);

    /* 노트를 담는 키만 막고 wr_cards는 열어둔다.
       E-2 이전: wr_notes 실패 / wr_cards 성공 → 재시작 뒤 고아 카드가 남았다.
       E-2 이후: 쓰기가 wr_state 하나뿐이라 그 조합 자체가 존재할 수 없다.

       ⚠️ 부팅 **뒤에** arm해야 한다. 부팅 전에 켜면 부팅 쓰기가 먼저 실패해
       storageLocked가 처음부터 켜지고, 그러면 두 이펙트가 **둘 다** 건너뛰어
       고아 카드가 애초에 만들어지지 않는다 — 옛 코드에서도 테스트가 통과해
       아무것도 증명하지 못한다. 재현에 필요한 건 "성공하던 세션 중에 처음
       실패하는" 상태다. 그래서 arm 뒤에 reload하지 않는다. */
    await installQuotaTrap(page, ["wr_state", "wr_notes"]);
    await page.goto("/");
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await armQuota(page);

    // 재유도 노트라 저장되면 카드가 자동 생성된다 — 두 배열을 한 렌더에서 바꾼다
    await openRecord(page);
    await page.fill("#rec-problem", "ATOMIC-1");
    await goAnalysis(page);
    await page.fill("#rec-optsol", "최적 풀이 내용");
    await page.click('.chip:has-text("재유도함")');
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect(page.locator(".audit-warn").first()).toBeVisible();

    // 새로고침하면 디스크에 남은 것만 보인다
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    expect(
      (await readNotes(page)).some((n) => n.problem === "ATOMIC-1")
    ).toBe(false);
    expect(
      (await readCards(page)).some((c) => c.front === "ATOMIC-1")
    ).toBe(false);
  });

  test("wr_state가 봉투 모양이 아니면 잠근다 — 레거시로 내려가지 않는다", async ({
    page,
  }) => {
    await freshApp(page);
    /* cards가 없는 반쪽 봉투. 레거시에는 멀쩡한 데이터가 있다.
       여기서 레거시로 내려가면 반쯤 쓰인 봉투를 낡은 데이터로 덮어 가리게 된다 —
       E-2가 없애려는 바로 그 불일치를, 조용히. 그래서 시끄럽게 잠근다. */
    await page.evaluate((legacyNote) => {
      localStorage.setItem("wr_notes", JSON.stringify([legacyNote]));
      localStorage.setItem("wr_state", JSON.stringify({ notes: [] }));
    }, noteFixture("LEGACY-FALLBACK"));
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    await expect(page.locator(".audit-warn").first()).toBeVisible();
    await expect(
      page.locator('.prob-card:has-text("LEGACY-FALLBACK")')
    ).toHaveCount(0);

    // 빈 메모리로 내보내면 빈 백업이 나간다 → 막혀 있어야 한다
    await openSettings(page);
    await expect(page.locator('.btn:has-text("내보내기 (JSON)")')).toBeDisabled();
  });

  test("전환 쓰기가 용량으로 막혀도 앱은 살고 레거시 원문이 보존된다", async ({
    page,
  }) => {
    await seedLegacyStore(page);

    /* 순서가 중요하다. addInitScript는 다음 네비게이션부터 붙고 armQuota는 그
       뒤에 켜지므로, goto 시점의 부팅은 아직 막히지 않은 채 wr_state를 만든다.
       그래서 **goto 뒤에** 지우고 arm한 다음 reload해야, 트랩이 켜진 상태로
       wr_state가 없는 부팅 — 즉 진짜 전환 시도 — 이 재현된다. */
    await installQuotaTrap(page, ["wr_state"]);
    await page.goto("/");
    await page.evaluate(() => localStorage.removeItem("wr_state"));
    const legacyBefore = await readRaw(page, "wr_notes");
    await armQuota(page);
    await page.reload();

    // 백지가 아니다 — 레거시 경로로 계속 읽는다
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await expect(page.locator(".audit-warn").first()).toBeVisible();

    // 전환은 못 했지만 잃은 것도 없다. 다음 부팅에 다시 시도한다.
    expect(await readRaw(page, "wr_state")).toBeNull();
    expect(await readRaw(page, "wr_notes")).toBe(legacyBefore);
  });

  test("wr_state가 있으면 낡은 레거시 키는 무시된다", async ({ page }) => {
    await freshApp(page);
    await writeState(page, [noteFixture("STATE-WINS")], []);
    await page.evaluate((stale) => {
      localStorage.setItem("wr_notes", JSON.stringify([stale]));
    }, noteFixture("LEGACY-STALE"));
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    /* 화면을 본다 — 헬퍼는 wr_state를 먼저 읽으므로 헬퍼만 보면
       앱이 무엇을 읽었는지 알 수 없다. */
    await expect(page.locator('.prob-card:has-text("STATE-WINS")')).toHaveCount(1);
    await expect(
      page.locator('.prob-card:has-text("LEGACY-STALE")')
    ).toHaveCount(0);
  });
});
