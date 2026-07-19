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
    expect(version).toBe("4");

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

    // 노트: 반복 재검증 + 사진 필드, 내용 보존
    const note = (await readNotes(page))[0];
    expect(note.problem).toBe("LEGACY-1");
    expect(note.recheckCount).toBe(0);
    expect(note.nextRecheckTs).toBe(null);
    expect(note.images).toEqual([]);

    // 레거시 키는 읽기 전용 보존
    expect(
      await page.evaluate(() => localStorage.getItem("gap_cards") !== null)
    ).toBe(true);
  });

  test("v4: 옛 태그 → 주원인 1개, 답/시도 이력 필드 추가", async ({ page }) => {
    await seedLegacyStore(page);

    const note = (await readNotes(page))[0];
    // '실행 실수' 태그 → 주원인 '실행 실수'
    expect(note.cause).toBe("실행 실수");
    // 세부 태그는 그대로 보존 (주원인으로 옮겼다고 지우지 않는다)
    expect(note.tags).toContain("실행 실수");
    expect(note.correctAnswer).toBe("");
    expect(note.myAnswer).toBe("");
    expect(note.examTime).toBe("");
    expect(note.attempts).toEqual([]);
    expect(note.solutionImages).toEqual([]);
  });

  test("v4: 옛 태그별 주원인 매핑", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      const mk = (id, tags) => ({
        subject: "수학",
        problem: id,
        topicMain: "수II·미분",
        topicSub: "",
        question: "",
        mySol: "",
        optSol: "",
        tags,
        derived: null,
        memo: "",
        ts: Date.now(),
        id,
        date: "2026-07-19",
      });
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          mk("N-concept", ["개념 오류"]),
          mk("N-read", ["독해 오류"]),
          mk("N-strategy", ["문제 파악 실패"]),
          mk("N-time", ["시간 부족"]),
          mk("N-dropped", ["지위 오해"]),
          mk("N-none", []),
        ])
      );
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);

    const byId = Object.fromEntries(
      (await readNotes(page)).map((n) => [n.id, n])
    );
    expect(byId["N-concept"].cause).toBe("개념 부족");
    expect(byId["N-read"].cause).toBe("읽기 실패");
    expect(byId["N-strategy"].cause).toBe("전략 실패");
    expect(byId["N-time"].cause).toBe("시간 부족");

    // '지위 오해'는 뜻이 소실된 카테고리 — 추측해서 옮기지 않고 미분류로 둔다
    expect(byId["N-dropped"].cause).toBe("");
    // 다만 태그 자체는 지우지 않는다 (데이터 손실 방지)
    expect(byId["N-dropped"].tags).toContain("지위 오해");

    expect(byId["N-none"].cause).toBe("");
  });

  test("v4: 이미 주원인이 있으면 옛 태그가 덮어쓰지 않는다", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학",
            problem: "N-1",
            topicMain: "",
            topicSub: "",
            question: "",
            mySol: "",
            optSol: "",
            // 사용자가 나중에 '개념 부족'으로 고쳤는데 옛 태그는 남아 있는 상태
            cause: "개념 부족",
            tags: ["실행 실수"],
            derived: null,
            memo: "",
            ts: Date.now(),
            id: "n1",
            date: "2026-07-19",
          },
        ])
      );
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);

    expect((await readNotes(page))[0].cause).toBe("개념 부족");
  });

  test("마이그레이션은 멱등 — 재로드해도 데이터 불변", async ({ page }) => {
    await seedLegacyStore(page);
    const snap1 = JSON.stringify([
      await readNotes(page),
      await readCards(page),
    ]);

    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
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
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(500);

    await expect(page.locator(".audit-warn").first()).toBeVisible();
    const raw = await page.evaluate(() => localStorage.getItem("wr_notes"));
    expect(raw).toBe("{corrupted!!");
  });
});

test.describe("업그레이드 직전 스냅샷", () => {
  test("버전마다 따로 남는다 — 첫 스냅샷이 있어도 건너뛰지 않는다", async ({
    page,
  }) => {
    await page.goto("/");
    // v3 데이터 + v1 시절 스냅샷이 이미 존재하는 상태 (실제 태블릿과 같은 상황)
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "3");
      localStorage.setItem("wr_backup_v1", JSON.stringify({ savedAt: 1, notes: "old", cards: "old" }));
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학", problem: "PRE-V4", topicMain: "", topicSub: "",
            question: "", mySol: "", optSol: "", tags: ["개념 오류"],
            derived: null, memo: "", ts: Date.now(), id: "p1", date: "2026-07-19",
          },
        ])
      );
      localStorage.setItem("wr_cards", JSON.stringify([]));
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);

    // v3 직전 상태가 새 키로 보존돼야 한다
    const snap = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v3"))
    );
    expect(snap.notes).toContain("PRE-V4");
    // 옛 스냅샷은 건드리지 않는다
    const old = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v1"))
    );
    expect(old.notes).toBe("old");
    // 마이그레이션 자체는 정상 수행
    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("4");
  });
});
