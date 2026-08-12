# wrongnote companion

A local process that holds AI analyses until the browser claims them.

The direction is deliberate: **the model client calls wrongnote, never the
reverse.** Claude (or later ChatGPT) is the AI client. This companion exposes a
narrow tool surface to it and parks the result in a durable queue. Wrongnote
polls that queue. No provider API key is accepted or used anywhere in this
package or in the app.

See `.reviews/mcp-bridge-design.md` and `.reviews/mcp-plan-merged.md`.

## What exists so far

This package currently contains **the queue only** (plan commit 1). The MCP tool
surface (`get_taxonomy`, `submit_analysis`) and the loopback HTTP endpoint that
the browser polls are separate commits, built on top of this protocol.

## The invariant everything here serves

> A successfully queued AI analysis must end in exactly one of three observable
> states: **waiting**, **accepted into wrongnote**, or **rejected with a visible
> reason**. It must never disappear silently.

Concretely:

- `waiting` — queued, nobody holds it. Includes items whose holder died.
- `leased` — one consumer holds it, for 60s at a time. A sub-state of waiting:
  when the lease expires the item comes back. This is the only way to recover an
  item from a browser tab that was closed or crashed, because a dead tab cannot
  send a release.
- `accepted` — **the note was saved.** Not "the draft was opened". Settling at
  draft initialization would mean closing the form without saving destroys the
  analysis, which violates the invariant above.
- `rejected` — delivered, but `parseAiImport()` refused it. The payload, the
  parse error and the timestamp move to a dead-letter section and are kept
  indefinitely. It is never re-offered (which would loop the same error on every
  poll) and never deleted (which would be a silent disappearance). `requeue()`
  brings it back exactly once.

## Durability

The queue is a JSON file, default `~/.wrongnote/ai-queue-v1.json` (override with
`WRONGNOTE_QUEUE_FILE`), written to a same-directory temp file, fsynced, then
renamed, and **then the containing directory is fsynced too**. Rename is atomic,
so a process killed mid-write leaves the previous file whole; the directory
fsync is what makes the rename itself survive power loss, since until the
directory entry reaches disk the rename can vanish — taking the file with it if
that was the first write.

Worth being precise about what the test suite can and cannot show here: killing
the process proves durability across *process* death, where the page cache still
holds everything, and would pass with no fsync at all. True power-loss durability
is not reproducible in this harness, so the write ordering is pinned by
observation (rename, then directory fsync) rather than by crashing a machine.

A directory fsync that *fails* is not the same event as one that is *impossible*.
Windows cannot open a directory for read, and some filesystems refuse directory
fsync outright (`EISDIR`, `EPERM`, `EACCES`, `EINVAL`, `ENOTSUP`); those are
platform properties and are tolerated. `EIO` and `ENOSPC` are not — they mean the
write did not reach disk, and they propagate. Swallowing them would report an
undurable write as a durable one, which is the exact silent loss this queue
exists to prevent.

A file that cannot be parsed **fails startup and is left untouched**. Starting
empty on a corrupt file would silently discard every analysis inside it.

The same refusal applies to a file that parses but is structurally wrong — an
`items` that is not an array, or a missing `rejected`. That case is more
dangerous than unparseable JSON, not less: coercing it to an empty array starts
cleanly, looks healthy, and loses everything that was queued.

## Tests

    npm --prefix companion test

Eighteen tests, each one a scenario that could lose or duplicate a user's analysis.
Every guard has been falsified by mutation: removing persistence, the
single-lease rule, lease expiry, the accepted tombstone, the rejected-item
removal, the dead-letter write, requeue-once, or the corrupt-file refusal each
makes the corresponding test fail.
