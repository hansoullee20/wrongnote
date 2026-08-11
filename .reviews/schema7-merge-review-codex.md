# Schema 7 reconciliation — Codex review

Branch: `release/schema-7-reconciliation`
Reviewer: Codex (gpt-5.6-sol, high). Executor: Claude. Reviewer ≠ executor.
Scope: combined diff of merge `ecbe33c` (conflict resolutions) + `ecbe33c..HEAD`
(v7 promotion). Diff-only input, one call, no build/test inside review.

## Verdict: merge

One finding, no blocker/high. DEBATE skipped per workflow (conditional on
blocker/high or verdict != merge).

## Findings

- **[low]** `tests/migration.spec.js:493` — the v6→v7 upgrade test used an
  assistance-bearing fixture and only asserted `assisted`, so it did not verify
  preservation of v1's AI concept fields.
  **Status: fixed** in `5cdc066`.

  The catch was sharper than its severity. The population stranded at 6 ran the
  **v1** branch, so its data carries `concepts` / `analysisLocale` and has no
  `assisted` at all. The test was exercising the wrong side of the collision —
  amend01's field on a population that never had it. Now seeds an authentic v1
  note (`assisted` deleted) and asserts both v1 fields survive while the absent
  amend01 field normalizes to `false` rather than being guessed.

## Verification

- Suite: **160 passed** (was 159 pre-promotion).
- The v6→v7 snapshot test was verified by falsification, both before and after
  the review fix: forcing `SCHEMA_VERSION` back to 6 makes it fail (snapshot
  reads `null` — `6 < 6 === false`); at 7 it passes. This is R5's exact hazard.

## Not reviewed here

amend01 and v1 were each reviewed on their own branches
(`.reviews/amend01-review-codex.md`, `.reviews/v1-review-codex.md`). This review
covers only the reconciliation: conflict resolutions and the v7 promotion.

## Infrastructure note

This review was blocked ~40 min by broken IPv6, not an API outage. Tailscale
assigns a global-scope IPv6 address (`fd7a:115c:a1e0::/48`) with no IPv6 default
route, so glibc preferred AAAA records and every codex connection blackholed —
process asleep at 0% CPU, no session file written. Small requests survived via
Happy Eyeballs fallback; the websocket transport and large prompts did not.
Fixed by appending `precedence ::ffff:0:0/96  100` to `/etc/gai.conf`
(backup at `/etc/gai.conf.bak`). Symptom to watch for: codex hangs with
`failed to lookup address information: Try again`.
