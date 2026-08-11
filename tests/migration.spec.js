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
      JSON.parse(localStorage.getItem("wr_backup_v1_to_v6"))
    );
    expect(backup.notes.map((n) => n.problem)).toContain("LEGACY-1");
    expect(backup.cards.map((c) => c.front)).toContain("레거시 카드");

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
  /**
   * 완전한 v5 노트 하나를 심는다 — attempt는 이미 superset 형태다.
   * 백업이 **원본 그대로**인지 바이트로 비교하려면 심은 문자열을 돌려받아야 한다.
   * @returns {Promise<{rawNotes: string, rawCards: string}>}
   */
  async function seedV5Store(page) {
    await page.goto("/");
    const raw = await page.evaluate(() => {
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
      return {
        rawNotes: localStorage.getItem("wr_notes"),
        rawCards: localStorage.getItem("wr_cards"),
      };
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);
    return raw;
  }

  test("모든 과거 시도는 assisted:false, 그 밖의 필드는 무손상", async ({
    page,
  }) => {
    const raw = await seedV5Store(page);

    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("6");

    /* v5 직전 원본이 새 키로 **글자 그대로** 보존된다. 부분 문자열만 보면
       잘리거나 정규화된 스냅샷도 통과해 버려서, 백업을 믿을 근거가 못 된다. */
    const backup = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v5_to_v6"))
    );
    // 마이그레이션 이전 배열 그대로 — 파싱만 하고 정규화는 하지 않은 상태
    expect(backup.notes).toEqual(JSON.parse(raw.rawNotes));
    expect(backup.cards).toEqual(JSON.parse(raw.rawCards));
    expect(backup.version).toBe(5);
    expect(typeof backup.savedAt).toBe("number");

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
      JSON.parse(localStorage.getItem("wr_backup_v3_to_v6"))
    );
    expect(snap.notes.map((n) => n.problem)).toContain("PRE-V4");
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

/* A1 — 전이 스냅샷과 다운그레이드 잠금.
   백업 키가 출발 버전만 담으면, 구버전 코드가 마커를 되돌린 뒤 다시 올라올 때
   옛 키가 이미 있다는 이유로 정작 필요한 스냅샷이 생략된다 (6→5→7 오염). */
test.describe("전이 스냅샷 · 다운그레이드 잠금 (A1)", () => {
  const V6_NOTE = {
    subject: "수학", problem: "A1-N", topicMain: "", topicSub: "",
    question: "", mySol: "", optSol: "", cause: "", tags: [],
    derived: null, memo: "", correctAnswer: "③", myAnswer: "",
    examTime: "", images: [], solutionImages: [],
    attempts: [{
      id: "a1a", ts: 1700000100000, answer: "③", correct: true,
      result: "pass", seconds: 30, cause: "", tags: [], memo: "",
      source: "scheduled", assisted: true, // v6에만 있는 정보
    }],
    ts: 1700000000000, id: "a1n1", date: "2026-06-01",
    rechecked: true, recheckResult: "pass", recheckCount: 1,
    nextRecheckTs: null,
  };

  test("같은 버전 로드: 정규화는 하되 스냅샷은 없다", async ({ page }) => {
    await page.goto("/");
    await page.evaluate((note) => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "6");
      // 정규화 필드 일부가 빠진 노트 — 같은 버전이라도 채워져야 한다
      const bare = { ...note };
      delete bare.images;
      delete bare.solutionImages;
      localStorage.setItem("wr_notes", JSON.stringify([bare]));
      localStorage.setItem("wr_cards", JSON.stringify([]));
    }, V6_NOTE);
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    const note = (await readNotes(page))[0];
    expect(note.images).toEqual([]);
    expect(note.solutionImages).toEqual([]);
    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("6");
    // 같은 버전 사이에는 전이가 없다 — 스냅샷 키도 없어야 한다
    expect(
      await page.evaluate(() =>
        Object.keys(localStorage).filter((k) => k.startsWith("wr_backup_v6"))
      )
    ).toEqual([]);
  });

  test("미래 버전 로드(다운그레이드): 아무것도 쓰지 않고 잠근다", async ({
    page,
  }) => {
    await page.goto("/");
    const raw = await page.evaluate((note) => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "7");
      localStorage.setItem("wr_notes", JSON.stringify([note]));
      localStorage.setItem("wr_cards", JSON.stringify([]));
      return {
        notes: localStorage.getItem("wr_notes"),
        cards: localStorage.getItem("wr_cards"),
      };
    }, V6_NOTE);
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    // 원본과 마커가 바이트 단위로 그대로 — 구버전 코드처럼 되돌려 쓰지 않는다
    const after = await page.evaluate(() => ({
      notes: localStorage.getItem("wr_notes"),
      cards: localStorage.getItem("wr_cards"),
      version: localStorage.getItem("wr_schema_version"),
    }));
    expect(after.notes).toBe(raw.notes);
    expect(after.cards).toBe(raw.cards);
    expect(after.version).toBe("7");

    // 데이터는 보인다 + 경고 배너
    await expect(page.locator(".audit-warn").first()).toBeVisible();

    // 내보내기는 열려 있고 가져오기는 잠긴다
    await page.click(".settings-open");
    await expect(
      page.locator('.btn:has-text("내보내기 (JSON)")')
    ).toBeEnabled();
    await expect(
      page.locator('.btn:has-text("가져오기 (전체 교체)")')
    ).toBeDisabled();
  });

  test("6→5→6 오염 시뮬레이션: 낡은 키가 새 스냅샷을 가리지 못한다", async ({
    page,
  }) => {
    await page.goto("/");
    const raw = await page.evaluate((note) => {
      localStorage.clear();
      // 구버전 코드가 마커를 5로 되돌려 놓은 상태. 데이터에는 v6 정보(assisted)가 남아 있다.
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem("wr_notes", JSON.stringify([note]));
      localStorage.setItem("wr_cards", JSON.stringify([]));
      // 옛 시절 출발버전 키 — 이게 새 전이 스냅샷을 가리면 안 된다
      localStorage.setItem(
        "wr_backup_v5",
        JSON.stringify({ savedAt: 1, notes: "ancient", cards: "ancient" })
      );
      return localStorage.getItem("wr_notes");
    }, V6_NOTE);
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    // 옛 wr_backup_v5가 있어도 전이 스냅샷은 제대로 찍힌다
    const transition = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v5_to_v6"))
    );
    expect(transition.notes).toEqual(JSON.parse(raw));
    // 레거시 키는 손대지 않는다
    const legacy = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v5"))
    );
    expect(legacy.notes).toBe("ancient");
    // v6에만 있던 정보가 마이그레이션에서 살아남았다
    expect((await readNotes(page))[0].attempts[0].assisted).toBe(true);
    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("6");
  });
});

