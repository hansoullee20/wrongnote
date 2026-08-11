===== v1 DEBATE round 1 — Claude (opus-5) rebutting .reviews/v1-review-codex.md =====

Each Codex finding classified CONFIRMED / PARTIAL / REFUTED with code evidence,
followed by findings the reviewer missed.

## Rebuttals

[1] aiBridge.js:27 unvalidated topicMain — **CONFIRMED, escalate high -> blocker**
RecordView.jsx:669 `options={MATH_TOPICS[draft.topicMain]}`; ChipRow
(components.jsx:19) calls `options.map`. Any imported topicMain not an exact key
gives `undefined.map` -> throw during render. No ErrorBoundary exists anywhere in
src/ (grep componentDidCatch|ErrorBoundary = 0 hits), so the whole PWA
white-screens. ChatGPT free-forms this string, so it fires on ordinary use, not
on adversarial input. Reachable path: import JSON -> step 2 (분석) -> render.

[2] RecordView.jsx:332 delete-before-durable-save — **PARTIAL, not a v1 defect**
`main` already contains the identical ordering for `removed` (question images);
v1 only extends the same call to solution images. RecordView.jsx:320-325 is an
existing comment documenting this as a deliberate minimal mitigation, matching
App.deleteNote, with "근본 수정은 별도 Tier 2" written in. The invariant hazard is
real but pre-existing and already deferred. Route to the existing Tier 2 ticket;
do not gate v1 on it.

[3] migrate.js:5 no downgrade gate — **PARTIAL, pre-existing, no v6 loss**
Confirmed there is no `storedVersion > SCHEMA_VERSION` guard (storage.js:51-111)
and the pre-migration backup snapshot is skipped on downgrade because the
condition is `storedVersion < SCHEMA_VERSION` (storage.js:59). So an older build
rewrites newer data and stamps the version backwards, unbackedup. But the v6
delta specifically loses nothing: migrateNote returns `{...note, ...}` so unknown
note fields survive, and v6 adds no card fields, so migrateCard's whitelist drops
nothing today. This hazard has existed at every bump (v2..v6). Separate ticket,
not a v1 blocker.

[4] aiBridge.js:11 math taxonomy sent for every subject — **CONFIRMED, med -> low**
buildChatGPTRequest always appends topicList. A non-math note can come back with
topicMain/topicSub populated and they are stored, but the chips only render under
`isMath` (RecordView.jsx:652), so the value is invisible-but-persisted rather than
user-visible corruption. Cheap fix, low impact.

[5] aiBridge.js:32 failurePoint requested then discarded — **CONFIRMED**
buildChatGPTRequest asks for `analysis.failurePoint`; parseAiImport never reads
it. The intended destination already exists — RecordView.jsx has a
"내 풀이 — 실패 지점" field (htmlFor rec-mysol). This is missed wiring, not a nit:
the model spends tokens producing a field that is thrown away.

[6] aiBridge.js:29 concepts not trimmed/deduped — **CONFIRMED**
parseAiImport:29 and migrate.js:105 both filter on `.trim()` truthiness but store
the untrimmed string. The manual entry path in RecordView does
`.split(",").map(x => x.trim())`. Two entry paths, two normalizations ->
StatsView's concept map renders "극대" and " 극대" as separate bars, which is
exactly the statistic the feature exists to produce.

[7] RecordView.jsx:219 unbounded readAsText — **PARTIAL, med -> low**
Real, but the file is user-selected and local; there is no remote attacker and no
auto-ingest path. Worth a cheap size cap, not a merge gate.

[8] RecordView.jsx:467 concurrent compression — **CONFIRMED, and understated**
The question button is `disabled={photo.busy || submitting}` (:392), but the new
solution `<input type="file">` (:467) has no disabled guard and neither paste zone
checks photo.busy. Two concurrent addPhotoFiles runs share one `photo` state, so
the faster one clears busy while the other is still compressing. Worse: the save
button (:720) gates on `!canSave || submitting` and NOT on photo.busy, so a save
can land mid-compression and silently drop that photo from the note.

[9] SettingsView.jsx:204 missing aria-pressed — **CONFIRMED**
:147 (palette) and :183 (theme mode) both set aria-pressed; the new locale buttons
do not. Inconsistent with the codebase's own established pattern.

## Missed by the reviewer

[high] src/ (no file) — No ErrorBoundary anywhere in the app, so any render throw
unmounts the entire PWA with no recovery path — add a boundary around the tab
content that preserves the storage-locked banner.

[med] src/aiBridge.js:28 — topicSub is copied through unvalidated and never
cross-checked against MATH_TOPICS[topicMain], so a valid main plus a wrong sub
stores a garbage subtopic that StatsView groups on — validate the pair together.

[med] tests/ai-import.spec.js — Only the happy path is covered: no invalid
topicMain (the [1] crash), no malformed JSON error branch, no solution-photo edit
round-trip, no locale persistence across reload — add these before merge.

## Proposed root cause

Findings 1, 4, 5, 6 and both new aiBridge findings collapse into one broken
invariant: **parseAiImport is treated as a trust boundary for `cause` only.**
CAUSES.includes() is applied to cause and to nothing else, so every other field
from a free-form LLM response reaches React state and localStorage unvalidated.
Fixing that one invariant — validate or drop every field against the same
taxonomy the prompt advertises — resolves the blocker and three meds together.
Findings 2, 3 are pre-existing storage-lifecycle issues unrelated to that
invariant and should leave with v1 as separate tickets. Findings 8, 9 are
independent UI defects.
