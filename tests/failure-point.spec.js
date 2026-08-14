import { test, expect } from "@playwright/test";
import {
  freshApp,
  readNotes,
  seedLegacyStore,
  openRecord,
  openNoteByProblem,
  pickCause,
  goAnalysis,
} from "./helpers.js";

/* 스키마 v8 — 실패 지점(failurePoint).
   프롬프트는 예전부터 failurePoint를 요구했지만 parseAiImport가 버렸고,
   노트에도 담을 자리가 없었다. 자리를 먼저 만든다 (커밋 0, 스키마 단독).
   AI 봉투에서 값을 실어오는 건 별도 커밋이다. */

test.describe("스키마 v8 — 실패 지점", () => {
  test("레거시 노트는 실패 지점 빈 값으로 승격되고 버전이 8이 된다", async ({
    page,
  }) => {
    await seedLegacyStore(page);

    const version = await page.evaluate(() =>
      localStorage.getItem("wr_schema_version")
    );
    expect(version).toBe("8");

    // 전이 키는 도착 버전까지 포함한다 — v7 스냅샷을 재사용하면 안 된다
    const backup = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v1_to_v8"))
    );
    expect(backup.notes.map((n) => n.problem)).toContain("LEGACY-1");

    const note = (await readNotes(page))[0];
    expect(note.failurePoint).toBe("");
    // 승격이 기존 내용을 건드리지 않았는지 — 추가 필드는 추가만 해야 한다
    expect(note.problem).toBe("LEGACY-1");
    expect(note.memo).toBe("");
  });

  test("적어 넣은 실패 지점이 저장된다", async ({ page }) => {
    await freshApp(page);
    await openRecord(page);
    await page.fill("#rec-problem", "FP-1");
    await goAnalysis(page);
    await pickCause(page);
    await page.fill("#rec-failure-point", "적분 구간을 뒤집었다");
    await page.click('.btn--primary:has-text("저장")');

    const note = (await readNotes(page)).find((n) => n.problem === "FP-1");
    expect(note.failurePoint).toBe("적분 구간을 뒤집었다");
  });

  test("수정 폼을 다시 열어도 실패 지점이 남아 있다", async ({ page }) => {
    /* startEdit가 필드를 빠뜨리면 화면엔 빈 칸이 뜨고, 그대로 저장하는
       순간 값이 조용히 지워진다. 필드를 만들 때 가장 흔한 사고다. */
    await freshApp(page);
    await openRecord(page);
    await page.fill("#rec-problem", "FP-EDIT");
    await goAnalysis(page);
    await pickCause(page);
    await page.fill("#rec-failure-point", "부호를 놓쳤다");
    await page.click('.btn--primary:has-text("저장")');

    await openNoteByProblem(page, "FP-EDIT");
    await goAnalysis(page);
    await expect(page.locator("#rec-failure-point")).toHaveValue("부호를 놓쳤다");

    // 다른 필드만 고쳐 저장해도 실패 지점은 살아남아야 한다
    await page.fill("#rec-optsol", "최적 풀이");
    await page.click('.btn--primary:has-text("수정 저장")');

    const note = (await readNotes(page)).find((n) => n.problem === "FP-EDIT");
    expect(note.failurePoint).toBe("부호를 놓쳤다");
  });
});
