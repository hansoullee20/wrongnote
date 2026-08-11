import { test, expect } from "@playwright/test";
import { freshApp, readNotes , pickCause , openRecord, openNoteByProblem , goAnalysis } from "./helpers.js";

// 1×1 픽셀 PNG (테스트용 최소 이미지)
const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** IDB 이미지 키 조회 헬퍼 */
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
          const db = req.result;
          const r = db
            .transaction("images", "readonly")
            .objectStore("images")
            .getAllKeys();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve([]);
        };
        req.onerror = () => resolve([]);
      })
  );

test.describe("문제 사진 첨부", () => {
  test.beforeEach(async ({ page }) => {
    // 외부 요청 전부 차단 (OCR 언어 데이터 CDN 포함) → 글자 인식은 빠르게
    // 실패하고, 사진 첨부는 그대로 동작해야 함. 로컬 모듈은 통과.
    await page.route(/^https?:\/\/(?!localhost)/, (route) => route.abort());
    await freshApp(page);
    await openRecord(page);
    await page.evaluate(
      () =>
        new Promise((resolve) => {
          const req = indexedDB.deleteDatabase("wrongnote");
          req.onsuccess = req.onerror = req.onblocked = () => resolve();
        })
    );
  });

  test("사진 첨부 → 저장 → 노트에 사진 id, IDB에 blob", async ({ page }) => {
    await page.fill("#rec-problem", "사진 노트 1");
    await page
      .locator('#rec-problem-photo')
      .setInputFiles({
        name: "problem.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });

    // 사진 썸네일이 폼에 떠야 함 (OCR 실패와 무관)
    await expect(page.locator(".photo-strip-item")).toHaveCount(1);

    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');

    await expect
      .poll(async () =>
        (await readNotes(page)).find((n) => n.problem === "사진 노트 1")
          ?.images?.length
      )
      .toBe(1);

    const ids = await readImageIds(page);
    expect(ids.length).toBe(1);

    // 그리드 카드가 캡처 자체를 썸네일로 보여준다 — 목록에서 문제가 보여야 한다
    await expect(
      page.locator('.prob-card:has-text("사진 노트 1") img.prob-shot')
    ).toBeVisible();
  });

  test("노트 삭제 → IDB 사진도 정리", async ({ page }) => {
    await page.fill("#rec-problem", "사진 삭제 테스트");
    await page
      .locator('#rec-problem-photo')
      .setInputFiles({
        name: "problem.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
    await expect(page.locator(".photo-strip-item")).toHaveCount(1);
    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');
    await expect.poll(async () => (await readImageIds(page)).length).toBe(1);

    page.on("dialog", (d) => d.accept());
    await openNoteByProblem(page, "사진 삭제 테스트");
    await page.click(".sheet-delete");

    await expect.poll(async () => (await readImageIds(page)).length).toBe(0);
  });

  test("폼에서 ✕로 제거하면 저장 시 사진 없음", async ({ page }) => {
    await page.fill("#rec-problem", "사진 제거 테스트");
    await page
      .locator('#rec-problem-photo')
      .setInputFiles({
        name: "problem.png",
        mimeType: "image/png",
        buffer: TINY_PNG,
      });
    await expect(page.locator(".photo-strip-item")).toHaveCount(1);
    await page.click(".photo-remove");
    await expect(page.locator(".photo-strip-item")).toHaveCount(0);

    await goAnalysis(page);
    await pickCause(page);
    await page.click('.btn--primary:has-text("저장")');
    await expect
      .poll(async () =>
        (await readNotes(page)).find((n) => n.problem === "사진 제거 테스트")
          ?.images?.length
      )
      .toBe(0);
    expect((await readImageIds(page)).length).toBe(0);
  });
});

/* 압축은 한 번에 하나만 돌아야 한다. 두 배치가 겹치면 저장이 아직 안 끝난
   사진을 빠뜨린 채 나가고, 사용자는 붙여넣은 사진이 사라진 걸 나중에 안다. */
test.describe("첨부 압축 직렬화", () => {
  /** createImageBitmap을 붙잡아 압축을 원하는 지점에 멈춘다 */
  const installCompressionGate = (page) =>
    page.addInitScript(() => {
      const original = window.createImageBitmap;
      window.__bitmapCalls = 0;
      window.__release = null;
      window.createImageBitmap = async function (...args) {
        window.__bitmapCalls += 1;
        await new Promise((resolve) => {
          window.__release = resolve;
        });
        return original.apply(this, args);
      };
    });

  const attachSolution = (page) =>
    page.locator("#rec-solution-photo").setInputFiles({
      name: "s.png",
      mimeType: "image/png",
      buffer: TINY_PNG,
    });

  test("압축 중 붙여넣기는 거부되고, 이유가 화면에 뜬다", async ({ page }) => {
    await installCompressionGate(page);
    await freshApp(page);
    await openRecord(page);
    await page.fill("#rec-problem", "직렬화-1");

    await attachSolution(page);
    await expect.poll(() => page.evaluate(() => window.__bitmapCalls)).toBe(1);

    // 압축이 멈춰 있는 동안 첨부·이동이 잠긴다
    await expect(page.locator("#rec-solution-photo")).toBeDisabled();
    await expect(page.locator(".photo-paste").first()).toHaveAttribute(
      "aria-disabled",
      "true"
    );
    await expect(
      page.locator('.btn--primary:has-text("다음 — 왜 틀렸나")')
    ).toBeDisabled();

    // 붙여넣기는 disabled로 막히지 않는다 — 핸들러가 직접 거부해야 한다
    await page.locator(".photo-paste").last().dispatchEvent("paste", {
      clipboardData: { files: [] },
    });
    await page.evaluate(() => {
      const zone = document.querySelectorAll(".photo-paste")[1];
      const file = new File([new Uint8Array([1, 2, 3])], "p.png", { type: "image/png" });
      const ev = new Event("paste", { bubbles: true, cancelable: true });
      Object.defineProperty(ev, "clipboardData", { value: { files: [file] } });
      zone.dispatchEvent(ev);
    });

    // 조용히 삼키지 않는다 — 지금 고치는 버그와 같은 계열이다
    await expect(page.locator(".io-error").first()).toContainText("사진 처리 중");
    // 두 번째 압축은 시작되지 않았다
    expect(await page.evaluate(() => window.__bitmapCalls)).toBe(1);

    await page.evaluate(() => window.__release && window.__release());
    await expect(page.locator("#rec-solution-photo")).toBeEnabled();
  });

  test("압축 파이프라인이 던져도 폼은 다시 열린다", async ({ page }) => {
    // compressImage는 스스로 삼키므로, 그 뒤 단계를 던지게 해서 catch를 태운다
    await page.addInitScript(() => {
      const original = URL.createObjectURL;
      // 폼을 연 뒤 명시적으로 무장한다 — 부팅 중 무관한 호출에 소모되면
      // 이 테스트는 통과하면서 아무것도 검증하지 않는다
      window.__armObjectUrlThrow = () => {
        window.__armed = true;
      };
      URL.createObjectURL = function (...args) {
        if (window.__armed) {
          window.__armed = false;
          throw new Error("boom");
        }
        return original.apply(this, args);
      };
    });
    await freshApp(page);
    await openRecord(page);
    await page.fill("#rec-problem", "직렬화-2");

    await page.evaluate(() => window.__armObjectUrlThrow());
    await attachSolution(page);

    // catch가 실제로 탔다는 증거 — 이게 없으면 아래 단언은 공짜로 통과한다
    await expect(page.locator(".io-error").first()).toContainText("사진 첨부 실패");

    // finally가 뮤텍스를 풀지 않으면 여기서 영구히 잠긴다 (저장까지 막힌다)
    await expect(page.locator("#rec-solution-photo")).toBeEnabled();
    await expect(
      page.locator('.btn--primary:has-text("다음 — 왜 틀렸나")')
    ).toBeEnabled();

    // 그리고 실제로 재시도가 된다
    await attachSolution(page);
    await expect(page.locator(".photo-strip-item")).toHaveCount(1);
  });
});
