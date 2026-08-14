# Failure-surface inventory — companion/src/queueStore.js + companion/src/lockFile.js

This is **requirements discovery, not an approval review.** These two files are
going to be rewritten as one coherent state machine. Your job is to inventory
the failure surface the rewrite must handle. Do not grade the current code; map
what it gets wrong so the replacement cannot repeat it.

Read both files at the current checkout. Do not treat the tests as evidence of
anything — they were written by the same side as the implementation, and they
have repeatedly asserted the shape of a fix rather than the behaviour it was
meant to guarantee. Several defects have already been found in code the tests
called covered.

## What this component is

A local companion holds AI analyses in a durable JSON-file queue until a browser
claims them over localhost. One companion, one queue file. The browser parses
each payload and either saves a note from it or rejects it.

## Target invariant

> No silent loss; at most one live consumer; accepted only after durable app
> save; any redelivery is detectable and idempotent.

A queued analysis ends in exactly one of three observable states — **waiting**,
**accepted**, **rejected with a visible reason** — and never disappears
silently. The queue cannot guarantee "exactly once" alone: if an ACK is lost
after the app saved a note, redelivery is legitimate and the app must make it
harmless. The queue's obligation is that redelivery is *detectable*.

## Decisions already taken for the rewrite — do not argue these, plan around them

- **Automatic stale-lock takeover is being deleted.** Acquisition will be
  `open(..., "wx")` only; if the lock exists, startup fails loudly; recovery is
  manual. Findings about the current PID/hostname reclaim logic are interesting
  only insofar as they tell the rewrite what to guarantee instead — in
  particular, what a user is left with after a crash, and how they get out of it
  without losing queued analyses.
- No `flock` or new locking dependency this cycle.
- The queue stays a JSON file with atomic rename.

## The defect class that keeps recurring

Every defect found so far has been the same shape: **an operation fails,
partially fails, races, or reads malformed durable state, and the caller or the
store then behaves as if it had succeeded.** Nine instances have been found and
fixed, several introduced by the fix for the previous one. Assume the current
code still contains members of this class that nobody has named yet.

## Produce a failure matrix

The rewrite will be driven by an explicit matrix. Give me its rows:

    operation × failure point × durable (on-disk) state × in-memory state ×
    caller-visible result × state after restart

Cover at least: acquire, release, submit, claim, settle(accepted / rejected /
released), requeue, list, close — against at least: pre-rename failure,
post-rename failure, fsync failure, process death at each step, concurrent
callers, a second process, malformed file, malformed record, clock movement,
and resource exhaustion.

For every row where the current code produces a wrong or ambiguous outcome, say
what the outcome is and what it should be. Where the correct answer is genuinely
a judgment call rather than a bug, say so and give the trade-off — those need a
human decision, not a patch.

## Also name explicitly

- Anything the current design cannot express, where the bug is the shape rather
  than the code.
- Any invariant that cannot be enforced inside this component and must be
  carried by the app instead.
- Any place where two mechanisms overlap so that one masks defects in the other.
- Unbounded growth: dead letters, temp files, tombstones.

## Output

The matrix first. Then a list of failure modes the rewrite must handle, ordered
by how badly they hurt a user with real study data. Then, separately, anything
you believe genuinely holds today and why. Do not pad; a short accurate
inventory beats a long one.
