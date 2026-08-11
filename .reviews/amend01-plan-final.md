===== Amendment 01 — FINAL AGREED PLAN (Tier 2) =====
Sources: .reviews/amend01-plan-claude.md + .reviews/amend01-plan-codex.md,
reconciled in one joint-decision round. Awaiting Han's approval before execution.

Base: cut a branch from `origin/main` after `git fetch origin`. Verify
src/migrate.js reads SCHEMA_VERSION 5 before starting. Do NOT touch or
cherry-pick `v1`.

## Settled decisions

D1  base = origin/main; SCHEMA_VERSION 5 -> 6.
D2  an assisted correct RESETS the consecutive-pass streak to 0.
D3  풀이 보기 stays a plain fail; `assisted` is written ONLY by the new control.
    Joint ruling: an explicit 예 IS honoured on a reveal attempt. `assisted`
    means user-asserted help, not system-inferred help; the observed event is
    already recorded by `source: "solution_reveal"` (SolveView.jsx:424).
D4  recheck scheduling unchanged — an assisted correct keeps RECHECK_DAYS.
D5  glyphs: adopt §8 literally — ✕ / ✓ / ✓* — unified across both components.
D6  five commits.

## Scope delta

Already shipped in v5; do NOT redo: attempts[] authoritative (review.js:1-3),
per-attempt cause (App.jsx:302) appended immutably (:312), deterministic legacy
ids and no retroactive cause inference (migrate.js:52-54). Field is `ts`, not
`attemptedAt` — renaming is out of scope and breaks every selector in review.js.

Retirement/graduation here = note-level GRADUATION_PASS_STREAK (constants.js:119,
used at review.js:39). Card SM-2 (`gradeCard`) is a separate system with no
attempts; §5 does not touch it.

## Commit 1 — `feat(storage): migrate attempts to schema v6`

Files: src/migrate.js, tests/migration.spec.js, tests/review.spec.js

1. migrate.js:5 — SCHEMA_VERSION 5 -> 6; comment `// v6: attempt-level assistance`.
2. migrate.js, inside `migrateAttempt` after the normalized `correct` — add
   `assisted: attempt.assisted === true,`
   Strict `=== true` is deliberate: defaults missing/garbage to false and is
   idempotent by construction. Do NOT use `??` — a stored `"yes"` would survive
   as truthy.
3. migrate.js `migrateNote` — schema-history comment only. No field changes.
4. tests/migration.spec.js — bump existing "5" assertions to "6"; add a v5->v6
   case asserting: `wr_backup_v5` holds the original raw notes+cards; schema
   becomes "6"; every historical attempt gains `assisted:false`; ids, ts,
   result, cause, unknown attempt fields, note fields and card fields unchanged;
   reload yields byte-equivalent JSON (idempotency).
5. tests/review.spec.js — its legacy-attempt migration block also asserts the
   schema version; bump it and add `assisted === false`, keeping every existing
   v5 normalization assertion (deterministic ids, no inferred cause).

Acceptance: no selector reads `assisted` yet, so this commit cannot change
behavior. That is what makes commit 2 reviewable in isolation.

## Commit 2 — `fix(review): an assisted pass is not an independent pass`

Files: src/review.js, tests/review.spec.js

1. review.js:21-29 `getConsecutivePasses` — break on `!a.correct || a.assisted`.
   Use `break`, never `continue`: scanning backwards, breaking IS D2's reset.
   A missing `assisted` is falsy, so legacy attempts count as unassisted.
2. review.js:20 — comment ->
   `/** 최신에서 거슬러 올라가며 연속 **독립** pass 수 (도움받은 pass는 끊는다) */`
3. Do NOT change `classifyReviewState` (:35-42). The behavior is derived: an
   assisted-correct last attempt is `correct === true` so it is not "unstable",
   and its streak is 0 so it is "progress". Assert it; do not code it.
4. Do NOT change `calculateImprovement` (:122-131). §5 constrains retirement
   only and §9 does not authorize stats changes, so an assisted pass still counts
   as "improved". STATE THIS IN THE COMMIT BODY as a deliberate non-change, or a
   reviewer will read it as an oversight.

Tests (pure selectors): `✓ ✓` -> streak 2, graduated. `✓ ✓* ✓` -> streak 1,
progress. `✓ ✓* ✓ ✓` -> streak 2, graduated. `✓ ✓*` -> streak 0, progress.
`✕ ✓*` -> progress. Existing classification matrix passes unchanged with
attempts lacking the field.

## Commit 3 — `feat(attempts): persist assistance on retry records`

Files: src/App.jsx, tests/solve.spec.js

1. App.jsx:293-305, the attempt literal in the recheck recorder — add
   `assisted: draft.assisted === true,`
   CRITICAL: place it OUTSIDE the `correct ? ... : ...` discards at :302-304.
   cause/tags/memo are intentionally dropped on a pass; `assisted` must NOT be,
   or the gate is permanently dead while every fail-path test still passes.
2. Do NOT alter recheckResult, recheckCount, or the RECHECK_DAYS /
   FAIL_RECHECK_DAYS expression at :314-316 (D4).
3. tests/solve.spec.js — extend the existing correct / incorrect / reveal
   persistence tests to assert `assisted === false` when nothing supplies it.

