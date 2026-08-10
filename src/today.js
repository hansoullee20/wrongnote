export const TODAY_QUEUE_SIZE = 3;
export const DAY_MS = 24 * 60 * 60 * 1000;
export const TODAY_SESSION_KEY = "wr_today_session";

export function localDate(now = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

export function buildGroups(cards) {
  const groups = new Map();
  for (const card of cards) {
    if (!card.topicSub || !Array.isArray(card.tags)) continue;
    for (const tag of new Set(card.tags.filter(Boolean))) {
      const key = `${card.topicSub}\u0000${tag}`;
      const group = groups.get(key) || { key, topicSub: card.topicSub, tag, cards: [] };
      group.cards.push(card);
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter((g) => g.cards.length >= 2);
}

export function selectTodayCards(cards, now = Date.now()) {
  const grouped = new Set(buildGroups(cards).flatMap((g) => g.cards.map((c) => c.id)));
  const tiers = [[], [], []];
  for (const card of cards) {
    if (card.retired) continue;
    const never = card.lastRetryAt === null;
    const due = card.nextDueAt !== null && card.nextDueAt <= now;
    if (!due && !never) continue;
    const tier = due ? (grouped.has(card.id) ? 0 : 1) : 2;
    tiers[tier].push(card);
  }
  return tiers.flatMap((tier) => tier.sort((a, b) =>
    (a.nextDueAt ?? a.savedAt) - (b.nextDueAt ?? b.savedAt) || a.savedAt - b.savedAt
  )).slice(0, TODAY_QUEUE_SIZE);
}

export function loadTodaySession(cards, now = new Date()) {
  const date = localDate(now);
  try {
    const saved = JSON.parse(localStorage.getItem(TODAY_SESSION_KEY));
    if (saved?.date === date && Array.isArray(saved.cardIds)) return saved;
  } catch { /* start a fresh session */ }
  const session = { date, cardIds: selectTodayCards(cards, now.getTime()).map((c) => c.id), completedIds: [], shrunkTo1: false };
  localStorage.setItem(TODAY_SESSION_KEY, JSON.stringify(session));
  return session;
}

export function saveTodaySession(session) {
  localStorage.setItem(TODAY_SESSION_KEY, JSON.stringify(session));
}

export function applyOutcome(card, outcome, timestamp = Date.now()) {
  const correct = outcome === "correct";
  const consecutiveCorrect = correct ? card.consecutiveCorrect + 1 : 0;
  return {
    ...card,
    firstRetryAt: card.firstRetryAt ?? timestamp,
    lastRetryAt: timestamp,
    nextDueAt: timestamp + 14 * DAY_MS,
    consecutiveCorrect,
    incorrectCount: card.incorrectCount + (correct ? 0 : 1),
    retired: consecutiveCorrect >= 2,
    retryLog: [...card.retryLog, { timestamp, outcome }],
  };
}

export function retryRate(cards, now = Date.now()) {
  const eligible = cards.filter((c) => c.savedAt <= now - 7 * DAY_MS);
  if (!eligible.length) return null;
  return eligible.filter((c) => c.firstRetryAt !== null && c.firstRetryAt <= c.savedAt + 7 * DAY_MS).length / eligible.length;
}
