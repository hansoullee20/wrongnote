# Wrongnote — ChatGPT → New Session Handoff
**Date:** 2026-08-12  
**Current workstream:** AI companion / reverse-MCP bridge, queue boundary rewrite  
**Repository:** `hansoullee20/wrongnote`  
**Production app:** `https://hansoullee20.github.io/wrongnote/`

---

## 0. Read this first

This handoff is intentionally detailed. The most important instruction for the next session is:

> **Do not resume by inventing a new architecture. Continue from the current frozen boundary-review state.**

The project has already gone through substantial adversarial review. The current companion queue implementation was **rewritten cleanly from the schema-v8 base** after the earlier implementation accumulated repeated failure-path bugs.

Current active development branch:

```text
feat/companion-boundary-rewrite
```

Current branch head at handoff:

```text
dc0bdf0221d0fbe78447ebdeb87f966147e6825e
```

Current draft PR:

```text
PR #17 — feat(companion): clean queue-boundary rewrite
base: feat/schema-v8-failure-point
head: feat/companion-boundary-rewrite
```

**Important:** PR #17 is a review boundary, not yet approved for merge.

The latest PR CI at `dc0bdf0` is green, including the companion tests. However, this does **not** mean commit 1 is approved. The next step is a **clean adversarial pass on the frozen head without editing while the review is running**.

---

# 1. Product context

Wrongnote is not meant to be a generic “wrong-answer notebook.”

The durable product model is:

```text
Problem → Attempt → Diagnose → Retry → Stabilize
```

The core learning idea is:

> A syllabus-linked, attempt-centered math learning system that measures the transition from assisted understanding to independent stable performance.

Important product principles:

- Attempt history is first-class.
- A problem can have multiple attempts, each with its own failure cause.
- A correct answer with help is **not** equivalent to an independent correct answer.
- AI is subordinate to the learning data model.
- Untrusted AI output must never directly become authoritative app state.
- The app is local-first.
- The UX should give the user one obvious next action.
- Autosave/resume and low-friction capture matter more than form completeness.
- The system should reduce working-memory burden, task switching, and review avoidance.
- PDF/web/AI imports are untrusted.
- AI must not receive unrestricted filesystem/database permissions.

Long-term product direction includes:

- Exam / Problem Library
- full-screen solution canvas
- Attempt / Mode engine
- syllabus graph
- review/mastery engine
- AI agent/tool interface

Do not let the companion work turn into a multi-week infrastructure project detached from actual study use.

---

# 2. Current production state

Production `main` is still the usable study app.

Current core product state before the companion rewrite:

- v2 core shipped
- schema v7 on production main
- PR #13 merged: AI analysis JSON import + schema-7 reconciliation
- PR #14 merged: deletion/photo persistence race fix
- attempt-level history exists
- per-attempt causes exist
- assisted-retirement gate exists
- manual AI import exists
- full-screen canvas does **not** exist yet
- direct AI/MCP connection does **not** exist yet

The current production AI workflow is still manual:

```text
Wrongnote
→ copy AI request
→ user runs ChatGPT/Claude externally
→ model returns JSON
→ user pastes/imports JSON into Wrongnote
```

Do not claim that the deployed app currently calls ChatGPT or Claude directly.

---

# 3. Schema v8 work

Schema v8 was created specifically to preserve `failurePoint` as a first-class note field.

Branch:

```text
feat/schema-v8-failure-point
```

Key commit:

```text
f9994d49b1ed232fccd8519d2c3133454d6cc2d9
```

This branch/commit is the base for the clean companion rewrite.

Schema-v8 changes:

- `SCHEMA_VERSION: 7 → 8`
- `failurePoint` promoted into note schema
- old notes get `failurePoint: ""`
- no guessing/inference during migration
- Record step 2 has editable failure-point field
- `startEdit` preserves it so reopening/saving does not wipe it
- downgrade-lock test corrected so “future schema” still means a genuinely higher version

This schema work was intentionally separated from the companion bridge.

