===== Amendment 01 — implementation plan (Claude, opus-5) — Tier 2, independent =====
base: origin/main (D1). SCHEMA_VERSION 5 -> 6.
binding decisions: D1 main / D2 assisted-✓ resets streak / D3 풀이보기 unchanged /
D4 recheck scheduling unchanged.

## Scope delta

Already shipped in v5 — the plan must NOT redo these: attempts[] authoritative
(review.js:1-3), per-attempt cause (App.jsx:302, append-only at :312),
deterministic legacy ids + no retroactive cause inference (migrate.js:52-54).
Field is `ts`, not `attemptedAt`; renaming is out of scope and would break every
selector in review.js. Genuine delta is only: `assisted` field, the streak gate,
the capture control, and the trajectory glyph.

Retirement/graduation in this codebase = note-level `GRADUATION_PASS_STREAK`
(constants.js:119, consumed in review.js:39). Card SM-2 (`gradeCard`, ease/due)
is a separate system with no attempts; §5 does not touch it.

## Commits

A. `feat(schema): record assistance on each attempt (v6)`
   — src/migrate.js, tests/migration.spec.js
   Pure additive schema + migration. No selector reads the field yet, so this
   commit cannot change behavior — that is what makes the next one reviewable.

B. `fix(review): an assisted pass is not an independent pass`
   — src/review.js, tests/review.spec.js
   The retirement behavior change, alone. At this point nothing writes `assisted`,
   so the diff is provably inert until commit C — the gate is reviewable in
   isolation without UI noise.

C. `feat(solve): ask whether help was used before recording a retry`
   — src/views/SolveView.jsx, src/App.jsx, tests/solve.spec.js
   Capture path. Separated from B so "did the gate change?" and "did capture
   change?" stay independently answerable in review.

D. `feat(review): mark assisted passes in the trajectory`
   — src/components.jsx, src/styles.css, tests/review.spec.js
   Display only. No logic.

Order is forced: A before C (field must migrate before it is written). B may land
before C because an absent `assisted` is falsy, so the gate is a no-op until
capture exists — verify that claim with the existing review tests unchanged.

## Steps

### Commit A — schema + migration

A1. src/migrate.js:5 — `SCHEMA_VERSION` 5 -> 6, comment
    `// v6: attempt-level assistance flag`.
A2. src/migrate.js:63 (inside `migrateAttempt`, alongside `cause`/`tags`) — add
    `assisted: attempt.assisted === true,`
    Strict `=== true` is deliberate: it defaults missing/garbage to false in one
    expression and is idempotent by construction (§6). Do not use `??` — a stored
    `"yes"` string would survive as truthy.
A3. Do NOT touch `migrateNote`. attempts are normalized only through
    `migrateAttempt`, already called at migrate.js:95-97.
    Acceptance: an attempt object with no `assisted` returns `assisted === false`;
    `migrateAttempt(migrateAttempt(x))` deep-equals `migrateAttempt(x)`.

### Commit B — retirement gate (D2)

B1. src/review.js:21-29 — in `getConsecutivePasses`, change the loop guard from
    `if (!attempts[i].correct) break;` to break on `!a.correct || a.assisted`.
    Scanning backwards, breaking IS "reset to 0" (D2).
B2. src/review.js:20 — update the doc comment to
    `/** 최신에서 거슬러 올라가며 연속 **독립** pass 수 (도움받은 pass는 끊는다) */`
B3. Do NOT change `classifyReviewState` (:35-42). Derive the consequence instead
    and assert it in tests: an assisted-correct last attempt is `correct === true`,
    so it is not "unstable"; its streak is 0, so it is "progress". That is the
    intended reading of §5 ("learning progress, but not an independent success")
    and it needs no code.
B4. Do NOT change `calculateImprovement` (:122-131). §5 constrains retirement
    only and §9 does not authorize stats changes, so an assisted pass still counts
    as "improved". Record this as a deliberate non-change in the commit body.

### Commit C — capture (§7)

The pass path currently saves immediately — App.jsx is called straight from
`grade()` at SolveView.jsx:404-413 with no intermediate step. §7 forbids a new
Attempt screen/workflow, so the help answer must exist BEFORE grading rather than
as a new post-grade step.

C1. src/views/SolveView.jsx, with the other per-problem state (~:88-99) — add
    `const [assisted, setAssisted] = useState(false);`
C2. src/views/SolveView.jsx, in the solving phase near the answer controls — add a
    two-button row matching the existing `mode-switch` pattern used in
    SettingsView.jsx:173-186 (so it inherits the design system per §7):
      label "도움받았나?"  buttons [아니오][예], `aria-pressed` on both,
      stable ids `solve-assist-no` / `solve-assist-yes` so the new control cannot
      collide with existing text-matching selectors in solve.spec.js.
    Default is 아니오 (§4).
