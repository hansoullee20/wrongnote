import { test, expect } from "@playwright/test";
import { freshApp, openRecord, goAnalysis, readNotes } from "./helpers.js";

test("personal AI JSON import fills a reviewable record and preserves concepts", async ({ page }) => {
  await freshApp(page);
  await openRecord(page);
  const analysis = {
    version: 1,
    locale: "en",
    question: {
      problem: "AI-MATH-1",
      plainText: "Find the maximum value.",
      latex: "\\max f(x)",
      correctAnswer: "④",
    },
    analysis: {
      topicMain: "수II·미분",
      topicSub: "최대최소",
      concepts: ["극대·극소 판정", "도함수 부호표"],
      cause: "개념 부족",
      tags: ["조건 누락"],
      mySolution: "I checked only one candidate.",
      optimalSolution: "Check every candidate.",
      memo: "Connect sign changes to extrema.",
    },
  };
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: "analysis.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(analysis)),
  });
  await expect(page.locator("#rec-problem")).toHaveValue("AI-MATH-1");
  await expect(page.locator("textarea").first()).toHaveValue("Find the maximum value.");
  await goAnalysis(page);
  await page.click('.btn--primary:has-text("저장")');
  const note = (await readNotes(page)).find((n) => n.problem === "AI-MATH-1");
  expect(note.concepts).toEqual(["극대·극소 판정", "도함수 부호표"]);
  expect(note.questionLatex).toBe("\\max f(x)");
  expect(note.analysisLocale).toBe("en");
});
