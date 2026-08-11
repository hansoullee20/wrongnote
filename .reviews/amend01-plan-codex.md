===== Amendment 01 — implementation plan (Codex gpt-5.6-sol, high) — Tier 2, independent =====

## Commits

Precondition: fetch `origin`, create the feature branch directly from `origin/main`, and verify `src/migrate.js` is schema 5. Do not use or cherry-pick `v1`.

1. `feat(storage): migrate attempts to schema v6`

   Files: `src/migrate.js`, `tests/migration.spec.js`, `tests/review.spec.js`

   Keeps the schema bump, migration defaults, backup assertions, and idempotency isolated.

2. `fix(review): reset pass streak after assisted attempts`

   Files: `src/review.js`, `tests/review.spec.js`

   Isolates the retirement behavior change from persistence and UI.

3. `feat(attempts): persist assistance on retry records`

   Files: `src/App.jsx`, `tests/solve.spec.js`

   Changes only the new-attempt write path; scheduling remains unchanged.

4. `feat(ui): add assisted retry controls and trajectory marks`

   Files: `src/views/SolveView.jsx`, `src/components.jsx`, `tests/solve.spec.js`, `tests/review.spec.js`

   Keeps input state and visual representation together without changing selectors or migration.

## Steps

### Commit 1 — `feat(storage): migrate attempts to schema v6`

1. `src/migrate.js:5`

   Change `SCHEMA_VERSION` from `5` to `6`; update the version comment to identify the attempt `assisted` flag.

   Acceptance: exported schema version is exactly `6`.

2. `src/migrate.js:migrateAttempt()`

   Add `assisted: attempt.assisted === true` after the normalized `correct` field. Preserve the existing spread, ID generation, `ts`, result normalization, cause handling, and extra fields.

   Acceptance:

   - Missing `assisted` becomes `false`.
   - Literal `true` remains `true`.
   - Existing IDs remain unchanged.
   - Missing IDs still use `legacy:${noteId}:${index}:${attempt.ts}`.
   - Re-running `migrateAttempt` produces the same object.

3. `src/migrate.js:migrateNote()`

   Update only the schema-history comments to mention v6 assistance normalization.

   Acceptance: note/card fields and attempt ordering are unchanged.

4. `tests/migration.spec.js`

   Update current-version assertions from `"5"` to `"6"`.

   Add a v5→v6 migration case seeded with:

   - `wr_schema_version = "5"`.
   - A note containing normalized v5 attempts with stable IDs, timestamps, results, causes, and no `assisted`.
   - A card with identifiable content.

   Acceptance:

   - `wr_backup_v5` contains the original raw note and card data.
   - Schema becomes `"6"`.
   - Every historical attempt receives `assisted: false`.
   - IDs, timestamps, results, causes, note fields, card fields, and unknown attempt fields are unchanged.
   - Reloading and reading notes/cards again yields byte-equivalent JSON.

5. `tests/review.spec.js`, existing legacy-attempt migration block

   Rename the v4→v5 description to v4→current/v6, expect schema `"6"`, and assert `assisted === false` on migrated attempts.

   Acceptance: all existing v5 normalization assertions remain present, including deterministic IDs and no inferred cause.

### Commit 2 — `fix(review): reset pass streak after assisted attempts`

1. `src/review.js:20-30`, `getConsecutivePasses()`

   Replace the pass-only stop condition with:

   - Stop when `correct !== true`.
   - Stop when `assisted === true`.
   - Count only attempts that are correct and not assisted.
   - Use `break`, never `continue`, so assisted correctness resets the streak.

   Treat a missing `assisted` field as unassisted for legacy selector inputs.

   Acceptance:

   - `✓ ✓` graduates.
   - `✓ ✓* ✓` has streak `1` and remains `progress`.
   - `✓ ✓* ✓ ✓` has streak `2` and graduates.
   - A latest `✓*` has streak `0` and is `progress`.
   - Existing failure-based classifications remain unchanged.

2. `tests/review.spec.js`, `review 셀렉터`

   Add a dedicated D2 test that returns both `getConsecutivePasses` and `classifyReviewState` for the four sequences above.

   Acceptance: exact counts and groups match the preceding rules; the existing classification matrix still passes with attempts lacking `assisted`.