/* A2 — 마커가 쓰레기면 1로 후퇴한다. Number("banana")는 NaN이고
   NaN < SCHEMA_VERSION 은 false — 즉 검증 없이는 손상된 마커 하나가
   업그레이드 스냅샷을 조용히 없앤다. */
test.describe("스키마 마커 검증 (A2)", () => {
  for (const bad of ["banana", "6.5", "0", "-3", " 5", "1e3", ""]) {
    test(`마커 ${JSON.stringify(bad)} → 버전 1로 취급, 스냅샷 강제`, async ({
      page,
    }) => {
      await page.goto("/");
      const raw = await page.evaluate((v) => {
        localStorage.clear();
        localStorage.setItem("wr_schema_version", v);
        localStorage.setItem(
          "wr_notes",
          JSON.stringify([
            {
              subject: "수학", problem: `BAD-${v}`, topicMain: "",
              topicSub: "", question: "", mySol: "", optSol: "", tags: [],
              derived: null, memo: "", ts: 1700000000000, id: "badv1",
              date: "2026-06-01",
            },
          ])
        );
        localStorage.setItem("wr_cards", JSON.stringify([]));
        return localStorage.getItem("wr_notes");
      }, bad);
      await page.reload();
      await page.locator(".tab.on").first().waitFor();
      await page.waitForTimeout(300);

      // 판별 불가 → 1로 후퇴 → v1→현재 전이 스냅샷이 반드시 찍힌다
      const backup = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("wr_backup_v1_to_v6"))
      );
      expect(backup.notes).toEqual(JSON.parse(raw));
      // 데이터는 보존되고 마커는 현재 버전으로 승격된다
      expect((await readNotes(page))[0].problem).toBe(`BAD-${bad}`);
      expect(
        await page.evaluate(() => localStorage.getItem("wr_schema_version"))
      ).toBe("6");
    });
  }
});

/* A4a — 카드도 note·attempt와 같은 보존 계약을 따라야 한다. 예전 migrateCard는
   필드를 하나씩 다시 세워서, 모르는 필드가 로드마다 조용히 증발했다. */
