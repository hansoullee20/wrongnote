===== v1 CONSOLIDATED review — Codex (gpt-5.6-sol, high) after DEBATE round 1 =====
inputs: .reviews/v1-review-codex.md + .reviews/v1-debate-claude.md

## Final findings

[blocker] src/aiBridge.js:27 — Free-form `topicMain`/`topicSub` bypass taxonomy validation; an unknown main crashes `ChipRow`, while an invalid pair persists — validate or drop the pair against `MATH_TOPICS`.

[high] src/views/RecordView.jsx:332 — Newly supported solution images are deleted before the note update is durably saved, risking permanent loss on persistence failure — delete removed blobs only after confirmed persistence.

[high] src/views/RecordView.jsx:467 — Solution input and paste paths permit concurrent compression, while save ignores `photo.busy`, silently omitting pending images — serialize attachment processing and gate attachment, navigation, and save actions.

[med] src/storage.js:51 — Newer stored/imported schema versions are migrated and rewritten as v6 without backup, potentially dropping future card fields — reject and lock versions above `SCHEMA_VERSION`.

[med] src/aiBridge.js:11 — Math taxonomy is sent for every subject; imported non-math topics persist and enter StatsView’s unfiltered topic matrix — include and accept taxonomy only for math records.

[med] src/aiBridge.js:32 — Requested `analysis.failurePoint` is discarded — map it to a reviewable field or remove it from the schema.

[med] src/aiBridge.js:29 — Imported concepts remain untrimmed and duplicated, splitting concept statistics — store trimmed unique strings.

[med] tests/ai-import.spec.js:4 — Coverage has only the happy AI-import path and lacks invalid taxonomy, malformed JSON, solution-photo edit, and locale-reload cases — add negative and round-trip tests.

[low] src/views/RecordView.jsx:219 — User-selected AI JSON has no size or field bounds and can stall or exhaust the tab — reject oversized files and bound imported fields.

[low] src/views/SettingsView.jsx:204 — Locale buttons expose selection only visually — add `aria-pressed`.

## Dropped / downgraded

- Topic validation: high → blocker — an ordinary free-form import can throw during core step-2 rendering.
- Delete-before-save: proposed deferral rejected — `v1` newly extends the known unsafe ordering to `solutionImages`.
- Newer-schema handling: high → med — the guard is missing, but v6 introduces no lossy card-field delta today.
- Non-math taxonomy: low downgrade rejected — StatsView includes every note’s `topicMain`, so the hidden value affects visible statistics.
- Unbounded JSON: med → low — ingestion requires an explicit local file selection.
- Concurrent compression: med → high — saving can silently discard a user-selected attachment.
- Separate `topicSub` finding: merged into the blocker — pair validation is required, but StatsView does not read `topicSub`.
- Missing ErrorBoundary: dropped — absence is verified but is generic crash containment, not an independent `v1` regression.

## Root cause

No single invariant covers all findings. The AI-import subset shares a better invariant: `buildChatGPTRequest`/`parseAiImport` accepts type-correct model output without enforcing field domains, normalization, bounds, or complete schema mapping. Photo concurrency, persistence ordering, migration compatibility, accessibility, and coverage are independent.

## Merge gate

- Must fix: topic-pair crash, attachment concurrency/save gating, solution-image delete-before-persistence, and regression tests for those paths.
- Follow-up tickets: newer-schema guard, subject-specific taxonomy, `failurePoint` wiring, concept normalization, remaining import coverage, JSON bounds, locale accessibility, and an app-level ErrorBoundary.

verdict: fix-then-merge
tokens used
113,379
## Final findings

[blocker] src/aiBridge.js:27 — Free-form `topicMain`/`topicSub` bypass taxonomy validation; an unknown main crashes `ChipRow`, while an invalid pair persists — validate or drop the pair against `MATH_TOPICS`.

[high] src/views/RecordView.jsx:332 — Newly supported solution images are deleted before the note update is durably saved, risking permanent loss on persistence failure — delete removed blobs only after confirmed persistence.

[high] src/views/RecordView.jsx:467 — Solution input and paste paths permit concurrent compression, while save ignores `photo.busy`, silently omitting pending images — serialize attachment processing and gate attachment, navigation, and save actions.

[med] src/storage.js:51 — Newer stored/imported schema versions are migrated and rewritten as v6 without backup, potentially dropping future card fields — reject and lock versions above `SCHEMA_VERSION`.

[med] src/aiBridge.js:11 — Math taxonomy is sent for every subject; imported non-math topics persist and enter StatsView’s unfiltered topic matrix — include and accept taxonomy only for math records.

[med] src/aiBridge.js:32 — Requested `analysis.failurePoint` is discarded — map it to a reviewable field or remove it from the schema.

[med] src/aiBridge.js:29 — Imported concepts remain untrimmed and duplicated, splitting concept statistics — store trimmed unique strings.
