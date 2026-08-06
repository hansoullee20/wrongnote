import { test, expect } from "@playwright/test";

/**
 * 랜덤 뽑기의 균등성.
 *
 * 예전엔 두 곳 모두 [...pool].sort(() => Math.random() - 0.5) 를 썼다.
 * 비교 함수가 비일관적이라 정렬 알고리즘의 전제가 깨지고, 결과가 균등
 * 분포가 아니라 원래 순서 앞쪽에 치우친다. 측정하면 5개 배열에서 셀별
 * 최대 편차가 65%까지 벌어진다 (균등이면 0에 수렴).
 *
 * 오답노트에서 이건 단순한 미관 문제가 아니다 — "전체에서 랜덤"이 사실은
 * 목록 앞쪽 문제만 자주 내보내면, 뒤쪽 문제는 영영 안 나온다.
 */

const N = 50_000;
const SIZE = 5;

test("shuffle은 균등 분포다 (Fisher-Yates)", async ({ page }) => {
  await page.goto("/");

  const worstDeviation = await page.evaluate(
    async ({ n, size }) => {
      const { shuffle } = await import("/src/constants.js");
      const base = Array.from({ length: size }, (_, i) => i);
      // counts[값][자리] — 균등하면 모든 칸이 n/size 에 수렴한다
      const counts = Array.from({ length: size }, () => Array(size).fill(0));
      for (let k = 0; k < n; k++) {
        shuffle(base).forEach((v, pos) => counts[v][pos]++);
      }
      const ideal = n / size;
      let worst = 0;
      for (const row of counts) {
        for (const c of row) worst = Math.max(worst, Math.abs(c - ideal) / ideal);
      }
      return worst;
    },
    { n: N, size: SIZE }
  );

  // 균등 셔플의 통계 잡음은 이 표본에서 1% 안팎, 3σ라도 3%를 넘지 않는다.
  // 편향된 sort 방식은 65%가 나오므로 10% 문턱이 둘을 확실히 가른다.
  expect(worstDeviation).toBeLessThan(0.1);
});

test("shuffle은 원본을 건드리지 않고 같은 원소를 반환한다", async ({
  page,
}) => {
  await page.goto("/");

  const result = await page.evaluate(async () => {
    const { shuffle } = await import("/src/constants.js");
    const original = ["a", "b", "c", "d"];
    const snapshot = [...original];
    const out = shuffle(original);
    return {
      originalUntouched: JSON.stringify(original) === JSON.stringify(snapshot),
      sameMembers:
        JSON.stringify([...out].sort()) === JSON.stringify([...snapshot].sort()),
      sameLength: out.length === snapshot.length,
      notSameRef: out !== original,
    };
  });

  expect(result).toEqual({
    originalUntouched: true,
    sameMembers: true,
    sameLength: true,
    notSameRef: true,
  });
});
