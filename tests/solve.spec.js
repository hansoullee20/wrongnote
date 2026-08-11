import { test, expect } from "@playwright/test";
import { freshApp, readNotes } from "./helpers.js";

/** v5: fail은 이번 시도의 원인을 골라야 저장된다 */
async function classifyFail(page, cause = "개념 부족") {
  await expect(page.locator(".fail-classifier")).toBeVisible();
  await page.click(`.fail-classifier .chip-row .chip:has-text("${cause}")`);
  await page.click('.fail-save:has-text("실패 기록")');
}

/** 정답이 있는 노트 하나만 남기고 나머지를 치운다 — 큐를 예측 가능하게 */
async function seedOneSolvable(
  page,
  { correctAnswer = "③", optSol = "이렇게 푸는 게 빠르다" } = {}
) {
  await page.goto("/");
  await page.evaluate(({ ans, opt }) => {
    localStorage.clear();
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([
        {
          subject: "수학",
          problem: "SOLVE-1",
          topicMain: "수II·미분",
          topicSub: "접선",
          question: "다시 풀 문제 원문",
          mySol: "처음에 이렇게 틀렸다",
          optSol: opt,
          cause: "실행 실수",
          correctAnswer: ans,
          myAnswer: "②",
          attempts: [],
          tags: ["부호 실수"],
          derived: null,
          memo: "",
          ts: Date.now() - 30 * 86400000, // 재검증 주기(14일) 지난 상태
          id: "solve_n1",
          date: "2026-06-19",
        },
      ])
    );
    localStorage.setItem("wr_cards", JSON.stringify([]));
  }, { ans: correctAnswer, opt: optSol });
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300);
}

/** 재검증 주기가 지난 노트 2개 — seedOneSolvable은 매번 clear라 큐가 1개다 */
async function seedTwoSolvable(page) {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    const mk = (id, problem) => ({
      subject: "수학",
      problem,
      topicMain: "수II·미분",
      topicSub: "접선",
      question: "다시 풀 문제 원문",
      mySol: "처음에 이렇게 틀렸다",
      optSol: "이렇게 푸는 게 빠르다",
      cause: "실행 실수",
      correctAnswer: "③",
      myAnswer: "②",
      attempts: [],
      tags: [],
      derived: null,
      memo: "",
      ts: Date.now() - 30 * 86400000, // 재검증 주기(14일) 지난 상태
      id,
      date: "2026-06-19",
    });
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([mk("two_a", "TWO-A"), mk("two_b", "TWO-B")])
    );
    localStorage.setItem("wr_cards", JSON.stringify([]));
  });
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300);
}

