# MERGED PLAN — wrongnote AI bridge v1

Base: `.reviews/mcp-plan-codex.md`. Amended by Han's rulings (2026-08-12) and
the divergence findings in `.reviews/mcp-plan-divergence.md`.
Codex's plan governs anything not contradicted here.

STATUS: awaiting Han's approval. No code written.

---

## 1. Acceptance invariant (normative — every test below exists to falsify it)

> A successfully queued AI analysis must end in exactly one of three observable
> states: **waiting**, **accepted into wrongnote**, or **rejected with a visible
> reason**. It must never disappear silently.

"Observable" means observable *to the user*, not merely present in a log.
Any code path that can drop a queued analysis without landing in one of the
three states is a defect regardless of test status.

## 2. Rulings applied

1. **Badge-to-open, not auto-open.** Codex's eligibility gate is kept verbatim:
   no polling or applying while the record form is open or being edited. A valid
   analysis arms a badge. The user taps it to open. The app never opens a sheet
   on its own.
2. **Malformed payloads are never silent.** Silence applies only to
   absent/unreachable companion. A delivered payload that `parseAiImport()`
   rejects: shows the existing error line once, modifies no app state, is not
   acked as consumed, and retains queue + error metadata for diagnosis or retry.
3. **`subject` added to the AI envelope.**
4. **`failurePoint` preserved through `parseAiImport()`** instead of discarded.

## 3. Two collisions in those rulings, and how this plan resolves them

### 3.1 "Do not ACK as consumed" vs. the poison-queue problem

Taken literally, never settling a rejected item means it is re-claimed on every
poll forever — the user sees the same error repeatedly and the queue head is
permanently blocked. That contradicts ruling 2's own intent.

**Resolution — three terminal outcomes, not two.** `rejected` is terminal and
strictly distinct from `accepted`:

- `accepted` — parsed, draft initialized. Item settled and pruned normally.
- `rejected` — delivered but `parseAiImport()` threw. Item moves to a retained
  **dead-letter** section of the queue file with the original payload, the error
  message, and the timestamp. It is **not re-offered** and **not deleted**.
- `released` — app became ineligible mid-flight. Returns to claimable.

Dead-lettered items are retained indefinitely (not the 24h tombstone), are
listed by a companion CLI flag (`--list-rejected`), and can be re-queued by the
user. This satisfies "do not ack as successfully consumed", "retain enough
metadata to diagnose or retry", and "never disappear" simultaneously, without
the loop.

### 3.2 `failurePoint` preservation requires a schema bump

`parseAiImport()` returning `failurePoint` is trivial. But if the note schema
has no such field, the value dies at save — that is still discarding it, one
step later. Real preservation needs `SCHEMA_VERSION` 7 → 8.

**Resolution — schema change is its own commit, ordered FIRST, reviewed alone.**
This repo has a scarring history with schema collisions
(`.reviews/r5-schema-collision.md`, `.reviews/schema7-merge-review-codex.md`) and
the standing rule forbids mixing a schema change into a feature commit. So:

- Commit 0 (alone): `SCHEMA_VERSION = 8`, `migrateNote` gains
  `failurePoint: note.failurePoint ?? ""`, RecordView renders it as an editable
  field. Additive and defaulted, matching every prior migration in
  `src/migrate.js`. No bridge code in this commit.
- The bridge work stacks on top.

If Han would rather not touch the schema in this cycle, the fallback is: drop
ruling 4 from v1 and log it. Do NOT half-implement it by folding `failurePoint`
into `memo` — that is lossy and unpickable later.

### 3.3 Envelope version — deliberately NOT bumped

`subject` and `failurePoint` are added to the envelope **without** raising
`AI_IMPORT_VERSION` from 1. Both are optional and additive. Bumping to 2 would
make `parseAiImport()` throw on every analysis JSON already produced under the
old prompt, breaking the manual/mobile fallback for existing files. Absent
fields fall back: `subject` → `""` (app keeps the current draft subject),
`failurePoint` → `""`.

`subject` is validated against `SUBJECTS` (`["수학","국어","영어","과탐"]`);
a value outside the list is dropped to `""`, matching the existing
topicMain/cause handling at `src/aiBridge.js:25-40`.

This also removes Codex's "auto-opened draft must default to 수학" problem: the
envelope now carries subject, and badge-to-open means the user sees the subject
before saving anyway.

## 4. Transport contract

Codex's contract (`.reviews/mcp-plan-codex.md` §2) is adopted **unchanged** —
`receive()` / `settle(receipt, outcome)`, opaque receipts, one live claim per
instance, and its full forbidden list. Two amendments:

- `outcome = "accepted" | "rejected" | "released"` keeps its three values, but
  `rejected` now means "dead-letter it", per §3.1, not "discard it".
- The transport still never parses. `parseAiImport()` is called in
  `useAiInbox.js`, in the app. Unchanged from both plans.

## 5. Deltas from Codex's file-by-file plan

Everything in `.reviews/mcp-plan-codex.md` §3 stands except:

- `companion/src/queueStore.js` — add the dead-letter section: retained
  indefinitely, excluded from claim, excluded from 24h pruning, included in the
  corrupt-file startup check.
- `companion/src/index.js` — add `--list-rejected` and `--requeue <id>`.
- `src/useAiInbox.js` — expose `incomingDraft`, `markDraftApplied()`, **plus**
  `rejectionNotice` (the one-shot error) and `pendingCount` (badge). Still never
  exposes receipts or transport status.
- `src/App.jsx` — a delivered analysis arms a badge; it does **not** open the
  sheet. Codex's eligibility definition is otherwise verbatim.
