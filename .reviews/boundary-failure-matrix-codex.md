## Failure matrix

Legend: `Q0` = last committed queue; `Q1` = proposed queue; `T` = orphan temp; `L` = lock file; `M0/M1` = matching in-memory snapshots. After any process death, `L` remains. The rewrite intentionally must refuse startup until a human verifies the old process is dead and removes only `L`. Queue recovery below assumes that step has happened.

### Shared atomic-write path

These rows apply to `submit`, `claim`, every `settle` outcome, and `requeue` through [writeStateAtomic](/home/hansoullee20/dev/projects/wrongnote/companion/src/queueStore.js:180).

| operation | failure point | durable on-disk state | in-memory state | caller-visible result | state after restart |
|---|---|---|---|---|---|
| All mutations | `mkdir`/temp `open` fails | `Q0` | rolled back to `M0` | Error; correctly not applied | `Q0` |
| All mutations | serialization or temp write fails | `Q0`; partial/empty `T` remains | `M0` | Error, sometimes masked by a later `close` error | `Q0`; `T` is invisible and accumulates. Required: preserve primary error and expose/quarantine or safely remove `T`. |
| All mutations | temp-file `fsync` fails | `Q0`; full or partial `T` remains | `M0` | Error; correctly not committed | `Q0`; temp leak remains |
| All mutations | temp-handle `close` fails after successful sync | `Q0`; durable `T` remains | `M0` | Error | `Q0`. **Decision:** stop before rename, as today, or treat close failure as a health error after proving the fd is no longer usable. |
| All mutations | rename reports failure | Usually `Q0` plus `T` | `M0` | Reported “not applied” | Usually `Q0`. On filesystems with indeterminate I/O errors, rename may actually have applied; the format has no revision/operation ID with which to reconcile. Required: verify the committed generation or fail-stop. |
| All mutations | process dies before rename | `Q0`; possibly valid `T` containing the only copy of the attempted transition | process gone | No result | Startup blocked by `L`; after manual unlock, current code ignores `T` and uses `Q0`. **Decision:** orphan candidates must be quarantined/inspected or discarded by an explicit policy, never silently accumulated. |
| All mutations | rename succeeds; directory open/sync returns `EIO`, `ENOSPC`, etc. | Namespace shows `Q1`, but crash durability is indeterminate | retained as `M1` | Error with an undocumented `appliedToDisk` property | Process restart normally sees `Q1`; power loss may expose `Q0`, `Q1`, or no file on first creation. Required: return an explicit indeterminate result and poison/reconcile the store before more work. |
| All mutations | directory open/sync returns allowlisted `EACCES`, `EPERM`, `EINVAL`, etc. | `Q1`, durability unproved | `M1` | **Success** | May regress after power loss. Wrong: permission errors and unsupported durability are treated as durable success. **Decision:** fail startup/write or enter a prominently declared degraded mode. |
| All mutations | process dies after rename, before directory sync | `Q1` visible but not proven durable | process gone | No result | Process-only restart normally sees `Q1`; power loss is indeterminate. Retry must be keyed by a durable operation ID. |
| All mutations | process dies after directory sync, before reply | `Q1` durable | process gone | No result | `Q1`. Current retries often return `duplicate` or `gone`, not the original result. Required: idempotently reproduce the committed result. |
| All mutations | repeated exhaustion/failure | `Q0` plus unbounded `T`s | normally `M0` | Repeated errors | Eventually no mutation can allocate a full replacement file; even waiting items cannot be claimed. Existing data remains but is operationally inaccessible. |

The queue directory itself is created without syncing its entry in its parent at [createQueueStore](/home/hansoullee20/dev/projects/wrongnote/companion/src/queueStore.js:242). Consequently, even a successfully synced first queue file can disappear with the newly created directory after power loss.

### Operation-specific paths