### Commit 3 — `feat(attempts): persist assistance on retry records`

1. `src/App.jsx:290-320`, `recordAttempt()`

   Add `assisted: draft.assisted === true` to the appended attempt object.

   Do not alter:

   - Cause/tags/memo handling.
   - Append-only `attempts` construction.
   - `recheckResult`.
   - `recheckCount`.
   - The `RECHECK_DAYS`/`FAIL_RECHECK_DAYS` scheduling expression.

   Acceptance: every newly written attempt has a boolean `assisted`; omitted input stores `false`, and explicit `true` stores `true`.

2. `tests/solve.spec.js`

   Extend the existing correct, incorrect, and solution-reveal persistence tests to assert `assisted === false` when no help value is supplied.

   Acceptance: the new field is present without changing existing result, cause, source, or scheduling assertions.

### Commit 4 — `feat(ui): add assisted retry controls and trajectory marks`

1. `src/views/SolveView.jsx`, retry-session state near `picked`/`freeAnswer`

   Add boolean state `assisted`, initially `false`.

   Reset it to `false` in both `start()` and `next()` alongside the answer and pending-failure resets.

   Acceptance: every new question starts with “아니요” selected, including later questions in the same queue.

2. `src/views/SolveView.jsx`, solving-phase result controls

   Immediately before the existing grade/result buttons, add an existing-system chip row:

   - Label: `도움을 사용했나요?`
   - Choices: `아니요`, `예`
   - Default/active value: `아니요`
   - `예` sets `assisted` to `true`; `아니요` sets it to `false`.
   - Give the wrapper a stable `.help-choice` class for Playwright.

   Keep automatic grading and the existing self-grade buttons unchanged. Do not create another phase or screen.

   Acceptance: both answer-known and self-grade flows expose the same help choice before recording.

3. `src/views/SolveView.jsx`, `grade()`, `beginFailClassification()`, `finalizeFail()`

   - Include `assisted` in the immediate correct-attempt payload.
   - Snapshot `assisted` into `pendingFailure` when a failure begins.
   - Preserve it through the existing spread in `finalizeFail`.
   - Do not modify `revealSolution()` to set assistance automatically.

   Acceptance:

   - Correct and incorrect attempts store the selected value.
   - Changing phases cannot lose the failure’s captured value.
   - “풀이 보기” with untouched help selection records `assisted: false`.
   - “풀이 보기” records `true` only when the user explicitly selected `예`.

4. `src/components.jsx:172-235`

   Add shared local formatting rules used by both `TrajectoryDots` and `AttemptHistory`:

   - Incorrect: mark `✕`; label `cause || "원인 미기록"`.
   - Assisted correct: mark `✓*`; label `도움받음`.
   - Independent correct: mark `✓`; label `통과`.

   Update `TrajectoryDots` visible marks and per-attempt `aria-label` values. Preserve ordering, `TRAJECTORY_LIMIT`, and the `id ?? ts` key.

   Update `AttemptHistory` to use the same mark/label rules while retaining failure tags, answer, seconds, and memo.

   Acceptance: stored causes render verbatim, so rows distinctly show forms such as `✕ 조건 해석`, `✕ 실행 실수`, `✓* 도움받음`, and `✓ 통과`.

5. `src/components.jsx`

   Keep assisted-correct styling in the existing success family and failed styling in the existing failure family. Do not add analytics, legends, or new metadata.

   Acceptance: distinctions remain visible through symbols and text without relying only on color.

## Tests

1. `tests/migration.spec.js` — new `v5 → v6: assisted 기본값, 백업, 멱등성`

   Assert schema 6, `wr_backup_v5`, historical `assisted:false`, preserved note/card/attempt data, and identical data after reload.

2. `tests/migration.spec.js` — change existing version assertions

   Change expected schema values from `"5"` to `"6"` in legacy migration and versioned-snapshot cases. Preserve all existing backup assertions.

3. `tests/review.spec.js` — change legacy attempt migration case

   Assert migrated attempts retain deterministic IDs, timestamps, results, causes, unknown fields, and gain `assisted:false`.

