import { test, expect } from "@playwright/test";
import { readNotes } from "./helpers.js";

/** v4 형태(주원인 있음, attempt는 4필드) 스토어를 심는다 */
async function seedV4Store(page, attempts) {
  await page.goto("/");
  await page.evaluate((atts) => {
    localStorage.clear();
    localStorage.setItem("wr_schema_version", "4");
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([
        {
          subject: "수학",
          problem: "V4-1",
          topicMain: "수II·미분",
          topicSub: "접선",
          question: "",
          mySol: "",
          optSol: "",
          cause: "실행 실수",
          tags: ["부호 실수"],
          derived: null,
          memo: "",
          correctAnswer: "③",
          myAnswer: "②",
          examTime: "",
          images: [],
          solutionImages: [],
          attempts: atts,
          ts: 1700000000000,
          id: "v4n1",
          date: "2026-06-01",
          rechecked: false,
          recheckResult: null,
          recheckCount: 0,
          nextRecheckTs: null,
        },
      ])
    );
    localStorage.setItem("wr_cards", JSON.stringify([]));
  }, attempts);
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300);
}

test.describe("v4 → v5 attempt 마이그레이션", () => {
  test("레거시 attempt 정규화: 핵심 필드 보존 + superset 필드 추가", async ({
    page,
  }) => {
    await seedV4Store(page, [
      { ts: 1700000100000, answer: "②", correct: false, seconds: 390 },
      { ts: 1700000200000, answer: "③", correct: true, seconds: 120, extra: "keep" },
    ]);

    const note = (await readNotes(page))[0];
    const [a0, a1] = note.attempts;

    // 기존 필드 무손상
    expect(a0.ts).toBe(1700000100000);
    expect(a0.answer).toBe("②");
    expect(a0.correct).toBe(false);
    expect(a0.seconds).toBe(390);
    // superset — 과거 fail 원인은 추측하지 않는다
    expect(a0.result).toBe("fail");
    expect(a0.cause).toBe("");
    expect(a0.tags).toEqual([]);
    expect(a0.memo).toBe("");
    expect(a0.source).toBe("legacy");
    // v6: 과거 시도의 도움 여부는 알 수 없다 — 추측하지 않고 false
    expect(a0.assisted).toBe(false);
    // 결정적 id
    expect(a0.id).toBe("legacy:v4n1:0:1700000100000");

    expect(a1.result).toBe("pass");
    expect(a1.assisted).toBe(false);
    expect(a1.id).toBe("legacy:v4n1:1:1700000200000");
    // 모르는 필드도 spread로 보존
    expect(a1.extra).toBe("keep");

    // 버전 승격 + v4 원본 스냅샷
    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("6");
    const backup = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("wr_backup_v4"))
    );
    expect(backup.notes).toContain("V4-1");
  });

  test("seconds가 숫자가 아니면 null, 마이그레이션은 멱등", async ({ page }) => {
    await seedV4Store(page, [
      { ts: 1700000100000, answer: "", correct: false, seconds: undefined },
    ]);

    let note = (await readNotes(page))[0];
    expect(note.attempts[0].seconds).toBe(null);

    const snap1 = JSON.stringify(await readNotes(page));
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);
    const snap2 = JSON.stringify(await readNotes(page));
    expect(snap2).toBe(snap1);
  });
});

/** 순수 셀렉터를 dev 서버 모듈로 직접 검증 */
async function evalReview(page, fn) {
  await page.goto("/");
  return page.evaluate(async (fnSrc) => {
    const review = await import("/src/review.js");
    // eslint-disable-next-line no-new-func
    return new Function("review", `return (${fnSrc})(review);`)(review);
  }, fn.toString());
}

const att = (correct, ts = 1) => ({ correct, ts });