| operation | failure point | durable on-disk state | in-memory state | caller-visible result | state after restart |
|---|---|---|---|---|---|
| Acquire | live `L` already exists | Queue untouched; `L` retained | no store | Loud `EEXIST`-derived error | Still blocked. This is the required rewrite behavior. |
| Acquire | two current contenders see a reclaimable stale lock | One contender can unlink the other’s newly created `L` | both believe they own the queue | Both may succeed | Last queue rename wins; successful analyses can disappear. Delete all automatic reclaim logic. |
| Acquire | concurrent acquisition in the same process | Second call can see the first token before `heldTokens.add`, classify it as leaked, and unlink it | two live stores | Both may succeed | Lost updates possible |
| Acquire | failure after successful `"wx"` open: write, file sync, or close | Empty, partial, or complete `L`; queue untouched | no returned lock; token usually unregistered | Error | Partial JSON blocks forever; complete same-host metadata may be automatically reclaimed today. Required: always require manual recovery after death. **Decision:** on a synchronous failure, best-effort unlink is safe because this call created the inode, but cleanup failure must remain visible. |
| Acquire | process death at any step | Partial or complete `L`; queue remains `Q0` | none | No result | Current behavior varies by how much valid metadata was written; rewrite must consistently fail loudly. Recovery: verify no companion is alive, back up queue/temps, delete only `.lock`, reopen. |
| Acquire | queue file malformed after lock acquisition | Malformed queue untouched | no store | Usually the parse/validation error | If lock release also fails, its error replaces the malformed-file error. Required: preserve both, with corruption as the primary cause. |
| Acquire | malformed record that passes validation | Bad state is accepted | loaded into memory | Startup succeeds as if valid | Later operations misbehave or the next restart fails. Unchecked fields include fingerprint correctness, expired owner/receipt coherence, retry metadata, timestamps/order, and rejection reason. |
| Release | lock read fails | `L` unchanged | token retained | Error; retry remains possible | Still blocked. Correct today. |
| Release | lock is missing or token differs | Missing or another owner’s `L` | token silently forgotten | **Success** | Ownership loss is hidden. Required: idempotent success only after this handle previously completed release; otherwise raise an ownership-integrity error. |
| Release | lock is replaced between token read and unlink | Replacement `L` is deleted | old owner believes release succeeded; new owner still believes it owns | Success | A third owner can acquire while the second remains live. No path-based unlink can survive hostile/manual replacement; manual recovery must require stopping the old owner first. |
| Release | unlink fails | `L` remains | token retained | Error | Retry works; correct today |
| Release | unlink succeeds but directory entry is not synced | `L` appears gone; removal not crash-durable | token deleted | Success | After power loss a stale `L` may reappear. This causes loud unavailability, not queue loss; decide whether graceful release must fsync the directory. |
| Submit | caller mutates payload after calling `submit` | `Q1` contains the later value, possibly over the size limit | same later value | Success for a different payload than was validated | Later value persists. Required: create one immutable JSON snapshot before enqueueing. |
| Submit | JSON normalization differs from `canonicalize` | One payload stored; a distinct payload may hash identically | first item retained | Second submission reports `duplicate` | Second analysis never exists. `Date` values and own `__proto__` keys are concrete cases. Hash the normalized stored representation. |
| Submit | `null`, `NaN`, or infinity | A waiting record with `payload: null` is written | store continues operating | **Success** | Startup rejects the entire queue because its own validator forbids null active payloads. Runtime admission must enforce the durable schema. |
| Submit | existing fingerprint is malformed or does not match payload | Existing record retained | same | Wrong `duplicate` or missed duplicate | Wrong identity remains authoritative. Payload-bearing hashes must be recomputed; accepted identities need independently verifiable canonical material. |
| Submit | identical content is intentionally submitted twice | One record only | one record | Second call reports `duplicate` | Second user intent is permanently suppressed. **Decision:** distinguish producer idempotency key from content fingerprint; identical content is not necessarily the same submission. |
| Submit | accepted tombstone ages out or clock jumps forward | Tombstone removed; new ID queued, or an old rejection becomes authoritative | same | New waiting item or `"rejected"` duplicate | Accepted state is no longer observable. Permanent detectability requires a compact durable identity index or an app-owned idempotency key. |
| Submit | queue is full | `Q0` | `M0` | Loud error | Correct backpressure, but only this entry point enforces the limit |
| Claim | different consumer IDs call concurrently | Multiple items become leased to different browsers | multiple live leases | Every caller succeeds | Multiple live consumers survive until lease expiry. Direct violation of “at most one live consumer.” |
| Claim | same consumer ID calls concurrently | Both callers receive the same payload and receipt | one lease, two active handlers | Both succeed | Duplicate app work is possible; caller-chosen ID is not an exclusive session. |
| Claim | commit succeeds but response is lost/process dies | Item is durably leased although no browser received it | `M1` or process gone | Error/no result | Item stalls until expiry; retry by the same consumer can recover it. Backward clock movement can make the stall effectively permanent. |
| Claim | wall clock jumps forward | Live lease becomes waiting and can be given to another consumer | old consumer may still be working; new lease exists | New claim succeeds | Both can save. A timeout cannot prove the old consumer stopped; fencing must be enforced at app save or strict takeover must be sacrificed. |
| Claim | wall clock moves backward | Lease remains “live” far beyond `leaseMs` | no claimant can reach item | `null` or another item | Item remains stuck until wall time catches up. Use monotonic live-process time plus explicit restart recovery semantics. |
| Claim | no item exists | Queue is rewritten anyway | unchanged except expiry effects | `null`, unless the unnecessary write fails | Same queue. Required: do not write for a true no-op. |
| Settle—accepted | caller sends accepted before durable app save | Tombstone replaces payload | accepted in memory | `"settled"` | Analysis is irrecoverably treated as saved. The queue cannot verify this; the app must enforce save-before-ACK. |
| Settle—accepted | accepted commit/reply is uncertain, then retried | Tombstone may exist; receipt was erased | accepted or old lease | Error, then `"gone"` | `"gone"` cannot distinguish committed acceptance from invalid/stale receipt. Required: durable idempotent settlement result keyed by transition/receipt. |
| Settle—accepted | accepted tombstone is pruned | No queue evidence of acceptance | removed | Later submit may look new or rejected | Accepted ceases to be one of the three observable states. |
| Settle—rejected | error omitted, empty, or falsey | Dead letter with `error: ""` | rejected record | `"settled"` | Rejection exists without a visible reason. Require a non-empty bounded reason or synthesize a system reason. |
| Settle—rejected | commit succeeds but response is lost | Dead letter exists; receipt erased | rejected | Error/no result; retry returns `"gone"` | Rejection is recoverable through `listRejected`, but settlement result is ambiguous. |
| Settle—released | release races accepted/rejected for one receipt | First serialized outcome wins | winner’s state | Loser receives `"gone"` | If release wins after the app saved, the item is redelivered. Same item ID makes this detectable, but only app idempotency makes it harmless. |
| All settle outcomes | lease expired but not reassigned | Existing item becomes waiting with old receipt retained | late settlement can still win | `"settled"` | Correct today |
| All settle outcomes | lease expired and another claim cleared the old receipt | New lease persists | old consumer may still have saved | `"gone"` | Duplicate/save-state conflict is possible. **Decision:** safety requires app-side fencing; availability favors allowing takeover. |
| Requeue | active queue already at limit | New waiting item is appended anyway | active count exceeds configured maximum | `"requeued"` | Oversized active queue persists. Enforce capacity on every transition into waiting. |
| Requeue | committed result is lost/retried | Retry item and markers exist | same | Error, then `"gone"` | History contains `retryItemId`, but caller cannot distinguish already-applied from unknown ID. |
| Requeue | old rejection, retry, and later acceptance share a fingerprint | Rejected history and accepted tombstone coexist | active lookup temporarily favors accepted | Initially accepted duplicate | After tombstone pruning, the old rejection becomes authoritative again. The model needs one logical analysis with attempts and one current outcome. |
| Requeue | malformed `requeuedAt`, `retryItemId`, or origin linkage | Incoherent history persists | loaded as valid | `"gone"` or duplicate deliveries | Same incoherence after restart. Validate the transition graph, not only individual scalar fields. |
| List / listRejected | lease is expired or tombstone is past TTL | File still says leased/accepted | same | Stale state is returned | Still stale; expiration/pruning runs only during selected mutations. A list must define whether it is raw storage or logical current state. |
| List / listRejected | preceding post-rename durability error | `Q1` visible but not proven durable | `M1` | List reports applied state although mutating caller got an error | Restart may disagree after power loss. Store should be fail-stopped until reconciled. |
| List / listRejected | file becomes malformed or is replaced after startup | Disk and memory diverge | cached state remains | Success from stale memory | A later mutation overwrites external state; restart instead sees the malformed/replaced file. **Decision:** rely strictly on exclusive ownership or verify a generation before each commit. |
| List / listRejected | memory exhaustion during clone | Queue unchanged | unchanged | Error | Queue intact, but inspection/recovery may itself be unavailable |
| Close | queued mutation is running | Mutation completes first | then `closed` | Waits, then releases | Correct ordering today |
| Close | lock release fails | Queue committed; `L` remains | store closed; release retryable | Error | Startup blocked; another `close()` retries. Correct today, but the original pending mutation errors are not reported by `close`. |
| Close | process dies before/during release | Queue is at the last completed mutation; `L` remains or is partially removed | none | No result | Manual stale-lock recovery required |
| Close | filesystem operation never resolves | Current queue/lock remain | permanently closed to new work | Promise hangs indefinitely | No shutdown deadline or forced diagnostic. **Decision:** fail-fast timeout versus waiting indefinitely for storage completion. |
| Close | release observes missing/replaced lock | Other/no `L` | token forgotten | Success | Possible ownership violation is hidden; close must surface it. |