C3. src/views/SolveView.jsx:404-413 (pass path) — pass `assisted` into
    `onRecordAttempt`.
C4. src/views/SolveView.jsx:437-444 (`beginFailClassification`) — carry `assisted`
    into `pendingFailure` so it survives to `finalizeFail` (:452). The flag is
    stored on fails too (§4 says every attempt has it) even though the gate only
    consults it on passes.
C5. src/views/SolveView.jsx `revealSolution` (:421-424) — pass nothing new. Per D3
    this stays a plain fail and must NOT set assisted. Add a comment stating D3 so
    a future reader does not "fix" it.
C6. src/views/SolveView.jsx `next()` (:461) — reset `setAssisted(false)` alongside
    the other per-problem resets, or the flag leaks to the next problem.
C7. src/App.jsx:293-305 (attempt literal in `recordRecheck`) — add
    `assisted: draft.assisted === true,`.
    Critical: place it OUTSIDE the `correct ? ... : ...` discards at :302-304.
    `cause`/`tags`/`memo` are intentionally dropped on a pass; `assisted` must
    NOT be, or the gate never sees it.
C8. Do NOT touch App.jsx:314-316 scheduling (D4).

### Commit D — display (§8)

D1. src/components.jsx:174-192 (`TrajectoryDots`) — three-way glyph:
    fail `●`, assisted pass `◐`, clean pass `○`; class `traj-dot assisted`;
    `aria-label` "도움받아 통과" so the distinction is not colour/shape-only.
D2. src/components.jsx:211-235 (`AttemptHistory`) — mark the row `○*` and append
    "· 도움받음" to the body text for an assisted pass.
D3. src/styles.css — one `.traj-dot.assisted` rule reusing existing tokens.
    Note: §8 writes the marker as `✓*`, but this component family uses ○/●/✗.
    Following the existing UI system (§7) beats matching the spec's illustrative
    glyph; flagging it rather than silently diverging.

## Tests

migration.spec.js
 - legacy attempt with no `assisted` migrates to `false`; `ts`, `correct`,
   `cause`, `answer` unchanged.
 - a stored `assisted: "yes"` normalizes to `false` (guards the `=== true` choice).
 - idempotency: migrating twice yields a deep-equal note (§6).
 - a historical attempt with no cause still has `cause === ""` — no invention (§3).

review.spec.js (pure selectors)
 - `[✓, ✓]` -> graduated (unchanged baseline).
 - `[✓, ✓*, ✓]` -> consecutive = 1, state = "progress", NOT graduated. This is D2.
 - `[✓*, ✓, ✓]` -> graduated; an assisted pass does not poison later clean ones.
 - `[✓*]` alone -> "progress", not "unstable" and not "graduated" (asserts B3).
 - `[✕, ✓*]` -> "progress", streak 0.

solve.spec.js
 - help control defaults to 아니오.
 - correct + 예 -> stored attempt has `assisted === true`; note does not graduate
   on the second such pass.
 - correct + 아니오 twice -> graduates (regression guard on the normal path).
 - fail + 예 -> `assisted === true` persists through the fail classification flow
   and the cause is still required.
 - 풀이 보기 -> attempt is a fail with `assisted === false` (guards D3).
 - moving to the next problem resets the toggle (guards C6).

components: assisted pass renders the distinct marker and its own aria-label.

## Risks

- R1. Adding a control to the solving screen can break text-matching selectors in
  the existing solve.spec.js suite (it matches on button text such as 저장/실패
  기록). Mitigated by stable ids in C2. Guarded by: the whole existing
  `재풀이 fail 분류 (v5)` block in tests/solve.spec.js.
- R2. Forgetting C6 leaks assistance onto the next problem — a silent data
  corruption that no existing test would catch. Guarded by the new reset test.
- R3. Putting C7 inside the pass-discard ternary would make the gate permanently
  dead while every test on the fail path still passes. Guarded by the
  "correct + 예" assertion reading the persisted note.
- R4. Commit B alone changes no behavior only if nothing writes `assisted`.
  Guarded by running the existing review.spec.js unchanged at commit B.
- R5. SCHEMA_VERSION 6 is also used by the parked v1 branch for an unrelated
  feature. Whichever merges second must rebase to 7. Not fixable here; flagged.

## Explicitly out of scope

`attemptedAt` rename (§2 names it, but `ts` is load-bearing across review.js);
assistance types / hint level / duration / AI provider / confidence / stroke data
/ concept mastery (§2 defers all); Study/Practice/Test modes; card SM-2 SRS;
`calculateImprovement` semantics (B4); recheck scheduling (D4); 풀이 보기
semantics (D3); any Master Plan v3 roadmap item (§9).
