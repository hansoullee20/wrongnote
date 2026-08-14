# Boundary rewrite spec — queueStore + lockFile

Consolidates three adversarial passes:
- `.reviews/queuestore-adversarial-codex.md` (14 findings, pass 1)
- `.reviews/queuestore-adversarial-codex-2.md` (15 findings, voided run — both
  blockers independently verified against the code)
- `.reviews/boundary-failure-matrix-codex.md` (frozen 634d211, clean pass)

Plus nine defects found by the stop-gate during the fix-on-report loop.

STATUS: **awaiting Han's sign-off on the open decisions in §3 before any code.**

---

## 1. Settled — not up for re-litigation

- Direction, transport, `parseAiImport` as sole ingestion boundary: unchanged.
- **No automatic stale-lock takeover.** `open(..., "wx")` to acquire; if the lock
  exists, fail loudly; recovery is manual. No `flock` this cycle.
- Queue stays a JSON file with atomic rename.
- Invariant: *no silent loss; at most one live consumer; accepted only after
  durable app save; any redelivery is detectable and idempotent.*
- Accepted settles on app save, never on draft open. The queue cannot verify
  this — the app must not send `accepted` before the note is durable.

## 2. Confirmed defects the rewrite must not reproduce

Ordered by harm to a user with real study data.

1. **Multiple live consumers are possible.** `claim` hands *different* items to
   *different* consumer IDs concurrently. My earlier two-claimers test only
   proved two consumers cannot hold the *same* item; I reported "at most one
   live consumer" as verified on that basis and it was never true. Leases are
   per item; there is no consumer session or fencing epoch.
2. **A successful submit can store the wrong analysis, or poison startup.**
   Caller-owned payload is read at three different times (size check,
   fingerprint, clone); `canonicalize` is not equivalent to JSON serialization,
   so two distinct `Date` payloads hash identically and the second is silently
   suppressed; `submit(null)` writes a record that the reader then rejects,
   making the whole queue unopenable.
3. **Durability reported without being established.** `EACCES`/`EPERM` treated
   as "platform can't fsync directories"; the parent of a newly created queue
   directory is never synced; post-rename failure leaves an unlabelled
   indeterminate commit.
4. **No durable idempotent command results.** After a lost reply, `"gone"`
   conflates *already applied*, *never existed*, *expired*, *superseded* and
   *invalid*. A retry cannot learn what happened.
5. **Logical identity and outcome can contradict.** Requeue mints a new item ID;
   accepted tombstones and rejected records can coexist for one fingerprint;
   pruning a tombstone makes an old rejection authoritative again.
6. **Accepted state is not permanently observable** — tombstones expire, so the
   three-state model eventually has no record of acceptance.
7. **Malformed durable state is only partly validated** — fingerprint integrity,
   retry-graph coherence, expired owner/receipt pairing, timestamp ordering, and
   non-empty rejection reasons all pass startup today.
8. **Wall-clock leases** strand work when the clock moves back and authorise a
   second consumer when it moves forward.
9. **Resource exhaustion turns retained data into inaccessible data** — every
   mutation rewrites the whole file; dead letters, tombstones and orphan temps
   grow unbounded; `requeue` bypasses `MAX_ACTIVE_ITEMS`.
10. **Release/close can hide loss of lock ownership** — a missing or replaced
    lock file is reported as a successful release.

## 3. OPEN — these need Han, not a patch

Codex flagged each of these as a judgment call rather than a bug. I have a
recommendation for each but will not choose unilaterally.

**D1. Consumer exclusivity.** "At most one live consumer" currently means
per-item, not per-browser. Options: (a) keep per-item leases and accept that two
tabs can each hold a different analysis; (b) add a single consumer session — one
browser owns the queue at a time, others get nothing.
*Recommend (b)*: it is what the invariant actually says, and two tabs each
half-filling a different record is a real way to lose work.

