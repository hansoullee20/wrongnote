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
    expect(version).toBe("6"); // v6: 시도별 도움 사용 여부

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

test.describe("v5 → v6 도움 여부 마이그레이션", () => {
  /** 완전한 v5 노트 하나를 심는다 — attempt는 이미 superset 형태다 */
  async function seedV5Store(page) {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학",
            problem: "V5-1",
            topicMain: "수II·미분",
            topicSub: "접선",
            question: "",
            mySol: "",
            optSol: "",
            cause: "실행 실수",
            tags: ["부호 실수"],
            derived: null,
            memo: "노트 메모",
            correctAnswer: "③",
            myAnswer: "②",
            examTime: "",
            images: [],
            solutionImages: [],
            attempts: [
              {
                id: "a-fail",
                ts: 1700000100000,
                answer: "②",
                correct: false,
                result: "fail",
                seconds: 390,
                cause: "실행 실수",
                tags: ["부호 실수"],
                memo: "부호를 놓쳤다",
                source: "recheck",
                extra: "keep",
              },
              {
                id: "a-pass",
                ts: 1700000200000,
                answer: "③",
                correct: true,
                result: "pass",
                seconds: 120,
                cause: "",
                tags: [],
                memo: "",
                source: "solution_reveal",
              },
            ],
            ts: 1700000000000,
            id: "v5n1",
            date: "2026-06-01",
            rechecked: true,
            recheckResult: "pass",
            recheckCount: 1,
            nextRecheckTs: 1700500000000,
          },
        ])
      );
      localStorage.setItem(
        "wr_cards",
        JSON.stringify([
          {
            front: "v5 카드",
            back: "뒤",
            id: "c1",
            noteId: "v5n1",
            subject: "수학",
            interval: 3,
            ease: 2.3,
            due: 1700400000000,
            reps: 2,
            lapses: 1,
            state: "review",
            lastReviewed: 1700300000000,
          },
        ])
      );
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);
  }

  test("모든 과거 시도는 assisted:false, 그 밖의 필드는 무손상", async ({
    page,
  }) => {
    await seedV5Store(page);

    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("6");

    // v5 직전 원본이 새 키로 보존된다
    const backup = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v5"))
    );
    expect(backup.notes).toContain("V5-1");
    expect(backup.cards).toContain("v5 카드");

    const note = (await readNotes(page))[0];
    const [a0, a1] = note.attempts;

    // 과거는 도움 여부를 알 수 없다 — 추측하지 않고 전부 false
    expect(a0.assisted).toBe(false);
    expect(a1.assisted).toBe(false);

    // attempt 필드 무손상 (id는 이미 있으므로 legacy: 로 덮이지 않는다)
    expect(a0.id).toBe("a-fail");
    expect(a0.ts).toBe(1700000100000);
    expect(a0.result).toBe("fail");
    expect(a0.cause).toBe("실행 실수");
    expect(a0.tags).toEqual(["부호 실수"]);
    expect(a0.memo).toBe("부호를 놓쳤다");
    expect(a0.source).toBe("recheck");
    expect(a0.extra).toBe("keep"); // 모르는 필드도 보존
    expect(a1.id).toBe("a-pass");
    expect(a1.correct).toBe(true);
    expect(a1.source).toBe("solution_reveal");

    // 노트 필드 무손상
    expect(note.cause).toBe("실행 실수");
    expect(note.memo).toBe("노트 메모");
    expect(note.recheckCount).toBe(1);
    expect(note.nextRecheckTs).toBe(1700500000000);

    // 카드 필드 무손상 — v6는 카드를 건드리지 않는다
    const card = (await readCards(page))[0];
    expect(card.interval).toBe(3);
    expect(card.ease).toBe(2.3);
    expect(card.state).toBe("review");
    expect(card.lastReviewed).toBe(1700300000000);
  });

  test("v5→v6도 멱등 — 재로드해도 바이트 동일", async ({ page }) => {
    await seedV5Store(page);
    const snap1 = JSON.stringify([
      await readNotes(page),
      await readCards(page),
    ]);

    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);

    expect(
      JSON.stringify([await readNotes(page), await readCards(page)])
    ).toBe(snap1);
  });

  test("저장된 assisted가 true가 아니면 전부 false로 떨어진다", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      const mkAttempt = (id, assisted) => ({
        id,
        ts: 1700000100000,
        answer: "",
        correct: false,
        result: "fail",
        seconds: null,
        cause: "",
        tags: [],
        memo: "",
        source: "recheck",
        assisted,
      });
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학", problem: "V5-2", topicMain: "", topicSub: "",
            question: "", mySol: "", optSol: "", cause: "", tags: [],
            derived: null, memo: "", correctAnswer: "", myAnswer: "",
            examTime: "", images: [], solutionImages: [],
            attempts: [
              mkAttempt("a-true", true),
              mkAttempt("a-string", "yes"),
              mkAttempt("a-one", 1),
              mkAttempt("a-missing", undefined),
            ],
            ts: 1700000000000, id: "v5n2", date: "2026-06-01",
            rechecked: false, recheckResult: null, recheckCount: 0,
            nextRecheckTs: null,
          },
        ])
      );
      localStorage.setItem("wr_cards", JSON.stringify([]));
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);

    const flags = (await readNotes(page))[0].attempts.map((a) => a.assisted);
    // truthy 쓰레기를 살려두면 도움 안 받은 pass가 도움받은 걸로 굳는다
    expect(flags).toEqual([true, false, false, false]);
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
    ).toBe("6");
  });
});
