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
6. DEBATE (조건부): 리뷰에서 blocker/high가 나왔거나 verdict가 merge가 아니면,
   리뷰 결과를 반대 모델에게 공격 프롬프트로 던진다:
   "각 지적을 코드 근거로 반박 또는 확인하라. CONFIRMED / PARTIAL / REFUTED로
   분류하고, 리뷰어가 놓친 것을 추가로 찾아라."
   리뷰어는 결과를 정리한다: REFUTED 폐기, PARTIAL 강등, 신규 지적 채택,
   그리고 살아남은 지적들이 공통 근본원인(불변식 하나)으로 묶이는지 명시.
   단 1라운드만 — 정리 후에도 blocker/high에서 의견이 갈리면 루프 금지,
   양쪽 입장을 정리해 Han에게 에스컬레이션.
   리뷰가 클린하거나 low/med뿐이면 DEBATE는 스킵.
7. VERIFY: run `npm test` locally in plain shell (never inside Codex sandbox —
   port binding is blocked there).

**Tier 2 — large / novel / risky** (architecture, security, data, money):
Both sides write full plans (Claude opus-or-fable + Codex sol high). Compare,
argue only the divergence points, Han judges. Then execute cheap, review by the
opposing model, test locally. Fable usage is reserved for this tier only.
Tier 2에서는 심각도와 무관하게 DEBATE 필수 — 클린해 보이는 리뷰도 적대 검증할
가치가 있다.

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

## Output discipline (token)

- Be terse. No recaps, no restating diffs/plans back in chat.
- Findings/plans in the fixed format only; no prose padding.
- Never paste file contents when a path reference suffices.
- Batch questions to Han into one message.

## Context hygiene (token)

- One task = one session. Do not carry old task history; CLAUDE.md reloads the rules.
- Before a session ends, write durable conclusions (review results, agreed plans,
  duel outcomes) to files in the repo (e.g. .reviews/<topic>.md) so the next
  session reads files, not chat history.
- Reference artifacts by path ("review is in .reviews/D.md — read and rebut"),
  never re-paste them.
- In long sessions, /compact at milestones.
