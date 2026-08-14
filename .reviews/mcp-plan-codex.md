# Implementation plan — wrongnote AI bridge v1

No repository files were changed.

## 1. Decisions fixed by this plan

- The companion listens only on `127.0.0.1:43119`.
- Its queue is durable at `~/.wrongnote/ai-queue-v1.json`; tests override this path.
- Queue delivery uses a 60-second lease and opaque receipt.
- Exact duplicate payloads are deduplicated while active and for 24 hours after settlement.
- The browser polls only while the Problems tab is visible, the document is visible, and neither the record nor settings sheet is open.
- A valid delivery automatically opens the existing new-record sheet. No new confirmation UI is added because that sheet already provides editing, gates, and explicit save.
- An AI result never merges into an already-open form.
- Queue settlement occurs after `RecordView` has initialized its draft, not after note save. Closing the form afterward discards the draft exactly like closing a manual import today.
- Queue data does not add fields to saved notes. No storage migration or schema-version bump occurs.
- The existing manual prompt-copy and JSON-file import remain unchanged.
- Queue-created drafts default to `subject: "수학"` because the current AI envelope/parser carries no subject. The user may change it before saving.
- Photos remain entirely in the existing attachment flow.

## 2. Exact transport interface

Create this app-facing contract in `src/queueTransport.js`:

```text
transport.receive({ signal? })
  -> Promise<null | { receipt: string, payload: unknown }>

transport.settle(receipt, outcome, { signal? })
  -> Promise<"settled" | "gone">

outcome = "accepted" | "rejected" | "released"
```

Semantics:

- `receive()` claims at most one item for this transport instance.
- `null` means the queue is reachable but empty.
- `receipt` is opaque; callers must only return it to `settle()`.
- `accepted` means `parseAiImport()` succeeded and the record draft was initialized.
- `rejected` means the payload reached `parseAiImport()` and was rejected.
- `released` returns an item to the queue because the app became busy before delivery.
- `"gone"` means the item or lease was already consumed, expired, or superseded. It is terminal for that receipt.
- Network failures, malformed HTTP responses, timeouts, and unexpected statuses reject the promise. The inbox controller catches them silently.

The interface forbids:

- MCP names, request IDs, or protocol objects.
- HTTP status codes or endpoint paths outside `queueTransport.js`.
- Provider names or API credentials.
- Parsing or validating AI output.
- Reading or writing notes, localStorage, photos, or the note schema.
- Saving queue receipts in a draft or note.
- Listing notes or pushing app state to the companion.
- More than one outstanding claimed item per transport instance.

The localhost adapter maps the contract to:

```text
POST http://127.0.0.1:43119/v1/queue/claim
body: { "consumerId": "<per-page UUID>" }

200: { "item": null }
200: { "item": { "receipt": "<opaque>", "payload": <unknown> } }

POST http://127.0.0.1:43119/v1/queue/settle
body: {
  "consumerId": "<same UUID>",
  "receipt": "<opaque>",
  "outcome": "accepted" | "rejected" | "released"
}

204: settled
409 or 410: gone
```

Use a 1.5-second request timeout. Poll immediately when eligible, then every two seconds after a successful empty response. On transport failure, retry after 2, 5, 10, then 30 seconds; remain at 30 seconds until a successful response resets the delay.

## 3. File-by-file plan

### New companion package

- `companion/package.json` — new

  - Declare a private ESM package requiring Node 20 or newer.
  - Add exact runtime dependencies:
    - `@modelcontextprotocol/sdk: 1.30.0`
    - `zod: 4.4.3`
  - Add exact development dependency `@playwright/test: 1.61.1`.
  - Add `start` and `test` scripts.
  - Do not add these dependencies to the root application package.

- `companion/package-lock.json` — new

  - Generate from `companion/package.json`.
  - Commit it so the companion installs independently and reproducibly.

