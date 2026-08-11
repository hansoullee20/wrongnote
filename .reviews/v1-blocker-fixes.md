# v1 blocker + highs — planned by Codex, executed by Claude, reviewed by Codex

Branch: `release/schema-7-reconciliation`
Source findings: `.reviews/v1-consolidated.md` (never fixed before this)

## Why this was needed

The schema-7 merge pulled `v1` into the release branch, but `v1`'s
consolidated review carried an unfixed [blocker] and two [high]. `main`
deploys to Pages, so merging would have shipped them.

## Verdict: merge (after one [med] fix)

Codex review found one [med] — the rejection test passed even if the busy
path cleared `photo.busy`, the exact invariant being protected. Fixed and
falsified.

## Landed

- `15171b6` fix(ai-import): validate imported math topics against the taxonomy
- `863564e` fix(images): collect removed photos only after the note persists
- `f7bba41` fix(images): serialize attachment compression and gate save on it
- `+1` test: assert the rejected batch leaves the lock intact

## What the debate changed

Claude challenged the plan on 4 points; Codex classified them:

1. **CONFIRMED** — parse-time validation alone leaves the bug alive. Notes
   persisted by `v1` already hold invalid mains, and the crash is at the
   render site. Both layers landed; each falsified independently.
2. **PARTIAL — Claude was wrong.** `App.jsx` returns early when locked and
   when the write fails, so a drain placed after cannot delete blobs for an
   unpersisted removal. Only the spec was underspecified.
3. **PARTIAL** — silent paste rejection confirmed; the permanent-lock claim
   was overstated because `compressImage` swallows and returns the original.
4. **CONFIRMED** — remaining findings are non-blocking; `MATH_TOPICS[value]`
   indexing exists at exactly one site.

Codex caught three things Claude missed, the sharpest being that
busy-rejection feedback must not clear `photo.busy` or the feedback fix
reopens the concurrency window.

## Found while executing (not in either plan)

`URL.createObjectURL` sat inside a React updater closure, so it ran during
render — outside `addPhotoFiles`'s try. A throw there unmounted the tree
instead of surfacing as an attachment failure. Moved out; falsified.

Two tests were caught passing without exercising anything: the stored-bad-
taxonomy case used a main that turned out to be valid, and the exception
case had its trap consumed by an unrelated boot-time call.

## Still open — none block main

From `.reviews/v1-consolidated.md`: `aiBridge.js:11` non-math taxonomy,
`:32` discarded `failurePoint`, `:29` concepts trim/dedupe,
`RecordView.jsx:205` unbounded file read, `SettingsView.jsx:211` missing
`aria-pressed`. None crashes.

Separately, `App.jsx:270` note-deletion still deletes blobs before the
delete persists — the same class as `863564e`, marked Tier 2 in-code. The
queue infrastructure now exists, so routing it through `pendingImageDeletes`
would close it in roughly one line. Left out deliberately: out of the agreed
scope, and it is an independent fix that belongs in its own commit.