test.describe("다시 풀기 세션", () => {
  test("오답 → 자동 채점, 시도 기록, 다음 복습 당겨짐", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');

    // 풀기 전에는 최적 풀이가 가려져 있어야 한다
    await expect(page.locator(".veil")).toBeVisible();
    await expect(page.locator(".reveal")).toHaveCount(0);
    await expect(page.locator(".timer")).toBeVisible();

    // 정답 ③ 인데 ② 를 고른다
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');

    // v5: fail은 원인 분류를 마쳐야 기록된다
    await classifyFail(page, "개념 부족");

    await expect(page.locator(".verdict-stamp")).toHaveText("또 틀림");
    await expect(page.locator(".reveal").first()).toBeVisible();

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(1);
    expect(note.attempts[0].answer).toBe("②");
    expect(note.attempts[0].correct).toBe(false);
    expect(note.attempts[0].seconds).toBeGreaterThan(0);
    // v5: 이번 시도의 원인이 attempt에 남는다
    expect(note.attempts[0].cause).toBe("개념 부족");
    expect(note.attempts[0].result).toBe("fail");
    expect(note.attempts[0].source).toBe("scheduled");
    // v6: 아무도 도움을 주장하지 않으면 false
    expect(note.attempts[0].assisted).toBe(false);
    expect(note.recheckResult).toBe("fail");
    // 틀리면 내일로 당겨진다
    expect(note.nextRecheckTs - Date.now()).toBeLessThan(2 * 86400000);
    // 틀렸다고 주원인을 멋대로 바꾸지 않는다
    expect(note.cause).toBe("실행 실수");
  });

  test("정답 → 통과 기록, 다음 복습 뒤로 밀림", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].correct).toBe(true);
    expect(note.recheckResult).toBe("pass");
    expect(note.nextRecheckTs - Date.now()).toBeGreaterThan(10 * 86400000);
  });

  test("같은 오답 반복 → 세션 요약이 몇 번째인지 짚어준다", async ({ page }) => {
    await seedOneSolvable(page);
    // 이미 ② 로 한 번 틀린 이력을 심는다
    await page.evaluate(() => {
      const ns = JSON.parse(localStorage.getItem("wr_notes"));
      ns[0].attempts = [
        { ts: Date.now() - 86400000, answer: "②", correct: false, seconds: 390 },
      ];
      localStorage.setItem("wr_notes", JSON.stringify(ns));
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');
    await classifyFail(page);
    await page.click('.end-btn:has-text("결과 보기")');

    // "②를 2번째 골랐다" — 반복 오답 패턴이 요약에 드러나야 한다
    await expect(page.locator(".card-line.bad .cl-body b")).toContainText(
      "②를 2번째 골랐다"
    );
    // 실행 실수로 기록했는데 같은 오답 반복 → 주원인 재확인 제안
    await expect(page.locator(".callout")).toBeVisible();
  });

  test("정답 미기록 노트: 지금 입력하면 저장되어 자동 채점된다", async ({
    page,
  }) => {
    await seedOneSolvable(page, { correctAnswer: "" });

    await page.click('.tab:has-text("풀기")');
    await page.click('.mode.primary .mode-go');

    // 정답이 없으니 정답 입력줄이 뜬다
    await expect(page.locator(".ans-fix")).toBeVisible();

    await page.click('.ans-block .ans-row:not(.ans-fix) .ans-opt:has-text("③")');
    await page.click('.ans-fix .ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");
    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.correctAnswer).toBe("③");
  });

  test("문제 그리드의 '바로 시작' → 풀기 세션으로 직행", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click(".today-go");
    await expect(page.locator(".solve-head")).toBeVisible();
    await expect(page.locator(".solve-prog")).toContainText("1 / 1");
  });

  /* 채점 결과에서 '지금 추가' → 기록 시트 → 삭제로 노트를 지울 수 있다.
     예전엔 복구 이펙트가 solving 페이즈만 봐서, 버튼이 하나도 없는
     '문제 없음.' 화면에 갇혔다 (탭으로 빠져나가면 세션 결과가 날아갔다). */
  test("풀기 도중 노트가 삭제되면 요약으로 빠진다 — 막다른 화면 없음", async ({
    page,
  }) => {
    await seedOneSolvable(page, { optSol: "" }); // 비어야 '지금 추가'가 뜬다

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await expect(page.locator(".verdict-stamp.ok")).toBeVisible();

    page.on("dialog", (d) => d.accept());
    await page.click(".reveal.empty-sol .callout-act");
    await page.locator(".sheet .form").first().waitFor();
    await page.click(".sheet-delete");

    // 요약으로 넘어가고, 지우기 전까지 쌓인 결과는 살아 있어야 한다
    await expect(page.locator(".sum-head")).toBeVisible();
    await expect(page.locator(".sum-score")).toContainText("1");
    await expect(page.locator(".view .empty")).toHaveCount(0);
  });
});

/* 변경 전 현재 동작 고정 (characterization) — 풀기 흐름을 건드리기 전에
   기존 계약을 테스트로 잠근다. */