- `companion/src/config.js` — new

  - Fix the bind address to `127.0.0.1`; do not make it configurable.
  - Default the port to `43119`; allow `WRONGNOTE_QUEUE_PORT` for tests.
  - Default the queue file to `path.join(os.homedir(), ".wrongnote", "ai-queue-v1.json")`; allow `WRONGNOTE_QUEUE_FILE`.
  - Allow these browser origins:
    - `https://hansoullee20.github.io`
    - `http://localhost:5173`
    - `http://127.0.0.1:5173`
    - `http://localhost:5199`
    - `http://127.0.0.1:5199`
  - Append comma-separated values from `WRONGNOTE_ALLOWED_ORIGINS`.
  - Define the 60-second lease, 24-hour tombstone retention, 100-active-item limit, 256 KiB payload limit, and queue-format version 1.

- `companion/src/queueStore.js` — new

  - Implement a serialized mutation chain so MCP submission and HTTP claims cannot race.
  - Persist `{ version: 1, items: [...] }`.
  - Store internal item fields only in the companion:
    - `id`
    - `payload`
    - `fingerprint`
    - `createdAt`
    - `state`
    - `leaseOwner`
    - `leaseReceipt`
    - `leaseExpiresAt`
    - `settledAt`
    - `outcome`
  - Canonicalize objects by recursively sorting object keys while preserving array order, then SHA-256 the canonical JSON for deduplication.
  - Deduplicate against every queued/leased item and terminal items settled within 24 hours.
  - Return the existing ID and state for duplicates; do not append another item.
  - Give each claim a random receipt and a 60-second lease.
  - Return the caller’s existing live lease before claiming another item.
  - Serialize every mutation to a same-directory temporary file, `fsync`, then rename atomically.
  - Create the data directory with mode `0700` and queue file with mode `0600`.
  - Prune terminal entries older than 24 hours during mutations.
  - Never expire an unconsumed queued item.
  - If the queue file cannot be parsed or has the wrong version, fail startup without overwriting it.

- `companion/src/httpQueueServer.js` — new

  - Use Node’s built-in `node:http`; do not add Express.
  - Implement only `OPTIONS`, `/v1/queue/claim`, and `/v1/queue/settle`.
  - Require an exact allowlisted `Origin` for queue routes.
  - Require a loopback `Host` header matching the configured port.
  - Return no wildcard CORS header and never enable credentials.
  - Return `Access-Control-Allow-Private-Network: true` on an allowlisted preflight that requests it.
  - Add `Cache-Control: no-store` to all queue responses.
  - Limit claim/settle request bodies to 4 KiB.
  - Map wrong-owner leases to 409 and unknown/terminal receipts to 410.
  - Bind only to `127.0.0.1`.

- `companion/src/mcpServer.js` — new

  - Import `CAUSES` and `MATH_TOPICS` directly from `../../src/constants.js`.
  - Register exactly two tools using `McpServer.registerTool()`:
    - `get_taxonomy`
    - `submit_analysis`
  - `get_taxonomy()` returns:
    - `{ causes: [...CAUSES], mathTopics: deepCopy(MATH_TOPICS) }`
    - Both text content and identical structured content.
    - Read-only, idempotent, non-open-world annotations.
  - `submit_analysis` accepts exactly `{ analysis }`.
  - Its Zod schema describes AI import v1, requiring:
    - `version: 1`
    - `locale: "ko" | "en"`
    - all four current `question` string fields
    - all current `analysis` string/string-array fields, including `failurePoint`
  - Permit additional properties so the companion does not become the authoritative parser.
  - Do not validate taxonomy membership or allowed causes in the companion.
  - Reject non-serializable or greater-than-256-KiB payloads.
  - Enqueue the original analysis object unchanged.
  - Return `{ queueId, duplicate, state }`.
  - Mark submission idempotent because the queue store performs content deduplication.
  - Do not import or invoke `parseAiImport()`.

- `companion/src/index.js` — new

  - Construct one shared queue store.
  - Start the localhost HTTP server.
  - Start `StdioServerTransport` on the same process.
  - Keep stdout exclusively for MCP protocol messages; write startup/errors to stderr.
  - Close HTTP and MCP transports on `SIGINT` and `SIGTERM`.
  - Exit nonzero if queue loading or HTTP binding fails.

