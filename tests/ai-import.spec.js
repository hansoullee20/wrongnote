import { test, expect } from "@playwright/test";
import { freshApp, openRecord, openNoteByProblem, goAnalysis, readNotes } from "./helpers.js";

/** AI 분석 JSON을 파일로 골라 넣는다 */
async function importAnalysis(page, analysis) {
  await page.locator('input[type="file"][accept=".json,application/json"]').setInputFiles({
    name: "analysis.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(analysis)),
  });
}

const BASE = {
  version: 1,
  locale: "ko",
  question: { problem: "", plainText: "본문", latex: "", correctAnswer: "③" },
  analysis: {
    topicMain: "", topicSub: "", concepts: [], cause: "개념 부족",
    tags: [], mySolution: "", optimalSolution: "", memo: "",
  },
};

const mkAnalysis = (problem, topicMain, topicSub) => ({
  ...BASE,
  question: { ...BASE.question, problem },
  analysis: { ...BASE.analysis, topicMain, topicSub },
});

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
  // 유효한 쌍은 그대로 살아남는다 — 검증이 정상 경로를 깎아내면 안 된다
  expect(note.topicMain).toBe("수II·미분");
  expect(note.topicSub).toBe("최대최소");
});

/* 분류체계 검증. AI가 준 대단원이 MATH_TOPICS에 없으면 편집 2단계의
   MATH_TOPICS[main]이 undefined가 되어 ChipRow가 터진다. */
test.describe("가져온 단원은 분류체계로 검증한다", () => {
  test("모르는 대단원은 버리고, 2단계가 터지지 않는다", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await freshApp(page);
    await openRecord(page);
    await importAnalysis(page, mkAnalysis("AI-BAD-MAIN", "수III·존재하지않는대단원", "치환적분"));
    await expect(page.locator("#rec-problem")).toHaveValue("AI-BAD-MAIN");

    await goAnalysis(page);
    // 2단계가 실제로 그려졌고, 예외가 없다
    await expect(page.locator('.btn--primary:has-text("저장")')).toBeVisible();
    expect(errors).toEqual([]);

    await page.click('.btn--primary:has-text("저장")');
    const note = (await readNotes(page)).find((n) => n.problem === "AI-BAD-MAIN");
    expect(note.topicMain).toBe("");
    expect(note.topicSub).toBe("");
  });

  test("대단원이 맞고 소단원만 틀리면 대단원은 살린다", async ({ page }) => {
    await freshApp(page);
    await openRecord(page);
    await importAnalysis(page, mkAnalysis("AI-BAD-SUB", "수II·미분", "존재하지않는소단원"));

    await goAnalysis(page);
    await page.click('.btn--primary:has-text("저장")');
    const note = (await readNotes(page)).find((n) => n.problem === "AI-BAD-SUB");
    // 오타 하나로 분석 전체를 버리지 않는다 — 부분 구제
    expect(note.topicMain).toBe("수II·미분");
    expect(note.topicSub).toBe("");
  });

  /* 검증 없던 시절(v1)에 이미 저장된 노트. 입력만 막으면 이건 안 고쳐진다 —
     크래시는 렌더 지점에 있고, 1단계에서는 닿지 않으니 2단계까지 들어가야 한다. */
  test("이미 저장된 잘못된 대단원도 편집 2단계에서 터지지 않는다", async ({ page }) => {
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));

    await freshApp(page);
    await page.evaluate(() => {
      const raw = localStorage.getItem("wr_notes");
      const notes = raw ? JSON.parse(raw) : [];
      notes.push({
        subject: "수학", problem: "STORED-BAD", topicMain: "수III·존재하지않는대단원",
        topicSub: "치환적분", question: "", mySol: "", optSol: "", cause: "",
        tags: [], derived: null, memo: "", correctAnswer: "", myAnswer: "",
        examTime: "", images: [], solutionImages: [], attempts: [],
        concepts: [], analysisLocale: "ko",
        ts: 1700000000000, id: "storedbad1", date: "2026-06-01",
        rechecked: false, recheckResult: "", recheckCount: 0, nextRecheckTs: null,
      });
      localStorage.setItem("wr_notes", JSON.stringify(notes));
    });
    await page.reload();
    await page.locator(".tab.on").first().waitFor();

    await openNoteByProblem(page, "STORED-BAD");
    await goAnalysis(page);

    await expect(page.locator('.btn--primary:has-text("저장")')).toBeVisible();
    expect(errors).toEqual([]);
  });
});