test.describe("풀기 세션 현재 동작 고정", () => {
  test("주관식 정답도 자동 채점된다", async ({ page }) => {
    await seedOneSolvable(page, { correctAnswer: "47" });

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.fill(".ans-block .ans-row:not(.ans-fix) .ans-input", "47");
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");
    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].answer).toBe("47");
    expect(note.attempts[0].correct).toBe(true);
  });

  test("정답도 현장 입력도 없으면 자기 채점으로 기록된다", async ({ page }) => {
    await seedOneSolvable(page, { correctAnswer: "" });

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");

    // 정답 미기록 → 자기 채점 버튼 두 개. fail이므로 분류를 거친다 (v5)
    await page.click('.grade-btn:has-text("또 틀렸다")');
    await classifyFail(page);

    await expect(page.locator(".verdict-stamp")).toHaveText("또 틀림");
    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(1);
    expect(note.attempts[0].correct).toBe(false);
  });

  test("채점 후 답·시간 비교가 보인다", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');
    await classifyFail(page);

    await expect(page.locator(".time-line .time-now")).toBeVisible();
    await expect(page.locator(".ans-compare")).toBeVisible();
    // 이번에 고른 답과 정답이 나란히 표시된다
    await expect(page.locator(".ans-cell-val.wrong").first()).toHaveText("②");
    await expect(page.locator(".ans-cell-val.right").first()).toHaveText("③");
  });

  test("2문제 큐: 다음 문제로 넘어가면 타이머가 리셋되고 진행이 표시된다", async ({
    page,
  }) => {
    await seedOneSolvable(page);
    await page.evaluate(() => {
      const ns = JSON.parse(localStorage.getItem("wr_notes"));
      ns.push({
        ...ns[0],
        id: "solve_n2",
        problem: "SOLVE-2",
        correctAnswer: "①",
      });
      localStorage.setItem("wr_notes", JSON.stringify(ns));
    });
    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await expect(page.locator(".solve-prog")).toContainText("1 / 2");

    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await page.click('.end-btn:has-text("다음 문제")');

    await expect(page.locator(".solve-prog")).toContainText("2 / 2");
    // 새 문제에서 다시 풀이 화면 + 타이머 재시작
    await expect(page.locator(".veil")).toBeVisible();
    await expect(page.locator(".timer")).toBeVisible();
    await expect(page.locator(".timer-num")).toHaveText(/^00:0/);
  });

  test("pass는 분류 없이 즉시 기록되고 source가 남는다", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    // 분류 화면 없이 바로 채점 결과
    await expect(page.locator(".fail-classifier")).toHaveCount(0);
    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].result).toBe("pass");
    expect(note.attempts[0].cause).toBe("");
    expect(note.attempts[0].source).toBe("scheduled");
    // pass 폐기 삼항에 휩쓸리지 않았는지 — 여기가 false가 아니라 undefined면
    // 졸업 게이트는 영영 죽은 코드다
    expect(note.attempts[0].assisted).toBe(false);
  });

  test("reload 후에도 attempt가 남는다", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');
    await classifyFail(page);

    await page.reload();
    await page.getByRole("button", { name: /^문제/ }).waitFor();
    await page.waitForTimeout(300);

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(1);
    expect(note.attempts[0].answer).toBe("②");
  });
});