- `companion/README.md` — new

  - Document `npm --prefix companion ci`.
  - Give the exact Claude-host command using `node <absolute-repo-path>/companion/src/index.js`.
  - Document the fixed port, queue-file location, origin override, and stderr diagnostics.
  - State that no provider API key is accepted or used.
  - State that the browser integration is desktop-only and manual import remains the mobile fallback.
  - Include troubleshooting for browser CORS/local-network policy and port conflicts.

- `companion/playwright.config.js` — new

  - Point `testDir` at `companion/tests`.
  - Use one worker because tests share a spawned localhost port.
  - Do not launch a browser or web server.

- `companion/tests/companion.spec.js` — new

  - Exercise the companion through an SDK stdio client and real localhost HTTP calls.
  - Use port `43120` and a temporary queue file, never the user’s default queue.
  - Cover the companion tests listed below.

### New app-side modules

- `src/queueTransport.js` — new

  - Implement the exact two-method interface above.
  - Generate one random consumer UUID per module instance/page load.
  - Contain all URL, fetch, timeout, HTTP, JSON-envelope, CORS, and status mapping logic.
  - Reject responses over 300 KiB before parsing JSON.
  - Export the factory for tests and a default localhost instance for production.
  - Do not contain the string `MCP`.

- `src/useAiInbox.js` — new

  - Accept `{ eligible, transport }`.
  - Import and call `parseAiImport()` for every received payload.
  - Own the polling/backoff, one-delivery state machine, abort handling, and settlement retries.
  - Expose only:
    - `incomingDraft`
    - `markDraftApplied()`
  - If parsing fails, settle as `rejected`, keep `incomingDraft` null, and continue polling.
  - If eligibility becomes false after a receive started, settle as `released`.
  - Once a draft is exposed, stop calling `receive()`.
  - After `markDraftApplied()`, settle as `accepted`; retry transport failures without redelivering the draft.
  - Treat `"gone"` as successful terminal settlement.
  - Never expose receipt or transport status to `App`, `RecordView`, or saved data.
  - Do not show UI errors for any transport failure.

### Modified application files

- `src/App.jsx` — modified

  - Instantiate `useAiInbox`.
  - Define eligibility exactly as:
    - `tab === "problems"`
    - `recording === false`
    - `settingsOpen === false`
    - `document.visibilityState === "visible"`
  - Subscribe to `visibilitychange` so hidden tabs stop polling.
  - When `incomingDraft` appears:
    - set `editingNoteId` to `null`
    - retain it as `initialAiDraft`
    - open the existing record sheet
  - Pass `initialAiDraft` and an applied callback to `RecordView`.
  - Clear `initialAiDraft` and invoke `markDraftApplied()` only after `RecordView` reports initialization.
  - Leave `addNote`, `updateNote`, storage locks, and save behavior unchanged.

- `src/views/RecordView.jsx` — modified

  - Add optional props `initialAiDraft` and `onInitialAiDraftApplied`.
  - Initialize a new-record draft as `{ ...emptyDraft(), ...initialAiDraft }`.
  - Keep `step` at 1, gate checks all false, and both photo lists empty.
  - Report application once from a guarded mount effect; tolerate React Strict Mode’s double effect.
  - Do not apply this prop in edit mode.
  - Keep manual file import calling `parseAiImport()` exactly as today.
  - Keep the existing problem fallback for manual imports.
  - Do not add a save bypass, auto-save, new confirmation component, photo behavior, or note metadata.

### Packaging and CI

- `package.json` — modified

  - Add convenience scripts:
    - `companion:install`
    - `companion:start`
    - `test:companion`
    - `test:all`
  - Keep root `dependencies` exactly `react` and `react-dom`.

- `.github/workflows/pr.yml` — modified

  - Run `npm --prefix companion ci`.
  - Replace the root-only test invocation with `npm run test:all`.
  - Keep build, contrast, and generated-theme checks unchanged.

- `.github/workflows/deploy.yml` — modified

  - Apply the identical companion-install and `test:all` changes.
  - Keep deployment behavior unchanged.

- `tests/ai-queue.spec.js` — new

  - Add a shared in-memory fake for the two HTTP routes using Playwright routing.
  - Cover all app-side tests listed below.
  - Keep the suite serial only where two pages share one fake queue.

