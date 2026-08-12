// 스키마 버전 & 마이그레이션 — 전부 순수 함수, 몇 번 돌려도 같은 결과(idempotent)

import { LEGACY_CAUSE_MAP, CAUSES } from "./constants.js";

export const SCHEMA_VERSION = 9; // v9: AI producer event identity (6은 배포된 적 없다)

/**
 * v2: 카드에 SRS 필드 추가.
 * migrateNote/migrateAttempt와 달리 예전엔 필드를 하나씩 다시 세워서,
 * 모르는 카드 필드는 로드·가져오기마다 조용히 사라졌다. 이제 spread를 먼저
 * 깔고 아는 필드로 덮는다 — 보존은 하되 정규화 규칙은 그대로다.
 * @param {object} card 저장된 카드 (v1: {front, back, id, noteId, subject})
 * @param {number} now 마이그레이션 기준 시각 (ms)
 */
export function migrateCard(card, now = Date.now()) {
  return {
    ...card, // 모르는 필드도 보존 — note·attempt와 같은 계약
    front: card.front ?? "",
    back: card.back ?? "",
    id: card.id,
    noteId: card.noteId ?? null,
    subject: card.subject ?? "수학",
    // ---- SRS (v2) ----
    interval: card.interval ?? 0, // 일 단위
    ease: card.ease ?? 2.5,
    due: card.due ?? now, // 마이그레이션 직후 즉시 복습 대상
    reps: card.reps ?? 0,
    lapses: card.lapses ?? 0,
    state: card.state ?? "new", // 'new' | 'learning' | 'review'
    lastReviewed: card.lastReviewed ?? null,
  };
}

/**
 * 옛 평면 태그에서 주원인 1개를 뽑는다.
 * 판정 못 하면 ""(미분류)를 반환한다 — 추측해서 채우면 과거 데이터가 조용히 왜곡된다.
 * @param {string[]} tags
 * @returns {string} CAUSES 중 하나 또는 ""
 */
export function deriveCause(tags) {
  for (const tag of tags) {
    const mapped = LEGACY_CAUSE_MAP[tag];
    if (mapped) return mapped;
  }
  return "";
}

/**
 * v5: 기존 {ts, answer, correct, seconds} attempt를 superset으로 정규화.
 * 과거 fail의 원인은 알 수 없으므로 절대 추측하지 않는다 (cause="").
 * id는 reload마다 바뀌면 안 되므로 결정적으로 만든다.
 * v6: assisted(도움 사용 여부). 과거 시도는 알 수 없으므로 전부 false.
 * @param {string} noteId
 * @param {object} attempt 저장된 시도
 * @param {number} index attempts 배열 내 위치
 */
export function migrateAttempt(noteId, attempt, index) {
  const correct = Boolean(attempt.correct);
  return {
    ...attempt, // 모르는 필드도 보존
    id: attempt.id ?? `legacy:${noteId}:${index}:${attempt.ts}`,
    ts: attempt.ts,
    answer: attempt.answer ?? "",
    correct,
    // === true는 의도적 — 없거나 이상한 값은 false로 떨어지고 몇 번 돌려도 같다.
    // ??를 쓰면 저장된 "yes" 같은 truthy 쓰레기가 그대로 살아남는다.
    assisted: attempt.assisted === true,
    result: correct ? "pass" : "fail",
    seconds: Number.isFinite(attempt.seconds) ? attempt.seconds : null,
    cause: attempt.cause ?? "",
    tags: Array.isArray(attempt.tags) ? attempt.tags : [],
    memo: attempt.memo ?? "",
    source: attempt.source ?? "legacy",
  };
}

/**
 * v2: 반복 재검증 필드. v3: 사진. v4: 주원인/답/시도 이력. v5: attempt 정규화.
 * v6: attempt에 assisted 추가. v8: failurePoint. v9: AI producer event identity.
 * @param {object} note 저장된 노트
 */
export function migrateNote(note) {
  const tags = Array.isArray(note.tags) ? note.tags : [];
  // '지위 오해'는 뜻이 소실된 카테고리 — 주원인 후보에서 빼되 태그로는 보존한다
  const cause = CAUSES.includes(note.cause) ? note.cause : deriveCause(tags);

  return {
    ...note,
    tags,
    rechecked: note.rechecked ?? false,
    recheckResult: note.recheckResult ?? null,
    // ---- 반복 재검증 (v2) ----
    recheckCount: note.recheckCount ?? (note.rechecked ? 1 : 0),
    nextRecheckTs: note.nextRecheckTs ?? null,
    // ---- 문제 사진 (v3) — IndexedDB blob id 배열 ----
    images: Array.isArray(note.images) ? note.images : [],
    // ---- 주원인 & 답 (v4) ----
    cause, // "" = 미분류. 통계에서 정직하게 따로 센다
    correctAnswer: note.correctAnswer ?? "",
    myAnswer: note.myAnswer ?? "",
    examTime: note.examTime ?? "",
    // 시도 이력 — 덮어쓰지 않고 쌓아야 "②를 세 번째 골랐다"가 나온다
    // v5: 시도별 원인 필드를 superset으로 정규화
    attempts: Array.isArray(note.attempts)
      ? note.attempts.map((a, i) => migrateAttempt(note.id, a, i))
      : [],
    // 해설 캡처는 문제 캡처(images)와 섞이면 안 된다
    solutionImages: Array.isArray(note.solutionImages)
      ? note.solutionImages
      : [],
    // AI가 추출한 개념은 사용자가 가져온 값만 보존한다. 과거 노트에는 추측하지 않는다.
    concepts: Array.isArray(note.concepts)
      ? note.concepts.filter((c) => typeof c === "string" && c.trim())
      : [],
    analysisLocale: note.analysisLocale === "en" ? "en" : "ko",
    /* 어디서 풀이가 무너졌는가 (v8). 과거 노트에는 추측하지 않는다. */
    failurePoint: typeof note.failurePoint === "string" ? note.failurePoint : "",
    /* MCP/companion producer event identity (v9). 이 값은 AI의 내용이 아니라
       전송 사건의 idempotency identity다. 노트 저장 성공 뒤 queue ACK를 잃어도
       재전달된 같은 event를 새 노트로 만들지 않게 한다. */
    aiEventId: typeof note.aiEventId === "string" ? note.aiEventId : "",
  };
}