test.describe("재풀이 fail 분류 (v5)", () => {
  test("원인 미선택 시 저장 잠김, 분류 완료 전엔 attempt가 없다", async ({
    page,
  }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".fail-classifier")).toBeVisible();
    // 분류 전 저장 없음
    let note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(0);
    // 원인 없이는 잠김
    await expect(page.locator(".fail-save")).toBeDisabled();

    await page.click('.fail-classifier .chip-row .chip:has-text("전략 실패")');
    await expect(page.locator(".fail-save")).toBeEnabled();
    await page.click(".fail-save");

    note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(1);
    expect(note.attempts[0].cause).toBe("전략 실패");
  });

  test("처음과 같은 원인 chip: cause만 설정, 실행 실수면 게이트 요구", async ({
    page,
  }) => {
    await seedOneSolvable(page); // note.cause = 실행 실수, tags = [부호 실수]

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');

    const quick = page.locator(".chip.quick-cause");
    await expect(quick).toHaveText("처음과 같은 원인 · 실행 실수");
    await quick.click();

    // cause만 설정 — 자동 저장 없음
    let note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(0);

    // 실행 실수 → 하드 게이트가 뜨고 전부 체크 전엔 잠김
    await expect(page.locator(".fail-classifier .gate")).toBeVisible();
    await expect(page.locator(".fail-save")).toBeDisabled();
    const boxes = page.locator('.fail-classifier .gate-item input[type="checkbox"]');
    await expect(boxes).toHaveCount(4);
    for (let i = 0; i < 4; i++) await boxes.nth(i).check();
    await expect(page.locator(".fail-save")).toBeEnabled();
    await page.click(".fail-save");

    note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].cause).toBe("실행 실수");
    // note의 세부 태그를 attempt로 복사하지 않는다
    expect(note.attempts[0].tags).toEqual([]);
  });

  test("실행 실수가 아니면 게이트 없음, 세부 태그·메모는 선택", async ({
    page,
  }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');

    await page.click('.fail-classifier .chip-row .chip:has-text("읽기 실패")');
    await expect(page.locator(".fail-classifier .gate")).toHaveCount(0);

    await page.click('.fail-classifier .chip:has-text("조건 누락")');
    await page.fill(".fail-memo", "조건 (가)를 안 읽음");
    await page.click(".fail-save");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].cause).toBe("읽기 실패");
    expect(note.attempts[0].tags).toEqual(["조건 누락"]);
    expect(note.attempts[0].memo).toBe("조건 (가)를 안 읽음");
  });

  test("풀이 보기 → 분류 전 미저장, 완료 시 fail 1건만 (중복 클릭 포함)", async ({
    page,
  }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click(".reveal-give-up");

    // 최적 풀이가 보이지만 아직 저장은 없다
    await expect(page.locator(".fail-classifier .reveal")).toBeVisible();
    let note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(0);

    await page.click('.fail-classifier .chip-row .chip:has-text("개념 부족")');
    // 빠른 더블탭에도 1건만 저장돼야 한다
    await page.locator(".fail-save").dblclick();

    await expect
      .poll(async () =>
        (await readNotes(page)).find((n) => n.id === "solve_n1").attempts.length
      )
      .toBe(1);
    note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].source).toBe("solution_reveal");
    expect(note.attempts[0].result).toBe("fail");
    // 풀이를 봤다는 사실은 source가 기록한다 — assisted를 대신 켜지 않는다
    expect(note.attempts[0].assisted).toBe(false);
  });

  test("분류를 마치지 않고 이탈하면 시도가 저장되지 않는다", async ({
    page,
  }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');
    await expect(page.locator(".fail-classifier")).toBeVisible();

    // 분류 없이 다른 탭으로 떠난다
    await page.click('.tab:has-text("문제")');
    await page.waitForTimeout(200);

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(0);
    expect(note.recheckCount).toBe(0);
  });
});

