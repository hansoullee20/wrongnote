# wrongnote companion

This package is the durable local handoff between an AI client and Wrongnote. It does not call paid model APIs. An AI producer submits a structured analysis into the queue; the browser later claims it through the local companion.

The queue boundary was rewritten from the schema-v8 base and intentionally does not reuse the implementation from PR #16. The design contract is in `.reviews/boundary-rewrite-spec.md`.

## Core guarantees

- one queue file / one companion process;
- one live browser session owns the queue;
- producer-supplied event IDs provide idempotency;
- session fencing makes stale browser operations harmless;
- accepted IDs remain as compact permanent tombstones;
- rejected analyses retain visible evidence and are explicitly requeueable;
- queue corruption fails closed;
- writes distinguish pre-rename failure from post-rename durability uncertainty;
- unsupported directory fsync is visible as degraded durability;
- orphan temp files are quarantined.

## MCP producer mode

`wrongnote-mcp` is the preferred owner when Claude Code is the AI producer. The stdio process starts side-effect free for MCP discovery/handshake. On the first real analysis submission it lazily acquires the queue and starts the browser bridge, after which one process owns all three boundaries together:

```text
Claude Code
    ↕ MCP stdio
wrongnote-mcp process
    ├─ durable queue          (starts on first submit)
    └─ http://127.0.0.1:43119 browser bridge (starts on first submit)
```

Lazy ownership is deliberate. Modern MCP stdio negotiation may launch a disposable discovery process before the real connection. Discovery must not take the queue lock or bind the HTTP port, otherwise the probe and the real server can collide with each other.

The MCP server exposes exactly one producer tool:

```text
wrongnote_submit_analysis
```

Its arguments are:

```json
{
  "eventId": "stable-producer-id-for-this-analysis",
  "payload": {
    "version": 1,
    "question": {},
    "analysis": {}
  }
}
```

`eventId` is an idempotency key, not a content hash. Generate it once per distinct analysis and reuse the exact same value if the tool call must be retried. A retry with the same ID and same payload is safe; the same ID with different content is an explicit conflict.

The MCP tool does **not** parse or save a Wrongnote note. It only queues the model-produced JSON as untrusted data. The browser-side `parseAiImport()` remains the ingestion/trust boundary before any draft can be saved.

If a write committed but directory durability is uncertain, the tool returns an error that says the operation may already have happened and instructs the model to retry the exact same `eventId`. It must not invent a replacement ID.

A dead-letter/rejected event also remains visible as an error on producer resubmission. Do not use a new event ID to bypass rejection evidence; inspect/requeue the dead letter explicitly.

### Claude Code setup

Install the companion dependencies once from the repository:

```bash
npm --prefix companion ci
```

Then register the server by invoking Node directly. For example, from the repository root:

```bash
claude mcp add wrongnote --scope project -- node companion/src/mcp.js
```

The generated project MCP configuration is equivalent to:

```json
{
  "mcpServers": {
    "wrongnote": {
      "command": "node",
      "args": ["companion/src/mcp.js"],
      "env": {}
    }
  }
}
```

Use an absolute path if Claude Code will launch the server from a different working directory.

**Do not configure `npm run` as the stdio MCP command.** npm may write its own banner to stdout; MCP stdout is reserved for protocol messages. Invoke `node .../src/mcp.js` directly or install/use the `wrongnote-mcp` bin.

`wrongnote-mcp` logs status only to stderr. stdout belongs to the MCP transport.

### One owner at a time

Before its first producer submission, `wrongnote-mcp` owns no queue lock and no HTTP port. Once the first submission starts the companion, do not run `wrongnote-companion` against the same queue file. Both intentionally use the same process lock, so the second owner will fail rather than race the queue.

- `wrongnote-mcp`: MCP producer; lazily becomes the queue + browser HTTP owner on first submission.
- `wrongnote-companion`: HTTP-only owner, useful when the producer will arrive through another integration later.

## Localhost HTTP transport

The browser transport is intentionally same-machine only. It binds to:

```text
127.0.0.1:43119
```

It never binds to `0.0.0.0` or the LAN interface. A browser running on another phone/tablet cannot reach this loopback server; cross-device transport is a separate future problem.

Run the HTTP-only owner with:

```bash
npm --prefix companion run serve
```

or, when the package bin is installed:

```bash
wrongnote-companion
```

Environment variables:

```text
WRONGNOTE_QUEUE_FILE       optional queue path
WRONGNOTE_QUEUE_PORT       optional port, default 43119
WRONGNOTE_ALLOWED_ORIGINS  comma-separated exact browser origins
```

The default browser origin is only:

```text
https://hansoullee20.github.io
```

For local Vite development, explicitly add the local origin rather than weakening CORS globally, for example:

```text
WRONGNOTE_ALLOWED_ORIGINS=https://hansoullee20.github.io,http://localhost:5173
```

Browser-facing endpoints:

```text
GET  /v1/health
POST /v1/session/acquire
POST /v1/session/renew
POST /v1/claim
POST /v1/settle
POST /v1/session/release
```

There is deliberately no browser `submit` endpoint. Producer integration is the MCP/tool boundary instead.

State-changing requests require `Content-Type: application/json`, exact request fields, and a bounded body. Browser origins are matched exactly; no wildcard CORS is used. OPTIONS requests are non-mutating.

Modern Chromium gates public-site access to local/loopback services with Local Network Access permission. That browser permission is independent of the companion's CORS policy. The server also answers the older Private Network Access preflight header when an already-allowed origin asks for it, strictly as backwards compatibility rather than as the primary security mechanism.

## Tests

```bash
npm --prefix companion test
```

The PR workflow runs the companion tests on Ubuntu and Windows. These are process/failure-path tests. They do **not** prove power-loss durability.

## Lock recovery

Automatic stale-lock takeover does not exist. A stale process lock must be inspected explicitly:

```bash
wrongnote-queue doctor
wrongnote-queue unlock
```

`unlock` removes only a lock whose local PID is definitively dead. Never edit or delete the queue state file to recover a lock.