4. `tests/review.spec.js` — new `도움받은 정답은 연속 통과를 0으로 리셋한다`

   Assert:

   - `✓ ✓` → streak 2, `graduated`.
   - `✓ ✓* ✓` → streak 1, `progress`.
   - `✓ ✓* ✓ ✓` → streak 2, `graduated`.
   - `✓ ✓*` → streak 0, `progress`.

5. `tests/solve.spec.js` — change existing correct/incorrect tests

   Assert untouched “아니요” produces `assisted:false`. Retain normal-pass and fail scheduling assertions.

6. `tests/solve.spec.js` — new `도움받은 정답은 assisted로 저장하고 정상 pass 주기를 쓴다`

   Select `예`, record a correct answer, then assert:

   - `correct:true`.
   - `assisted:true`.
   - `result:"pass"`.
   - `recheckResult:"pass"`.
   - `nextRecheckTs` remains approximately `RECHECK_DAYS` ahead.

7. `tests/solve.spec.js` — new `실패 분류가 assisted와 개별 cause를 함께 보존한다`

   Seed an earlier failed attempt, select `예`, record another failure with a different cause, then assert:

   - Two attempts remain in order.
   - The earlier attempt is byte-equivalent to its seed.
   - The new attempt has its selected cause and `assisted:true`.
   - The card-level `note.cause` remains unchanged.

8. `tests/solve.spec.js` — change `풀이 보기 → ... fail 1건만`

   Assert solution reveal does not change the default and stores `assisted:false`, while retaining the single-write/double-click guard.

9. `tests/solve.spec.js` — change the two-question queue case

   Select `예` for question one, advance, and assert question two has `아니요` active. Record question two and assert the two stored attempts have `true` and `false` respectively.

10. `tests/review.spec.js` — new `궤적과 시도 이력이 실패 원인과 도움받은 정답을 구분한다`

    Seed four attempts: two failures with distinct causes, assisted correct, independent correct. Assert:

    - Compact trajectory marks are `✕`, `✕`, `✓*`, `✓`.
    - Accessible labels include each failure cause, `도움받음`, and `통과`.
    - Attempt-history rows show the same four distinctions.

After implementation and opposing-model review, run `npm test` in a plain local shell, outside the Codex sandbox.

## Risks

- Schema collision from implementing on `v1`: guarded by the origin/main precondition and the migration test expecting a v5 backup and schema 6.
- Historical attempts accidentally becoming assisted: guarded by `v5 → v6: assisted 기본값, 백업, 멱등성`.
- Assisted passes being skipped instead of resetting the streak: guarded by `도움받은 정답은 연속 통과를 0으로 리셋한다`.
- Legacy attempts without the field no longer graduating: guarded by existing `안정성 그룹 분류 — 명세 예시 전부`.
- Help state leaking between questions: guarded by the changed two-question queue test.
- Failure classification dropping or overwriting assistance/cause: guarded by `실패 분류가 assisted와 개별 cause를 함께 보존한다`.
- Assisted correctness changing scheduling: guarded by the new assisted-correct test and existing `정답 → 통과 기록, 다음 복습 뒤로 밀림`.
- Solution viewing automatically marking help: guarded by existing `풀이 보기 → 분류 전 미저장, 완료 시 fail 1건만`.
- Trajectory becoming color-only or ambiguous: guarded by the new visible-mark and accessible-label test.

## Explicitly out of scope

- Renaming `ts` to `attemptedAt`.
- Removing existing attempt fields such as `answer`, `result`, `seconds`, `tags`, `memo`, or `source`.
- Changing the existing failure-cause classifier, execution gate, or append-only cause behavior.
- Retroactively inferring historical causes.
- Changing `RECHECK_DAYS`, `FAIL_RECHECK_DAYS`, or `App.jsx` scheduling logic.
- Treating “풀이 보기” itself as assistance.
- Adding an Attempt screen or workflow.
- Study/Practice/Test modes, help types, hint levels, timers, AI metadata, confidence, stroke data, or mastery analytics.
- Changing card-level cause/classification display.
- IndexedDB image storage or lifecycle changes.
- Any `v1` schema-number reconciliation or Master Plan v3 work.
tokens used
118,290
## Commits