test.describe("review 셀렉터", () => {
  test("안정성 그룹 분류 — 명세 예시 전부", async ({ page }) => {
    const results = await evalReview(page, (r) => {
      const mk = (pattern) => ({
        id: "x",
        ts: 0,
        attempts: pattern.map((p, i) => ({ correct: p === "p", ts: i + 1 })),
      });
      return {
        empty: r.classifyReviewState(mk([])),
        f: r.classifyReviewState(mk(["f"])),
        p: r.classifyReviewState(mk(["p"])),
        fp: r.classifyReviewState(mk(["f", "p"])),
        pp: r.classifyReviewState(mk(["p", "p"])),
        fpp: r.classifyReviewState(mk(["f", "p", "p"])),
        ppf: r.classifyReviewState(mk(["p", "p", "f"])),
        pfp: r.classifyReviewState(mk(["p", "f", "p"])),
        emptyUnattempted: r.isUnattempted(mk([])),
        fUnattempted: r.isUnattempted(mk(["f"])),
      };
    });

    expect(results.empty).toBe("unstable");
    expect(results.f).toBe("unstable");
    expect(results.p).toBe("progress");
    expect(results.fp).toBe("progress");
    expect(results.pp).toBe("graduated");
    expect(results.fpp).toBe("graduated");
    expect(results.ppf).toBe("unstable");
    expect(results.pfp).toBe("progress");
    expect(results.emptyUnattempted).toBe(true);
    expect(results.fUnattempted).toBe(false);
  });

  test("도움받은 pass는 연속 기록을 끊는다 (졸업 게이트)", async ({ page }) => {
    const results = await evalReview(page, (r) => {
      // "p" 독립 pass · "a" 도움받은 pass · "f" 실패
      const mk = (pattern) => ({
        id: "x",
        ts: 0,
        attempts: pattern.map((p, i) => ({
          correct: p !== "f",
          assisted: p === "a",
          ts: i + 1,
        })),
      });
      const probe = (pattern) => ({
        streak: r.getConsecutivePasses(mk(pattern)),
        state: r.classifyReviewState(mk(pattern)),
      });
      return {
        pp: probe(["p", "p"]),
        pap: probe(["p", "a", "p"]),
        papp: probe(["p", "a", "p", "p"]),
        pa: probe(["p", "a"]),
        fa: probe(["f", "a"]),
        aa: probe(["a", "a"]),
      };
    });

    // 기준선: 도움 없는 연속 2회는 졸업이다
    expect(results.pp).toEqual({ streak: 2, state: "graduated" });
    // 도움받은 pass가 끼면 그 이전 pass는 이어지지 않는다
    expect(results.pap).toEqual({ streak: 1, state: "progress" });
    // 리셋 후 다시 2회 독립 pass하면 졸업한다
    expect(results.papp).toEqual({ streak: 2, state: "graduated" });
    // 마지막이 도움받은 pass면 streak 0 — 그래도 correct라 unstable은 아니다
    expect(results.pa).toEqual({ streak: 0, state: "progress" });
    expect(results.fa).toEqual({ streak: 0, state: "progress" });
    // 도움받은 pass만 쌓아서는 절대 졸업할 수 없다
    expect(results.aa).toEqual({ streak: 0, state: "progress" });
  });

  test("assisted 필드가 없는 레거시 시도는 독립 pass로 센다", async ({
    page,
  }) => {
    const results = await evalReview(page, (r) => {
      const legacy = {
        id: "L",
        ts: 0,
        attempts: [
          { correct: false, ts: 1 },
          { correct: true, ts: 2 },
          { correct: true, ts: 3 },
        ],
      };
      return {
        streak: r.getConsecutivePasses(legacy),
        state: r.classifyReviewState(legacy),
      };
    });
    // 필드 없음 = falsy — v5에서 졸업했던 노트가 조용히 강등되면 안 된다
    expect(results).toEqual({ streak: 2, state: "graduated" });
  });

  test("궤적은 최근 N개, 그룹 정렬은 결정적", async ({ page }) => {
    const results = await evalReview(page, (r) => {
      const many = {
        id: "m",
        ts: 0,
        attempts: [1, 2, 3, 4, 5, 6, 7].map((i) => ({
          correct: i % 2 === 0,
          ts: i,
        })),
      };
      // 활동이 오래된 것 우선, ts·id 타이브레이크
      const a = { id: "a", ts: 100, attempts: [{ correct: false, ts: 500 }] };
      const b = { id: "b", ts: 100, attempts: [{ correct: false, ts: 200 }] };
      const c = { id: "c", ts: 50, attempts: [] }; // activity = note.ts
      const groups = r.buildReviewGroups([a, b, c]);
      return {
        trajLen: r.getTrajectory(many).length,
        trajFirstTs: r.getTrajectory(many)[0].ts,
        unstableOrder: groups.unstable.map((n) => n.id),
        daysToday: r.formatDaysAgo(Date.now()),
        daysFuture: r.formatDaysAgo(Date.now() + 86400000 * 3),
        daysPast: r.formatDaysAgo(Date.now() - 86400000 * 2),
      };
    });

    expect(results.trajLen).toBe(5); // TRAJECTORY_LIMIT
    expect(results.trajFirstTs).toBe(3); // 오래된 것부터, 최근 5개만
    expect(results.unstableOrder).toEqual(["c", "b", "a"]);
    expect(results.daysToday).toBe("오늘");
    expect(results.daysFuture).toBe("오늘"); // 미래는 clamp
    expect(results.daysPast).toBe("2일 전");
  });

  test("개선율: fail 경험 노트만 분모, pass-only 제외", async ({ page }) => {
    const results = await evalReview(page, (r) => {
      const mk = (id, pattern) => ({
        id,
        ts: 0,
        attempts: pattern.map((p, i) => ({ correct: p === "p", ts: i })),
      });
      return r.calculateImprovement([
        mk("improved", ["f", "p"]), // eligible + improved
        // 도움받은 pass도 개선으로 센다 — 졸업 게이트와 달리 의도적 비변경.
        // 개선율은 "틀리던 걸 이제 맞힌다"이지 "혼자 맞힌다"가 아니다.
        {
          id: "assisted",
          ts: 0,
          attempts: [
            { correct: false, ts: 0 },
            { correct: true, assisted: true, ts: 1 },
          ],
        },
        mk("still", ["f", "f"]), // eligible
        mk("passonly", ["p", "p"]), // 제외
        mk("never", []), // 제외
      ]);
    });

    expect(results.eligible).toBe(3);
    expect(results.improved).toBe(2); // improved + assisted
    expect(results.rate).toBeCloseTo(2 / 3);
  });
});

