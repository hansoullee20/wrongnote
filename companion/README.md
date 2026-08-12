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

## Localhost HTTP transport

The browser transport is intentionally same-machine only. It binds to:

```text
127.0.0.1:43119
```

It never binds to `0.0.0.0` or the LAN interface. A browser running on another phone/tablet cannot reach this loopback server; cross-device transport is a separate future problem.

Run it with:

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

There is deliberately no browser `submit` endpoint. Producer integration is a separate boundary.

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
