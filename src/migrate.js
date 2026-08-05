// 스키마 버전 & 마이그레이션 — 전부 순수 함수, 몇 번 돌려도 같은 결과(idempotent)

import { LEGACY_CAUSE_MAP, LEGACY_DROPPED_TAG, CAUSES } from "./constants.js";

export const SCHEMA_VERSION = 5; // v5: 시도별 실패 원인 (attempt superset)

/**
 * v2: 카드에 SRS 필드 추가.
 * @param {object} card 저장된 카드 (v1: {front, back, id, noteId, subject})
 * @param {number} now 마이그레이션 기준 시각 (ms)
 */
export function migrateCard(card, now = Date.now()) {
  return {
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
  };
}