/** 안정성 그룹 UI용 시드: 불안정 2(미재풀이 1) / 진행 중 1 / 졸업 1 */
async function seedGroups(page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    const base = (id, problem, attempts, extra = {}) => ({
      subject: "수학",
      problem,
      topicMain: "수II·미분",
      topicSub: "",
      question: `${problem} 원문`,
      mySol: "",
      optSol: "최적 풀이",
      cause: "개념 부족",
      tags: [],
      derived: null,
      memo: "",
      correctAnswer: "③",
      myAnswer: "②",
      attempts,
      ts: 1700000000000,
      id,
      date: "2026-06-01",
      ...extra,
    });
    const att = (correct, ts) => ({ ts, answer: "②", correct, seconds: 60 });
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([
        base("g_unatt", "G-UNATTEMPTED", []),
        base("g_fail", "G-FAILED", [att(false, 1700000100000)]),
        base("g_prog", "G-PROGRESS", [att(true, 1700000200000)]),
        base("g_grad", "G-GRAD", [
          att(true, 1700000300000),
          att(true, 1700000400000),
        ]),
      ])
    );
    localStorage.setItem("wr_cards", JSON.stringify([]));
  });
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300);
}

test.describe("안정성 그룹 UI", () => {
  test("그룹 헤더 건수, 졸업 기본 접힘 → 펼치기", async ({ page }) => {
    await seedGroups(page);

    await expect(page.locator(".review-group.unstable .group-label")).toContainText(
      "불안정 2"
    );
    await expect(page.locator(".review-group.progress .group-label")).toContainText(
      "진행 중 1"
    );
    await expect(page.locator(".group-toggle")).toContainText("졸업 1");

    // 불안정 그룹에 미재풀이·실패 노트가 함께 있다
    await expect(
      page.locator('.review-group.unstable .prob-card:has-text("G-UNATTEMPTED")')
    ).toBeVisible();
    await expect(
      page.locator('.review-group.unstable .prob-card:has-text("G-FAILED")')
    ).toBeVisible();

    // 졸업은 기본 접힘
    await expect(
      page.locator('.prob-card:has-text("G-GRAD")')
    ).toHaveCount(0);
    await page.click(".group-toggle");
    await expect(page.locator('.prob-card:has-text("G-GRAD")')).toBeVisible();
  });

  test("카드에 궤적 도트·미재풀이·마지막 시도 상대일 표시", async ({ page }) => {
    await seedGroups(page);

    const unatt = page.locator('.prob-card:has-text("G-UNATTEMPTED")');
    await expect(unatt.locator(".traj-none")).toHaveText("미재풀이");

    const failed = page.locator('.prob-card:has-text("G-FAILED")');
    await expect(failed.locator(".traj-dot.fail")).toHaveCount(1);
    await expect(failed.locator(".prob-last")).toContainText("일 전");
  });

  test("카드 본문 탭 → 단일 풀기 시작, 연필 → 수정 오버레이", async ({
    page,
  }) => {
    await seedGroups(page);

    await page.click('.prob-card:has-text("G-FAILED") .prob-card-main');
    await expect(page.locator(".solve-head")).toBeVisible();
    await expect(page.locator(".solve-kind")).toHaveText("G-FAILED");

    await page.click('.tab:has-text("문제")');
    await page.click('.prob-card:has-text("G-FAILED") .prob-card-edit');
    await expect(
      page.locator('.sheet-title:has-text("오답 수정")')
    ).toBeVisible();
    // 수정 오버레이 하단에 재풀이 이력 (읽기 전용)
    await page.click('.btn--primary:has-text("다음 — 왜 틀렸나")');
    await expect(page.locator(".attempt-history")).toBeVisible();
    await expect(page.locator(".attempt-line")).toContainText("원인 미기록");
  });

  test("manual 풀기 완료 → 다음 불안정 문제로 이어진다 (졸업 제외)", async ({
    page,
  }) => {
    await seedGroups(page);

    // 불안정 첫 카드(G-UNATTEMPTED, 활동 오래된 순) 본문 탭
    await page.click('.prob-card:has-text("G-UNATTEMPTED") .prob-card-main');
    await expect(page.locator(".solve-prog")).toContainText("1 / 1");

    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    // 다음 불안정(G-FAILED)이 남아 있으므로 '다음 문제'
    await page.click('.end-btn:has-text("다음 문제")');
    await expect(page.locator(".solve-prog")).toContainText("2 / 2");

    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    // 더 이상 불안정이 없다 — 졸업을 끌어오지 않는다
    await expect(page.locator('.end-btn:has-text("결과 보기")')).toBeVisible();
  });
});

