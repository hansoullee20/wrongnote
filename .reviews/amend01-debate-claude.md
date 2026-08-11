# Amendment 01 — DEBATE round 1, Claude rebutting the Codex review

Tier 2: debate is mandatory regardless of severity. Source review:
`.reviews/amend01-review-codex.md`.

## Verdicts on the reviewer's findings

**#1 role="img" flattening — CONFIRMED, and under-rated.**
Evidence: `git show origin/main:src/components.jsx:180` — the
`role="img" aria-label="재풀이 궤적"` wrapper pre-dates this amendment, so the
defect is not new. But 04e6263 made it load-bearing: the plan's commit 5
required "distinction must not be colour-only — glyph + aria-label carry it",
and the aria-label half was unreachable. Worse, the test I wrote asserted
`getAttribute("aria-label")` on each dot, which reads the DOM, not the
accessibility tree — it could not have failed. Fixed in 552d426: ordered labels
compose the parent name, dots are aria-hidden, and the test asserts the composed
name. Same treatment for the log's `grade-mark` (aria-label on a role-less span
is ignored or double-read).

**#2 substring backup assertion — CONFIRMED.**
Weak but real: the substring passes against a truncated snapshot. Fixed —
`seedV5Store` returns the raw written strings and the test compares byte-for-byte.
Note the pre-existing v1 test uses the same substring style; I did not widen
scope to it.

**#3 missing prior-attempt comparison — CONFIRMED.**
The plan's commit-4 test list explicitly said "the earlier attempt stays
byte-equivalent". I omitted it. Fixed with a sentinel attempt and a deep compare.

## What the reviewer missed

**#4 [high] Contrast regression, invisible to the repo's own gate.**
`.traj-dot.assisted` / `.grade-mark.assisted` were styled `opacity: 0.75`.
Composited over `--paper` that puts the 13px mark at **3.21:1 worst case** and
**below 4.5:1 in 9 of 16 palette x mode combinations** (computed against
`src/palettes.js` with the same WCAG formula `tools/verify-contrast.mjs` uses).
`npm run contrast` stayed green throughout because it only checks palette token
pairs and knows nothing about CSS opacity — the passing check was not evidence.
This violates the repo's stated floor ("하나라도 4.5:1 미만이면 실패").
Fixed in b6c9892 by dropping the opacity; the star already carries the
distinction, which is the entire reason not to encode it in colour.

**#5 [med] Untested flow required by the plan.**
The plan required the control in "both the auto-graded and self-graded flows".
Only auto-graded was tested; a note with no recorded answer grades via
맞았다 / 또 틀렸다. Test added.

## Invariant

Findings #1 and #4 share one root cause, and it is not "a11y" or "CSS":
**each was verified by a check that structurally could not fail.** The dot test
read the DOM instead of the accessibility tree; the contrast tool reads tokens
instead of rendered styles. Both went green while the requirement was unmet.
#2 and #3 are the same shape one level down — assertions too weak to fail.
The single invariant: *a green check is only evidence if it can distinguish the
feature working from the feature absent.*

## Fixes applied
552d426 fix(a11y) · b6c9892 fix(theme) · a347727 test (3 gaps)
Full suite 131 passed; `npm run contrast` green; `vite build` clean.

---

## Codex consolidation (debate round 1, closed)

Rulings on the round:
1. Original #1 / #2 / #3 — all **RESOLVED**.
2. Executor's new #4 (contrast) **ACCEPTED** — Codex independently recomputed
   9/16 failures over `paper`, worst 3.21:1. New #5 (self-graded flow) **ACCEPTED**.
3. Root cause **ACCEPTED with qualification**: it unifies all five as an
   escape-detection failure, though the implementation-level causes differ.

Three new [low] findings adopted (protocol: new findings are adopted, not
re-debated; one round only):
- tests/review.spec.js — the trajectory test read `aria-label` directly, so it
  would survive `role="img"` being removed. Now `getByRole("img", { name })`.
- tools/verify-contrast.mjs — the gate stays blind to CSS opacity, so the same
  regression can return green. Closed with a **rendered** contrast guard in
  review.spec.js (computed colour + ancestor background + accumulated opacity,
  8 palettes x day/night) rather than by teaching the token tool to parse CSS.
- src/views/SolveView.jsx — the question was not programmatically tied to the
  아니오/예 buttons. Now `role="group"` + `aria-labelledby`.

Fixed in 16a7dda. The contrast guard was validated by reintroducing
`opacity: 0.75` and watching it fail at 3.21:1 on warm/light — the same figure
the offline calculation produced.

Final verdict: **fix-then-merge**, fixes applied. 132 tests pass, contrast gate
green, build clean. Debate closed — no round 2, no unresolved disagreement.

## Open question for Han (NOT fixed — outside the agreed plan)

`src/views/SolveView.jsx:748` prints "재검증 통과로 기록됨 / 다음 복습은 2주 뒤로
밀린다" after any correct answer. For an assisted pass this is factually true
(D4 keeps RECHECK_DAYS) but silent about the streak reset. The plan does not
cover this copy and instructs the executor not to improvise. Options: leave as
is, or add a line on the graded screen when `assisted` is true.
