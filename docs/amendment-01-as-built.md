# Amendment 01 — Attempt-Level Assistance (as built)

**Status:** implemented on `claude/amend01-assisted`, not yet merged.
**Schema:** v5 → v6.

This is the **as-built** behavioural contract, derived from the shipped code,
`.reviews/amend01-plan-final.md`, and the review/debate record. It is not the v4
specification — that document still lives outside this repo (see "Missing" at
the bottom). Where this file and the code disagree, the code is right and this
file is a bug.

## The one rule

> An assisted pass is a pass, but it is not an *independent* pass.

Everything else follows from that sentence.

## Data

`attempt.assisted: boolean` — **user-asserted**, never system-inferred.

- Written by `migrate.js` as `attempt.assisted === true`. Strict equality is
  deliberate: a stored `"yes"` is truthy and would survive `??` as an assisted
  pass forever. Missing or malformed defaults to `false`, and the rule is
  idempotent by construction.
- Historical attempts all migrate to `false`. The past cannot be known, so it is
  not guessed — the same rule v5 used for `cause`.
- Written at runtime only by `recordAttempt` (`App.jsx`), which is the sole
  writer of attempts. It sits **outside** the `correct ? ... : ...` discards:
  `cause`/`tags`/`memo` are dropped on a pass because a pass has no failure
  cause, but the pass path is the only path the graduation gate reads.

## Behaviour

| Concern | Rule | Where |
|---|---|---|
| Graduation streak | an assisted pass **resets it to 0** | `review.js` `getConsecutivePasses` |
| Review state | assisted-correct is `progress`, never `graduated` | derived, not coded |
| Recheck schedule | **unchanged** — assisted correct keeps `RECHECK_DAYS` | `App.jsx` |
| Improvement rate | **unchanged** — an assisted pass still counts as improved | `review.js` |
| Reveal solution | stays a plain fail; does **not** set `assisted` | `SolveView.jsx` |

The last two are deliberate non-changes, not oversights, and each has a test
naming it as such.

- *Improvement* means "what I used to get wrong I now get right", not "I get it
  right alone". Only retirement is constrained.
- *Reveal* is an observed event already recorded by `source: "solution_reveal"`.
  `assisted` is an assertion. If the system started inferring one from the
  other, the two fields would say the same thing differently. An explicit 예
  still flows through.

`getConsecutivePasses` scans backwards and **breaks** on an assisted pass.
`continue` would splice older passes onto newer ones and let graduation leak
through the exact case the gate exists to catch.

Legacy attempts have no `assisted` field, which is falsy, so notes that
graduated under v5 are not silently demoted.

## Interface

- **Asking**: `도움을 사용했나? 아니오 / 예`, above the grade buttons, default
  아니오, in both the auto-graded and self-graded flows. It must be answered
  *before* grading — a pass saves the moment you grade it, so a question asked
  afterwards could not reach the attempt. Wrapped in `role="group"` +
  `aria-labelledby` so the question reaches assistive tech with the buttons.
- **Resetting**: `assisted` is cleared in both `next()` and `start()`. Missing
  either leaks help state into the following question or the next session.
- **Reporting**: on the graded screen, between the recorded-as-pass line and the
  schedule line — `도움받은 통과 — 졸업까지 연속 통과는 다시 0회`. Neutral, not
  warning-coloured. Withholding it makes the consequence surface later as an
  unexplained "why won't this graduate?", which teaches the student to stop
  answering honestly.
- **Marking**: `✕` fail / `✓*` assisted pass / `✓` independent pass, from one
  shared formatter used by both the trajectory and the log so they cannot drift.
  The distinction is carried by glyph **and** accessible name, never by colour
  alone — assisted keeps the full `--success` colour precisely so the star is
  doing the work.

## Two traps this amendment fell into, both worth remembering

Both defects were "verified" by a check that structurally could not fail:

1. Per-dot `aria-label`s under `role="img"`, which flattens its subtree — a
   screen reader heard nothing. The test read `getAttribute`, i.e. the DOM
   rather than the accessibility tree, so it passed against markup no assistive
   tech could reach. Tests now query `getByRole(...)`.
2. `opacity: 0.75` on the assisted mark, which dropped it to 3.21:1 — below the
   4.5:1 floor in 9 of 16 palette × mode combinations. `npm run contrast` stayed
   green because it reads palette tokens and knows nothing about CSS opacity.
   There is now a **rendered** contrast guard in `review.spec.js` that composites
   computed colour, ancestor background and accumulated opacity.

The invariant: *a green check is only evidence if it can distinguish the feature
working from the feature absent.* Both guards above were validated by
reintroducing the bug and watching them fail.

## Explicitly out of scope

`attemptedAt` rename; assistance types / hint level / duration / AI provider /
confidence; Study/Practice/Test modes; card SM-2 SRS; stats semantics; every
Master Plan v3 roadmap item.

## Open

- **R5 — schema collision.** SCHEMA_VERSION 6 is claimed by both this branch and
  `v1`. Whichever merges second must rebase to 7. Not fixable on either branch
  alone; it needs a merge-order decision.

## Missing

The **v4 specification** and **Master Plan v3** are referenced throughout the
Amendment 01 planning documents but exist nowhere in this repository or its
history — they were supplied as chat text. Until they are landed as files, no
session can check work against them, and any completion estimate for the project
is guesswork. Landing them is a prerequisite for a meaningful roadmap.
