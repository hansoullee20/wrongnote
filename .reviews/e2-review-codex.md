[high] src/storage.js:105 — `wr_state` always wins even when an older open PWA tab subsequently writes legitimate changes to legacy keys, silently hiding those changes — store legacy baseline hashes/revisions in the envelope and lock or merge when legacy diverges.

[high] src/storage.js:112 — envelope validation ignores `env.version`; missing/future versions are accepted and rewritten as current, while the separate version key can mislabel snapshots after partial failure — validate and trust the envelope version whenever `wr_state` exists, locking unsupported future versions.

[med] src/storage.js:80 — upgrade snapshots combine authoritative `state` with permanently frozen, potentially stale legacy `notes/cards`, leaving recovery with conflicting sources — snapshot only `state` when present, otherwise snapshot legacy fields.

[med] tests/storage-failure.spec.js:649 — the fifth new test writes legacy data after `wr_state`, labels it stale, and asserts it is ignored; it discriminates old/new code but codifies the old-tab data-loss hole — test post-transition legacy divergence as a lock/merge case instead.

verdict: fix-then-merge