PR #15 corresponds to this schema-v8 work and should remain conceptually separate from the queue boundary review.

---

# 4. AI bridge architecture — settled

The intended architecture is **not**:

```text
browser → OpenAI/Anthropic paid API
```

and not simply:

```text
browser → MCP → provider API
```

The intended architecture is a **reverse tool/MCP bridge**:

```text
Claude / ChatGPT
        ↓
Wrongnote companion / tool
        ↓
durable local queue
        ↓
localhost transport
        ↓
Wrongnote browser app
        ↓
parseAiImport()
        ↓
draft / AI Inbox
        ↓
user confirmation
        ↓
save
```

The purpose is to use the user’s existing ChatGPT/Claude model-client environment rather than introduce provider API keys and separate model API billing into Wrongnote.

Important limitation:

> A browser PWA cannot directly invoke a consumer ChatGPT/Claude subscription as if it were an API.

Therefore a local companion/tool boundary is required.

The **manual copy/paste bridge stays permanently** as the zero-infrastructure fallback.

---

# 5. Single AI trust boundary

`parseAiImport()` remains the single ingestion/trust boundary for AI-produced content.

Do not create provider-specific parsers.

All producers — manual JSON, Claude tool, future ChatGPT action/tool — should produce data that goes through the same parsing/validation path.

Provider-neutral ingestion is the architecture. MCP is only one producer.

---

# 6. Transport decision

The selected transport is:

```text
localhost polling
```

not File System Access API.

Why:

- cleaner process boundary
- avoids browser filesystem handle/permission semantics
- transport can remain separate from app schema and AI parsing

Intended shape:

```text
Claude MCP/tool
→ local companion
→ durable queue
→ localhost polling
→ Wrongnote
→ parseAiImport()
```

Important deployment risk for later commits:

```text
GitHub Pages HTTPS
→ http://127.0.0.1 companion
```

Private Network Access / CORS / preflight behavior must be handled explicitly and tested on the actual browser/device. Header-only automated tests are not enough.

---

# 7. Why commit 1 was rewritten

The first companion queue implementation lived in:

```text
feat/companion-queue
PR #16
```

It became a forensic branch because repeated independent review found failure-path defects.

Do not continue development on PR #16.

The recurring defect class was:

> **A failure path was treated as though it had succeeded, or a committed operation was later treated as though it had failed.**

Examples discovered across the old implementation included:

1. structurally corrupt queue arrays coerced to `[]`
2. rename not durably persisted
3. directory-fsync `EIO` swallowed
4. failed persistence leaving mutation committed in memory
5. post-rename success rolled back from memory
6. multi-process races
7. malformed individual records
8. requeue destroying rejection evidence
9. late settlement across lease expiry
10. stale-lock takeover race
11. per-item leases allowing multiple live browser consumers
12. caller-object TOCTOU
13. content canonicalization / false dedupe
14. ambiguous `"gone"` outcomes
15. additional lock/recovery defects

The accumulated evidence justified a clean rewrite.

---

# 8. Approved boundary rewrite contract

The approved design was frozen in:

```text
.reviews/boundary-rewrite-spec.md
```

The clean rewrite starts directly from:

```text
feat/schema-v8-failure-point
f9994d49...
```

and intentionally does **not** inherit PR #16’s implementation.

Core invariant:

> **No silent loss; at most one live browser consumer; accepted only after durable app save; any redelivery is detectable and idempotent.**

Important correction:

The queue alone cannot provide application-level exactly-once semantics.

The realistic contract is:

```text
No silent loss
+ at most one live browser consumer
+ accepted only after durable app save
+ redelivery detectable/idempotent
```

Commit 5 must persist the bridge `eventId` on the Wrongnote note so that a lost settlement ACK cannot create a duplicate note.

---

# 9. Settled design decisions D1–D8

## D1 — browser ownership

**One browser session owns the whole queue.**

Not per-item leases.

A second live browser session receives:

```text
busy
```

Ownership is tab/session scoped.

---

## D2 — producer identity