## Failure modes, ordered by user harm

1. **Two owners or consumers can act concurrently.** Stale-lock reclaim has check/unlink races, same-process acquire can reclaim an acquisition still in progress, and `claim` permits multiple browser consumers. These paths cause lost queue writes or duplicate notes.

2. **A successful submit can represent the wrong analysis—or make the next startup impossible.** Caller mutation, incorrect canonicalization, unverified fingerprints, and accepting `null`/non-finite values either silently suppress data or persist records the reader later rejects.

3. **Durability is sometimes reported without having been established.** Permission errors are treated as unsupported directory sync, newly created parent directories are not synced, and post-rename failures leave an unlabelled indeterminate commit.

4. **The model lacks durable, idempotent command results.** After a lost reply, `gone` conflates already accepted/rejected/released, never existed, expired, and superseded. A retry cannot safely learn what happened.

5. **Logical identity and outcome can contradict each other.** Requeue creates a new item ID, fingerprint histories can contain both accepted and rejected records, and tombstone pruning can make an old rejection become current again.

6. **Accepted state is not permanently observable.** Tombstone expiry means the required three-state model eventually has no record that an analysis was accepted.

7. **Malformed durable state is incompletely validated.** Retry graph coherence, expired owner/receipt pairs, fingerprint integrity, timestamp relationships, and non-empty rejection reasons can all pass startup. One malformed record can also make the whole monolithic queue unavailable.

