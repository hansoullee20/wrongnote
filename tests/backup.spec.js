import { test, expect } from "@playwright/test";
import { freshApp, readNotes, readCards } from "./helpers.js";

test.describe("백업 내보내기/가져오기", () => {
  test("내보내기는 version 봉투를 쓴다", async ({ page }) => {
    await freshApp(page);
    await page.click('.tab:has-text("통계")');

    const downloadPromise = page.waitForEvent("download");
    await page.click('.btn:has-text("내보내기 (JSON)")');
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    expect(parsed.version).toBe(4);
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(Array.isArray(parsed.cards)).toBe(true);
    expect(typeof parsed.images).toBe("object"); // 사진 base64 맵 포함
  });

  test("v1 백업(버전 없음) 가져오기 → 마이그레이션되어 교체", async ({
    page,
  }) => {
    await freshApp(page);
    await page.click('.tab:has-text("통계")');

    const v1Backup = {
      notes: [
        {
          subject: "수학",
          problem: "V1-IMPORT",
          topicMain: "",
          topicSub: "",
          question: "",
          mySol: "",
          optSol: "",
          tags: [],
          derived: null,
          memo: "",
          ts: Date.now(),
          id: "v1_n1",
          date: "2026-07-17",
          rechecked: false,
          recheckResult: null,
        },
      ],
      cards: [
        {
          front: "V1 카드",
          back: "뒷면",
          id: "v1_c1",
          noteId: null,
          subject: "수학",
        },
      ],
    };

    page.on("dialog", (d) => d.accept());
    // 가져오기 직전 자동 백업 다운로드가 발생한다 — 이벤트만 소비
    page.on("download", () => {});

    const fileInput = page.locator('input[type="file"][accept*="json"]');
    await fileInput.setInputFiles({
      name: "v1_backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(v1Backup), "utf8"),
    });

    await expect
      .poll(async () => (await readNotes(page)).length)
      .toBe(1);

    const note = (await readNotes(page))[0];
    expect(note.problem).toBe("V1-IMPORT");
    expect(note.recheckCount).toBe(0); // 마이그레이션 필드 부여됨

    const card = (await readCards(page))[0];
    expect(card.front).toBe("V1 카드");
    expect(card.ease).toBe(2.5); // SRS 필드 부여됨
  });
});