Use a producer-supplied idempotency key:

```text
eventId
```

Content equality is **not** event identity.

Rules:

- same `eventId` + same payload → duplicate retry
- same `eventId` + different payload → `idempotency_conflict`
- same payload + different `eventId` → distinct events

Payload hash is diagnostic/integrity metadata only.

---

## D3 — split identity ownership

The companion keeps a compact permanent accepted-event index.

Wrongnote later stores the same `eventId` on the saved note.

Therefore:

```text
companion → submission identity
Wrongnote → saved-note identity
```

This is required for idempotent redelivery.

---

## D4 — durability degradation

Unsupported directory fsync may result in:

```text
durability: degraded
```

But actual I/O / permission failures remain hard errors.

Do **not** classify generic `EACCES` as “unsupported.”

---

## D5 — lease takeover + fencing

Browser session ownership has a monotonically increasing fence.

A new session may take over after lease expiry.

Old browser operations with an old fence must fail as stale.

Important late-settlement rule:

> Lease expiry alone does not invalidate an existing receipt if no takeover has occurred.

Therefore a save that completes slightly after nominal expiry can still settle successfully if the same session/fence still owns the queue.

---

## D6 — rejection evidence

Rejected/dead-letter records must preserve evidence.

Requeue does **not** erase the rejection record.

Unresolved rejection keeps full payload.

After successful requeue, historical rejection payload may be compacted because the active retry now owns the payload.

The historical record still keeps diagnostic identity/linkage/error/timestamps.

---

## D7 — orphan temp files

Do not silently delete orphan temp files.

After:

1. process lock acquired
2. canonical queue validated

move same-queue orphan temp files into quarantine.

Never automatically merge them.

Health should report the count.

---

## D8 — lock recovery

No automatic stale process-lock takeover.

Startup uses atomic exclusive creation (`wx`).

If lock exists:

```text
fail loudly
```

Recovery is explicit:

```text
wrongnote-queue doctor
wrongnote-queue unlock
```

The queue file itself must never be edited as a lock-recovery action.

---

# 10. Current queue format

The rewrite intentionally uses a new file:

```text
ai-queue-v2.json
```

so old forensic v1 queue files cannot be mistaken for the new format.

Top-level state:

```text
version
nextFence
session | null
items[]
accepted[]
rejected[]
```

Browser session:

```text
session = {
  sessionId,
  fence,
  acquiredAt,
  renewedAt,
  expiresAt,
  delivery: null | {
    itemId,
    receipt,
    deliveredAt
  }
}
```

An active item remains in `items` while delivered.

The session’s `delivery` record is the ownership/lease record.

---

# 11. Settlement outcomes

Do not collapse outcomes into one generic `"gone"` state.

The protocol distinguishes at least:

```text
no_session
not_owner
stale_fence
receipt_mismatch
not_found
already_settled
busy
empty
lease_expired
```

plus normal success states such as:

```text
acquired
renewed
delivered
released
accepted
rejected
requeued
waiting
duplicate
idempotency_conflict
queue_full
```

This distinction is important because future HTTP/browser code must decide whether to retry, release, stop, or surface an error.

---

# 12. Persistence commit point

The durable write model is:

```text
candidate state
→ same-directory temp
→ write
→ file fsync
→ close
→ rename(temp, queue)     # commit point
→ directory fsync
```

Semantics:

### Failure before rename

```text
operation not committed
→ prior durable state remains authoritative
→ in-memory state must not advance
```

### Failure after rename

```text
operation is filesystem-visible
→ in-memory state keeps candidate
→ caller receives committed_durability_uncertain
```

That means:

> “It happened, but crash durability is uncertain.”

This uncertainty must not later be hidden by a no-op retry.

The current rewrite explicitly keeps uncertainty “sticky” until a later persistence step repairs it.

---

# 13. Current clean rewrite branch

Branch:

```text
feat/companion-boundary-rewrite
```

Current head:

```text
dc0bdf0221d0fbe78447ebdeb87f966147e6825e
```

