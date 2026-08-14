# queueStore.js adversarial review

Read `companion/src/queueStore.js` at the current checkout and derive its failure
surface directly from the code. Do not treat the existing tests as evidence of
anything; they were written by the same side that wrote the implementation, and
they have already missed several defects of exactly the class you are hunting.

## The hunt

Find every path where an operation **fails, partially fails, races, or reads
malformed durable state, but the caller or the store subsequently behaves as if
it had succeeded.**

That is the defect class. Four instances have already been found and fixed in
this file. Assume more remain. A finding is interesting only if you can state
the concrete sequence that produces a wrong observable outcome — a lost
analysis, a duplicated delivery, an item that can never be claimed again, or a
success reported for something that did not durably happen.

## The contract the code is supposed to honour

A successfully queued analysis must end in exactly one of three observable
states: **waiting**, **accepted** (the browser saved a note from it), or
**rejected** (delivered but refused by the app-side parser, retained with its
error). It must never disappear silently, never be delivered twice after being
accepted, and never become permanently unreachable.

Supporting rules the implementation claims:
- `accepted` is settled when the note is saved, not when a draft opens.
- `rejected` moves to a dead-letter section, is never re-offered, is never
  deleted, and can be requeued exactly once.
- One item has at most one live lease. A dead consumer's item returns via lease
  expiry only.
- A malformed or unreadable queue file must fail startup and must not be
  rewritten.
- State becomes visible only after its durable write succeeds.

## Two specific targets — attack these explicitly, not generically

1. **Malformed individual records.** Startup validates that `items` and
   `rejected` are arrays, but not the shape of the objects inside them. Construct
   a queue file that is valid JSON, has the right version, has both arrays, and
   still causes wrong behaviour — an item missing `state`, `fingerprint`,
   `payload`, `leaseExpiresAt`, or carrying values of the wrong type. Determine
   whether such a file starts cleanly and produces an item that is permanently
   unclaimable, silently skipped, or able to break `claim`/`settle`/`requeue`.

2. **Multiple store or process instances.** The in-process serialization chain
   protects one `createQueueStore()` instance only. Two instances — or two
   processes, which matters because MCP hosts commonly spawn their own server
   process — can both read the same state and overwrite each other's writes.
   Establish precisely what is lost, and whether anything in the code prevents
   or detects it. Do not accept "the architecture will guarantee one process" as
   an answer unless the code enforces it.

## Also worth attacking

- Interleaving between `enqueue`'d operations and the `async` boundaries inside
  them.
- Lease expiry against clock movement, and against an item claimed and settled
  across an expiry boundary.
- Fingerprint/dedupe behaviour for payloads that are not plain JSON objects, or
  that differ only in ways canonicalization erases.
- Tombstone pruning interacting with dedupe: what happens to an accepted item's
  identity after its tombstone is pruned.
- Anything in `writeStateAtomic` that can leave the on-disk and in-memory views
  disagreeing.
- Unbounded growth: what stops the dead-letter section or the temp-file
  directory from growing without limit.

## Output

`[severity] file:line — problem — one-line fix`, severity blocker/high/med/low,
then a verdict. For each finding give the concrete sequence that produces the
wrong outcome. If you believe a claimed invariant actually holds, say so
explicitly and say what would break it — do not pad the list.
