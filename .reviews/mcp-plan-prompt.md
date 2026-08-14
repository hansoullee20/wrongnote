# PLAN REQUEST — wrongnote AI bridge v1 (localhost-poll)

You are writing an implementation plan. Do not write code. Do not implement.
Output a file-by-file, step-by-step plan an implementer can follow with ZERO
judgment calls. Where a decision is required, make it and state it — do not
leave it open for the implementer.

Read the repo before planning. Key files: src/aiBridge.js, src/constants.js,
src/views/RecordView.jsx, src/storage.js, package.json, playwright.config.js,
tests/.

## Architecture (FIXED — do not redesign, do not propose alternatives)

    Claude (MCP host)
       ↓  MCP
    local companion queue
       ↓  localhost-poll
    wrongnote (browser)
       ↓
    parseAiImport()
       ↓
    AI inbox / draft
       ↓
    user confirms
       ↓
    save

- Wrongnote MUST NOT call Anthropic/OpenAI APIs. No provider API keys anywhere
  in the app. The model client invokes wrongnote, never the reverse.
- Do NOT design any `analyze()` that calls a paid provider API.
- The companion is a separate local Node process. It is BOTH an MCP server (for
  the Claude host) AND a tiny localhost HTTP queue (for the browser).

## Hard constraints

1. `parseAiImport()` (src/aiBridge.js:14) stays the SINGLE ingestion boundary
   for all AI output — MCP, manual paste, anything later. It runs in the app,
   not the companion. The companion may shape-check but is never authoritative.
2. localhost-poll is a desktop/local-companion transport, NOT the permanent
   cross-device architecture. Transport details MUST NOT leak into aiBridge, the
   note schema, or provider-neutral ingestion. Define a small transport
   interface so the transport can later be replaced without touching
   `parseAiImport()` or the AI inbox.
3. Wrongnote stays ignorant of MCP itself. The app knows only "a queue I poll".
   The word MCP must not appear in app-side module names or data shapes.
4. Manual copy/paste stays as the permanent fallback and the mobile path. When
   the companion is not running, the app must degrade silently to today's
   behaviour — no errors shown for an absent companion.
5. Do not add runtime dependencies to the wrongnote app itself (currently react
   + react-dom only). Companion-side deps are fine and belong in a separate
   package.

## v1 tool surface (narrow on purpose)

- `get_taxonomy()` → CAUSES + MATH_TOPICS sourced from src/constants.js, so
  there is one source of truth and the taxonomy blob currently inlined into
  every prompt (src/aiBridge.js:5-11) can eventually go away.
- `submit_analysis(analysis)` → shape-checked, queued.

No read tools in v1 (no list_recent_notes etc.). Notes live in localStorage
inside the tab; any read tool would force the app to push state out to the
companion. Out of scope — say so if you disagree, but plan v1 without it.

## Confirm step

Already exists. AI output merges into `draft` (src/views/RecordView.jsx:213) and
passes the form's existing gates (`canSave`, cause gate, four checks). Plan a
pending queue that loads into that existing draft. Do not design a new
confirmation UI unless you can justify it in one sentence.

## Photos

Out of scope for v1. The host has the images in its chat; wrongnote attaches
photos through the existing flow.

## Deliverable

1. File-by-file plan: exact paths, new vs modified, what each change does.
2. Ordered implementation steps, each independently testable.
3. The transport interface: its exact shape, and what it forbids.
4. Failure modes and what the app does for each: companion absent, companion
   returns garbage, duplicate submissions, queue item already consumed, app open
   in two tabs, poll while the record form is mid-edit or mid-photo-compression.
5. Test plan (Playwright is the harness here) — name each test and what it
   asserts. Every test must be one that FAILS before the change.
6. Semantic commit split (pure additions / behaviour changes / independent
   fixes never mixed).
7. Anything you think is wrong with this brief — state it, then plan it as
   specified anyway.
