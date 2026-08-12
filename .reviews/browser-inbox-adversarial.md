# Browser AI Inbox — adversarial review record

## First clean pass

Review target: `bd2e2f19484e88c27bedde5ad8d3e1bffc1adac6`

The tree was read without edits during the pass. CI for this target was green on the full root suite, companion suite, contrast/themes/build, and Windows companion job.

Verdict at frozen target: **not yet sign-off**. No new queue-store corruption/loss path was found, but two protocol-lifecycle issues could still wedge or mis-report settlement, plus several browser robustness issues needed tightening before the real-machine gate.

### A — high: lost response after `released` could wedge the browser session

`queueStore.settle(..., "released")` clears `session.delivery` and leaves the item active. Unlike accepted/rejected, release creates no terminal receipt record. If that write commits but the HTTP response is lost, retrying the old release receipt returns `receipt_mismatch`.

Required/fixed rule: for **release** only, `receipt_mismatch` after retry is terminal for that old receipt. Release is non-destructive; once the receipt is no longer current there is nothing left for that old intent to release. Accepted/rejected remain stricter because their outcome changes durable event state.

Regression now simulates release commit + lost response + `receipt_mismatch`, then proves the item becomes claimable again rather than pinning the session.

### B — high: `already_settled` ignored the actual prior outcome

The store returns:

```text
{ status: "already_settled", outcome: "accepted" | "rejected", eventId }
```

Required/fixed rule:

- same requested/prior outcome → idempotent success;
- accepted vs rejected mismatch → explicit visible conflict, never ordinary success.

Regressions cover accepted→already-rejected and rejected→already-accepted.

### C — medium: AI opt-in preference write could throw

Fixed by using Wrongnote's existing best-effort `savePref()` contract. A preference-storage failure cannot crash the toggle.

### D — medium: AI-disabled browsers required `crypto.randomUUID()` at render time

Fixed by creating the companion session ID lazily on first acquisition and falling back to secure `crypto.getRandomValues()` when `randomUUID()` is unavailable. AI-disabled startup has zero session-ID dependency.

### E — medium: failed note persistence could close review from in-memory dedupe

Fixed by basing accept/redelivery dedupe on the actual persisted `wr_notes` bytes, not React state. AI review Save is disabled after storage lock. A quota-failure regression proves `accepted` is never sent when the note did not persist.

---

## Final clean pass

Frozen review target before documentation-only sign-off commit:

```text
7d207072166ffed2eb11dd612489a92993b86426
```

No source edits were made while this pass was running. The pass re-read the browser inbox lifecycle and specifically challenged:

- acquire / claim / renew / settle classification;
- settlement single-flight and duplicate invocation;
- release commit with lost response;
- accepted/rejected terminal-outcome conflicts;
- accepted receipt mismatch / item-not-found handling;
- permanent 4xx / malformed-protocol stop-gates;
- protocol stop surviving unrelated Record/Settings/AI-review UI suppression;
- persisted `aiEventId` dedupe and storage-failure behavior;
- disabled/no-companion behavior;
- session-ID capability fallback;
- localhost requests that hang before headers **or after headers while the JSON body stalls**.

Additional issues found after the first pass and fixed before this target:

1. accepted/rejected `receipt_mismatch` and all `not_found` outcomes no longer retry forever while renewing the lease; they terminate as visible conflicts without claiming success;
2. unknown logical settle/acquire/claim/renew statuses fail closed rather than being guessed retryable;
3. permanent 4xx / malformed companion responses stop automatic polling/renewal instead of pinning a session;
4. the protocol stop-gate is not cleared merely because another Wrongnote form temporarily suppresses inbox polling;
5. acquire/claim/renew now use the same permanent-protocol stop policy as settle;
6. same-receipt settlement calls are single-flighted so a button handler and interval tick cannot race each other;
7. localhost requests have a bounded timeout, and the timeout remains active through `response.json()` body consumption rather than ending when headers arrive;
8. the proven pre-existing storage implementation is preserved byte-for-byte as `storageCore.js`; the AI persisted-identity check is layered separately instead of rewriting migration/snapshot semantics.

### CI evidence

GitHub Actions run `31604666653` for exact target `7d207072...` completed green:

- root Playwright test suite: success;
- companion test suite: success;
- contrast gate: success;
- theme drift gate: success;
- production build: success;
- Windows companion job: success.

The final run includes the new timeout coverage for both a request that never returns headers and a response whose headers arrive but JSON body never completes.

### Final verdict

**Browser inbox / durable accept-on-save boundary: APPROVED at `7d207072166ffed2eb11dd612489a92993b86426`.**

No blocker/high correctness defect remained in the reviewed browser/save boundary.

Approval means only that this code boundary is ready for the next gate. It does **not** claim that Chrome's current production Local Network Access behavior has been proven from GitHub Pages. The next gate is intentionally a real-machine end-to-end test:

```text
Claude Code / MCP
→ local companion
→ http://127.0.0.1:43119
→ Wrongnote in Chrome
→ explicit AI 연결 opt-in
→ AI 분석 badge
→ editable review
→ durable note save with aiEventId
→ accepted settlement
→ reload / no duplicate
```

## Remaining non-blocking follow-ups

- `AI 연결됨` currently describes opt-in state more than verified health; wording/health indication can be refined after the real-machine test.
- `normalizeInitial()` defaults missing subject to `수학`; acceptable for current math-first use but should be revisited if non-math producer payloads become first-class.
- User-rejection intent is not independently persisted in the browser across a browser crash during an uncertain rejection settlement; at-least-once redelivery may ask the user to reject again. This does not silently lose accepted study data but is worth improving if rejection UX becomes frequent.
- The MCP producer tool currently accepts a generic JSON `payload`; a later producer-ergonomics change should expose the expected Wrongnote analysis shape more explicitly so the model does not have to infer it from project context.
- Full solution-version progression / best-known solution / contextual AI coach remains intentionally outside PR #20 and is frozen separately in `.reviews/solution-progression-spec.md`.
