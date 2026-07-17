/** 테스트 공용 헬퍼 */

/** localStorage 비우고 새로 시작 */
export async function freshApp(page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.getByRole("button", { name: /^기록/ }).waitFor();
  await page.waitForTimeout(300); // 시드 로드 안정화
}

export const readNotes = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("wr_notes")));

export const readCards = (page) =>
  page.evaluate(() => JSON.parse(localStorage.getItem("wr_cards")));

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
  await page.getByRole("button", { name: /^기록/ }).waitFor();
  await page.waitForTimeout(300);
}
