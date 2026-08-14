# Triage — Codex adversarial pass on queueStore.js

Findings: `.reviews/queuestore-adversarial-codex.md`. Verdict: block.
This is my assessment of them, for Han's scope ruling. Nothing fixed yet.

Caveat: I was running mutation experiments on the file while Codex read it, so
its line numbers may reference intermediate states. I verified the consequential
findings against the current head (b6cbd49) directly; they hold.

## Confirmed, and they break invariants Han already ruled on

**A. Multi-process races [blocker].** No lock, no CAS. Two stores read the same
state and overwrite each other: A submits X, B's stale `claim()` writes its own
empty snapshot and X is gone from disk. Both can also claim the same item with
different receipts. This is Han's target 2, confirmed, and it matters
specifically because MCP hosts commonly spawn their own server process — so
"there will only be one process" is an assumption the code does not enforce.
Fix is architectural: exclusive lockfile held for the store lifetime, or
re-read + generation/CAS per mutation.

**B. Malformed individual records [high].** Han's target 1, confirmed, with
concrete cases. The worst are not "fails loudly" but "starts clean and then
misbehaves forever":
- item with a valid fingerprint but unknown `state` → `submit` reports duplicate
  while `claim` skips it permanently. The analysis is unreachable and
  un-resubmittable.
- waiting item with no `payload` → `claim` throws on `clone(undefined)`, rollback
  puts it back at the head, every later item is blocked behind it.
- two items sharing an `id` → rejecting one runs `filter(i => i.id !== item.id)`
  and silently deletes both while returning `"settled"`.

**C. `requeue` destroys the rejection evidence and can cycle forever [high].**
`splice` removes the dead-letter record, so the error text Han explicitly
required to be retained is gone after one requeue. And reject → requeue →
reject → requeue repeats without limit. This directly contradicts his ruling
("payload + parse error + timestamp retained", "explicitly requeueable",
requeue exactly once). My test only proved requeue-twice-on-the-same-entry
returns `gone`; it never exercised the reject/requeue cycle.

**D. Late settlement across the lease boundary [high].** `settle` calls
`expireLeases()` before checking the receipt, so a note saved just after expiry
cannot be accepted: the receipt is already cleared, settle returns `"gone"`, and
the item is delivered again. This is an exactly-once violation on the exact path
Han's Q3 ruling exists to protect — the app saved the note, and the queue
redelivers it anyway.

## Confirmed, lower urgency

- **E. Tombstone pruning destroys dedupe identity [high].** After 24h an
  identical resubmit is delivered again despite having been accepted.
- **F. `mkdir` parent not fsynced [high].** Same class as the earlier directory
  fsync finding, one level up.
- **G. `EACCES`/`EPERM` tolerated as platform limits [high].** On POSIX these are
  permission configuration, not platform limitation, so durability is silently
  unestablished. My allowlist is too broad.
- **H. Canonicalization ≠ payload representation [high].** Two different `Date`
  payloads both canonicalize to `{}` and false-dedupe; an own `__proto__` key
  hits the prototype setter. Fingerprint the JSON snapshot, not the caller's
  object.
- **I. TOCTOU on the caller's object [med].** Size is validated on one
  serialization; fingerprint and stored payload are derived later, after the
  caller can mutate it.
- **J. Non-string `consumerId` retained by reference [med].** A caller can make
  committed state cyclic without any write, after which every mutation fails.
- **K. Temp files leak on every failed write [med].**
- **L. Clock regression makes a lease unreachable [med].**
- **M. Post-rename ambiguous commit [med].** The residue of b6cbd49: the caller
  gets an error while the store treats the change as applied, and if power loss
  then discards the rename, restart disagrees. Codex wants fail-stop.
- **N. Dead-letter unbounded [low].** By design and Han-approved, but nothing
  compacts it and every operation rewrites it whole.

## What Codex says actually holds

Single-instance ordering across write awaits, pre-rename rollback, and torn-file
prevention via atomic rename. It also notes accept-on-save is not enforceable
inside the store — it holds only if the caller never sends `"accepted"` before
the note is durably saved. That is correct and worth carrying into commit 5:
the store cannot defend that invariant, only the app can.

## Recommendation

A–D before any sign-off. They break rulings Han has already made, and C and D
are contradictions of his own stated acceptance criteria rather than
nice-to-haves.

E–N are real but are a second round. Bundling fourteen fixes into the commit
under review would produce exactly the reviewability problem the semantic-commit
rule exists to prevent.

Open question for Han: A is architectural. An exclusive lockfile is the small
answer; per-mutation CAS is the robust one. This is the first finding in this
work that changes the shape of the component rather than patching a path.
