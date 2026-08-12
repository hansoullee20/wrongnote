# wrongnote companion — queue boundary rewrite

This package is the durable local handoff between an AI client and Wrongnote. It does not call paid model APIs. The AI client submits a structured analysis; the browser later claims it through the companion transport added in later commits.

This rewrite starts from the schema-v8 base and intentionally does not reuse the implementation from PR #16. The design contract is in `.reviews/boundary-rewrite-spec.md`.

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

## Tests

```bash
npm --prefix companion test
```

These are process/failure-path tests. They do **not** prove power-loss durability.

## Lock recovery

Automatic stale-lock takeover does not exist. A stale process lock must be inspected explicitly:

```bash
wrongnote-queue doctor
wrongnote-queue unlock
```

`unlock` removes only a lock whose local PID is definitively dead. Never edit or delete the queue state file to recover a lock.
