// 재풀이 궤적 셀렉터 — 전부 순수 함수. 상태는 attempts에서 파생하고
// 저장하지 않는다 (저장하면 attempt와 어긋난 채 굳는다).
// ProblemsView와 StatsView가 반드시 같은 함수를 쓴다.

import {
  GRADUATION_PASS_STREAK,
  TRAJECTORY_LIMIT,
  TAG_TREND_WINDOW_DAYS,
  DAY_MS,
} from "./constants.js";

export const getAttempts = (note) =>
  Array.isArray(note.attempts) ? note.attempts : [];

export const getLastAttempt = (note) => {
  const a = getAttempts(note);
  return a.length ? a[a.length - 1] : null;
};

/** 최신에서 거슬러 올라가며 연속 pass 수 */
export function getConsecutivePasses(note) {
  const attempts = getAttempts(note);
  let count = 0;
  for (let i = attempts.length - 1; i >= 0; i -= 1) {
    if (!attempts[i].correct) break;
    count += 1;
  }
  return count;
}

/**
 * 안정성 그룹 — "unstable" | "progress" | "graduated".
 * 미재풀이(attempt 0회)는 별도 그룹이 아니라 unstable의 부분집합이다.
 */
export function classifyReviewState(note) {
  const attempts = getAttempts(note);
  if (attempts.length === 0) return "unstable";
  if (!attempts[attempts.length - 1].correct) return "unstable";
  return getConsecutivePasses(note) >= GRADUATION_PASS_STREAK
    ? "graduated"
    : "progress";
}

export const REVIEW_STATE_LABELS = {
  unstable: "불안정",
  progress: "진행 중",
  graduated: "졸업",
};

export const isUnattempted = (note) => getAttempts(note).length === 0;

/** 최근 시도 limit개, 오래된 것 → 최신 순 */
export const getTrajectory = (note, limit = TRAJECTORY_LIMIT) =>
  getAttempts(note).slice(-limit);

/** 마지막 활동 시각 — attempt 없으면 기록 시각 */
export const getReviewActivityTs = (note) =>
  getLastAttempt(note)?.ts ?? note.ts;

/**
 * 그룹 내부 정렬: 오래 안 본 것 우선 → ts → id. 결정적이어야
 * "다음 불안정 문제" 선택이 reload 간에 흔들리지 않는다.
 */
export function compareReviewNotes(a, b) {
  const actA = getReviewActivityTs(a);
  const actB = getReviewActivityTs(b);
  if (actA !== actB) return actA - actB;
  if (a.ts !== b.ts) return a.ts - b.ts;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** {unstable, progress, graduated} — 각 그룹은 compareReviewNotes로 정렬됨 */
export function buildReviewGroups(notes) {
  const groups = { unstable: [], progress: [], graduated: [] };
  for (const n of notes) groups[classifyReviewState(n)].push(n);
  for (const key of Object.keys(groups)) groups[key].sort(compareReviewNotes);
  return groups;
}

/** "오늘" | "N일 전" — 미래 timestamp는 오늘로 clamp */
export function formatDaysAgo(ts, now = Date.now()) {
  const days = Math.max(0, Math.floor((now - ts) / DAY_MS));
  return days === 0 ? "오늘" : `${days}일 전`;
}

/**
 * 태그 발생 이벤트 집계 — 최초 기록(note.ts × note.tags) +
 * 실패 attempt(attempt.ts × attempt.tags). pass에는 이벤트가 없고,
 * cause와 세부 tags를 섞지 않는다.
 * lifetime total은 줄어들 수 없으므로 추이는 두 기간을 비교한다:
 * recent [now-14d, now] / previous [now-28d, now-14d)
 */
export function buildTagTrend(notes, now = Date.now()) {
  const windowMs = TAG_TREND_WINDOW_DAYS * DAY_MS;
  const recentStart = now - windowMs;
  const prevStart = now - 2 * windowMs;
  const rows = new Map();
  const bump = (tag, ts) => {
    const row = rows.get(tag) || { tag, total: 0, recent: 0, previous: 0 };
    row.total += 1;
    if (ts >= recentStart && ts <= now) row.recent += 1;
    else if (ts >= prevStart && ts < recentStart) row.previous += 1;
    rows.set(tag, row);
  };
  for (const n of notes) {
    for (const t of n.tags || []) bump(t, n.ts);
    for (const a of getAttempts(n)) {
      if (a.correct) continue;
      for (const t of a.tags || []) bump(t, a.ts);
    }
  }
  return [...rows.values()].sort(
    (x, y) => y.total - x.total || (x.tag < y.tag ? -1 : 1)
  );
}

/**
 * 개선율: fail 경험이 있는 노트 중 최신 attempt가 pass인 비율.
 * pass만 있는 노트·attempt 없는 노트는 분모에서 제외 — "개선"은
 * 실패했던 것이 잡혔다는 뜻이지, 원래 잘 풀던 것이 아니다.
 */
export function calculateImprovement(notes) {
  const eligible = notes.filter((n) =>
    getAttempts(n).some((a) => !a.correct)
  );
  const improved = eligible.filter((n) => getLastAttempt(n)?.correct);
  return {
    eligible: eligible.length,
    improved: improved.length,
    rate: eligible.length ? improved.length / eligible.length : 0,
  };
}
