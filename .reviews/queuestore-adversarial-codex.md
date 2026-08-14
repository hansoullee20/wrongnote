[blocker] companion/src/queueStore.js:170 — stores cache independent snapshots with no inter-process lock or conflict detection, so successful operations can be overwritten — hold an exclusive file lock for the store lifetime, or lock each mutation, reread state, and commit with a generation/CAS check.  
Sequence: A and B open an empty queue. A successfully submits X. B’s stale `claim()` finds nothing but still writes its empty snapshot and returns `null`; X disappears from disk. Starting from one waiting item, A and B can also both claim it with different receipts, each return the payload, and overwrite each other’s lease or settlement. Nothing detects either race.

[high] companion/src/queueStore.js:92 — startup validates only the two arrays, accepting malformed records that become lost, poisonous, or incorrectly deduplicated — validate every record, state-dependent fields, timestamps, fingerprints, and cross-record uniqueness before returning from `readState`.  
Concrete accepted cases include:

- Missing/unknown `state` plus a valid fingerprint: `submit()` reports `duplicate: true`, while `claim()` skips the record forever.
- Waiting item missing `payload`: `claim()` selects it, then `clone(undefined)` throws; rollback restores it at the head, so every later waiting item is blocked.
- Leased item missing `leaseExpiresAt`, or containing `"bad"`: the comparison is false forever, so a dead owner’s item never returns.
- Missing `fingerprint`: after acceptance, an identical submission is not deduplicated and is delivered again.
- Accepted item missing or having an invalid `settledAt`: the next `submit()` prunes it immediately and permits redelivery.
- Two items sharing an ID: rejecting the first executes `filter(i => i.id !== item.id)`, silently deleting both while returning `"settled"`.
- Rejected record missing `payload`: `requeue()` returns `"requeued"`, after which every claim fails.
- `null` array elements make operations throw although startup reported success.

[high] companion/src/queueStore.js:367 — `requeue()` deletes the only dead-letter record and records no lifetime requeue marker, losing its error and permitting unlimited requeue cycles — retain an immutable dead-letter record with a durable `requeuedAt`/generation marker and reject subsequent requeues.  
Sequence: reject X with error E; `requeue(X)` splices away E; reject X again; `requeue(X)` succeeds again. The same rejected analysis can be delivered repeatedly, and its original rejection evidence is gone.

[high] companion/src/queueStore.js:327 — settlement expires and clears the caller’s receipt before checking it, so a note saved just across the lease boundary cannot be accepted and is re-delivered — make note creation idempotent by queue item ID and preserve late settlement until a newer lease exists.  
Sequence: claim X, save its note immediately after `leaseExpiresAt`, then call `settle(..., "accepted")`. `expireLeases()` clears the still-unreassigned receipt, settlement returns `"gone"`, and the next claim receives X again.

[high] companion/src/queueStore.js:231 — pruning accepted tombstones destroys the only durable identity used for dedupe — keep accepted fingerprints indefinitely in a compact dedupe index.  
Sequence: accept X, advance beyond `TOMBSTONE_MS`, then submit identical X. Pruning happens before duplicate lookup, so a new waiting ID is created and X is delivered after acceptance.

[high] companion/src/queueStore.js:112 — creating the queue directory is not made durable in its parent directory — when `mkdir` creates directories, fsync each affected parent before reporting success.  
Sequence: the queue directory does not exist; submit creates it, fsyncs the file and the new directory, and returns success. Power loss before the new directory entry reaches its parent can remove the entire directory and the successfully queued analysis.

[high] companion/src/queueStore.js:140 — `EACCES`/`EPERM` and unsupported directory fsync are treated as success even though rename durability was not established — use a platform-specific durable replacement or fail explicitly when the durability contract cannot be provided.  
Sequence: on a POSIX directory permitting write/execute but not read, rename succeeds and opening the directory returns `EACCES`; the method returns success. A power loss can then discard the rename. Windows and filesystems returning the other allowlisted errors have the same unacknowledged durability gap.

[high] companion/src/queueStore.js:28 — canonicalization is not equivalent to the payload’s serialized representation, producing false dedupe and lost analyses — snapshot through JSON first and hash that snapshot with a stable serializer that safely preserves every key, including `__proto__`.  
Sequence: two different `Date` payloads both canonicalize to `{}`, so the second submit reports duplicate although the first is durably stored as a different ISO string. Likewise, assigning an own `__proto__` key into `{}` invokes the prototype setter; different JSON payloads under that key all hash as `{}`.

[med] companion/src/queueStore.js:252 — `submit()` validates one serialization but fingerprints and clones the caller-owned object later on the queue microtask — derive size, fingerprint, and stored payload from one immutable snapshot captured before enqueueing.  
Sequence: call `submit({analysis:"A"})`, mutate the object to B in the same turn, then await the promise. The operation succeeds but stores B; A was never queued. Mutation to an oversized B also bypasses the size check performed on A.

[med] companion/src/queueStore.js:219 — wall-clock regression can make a dead consumer’s lease unreachable indefinitely — use monotonic elapsed time for live leases and explicitly rebase or invalidate persisted leases after clock regression/restart.  
Sequence: X is leased with expiry at wall time T+60s, then the system clock moves backward one year. Every other claimant sees an unexpired lease until the clock catches up. A forward jump conversely triggers the save/settle race above and can prematurely prune tombstones.

[med] companion/src/queueStore.js:127 — a post-rename directory-fsync failure remains an ambiguous commit that is exposed as live state despite the operation rejecting — fail-stop the instance after an uncertain commit and use item-ID-idempotent application writes or a recoverable journal.  
Sequence: the app saves X, accepted settlement is renamed, then directory fsync returns `EIO`. The caller receives an error while the store treats X as accepted. If power then loses the unflushed rename, restart sees the old lease and can deliver X again.

[med] companion/src/queueStore.js:290 — non-string consumer IDs are retained by reference inside committed state, allowing unpersisted mutation to poison the store — require a nonempty string consumer ID and never retain caller-owned objects.  
Sequence: claim with `{id:"tab"}`, then add a self-reference to that object. The successful claim’s live state becomes cyclic without a write; `list()` fails, and every later mutation fails during `clone(previous)` before lease expiry can run.

[med] companion/src/queueStore.js:113 — failed writes and failed renames leave uniquely named temporary files forever — unlink the temp file on every pre-rename failure and clean orphaned temps at startup while holding the store lock.  
Sequence: repeated rename or sync failures leave one full or partial temp file per attempt. They eventually consume the volume, after which existing waiting items cannot be claimed because even `claim()` requires another full atomic rewrite.

[low] companion/src/queueStore.js:355 — the dead-letter section has no count, byte, archival, or compaction bound, and every operation rewrites it in full — move retained dead letters to bounded immutable segments or apply admission control before accepting work that cannot be maintained.  
Sequence: repeatedly submit and reject distinct near-limit payloads. The main file grows indefinitely until a later claim or settlement cannot allocate its same-size temp copy; already queued work is then unreachable through the API until external disk intervention.

The single-instance serialization chain does correctly order well-formed operations across write awaits, and pre-rename failures restore the prior in-memory snapshot. Atomic rename also prevents a torn main JSON file. Those guarantees break at process boundaries, malformed records, caller-owned non-string IDs, and the durability cases above. Early-vs-save acceptance is not enforceable here: it holds only if the caller never sends `"accepted"` before the note is durably saved.

Verdict: block.
