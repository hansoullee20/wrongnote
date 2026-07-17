// SM-2 라이트 3버튼 SRS — 순수 함수, 카드를 변경하지 않고 새 카드를 반환
import { DAY_MS } from "./constants.js";

const AGAIN_DELAY_MS = 10 * 60 * 1000; // '다시'는 ~10분 뒤 같은 세션 재시도
const MIN_EASE = 1.3;

/**
 * 채점 결과로 다음 복습을 예약한 새 카드를 반환.
 * @param {object} card SRS 필드를 가진 카드
 * @param {'again'|'good'|'easy'} grade
 * @param {number} now 기준 시각 (ms)
 */
export function scheduleCard(card, grade, now = Date.now()) {
  let { interval, ease, state, lapses } = card;

  if (grade === "again") {
    if (state === "review") lapses += 1;
    ease = Math.max(MIN_EASE, ease - 0.2);
    interval = 0;
    state = "learning";
    return {
      ...card,
      interval,
      ease,
      state,
      lapses,
      due: now + AGAIN_DELAY_MS,
      reps: card.reps + 1,
      lastReviewed: now,
    };
  }

  if (grade === "good") {
    interval = state !== "review" ? 1 : Math.round(interval * ease);
  } else {
    // easy
    ease += 0.15;
    interval = state !== "review" ? 3 : Math.round(interval * ease * 1.3);
  }
  interval = Math.max(1, interval);

  return {
    ...card,
    interval,
    ease,
    state: "review",
    lapses,
    due: now + interval * DAY_MS,
    reps: card.reps + 1,
    lastReviewed: now,
  };
}

/** 복습 예정 카드: due가 지난 것들, 급한 순 정렬 */
export function dueCards(cards, now = Date.now()) {
  return cards.filter((c) => c.due <= now).sort((a, b) => a.due - b.due);
}
