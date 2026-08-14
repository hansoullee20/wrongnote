[blocker] companion/src/queueStore.js:424 — `settle` accepts missing/non-string identities, and the expired-lease fallback matches every fresh waiting item whose `expiredReceipt`/`expiredOwner` are both absent — require non-empty string `consumerId` and `receipt`, and only search explicitly valid expired-receipt pairs.  
Sequence: `submit(X)` creates no `expiredReceipt`; `settle(undefined, undefined, "accepted")` matches X, returns `"settled"`, erases its payload, and marks it accepted although it was never claimed or saved.

[blocker] companion/src/lockFile.js:103 — stale-lock reclamation has a check/unlink race, so two contenders can both acquire the same queue — replace unlink-based takeover with an OS advisory lock or atomic inode/token-verified takeover.  
Sequence: A and B read the same dead holder; A unlinks it and creates its lock; B then executes its already-authorized unlink, deleting A’s new lock, and creates its own. Both stores read the same snapshot. A submits X successfully; B submits Y successfully from its stale snapshot; disk ends with only Y. Nothing detects X’s loss.

[high] companion/src/queueStore.js:147 — record validation accepts any non-empty fingerprint without verifying it against the payload — recompute fingerprints for payload-bearing records and retain verifiable canonical material for accepted tombstones.  
Sequence: a valid-JSON waiting record contains payload A but fingerprint `hash(B)`; startup succeeds, `submit(B)` reports it as a duplicate, and only A can be claimed. Conversely, an accepted record with fingerprint `"wrong"` starts cleanly and allows its already-accepted payload to be submitted and delivered again.

[high] companion/src/queueStore.js:346 — runtime submission accepts JSON values that its own startup validator rejects — validate the normalized payload before committing, at minimum rejecting `null` and non-analysis roots.  
Sequence: `submit(null)` or `submit(NaN)` succeeds and writes a waiting item with `payload: null`; after a clean close, reopening fails at record validation, making the entire queue unreachable.

[high] companion/src/queueStore.js:36 — canonicalization is not equivalent to JSON serialization, causing false dedupe — normalize through JSON once, then apply a prototype-safe stable serializer to that normalized value.  
Sequence: two distinct `Date` values both canonicalize to `{}`, although they persist as different ISO strings; the second submission returns `duplicate: true` and is lost. Own `__proto__` properties are similarly erased by assignment into `{}`.

[med] companion/src/queueStore.js:346 — size validation, fingerprinting, and persistence read the caller-owned payload at different times — synchronously capture one immutable JSON snapshot and derive size, fingerprint, and stored payload exclusively from it.  
Sequence: call `submit({analysis:"A"})`, then mutate the object before the queued callback runs; the call succeeds but stores B instead of A. Changing it from a small object to a value over `MAX_PAYLOAD_BYTES` also bypasses the size limit.

[high] companion/src/queueStore.js:323 — pruning accepted tombstones destroys the only accepted identity — keep accepted fingerprints indefinitely in a compact durable index.  
Sequence: accept X, advance beyond `tombstoneMs`, then submit X; pruning runs before dedupe, removes X’s identity, and queues it for delivery again. If X was accepted after a rejection/requeue, the retained old rejection instead makes the accepted analysis permanently report `"rejected"`.

[med] companion/src/queueStore.js:306 — wall-clock lease deadlines can make dead items unreachable or prematurely create competing deliveries — detect clock regression and use a restart-aware monotonic/rebased lease scheme.  
Sequence: lease X and move the wall clock backward one year; every other `claim` returns `null` until time catches up. A forward jump expires a still-active consumer, lets B claim X, and invalidates A’s late settlement once B clears the expired receipt.

[med] companion/src/queueStore.js:231 — `leaseMs` is not validated before being persisted into a deadline — require a positive finite numeric lease duration at store creation.  
Sequence: create with `leaseMs: NaN`, submit and claim X; claim succeeds, in-memory expiry comparisons remain false forever, and JSON persists the deadline as `null`, so a restart rejects the queue file.

[high] companion/src/queueStore.js:191 — after rename succeeds but directory fsync fails, the operation rejects while the store continues serving the candidate as committed — poison the instance after an ambiguous commit and refuse further operations until durability is reconciled.  
Sequence: submit X; rename succeeds; directory sync returns `EIO`; submit rejects, but `list()` immediately exposes X and `claim()` can deliver it. Power loss can then discard the unflushed rename, contradicting both the caller’s failure and the live store’s state.

[high] companion/src/queueStore.js:214 — `EACCES`, `EPERM`, and every “unsupported directory fsync” case are treated as durable success — only return success after an actual durable platform-specific replace, otherwise fail explicitly.  
Sequence: the file write and rename succeed but opening/syncing the directory returns `EACCES`; `submit` resolves successfully although the rename is not known durable, and a power loss can silently remove it.

[high] companion/src/queueStore.js:242 — creation of a new queue directory is never made durable in its parent — fsync every parent whose directory entry was newly created before reporting the first queue write successful.  
Sequence: first startup creates `.wrongnote`, submission fsyncs the queue file and `.wrongnote` itself, but not the directory containing `.wrongnote`; power loss may remove the new directory entry and every successfully reported item with it.

[med] companion/src/queueStore.js:183 — pre-rename failures leak uniquely named temporary files — unlink the temporary path on every pre-rename exit.  
Sequence: repeated write, sync, close, or rename failures leave one partial/full temp file each; they eventually consume blocks or inodes, after which even claiming existing work fails because every claim requires another full rewrite.

[med] companion/src/queueStore.js:166 — retry metadata and relationships are unvalidated, and `requeue` relies on truthiness rather than a valid state transition — validate `requeuedAt`, `retryItemId`, `originRejectionId`, and retry-chain consistency, and reject an active fingerprint duplicate.  
Sequence: a rejected record with `requeuedAt: "corrupt"` and no retry starts cleanly but can never be requeued. Alternatively, two unmarked rejected records sharing a fingerprint can both be requeued successfully and delivered twice.

[med] companion/src/queueStore.js:474 — dead letters are unbounded, and `requeue` bypasses `MAX_ACTIVE_ITEMS` — move permanent rejection history to bounded/segmented archival storage and enforce the active limit during requeue.  
Sequence: repeatedly submit and reject distinct near-limit payloads; `rejected` and every atomic rewrite grow indefinitely. Requeueing accumulated records can also create arbitrarily more than 100 active items. Eventually a temp copy cannot be allocated, leaving existing waiting work inaccessible until external disk cleanup.

The following defenses do hold for well-formed input: missing/unknown `state`, missing/non-string `fingerprint`, missing/null active payloads, invalid leased `leaseExpiresAt`, duplicate IDs, and duplicate receipts fail startup without rewriting the queue file. The in-process chain serializes mutations, pre-rename failures restore the previous state, and an uncontested lock prevents an ordinary second instance. They break at the validation holes, stale-lock takeover, post-rename ambiguity, and resource exhaustion above. “Accepted only after note save” remains caller-enforced: this module accepts any holder’s `"accepted"` assertion without proof of a durable note.

Verdict: block.
