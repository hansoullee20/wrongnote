// 스키마 버전 & 마이그레이션 — 전부 순수 함수, 몇 번 돌려도 같은 결과(idempotent)

export const SCHEMA_VERSION = 2;

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
 * v2: 노트에 반복 재검증 필드 추가 + 누락 필드 보정.
 * @param {object} note 저장된 노트
 */
export function migrateNote(note) {
  return {
    ...note,
    tags: Array.isArray(note.tags) ? note.tags : [],
    rechecked: note.rechecked ?? false,
    recheckResult: note.recheckResult ?? null,
    // ---- 반복 재검증 (v2) ----
    recheckCount: note.recheckCount ?? (note.rechecked ? 1 : 0),
    nextRecheckTs: note.nextRecheckTs ?? null,
  };
}