test.describe("도움받은 통과 표시 (v6)", () => {
  /** 실패 2(원인 다름) · 도움받은 통과 · 독립 통과 순서로 심는다 */
  async function seedMarks(page) {
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.clear();
      localStorage.setItem(
        "wr_notes",
        JSON.stringify([
          {
            subject: "수학",
            problem: "MARK-1",
            topicMain: "수II·미분",
            topicSub: "",
            question: "MARK-1 원문",
            mySol: "",
            optSol: "최적 풀이",
            cause: "개념 부족",
            tags: [],
            derived: null,
            memo: "",
            correctAnswer: "③",
            myAnswer: "②",
            attempts: [
              {
                id: "m1", ts: 1700000100000, answer: "②", correct: false,
                result: "fail", seconds: 60, cause: "개념 부족", tags: [],
                memo: "", source: "scheduled", assisted: false,
              },
              {
                id: "m2", ts: 1700000200000, answer: "①", correct: false,
                result: "fail", seconds: 70, cause: "읽기 실패", tags: [],
                memo: "", source: "scheduled", assisted: false,
              },
              {
                id: "m3", ts: 1700000300000, answer: "③", correct: true,
                result: "pass", seconds: 50, cause: "", tags: [],
                memo: "", source: "scheduled", assisted: true,
              },
              {
                id: "m4", ts: 1700000400000, answer: "③", correct: true,
                result: "pass", seconds: 40, cause: "", tags: [],
                memo: "", source: "scheduled", assisted: false,
              },
            ],
            ts: 1700000000000,
            id: "mark1",
            date: "2026-06-01",
            rechecked: true,
            recheckResult: "pass",
            recheckCount: 4,
            nextRecheckTs: null,
          },
        ])
      );
      localStorage.setItem("wr_cards", JSON.stringify([]));
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);
  }

  test("궤적: ✕ ✕ ✓* ✓ — 도움받은 통과가 따로 보인다", async ({ page }) => {
    await seedMarks(page);

    const card = page.locator('.prob-card:has-text("MARK-1")');
    await expect(card.locator(".traj-dot")).toHaveCount(4);
    await expect(card.locator(".traj-dot.fail")).toHaveCount(2);
    await expect(card.locator(".traj-dot.assisted")).toHaveCount(1);
    await expect(card.locator(".traj-dot.pass")).toHaveCount(1);
    // 순서 보존 — 오래된 것 → 최신
    await expect(card.locator(".traj")).toHaveText("✕✕✓*✓");

    /* 색이 아니라 라벨이 구분을 짊어진다.
       도트마다 붙은 aria-label을 세는 건 의미가 없다 — role="img"가 하위를
       평탄화하므로 보조기기는 그걸 절대 못 듣는다. 실제로 전달되는
       **접근성 이름**을 본다. */
    await expect(card.locator(".traj")).toHaveAttribute(
      "aria-label",
      "재풀이 궤적: 개념 부족, 읽기 실패, 도움받음, 통과"
    );
    // 도트 자체는 장식이어야 한다 (이름이 두 번 읽히면 안 된다)
    const hidden = await card
      .locator(".traj-dot")
      .evaluateAll((els) => els.map((e) => e.getAttribute("aria-hidden")));
    expect(hidden).toEqual(["true", "true", "true", "true"]);
  });

  test("이력 로그: 같은 네 시도가 같은 표기로 나온다", async ({ page }) => {
    await seedMarks(page);

    await page.click('.prob-card:has-text("MARK-1") .prob-card-edit');
    await page.click('.btn--primary:has-text("다음 — 왜 틀렸나")');
    await expect(page.locator(".attempt-history")).toBeVisible();

    const lines = page.locator(".attempt-line");
    await expect(lines).toHaveCount(4);
    await expect(lines.locator(".grade-mark.fail")).toHaveCount(2);
    await expect(lines.locator(".grade-mark.assisted")).toHaveCount(1);
    await expect(lines.locator(".grade-mark.pass")).toHaveCount(1);

    // 이력은 본문이 글로 말하므로 마크는 장식이다
    await expect(lines.nth(0)).toContainText("개념 부족");
    await expect(lines.nth(1)).toContainText("읽기 실패");
    await expect(lines.nth(2)).toContainText("도움받음");
    await expect(lines.nth(3)).toContainText("통과");
    await expect(lines.nth(2).locator(".grade-mark")).toHaveAttribute(
      "aria-hidden",
      "true"
    );
  });
});