## Commit 4 — `feat(solve): ask whether help was used before recording a retry`

Files: src/views/SolveView.jsx, tests/solve.spec.js

The pass path saves immediately (SolveView.jsx:404-413) and §7 forbids a new
Attempt screen, so the answer must exist BEFORE grading, not as a new step.

1. SolveView.jsx ~:88-99 — `const [assisted, setAssisted] = useState(false);`
2. SolveView.jsx solving phase, immediately before the grade/result buttons — a
   two-choice row in the existing system (the `mode-switch` pattern at
   SettingsView.jsx:173-186): label `도움을 사용했나?`, choices `아니오` / `예`,
   default 아니오, `aria-pressed` on both. Give the wrapper class `.help-choice`
   and ids `solve-assist-no` / `solve-assist-yes` so the new control cannot
   collide with the text-matching selectors already used in solve.spec.js.
   Applies to both the auto-graded and self-graded flows. No new phase.
3. SolveView.jsx `grade()` :404-413 — include `assisted` in the correct payload.
4. SolveView.jsx `beginFailClassification()` :427-440 — snapshot `assisted` into
   `pendingFailure` so it survives to `finalizeFail` (:452) through the existing
   spread. The flag is stored on fails too (§4), though the gate ignores it there.
5. SolveView.jsx `revealSolution()` :421-424 — do NOT mutate `assisted`. Per D3
   it neither forces nor auto-sets; an explicit 예 flows through step 4. Leave a
   comment naming D3 so a future reader does not "fix" it.
6. Reset `setAssisted(false)` in BOTH `start()` (:109) and `next()` (:461),
   alongside the other per-problem resets, or help state leaks across questions
   and across a queue restart.

Tests: default is 아니오; correct + 예 stores `assisted:true`, `result:"pass"`,
`recheckResult:"pass"` and nextRecheckTs still ~RECHECK_DAYS ahead (guards D4);
correct + 아니오 twice graduates (normal-path regression); fail + 예 preserves
both the per-attempt cause and `assisted:true` while the earlier attempt stays
byte-equivalent and note-level `note.cause` is unchanged (guards §1/§3); reveal
untouched -> `assisted:false`, reveal after explicit 예 -> `true`, with the
existing single-write/double-click guard intact; advancing to question two shows
아니오 active and stores `true` then `false` across the two attempts.

## Commit 5 — `feat(review): mark assisted passes in the trajectory`

Files: src/components.jsx, src/styles.css, tests/review.spec.js

1. components.jsx — one shared three-state mark/label formatter consumed by both
   `TrajectoryDots` (:174-192) and `AttemptHistory` (:211-235):

   | state             | glyph | aria-label / body        | class                   |
   |-------------------|-------|--------------------------|-------------------------|
   | failure           | `✕`   | `cause \|\| "원인 미기록"` | `traj-dot fail` / `grade-mark fail` |
   | assisted pass     | `✓*`  | `도움받음`                | `traj-dot assisted` / `grade-mark assisted` |
   | independent pass  | `✓`   | `통과`                    | `traj-dot pass` / `grade-mark pass` |

   Preserve ordering, TRAJECTORY_LIMIT, and the `id ?? ts` key. AttemptHistory
   keeps its failure tags, answer, seconds and memo.
2. styles.css — add `.traj-dot.assisted` and `.grade-mark.assisted` in the
   existing success colour family (`--success`), keeping the pass/fail families.
   `.traj-dot` is 13px (styles.css:2158) so five marks stay legible, but `✓*` is
   wider than `✓`/`✕`: render the `*` in a styled span (or set a min-width on
   `.traj-dot`) so the `gap: 3px` inline-flex row does not go ragged.
3. Distinction must not be colour-only — glyph + aria-label carry it.

Tests: seed four attempts (two fails with distinct causes, assisted correct,
independent correct); assert compact marks `✕ ✕ ✓* ✓`, accessible labels contain
each cause plus `도움받음` and `통과`, and the verbose log shows the same four.

## Risks

R1 New control breaks text-matching selectors in solve.spec.js — mitigated by
   stable ids/class (commit 4 step 2); guarded by the existing
   `재풀이 fail 분류 (v5)` block.
R2 Missing the `start()` reset leaks help state on a queue restart — silent data
   corruption no existing test catches; guarded by the new reset test.
R3 `assisted` placed inside the pass-discard ternary leaves the gate dead while
   fail-path tests still pass; guarded by the correct + 예 persistence assertion.
R4 Commit 2 is inert only while nothing writes the field; guarded by running
   review.spec.js unchanged at that commit.
R5 SCHEMA_VERSION 6 is claimed by BOTH this work and the parked v1 branch.
   Whichever merges second must rebase to 7. Not fixable here.

## Explicitly out of scope

`attemptedAt` rename; assistance types / hint level / duration / AI provider /
confidence / stroke data / concept mastery (§2 defers all); Study/Practice/Test
modes; card SM-2 SRS; `calculateImprovement` semantics; recheck scheduling (D4);
reveal-as-fail semantics (D3); every Master Plan v3 roadmap item (§9).

## Verify

After all five commits, run `npm test` in a plain local shell — never inside the
Codex sandbox (port binding is blocked there). Then review by the opposing model.