8. **Wall-clock leases trade duplicate work for indefinite blockage.** Backward movement strands work; forward movement authorizes a second consumer while the first may still save.

9. **Resource exhaustion converts retained data into inaccessible data.** Every mutation needs another whole-file copy. Dead letters, accepted tombstones between pruning passes, and orphan temps grow without a storage budget; `requeue` bypasses the active limit.

10. **Crash recovery is inconsistent and under-specified.** Current automatic reclaim sometimes removes valid-looking stale locks and sometimes leaves partial locks permanently blocking startup. The rewrite needs one manual procedure that never touches the queue file.

11. **Release/close can hide loss of lock ownership.** Missing or replaced lock files are treated as successful release, masking the moment the single-owner invariant ceased to hold.

## What the current design cannot express

- A stable **logical analysis ID** distinct from submission attempt, delivery receipt, retry attempt, and payload fingerprint.
- A single authoritative current outcome when accepted and rejected attempt records coexist.
- “Already applied” as distinct from “unknown,” “expired,” “superseded,” and “never existed.”
- A global browser-consumer session or fencing epoch. Leases are per item and consumer IDs are caller supplied.
- A durability-uncertain/needs-reconciliation store state after rename.
- A visible quarantine/recovery state for valid orphan temps or partially malformed records.
- Permanent accepted evidence while accepted tombstones are deliberately deleted.
- Intentional duplicate submissions versus retries; content equality is being used as an idempotency key without producer intent.