### Explicitly unchanged

- `src/aiBridge.js`

  - `parseAiImport()` remains the sole authoritative ingestion boundary.
  - The taxonomy serialization in `buildChatGPTRequest()` remains because manual/mobile usage still needs it.

- `src/constants.js`

  - Remains the single taxonomy source; the companion imports it directly.

- `src/storage.js` and `src/migrate.js`

  - No AI inbox keys, note fields, migrations, or schema-version changes.

- `playwright.config.js`

  - The root harness needs no server or port change; app tests intercept the default queue URL.

- `tests/ai-import.spec.js`

  - Existing manual-import tests remain unchanged and continue acting as regression coverage.

- `src/styles.css`

  - No UI is added, so no styling change is required.

## 4. Ordered implementation steps

1. Add the standalone companion package, locked dependencies, configuration, and isolated Playwright configuration. Verify `npm --prefix companion test -- --list`.

2. Implement the durable queue store. Add and pass the persistence, lease, deduplication, and corrupt-file tests.

3. Implement `get_taxonomy()` and `submit_analysis()`. Pass the MCP taxonomy, shape-checking, size-limit, and duplicate-submission tests.

4. Implement the loopback HTTP server and executable entry point. Pass the origin, claim, settlement, two-consumer, and restart tests.

5. Add `src/queueTransport.js` without wiring it into the app. Verify `npm run build` and its transport-envelope test.

6. Add `src/useAiInbox.js` with `parseAiImport()` ingestion, eligibility races, silent backoff, and settlement retry. Verify its fake-transport tests.

7. Wire the hook into `App.jsx` and initial draft delivery into `RecordView.jsx`. Pass the valid-delivery and existing-gate tests.

8. Add the garbage, absent-companion, already-consumed, duplicate-delivery, two-tab, mid-edit, and mid-compression Playwright cases.

9. Add root convenience scripts and identical CI workflow commands. Run:
   - `npm ci`
   - `npm --prefix companion ci`
   - `npm run test:all`
   - `npm run build`
   - `npm run contrast`
   - `npm run themes && git diff --exit-code src/themes.css`

## 5. Failure-mode behavior

- **Companion absent:** fetch timeout/rejection is caught, no banner or error appears, and manual import remains usable. Backoff reaches 30 seconds.

- **Companion returns malformed HTTP/JSON:** treat it as transport unavailable. Do not alter the form or attempt settlement without a trustworthy receipt.

- **Companion returns a valid envelope with invalid AI payload:** `parseAiImport()` rejects it; settle `rejected`, do not open the form, and do not retry that item.

- **Duplicate submissions:** canonical payload fingerprinting returns the existing queue ID. Only one claimable item exists. Terminal fingerprints remain deduplicated for 24 hours.

- **Queue item already consumed:** HTTP returns 410; the adapter returns `"gone"`. If the draft was already initialized, keep it intact and stop retrying settlement.

- **App open in two tabs:** each page has a different consumer UUID. Serialized claim mutations permit one live lease only. The losing tab receives an empty queue. If the winning tab dies before draft application, the item becomes claimable after 60 seconds.

- **Form already open or being edited:** polling is disabled. No queued output merges into the draft.

- **Photo compression active:** the form is open, so polling is disabled. A settlement retry may run, but it cannot mutate the draft or photo state.

- **Receive began before the form opened:** abort the request. If a receipt still arrives, settle it as `released`; never merge it.

- **Companion disappears after draft initialization but before settlement:** retain the draft, retry `accepted` settlement with backoff, and do not call `receive()` meanwhile.

- **Companion queue file is corrupt:** companion startup fails without replacing the file. From the app’s perspective the companion is absent, so fallback behavior remains available.

## 6. New Playwright tests

Every test below fails before this change because either the companion executable/tool does not exist or the browser never issues queue requests.

### `companion/tests/companion.spec.js`

- `get_taxonomy returns the exact app constants`
  - Deep-equals `CAUSES` and `MATH_TOPICS` imported from `src/constants.js`.

- `submit_analysis rejects an invalid envelope before enqueue`
  - Rejects missing version/question/analysis and leaves the queue empty.

