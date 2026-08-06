/** 테스트 공용 헬퍼 */

/** localStorage 비우고 새로 시작 */
export async function freshApp(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300); // 시드 로드 안정화
}

/* Dual-read shim for the E-2 atomic-state migration.
   Reads the wr_state envelope when present, else the legacy per-array keys.
   Landed BEFORE the storage change on purpose: with the app still writing
   legacy keys, the whole suite must pass unchanged. That makes the existing
   80 tests a control for the storage commit that follows — if a contract
   silently weakens, it shows up against this baseline, not after a mass edit. */
const readState = (page, field) =>
  page.evaluate((f) => {
    const raw = localStorage.getItem("wr_state");
    if (raw !== null) {
      try {
        const env = JSON.parse(raw);
        if (env && Array.isArray(env[f])) return env[f];
      } catch {
        return null; // 손상된 envelope는 레거시로 감추지 않는다
      }
    }
    const legacy = localStorage.getItem(f === "notes" ? "wr_notes" : "wr_cards");
    return legacy === null ? null : JSON.parse(legacy);
  }, field);

export const readNotes = (page) => readState(page, "notes");

export const readCards = (page) => readState(page, "cards");

/** v1 레거시 스토어 시드 (마이그레이션 테스트용) */
export async function seedLegacyStore(page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([
        {
          subject: "수학",
          problem: "LEGACY-1",
          topicMain: "수II·미분",
          topicSub: "접선",
          question: "레거시 문제",
          mySol: "내 풀이",
          optSol: "최적 풀이",
          tags: ["실행 실수"],
          derived: "no",
          memo: "",
          ts: Date.now() - 20 * 86400000,
          id: "legacy_n1",
          date: "2026-06-27",
          rechecked: false,
          recheckResult: null,
        },
      ])
    );
    localStorage.setItem(
      "gap_cards",
      JSON.stringify([
        {
          front: "레거시 카드",
          back: "뒷면",
          id: "legacy_c1",
          noteId: null,
          subject: "수학",
        },
      ])
    );
  });
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300);
}

/** 주원인은 v4부터 필수 — 저장 전에 하나 골라야 한다.
    기본값을 '개념 부족'으로 둬서 실행 실수 게이트가 뜨지 않게 한다. */
export const pickCause = (page, cause = "개념 부족") =>
  page.click(`.chip:has-text("${cause}")`);

/** 기록 폼은 v4부터 탭이 아니라 FAB로 여는 오버레이다 */
export async function openRecord(page) {
  await page.click(".fab");
  await page.locator(".sheet .form").first().waitFor();
}

/** 그리드에서 연필 버튼으로 수정 오버레이를 연다 (v5: 본문 탭은 바로 풀기) */
export async function openNoteByProblem(page, problem) {
  await page.click(`.prob-card:has-text("${problem}") .prob-card-edit`);
  await page.locator(".sheet .form").first().waitFor();
}

/** 기록 폼 1페이지(사실) → 2페이지(분석). 주원인·풀이·저장은 2페이지에 있다 */
export const goAnalysis = (page) =>
  page.click('.btn--primary:has-text("다음 — 왜 틀렸나")');
