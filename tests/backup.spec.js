import { test, expect } from "@playwright/test";
import { freshApp, readNotes, readCards } from "./helpers.js";

test.describe("백업 내보내기/가져오기", () => {
  test("내보내기는 version 봉투를 쓴다", async ({ page }) => {
    await freshApp(page);
    await page.click(".settings-open"); // 백업은 이제 설정 시트 안

    const downloadPromise = page.waitForEvent("download");
    await page.click('.btn:has-text("내보내기 (JSON)")');
    const download = await downloadPromise;

    const stream = await download.createReadStream();
    const chunks = [];
    for await (const c of stream) chunks.push(c);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    expect(parsed.version).toBe(6); // v6: 시도별 도움 사용 여부
    expect(Array.isArray(parsed.notes)).toBe(true);
    expect(Array.isArray(parsed.cards)).toBe(true);
    expect(typeof parsed.images).toBe("object"); // 사진 base64 맵 포함
  });

  test("v1 백업(버전 없음) 가져오기 → 마이그레이션되어 교체", async ({
    page,
  }) => {
    await freshApp(page);
    await page.click(".settings-open"); // 백업은 이제 설정 시트 안

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

/* A3 — 자동 스냅샷은 **되돌릴 수 있어야** 백업이다. 예전엔 원본 문자열을
   넣어뒀는데 importEnvelope는 배열을 요구해서, 이 백업만으로는 복원이
   불가능했다 (DevTools로 꺼내도 모양이 안 맞는다). */
test.describe("자동 스냅샷 복원 가능성 (A3)", () => {
  test("전이 스냅샷을 그대로 가져오기에 넣으면 복원된다", async ({ page }) => {
    // v5 스토어를 심어 v5→v6 전이 스냅샷을 만들게 한다
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학", problem: "SNAP-1", topicMain: "", topicSub: "",
            question: "", mySol: "", optSol: "", cause: "실행 실수", tags: [],
            derived: null, memo: "", correctAnswer: "③", myAnswer: "",
            examTime: "", images: [], solutionImages: [], attempts: [],
            ts: 1700000000000, id: "snap1", date: "2026-06-01",
            rechecked: false, recheckResult: null, recheckCount: 0,
            nextRecheckTs: null,
          },
        ])
      );
      localStorage.setItem(
        "wr_cards",
        JSON.stringify([
          { front: "스냅 카드", back: "뒤", id: "sc1", noteId: "snap1", subject: "수학" },
        ])
      );
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    const snapshot = await page.evaluate(() =>
      localStorage.getItem("wr_backup_v5_to_v6")
    );
    expect(snapshot).not.toBeNull();

    // 데이터를 전혀 다른 상태로 만든 뒤, 스냅샷 파일 하나로 되돌린다
    await page.evaluate(() => {
      localStorage.setItem("wr_notes", JSON.stringify([]));
      localStorage.setItem("wr_cards", JSON.stringify([]));
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);
    expect((await readNotes(page)).length).toBe(0);

    await page.click(".settings-open");
    page.on("dialog", (d) => d.accept());
    page.on("download", () => {});
    await page
      .locator('input[type="file"][accept*="json"]')
      .setInputFiles({
        name: "wr_backup_v5_to_v6.json",
        mimeType: "application/json",
        buffer: Buffer.from(snapshot, "utf8"),
      });

    await expect.poll(async () => (await readNotes(page)).length).toBe(1);
    expect((await readNotes(page))[0].problem).toBe("SNAP-1");
    expect((await readCards(page))[0].front).toBe("스냅 카드");
  });

  test("파싱 실패면 스냅샷을 찍지 않는다 — 빈 백업은 백업이 아니다", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem("wr_notes", "{망가진!!");
      localStorage.setItem("wr_cards", JSON.stringify([]));
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(400);

    expect(
      await page.evaluate(() => localStorage.getItem("wr_backup_v5_to_v6"))
    ).toBeNull();
    // 원본은 그대로 남는다
    expect(await page.evaluate(() => localStorage.getItem("wr_notes"))).toBe(
      "{망가진!!"
    );
  });
});

/* A5 — 봉투 버전은 지금까지 적기만 하고 읽지 않았다. 미래 스키마 파일을
   구버전 코드가 받아들이면, 그 뜻을 모른 채 현재 스키마로 다시 써서
   되돌릴 수 없게 만든다. */
test.describe("가져오기 버전 검증 (A5)", () => {
  const mkFile = (obj) => ({
    name: "b.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(obj), "utf8"),
  });
  const NOTE = {
    subject: "수학", problem: "VER-1", topicMain: "", topicSub: "",
    question: "", mySol: "", optSol: "", tags: [], derived: null, memo: "",
    ts: 1700000000000, id: "ver1", date: "2026-06-01",
  };

  async function attemptImport(page, payload) {
    await freshApp(page);
    const before = JSON.stringify(await readNotes(page));
    await page.click(".settings-open");
    page.on("dialog", (d) => d.accept());
    page.on("download", () => {});
    await page
      .locator('input[type="file"][accept*="json"]')
      .setInputFiles(mkFile(payload));
    await page.waitForTimeout(500);
    return before;
  }

  test("현재 버전 봉투는 들어온다", async ({ page }) => {
    await attemptImport(page, { version: 6, notes: [NOTE], cards: [] });
    await expect.poll(async () => (await readNotes(page)).length).toBe(1);
    expect((await readNotes(page))[0].problem).toBe("VER-1");
  });

  test("버전 없는 레거시 백업은 계속 들어온다", async ({ page }) => {
    await attemptImport(page, { notes: [NOTE], cards: [] });
    await expect.poll(async () => (await readNotes(page)).length).toBe(1);
  });

  for (const [label, version] of [
    ["미래 버전", 99],
    ["0", 0],
    ["음수", -1],
    ["소수", 6.5],
    ["문자열", "6"],
  ]) {
    test(`${label} 봉투는 거부하고 데이터를 건드리지 않는다`, async ({
      page,
    }) => {
      const before = await attemptImport(page, {
        version,
        notes: [NOTE],
        cards: [],
      });
      // 오류 표시 + 기존 데이터 바이트 동일
      await expect(page.locator(".io-error").first()).toContainText(
        "가져오기 실패"
      );
      expect(JSON.stringify(await readNotes(page))).toBe(before);
    });
  }
});

/* H3 — 다운그레이드 잠금 중 내보내기는 유일한 구조 수단이다. 그 파일이
   "현재 버전"이라고 주장하면, 실제로는 더 새로운 데이터를 담고도 구버전인
   척하게 된다. 구조 수단은 제 내용을 속이면 안 된다. */
test.describe("다운그레이드 중 내보내기 버전 (H3)", () => {
  test("저장된(더 새로운) 버전을 그대로 찍는다", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "9"); // 미래 빌드가 남긴 상태
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학", problem: "FUTURE-1", topicMain: "", topicSub: "",
            question: "", mySol: "", optSol: "", tags: [], derived: null,
            memo: "", ts: 1700000000000, id: "f1", date: "2026-06-01",
          },
        ])
      );
      localStorage.setItem("wr_cards", JSON.stringify([]));
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    await page.click(".settings-open");
    const downloadPromise = page.waitForEvent("download");
    await page.click('.btn:has-text("내보내기 (JSON)")');
    const download = await downloadPromise;
    const chunks = [];
    for await (const c of await download.createReadStream()) chunks.push(c);
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));

    // 데이터가 따르는 실제 스키마를 찍는다 — 현재 코드 버전이 아니라
    expect(parsed.version).toBe(9);
    expect(parsed.notes[0].problem).toBe("FUTURE-1");
  });
});