PR:

```text
#17 — feat(companion): clean queue-boundary rewrite
draft
base: feat/schema-v8-failure-point
head: feat/companion-boundary-rewrite
```

Latest CI for this head completed successfully.

The PR CI now explicitly runs:

```text
npm --prefix companion test
```

This was added because the root Playwright suite did not execute the separate companion package.

---

# 14. What exists in the companion rewrite

The branch includes the companion package with files such as:

```text
companion/
  README.md
  package.json
  src/
    cli.js
    config.js
    errors.js
    jsonValue.js
    lockFile.js
    persistence.js
    queueStore.js
    state.js
  tests/
    ...
```

Important modules:

### `jsonValue.js`

Responsible for:

- strict plain-JSON payload validation
- rejecting Date/functions/non-finite values/class instances
- rejecting prototype-sensitive keys
- rejecting accessor properties
- rejecting sparse/odd arrays
- payload snapshot before queued async work
- canonical payload hashing

The key reason for snapshotting early:

> The producer’s caller object must not be read at multiple later times after it has potentially mutated.

---

### `state.js`

Responsible for complete durable state validation.

The validator does not merely check that `items` and `rejected` are arrays.

It validates:

- exact expected fields
- IDs
- timestamps
- payload hashes
- payload presence
- session/fence state
- unique item IDs
- unique receipts
- accepted identity
- retry/rejection linkage
- lifecycle consistency
- rejection-history graph integrity
- unsupported queue versions
- no active/accepted conflict

Important later fixes strengthened rejection lifecycle validation so that valid-looking JSON cannot form cycles/disconnected unrecoverable chains.

---

### `queueStore.js`

Responsible for:

- submit
- acquire session
- renew session
- claim
- settle
- release
- requeue
- health
- close
- serialized mutations
- copy-on-write transaction behavior
- durability state propagation

Current conceptual behavior:

```text
submit(eventId, payload)
→ snapshot payload immediately
→ serialized transaction
→ validate candidate
→ durable write
→ only then expose durable state
```

Post-rename commit uncertainty is preserved rather than flattened.

---

### `lockFile.js`

Current process-lock design:

- process lifetime lock
- atomic exclusive creation
- no automatic stale takeover
- token verification on release
- explicit dead-lock recovery
- recovery itself is serialized with a separate recovery guard

The recovery guard was added after an adversarial pass found that two concurrent manual unlock commands could otherwise both authorize stale deletion and delete a replacement owner’s lock.

---

### `persistence.js`

Responsible for:

- durable directory creation
- temp write
- file fsync
- rename
- directory fsync
- degraded capability reporting
- post-rename uncertainty
- orphan-temp quarantine

`EACCES` remains a real failure, not an unsupported-capability shortcut.

---

### `cli.js`

Recovery interface:

```text
wrongnote-queue doctor [queue-file]
wrongnote-queue unlock [queue-file]
```

It reports:

- queue path
- lock path
- lock holder
- recovery guard
- recovery guidance

and explicitly tells the user not to edit/delete the queue state file.

---

# 15. Adversarial passes already performed on rewrite

The clean rewrite was not simply written and declared done.

Several review/falsification rounds occurred.

## Rewrite initial implementation

Commit:

```text
dd4508ca83f521ef5f1fd53cc79abaa60ffaac5c
```

Implemented the clean boundary based on the approved failure model.

---

## Manual lock recovery race fix

Commit:

```text
5a1a62743b96ece1bf734c0795f54d4ddd77c103
```

Problem:

Two manual unlock commands could both authorize removal of the same dead lock; after the first removed it, a new owner could acquire, then the second stale unlink could delete the new owner’s lock.

Fix:

- separate atomic recovery guard
- process acquisition checks recovery guard
- only one recovery command may own guard
- crashed recovery remains visible/fail-closed

Also added companion test execution to PR CI.

---

## Sticky post-commit uncertainty fix

Commit:

```text
a731db4964d7176c708fa47eec8c08e58e63f016
```

