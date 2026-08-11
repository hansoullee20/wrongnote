import { CAUSES, MATH_TOPICS } from "./constants.js";

export const AI_IMPORT_VERSION = 1;

const topicList = Object.entries(MATH_TOPICS)
  .map(([main, subs]) => `${main}: ${subs.join(", ")}`)
  .join("\n");

export function buildChatGPTRequest({ subject, problem, locale = "ko" }) {
  const language = locale === "en" ? "English" : "Korean";
  return `You are preparing a personal wrong-answer study record. I will attach two image groups: the original question and my handwritten work. Return ONLY valid JSON matching this shape:\n{\n  "version": 1,\n  "locale": "${locale}",\n  "question": { "problem": "", "plainText": "", "latex": "", "correctAnswer": "" },\n  "analysis": { "topicMain": "", "topicSub": "", "concepts": [""], "cause": "", "tags": [""], "failurePoint": "", "mySolution": "", "optimalSolution": "", "memo": "" }\n}\n\nWrite all explanatory text in ${language}. Preserve mathematical notation in LaTex. Do not invent text that cannot be read from the images; use an empty string when uncertain.\n\nSubject: ${subject}\nProblem label: ${problem || ""}\nAllowed causes: ${CAUSES.join(", ")}\nMath topic taxonomy:\n${topicList}`;
}

export function parseAiImport(raw) {
  const value = typeof raw === "string" ? JSON.parse(raw) : raw;
  if (!value || value.version !== AI_IMPORT_VERSION || !value.question || !value.analysis) {
    throw new Error("unsupported AI analysis file");
  }
  const q = value.question;
  const a = value.analysis;
  // AI가 준 단원명은 믿지 않는다 — 분류체계에 없는 대단원이 통과하면
  // 편집 2단계에서 MATH_TOPICS[main]이 undefined가 되어 화면이 터진다.
  // 부분 구제: 대단원이 유효하면 살리고 소단원만 버린다. 오타 하나로
  // 분석 전체를 버리지는 않는다.
  const mainOk = typeof a.topicMain === "string" && Object.hasOwn(MATH_TOPICS, a.topicMain);
  const topicMain = mainOk ? a.topicMain : "";
  const topicSub =
    mainOk && typeof a.topicSub === "string" && MATH_TOPICS[topicMain].includes(a.topicSub)
      ? a.topicSub
      : "";
  return {
    analysisLocale: value.locale === "en" ? "en" : "ko",
    problem: typeof q.problem === "string" ? q.problem : "",
    question: typeof q.plainText === "string" ? q.plainText : "",
    questionLatex: typeof q.latex === "string" ? q.latex : "",
    correctAnswer: typeof q.correctAnswer === "string" ? q.correctAnswer : "",
    topicMain,
    topicSub,
    concepts: Array.isArray(a.concepts) ? a.concepts.filter((x) => typeof x === "string" && x.trim()) : [],
    cause: CAUSES.includes(a.cause) ? a.cause : "",
    tags: Array.isArray(a.tags) ? a.tags.filter((x) => typeof x === "string" && x.trim()) : [],
    memo: typeof a.memo === "string" ? a.memo : "",
    mySol: typeof a.mySolution === "string" ? a.mySolution : "",
    optSol: typeof a.optimalSolution === "string" ? a.optimalSolution : "",
  };
}
