# PLAN (Claude) — wrongnote AI bridge v1, localhost-poll

Written without reading Codex's plan. Divergence comparison happens after.

## 0. Shape

    Claude host --MCP--> companion (node) --HTTP localhost--> wrongnote (browser)
                             queue                              parseAiImport()
                                                                pending inbox
                                                                user applies -> draft
                                                                existing gates -> save

Companion is one process wearing two hats: MCP server for the host, HTTP queue
for the browser. The browser never learns the word "MCP".

## 1. File-by-file

### New — companion package (no app impact)

- `companion/package.json` — separate package, own deps
  (`@modelcontextprotocol/sdk`). NOT added to the app's package.json. App stays
  react + react-dom.
- `companion/src/queue.js` — in-memory queue + content-hash dedupe.
  `push(payload) -> {id, duplicate}`, `list()`, `ack(id)`. Content hash, not a
  counter: a host that retries `submit_analysis` after a timeout must not
  enqueue the same analysis twice. Queue is deliberately NOT persisted — an
  unconsumed analysis dying with the process is correct; the host can resubmit,
  and a stale queue surviving a reboot is worse than an empty one.
- `companion/src/mcp.js` — MCP server. Two tools only:
  - `get_taxonomy()` → `{ causes, mathTopics }`
  - `submit_analysis(analysis)` → shape check, `queue.push`, returns
    `{ queued: true, duplicate }`.
  Shape check is cheap and non-authoritative: object, `version === 1`, has
  `question` and `analysis`. It exists to give the host a fast error, not to
  validate. `parseAiImport()` remains the real gate.
- `companion/src/http.js` — localhost-only HTTP. Binds `127.0.0.1` (NOT
  `0.0.0.0` — this must not be reachable from the LAN). Default port 8787.
  - `GET /pending` → `{ items: [{ id, payload }] }`
  - `POST /ack` `{ id }` → `{ ok: true }`
  - CORS: `Access-Control-Allow-Origin` echoing only `localhost:5199` /
    `127.0.0.1:5199` and the built preview origin. Not `*` — any page in the
    browser could otherwise drain the queue.
- `companion/src/taxonomy.js` — imports `../../src/constants.js` directly so
  there is exactly one taxonomy.
  **Verify first (step 1 below): `src/constants.js` must be Node-importable.**
  If it touches `window`/`localStorage`, this plan needs a build step and that
  changes the estimate.
- `companion/README.md` — how to register with Claude Desktop, what it exposes.

### New — app side

- `src/inbox/transport.js` — the replaceable seam. Exports
  `createLocalPollTransport({ origin, fetchImpl })` returning:

      { pending(): Promise<Array<{id, payload}>>,   // NEVER throws; [] if unavailable
        ack(id): Promise<void> }                    // NEVER throws

  Forbidden, and this is the whole point of the seam:
  - transport must not import `aiBridge.js` or parse anything; `payload` is an
    opaque string handed onward
  - transport must not touch React state, storage, or the DOM
  - no transport vocabulary (port, poll, HTTP, MCP) crosses this boundary — the
    consumer sees only `pending`/`ack`
  Replacing localhost-poll later means writing a second factory with this same
  two-method shape and changing one call site.
- `src/inbox/useInbox.js` — React hook owning the poll loop.
  - interval 4s while the tab is visible; stops on `visibilitychange` hidden;
    backs off to 30s after consecutive failures, resets on success
  - keeps `applied` ids in memory so a re-delivered item is not re-offered
  - calls `parseAiImport()` on arrival — **this is where model output becomes
    app-shaped, and it is in the app, per the invariant**
  - a payload that throws is acked and surfaced once as a rejected item.
    Acking rejected items is mandatory: a permanently-failing payload that is
    never acked poisons the queue on every poll forever.

### Modified

- `src/App.jsx` — mount `useInbox`, pass `pending` + `applyPending` +
  `dismissPending` down to the record surface. Badge count on the record entry.
- `src/views/RecordView.jsx` — render pending banner; apply loads into `draft`
  through the SAME merge already used at line 213. No second ingestion path.
- `src/aiBridge.js` — **unchanged in v1.** Deliberate. Touching it while adding
  a transport is how transport leaks into the ingestion boundary.

## 2. Ordered steps

1. ~~Verify `src/constants.js` imports cleanly in bare Node.~~ **DONE, passes**
   (checked at 31b69fd-era main, 2026-08-12): imports with no browser globals,
   exports CAUSES/MATH_TOPICS as expected. No build step needed for the
   companion's taxonomy source.
2. `companion/src/queue.js` + node:test unit tests. No MCP, no HTTP yet.
3. `companion/src/http.js` on top of the queue. Curl-testable alone.
4. `companion/src/mcp.js`. Register with Claude Desktop, confirm both tools
   respond by hand.