Problem:

After a post-rename directory-fsync failure, retrying the same event could return ordinary `duplicate`, causing the caller to stop retrying even though durability remained uncertain.

Fix:

- no-change operations carry durability metadata
- while state is uncertain, no-op retry first re-persists current state
- successful repair clears uncertainty
- another failure remains loud

---

## Rejection lifecycle graph fix

Commit:

```text
9e0916b61ed1b12f0a2af6f452fa9c79f92e9cd1
```

Problem:

Individually valid rejected records could still form a cycle or disconnected unresolved heads.

This could produce structurally valid JSON but an unrecoverable event.

Fix:

Validate one linear lifecycle per event:

- one root
- one sink
- no cycles
- no disconnected components
- no two rejection records targeting one retry
- active retry links bidirectionally to the rejection that produced it

---

## Rejected-head lookup fix

Commit:

```text
fc266c0b9398fe4d3ddaad689ee3f4c3914e0cde
```

Problem:

Even after lifecycle validation stopped depending on array order, `submit()` still selected the last rejected array entry.

A reordered but valid rejection history could therefore report the wrong state.

Fix:

Select the unique unresolved rejection by linkage/state:

```text
requeuedItemId === null
```

not array position.

---

## Current head — remaining protocol ambiguity fixes

Commit:

```text
dc0bdf0221d0fbe78447ebdeb87f966147e6825e
```

This fixed five more boundary gaps:

1. rejected settlement could consume an item without a visible reason
2. future queue formats could be diagnosed as v2 shape corruption before version diagnosis
3. wall-clock rollback across process restart could shorten/rewrite a live lease incorrectly
4. retrying a successfully committed-but-uncertain session acquisition could return `busy` and hide the acquired fence
5. restart could forget post-rename uncertainty without syncing the existing canonical queue directory

Current local companion count reported at this head:

```text
34 companion tests
```

Current PR CI for this head is green.

---

# 16. IMPORTANT: test evidence interpretation

Do not overstate what the tests prove.

Earlier in development, “mutation-falsified” results were mistakenly treated as broad coverage.

Correct interpretation:

> Mutation tests prove that existing guards matter. They do not discover guards that were never conceived.

Likewise:

> Process-death / process-restart tests do not prove power-loss durability.

They can prove:

- restart behavior
- ordering
- persistence semantics under modeled failures

They do not prove physical media durability after sudden power loss.

Keep this distinction explicit.

---

# 17. Next step — do this first in the new session

The immediate next action is **not** implementation of commits 2–5.

First:

```text
FREEZE dc0bdf0221d0fbe78447ebdeb87f966147e6825e
```

Run one final clean adversarial pass against the frozen head.

Do not edit while the review is running.

The review should target at least:

```text
companion/src/queueStore.js
companion/src/lockFile.js
companion/src/persistence.js
companion/src/state.js
companion/src/jsonValue.js
```

Review prompt intent:

> Enumerate every failure boundary, race, stale-state path, malformed durable-state path, retry ambiguity, commit-point ambiguity, identity collision, lease/fence transition, lock/recovery path, and caller-visible outcome. Look specifically for any path where the operation partially fails or becomes ambiguous but the caller/store subsequently behaves as if it definitely succeeded or definitely failed.

Do not bias the reviewer with “34 tests green” as evidence.

The clean pass should derive the failure surface from the code.

---

# 18. Approval rule for commit 1

If the final clean adversarial pass on frozen `dc0bdf0` finds:

### No blocker/high correctness defects

Then:

```text
Commit 1 boundary can be approved.
```

After approval, proceed to commits 2–5.

### New blocker/high defect

Then:

1. fix it
2. add a focused regression/falsification test
3. freeze the new head
4. repeat a clean adversarial pass

Do not resume the old rapid “fix one report → immediately trust the branch” loop.

---

# 19. Planned commits after commit 1

The earlier implementation plan was approximately:

