# Workflow — cross-review with Codex (Han's rules)

Two-model pipeline: expensive judgment (plan/review), cheap volume (execution).
Codex CLI is available natively (`codex exec`) and via plugin (`/codex:review`).

## Tiers — pick by task size, state the tier before starting

**Tier 0 — trivial** (typo, config, one-liner):
Just do it on the cheap model. Run `npm test`. No review.

**Tier 1 — normal feature/refactor (default):**
1. PLAN: ask Codex (`codex exec`, model gpt-5.6-sol, high effort) to write a
   file-by-file, step-by-step plan an implementer can follow with zero judgment.
2. CRITIQUE: I (Claude) do NOT write a second full plan — I only challenge the
   plan: gaps, risks, simpler paths. Surface disagreements to Han.
3. Han approves the plan before execution.
4. EXECUTE: cheap model (sonnet) follows plan exactly. If a decision is needed
   that the plan doesn't cover — STOP and ask, don't improvise.
5. REVIEW: done by whichever model did NOT write the plan. One call only,
   diff-only input, no build/test inside review. Prompt reviews commit-by-commit
   (step-by-step inside a single call), then checks cross-commit interactions.
6. VERIFY: run `npm test` locally in plain shell (never inside Codex sandbox —
   port binding is blocked there).

**Tier 2 — large / novel / risky** (architecture, security, data, money):
Both sides write full plans (Claude opus-or-fable + Codex sol high). Compare,
argue only the divergence points, Han judges. Then execute cheap, review by the
opposing model, test locally. Fable usage is reserved for this tier only.

## Standing rules (all tiers)

- `git fetch origin` before any review. A stale checkout produces confidently
  wrong reviews.
- Semantic commit discipline: pure deletions, behavior changes, and independent
  fixes go in separate commits (A/B/C style). Never mix — mixing makes "is this
  deletion safe?" undecidable in review.
- One review per meaningful change. No re-review of unchanged code.
- Review output format: `[severity] file:line — problem — one-line fix`,
  severity = blocker/high/med/low, end with verdict: merge / fix-then-merge / block.
- Reviewer ≠ planner. Independence is the point.
- Do not run `codex exec --full-auto` or `--dangerously-bypass-approvals`.
- Live two-agent bus (`.agent-sync`/codex-cowork-sync) stays OFF unless Han
  explicitly asks for a live negotiation session.
- Han is the final authority: plans need his approval; never merge/push without
  his sign-off.