Precondition: fetch `origin`, create the feature branch directly from `origin/main`, and verify `src/migrate.js` is schema 5. Do not use or cherry-pick `v1`.

1. `feat(storage): migrate attempts to schema v6`

   Files: `src/migrate.js`, `tests/migration.spec.js`, `tests/review.spec.js`

   Keeps the schema bump, migration defaults, backup assertions, and idempotency isolated.

2. `fix(review): reset pass streak after assisted attempts`

   Files: `src/review.js`, `tests/review.spec.js`

   Isolates the retirement behavior change from persistence and UI.

3. `feat(attempts): persist assistance on retry records`

   Files: `src/App.jsx`, `tests/solve.spec.js`

   Changes only the new-attempt write path; scheduling remains unchanged.

4. `feat(ui): add assisted retry controls and trajectory marks`

   Files: `src/views/SolveView.jsx`, `src/components.jsx`, `tests/solve.spec.js`, `tests/review.spec.js`

   Keeps input state and visual representation together without changing selectors or migration.

## Steps

### Commit 1 — `feat(storage): migrate attempts to schema v6`

1. `src/migrate.js:5`

   Change `SCHEMA_VERSION` from `5` to `6`; update the version comment to identify the attempt `assisted` flag.

   Acceptance: exported schema version is exactly `6`.

2. `src/migrate.js:migrateAttempt()`

   Add `assisted: attempt.assisted === true` after the normalized `correct` field. Preserve the existing spread, ID generation, `ts`, result normalization, cause handling, and extra fields.

   Acceptance:

   - Missing `assisted` becomes `false`.
   - Literal `true` remains `true`.
   - Existing IDs remain unchanged.
   - Missing IDs still use `legacy:${noteId}:${index}:${attempt.ts}`.
   - Re-running `migrateAttempt` produces the same object.

3. `src/migrate.js:migrateNote()`

   Update only the schema-history comments to mention v6 assistance normalization.

   Acceptance: note/card fields and attempt ordering are unchanged.

4. `tests/migration.spec.js`

   Update current-version assertions from `"5"` to `"6"`.

   Add a v5→v6 migration case seeded with:

   - `wr_schema_version = "5"`.
   - A note containing normalized v5 attempts with stable IDs, timestamps, results, causes, and no `assisted`.
   - A card with identifiable content.

   Acceptance:

   - `wr_backup_v5` contains the original raw note and card data.
   - Schema becomes `"6"`.
   - Every historical attempt receives `assisted: false`.
   - IDs, timestamps, results, causes, note fields, card fields, and unknown attempt fields are unchanged.
   - Reloading and reading notes/cards again yields byte-equivalent JSON.

5. `tests/review.spec.js`, existing legacy-attempt migration block

   Rename the v4→v5 description to v4→current/v6, expect schema `"6"`, and assert `assisted === false` on migrated attempts.

   Acceptance: all existing v5 normalization assertions remain present, including deterministic IDs and no inferred cause.

### Commit 2 — `fix(review): reset pass streak after assisted attempts`

1. `src/review.js:20-30`, `getConsecutivePasses()`

   Replace the pass-only stop condition with:

   - Stop when `correct !== true`.
   - Stop when `assisted === true`.
   - Count only attempts that are correct and not assisted.
   - Use `break`, never `continue`, so assisted correctness resets the streak.

   Treat a missing `assisted` field as unassisted for legacy selector inputs.

   Acceptance:

   - `✓ ✓` graduates.
   - `✓ ✓* ✓` has streak `1` and remains `progress`.
   - `✓ ✓* ✓ ✓` has streak `2` and graduates.
   - A latest `✓*` has streak `0` and is `progress`.
   - Existing failure-based classifications remain unchanged.

2. `tests/review.spec.js`, `review 셀렉터`

   Add a dedicated D2 test that returns both `getConsecutivePasses` and `classifyReviewState` for the four sequences above.

   Acceptance: exact counts and groups match the preceding rules; the existing classification matrix still passes with attempts lacking `assisted`.