```text
Commit 0 — schema v8 / failurePoint
Commit 1 — durable companion queue boundary
Commit 2 — companion HTTP/localhost transport
Commit 3 — AI producer/tool integration
Commit 4 — browser polling / badge / draft ingestion
Commit 5 — accept-on-save + Wrongnote event-id persistence/idempotency
```

Exact commit labels can change, but the dependency order should remain.

---

# 20. Browser UX decisions already settled

Do **not** auto-open the record form when AI data arrives.

Original idea:

```text
AI result arrives → forcibly open record sheet
```

Rejected.

Approved UX:

```text
AI result arrives
→ show badge / ready indicator
→ user taps to open
```

Polling/draft initialization eligibility rule:

> Do not initialize AI draft while the record form is already open or being edited.

No UI hijacking while user is browsing/studying.

---

# 21. Malformed delivered AI payload behavior

Malformed model output must not silently disappear.

Approved terminal state:

```text
rejected / dead-letter
```

Retain:

- payload
- parse error
- timestamp
- identity

Do not:

- endlessly re-offer it every poll
- silently delete it
- convert it to successful ACK

It must remain requeueable through explicit recovery tooling.

Observable invariant:

> A successfully queued AI analysis must end in an observable waiting, accepted, or rejected state. It must never disappear silently.

---

# 22. Settlement timing — critical for commit 5

Earlier proposal:

```text
mark accepted when draft initializes
```

Rejected.

Correct rule:

```text
waiting
→ claimed/draft
→ Wrongnote durable note save succeeds
→ THEN accepted settlement
```

If user closes/cancels without saving:

```text
release → waiting
```

If browser dies during draft:

```text
lease expires
→ redelivery becomes possible
```

If note save succeeds but settlement response is lost:

```text
eventId stored on note
→ redelivery is detected
→ no duplicate note
```

This is why the event ID must cross the bridge into the app’s saved-note identity in commit 5.

---

# 23. Current real-world app usage observations

The user has begun using the deployed app on actual math problems.

Observed good behavior:

- attempt-level history works
- failed retries can record a different cause from earlier attempts
- trajectory is preserved (`✓*`, `×`, etc.)
- failure causes are stored per attempt
- next review moves after failures
- retry UX is lighter than initial problem capture

One UI/behavior issue observed:

A first retry was shown as:

```text
✓* 도움받은 통과
```

even though the screenshot appeared to show:

```text
도움 사용 → 아니오
```

Current main code reportedly maps `아니오 → assisted=false`, so the likely cause may be stale/cached deployed assets rather than current source logic.

This has not been conclusively resolved.

Do not casually rewrite assisted logic without reproducing against a cache-cleared/current build.

Another UX observation:

Problem-list filters/counts use the note’s representative/original `cause`, while later attempt causes remain in `attempt.cause`.

Therefore a later “시간 부족” failure may not change the top-level “시간” filter count.

That is currently a UX/design question, not necessarily a data-integrity bug.

---

# 24. AI import details from current app

Before the companion rewrite, `src/aiBridge.js` used `AI_IMPORT_VERSION = 1`.

Do not bump it merely because `subject` or `failurePoint` are added as optional fields.

Reason:

Version 1 JSON already exists in the manual fallback workflow.

A version bump would unnecessarily reject existing valid manual JSON.

The parser is the compatibility boundary.

Known historical issues:

- prompt requested `failurePoint` while parser dropped it — schema v8 addresses preservation
- prompt/manual bridge omitted typed question/work in some flow
- `concepts` normalization/dedupe may still warrant later cleanup
- topic validation crash was already fixed on main

---

# 25. Security / trust rules for future commits

When implementing HTTP/tool layers:

- bind companion to loopback only
- do not expose unrestricted filesystem
- do not give AI arbitrary DB access
- tool surface should be narrow
- model output remains untrusted
- app must still run parser validation
- malformed payloads go to rejected/dead-letter
- producer IDs are required
- do not let the HTTP layer flatten `committed_durability_uncertain` into an ordinary generic retryable 500 without preserving semantics
- stale fences must remain distinguishable
- `already_settled` must remain distinguishable from `not_found`
- browser transport must not fabricate queue state