## Invariants the app must carry

- Save the note durably before sending `accepted`.
- Persist the queue’s stable logical analysis ID atomically with the note and enforce uniqueness on it.
- On redelivery, look up that ID and return the already-saved result instead of creating another note.
- Fence an expired/superseded consumer during the save transaction if lease takeover remains automatic. The queue cannot stop an old browser from saving after its lease expires.
- Never send `rejected` for an analysis whose note was saved.
- Surface stored rejection reasons to the user; storage alone does not make a reason visible.
- Retry an unconfirmed submit using a stable producer idempotency key.
- During manual lock recovery, verify the previous companion is stopped. Deleting a live owner’s lock cannot be made safe with `"wx"` alone.

## Mechanisms that mask one another

- Automatic stale-lock reclaim masks failed release while introducing dual-owner races.
- The in-process promise chain masks lost-update defects that reappear across processes.
- Accepted tombstones temporarily mask older rejected records; pruning reveals the contradiction.
- Content fingerprints mask the absence of a producer idempotency key while suppressing intentional identical submissions.
- Later successful whole-file writes can make an earlier uncertain rename durable, hiding the original fsync failure.
- Process-restart tests retain page cache and therefore mask missing directory and parent-directory durability.
- Lease expiry masks missing explicit release until clock movement or a paused-but-live consumer exposes it.
- `MAX_ACTIVE_ITEMS` masks growth through submit, while requeue and permanent history bypass the bound.
- Copy-on-write protects `M0` but leaves attempted states in invisible temp files.

## Unbounded growth requiring policy

- `rejected`: unlimited full payloads and reasons; rewritten on every mutation.
- Temp files: one partial/full file for every pre-rename failure.
- Accepted tombstones: pruning occurs only during submit, and high submission throughput can accumulate an unlimited 24-hour set.
- Future idempotency/settlement tombstones: the rewrite will need them, but retention cannot be both finite and an unconditional “detect any redelivery” guarantee. This is a human choice: permanent compact IDs, app-owned permanent identity, or an explicitly bounded guarantee.

## What genuinely holds today

- Within one store instance, queued reads and mutations are serialized, and one failed operation does not break the chain ([queueStore.js:255](/home/hansoullee20/dev/projects/wrongnote/companion/src/queueStore.js:255)).
- For ordinary pre-rename failures, copy-on-write restores the previous in-memory state and the main queue remains unchanged ([queueStore.js:276](/home/hansoullee20/dev/projects/wrongnote/companion/src/queueStore.js:276)).
- Temp-file sync followed by atomic rename prevents a torn main JSON file on a normal local filesystem.
- An uncontested `"wx"` lock acquired before reading the queue blocks an ordinary second process ([lockFile.js:80](/home/hansoullee20/dev/projects/wrongnote/companion/src/lockFile.js:80)).
- Invalid JSON, wrong versions, missing arrays, duplicate IDs/receipts, and several required state-dependent fields fail startup without rewriting the queue file.
- Ordinary lease redelivery preserves the item ID returned by `claim`, so it is detectable if the app persists that ID.
- A late settlement is accepted after lease expiry while the item has not yet been reassigned ([queueStore.js:445](/home/hansoullee20/dev/projects/wrongnote/companion/src/queueStore.js:445)).
- Rejected payloads and their stored error text are retained, and one rejection record can be explicitly requeued only once.
- `close` prevents new API calls, waits for already-enqueued operations, and keeps release retryable when unlink fails.