**D2. Intentional duplicate submissions.** Content fingerprint is being used as
an idempotency key, so a genuinely intended second submission of identical
content is suppressed forever. Options: (a) keep content dedupe; (b) producer
idempotency key supplied by the host, content hash used only for diagnostics.
*Recommend (b)*, since the host retries are exactly what dedupe is for, and
identical content is not the same event.

**D3. Permanent accepted evidence.** "Redelivery is detectable" cannot be both
unbounded and finite-storage. Options: (a) compact permanent ID index in the
queue; (b) app owns permanent identity (the note carries the analysis ID) and
the queue keeps a bounded window.
*Recommend (b)* — it is already implied by your commit-5 ruling, and it puts the
permanent record where the permanent data lives.

**D4. Unprovable durability.** When directory fsync is impossible (`EACCES`,
Windows, some filesystems): fail the write, or run in a declared degraded mode?
*Recommend degraded mode, declared loudly at startup and surfaced in status* —
failing every write on Windows makes the companion unusable there.

**D5. Lease takeover vs fencing.** A lease timeout cannot prove the old consumer
stopped saving. Options: (a) keep automatic takeover and require app-side
fencing on the analysis ID; (b) no takeover — an expired lease needs manual
intervention.
*Recommend (a)* with fencing in commit 5, since (b) means a closed laptop lid
strands an analysis permanently.

**D6. Storage budget.** Dead letters are permanent by your ruling, which
conflicts with a bounded file. Options: (a) permanent but compacted (payload
dropped after N, reason kept); (b) permanent in full with a declared size cap
that refuses new work when hit.
*Recommend (a)*: the reason is what diagnoses; the payload is recoverable from
the host.

**D7. Orphan temp files.** A process that dies pre-rename leaves a temp file that
may contain the only copy of an attempted transition. Discard on startup, or
quarantine and report?
*Recommend discard with a logged count* — the transition was never committed and
the host can resubmit; quarantine invents a state nobody will inspect.

**D8. Manual recovery procedure.** Deleting auto-takeover means a crash leaves a
lock the user must remove. This is now a UX requirement, not just code: what
exactly does the user see and do? *Recommend: startup failure names the lock
path, the recorded pid/host, and the exact command, and states plainly that the
queue file must not be touched.*

## 4. Shape of the rewrite

Not code, but the decisions that must exist before code:

- **Identity model.** One logical analysis ID, stable across attempts. Distinct
  from: submission idempotency key, delivery receipt, retry attempt, payload
  fingerprint. Today these are conflated and that is the root of failure modes
  4, 5 and 6.
- **One current outcome per analysis**, with attempts as history. Requeue
  becomes "new attempt on the same analysis", not "new item".
- **Explicit store states**, including `durability-uncertain` after an
  ambiguous commit, which currently has no representation at all.
- **Command results that survive restart**: `already-applied` distinct from
  `unknown`/`expired`/`superseded`/`never-existed`.
- **Monotonic time for live leases**, with restart-aware rebasing.
- **Capacity enforced on every transition into waiting**, not only in `submit`.
- **One immutable JSON snapshot per submit**, taken synchronously, used for size
  check, fingerprint and storage alike.

## 5. Carried into commit 5 (app side)

The queue cannot enforce these; they must be built into the app:

- Save the note durably before sending `accepted`.
- Persist the logical analysis ID atomically with the note; unique index on it.
- On redelivery, look up that ID and return the existing note instead of
  creating a second.
- Never send `rejected` for an analysis whose note was saved.
- Surface stored rejection reasons — retention alone does not make them visible.
- Fence a superseded consumer at save time if D5 keeps automatic takeover.

## 6. Test debt to carry forward

Every existing regression test stays, with two corrections:

- The two-claimers test must be re-scoped: it proves same-item exclusivity, not
  the consumer-exclusivity invariant it was cited for.
- Process-restart tests retain the page cache and therefore cannot show
  directory-durability defects. They must be labelled as process-death tests,
  not crash-durability tests, so they are never cited as evidence again.
