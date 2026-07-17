import { test, expect } from "@playwright/test";
import { seedLegacyStore, readNotes, readCards } from "./helpers.js";

test.describe("스토리지 마이그레이션 (v1→v2)", () => {
  test("레거시 스토어: SRS/재검증 필드 추가, 백업 스냅샷, 버전 승격", async ({
    page,
  }) => {
    await seedLegacyStore(page);

    const version = await page.evaluate(() =>
      localStorage.getItem("wr_schema_version")
    );
    expect(version).toBe("2");

    // v1 원본 스냅샷 존재
    const backup = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v1"))
    );
    expect(backup.notes).toContain("LEGACY-1");
    expect(backup.cards).toContain("레거시 카드");

    // 카드: SRS 기본값, 내용 보존
    const card = (await readCards(page))[0];
    expect(card.front).toBe("레거시 카드");
    expect(card.ease).toBe(2.5);
    expect(card.interval).toBe(0);
    expect(card.state).toBe("new");
    expect(typeof card.due).toBe("number");

    // 노트: 반복 재검증 필드, 내용 보존
    const note = (await readNotes(page))[0];
    expect(note.problem).toBe("LEGACY-1");
    expect(note.recheckCount).toBe(0);
    expect(note.nextRecheckTs).toBe(null);

    // 레거시 키는 읽기 전용 보존
    expect(
      await page.evaluate(() => localStorage.getItem("gap_cards") !== null)
    ).toBe(true);
  });

  test("마이그레이션은 멱등 — 재로드해도 데이터 불변", async ({ page }) => {
    await seedLegacyStore(page);
    const snap1 = JSON.stringify([
      await readNotes(page),
      await readCards(page),
    ]);

    await page.reload();
    await page.getByRole("button", { name: /^기록/ }).waitFor();
    await page.waitForTimeout(300);

    const snap2 = JSON.stringify([
      await readNotes(page),
      await readCards(page),
    ]);
    expect(snap2).toBe(snap1);
  });

  test("손상된 데이터: 저장 잠금 + 원본 보존 + 배너 표시", async ({
    page,
  }) => {
    await seedLegacyStore(page);
    await page.evaluate(() =>
      localStorage.setItem("wr_notes", "{corrupted!!")
    );
    await page.reload();
    await page.getByRole("button", { name: /^기록/ }).waitFor();
    await page.waitForTimeout(500);

    await expect(page.locator(".audit-warn").first()).toBeVisible();
    const raw = await page.evaluate(() => localStorage.getItem("wr_notes"));
    expect(raw).toBe("{corrupted!!");
  });
});