---

# 26. PNA / CORS test requirement for later HTTP work

Later when localhost HTTP is added, explicitly test:

```text
GitHub Pages HTTPS
→ http://127.0.0.1 companion
```

Need:

- CORS
- OPTIONS/preflight
- Private Network Access behavior where applicable
- exact allowed origin strategy
- no wildcard trust if avoidable
- actual browser/device validation

Negative falsification should include deliberately removing the relevant access/preflight support and verifying that the real browser flow breaks.

Then restore it and verify the real flow works.

---

# 27. PR / branch map

Use this mental model:

```text
main
  └─ current production, schema 7

feat/schema-v8-failure-point
  └─ schema v8 / failurePoint
     commit f9994d49...
     PR #15

feat/companion-queue
  └─ OLD companion implementation
     PR #16
     FORENSIC ONLY — do not continue

feat/companion-boundary-rewrite
  └─ clean companion rewrite
     PR #17
     current head dc0bdf022...
     ACTIVE REVIEW BOUNDARY
```

---

# 28. Do not merge PR #17 yet

Even though:

- PR is mergeable
- CI is green
- companion suite is green

the agreed process is:

```text
final clean adversarial review
→ only then commit-1 approval
```

PR #17 should remain draft until that gate is satisfied.

---

# 29. Current status in one paragraph

The project is no longer deciding what MCP means. That architecture is settled. Schema v8 is separated cleanly, and the companion queue has been rewritten from scratch on top of it after the old implementation repeatedly failed adversarial review. The clean rewrite now enforces a single process owner, a single browser-session lease with fencing, producer event IDs, strict payload snapshotting, persistent accepted identity, dead-letter evidence, explicit commit-point semantics, degraded durability reporting, full state validation, temp quarantine, and manual lock recovery. Multiple clean-pass findings have already been fixed. The current frozen review target should be `dc0bdf0221d0fbe78447ebdeb87f966147e6825e` on PR #17. The next session should perform one final adversarial pass on that exact head, without editing during review, and only then decide whether commit 1 is approved and whether to proceed to the localhost HTTP/browser/tool commits.

---

# 30. Recommended first message to the next session

You can paste this:

> Continue the Wrongnote companion work from the handoff. Do not redesign the architecture. The active review target is PR #17, branch `feat/companion-boundary-rewrite`, frozen head `dc0bdf0221d0fbe78447ebdeb87f966147e6825e`, based on schema-v8 `f9994d49...`. First verify that exact head still exists, then run a clean adversarial review of the companion boundary without editing anything while reviewing. Focus on queueStore.js, lockFile.js, persistence.js, state.js and jsonValue.js. Commit 1 is not approved yet even though CI is green. If no blocker/high correctness defect remains, approve commit 1 and proceed to commits 2–5. If a blocker/high remains, fix it, add a falsifying regression test, freeze the new head and repeat the clean pass.

---

# 31. Final “do / don’t” list

## Do

- verify GitHub head before acting
- review exact frozen SHA
- preserve `parseAiImport()` as the single AI ingestion boundary
- preserve manual JSON fallback
- keep producer `eventId`
- preserve dead-letter history
- settle accepted only after durable Wrongnote save
- persist `eventId` into the saved note in commit 5
- keep session fencing
- keep one live browser consumer
- keep lock recovery explicit
- keep uncertainty explicit
- keep companion tests in PR CI
- use real-browser PNA/CORS validation later

## Don’t

- continue PR #16
- declare green tests equivalent to correctness
- claim process-death tests prove power-loss durability
- collapse distinct protocol outcomes into `gone`
- silently delete malformed queue state
- silently delete dead letters
- silently delete orphan temp files
- auto-open record UI when AI data arrives
- mark accepted when draft opens
- add paid provider API dependencies to Wrongnote
- let AI bypass `parseAiImport()`
- merge PR #17 before the final clean adversarial pass

---

**End of handoff.**