test.describe("카드 미지 필드 보존 (A4a)", () => {
  test("모르는 필드는 살아남고, 망가진 아는 필드는 정규화된다", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem("wr_notes", JSON.stringify([]));
      localStorage.setItem(
        "wr_cards",
        JSON.stringify([
          {
            front: "카드 앞", back: "카드 뒤", id: "kc1", noteId: null,
            subject: "수학",
            interval: 3, ease: 2.3, due: 1700400000000, reps: 2, lapses: 1,
            state: "review", lastReviewed: 1700300000000,
            // 미래 버전이 붙였을 법한 필드 (중첩 포함)
            futureTag: "keep-me",
            futureMeta: { nested: [1, 2, 3], deep: { ok: true } },
          },
        ])
      );
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    const card = (await readCards(page))[0];
    // 모르는 필드는 중첩까지 그대로
    expect(card.futureTag).toBe("keep-me");
    expect(card.futureMeta).toEqual({ nested: [1, 2, 3], deep: { ok: true } });
    // 아는 필드의 정규화 규칙은 그대로 유지된다
    expect(card.ease).toBe(2.3);
    expect(card.state).toBe("review");
  });

  test("spread가 아는 필드의 기본값을 덮어쓰지 않는다", async ({ page }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem("wr_notes", JSON.stringify([]));
      localStorage.setItem(
        "wr_cards",
        JSON.stringify([
          // 아는 필드가 비었거나 없는 카드 — 기본값이 채워져야 한다
          { id: "kc2", noteId: null, futureTag: "still-here" },
        ])
      );
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    const card = (await readCards(page))[0];
    expect(card.front).toBe("");
    expect(card.back).toBe("");
    expect(card.subject).toBe("수학");
    expect(card.ease).toBe(2.5);
    expect(card.interval).toBe(0);
    expect(card.state).toBe("new");
    expect(typeof card.due).toBe("number");
    expect(card.futureTag).toBe("still-here");
  });
});

/* H1 — 같은 전이의 첫 스냅샷이 가장 원본에 가깝다. 부분 쓰기 뒤 같은 전이를
   다시 밟을 때 덮어쓰면, 반쯤 마이그레이션된 상태가 유일한 백업이 된다. */
test.describe("전이 스냅샷은 처음 것을 지킨다 (H1)", () => {
  test("같은 전이를 다시 밟아도 먼저 찍힌 스냅샷을 덮지 않는다", async ({
    page,
  }) => {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학", problem: "PRISTINE", topicMain: "", topicSub: "",
            question: "", mySol: "", optSol: "", tags: [], derived: null,
            memo: "", ts: 1700000000000, id: "p1", date: "2026-06-01",
          },
        ])
      );
      localStorage.setItem("wr_cards", JSON.stringify([]));
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    const first = await page.evaluate(() =>
      localStorage.getItem("wr_backup_v5_to_v6")
    );
    expect(JSON.parse(first).notes[0].problem).toBe("PRISTINE");

    /* 부분 쓰기 재현: 데이터는 이미 바뀌었는데 마커만 5로 되돌아간 상태.
       다음 부팅은 같은 5→6 전이를 다시 밟는다. */
    await page.evaluate(() => {
      const ns = JSON.parse(localStorage.getItem("wr_notes"));
      ns[0].problem = "DAMAGED";
      localStorage.setItem("wr_notes", JSON.stringify(ns));
      localStorage.setItem("wr_schema_version", "5");
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(300);

    // 먼저 찍힌 원본이 그대로여야 한다 — 손상된 상태로 덮이면 복구 불가
    const after = await page.evaluate(() =>
      localStorage.getItem("wr_backup_v5_to_v6")
    );
    expect(JSON.parse(after).notes[0].problem).toBe("PRISTINE");
    expect(after).toBe(first);
  });
});

/* H2 — 스냅샷을 못 남겼으면 마이그레이션 결과도 쓰지 않는다. 백업 없이
   덮어쓰면 되돌릴 방법이 사라진다. "로드는 계속한다"는 "저장해도 된다"가
   아니다. */
test.describe("스냅샷 실패 시 저장 보류 (H2)", () => {
  test("백업 키만 쓰기 실패 → 원본·마커 유지, 데이터는 보이고 내보내기는 열림", async ({
    page,
  }) => {
    // 전이 백업 키에만 QuotaExceededError를 던진다
    await page.addInitScript(() => {
      const original = Storage.prototype.setItem;
      Storage.prototype.setItem = function (key, value) {
        if (this === localStorage && key.startsWith("wr_backup_v")) {
          const err = new Error("quota");
          err.name = "QuotaExceededError";
          throw err;
        }
        return original.call(this, key, value);
      };
    });

    await page.goto("/");
    const raw = await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem("wr_schema_version", "5");
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학", problem: "NOSNAP", topicMain: "", topicSub: "",
            question: "", mySol: "", optSol: "", tags: [], derived: null,
            memo: "", ts: 1700000000000, id: "ns1", date: "2026-06-01",
          },
        ])
      );
      localStorage.setItem("wr_cards", JSON.stringify([]));
      return localStorage.getItem("wr_notes");
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();
    await page.waitForTimeout(400);

    // 디스크는 옛 스키마 그대로 — 되돌릴 수 없는 덮어쓰기를 하지 않았다
    expect(await page.evaluate(() => localStorage.getItem("wr_notes"))).toBe(raw);
    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("5");

    // 화면에는 정상으로 보이고 경고가 뜬다
    await expect(page.locator(".audit-warn").first()).toBeVisible();
    expect((await readNotes(page))[0].problem).toBe("NOSNAP");

    // 내보내기는 유일한 구조 수단이라 열려 있어야 한다
    await page.click(".settings-open");
    await expect(page.locator('.btn:has-text("내보내기 (JSON)")')).toBeEnabled();
  });
});
