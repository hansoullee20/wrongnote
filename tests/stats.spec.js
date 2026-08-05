import { test, expect } from "@playwright/test";

const DAY = 86400000;

/** 통계 검증용 시드 — 그룹·개선율·태그 추이가 전부 결정되는 데이터 */
async function seedStats(page) {
  await page.goto("/");
  await page.evaluate((day) => {
    localStorage.clear();
    const now = Date.now();
    const base = (id, problem, extra) => ({
      subject: "수학",
      problem,
      topicMain: "수II·미분",
      topicSub: "",
      question: "",
      mySol: "",
      optSol: "",
      cause: "개념 부족",
      tags: [],
      derived: null,
      memo: "",
      correctAnswer: "③",
      myAnswer: "②",
      attempts: [],
      ts: now - 40 * day,
      id,
      date: "2026-06-01",
      ...extra,
    });
    const fail = (ts, tags = []) => ({
      ts,
      answer: "②",
      correct: false,
      seconds: 60,
      cause: "개념 부족",
      tags,
      memo: "",
      source: "scheduled",
      result: "fail",
      id: `a${ts}`,
    });
    const pass = (ts) => ({
      ts,
      answer: "③",
      correct: true,
      seconds: 40,
      cause: "",
      tags: [],
      memo: "",
      source: "scheduled",
      result: "pass",
      id: `a${ts}`,
    });
    localStorage.setItem(
      "wr_notes",
      JSON.stringify([
        // 미재풀이 (불안정)
        base("s_unatt", "S-UNATT", {}),
        // fail → pass = 진행 중 + 개선됨.
        // 최초 기록 태그(부호 실수)는 직전 14일 창에 떨어진다
        base("s_improved", "S-IMPROVED", {
          ts: Date.now() - 20 * day,
          tags: ["부호 실수"],
          attempts: [fail(now - 18 * day), pass(now - 2 * day)],
        }),
        // 최근 fail 2회 (부호 실수) = 불안정, 개선 안 됨 → 태그 증가 추이
        base("s_still", "S-STILL", {
          attempts: [
            fail(now - 3 * day, ["부호 실수"]),
            fail(now - 1 * day, ["부호 실수"]),
          ],
        }),
        // pass, pass = 졸업 (fail 이력 없음 → 개선율 분모 제외)
        base("s_grad", "S-GRAD", {
          attempts: [pass(now - 10 * day), pass(now - 1 * day)],
        }),
        // 저볼륨 태그 — 추이 마커가 붙으면 안 된다
        base("s_low", "S-LOW", {
          ts: now - 50 * day,
          tags: ["C 누락"],
        }),
      ])
    );
    localStorage.setItem("wr_cards", JSON.stringify([]));
  }, DAY);
  await page.reload();
  await page.getByRole("button", { name: /^문제/ }).waitFor();
  await page.waitForTimeout(300);
}

test.describe("재풀이 궤적 통계", () => {
  test("네 숫자는 문제 탭 그룹과 같고 미재풀이는 부분집합으로 표시", async ({
    page,
  }) => {
    await seedStats(page);

    // 문제 탭 그룹 건수
    await expect(
      page.locator(".review-group.unstable .group-label")
    ).toContainText("불안정 3"); // s_unatt, s_still, s_low
    await expect(
      page.locator(".review-group.progress .group-label")
    ).toContainText("진행 중 1");
    await expect(page.locator(".group-toggle")).toContainText("졸업 1");

    // 통계 탭 — 같은 셀렉터, 같은 숫자
    await page.click('.tab:has-text("통계")');
    const cells = page.locator(".audit-cell.traj-cell");
    await expect(cells.nth(0)).toContainText("3");
    await expect(cells.nth(0)).toContainText("불안정");
    await expect(cells.nth(1)).toContainText("1");
    await expect(cells.nth(2)).toContainText("1");
    // 미재풀이는 불안정의 부분집합임이 라벨에 드러난다
    await expect(cells.nth(3)).toContainText("미재풀이 · 불안정 중");
    await expect(cells.nth(3).locator(".audit-num")).toHaveText("2"); // s_unatt, s_low
  });

  test("개선율: fail 경험 노트만 분모", async ({ page }) => {
    await seedStats(page);
    await page.click('.tab:has-text("통계")');

    // eligible: s_improved, s_still (s_grad은 pass만이라 제외) → 1/2 = 50%
    await expect(page.locator(".improve-line")).toContainText(
      "틀렸던 2건 중 1건 개선"
    );
    await expect(page.locator(".improve-line b")).toHaveText("50%");
  });

  test("태그 변화: 기록+재풀이 fail 합산, 기간 비교, 저볼륨 마커 없음", async ({
    page,
  }) => {
    await seedStats(page);
    await page.click('.tab:has-text("통계")');

    // 부호 실수: 최초 기록 1(직전 창) + fail attempt 2(최근 창) = 총 3, 1→2 증가
    const sign = page.locator('.trend-row:has-text("부호 실수")');
    await expect(sign.locator(".bar-count")).toHaveText("3");
    await expect(sign.locator(".trend-counts")).toHaveText("1→2");
    await expect(sign.locator(".trend-marker.up")).toHaveText("↑ 증가");

    // C 누락: 50일 전 1건 — 두 창 모두 밖, 저볼륨이라 마커 없음
    const cee = page.locator('.trend-row:has-text("C 누락")');
    await expect(cee.locator(".bar-count")).toHaveText("1");
    await expect(cee.locator(".trend-counts")).toHaveText("0→0");
    await expect(cee.locator(".trend-marker")).toHaveCount(0);

    // pass attempt의 태그는 집계되지 않는다 — s_grad pass 2회는 어디에도 없음
    // (pass는 tags가 비어 있으므로 행 자체가 생기지 않는 것으로 충분)

    // 기존 섹션은 이름을 바꿔 유지된다
    await expect(
      page.locator('.section-title:has-text("최초 기록 세부 태그 분포")')
    ).toBeVisible();
    await expect(
      page.locator('.section-title:has-text("주원인 분포")')
    ).toBeVisible();
    await expect(
      page.locator('.section-title:has-text("재검증 감사")')
    ).toBeVisible();
  });

  test("숫자 탭 → 문제 탭 그룹 이동, 미재풀이는 필터 적용", async ({
    page,
  }) => {
    await seedStats(page);
    await page.click('.tab:has-text("통계")');

    // 졸업 탭 → 문제 탭, 졸업 섹션이 펼쳐진 채
    await page.click('.audit-cell.traj-cell:has-text("졸업")');
    await expect(page.locator('.prob-card:has-text("S-GRAD")')).toBeVisible();

    // 미재풀이 탭 → 불안정 중 attempt 0회만
    await page.click('.tab:has-text("통계")');
    await page.click('.audit-cell.traj-cell:has-text("미재풀이")');
    await expect(
      page.locator(".review-group.unstable .group-label")
    ).toContainText("불안정 2");
    await expect(page.locator('.prob-card:has-text("S-UNATT")')).toBeVisible();
    await expect(page.locator('.prob-card:has-text("S-STILL")')).toHaveCount(0);

    // 해제 chip
    await page.click('.chip:has-text("미재풀이만 ✕")');
    await expect(page.locator('.prob-card:has-text("S-STILL")')).toBeVisible();
  });
});
