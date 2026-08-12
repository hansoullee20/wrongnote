# Browser AI Inbox — clean adversarial pass

Review target: `bd2e2f19484e88c27bedde5ad8d3e1bffc1adac6`

The tree was read without edits during the pass. CI for this target was green on the full root suite, companion suite, contrast/themes/build, and Windows companion job.

Verdict at frozen target: **not yet sign-off**. No new queue-store corruption/loss path was found, but two protocol-lifecycle issues can still wedge or mis-report settlement, plus several browser robustness issues should be tightened before the real-machine gate.

## A — high: lost response after `released` can wedge the browser session

`queueStore.settle(..., "released")` clears `session.delivery` and leaves the item active. Unlike accepted/rejected, release creates no terminal receipt record. If that write commits but the HTTP response is lost, the browser retries the old release receipt. The store now returns `receipt_mismatch`; `useCompanionInbox.settlePending()` treats that as retryable and keeps `pendingReleaseRef` forever. `tick()` prioritizes the pending release and the renew loop keeps the session alive, so the queue can be held indefinitely by an operation that already succeeded.

Required rule: for a **release** intent, `receipt_mismatch` after a retry is terminal for that old receipt. Release is non-destructive; once the receipt is no longer current there is nothing left for that old intent to release. Stop retrying it and allow ordinary claim/session flow to resume. Keep accepted/rejected stricter because their outcome changes durable event state.

Regression needed: first release request applies, client observes a simulated lost response, retry receives `receipt_mismatch`, pending release clears and the session does not remain permanently blocked.

## B — high: `already_settled` ignores the actual prior outcome

The store deliberately returns:

```text
{ status: "already_settled", outcome: "accepted" | "rejected", eventId }
```

The browser currently treats every `already_settled` as successful regardless of the requested outcome. Therefore an `accepted` retry can be reported locally as successful even if the receipt is durably `rejected`, and vice versa.

Required rule:

- same requested/prior outcome → successful idempotent retry;
- accepted vs rejected mismatch → explicit settlement conflict, never ordinary success;
- release encountering an already-terminal accepted/rejected receipt may stop retrying because the old release intent is no longer applicable, but the terminal outcome should remain visible if it matters to UI/recovery.

Regression needed for accepted→already_rejected and rejected→already_accepted.

## C — medium: AI opt-in preference write can throw

The rest of Wrongnote deliberately uses `savePref()` for best-effort preference writes so quota/security failures cannot crash a UI toggle. `setAiBridgeEnabled()` currently calls raw `localStorage.setItem/removeItem`. Make this preference obey the existing safe-write rule.

## D — medium: AI-disabled browsers still require `crypto.randomUUID()` at render time

`useCompanionInbox()` constructs its session ID immediately, even when the user has never enabled the companion. A browser without `crypto.randomUUID()` can therefore fail the entire app for a feature the user is not using.

Generate the companion session identity lazily on first acquisition, or provide a cryptographically adequate browser fallback. Disabled AI must have zero compatibility cost.

## E — medium UX/correctness boundary: failed note persistence can close review from in-memory dedupe

The new durable guard in `acceptReady()` correctly prevents queue acceptance unless the exact `aiEventId` exists in persisted `wr_notes`. That closes the silent-loss hole.

However `App` still has a redelivery/dedupe effect based on in-memory `notes`. After `saveNotes()` fails, React state still contains the attempted AI note, so that effect can close the review before `acceptReady()` refuses the ACK. Queue correctness survives, but UI says less than the actual state and leaves a storage-locked delivery behind a reopened badge.

Use the same persisted-identity predicate before closing/ACKing a deduped delivery. Also disable AI review save while storage is locked instead of leaving a button that can only no-op.

## Low/UX notes

- The badge text says `AI 분석 1` although it represents the one current delivery, not total queue depth. Prefer wording that does not imply a reliable count unless health/queue depth is intentionally surfaced.
- `normalizeInitial()` defaults a missing subject to `수학`; acceptable for current math-first usage but worth revisiting if non-math producer payloads become first-class.
- The current AI review sheet correctly emphasizes `내 풀이` and `추천 풀이`, while full solution-version progression/best-known-solution/AI coach remains explicitly out of this PR.

## Sign-off gate

Fix A–E with focused regression coverage, freeze the new head, rerun CI, then perform one more clean pass specifically over:

- settlement retry classification;
- persisted-event dedupe;
- storage failure;
- opt-in/no-companion behavior;
- release/reject/accept lifecycle.

Only after that should PR #20 proceed to the real Chrome + localhost companion + Claude end-to-end test.