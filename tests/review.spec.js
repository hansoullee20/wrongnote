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
    // 결정적 id
    expect(a0.id).toBe("legacy:v4n1:0:1700000100000");

    expect(a1.result).toBe("pass");
    expect(a1.id).toBe("legacy:v4n1:1:1700000200000");
    // 모르는 필드도 spread로 보존
    expect(a1.extra).toBe("keep");

    // 버전 승격 + v4 원본 스냅샷
    expect(
      await page.evaluate(() => localStorage.getItem("wr_schema_version"))
    ).toBe("5");
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
        mk("still", ["f", "f"]), // eligible
        mk("passonly", ["p", "p"]), // 제외
        mk("never", []), // 제외
      ]);
    });

    expect(results.eligible).toBe(2);
    expect(results.improved).toBe(1);
    expect(results.rate).toBe(0.5);
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