### Commit 3 — `feat(attempts): persist assistance on retry records`

1. `src/App.jsx:290-320`, `recordAttempt()`

   Add `assisted: draft.assisted === true` to the appended attempt object.

   Do not alter:

   - Cause/tags/memo handling.
   - Append-only `attempts` construction.
   - `recheckResult`.
   - `recheckCount`.
   - The `RECHECK_DAYS`/`FAIL_RECHECK_DAYS` scheduling expression.

   Acceptance: every newly written attempt has a boolean `assisted`; omitted input stores `false`, and explicit `true` stores `true`.

2. `tests/solve.spec.js`

   Extend the existing correct, incorrect, and solution-reveal persistence tests to assert `assisted === false` when no help value is supplied.

   Acceptance: the new field is present without changing existing result, cause, source, or scheduling assertions.

### Commit 4 — `feat(ui): add assisted retry controls and trajectory marks`

1. `src/views/SolveView.jsx`, retry-session state near `picked`/`freeAnswer`

   Add boolean state `assisted`, initially `false`.

   Reset it to `false` in both `start()` and `next()` alongside the answer and pending-failure resets.

   Acceptance: every new question starts with “아니요” selected, including later questions in the same queue.

2. `src/views/SolveView.jsx`, solving-phase result controls

   Immediately before the existing grade/result buttons, add an existing-system chip row:

   - Label: `도움을 사용했나요?`
   - Choices: `아니요`, `예`
   - Default/active value: `아니요`
   - `예` sets `assisted` to `true`; `아니요` sets it to `false`.
   - Give the wrapper a stable `.help-choice` class for Playwright.

   Keep automatic grading and the existing self-grade buttons unchanged. Do not create another phase or screen.

   Acceptance: both answer-known and self-grade flows expose the same help choice before recording.

3. `src/views/SolveView.jsx`, `grade()`, `beginFailClassification()`, `finalizeFail()`

   - Include `assisted` in the immediate correct-attempt payload.
   - Snapshot `assisted` into `pendingFailure` when a failure begins.
   - Preserve it through the existing spread in `finalizeFail`.
   - Do not modify `revealSolution()` to set assistance automatically.

   Acceptance:

   - Correct and incorrect attempts store the selected value.
   - Changing phases cannot lose the failure’s captured value.
   - “풀이 보기” with untouched help selection records `assisted: false`.
   - “풀이 보기” records `true` only when the user explicitly selected `예`.

4. `src/components.jsx:172-235`

   Add shared local formatting rules used by both `TrajectoryDots` and `AttemptHistory`:

   - Incorrect: mark `✕`; label `cause || "원인 미기록"`.
   - Assisted correct: mark `✓*`; label `도움받음`.
   - Independent correct: mark `✓`; label `통과`.

   Update `TrajectoryDots` visible marks and per-attempt `aria-label` values. Preserve ordering, `TRAJECTORY_LIMIT`, and the `id ?? ts` key.

   Update `AttemptHistory` to use the same mark/label rules while retaining failure tags, answer, seconds, and memo.

   Acceptance: stored causes render verbatim, so rows distinctly show forms such as `✕ 조건 해석`, `✕ 실행 실수`, `✓* 도움받음`, and `✓ 통과`.

5. `src/components.jsx`

   Keep assisted-correct styling in the existing success family and failed styling in the existing failure family. Do not add analytics, legends, or new metadata.

   Acceptance: distinctions remain visible through symbols and text without relying only on color.

## Tests

1. `tests/migration.spec.js` — new `v5 → v6: assisted 기본값, 백업, 멱등성`

   Assert schema 6, `wr_backup_v5`, historical `assisted:false`, preserved note/card/attempt data, and identical data after reload.

2. `tests/migration.spec.js` — change existing version assertions

   Change expected schema values from `"5"` to `"6"` in legacy migration and versioned-snapshot cases. Preserve all existing backup assertions.

3. `tests/review.spec.js` — change legacy attempt migration case

   Assert migrated attempts retain deterministic IDs, timestamps, results, causes, unknown fields, and gain `assisted:false`.