- `submit_analysis accepts unknown taxonomy values for app-side validation`
  - Confirms the companion is structural, not authoritative.

- `submit_analysis deduplicates identical active and recently consumed payloads`
  - Confirms the same queue ID and only one claimable item.

- `queue survives companion restart`
  - Submits, stops the process, restarts with the same file, then claims the item.

- `HTTP queue rejects disallowed origins`
  - Asserts 403 and no queue mutation.

- `one item has only one live consumer lease`
  - Two consumers claim concurrently; exactly one receives the item.

- `settlement is owner-bound and terminal`
  - Wrong consumer gets 409, owner gets 204, repeat gets 410.

- `expired lease is claimable by another consumer`
  - Uses a test lease override and verifies a new receipt.

### `tests/ai-queue.spec.js`

- `queued analysis opens a reviewable draft and does not save automatically`
  - Asserts parsed fields, unchanged notes before save, and normal save afterward.

- `queued execution mistake still requires all four checks`
  - Asserts `canSave` remains locked until all existing gate checkboxes are checked.

- `absent companion is silent and manual import still works`
  - Asserts at least one intercepted poll was attempted, no queue error appears, and manual JSON import succeeds.

- `invalid queued payload is rejected without opening or changing a draft`
  - Asserts `rejected` settlement and no record sheet.

- `already-consumed settlement keeps the initialized draft`
  - Fake settlement returns 410; draft remains editable with no visible error.

- `duplicate receive responses initialize the draft only once`
  - Replays one receipt and asserts one sheet initialization and no second overwrite.

- `two tabs cannot load the same queue item`
  - Shared atomic fake queue; exactly one tab opens the imported draft.

- `open manual edit prevents polling and preserves every edited field`
  - No claim while editing; after closing, the queued item loads into a fresh new-record draft.

- `an in-flight claim is released when photo compression starts`
  - Hold the claim response, open the form, start gated compression, release the response, and assert `released` settlement with unchanged text/photos.

- `hidden and non-Problems views do not claim until eligible`
  - Assert no claim while hidden or on Solve; returning visibly to Problems permits delivery.

## 7. Semantic commit split

1. `feat(companion): add durable local analysis queue`
   - New `companion/` files only, including companion tests and lockfile.

2. `build(companion): add root commands and CI coverage`
   - Root `package.json` scripts and the two workflow changes only.

3. `feat(transport): add dormant provider-neutral queue transport`
   - New `src/queueTransport.js` and `src/useAiInbox.js` only; no existing app behavior changed.

4. `feat(ai-inbox): load queued analyses into the existing record draft`
   - `src/App.jsx`, `src/views/RecordView.jsx`, and app-side Playwright tests.

No independent cleanup or parser fixes belong in these commits.

## 8. Problems in the brief/current contract

- Exactly-once delivery cannot be guaranteed across a browser crash and HTTP acknowledgement without storing transport receipts in app data. This plan deliberately provides at-least-once transport, one live lease, server deduplication, and idempotent settlement without contaminating the note schema.

- `failurePoint` is requested by the current prompt but discarded by `parseAiImport()`. The bridge preserves current behavior; fixing it requires a separate product/schema decision.

- The AI envelope carries no `subject`, so an automatically opened draft must default to mathematics. This plan does so rather than smuggling subject through a transport-only field.

- `get_taxonomy()` cannot replace the taxonomy in the manual prompt while manual/mobile fallback remains permanent. It does establish a single data source because both paths read `src/constants.js`.

- Browser-to-loopback access remains subject to CORS and evolving local-network permission rules. The server therefore binds loopback, implements explicit preflights, and documents troubleshooting; the app still treats policy rejection as silent absence. Loopback HTTP is treated specially by browsers, while private-network access may require explicit permission/preflight handling. [MDN mixed-content guidance](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Mixed_content), [Chrome private-network guidance](https://developer.chrome.com/blog/private-network-access-preflight)

- Stdio is the correct local-host transport for the companion’s MCP side; stdout must remain protocol-only. [Official MCP TypeScript SDK server documentation](https://ts.sdk.modelcontextprotocol.io/server)