test.describe("도움 사용 여부 (v6)", () => {
  test("기본값은 아니오 — 아무것도 안 누르면 독립 pass다", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");

    await expect(page.locator("#solve-assist-no")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.locator("#solve-assist-yes")).toHaveAttribute(
      "aria-pressed",
      "false"
    );

    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].assisted).toBe(false);
  });

  test("도움받은 정답: pass로 기록되고 다음 복습은 그대로 밀린다", async ({
    page,
  }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click("#solve-assist-yes");
    await expect(page.locator("#solve-assist-yes")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].assisted).toBe(true);
    // 도움을 받았어도 맞힌 건 맞힌 거다 — fail로 강등하지 않는다
    expect(note.attempts[0].correct).toBe(true);
    expect(note.attempts[0].result).toBe("pass");
    expect(note.recheckResult).toBe("pass");
    // 일정은 도움 여부와 무관하다 (RECHECK_DAYS 그대로)
    expect(note.nextRecheckTs - Date.now()).toBeGreaterThan(10 * 86400000);
  });

  test("도움받은 pass는 연속 2회를 채워도 졸업하지 못한다", async ({ page }) => {
    await seedOneSolvable(page);

    // 1회차: 도움 없이 정답
    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    // 2회차: 도움을 받고 정답 — 여기서 연속 기록이 끊긴다
    await page.click('.tab:has-text("문제")');
    await page.click('.prob-card:has-text("SOLVE-1") .prob-card-main');
    await page.click("#solve-assist-yes");
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.map((a) => a.assisted)).toEqual([false, true]);

    // 연속 2 pass지만 졸업이 아니라 진행 중이다
    await page.click('.tab:has-text("문제")');
    await expect(
      page.locator(".review-group.progress .group-label")
    ).toContainText("진행 중 1");
    await expect(
      page.locator('.review-group.progress .prob-card:has-text("SOLVE-1")')
    ).toBeVisible();
    // 졸업 그룹 자체가 비어 토글이 뜨지 않는다
    await expect(page.locator(".group-toggle")).toHaveCount(0);
  });

  test("도움 없이 연속 2회면 졸업한다 (정상 경로 회귀)", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    await page.click('.tab:has-text("문제")');
    await page.click('.prob-card:has-text("SOLVE-1") .prob-card-main');
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await expect(page.locator(".verdict-stamp")).toHaveText("맞음");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.map((a) => a.assisted)).toEqual([false, false]);

    // 같은 두 번의 pass가 도움 없이면 졸업한다 — 게이트만 다르다
    await page.click('.tab:has-text("문제")');
    await expect(page.locator(".group-toggle")).toContainText("졸업 1");
    await page.click(".group-toggle");
    await expect(
      page.locator('.prob-card:has-text("SOLVE-1")')
    ).toBeVisible();
  });

  test("도움받은 오답: 원인과 도움 여부가 함께 남는다", async ({ page }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click("#solve-assist-yes");
    await page.click('.ans-opt:has-text("②")');
    await page.click('.grade-btn:has-text("채점하기")');
    await classifyFail(page, "개념 부족");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts.length).toBe(1);
    // 분류를 거치는 동안(pendingFailure) 도움 여부가 살아남아야 한다
    expect(note.attempts[0].assisted).toBe(true);
    expect(note.attempts[0].cause).toBe("개념 부족");
    expect(note.attempts[0].result).toBe("fail");
    // 이번 시도가 노트의 주원인을 멋대로 바꾸지 않는다
    expect(note.cause).toBe("실행 실수");
  });

  test("풀이 보기: 예를 골랐으면 그대로 흐르고, 안 골랐으면 켜지지 않는다", async ({
    page,
  }) => {
    await seedOneSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click("#solve-assist-yes");
    await page.click(".reveal-give-up");
    await classifyFail(page, "개념 부족");

    const note = (await readNotes(page)).find((n) => n.id === "solve_n1");
    expect(note.attempts[0].source).toBe("solution_reveal");
    // 시스템이 추론하지 않는다 — 사용자가 예를 골랐기 때문에 true다
    expect(note.attempts[0].assisted).toBe(true);
  });

  test("다음 문제로 넘어가면 아니오로 리셋된다", async ({ page }) => {
    await seedTwoSolvable(page);

    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await expect(page.locator(".solve-prog")).toContainText("1 / 2");

    // 1번: 도움 받고 정답
    await page.click("#solve-assist-yes");
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await page.click('.end-btn:has-text("다음 문제")');

    // 2번: 선택이 초기화돼 있어야 한다 — 안 그러면 도움 여부가 새어 번진다
    await expect(page.locator(".solve-prog")).toContainText("2 / 2");
    await expect(page.locator("#solve-assist-no")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
    await expect(page.locator("#solve-assist-yes")).toHaveAttribute(
      "aria-pressed",
      "false"
    );
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');

    const notes = await readNotes(page);
    expect(notes.find((n) => n.id === "two_a").attempts[0].assisted).toBe(true);
    expect(notes.find((n) => n.id === "two_b").attempts[0].assisted).toBe(
      false
    );
  });

  test("큐를 새로 시작해도 아니오로 리셋된다", async ({ page }) => {
    await seedTwoSolvable(page);

    // 첫 세션에서 도움을 켜둔 채 끝낸다
    await page.click('.tab:has-text("풀기")');
    await page.click(".mode.primary .mode-go");
    await page.click("#solve-assist-yes");
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await page.click('.end-btn:has-text("다음 문제")');
    await page.click('.ans-opt:has-text("③")');
    await page.click('.grade-btn:has-text("채점하기")');
    await page.click('.end-btn:has-text("결과 보기")');
    await page.click('.end-btn:has-text("끝내기")');

    // 새 큐 — start()가 리셋하지 않으면 앞 세션 상태가 그대로 살아 있다
    await page.click(".mode-picker .chip:has-text('5문제')");
    await page.click(".mode:has(.mode-picker) .mode-go");
    await expect(page.locator("#solve-assist-no")).toHaveAttribute(
      "aria-pressed",
      "true"
    );
  });
});
