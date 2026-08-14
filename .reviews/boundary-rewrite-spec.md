# Companion queue boundary rewrite — approved design

Base: `feat/schema-v8-failure-point` (`f9994d49b1ed232fccd8519d2c3133454d6cc2d9`).
The old `feat/companion-queue` / PR #16 is forensic evidence only; this rewrite does not inherit its implementation.

## Non-negotiable invariant

> No silent loss; at most one live browser consumer; accepted only after durable app save; any redelivery is detectable and idempotent.

The queue cannot guarantee application-level exactly-once by itself. The bridge event identity must later be stored on the Wrongnote note (commit 5), so a lost ACK/redelivery is harmless.

## Settled decisions

- **D1 — one browser session owns the queue.** Ownership is session-level, not per-item. A second live browser session gets `busy`.
- **D2 — producer idempotency key.** `eventId` is the identity. Equal payload bytes are not equal events. Reusing one eventId with different content is an idempotency conflict.
- **D3 — split identity ownership.** The companion permanently retains a compact accepted event index; Wrongnote later stores the same eventId on the saved note.
- **D4 — explicit degraded durability.** Unsupported directory fsync may produce `durability: degraded`; real I/O/permission failures are errors. `EACCES` is never classified as unsupported merely to keep the app running.
- **D5 — lease takeover with fencing.** Browser session ownership has a monotonically increasing fence. A takeover after expiry invalidates all old operations. Late settlement is still allowed after expiry if no takeover occurred.
- **D6 — permanent rejection evidence, compact historical payloads.** An unresolved dead letter keeps its payload. Requeue copies the payload into a new active item, keeps the rejection record, and compacts that historical payload only after the retry exists.
- **D7 — orphan temp files are quarantined, never silently deleted or merged.**
- **D8 — manual process-lock recovery.** Startup never automatically breaks a stale process lock. `doctor` reports lock path/holder and `unlock` removes only a definitively dead local holder. The queue file is never edited by recovery tooling.

## State model

Queue format v2 uses a new file (`ai-queue-v2.json`) so forensic v1 files cannot be mistaken for the rewritten format.

Top level:

```text
version
nextFence
session | null
items[]
accepted[]
rejected[]
```

A browser session owns at most one current delivery:

```text
session = {
  sessionId,
  fence,
  acquiredAt,
  renewedAt,
  expiresAt,
  delivery: null | { itemId, receipt, deliveredAt }
}
```

Items remain in `items` while delivered. The session delivery record is the lease. Takeover clears the old session record; the item therefore becomes deliverable again without reconstructing it.

## Producer identity

`submit(eventId, payload)` snapshots the payload before any queued async work. The payload must be a non-null plain JSON object. Dates, functions, NaN/Infinity, class instances and prototype-sensitive keys are rejected.

The content hash is diagnostic/integrity metadata only. It never decides whether two events are the same. The same eventId + same payload is a duplicate retry; same eventId + different payload is `idempotency_conflict`.

Every active, accepted and rejection-history record sharing an eventId must agree on the payload hash or startup fails as corrupt.

## Session/fence protocol

- `acquireSession(sessionId)` acquires only when there is no session, or takes over an expired session with a new fence.
- A live session cannot be renewed merely by repeating its textual sessionId; renewal requires `renewSession(sessionId, fence)`.
- `claim(sessionId, fence)` delivers at most one item. Reclaiming the same delivery returns the same receipt and renews the session.
- Expiry alone does not invalidate an old receipt. `settle` may still succeed after expiry if the same session/fence remains current.
- Once a takeover increments the fence, old operations return `stale_fence` and cannot settle anything.

## Settlement outcomes

The rewrite must not collapse recovery states into `gone`. It distinguishes at least:

- `no_session`
- `not_owner`
- `stale_fence`
- `receipt_mismatch`
- `not_found`
- `already_settled`
- `busy`
- `empty`

Accepted settlement removes the active payload and writes a permanent compact accepted record containing eventId, itemId, receipt, hash and timestamp.

Rejected settlement removes the active item and appends a dead-letter record with payload, error and timestamp. Requeue never erases that record.

## Process ownership

One queue file has one companion process owner. Acquisition uses atomic exclusive creation (`wx`). If the lock already exists, startup fails loudly. There is **no automatic stale-lock takeover** because check/unlink/create cannot be made atomic with this mechanism.

A failed lock acquisition must clean up a partial lock that it itself created. Normal release verifies its token before unlinking. Explicit manual unlock only removes a lock whose local PID is definitively dead.

## Durable write commit point

The persistence transaction is:

```text
candidate state
→ same-directory temp
→ write
→ file fsync
→ close
→ rename(temp, queue)     # commit point
→ directory fsync
```

Failures before rename leave the prior state authoritative in memory and on disk. Failures after rename keep the candidate in memory and propagate `committed_durability_uncertain`; the operation happened, but crash durability is unknown.

Unsupported directory-fsync capability is reported as degraded mode, not hidden. A process-death test is **not** evidence of power-loss durability.

Queue-directory creation is persisted ancestor-by-ancestor when the platform supports directory fsync.

## Corruption policy

Startup validates the complete durable shape, not only the top-level arrays. It rejects malformed individual items, sessions, accepted records and dead letters; duplicate IDs/receipts; missing payloads; inconsistent event hashes; live delivery pointing to a missing item; and unsupported queue versions.

A corrupt canonical queue is left byte-identical and startup fails. It is never replaced with an empty queue.

## Temp-file recovery

Only after the process lock is held and the canonical queue validates, same-queue orphan temp files are moved into a quarantine directory. They are not interpreted as committed work and are not deleted silently. Health reports the quarantined count.

## Test semantics

Tests are specifications, not evidence by themselves. They must cover at minimum:

- two processes cannot own one queue;
- one browser session owns the whole queue;
- takeover fencing and late settlement;
- producer idempotency and caller-object snapshotting;
- strict JSON payload rejection;
- accepted identity across restart;
- rejection evidence/requeue history;
- pre-rename rollback vs post-rename committed uncertainty;
- explicit degraded durability and hard `EACCES`/I/O failures;
- full record-level corruption refusal;
- orphan temp quarantine;
- manual lock recovery;
- clock regression cannot trigger early takeover.

After implementation, freeze the rewrite head and run a clean adversarial review over the boundary before approving commit 1.