- `src/views/RecordView.jsx` — as Codex specifies, plus the `failurePoint` field
  from commit 0.
- `src/aiBridge.js` — **now modified** (both plans had it unchanged):
  `buildChatGPTRequest` requests `subject` and keeps `failurePoint`;
  `parseAiImport` returns both. The taxonomy blob stays inlined — manual paste
  is the permanent mobile fallback and needs it.
- `src/migrate.js`, `src/storage.js` — schema v8 per §3.2. Commit 0 only.

## 6. Ordered steps

0. Schema v8 + `failurePoint` field + migration test. Merged and reviewed alone.
1. Companion package, config, isolated Playwright config.
2. Queue store incl. dead-letter. Persistence/lease/dedupe/corrupt-file tests.
3. `get_taxonomy` + `submit_analysis`.
4. Loopback HTTP server + entry point + `--list-rejected`/`--requeue`.
5. `src/queueTransport.js`, unwired.
6. `src/useAiInbox.js`, unwired.
7. Envelope change in `src/aiBridge.js` (subject + failurePoint), with manual-
   import regression tests proving old v1 files still parse.
8. Wire badge + open-on-tap into `App.jsx` / `RecordView.jsx`.
9. PNA falsification (§7).
10. Root scripts + CI.

## 7. Highest-risk item: HTTPS Pages → localhost companion

Treated as the top deployment risk, per Han. The deployed app is
`https://hansoullee20.github.io`; the companion is `http://127.0.0.1`. Loopback
is exempt from mixed-content blocking as a potentially-trustworthy origin, so
this *can* work — but only with Private Network Access preflight handled
correctly, and that policy is actively changing. **Do not assume browser
behavior. Prove it.**

Two-part verification, because this cannot be fully automated in the existing
harness and pretending otherwise would be dishonest:

**7a. Automated (companion-side, fully deterministic).** Preflight from a public
`Origin` with `Access-Control-Request-Private-Network: true` must receive
`Access-Control-Allow-Private-Network: true` and the exact echoed origin;
a non-allowlisted origin must get 403 with no queue mutation.

**7b. Manual falsification, run once on Han's machine before merge, recorded in
`.reviews/pna-verification.md`:**
1. Companion running, open the real deployed Pages URL, submit an analysis via
   Claude, confirm the badge arms. → must PASS.
2. **Falsify it:** remove `Access-Control-Allow-Private-Network` from the
   companion, reload, repeat. → must FAIL with a visible browser console block.
   If step 2 still passes, the header is not what makes step 1 work and 7a is
   testing nothing.
3. Restore, confirm PASS again.

Per the standing rule: a green result proves nothing until the negative case has
been shown to fail.

## 8. The three states, enforced

| Event | State | Observable how |
|---|---|---|
| Queued, app closed or ineligible | waiting | badge on next eligible poll; `--list` in companion |
| Delivered, parsed, draft opened, saved | accepted | the note exists |
| Delivered, parsed, draft opened, user closes without saving | waiting → **re-queued** | Codex settled `accepted` at draft init; this plan settles `accepted` only on **save**, and `released` if the sheet is closed unsaved, so the analysis is not lost by closing a form |
| Delivered, `parseAiImport` threw | rejected | error line once + dead-letter, requeueable |
| Companion absent | waiting | nothing shown (correct — the analysis is safe on disk) |
| Companion queue file corrupt | waiting | companion refuses to start, file untouched |

Note row 3 — this is a **third change to Codex's plan**, forced by the
invariant. Codex settles at draft initialization, so closing the sheet without
saving destroys the analysis with no trace. Under §1 that is a silent
disappearance. Settlement moves to save; unsaved close releases the item back to
waiting.

## 9. Tests

Codex's test list (§6 of its plan) is adopted in full, plus:

- `dead-lettered payload is retained and requeueable` (companion) — reject, then
  assert the payload survives with its error text, is not re-offered, and
  `--requeue` makes it claimable again. **Red before.**
- `rejected payload shows the error line exactly once` (app). **Red before.**
- `closing the record sheet without saving returns the analysis to the queue`
  (app) — the §8 row-3 invariant. **Red before.**
- `badge arms without opening the sheet` (app) — asserts no sheet appears on
  delivery and that a tap opens it. **Red before.**
- `old v1 analysis JSON without subject/failurePoint still imports` (app) —
  guards §3.3. **Red before** only after step 7; it is a genuine regression
  guard for the envelope change.
- `migrateNote adds failurePoint without disturbing v7 notes` (commit 0).
- PNA: 7a automated, 7b manual and recorded.

## 10. Commit split

0. `feat(schema): add failurePoint to notes (v8)` — schema + migration + field.
   Alone.
1. `feat(companion): add durable local analysis queue with dead-letter`
2. `build(companion): root commands and CI`
3. `feat(transport): dormant provider-neutral queue transport`
4. `feat(ai-bridge): carry subject and failurePoint through the envelope`
5. `feat(ai-inbox): badge-to-open delivery into the existing record draft`

Never mixed. 0 and 4 are independently revertable without touching the bridge.

## 11. Open questions for Han

1. **Schema v8 in this cycle — yes or no?** (§3.2). Yes = `failurePoint` truly
   preserved. No = drop ruling 4 to a follow-up. I recommend yes, as commit 0,
   reviewed alone.
2. **Dead-letter retention forever?** (§3.1). Alternative is 30 days. Forever is
   safer and this is a single-user local file.
3. Confirm §8 row 3: settlement at **save**, not at draft init. This is my
   change to Codex's plan, forced by your invariant, and it is the one place I
   overrode a Codex decision without you ruling on it directly.
