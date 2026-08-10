import { test, expect } from "@playwright/test";

async function today(page, fn) {
  await page.goto("/");
  return page.evaluate(async (src) => {
    const m = await import("/src/today.js");
    return new Function("m", `return (${src})(m);`)(m);
  }, fn.toString());
}

const card = (id, extra = {}) => ({ id, savedAt: 100, topicSub: "", tags: [], lastRetryAt: null, nextDueAt: null, retired: false, consecutiveCorrect: 0, incorrectCount: 0, retryLog: [], firstRetryAt: null, ...extra });

test("Today prioritizes grouped due, due, then never-retried", async ({ page }) => {
  const ids = await today(page, (m) => m.selectTodayCards([
    { id: "never", savedAt: 1, topicSub: "", tags: [], lastRetryAt: null, nextDueAt: null, retired: false },
    { id: "due", savedAt: 3, topicSub: "", tags: [], lastRetryAt: 1, nextDueAt: 1, retired: false },
    { id: "g1", savedAt: 4, topicSub: "t", tags: ["x"], lastRetryAt: 1, nextDueAt: 2, retired: false },
    { id: "g2", savedAt: 5, topicSub: "t", tags: ["x"], lastRetryAt: 1, nextDueAt: 2, retired: false },
  ], 10).map((c) => c.id));
  expect(ids).toEqual(["g1", "g2", "due"]);
});

test("outcomes schedule 14 days and retire after two corrects", async ({ page }) => {
  const result = await today(page, (m) => {
    const base = { id: "a", savedAt: 1, firstRetryAt: null, lastRetryAt: null, nextDueAt: null, consecutiveCorrect: 0, incorrectCount: 0, retired: false, retryLog: [] };
    const first = m.applyOutcome(base, "correct", 100);
    const second = m.applyOutcome(first, "correct", 200);
    const incorrect = m.applyOutcome(base, "incorrect", 100);
    return { first, second, incorrect };
  });
  expect(result.first.nextDueAt).toBe(100 + 14 * 86400000);
  expect(result.second.retired).toBe(true);
  expect(result.incorrect.incorrectCount).toBe(1);
  expect(result.incorrect.consecutiveCorrect).toBe(0);
});

test("retry rate uses timestamp arithmetic and returns null without eligible cards", async ({ page }) => {
  const result = await today(page, (m) => ({
    rate: m.retryRate([{ savedAt: 0, firstRetryAt: 7 * m.DAY_MS, retired: false }], 8 * m.DAY_MS),
    none: m.retryRate([{ savedAt: 8 * m.DAY_MS, firstRetryAt: null }], 8 * m.DAY_MS),
  }));
  expect(result.rate).toBe(1);
  expect(result.none).toBe(null);
});
