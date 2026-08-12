# Wrongnote solution-progression direction

Status: product direction approved during 2026-08-12 design review. This document is intentionally separate from the companion transport boundary so the current AI inbox/save work can finish without smuggling a second architecture change into the same commit.

## Product center

Wrongnote should not stop at `wrong → correct`. The durable learning object is the progression of a student's solution over repeated, dated attempts.

Target loop:

```text
Problem
→ Attempt
→ Solution snapshot
→ Diagnose / critique
→ Retry
→ Compare with prior solution
→ Best-known solution
→ Stable independent execution
```

The app should answer two different questions:

- Problems/grid: **what should I work on next?**
- Problem detail: **how has my thinking changed, and what is the best exam-appropriate way I know to solve this now?**

## Attempt history and solution history

Each retry remains an Attempt, but an attempt may additionally carry a solution snapshot. The timeline must preserve date/time and never overwrite an older solution.

Example:

```text
8/12  ✕   7   개념 부족       내 풀이 v1
8/15  ✓* 11   도움 사용       내 풀이 v2
8/22  ✓  11   6m18s           내 풀이 v3
9/05  ✓  11   3m42s           내 풀이 v4
```

The important learning signal is not merely the marks. The user should be able to inspect what changed between v1, v2, v3 and v4.

## Best-known solution

A problem may have multiple candidate solutions:

- user's solution
- AI-proposed solution
- official/explanation-book solution
- teacher/tutor solution

None is automatically authoritative. Wrongnote maintains a **user-approved best-known solution**. AI may recommend promotion, but the user decides.

Do not equate mathematical elegance with exam suitability. A rigorous or clever solution can be a bad CSAT solution if it is slow, fragile, memory-heavy, or difficult to reproduce under time pressure.

## AI coach jobs

AI chat should be contextual to a specific problem and, when relevant, a specific attempt/solution. Avoid a generic blank-chat surface as the primary UX.

Primary actions:

```text
내 풀이 검증
더 빠른 풀이
수능용으로 적합한가?
AI 풀이와 비교
이전 풀이보다 나아졌나?
```

The AI may assess:

- correctness / hidden assumptions
- failure point
- unnecessary work
- calculation risk
- time efficiency
- working-memory burden
- reproducibility under exam pressure
- comparison against the current best-known solution
- improvement or regression relative to previous attempts

Any assessment is advisory, not ground truth. Prefer qualitative labels initially over fake-precision numeric scores.

## Mastery direction

Long-term mastery should move toward:

```text
correct
+ independent
+ stable across time
+ reasonably efficient
```

Efficiency is a diagnostic signal, not a speed contest. The app should flag consistently impractical solutions without rewarding meaningless second-shaving.

## Data-model direction (future schema; not part of the current inbox commit)

Candidate extension:

```js
attempt: {
  id,
  ts,
  answer,
  correct,
  assisted,
  seconds,
  cause,
  failurePoint,
  tags,
  memo,

  solution: {
    text,
    imageIds,
    method,
    source: "user"
  },

  aiCritique: {
    summary,
    correctness,
    efficiency,
    examFit,
    calculationRisk,
    improvementFromPrevious
  }
}
```

Problem-level future fields may include a stable reference to a user-approved best-known solution. Do not duplicate full solution bodies unnecessarily; prefer stable IDs/references once the exact schema is settled.

## Problem detail target

A future detail screen should make the solution a first-class view:

```text
26 수능 미적분 30

독립 안정화  ●●●○
최근 풀이    3분 42초
시도         5회
최종 실패    8/15
최근 성공    9/05

[문제 보기]

──── 풀이 ────
현재 최적 풀이
[전체 풀이 보기] [AI에게 검증] [내 풀이와 비교]

──── 진행 ────
9/05 ✓ 3:42   내 풀이 v4
8/22 ✓ 6:18   내 풀이 v3
8/15 ✓*       도움받음
8/12 ✕        내부도함수 누락

[전체 풀이 변화 보기]
```

## Sequence

Do not derail the current bridge work. Implementation order remains:

1. finish browser AI inbox/review UX;
2. persist AI `eventId` and settle accepted only after durable Wrongnote note save;
3. prove real localhost/Chrome/Claude end-to-end behavior;
4. then introduce the solution-progression schema and problem-detail/AI-coach UX as a separate reviewed change.

This keeps the transport trust boundary small while preserving the newly approved product direction.