4. `tests/review.spec.js` — new `도움받은 정답은 연속 통과를 0으로 리셋한다`

   Assert:

   - `✓ ✓` → streak 2, `graduated`.
   - `✓ ✓* ✓` → streak 1, `progress`.
   - `✓ ✓* ✓ ✓` → streak 2, `graduated`.
   - `✓ ✓*` → streak 0, `progress`.

5. `tests/solve.spec.js` — change existing correct/incorrect tests

   Assert untouched “아니요” produces `assisted:false`. Retain normal-pass and fail scheduling assertions.

6. `tests/solve.spec.js` — new `도움받은 정답은 assisted로 저장하고 정상 pass 주기를 쓴다`

   Select `예`, record a correct answer, then assert:

   - `correct:true`.
   - `assisted:true`.
   - `result:"pass"`.
   - `recheckResult:"pass"`.
   - `nextRecheckTs` remains approximately `RECHECK_DAYS` ahead.

7. `tests/solve.spec.js` — new `실패 분류가 assisted와 개별 cause를 함께 보존한다`

   Seed an earlier failed attempt, select `예`, record another failure with a different cause, then assert:

   - Two attempts remain in order.
   - The earlier attempt is byte-equivalent to its seed.
   - The new attempt has its selected cause and `assisted:true`.
   - The card-level `note.cause` remains unchanged.

8. `tests/solve.spec.js` — change `풀이 보기 → ... fail 1건만`

   Assert solution reveal does not change the default and stores `assisted:false`, while retaining the single-write/double-click guard.

9. `tests/solve.spec.js` — change the two-question queue case

   Select `예` for question one, advance, and assert question two has `아니요` active. Record question two and assert the two stored attempts have `true` and `false` respectively.

10. `tests/review.spec.js` — new `궤적과 시도 이력이 실패 원인과 도움받은 정답을 구분한다`

    Seed four attempts: two failures with distinct causes, assisted correct, independent correct. Assert:

    - Compact trajectory marks are `✕`, `✕`, `✓*`, `✓`.
    - Accessible labels include each failure cause, `도움받음`, and `통과`.
    - Attempt-history rows show the same four distinctions.

After implementation and opposing-model review, run `npm test` in a plain local shell, outside the Codex sandbox.

## Risks

- Schema collision from implementing on `v1`: guarded by the origin/main precondition and the migration test expecting a v5 backup and schema 6.
- Historical attempts accidentally becoming assisted: guarded by `v5 → v6: assisted 기본값, 백업, 멱등성`.
- Assisted passes being skipped instead of resetting the streak: guarded by `도움받은 정답은 연속 통과를 0으로 리셋한다`.
- Legacy attempts without the field no longer graduating: guarded by existing `안정성 그룹 분류 — 명세 예시 전부`.
- Help state leaking between questions: guarded by the changed two-question queue test.
- Failure classification dropping or overwriting assistance/cause: guarded by `실패 분류가 assisted와 개별 cause를 함께 보존한다`.
- Assisted correctness changing scheduling: guarded by the new assisted-correct test and existing `정답 → 통과 기록, 다음 복습 뒤로 밀림`.
- Solution viewing automatically marking help: guarded by existing `풀이 보기 → 분류 전 미저장, 완료 시 fail 1건만`.
- Trajectory becoming color-only or ambiguous: guarded by the new visible-mark and accessible-label test.

## Explicitly out of scope

- Renaming `ts` to `attemptedAt`.
- Removing existing attempt fields such as `answer`, `result`, `seconds`, `tags`, `memo`, or `source`.
- Changing the existing failure-cause classifier, execution gate, or append-only cause behavior.
- Retroactively inferring historical causes.
- Changing `RECHECK_DAYS`, `FAIL_RECHECK_DAYS`, or `App.jsx` scheduling logic.
- Treating “풀이 보기” itself as assistance.
- Adding an Attempt screen or workflow.
- Study/Practice/Test modes, help types, hint levels, timers, AI metadata, confidence, stroke data, or mastery analytics.
- Changing card-level cause/classification display.
- IndexedDB image storage or lifecycle changes.
- Any `v1` schema-number reconciliation or Master Plan v3 work.
