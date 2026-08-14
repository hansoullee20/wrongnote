# AI bridge — direction and v1 scope

Decided by Han, 2026-08-12. Supersedes the "wrongnote calls a provider" idea.

## Direction (fixed, not up for re-litigation)

    Claude / ChatGPT
          ↓
    wrongnote MCP / action bridge
          ↓
    structured analysis JSON
          ↓
    parseAiImport()
          ↓
    draft / AI inbox
          ↓
    user confirms
          ↓
    save

- Wrongnote MUST NOT call Anthropic/OpenAI APIs. No API keys in the app, no
  provider billing. The point is to use Han's existing subscription.
- The model client invokes wrongnote, never the reverse.
- Claude first via a local MCP server. ChatGPT gets the equivalent action/tool
  interface later. "Both" is nearly free because the provider is just whichever
  host connects.
- Do NOT build `analyze()` implementations inside wrongnote.

## Invariants

- `parseAiImport()` (src/aiBridge.js:14) stays the single ingestion boundary for
  all AI output — MCP, action bridge, manual paste alike. It runs in the app,
  not in the server. The server may shape-check, but it is never authoritative;
  two parsers would drift.
- Manual copy/paste stays as the permanent fallback. It is also the mobile path:
  MCP needs a desktop host running a local process, so phone recording keeps
  working exactly as today.
- The localhost bridge itself is supported on desktop only. Mobile browsers are
  not a v1 compatibility target; they use the existing manual import path.

## v1 tool surface (narrow on purpose)

- `get_taxonomy()` → CAUSES + MATH_TOPICS, read from src/constants.js. Single
  source of truth; removes the taxonomy blob currently inlined into every prompt
  (src/aiBridge.js:5-11).
- `submit_analysis(analysis)` → shape-checked, queued for confirm.

No read tools in v1. `list_recent_notes` etc. would force the app to push a
localStorage snapshot out to the server — a much larger change than it looks.
Write-only needs zero access to app state.

## Confirm step

Already exists. AI output merges into `draft` (src/views/RecordView.jsx:213) and
passes the form's existing gates (`canSave`, cause gate, four checks). The inbox
needs a pending queue that loads into that draft, not a new confirmation UI.

## Photos

Stay manual in v1. The host has the images in its chat; wrongnote gets them via
the existing attach flow. Piping image bytes through the bridge is v2.

## Open

- Transport. Claude recommends: MCP server also serves localhost HTTP
  (`GET /inbox`, `POST /ack`), app polls, degrades to copy/paste when the server
  is not running. Alternative considered: file-backed inbox via File System
  Access API — no port, but Chromium-only and re-prompts for directory
  permission each session. AWAITING HAN.