5. `src/inbox/transport.js`, unwired. Unit-testable via injected `fetchImpl`.
6. `src/inbox/useInbox.js`, unwired.
7. Wire into App + RecordView. First user-visible behaviour change.
8. Playwright specs (§5).
9. Only then: retire the inlined taxonomy from `buildChatGPTRequest` in favour
   of `get_taxonomy` — separate commit, separate review.

## 3. Failure modes

| Case | Behaviour |
|---|---|
| Companion absent | `pending()` returns `[]`. No error, no badge, no console noise. App is exactly today's app. Backoff to 30s so a permanently-absent companion costs ~2 requests/min. |
| Companion returns garbage / non-JSON | Transport returns `[]` for unparseable envelopes. A well-formed envelope with a bad `payload` becomes a rejected item: existing error copy, acked, shown once. |
| Duplicate submission from host | Companion dedupes by content hash at `push`. |
| Item already consumed | `applied` id set in the hook; ack is idempotent server-side. |
| Two tabs open | Both poll. Ack happens on **apply**, not on fetch, so an item is offered until someone applies it. Worst case both tabs load the same analysis into their own unsaved drafts — no data loss, nothing is saved without the user passing the gates. |
| Poll lands mid-edit | Arrival NEVER auto-applies. It only adds a badge. Applying into a dirty draft asks first — `setDraft(d => ({...d, ...imported}))` would otherwise silently overwrite typing in progress. |
| Poll lands mid-photo-compression | Apply is disabled while `photo.busy \|\| submitting`, mirroring `attachmentsLocked` (RecordView.jsx:276). Badge still shows. |
| Companion reachable but hung | `AbortController`, 2s timeout, counts as a failure → backoff. |

## 4. What the transport interface forbids (restated, because it is the constraint)

localhost-poll is a **desktop-only, temporary** transport. The permanent
cross-device answer is not decided. Therefore:
- no port, origin, or polling concept appears outside `src/inbox/transport.js`
- `parseAiImport()` and the note schema know nothing about where bytes came from
- the AI inbox consumes `{id, payload}` and nothing else
- swapping transport = one new factory + one changed call site in `useInbox.js`

## 5. Tests (Playwright, stubbing `GET /pending` via `page.route`)

Real companion is NOT started in tests — route interception keeps them
deterministic and offline.

- `inbox-pending.spec.js` — stubbed pending item ⇒ badge appears; apply fills
  problem/topic/cause into the form. **Red before.**
- `inbox-garbage.spec.js` — payload failing `parseAiImport` ⇒ error shown once,
  `POST /ack` fired, item not re-offered on the next poll. **Red before.**
- `inbox-dirty-draft.spec.js` — typing in the form, then applying ⇒ confirm
  before overwrite. **Red before.**
- `inbox-photo-lock.spec.js` — apply disabled during compression. **Red before.**
- `inbox-ack-once.spec.js` — applied item not re-offered after re-delivery.
  **Red before.**
- `inbox-absent.spec.js` — all polls fail ⇒ no error UI, record flow unaffected.
  **NOT red before** — with no polling code this passes trivially. Honest
  status: regression guard, not a red-first test. Flagging it rather than
  pretending otherwise.
- companion `node:test`: queue dedupe by content hash, ack idempotence,
  HTTP binds 127.0.0.1 only, CORS rejects a foreign origin. **Red before.**

## 6. Commit split

- **A (pure addition)** companion package + its unit tests. Zero app files.
- **B (pure addition)** `src/inbox/*`, unwired, with injected-fetch tests. App
  behaviour unchanged.
- **C (behaviour change)** wire App + RecordView, add Playwright specs. The only
  commit that changes what the user sees.
- **D (independent)** taxonomy single-sourcing in `buildChatGPTRequest`.

A/B/C/D never mixed — C is the only one where "is this safe?" is a real
question, and it should be reviewable alone.

## 7. What I think is wrong with the brief

1. **`get_taxonomy` is close to useless in v1.** The host that calls
   `submit_analysis` is the same host that could have been handed the taxonomy
   in the prompt. It only starts paying rent when the inlined blob in
   `buildChatGPTRequest` is retired — which is step 9, deliberately last. Worth
   building, but do not expect it to change anything until D lands.
2. **The unstated cost is the second process.** Today wrongnote is `npm run
   dev` and nothing else. After this, the AI path silently does nothing unless a
   separate process is running, and the app is required to stay quiet about it
   (constraint 4). Silence is correct for an absent companion but it means "AI
   isn't working" has no in-app signal at all. Suggest a single line in Settings
   showing companion connected/not — diagnostics only, no error, no nag.
3. **v1 delivers less than the current copy/paste flow in one respect**: photos
   still get attached by hand, so the user is still shuttling images into the
   host manually. The saved step is pasting JSON back. Real, but smaller than it
   sounds — worth knowing before estimating.

Planned as specified regardless.
